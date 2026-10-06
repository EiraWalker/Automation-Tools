"""Read-only Gmail API and authenticated newsletter link extraction."""
import base64
import email.utils
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

from bundlefoundry import NeedsLogin, RetryLater, allowed_link

SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
SENDER = "news@bundlefoundry.com"
QUERY = "from:news@bundlefoundry.com newer_than:7d -in:spam -in:trash"


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.href = None
        self.label = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.href = dict(attrs).get("href")
            self.label = []

    def handle_data(self, text):
        if self.href:
            self.label.append(text)

    def handle_endtag(self, tag):
        if tag == "a" and self.href:
            self.links.append((self.href, " ".join(self.label)))
            self.href = None


def newsletter_links(message):
    payload = message.get("payload", {})
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    if email.utils.parseaddr(headers.get("from", ""))[1].lower() != SENDER:
        return []
    authentication = headers.get("authentication-results", "")
    if not re.search(r"\bdmarc=pass\b[^;]*\bheader\.from=bundlefoundry\.com(?:\s|;|$)", authentication, re.I):
        return []
    subject = headers.get("subject", "")
    if not re.search(r"new bundle|last chance|free|bundle.*(?:drop|release)", subject, re.I):
        return []
    candidates = []

    def visit(part):
        body = part.get("body", {})
        text = body.get("content")
        if text is None and body.get("data"):
            raw = body["data"]
            text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8", "replace")
        if text and part.get("mimeType", part.get("mime_type")) == "text/html":
            parser = Links()
            parser.feed(text)
            candidates.extend(u for u, label in parser.links if re.search(r"view.*bundle|claim.*free|^\s*(?:get|claim).*bundle", label, re.I) or "/bundle/" in u)
        elif text and part.get("mimeType", part.get("mime_type")) == "text/plain":
            candidates.extend(re.findall(r"https://bundlefoundry\.com/bundle/[a-z0-9-]+", text))
            candidates.extend(re.findall(r"(?:View (?:the )?Bundle|Claim for Free)\s*(?:→)?\s*\(\s*(https://[^\s)]+)", text, re.I))
        for child in part.get("parts") or []:
            visit(child)

    visit(payload)
    return list(dict.fromkeys(u for u in candidates if allowed_link(html.unescape(u))))[:12]


class Gmail:
    def __init__(self, vault):
        self.vault = vault
        self.token = None
        self.expires = 0

    def access_token(self):
        if self.token and self.expires > time.time() + 60:
            return self.token
        credentials = self.vault.load().get("gmail", {})
        if not all(credentials.get(k) for k in ("client_id", "client_secret", "refresh_token")):
            raise NeedsLogin("Gmail read-only OAuth setup required")
        body = urllib.parse.urlencode({**{k: credentials[k] for k in (
            "client_id", "client_secret", "refresh_token")}, "grant_type": "refresh_token"}).encode()
        req = urllib.request.Request("https://oauth2.googleapis.com/token", body)
        result = self.fetch(req, authenticating=True)
        self.token = result["access_token"]
        self.expires = time.time() + int(result.get("expires_in", 3600))
        return self.token

    @staticmethod
    def fetch(req, authenticating=False):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403):
                raise NeedsLogin("Gmail OAuth authorization or permissions need renewal") from None
            raise RetryLater("Gmail API unavailable") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise RetryLater("Gmail network request failed") from None

    def get(self, endpoint, params=None):
        url = "https://gmail.googleapis.com/gmail/v1/users/me/" + endpoint
        if params:
            url += "?" + urllib.parse.urlencode(params)
        return self.fetch(urllib.request.Request(url, headers={"Authorization": "Bearer " + self.access_token()}))

    def messages(self):
        expected = self.vault.load().get("account", "")
        actual = self.get("profile").get("emailAddress", "")
        if not expected or actual.lower() != expected.lower():
            raise NeedsLogin("Gmail account does not match configured account")
        page = None
        while True:
            params = {"q": QUERY, "maxResults": 100}
            if page:
                params["pageToken"] = page
            result = self.get("messages", params)
            yield from result.get("messages", [])
            page = result.get("nextPageToken")
            if not page:
                break

    def message(self, message_id):
        if not re.fullmatch(r"[a-f0-9]+", message_id):
            raise ValueError("invalid Gmail message ID")
        return self.get("messages/" + message_id, {"format": "full"})
