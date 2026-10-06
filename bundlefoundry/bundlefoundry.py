"""Site integration. Only the free checkout endpoint can be mutated."""
import html
import http.cookiejar
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone

BASE = "https://bundlefoundry.com"
TRACKER = "mlwgg.r.sp1-brevo.net"
SLUG = re.compile(r"/bundle/([a-z0-9]+(?:-[a-z0-9]+)*)/?$")


class NeedsLogin(Exception):
    pass


class RetryLater(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass
class Response:
    status: int
    headers: object
    body: bytes


def site_cookie(cookie):
    domain = cookie.get("domain", "").lstrip(".").lower()
    return domain == "bundlefoundry.com"


def parse_page(body):
    match = re.search(r'data-page="([^"]+)"', body.decode())
    if not match:
        raise RetryLater("site page format changed or browser verification required")
    return json.loads(html.unescape(match[1]))["props"]


def allowed_link(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme != "https" or p.username or p.password or p.port not in (None, 443):
        return False
    return (p.hostname == "bundlefoundry.com" and SLUG.fullmatch(p.path) is not None) or (
        p.hostname == TRACKER and p.path.startswith("/mk/cl/"))


class BundleFoundry:
    def __init__(self, vault=None):
        self.vault = vault
        self.jar = http.cookiejar.CookieJar()
        saved = vault.load() if vault else {}
        self.account = saved.get("account", "")
        self.claim_receipt = None
        for c in saved.get("bundle_cookies", []):
            if site_cookie(c):
                domain = c["domain"]
                expiry = c.get("expires")
                self.jar.set_cookie(http.cookiejar.Cookie(
                    0, c["name"], c["value"], None, False, domain,
                    domain.startswith("."), domain.startswith("."), c.get("path", "/"),
                    True, True, int(expiry) if expiry and expiry > 0 else None,
                    not expiry or expiry <= 0, None, None, {"HttpOnly": c.get("httpOnly", True)}))
        self.opener = urllib.request.build_opener(
            NoRedirect(), urllib.request.HTTPCookieProcessor(self.jar))

    def persist(self):
        if self.vault:
            saved = self.vault.load()
            saved["bundle_cookies"] = [
                {"name": c.name, "value": c.value, "domain": c.domain, "path": c.path,
                 "secure": c.secure, "expires": c.expires, "httpOnly": c.has_nonstandard_attr("HttpOnly")}
                for c in self.jar if c.domain.lstrip(".") == "bundlefoundry.com" and c.secure]
            self.vault.save(saved)

    def request(self, url, payload=None, headers=None):
        p = urllib.parse.urlsplit(url)
        if p.scheme != "https" or p.hostname not in ("bundlefoundry.com", TRACKER) or p.port not in (None, 443):
            raise ValueError("untrusted destination")
        if payload is not None and url != BASE + "/checkout/claim-free":
            raise ValueError("only the free claim endpoint may be mutated")
        h = {"User-Agent": "BundleFoundryFreeClaim/1.0", **(headers or {})}
        if payload is not None:
            h.update({"Content-Type": "application/json", "Accept": "application/json"})
        req = urllib.request.Request(url, json.dumps(payload).encode() if payload is not None else None, h)
        try:
            try:
                r = self.opener.open(req, timeout=30)
            except urllib.error.HTTPError as e:
                r = e
            with r:
                return Response(r.code, r.headers, r.read(4 * 1024 * 1024))
        except (urllib.error.URLError, TimeoutError, OSError):
            raise RetryLater("network request failed") from None
        finally:
            self.persist()

    def resolve(self, url):
        for _ in range(6):
            if not allowed_link(url):
                raise ValueError("email link points outside allowed bundle destinations")
            p = urllib.parse.urlsplit(url)
            if p.hostname == "bundlefoundry.com":
                return BASE + p.path.rstrip("/")
            r = self.request(url)
            if r.status not in (301, 302, 303, 307, 308) or not r.headers.get("Location"):
                raise RetryLater("email tracking link could not be resolved")
            url = urllib.parse.urljoin(url, r.headers["Location"])
        raise RetryLater("email redirect chain is too long")

    def page(self, url, authenticated=True):
        r = self.request(url)
        if r.status in (301, 302, 303, 401, 419):
            raise NeedsLogin("BundleFoundry session expired")
        if r.status != 200:
            raise RetryLater("BundleFoundry page unavailable")
        props = parse_page(r.body)
        if authenticated:
            user = props.get("auth", {}).get("user")
            if not user:
                raise NeedsLogin("BundleFoundry needs a Google sign-in")
            if not self.account or user.get("email", "").lower() != self.account.lower():
                raise NeedsLogin("BundleFoundry account does not match configured Gmail")
        return props

    def claim(self, url):
        self.claim_receipt = None
        props = self.page(url)
        b = props["bundle"]
        # A free owner also has tier_number=0; the license list distinguishes ownership.
        if props.get("owned_license_types"):
            return "already_owned"
        if b.get("has_free_tier") is not True:
            return "no_free_tier"
        if b.get("status") != "active":
            return "inactive"
        now = datetime.now(timezone.utc)
        for field, past in [("start_at", False), ("end_at", True)]:
            if b.get(field):
                moment = datetime.fromisoformat(b[field].replace("Z", "+00:00"))
                if (past and moment <= now) or (not past and moment > now):
                    return "inactive"
        if b.get("free_tier_available") is not True or b.get("free_tier_remaining") == 0:
            return "sold_out"
        remaining = b.get("free_tier_remaining")
        if remaining is not None and remaining <= 0:
            return "sold_out"
        xsrf = next((c.value for c in self.jar if c.name == "XSRF-TOKEN" and c.domain.lstrip(".") == "bundlefoundry.com"), None)
        if not xsrf:
            raise NeedsLogin("BundleFoundry CSRF cookie missing")
        claimed_at = time.time()
        result = self.request(BASE + "/checkout/claim-free", payload={"items": [{
            "type": "bundle", "bundle_id": b["id"], "giveaway_product_id": None,
            "tier_number": 0, "title": b["title"]}]}, headers={
                "X-XSRF-TOKEN": urllib.parse.unquote(xsrf), "X-Requested-With": "XMLHttpRequest",
                "Origin": BASE, "Referer": BASE + "/checkout"})
        if result.status in (301, 302, 303, 401, 419):
            raise NeedsLogin("BundleFoundry session expired during claim")
        if result.status != 200:
            raise RetryLater("free claim rejected; no paid checkout attempted")
        try:
            receipt = json.loads(result.body)
        except ValueError:
            raise RetryLater("free claim response format changed") from None
        if receipt.get("skipped"):
            # Never treat HTTP 200 alone as proof of a successful claim.
            if self.page(url).get("owned_license_types"):
                return "already_owned"
            raise RetryLater("free claim skipped by site")
        verified = self.page(url)
        if verified.get("bundle", {}).get("id") != b["id"] or not verified.get("owned_license_types"):
            raise RetryLater("free claim not yet confirmed in account")
        self.claim_receipt = {
            "bundle_url": url, "bundle_id": b["id"], "bundle_title": b["title"],
            "tier_number": 0, "owned_license_types": verified["owned_license_types"],
            "account_sha256": hashlib.sha256(self.account.lower().encode()).hexdigest(),
            "claimed_at": claimed_at, "ownership_verified_at": time.time(),
            "new_claim": True,
        }
        return "claimed"
