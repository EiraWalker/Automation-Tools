import time
import unittest
from unittest.mock import patch

from aiohttp.test_utils import TestClient, TestServer
from server import Status, application


class PublicServiceAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_tokens_and_forged_identity_cannot_reopen_browser(self):
        with patch.dict("os.environ", {
            "LOGIN_ACCESS_TOKEN": "obsolete-viewer",
            "LOGIN_AGENT_TOKEN": "obsolete-agent",
            "LOGIN_SESSION_EXPIRES_AT": str(time.time() + 3600),
        }):
            client = TestClient(TestServer(application(Status())))
            await client.start_server()
            try:
                headers = {
                    "Authorization": "Bearer obsolete-agent",
                    "Cookie": "login_access=obsolete-viewer",
                    "oai-authenticated-user-email": "owner@example.com",
                }
                for path in ("/login", "/desktop", "/novnc/vnc.html", "/api/status",
                             "/websockify", "/internal/login-agent"):
                    response = await client.get(path, headers=headers)
                    self.assertEqual(response.status, 404)
                response = await client.post("/api/finish", json={}, headers=headers)
                self.assertEqual(response.status, 404)
                response = await client.get("/health")
                self.assertEqual(response.status, 200)
                self.assertTrue((await response.json())["service_live"])
            finally:
                await client.close()
