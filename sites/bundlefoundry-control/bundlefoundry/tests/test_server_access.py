import time
import unittest
from unittest.mock import patch

from aiohttp.test_utils import TestClient, TestServer
from server import Status, application


class PublicServiceAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_google_bridge_separates_gateway_and_agent_credentials_and_rejects_forged_identity(self):
        gateway, agent = 'gateway-' + 's' * 40, 'agent-' + 'a' * 40
        with patch.dict('os.environ', {'AUTOMATION_SERVICE_TOKEN':gateway,'GOOGLE_BROWSER_AGENT_TOKEN':agent}):
            client=TestClient(TestServer(application(Status(),object())))
            await client.start_server()
            try:
                spoof={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'}
                for action in ('start','input','agent','commit'):
                    response=await client.post('/internal/google-browser/'+action,json={},headers=spoof)
                    self.assertEqual(response.status,401)
                response=await client.get('/internal/google-browser/state',headers=spoof)
                self.assertEqual(response.status,401)
                response=await client.post('/internal/google-browser/agent',json={},headers={'Authorization':'Bearer '+gateway})
                self.assertEqual(response.status,401)
                response=await client.post('/internal/google-browser/start',json={},headers={'Authorization':'Bearer '+agent})
                self.assertEqual(response.status,401)
                response=await client.post('/internal/google-browser/start',json={},headers={'Authorization':'Bearer '+gateway})
                self.assertEqual(response.status,200)
                identity=(await response.json())['id']
                response=await client.post('/internal/google-browser/agent',json={'id':identity,'phase':'interactive'},headers={'Authorization':'Bearer '+agent})
                self.assertEqual(response.status,200)
                self.assertEqual((await response.json())['commands'],[{'operation':'start'}])
                response=await client.get('/internal/google-browser/state',headers={'Authorization':'Bearer '+gateway})
                self.assertEqual(response.status,200)
                self.assertIn('no-store',response.headers['Cache-Control'])
                self.assertNotIn('artifact',await response.json())
            finally:await client.close()

    async def test_epic_browser_requires_machine_authentication_and_never_accepts_a_target_url(self):
        secret = 's' * 40
        with patch.dict('os.environ', {'AUTOMATION_SERVICE_TOKEN': secret}):
            client = TestClient(TestServer(application(Status(), object())))
            await client.start_server()
            try:
                path = '/internal/epic/web-session'
                denied = await client.post(path, json={'exchange_code': 'a' * 32}, headers={'oai-authenticated-user-email': 'owner@example.com'})
                self.assertEqual(denied.status, 401)
                invalid = await client.post(path, json={'exchange_code': 'a' * 32, 'url': 'https://evil.example/'}, headers={'Authorization': 'Bearer ' + secret})
                self.assertEqual(invalid.status, 400)
                bad_cookie = {'name': 'TOKEN', 'value': 'TEST', 'domain': 'evil.example', 'path': '/', 'subdomains': False, 'expires': time.time() * 1000 + 3600000}
                rejected_cookie = await client.post(path, json={'exchange_code': 'a' * 32, 'cookies': [bad_cookie]}, headers={'Authorization': 'Bearer ' + secret})
                self.assertEqual(rejected_cookie.status, 400)
                with patch('epic_session.website_session', return_value={'cookies': []}) as session:
                    result = await client.post(path, json={'exchange_code': 'a' * 32}, headers={'Authorization': 'Bearer ' + secret})
                    self.assertEqual(result.status, 200)
                    self.assertIn('no-store', result.headers['Cache-Control'])
                    session.assert_called_once_with({'exchange_code': 'a' * 32})
            finally:
                await client.close()

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
