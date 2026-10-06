import copy
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from cryptography.fernet import Fernet

from bundlefoundry import BASE, AccountMismatch, BundleFoundry, NeedsLogin, Response, RetryLater
from external_runner import run_external
from session_recovery import InteractiveLoginRequired, RecoveringBundleFoundry, SessionRecovery, pack_profile, unpack_profile
from test_automation import COOKIE, PROPS, URL, page_response
from vault import Vault


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.vault = Vault(self.temp.name)
        self.vault.save({"account": "owner@example.com", "bundle_cookies": [COOKIE]})
        self.key = Fernet.generate_key().decode()
        env = patch.dict(os.environ, {"AUTO_RELOGIN_ENABLED": "true", "GOOGLE_BROWSER_KEY": self.key,
                                    "GOOGLE_BROWSER_PROFILE_ENCRYPTED": "encrypted-browser-bootstrap"})
        env.start()
        self.addCleanup(env.stop)

    def test_valid_site_session_never_opens_google_browser(self):
        login = Mock()
        site = RecoveringBundleFoundry(self.vault, SessionRecovery(self.vault, login))
        with patch.object(BundleFoundry, "request", return_value=page_response(PROPS)):
            self.assertEqual(site.page(URL), PROPS)
        login.assert_not_called()

    def test_expired_session_recovers_and_saves_independent_profile(self):
        cookie = {**COOKIE, "value": "fresh-cookie"}
        profile = Fernet(self.key.encode()).encrypt(b"updated browser session").decode()
        login = Mock(return_value=([cookie], profile))
        site = RecoveringBundleFoundry(self.vault, SessionRecovery(self.vault, login))
        with patch.object(BundleFoundry, "request", side_effect=[Response(302, {}, b""), page_response(PROPS), page_response(PROPS)]):
            self.assertEqual(site.page(URL), PROPS)
        login.assert_called_once()
        saved = self.vault.load()
        self.assertEqual(saved["bundle_cookies"], [cookie])
        self.assertEqual(saved["google_browser_profile_encrypted"], profile)
        self.assertEqual(saved["session_recovery"]["status"], "relogged_in")
        self.assertNotIn("fresh-cookie", self.vault.path.read_text())
        self.assertNotIn("encrypted-browser-bootstrap", json.dumps(site.recovery.summary()))

    def test_wrong_site_account_never_triggers_relogin(self):
        props = copy.deepcopy(PROPS)
        props["auth"]["user"]["email"] = "other@example.com"
        login = Mock()
        site = RecoveringBundleFoundry(self.vault, SessionRecovery(self.vault, login))
        with patch.object(BundleFoundry, "request", return_value=page_response(props)):
            with self.assertRaises(AccountMismatch):
                site.page(URL)
        login.assert_not_called()

    def test_network_failure_never_triggers_relogin(self):
        login = Mock()
        site = RecoveringBundleFoundry(self.vault, SessionRecovery(self.vault, login))
        with patch.object(BundleFoundry, "request", side_effect=RetryLater("network unavailable")):
            with self.assertRaises(RetryLater):
                site.page(URL)
        login.assert_not_called()

    def test_google_challenge_preserves_credentials_and_cooldown_across_restart(self):
        login = Mock(side_effect=InteractiveLoginRequired("owner verification required"))
        with self.assertRaises(NeedsLogin):
            SessionRecovery(self.vault, login).recover()
        first = self.vault.load()
        self.assertEqual(first["bundle_cookies"], [COOKIE])
        self.assertEqual(first["session_recovery"]["status"], "needs_authorization")
        restarted = Vault(self.temp.name)
        with self.assertRaises(NeedsLogin):
            SessionRecovery(restarted, login).recover()
        login.assert_called_once()

    def test_candidate_cookie_is_not_saved_if_http_verification_fails(self):
        login = Mock(return_value=([{**COOKIE, "value": "wrong-session"}], "updated-profile"))
        with patch.object(BundleFoundry, "request", return_value=Response(302, {}, b"")):
            with self.assertRaises(NeedsLogin):
                SessionRecovery(self.vault, login).recover()
        self.assertEqual(self.vault.load()["bundle_cookies"], [COOKIE])
        self.assertNotIn("google_browser_profile_encrypted", self.vault.load())

    def test_no_second_checkout_if_ownership_appears_during_relogin(self):
        login = Mock(return_value=([COOKIE], "updated-profile"))
        site = RecoveringBundleFoundry(self.vault, SessionRecovery(self.vault, login))
        purchase = {"bundle_id": PROPS["bundle"]["id"], "tier": 0, "amount": "0.00", "license": "personal"}
        with patch.object(BundleFoundry, "purchase", side_effect=[None, purchase]), patch.object(
                BundleFoundry, "request", side_effect=[page_response(PROPS), Response(401, {}, b""),
                                                       page_response(PROPS), page_response(PROPS)]) as request:
            self.assertEqual(site.claim(URL), "already_owned")
        posts = [c for c in request.call_args_list if c.kwargs.get("payload") is not None]
        self.assertEqual(len(posts), 1)

    def test_failed_recovery_checkpoint_preserves_cooldown(self):
        env = {"CREDENTIAL_KEY": (self.vault.directory / "credential.key").read_text(),
               "CREDENTIALS_ENCRYPTED": self.vault.path.read_text()}
        login = Mock(side_effect=InteractiveLoginRequired("Google requires owner"))
        batch = {"source_account": "owner@example.com", "messages": []}
        with patch.dict(os.environ, env), patch("session_recovery.browser_login", login), patch.object(
                BundleFoundry, "request", return_value=Response(302, {}, b"")):
            result = run_external(batch, self.vault)
            self.assertEqual(result["automation_state"], "needs_authorization")
            self.assertEqual(result["session_recovery"]["error_code"], "owner_verification_required")
            run_external({**batch, "checkpoint_encrypted": result["checkpoint_encrypted"]}, self.vault)
        login.assert_called_once()

    def test_forced_session_test_requires_explicit_configuration(self):
        with patch.dict(os.environ, {"SESSION_RECOVERY_TEST_ENABLED": "false"}):
            with self.assertRaises(ValueError):
                run_external({"source_account": "owner@example.com", "messages": [],
                              "session_recovery_test": True}, self.vault)


class ProfileArchiveTests(unittest.TestCase):
    def test_only_session_files_are_archived_and_restored_privately(self):
        with tempfile.TemporaryDirectory() as root:
            profile = Path(root) / "profile"
            (profile / "Default/Cache").mkdir(parents=True)
            (profile / "Local State").write_text("{}")
            (profile / "Default/Cookies").write_bytes(b"session database")
            (profile / "Default/Cache/public").write_text("cache")
            (profile / "Default/History").write_text("history")
            restored = unpack_profile(pack_profile(profile), Path(root) / "restored")
            self.assertEqual((restored / "Default/Cookies").read_bytes(), b"session database")
            self.assertFalse((restored / "Default/History").exists())
            self.assertEqual((restored / "Default/Cookies").stat().st_mode & 0o777, 0o600)

    def test_unexpected_paths_and_links_are_rejected(self):
        for name, kind in [("../escape", tarfile.REGTYPE), ("google-browser/Default/Cookies", tarfile.SYMTYPE)]:
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode="w:gz") as archive:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = "/etc/passwd"
                archive.addfile(member)
            with tempfile.TemporaryDirectory() as root, self.assertRaises(ValueError):
                unpack_profile(data.getvalue(), root)
