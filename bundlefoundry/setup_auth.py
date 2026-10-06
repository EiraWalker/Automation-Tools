"""Run on the account owner's computer; never send Google passwords to the worker."""
import argparse
import base64
import hashlib
import http.server
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import webbrowser

from bundlefoundry import BASE, BundleFoundry, parse_page, site_cookie
from gmail import Gmail, SCOPE
from vault import Vault


def authorize_gmail(client_file):
    client = json.loads(client_file.read_text()).get("installed")
    if not client:
        raise ValueError("Use an OAuth client JSON for a Desktop app from your own Google Cloud project")
    result = {}
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")

    class Callback(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            parameters = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            if parameters.get("state") != [state] or not parameters.get("code"):
                self.send_error(400, "OAuth response invalid or denied")
                return
            result["code"] = parameters["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("Gmail authorized. Return to the terminal.\n".encode())

        def log_message(self, *_):
            pass  # OAuth codes must not appear in request logs.

    server = http.server.HTTPServer(("127.0.0.1", 0), Callback)
    server.timeout = 1
    redirect_uri = "http://127.0.0.1:" + str(server.server_port) + "/"
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": client["client_id"], "redirect_uri": redirect_uri,
        "response_type": "code", "scope": SCOPE, "access_type": "offline", "prompt": "consent",
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})
    print("Opening Google for Gmail read-only authorization. Select the same account used by BundleFoundry.")
    webbrowser.open(url)
    deadline = time.monotonic() + 600
    try:
        while not result and time.monotonic() < deadline:
            server.handle_request()
    finally:
        server.server_close()
    if not result:
        raise TimeoutError("Gmail OAuth not completed within 10 minutes")
    body = urllib.parse.urlencode({"grant_type": "authorization_code", "code": result["code"],
        "client_id": client["client_id"], "client_secret": client["client_secret"],
        "redirect_uri": redirect_uri, "code_verifier": verifier}).encode()
    with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", body), timeout=30) as response:
        tokens = json.load(response)
    if not tokens.get("refresh_token"):
        raise ValueError("Google did not issue a refresh token; authorize offline access again")
    return {k: client[k] for k in ("client_id", "client_secret")} | {"refresh_token": tokens["refresh_token"], "scope": SCOPE}


def chrome_path(explicit):
    if explicit:
        return explicit
    paths = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        str(Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe"),
        str(Path(os.environ.get("LOCALAPPDATA", "C:/Users/Default/AppData/Local")) / "Google/Chrome/Application/chrome.exe")]
    for p in paths:
        found = shutil.which(p)
        if found:
            return found
    raise FileNotFoundError("Install Chrome or specify --chrome /path/to/chrome")


def capture_bundle_session(vault, chrome):
    from playwright.sync_api import sync_playwright
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    profile = vault.directory / "google-browser"
    process = subprocess.Popen([chrome, "--user-data-dir=" + str(profile.resolve()),
        "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=" + str(port),
        "--no-first-run", BASE + "/login"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as playwright:
            browser = None
            for _ in range(60):
                try:
                    browser = playwright.chromium.connect_over_cdp("http://127.0.0.1:" + str(port))
                    break
                except Exception:
                    time.sleep(1)
            if not browser:
                raise RuntimeError("Could not connect to the dedicated Chrome window")
            print("In the new Chrome window, use 'Continue with Google' to sign in to BundleFoundry.")
            print("Complete any two-factor authentication yourself, then open My Bundles.")
            input("Press Enter here after the login has completed: ")
            context = browser.contexts[0]
            response = context.request.get(BASE + "/my-bundles", timeout=30000)
            props = parse_page(response.body())
            user = props.get("auth", {}).get("user") or {}
            expected = vault.load()["account"]
            if user.get("email", "").lower() != expected.lower():
                raise ValueError("BundleFoundry login missing or account differs from authorized Gmail")
            # Google domain cookies are deliberately excluded from the cloud export.
            cookies = [dict(c, secure=True) for c in context.cookies([BASE]) if site_cookie(c)]
            if not cookies:
                raise ValueError("No BundleFoundry HTTPS cookies found")
            saved = vault.load()
            saved["bundle_cookies"] = cookies
            vault.save(saved)
            browser.close()
    finally:
        if process.poll() is None:
            process.terminate()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--client-secret", type=Path, help="Google Cloud Desktop OAuth client JSON")
    parser.add_argument("--state", default="state")
    parser.add_argument("--chrome")
    parser.add_argument("--bundle-only", action="store_true", help="renew a site session while keeping Gmail OAuth")
    args = parser.parse_args()
    vault = Vault(args.state)
    saved = vault.load()
    if not args.bundle_only:
        if not args.client_secret:
            parser.error("--client-secret is required for first setup")
        saved["gmail"] = authorize_gmail(args.client_secret)
        vault.save(saved)
        saved["account"] = Gmail(vault).get("profile")["emailAddress"]
        vault.save(saved)
    if not saved.get("account"):
        parser.error("complete Gmail setup first")
    capture_bundle_session(vault, chrome_path(args.chrome))
    BundleFoundry(vault).page(BASE + "/my-bundles")
    key = os.environ.get("CREDENTIAL_KEY")
    if not key:
        key = (vault.directory / "credential.key").read_text()
    export = vault.directory / ".env.render"
    export.write_text("CREDENTIAL_KEY=" + key + "\nCREDENTIALS_ENCRYPTED=" + vault.path.read_text() + "\n")
    export.chmod(0o600)
    print("Verified Gmail and BundleFoundry. Encrypted credentials saved; secrets were not printed.")
    print("For Render, import the two variables from " + str(export) + " into the worker's Environment settings.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("Setup cancelled; no worker was started.")
