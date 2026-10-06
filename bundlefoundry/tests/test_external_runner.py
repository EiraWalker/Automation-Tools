import copy
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from aiohttp.test_utils import TestClient, TestServer
from bundlefoundry import BundleFoundry, Response
from external_runner import run_external
from server import Status, application
from test_automation import COOKIE, PROPS, URL, message, page_response
from vault import Vault


class ExternalRunnerTests(unittest.TestCase):
    def test_encrypted_checkpoint_preserves_renewed_credentials_and_deduplicates_after_restart(self):
        with tempfile.TemporaryDirectory() as root:
            v = Vault(root)
            v.save({"account": "owner@example.com", "bundle_cookies": [COOKIE]})
            env = {"CREDENTIAL_KEY": (v.directory / "credential.key").read_text(),
                   "CREDENTIALS_ENCRYPTED": v.path.read_text()}
            owned = copy.deepcopy(PROPS)
            owned["owned_license_types"] = ["personal"]
            batch = {"source_account": "owner@example.com", "messages": [message(f'<a href="{URL}">View Bundle</a>')]}
            with patch.dict(os.environ, env), patch.object(BundleFoundry, "request", side_effect=[page_response(PROPS), page_response(PROPS), Response(200, {}, b'{}'), page_response(owned)]):
                result = run_external(batch, v)
            self.assertTrue(result["project_acceptance_complete"])
            self.assertEqual(result["acceptance"]["email_id"], "abc123")
            state = json.loads(v.cipher.decrypt(result["checkpoint_encrypted"].encode()))
            state["credentials"]["bundle_cookies"][0]["value"] = "renewed-secret"
            checkpoint = v.cipher.encrypt(json.dumps(state).encode()).decode()
            self.assertNotIn("renewed-secret", checkpoint)
            with patch.dict(os.environ, env), patch.object(BundleFoundry, "page", return_value=owned), patch.object(BundleFoundry, "claim") as claim:
                resumed = run_external({**batch, "checkpoint_encrypted": checkpoint}, v)
            claim.assert_not_called()
            latest = json.loads(v.cipher.decrypt(resumed["checkpoint_encrypted"].encode()))
            self.assertEqual(latest["credentials"]["bundle_cookies"][0]["value"], "renewed-secret")
            self.assertEqual(latest["queue"]["acceptance"], state["queue"]["acceptance"])

    def test_wrong_source_account_is_rejected_before_any_site_call(self):
        with tempfile.TemporaryDirectory() as root:
            v = Vault(root)
            v.save({"account": "owner@example.com"})
            with patch.object(BundleFoundry, "request") as request:
                with self.assertRaises(ValueError):
                    run_external({"source_account": "other@example.com", "messages": []}, v)
                request.assert_not_called()


class ServiceAuthenticationTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_or_forged_identity_cannot_call_cloud_runner(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"AUTOMATION_SERVICE_TOKEN": "a" * 48}):
            client = TestClient(TestServer(application(Status(), Vault(root))))
            await client.start_server()
            try:
                with patch("server.run_external") as run:
                    response = await client.post("/internal/run", json={}, headers={"oai-authenticated-user-email": "owner@example.com"})
                    self.assertEqual(response.status, 401)
                    run.assert_not_called()
                    run.return_value = {"project_acceptance_complete": False, "checkpoint_encrypted": "synthetic"}
                    response = await client.post("/internal/run", json={}, headers={"Authorization": "Bearer " + "a" * 48})
                    self.assertEqual(response.status, 200)
                    run.assert_called_once()
            finally:
                await client.close()
