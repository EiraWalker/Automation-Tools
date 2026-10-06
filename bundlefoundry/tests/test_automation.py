import base64
import copy
import html
import json
import io
import time
import tempfile
import threading
import unittest
import urllib.request
from email.message import Message
from urllib.response import addinfourl
from unittest.mock import Mock, patch

from bundlefoundry import BASE, BundleFoundry, NeedsLogin, Response, RetryLater, allowed_link, site_cookie
from gmail import Gmail, newsletter_links
import setup_auth
from vault import Vault
from worker import Queue, run

URL = BASE + "/bundle/example-bundle"
TRACKED = "https://mlwgg.r.sp1-brevo.net/mk/cl/f/example"
COOKIE = {"name": "XSRF-TOKEN", "value": "example%3D", "domain": "bundlefoundry.com", "secure": True, "path": "/", "expires": -1}
PROPS = {"auth": {"user": {"email": "owner@example.com"}}, "owned_license_types": [], "owned_tier_number": 0,
    "bundle": {"id": 30, "title": "Example", "status": "active", "has_free_tier": True,
        "free_tier_available": True, "free_tier_remaining": 961, "free_tier_paid_price": 2}}


def page_response(props):
    body = '<div data-page="' + html.escape(json.dumps({"props": props}), quote=True) + '"></div>'
    return Response(200, {}, body.encode())


def message(body=None, subject="New Bundle: Example", sender="BundleFoundry <news@bundlefoundry.com>"):
    text = body or '<a href="' + TRACKED + '">View the Bundle</a><a href="https://mlwgg.r.sp1-brevo.net/mk/un/x">Unsubscribe</a>'
    return {"id": "abc123", "payload": {"headers": [{"name": "From", "value": sender},
        {"name": "Subject", "value": subject}, {"name": "Authentication-Results", "value": "mx.google.com; dkim=pass; dmarc=pass (p=QUARANTINE) header.from=bundlefoundry.com"}],
        "mimeType": "text/html", "body": {"data": base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")}}}


class SiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.vault = Vault(self.temp.name)
        self.vault.save({"account": "owner@example.com", "bundle_cookies": [COOKIE]})
        self.site = BundleFoundry(self.vault)
        # These existing tests exercise licensed detail-page responses. The
        # separate PurchaseTests cover the authoritative free purchase endpoint.
        owned = patch.object(self.site, "purchase", return_value=None)
        owned.start()
        self.addCleanup(owned.stop)

    def test_free_claim_uses_only_free_endpoint_and_confirms_ownership(self):
        owned = copy.deepcopy(PROPS)
        owned["owned_license_types"] = ["personal"]
        with patch.object(self.site, "request", side_effect=[page_response(PROPS), Response(200, {}, b'{"skipped":[]}'), page_response(owned)]) as request:
            self.assertEqual(self.site.claim(URL), "claimed")
            calls = request.call_args_list
            self.assertEqual(len(calls), 3)
            self.assertEqual(calls[1].args, (BASE + "/checkout/claim-free",))
            self.assertEqual(calls[1].kwargs["payload"]["items"][0]["tier_number"], 0)
            self.assertNotIn("price", calls[1].kwargs["payload"]["items"][0])
            self.assertEqual(calls[1].kwargs["headers"]["X-XSRF-TOKEN"], "example=")

    def test_sold_out_with_paid_fallback_never_posts(self):
        for remaining, available in [(0, True), (0, False), (100, False), (-1, True)]:
            p = copy.deepcopy(PROPS)
            p["bundle"].update(free_tier_remaining=remaining, free_tier_available=available)
            with patch.object(self.site, "request", return_value=page_response(p)) as request:
                self.assertEqual(self.site.claim(URL), "sold_out")
                request.assert_called_once_with(URL)

    def test_already_owned_free_tier_zero_never_posts(self):
        p = copy.deepcopy(PROPS)
        p["owned_license_types"] = ["personal"]
        with patch.object(self.site, "request", return_value=page_response(p)) as request:
            self.assertEqual(self.site.claim(URL), "already_owned")
            request.assert_called_once_with(URL)

    def test_login_or_wrong_account_blocks_mutation(self):
        for user in [None, {"email": "another@example.com"}]:
            p = copy.deepcopy(PROPS)
            p["auth"]["user"] = user
            with patch.object(self.site, "request", return_value=page_response(p)) as request:
                with self.assertRaises(NeedsLogin):
                    self.site.claim(URL)
                request.assert_called_once_with(URL)

    def test_http_200_without_owned_status_is_not_success(self):
        with patch.object(self.site, "request", side_effect=[page_response(PROPS), Response(200, {}, b'{}'), page_response(PROPS)]):
            with self.assertRaises(RetryLater):
                self.site.claim(URL)

    def test_ownership_of_different_bundle_is_not_confirmation(self):
        other = copy.deepcopy(PROPS)
        other["bundle"]["id"] = 99
        other["owned_license_types"] = ["personal"]
        with patch.object(self.site, "request", side_effect=[page_response(PROPS), Response(200, {}, b'{}'), page_response(other)]):
            with self.assertRaises(RetryLater):
                self.site.claim(URL)
        self.assertIsNone(self.site.claim_receipt)

    def test_skipped_http_200_is_not_success(self):
        with patch.object(self.site, "request", side_effect=[page_response(PROPS), Response(200, {}, b'{"skipped":[{"name":"Example"}]}'), page_response(PROPS)]):
            with self.assertRaises(RetryLater):
                self.site.claim(URL)

    def test_site_client_refuses_paid_mutation(self):
        with self.assertRaises(ValueError):
            self.site.request(BASE + "/checkout/create-transaction", payload={})

    def test_tracker_redirect_cannot_escape_allowlist(self):
        with patch.object(self.site, "request", return_value=Response(302, {"Location": "https://evil.example/bundle/steal"}, b"")) as request:
            with self.assertRaises(ValueError):
                self.site.resolve(TRACKED)
            request.assert_called_once_with(TRACKED)

    def test_tracker_html_refresh_resolves_without_executing_scripts(self):
        body = f'<noscript><meta http-equiv="refresh" content="0.0;{URL}"></noscript><script>throw Error()</script>'.encode()
        with patch.object(self.site, "request", return_value=Response(200, {}, body)):
            self.assertEqual(self.site.resolve(TRACKED), URL)

    def test_html_refresh_rejects_untrusted_or_ambiguous_destinations(self):
        for body in ('<meta http-equiv="refresh" content="0;url=https://evil.example/">',
                     f'<meta http-equiv="refresh" content="0;{URL}"><meta http-equiv="refresh" content="0;{BASE}/bundle/other">'):
            with patch.object(self.site, "request", return_value=Response(200, {}, body.encode())):
                with self.assertRaises(RetryLater):
                    self.site.resolve(TRACKED)


class MailTests(unittest.TestCase):
    def test_authenticated_notification_extracts_bundle_not_unsubscribe(self):
        self.assertEqual(newsletter_links(message()), [TRACKED])

    def test_connector_body_format_and_deduplication(self):
        m = message()
        m["payload"]["body"] = {"content": '<a href="' + URL + '">View Bundle</a><a href="' + URL + '">View Bundle</a>'}
        m["payload"]["mime_type"] = m["payload"].pop("mimeType")
        self.assertEqual(newsletter_links(m), [URL])

    def test_spoofed_sender_or_failed_auth_is_ignored(self):
        self.assertEqual(newsletter_links(message(sender="BundleFoundry <news@evil.example>")), [])
        m = message()
        m["payload"]["headers"][-1]["value"] = "dmarc=fail header.from=bundlefoundry.com"
        self.assertEqual(newsletter_links(m), [])

    def test_receipts_not_triggered(self):
        self.assertEqual(newsletter_links(message(subject="Your Purchase is Confirmed!")), [])

    def test_untrusted_links_are_filtered(self):
        self.assertEqual(newsletter_links(message('<a href="https://evil.example/bundle/example">View Bundle</a>')), [])
        for u in ["http://bundlefoundry.com/bundle/a", "https://bundlefoundry.com.evil.example/bundle/a", "https://bundlefoundry.com:444/bundle/a", "https://bundlefoundry.com/logout", "https://mlwgg.r.sp1-brevo.net/mk/un/a"]:
            self.assertFalse(allowed_link(u))


class PersistenceTests(unittest.TestCase):
    def test_server_rotated_cookie_and_real_expiry_survive_restart(self):
        seen = []

        class Upstream(urllib.request.HTTPSHandler):
            def https_open(self, req):
                seen.append(req.get_header("Cookie"))
                headers = Message()
                headers["Set-Cookie"] = "bundlefoundry-session=rotated; Path=/; Secure; HttpOnly; Max-Age=604800"
                response = addinfourl(io.BytesIO(b'{}'), headers, req.full_url, 200)
                response.msg = "OK"
                return response

        with tempfile.TemporaryDirectory() as root:
            vault = Vault(root)
            vault.save({"account": "owner@example.com", "bundle_cookies": [COOKIE]})
            site = BundleFoundry(vault)
            site.opener = urllib.request.build_opener(Upstream(), urllib.request.HTTPCookieProcessor(site.jar))
            site.request(BASE + "/my-bundles")
            rotated = next(c for c in vault.load()["bundle_cookies"] if c["name"] == "bundlefoundry-session")
            self.assertEqual(rotated["value"], "rotated")
            self.assertAlmostEqual(rotated["expires"] - time.time(), 604800, delta=3)
            resumed = BundleFoundry(Vault(root))
            resumed.opener = urllib.request.build_opener(Upstream(), urllib.request.HTTPCookieProcessor(resumed.jar))
            resumed.request(BASE + "/my-bundles")
            self.assertIn("bundlefoundry-session=rotated", seen[-1])

    def test_rotated_google_refresh_token_is_saved(self):
        with tempfile.TemporaryDirectory() as root:
            vault = Vault(root)
            vault.save({"gmail": {"client_id": "client", "client_secret": "secret", "refresh_token": "old"}})
            with patch.object(Gmail, "fetch", return_value={"access_token": "access", "refresh_token": "replacement", "expires_in": 3600}):
                self.assertEqual(Gmail(vault).access_token(), "access")
            self.assertEqual(Vault(root).load()["gmail"]["refresh_token"], "replacement")

    def test_setup_reuses_valid_credentials_without_browser_or_consent(self):
        with tempfile.TemporaryDirectory() as root:
            vault = Vault(root)
            vault.save({"account": "owner@example.com", "gmail": {"refresh_token": "existing"}, "bundle_cookies": [COOKIE]})
            with patch("sys.argv", ["setup_auth.py", "--state", root]), patch("setup_auth.Gmail") as gmail, patch("setup_auth.BundleFoundry"), patch("setup_auth.authorize_gmail") as consent, patch("setup_auth.capture_bundle_session") as browser, patch("builtins.print"):
                gmail.return_value.get.return_value = {"emailAddress": "owner@example.com"}
                setup_auth.main()
                consent.assert_not_called()
                browser.assert_not_called()

    def test_twice_daily_mail_checks_preserve_site_keep_alive(self):
        elapsed = [0]

        class ClockStop:
            def is_set(self):
                return elapsed[0] > 43200

            def wait(self, seconds):
                elapsed[0] += seconds

        with tempfile.TemporaryDirectory() as root:
            vault = Vault(root)
            with patch("worker.Gmail") as gmail, patch("worker.BundleFoundry") as site, patch("worker.time.monotonic", side_effect=lambda: elapsed[0]), patch.dict("os.environ", {"POLL_SECONDS": "43200"}):
                gmail.return_value.messages.return_value = []
                run(vault, ClockStop())
                self.assertEqual(gmail.return_value.messages.call_count, 2)
                self.assertGreater(site.return_value.page.call_count, 2)

    def test_changed_bootstrap_replaces_old_session_without_overwriting_rotated_cookies(self):
        with tempfile.TemporaryDirectory() as root:
            v = Vault(root)
            first = v.cipher.encrypt(json.dumps({"cookie": "initial"}).encode()).decode()
            second = v.cipher.encrypt(json.dumps({"cookie": "renewed"}).encode()).decode()
            with patch.dict("os.environ", {"CREDENTIALS_ENCRYPTED": first}):
                self.assertEqual(v.load(), {"cookie": "initial"})
                v.save({"cookie": "rotated"})
                self.assertEqual(v.load(), {"cookie": "rotated"})
            with patch.dict("os.environ", {"CREDENTIALS_ENCRYPTED": second}):
                self.assertEqual(v.load(), {"cookie": "renewed"})

    def test_vault_encrypts_and_excludes_google_cookies(self):
        with tempfile.TemporaryDirectory() as root:
            v = Vault(root)
            v.save({"refresh_token": "top-secret"})
            self.assertNotIn(b"top-secret", v.path.read_bytes())
            self.assertEqual(v.load()["refresh_token"], "top-secret")
            self.assertEqual(v.path.stat().st_mode & 0o777, 0o600)
        self.assertFalse(site_cookie({"domain": ".google.com", "secure": True}))
        self.assertTrue(site_cookie(COOKIE))

    def test_queue_survives_restart_and_deduplicates_claims(self):
        with tempfile.TemporaryDirectory() as root:
            q = Queue(root)
            q.add(message('<a href="' + URL + '">View Bundle</a>'))
            q.add(message('<a href="' + URL + '">View Bundle</a>'))
            q.db.close()
            q = Queue(root)
            self.addCleanup(q.db.close)
            site = Mock()
            site.resolve.return_value = URL
            site.claim.return_value = "claimed"
            q.process(site)
            q.process(site)
            site.claim.assert_called_once_with(URL)
            self.assertEqual(q.db.execute("SELECT done FROM messages").fetchone()[0], 1)

    def test_failed_claim_remains_queued(self):
        with tempfile.TemporaryDirectory() as root:
            q = Queue(root)
            self.addCleanup(q.db.close)
            q.add(message('<a href="' + URL + '">View Bundle</a>'))
            site = Mock()
            site.resolve.return_value = URL
            site.claim.side_effect = NeedsLogin("session expired")
            q.process(site)
            self.assertEqual(q.db.execute("SELECT done,attempts FROM messages").fetchone(), (0, 1))
            self.assertEqual(q.db.execute("SELECT COUNT(*) FROM results").fetchone()[0], 0)


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        owned = patch.object(BundleFoundry, "purchase", return_value=None)
        owned.start()
        self.addCleanup(owned.stop)

    def test_live_email_new_claim_records_durable_correlated_evidence(self):
        owned = copy.deepcopy(PROPS)
        owned["owned_license_types"] = ["personal"]
        with tempfile.TemporaryDirectory() as root:
            vault = Vault(root)
            vault.save({"account": "owner@example.com", "bundle_cookies": [COOKIE]})
            with patch("worker.Gmail") as gmail, patch.object(BundleFoundry, "request", side_effect=[page_response(PROPS), Response(200, {}, b'{}'), page_response(owned), page_response(owned)]):
                gmail.return_value.messages.return_value = [{"id": "abc123"}]
                gmail.return_value.message.return_value = message('<a href="' + URL + '">View Bundle</a>')
                run(vault, threading.Event(), once=True)
            queue = Queue(root)
            self.addCleanup(queue.db.close)
            evidence = queue.acceptance()
            self.assertEqual(evidence["email_id"], "abc123")
            self.assertEqual(evidence["email_source"], "gmail_api")
            self.assertEqual(evidence["bundle_id"], 30)
            self.assertEqual(evidence["owned_license_types"], ["personal"])
            self.assertEqual(evidence["tier_number"], 0)
            self.assertGreaterEqual(evidence["ownership_verified_at"], evidence["claimed_at"])
            self.assertNotIn("owner@example.com", json.dumps(evidence))

    def test_seeded_mail_and_already_owned_do_not_pass_acceptance(self):
        for source, owned_before in [("seed", False), ("live_gmail", True)]:
            with self.subTest(source=source), tempfile.TemporaryDirectory() as root:
                vault = Vault(root)
                vault.save({"account": "owner@example.com", "bundle_cookies": [COOKIE]})
                before = copy.deepcopy(PROPS)
                after = copy.deepcopy(PROPS)
                after["owned_license_types"] = ["personal"]
                if owned_before:
                    before = after
                responses = [page_response(before)] if owned_before else [page_response(before), Response(200, {}, b'{}'), page_response(after)]
                queue = Queue(root)
                queue.add(message('<a href="' + URL + '">View Bundle</a>'), source=source)
                with patch.object(BundleFoundry, "request", side_effect=responses):
                    queue.process(BundleFoundry(vault))
                self.assertIsNone(queue.acceptance())
                queue.db.close()

    def test_e2e_command_does_not_succeed_without_evidence(self):
        from worker import main
        with tempfile.TemporaryDirectory() as root:
            vault = Vault(root)
            vault.save({"account": "owner@example.com", "gmail": {"refresh_token": "existing"}, "bundle_cookies": [COOKIE]})
            with patch("sys.argv", ["worker.py", "--state", root, "--verify-e2e"]), patch("worker.run"), patch("builtins.print"), self.assertRaises(SystemExit) as exit:
                main()
            self.assertEqual(exit.exception.code, 3)


if __name__ == "__main__":
    unittest.main()
