import time
import unittest
from unittest.mock import patch, Mock

from aiohttp.test_utils import TestClient, TestServer
from server import Status, application


class PublicServiceAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_google_form_verifies_account_before_queuing_password_and_never_exposes_it_in_state(self):
        vault=Mock();vault.load.return_value={'account':'owner@example.com'}
        secret='test-gateway-'+('s'*40)
        with patch.dict('os.environ',{'AUTOMATION_SERVICE_TOKEN':secret}):
            client=TestClient(TestServer(application(Status(),vault)))
            await client.start_server()
            try:
                headers={'Authorization':'Bearer '+secret}
                result=await client.post('/internal/google-browser/signin',json={'account':'other@example.com','password':'test-password'},headers=headers)
                self.assertEqual(result.status,400)
                result=await client.post('/internal/google-browser/signin',json={'account':'owner@example.com','password':'test-password'},headers=headers)
                self.assertEqual(result.status,200)
                self.assertNotIn('test-password',await result.text())
                state=await client.get('/internal/google-browser/state',headers=headers)
                self.assertNotIn('test-password',await state.text())
                self.assertIn('no-store',state.headers['Cache-Control'])
            finally:await client.close()

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

    async def test_retired_epic_browser_route_is_removed_even_with_machine_credentials(self):
        secret='s'*40
        with patch.dict('os.environ',{'AUTOMATION_SERVICE_TOKEN':secret}):
            client=TestClient(TestServer(application(Status(),object())))
            await client.start_server()
            try:
                for headers in [{},{'Authorization':'Bearer '+secret}]:
                    response=await client.post('/internal/epic/web-session',json={},headers=headers)
                    self.assertEqual(response.status,404)
                denied=await client.post('/internal/run',json={})
                self.assertEqual(denied.status,401)
                self.assertTrue((await (await client.get('/health')).json())['service_live'])
            finally:await client.close()

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
