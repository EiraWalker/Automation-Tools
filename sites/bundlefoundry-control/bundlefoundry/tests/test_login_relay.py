import asyncio
import base64
import tempfile
import time
import unittest
import io
import tarfile
from pathlib import Path
from unittest.mock import patch, AsyncMock

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from login_environment import Gateway
from login_relay import LoginRelay
from vault import Vault


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.gate = Gateway(Vault(self.temp.name), self.temp.name + "/access", "owner@example.com", self.temp.name)
        self.client = TestClient(TestServer(self.gate.app()))
        await self.client.start_server()
        self.origin = "http://" + self.client.host + ":" + str(self.client.port)

    async def asyncTearDown(self):
        await self.client.close()
        self.temp.cleanup()

    async def test_unauthorized_users_cannot_view_desktop_assets_or_vnc(self):
        for path in ["/desktop", "/novnc/access", "/api/status", "/websockify"]:
            response = await self.client.get(path)
            self.assertEqual(response.status, 403)

    async def test_unlock_requires_key_and_same_origin_and_sets_private_cookie(self):
        for token, origin in [("wrong", self.origin), (self.gate.token, "https://evil.example")]:
            response = await self.client.post("/api/unlock", json={"token": token}, headers={"Origin": origin})
            self.assertEqual(response.status, 403)
        response = await self.client.post("/api/unlock", json={"token": self.gate.token}, headers={"Origin": self.origin})
        self.assertEqual(response.status, 200)
        cookie = response.cookies["login_access"]
        self.assertTrue(cookie["secure"])
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Strict")

    async def test_expired_key_cannot_unlock(self):
        self.gate.deadline = time.time() - 1
        response = await self.client.post("/api/unlock", json={"token": self.gate.token}, headers={"Origin": self.origin})
        self.assertEqual(response.status, 403)

    async def test_browser_exception_is_sanitized_instead_of_logging_credentials(self):
        self.gate.capture = AsyncMock(side_effect=RuntimeError("Cookie: synthetic-secret"))
        response = await self.client.post("/api/finish", json={}, headers={"Origin": self.origin, "Cookie": "login_access="+self.gate.token})
        self.assertEqual(response.status, 503)
        self.assertNotIn("synthetic-secret", await response.text())


class ProfileTests(unittest.TestCase):
    def test_encrypted_profile_round_trip_preserves_session_without_overwriting_live_files(self):
        with tempfile.TemporaryDirectory() as root:
            vault = Vault(root)
            gate = Gateway(vault, Path(root)/"access", "owner@example.com", root)
            profile = Path(root)/"google-browser"
            profile.mkdir(mode=0o700)
            (profile/"Cookies").write_text("synthetic-session")
            gate.encrypt_profile(profile)
            self.assertFalse(profile.exists())
            self.assertTrue(vault.restore_browser_profile())
            self.assertEqual((profile/"Cookies").read_text(), "synthetic-session")
            self.assertFalse(vault.restore_browser_profile())

    def test_browser_archive_cannot_extract_outside_profile(self):
        with tempfile.TemporaryDirectory() as root:
            vault = Vault(root)
            raw = io.BytesIO()
            with tarfile.open(fileobj=raw, mode="w:gz") as archive:
                member = tarfile.TarInfo("../outside");member.size=1
                archive.addfile(member, io.BytesIO(b"x"))
            (Path(root)/"google-browser.tar.enc").write_bytes(vault.cipher.encrypt(raw.getvalue()))
            with self.assertRaises(ValueError):
                vault.restore_browser_profile()


class RelayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict("os.environ", {"LOGIN_ACCESS_TOKEN": "viewer-key", "LOGIN_AGENT_TOKEN": "agent-key", "LOGIN_SESSION_EXPIRES_AT": str(time.time()+3600)})
        self.env.start()
        self.relay = LoginRelay()
        app = web.Application()
        self.relay.install(app)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.env.stop()

    async def test_agent_and_viewer_credentials_are_separate(self):
        for path, headers in [("/internal/login-agent", {"Authorization": "Bearer viewer-key"}), ("/desktop", {"Cookie": "login_access=agent-key"}), ("/websockify", {})]:
            response = await self.client.get(path, headers=headers)
            self.assertEqual(response.status, 403)

    async def test_http_assets_and_vnc_frames_travel_only_through_authorized_agent(self):
        agent = await self.client.ws_connect("/internal/login-agent", headers={"Authorization": "Bearer agent-key"})
        async def answer():
            command = await agent.receive_json(timeout=3)
            self.assertEqual(command["path"], "/novnc/example.js")
            await agent.send_json({"type": "http_response", "id": command["id"], "status": 200,
                "headers": {"Content-Type": "application/javascript", "Cache-Control": "no-store"}, "body": base64.b64encode(b"synthetic asset").decode()})
        task = asyncio.create_task(answer())
        response = await self.client.get("/novnc/example.js", headers={"Cookie": "login_access=viewer-key"})
        self.assertEqual(await response.read(), b"synthetic asset")
        await task
        origin = "https://" + self.client.host + ":" + str(self.client.port)
        viewer = await self.client.ws_connect("/websockify", headers={"Cookie": "login_access=viewer-key", "Origin": origin})
        self.assertEqual((await agent.receive_json(timeout=3))["type"], "vnc_open")
        await agent.send_bytes(b"RFB 003.008\n")
        self.assertEqual((await viewer.receive(timeout=3)).data, b"RFB 003.008\n")
        await viewer.send_bytes(b"synthetic keyboard packet")
        self.assertEqual((await agent.receive(timeout=3)).data, b"synthetic keyboard packet")
        await viewer.close()
        await agent.close()

    async def test_expired_login_environment_is_disabled(self):
        with patch.dict("os.environ", {"LOGIN_SESSION_EXPIRES_AT": "0"}):
            response = await self.client.get("/login")
            self.assertEqual(response.status, 404)


if __name__ == "__main__":
    unittest.main()
