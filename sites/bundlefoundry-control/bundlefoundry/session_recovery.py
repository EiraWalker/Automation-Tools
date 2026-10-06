"""Bounded Google browser session reuse; no passwords or OAuth tokens are collected."""
import io
import base64
import json
import logging
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet

from bundlefoundry import BASE, AccountMismatch, BundleFoundry, NeedsLogin, RetryLater, site_cookie

PROFILE_FILES = frozenset({
    "Local State", "Default/Cookies", "Default/Cookies-journal",
    "Default/Network/Cookies", "Default/Network/Cookies-journal",
    "Default/Preferences", "Default/Secure Preferences",
})
MAX_PROFILE_TOKEN = 250_000
_install_lock = threading.Lock()
LOG = logging.getLogger("google-session-recovery")


class InteractiveLoginRequired(NeedsLogin):
    def __init__(self, message, code="owner_verification_required"):
        super().__init__(message)
        self.code = code


class BrowserRuntimeUnavailable(RetryLater):
    def __init__(self, code):
        super().__init__("browser runtime unavailable")
        self.code = code


def pack_profile(profile):
    """Archive only session files, after the Chromium process has exited."""
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as archive:
        for relative in sorted(PROFILE_FILES):
            path = Path(profile) / relative
            if path.is_file() and not path.is_symlink():
                archive.add(path, arcname="google-browser/" + relative, recursive=False)
    return data.getvalue()


def google_cookie(cookie):
    domain = cookie.get("domain", "").lstrip(".").lower()
    return domain == "google.com" or domain.endswith(".google.com")


def google_interaction_error(path, page):
    """Classify authentication barriers without reading or logging page content."""
    if path.endswith("/rejected"):
        return "google_session_rejected"
    if "/challenge/pwd" in path:
        return "google_password_required"
    if "/challenge/" in path or path.endswith("/challenge"):
        return "owner_verification_required"
    fields = page.locator("input[type=password],input[name=Passwd],input[name=totpPin],input[name=idvPin]")
    if any(fields.nth(index).is_visible() for index in range(fields.count())):
        return "owner_verification_required"
    fields = page.locator("input[type=email]")
    if any(fields.nth(index).is_visible() for index in range(fields.count())):
        return "google_session_not_accepted"
    return None


def select_google_account(page, account):
    """Support Google's account chooser variants, selecting only the expected account."""
    entries = page.locator("[data-identifier],[data-email]")
    for index in range(entries.count()):
        entry = entries.nth(index)
        identifier = entry.get_attribute("data-identifier") or entry.get_attribute("data-email") or ""
        if identifier.lower() == account.lower() and entry.is_visible():
            LOG.info("automatic relogin phase=selecting_expected_account")
            entry.click(timeout=5000)
            return True
    return False


def encrypt_browser_session(profile_bytes, cookies, cipher):
    """Portable cookie import supplements Chrome's host-specific cookie database encryption."""
    payload = {"schema_version": 2, "profile": base64.b64encode(profile_bytes).decode(),
               "google_cookies": [dict(c, secure=True) for c in cookies if google_cookie(c)]}
    encrypted = cipher.encrypt(json.dumps(payload).encode()).decode()
    if len(encrypted) > MAX_PROFILE_TOKEN:
        raise ValueError("browser session exceeds limits")
    return encrypted


def import_browser_session(vault, data):
    """Owner-private upload: verify before replacing any durable login material."""
    saved = vault.load()
    if (not isinstance(data, dict) or data.get("version") != 1
            or not isinstance(data.get("account"), str)
            or data["account"].lower() != saved["account"].lower()
            or not isinstance(data.get("profile"), str) or len(data["profile"]) > MAX_PROFILE_TOKEN):
        raise ValueError("invalid Google session import")
    google = data.get("google_cookies")
    bundle = data.get("bundle_cookies")
    for cookies, scope in ((google, google_cookie), (bundle, site_cookie)):
        if not isinstance(cookies, list) or not 1 <= len(cookies) <= 100:
            raise ValueError("invalid imported cookies")
        for cookie in cookies:
            if (not isinstance(cookie, dict) or not isinstance(cookie.get("domain"), str) or not scope(cookie)
                    or not isinstance(cookie.get("name"), str) or not cookie["name"]
                    or not isinstance(cookie.get("value"), str) or not cookie["value"]
                    or len(cookie["value"]) > 16384):
                raise ValueError("invalid imported cookie scope")
    try:
        packed = base64.b64decode(data["profile"], validate=True)
        cipher = Fernet(os.environ["GOOGLE_BROWSER_KEY"].encode())
    except Exception:
        raise ValueError("invalid browser session configuration") from None
    with tempfile.TemporaryDirectory(prefix="google-import-check-") as root:
        unpack_profile(packed, root)
    encrypted = encrypt_browser_session(packed, google, cipher)
    candidate = {**saved, "bundle_cookies": [dict(c, secure=True) for c in bundle]}
    vault.save(candidate)
    try:
        # Use the normal HTTP client, with its existing account-match guard.
        BundleFoundry(vault).page(BASE + "/my-bundles")
    except Exception:
        vault.save(saved)
        raise
    current = vault.load()
    current["google_browser_profile_encrypted"] = encrypted
    current["session_recovery"] = {"status": "authorized", "verified_at": time.time(),
                                   "next_attempt_at": 0, "attempts": 0}
    vault.save(current)


def unpack_profile(data, root):
    """Reject unexpected files and oversized archives before extracting anything."""
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        members = archive.getmembers()
        if len(members) > len(PROFILE_FILES) or sum(m.size for m in members) > 4_000_000:
            raise ValueError("browser archive exceeds session limits")
        names = set()
        for member in members:
            if (not member.isfile() or member.name not in {"google-browser/" + p for p in PROFILE_FILES}
                    or member.name in names):
                raise ValueError("browser archive contains an unexpected file")
            names.add(member.name)
        if "google-browser/Local State" not in names or not any(n.endswith("/Cookies") for n in names):
            raise ValueError("browser session files missing")
        archive.extractall(root, filter="data")
    profile = Path(root) / "google-browser"
    for directory in [profile, *[p for p in profile.rglob("*") if p.is_dir()]]:
        directory.chmod(0o700)
    for path in profile.rglob("*"):
        if path.is_file():
            path.chmod(0o600)
    return profile


def prepare_browser_runtime():
    """Provision Chromium on hosts whose existing build command only installs pip deps."""
    explicit = os.getenv("GOOGLE_BROWSER_EXECUTABLE")
    if explicit:
        if not Path(explicit).is_file():
            raise RetryLater("configured browser unavailable")
        return explicit
    with _install_lock:
        dry = subprocess.run([sys.executable, "-m", "playwright", "install", "--dry-run", "chromium", "--only-shell"],
                             capture_output=True, text=True, timeout=15)
        location = re.search(r"Install location:\s+([^\r\n]+)", dry.stdout)
        if dry.returncode or not location:
            raise BrowserRuntimeUnavailable("browser_registry_unavailable")
        directory = Path(location.group(1).strip())
        if not directory.exists():
            try:
                install = subprocess.run([sys.executable, "-m", "playwright", "install", "chromium", "--only-shell"],
                                         capture_output=True, text=True, timeout=90)
                if install.returncode:
                    output = (install.stdout + install.stderr).lower()
                    code = next((name for word, name in [
                        ("certificate", "browser_download_certificate_error"),
                        ("403", "browser_download_rejected"),
                        ("enospc", "browser_download_disk_full"),
                        ("timed out", "browser_download_timeout"),
                        ("timeout", "browser_download_timeout"),
                    ] if word in output), "browser_download_failed")
                    raise BrowserRuntimeUnavailable(code)
            except subprocess.TimeoutExpired:
                raise BrowserRuntimeUnavailable("browser_download_timeout") from None
            except OSError:
                raise BrowserRuntimeUnavailable("browser_download_process_failed") from None
        if not directory.exists():
            raise BrowserRuntimeUnavailable("browser_download_incomplete")
        # Playwright selects the matching headless shell when no executable is overridden.
        return None


def browser_login(account, archive, cipher, *, timeout=65, context_options=None):
    """Return new site cookies and refreshed, independently encrypted Google profile."""
    from playwright.sync_api import sync_playwright
    if not isinstance(archive, str) or len(archive) > MAX_PROFILE_TOKEN:
        raise ValueError("invalid browser profile")
    executable = prepare_browser_runtime()
    LOG.info("automatic relogin phase=restoring_browser_session")
    decrypted = cipher.decrypt(archive.encode())
    imported = []
    if decrypted.startswith(b"{"):
        payload = json.loads(decrypted)
        if payload.get("schema_version") != 2 or not isinstance(payload.get("google_cookies"), list):
            raise ValueError("unsupported browser session")
        imported = payload["google_cookies"]
        if len(imported) > 100 or not all(google_cookie(c) and c.get("secure") is True for c in imported):
            raise ValueError("invalid Google cookie scope")
        decrypted = base64.b64decode(payload["profile"], validate=True)
    with tempfile.TemporaryDirectory(prefix="google-relogin-") as root:
        profile = unpack_profile(decrypted, root)
        cookies = None
        google_cookies = []
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                str(profile), **({"executable_path": executable} if executable else {}), headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--password-store=basic"],
                **(context_options or {}))
            try:
                if imported:
                    context.add_cookies(imported)
                count = sum(google_cookie(c) for c in context.cookies())
                LOG.info("automatic relogin phase=browser_ready google_cookie_count=%s", count)
                # A site session in an old profile must never mask a failed Google login.
                context.clear_cookies(domain=re.compile(r"(^|\.)bundlefoundry\.com$"))
                page = context.new_page()
                page.goto(BASE + "/auth/google/redirect", wait_until="domcontentloaded", timeout=30000)
                deadline = time.monotonic() + timeout
                chosen = False
                last_phase = None
                while time.monotonic() < deadline:
                    host = urlsplit(page.url).hostname
                    path = urlsplit(page.url).path
                    phase = "site_callback" if host == "bundlefoundry.com" else (
                        "google_challenge" if "challenge" in path else "google_signin" if host == "accounts.google.com" else "unexpected_host")
                    if phase != last_phase:
                        LOG.info("automatic relogin phase=%s", phase)
                        last_phase = phase
                    if host == "bundlefoundry.com":
                        node = page.locator("[data-page]").first
                        if node.count():
                            props = json.loads(node.get_attribute("data-page") or "{}").get("props", {})
                            user = (props.get("auth") or {}).get("user") or {}
                            if user.get("email"):
                                if user["email"].lower() != account.lower():
                                    raise AccountMismatch("browser account differs from configured account")
                                cookies = [dict(c, secure=True) for c in context.cookies([BASE]) if site_cookie(c)]
                                if not cookies:
                                    raise InteractiveLoginRequired("site did not issue a session")
                                google_cookies = [c for c in context.cookies() if google_cookie(c)]
                                break
                    elif host == "accounts.google.com":
                        code = google_interaction_error(path, page)
                        if code:
                            raise InteractiveLoginRequired("Google requires owner verification", code)
                        # Only select the already signed-in, expected account. Never enter credentials.
                        if not chosen:
                            chosen = select_google_account(page, account)
                    else:
                        raise InteractiveLoginRequired("login reached an unexpected destination")
                    page.wait_for_timeout(1000)
                if cookies is None:
                    raise InteractiveLoginRequired("Google login needs owner interaction")
            finally:
                context.clear_cookies(domain=re.compile(r"(^|\.)bundlefoundry\.com$"))
                # Persistent context.close waits for the launched Chromium process to exit.
                context.close()
        packed = pack_profile(profile)
        unpack_profile(packed, Path(root) / "archive-check")
        updated = encrypt_browser_session(packed, google_cookies, cipher)
        return cookies, updated


class SessionRecovery:
    def __init__(self, vault, login=None):
        self.vault = vault
        self.login = login or browser_login
        self.attempted = False

    def summary(self):
        state = self.vault.load().get("session_recovery", {})
        return {k: state[k] for k in ("status", "attempted_at", "verified_at", "next_attempt_at", "attempts", "error_code") if k in state}

    def recover(self):
        saved = self.vault.load()
        state = dict(saved.get("session_recovery", {}))
        now = time.time()
        if self.attempted or now < state.get("next_attempt_at", 0):
            raise NeedsLogin("automatic login is cooling down; owner verification may be needed")
        if os.getenv("AUTO_RELOGIN_ENABLED", "false").lower() != "true":
            raise NeedsLogin("automatic Google login is not configured")
        archive = saved.get("google_browser_profile_encrypted") or os.getenv("GOOGLE_BROWSER_PROFILE_ENCRYPTED")
        key = os.getenv("GOOGLE_BROWSER_KEY")
        if not archive or not key:
            raise NeedsLogin("Google browser session is not configured")
        self.attempted = True
        state.update(status="relogging_in", attempted_at=now, attempts=state.get("attempts", 0) + 1,
                     next_attempt_at=now + 900)
        saved["session_recovery"] = state
        self.vault.save(saved)
        try:
            cookies, profile = self.login(saved["account"], archive, Fernet(key.encode()))
            # Verify via the same HTTP client used for claims before replacing durable credentials.
            original = self.vault.load()
            candidate = {**original, "bundle_cookies": cookies}
            self.vault.save(candidate)
            try:
                BundleFoundry(self.vault).page(BASE + "/my-bundles")
            except Exception:
                self.vault.save(original)
                raise
            current = self.vault.load()
            current["google_browser_profile_encrypted"] = profile
            state.update(status="relogged_in", verified_at=time.time(), next_attempt_at=0)
            state.pop("error_code", None)
            current["session_recovery"] = state
            self.vault.save(current)
        except Exception as error:
            current = self.vault.load()
            code = "account_mismatch" if isinstance(error, AccountMismatch) else getattr(error, "code", "browser_login_unavailable")
            manual = isinstance(error, (AccountMismatch, InteractiveLoginRequired))
            LOG.warning("automatic relogin failed code=%s error_class=%s", code, type(error).__name__)
            state.update(status="needs_authorization" if manual else "retrying",
                         error_code=code, next_attempt_at=time.time() + (43200 if manual else 900))
            current["session_recovery"] = state
            self.vault.save(current)
            if isinstance(error, AccountMismatch):
                raise AccountMismatch("Google browser account mismatch; owner verification required") from None
            raise NeedsLogin("automatic login incomplete; check private task status") from None


class RecoveringBundleFoundry(BundleFoundry):
    def __init__(self, vault, recovery=None):
        super().__init__(vault)
        self.recovery = recovery or SessionRecovery(vault)

    def reload_session(self):
        replacement = BundleFoundry(self.vault)
        self.jar, self.opener, self.account = replacement.jar, replacement.opener, replacement.account

    def page(self, url, authenticated=True):
        try:
            return super().page(url, authenticated)
        except AccountMismatch:
            raise
        except NeedsLogin:
            if not authenticated:
                raise
            self.recovery.recover()
            self.reload_session()
            return super().page(url, authenticated)

    def claim(self, url):
        try:
            return super().claim(url)
        except AccountMismatch:
            raise
        except NeedsLogin:
            self.recovery.recover()
            self.reload_session()
            # claim starts by inspecting ownership/pending receipts, so an ambiguous
            # previous checkout is reconciled before any second free POST.
            return super().claim(url)
