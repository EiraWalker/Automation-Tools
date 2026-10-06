import base64
import time
import unittest
from unittest.mock import patch
from google_browser import GoogleBrowserBridge, BrowserBridgeError


class BrowserBridgeTests(unittest.TestCase):
    def setUp(self):self.bridge=GoogleBrowserBridge()

    def active(self):
        state=self.bridge.start()
        self.bridge.agent({'id':state['id'],'phase':'interactive'})
        return state['id']

    def test_commands_are_consumed_once_and_inputs_are_not_returned_to_viewers(self):
        identity=self.active()
        self.bridge.agent({'id':identity})
        self.bridge.input({'id':identity,'operation':'text','text':'private-user-input'})
        self.assertNotIn('private-user-input',str(self.bridge.view()))
        commands=self.bridge.agent({'id':identity})['commands']
        self.assertEqual(commands,[{'operation':'text','text':'private-user-input'}])
        self.assertEqual(self.bridge.agent({'id':identity})['commands'],[])

    def test_wrong_session_invalid_commands_and_large_frames_are_rejected(self):
        identity=self.active()
        for payload in [{'id':'other','operation':'finish'}, {'id':identity,'operation':'navigate','url':'https://evil.test'},
                        {'id':identity,'operation':'click','x':-1,'y':10}, {'id':identity,'operation':'text','text':'x'*4097}]:
            with self.assertRaises(BrowserBridgeError):self.bridge.input(payload)
        with self.assertRaises(BrowserBridgeError):
            self.bridge.agent({'id':identity,'frame':base64.b64encode(b'\xff\xd8'+b'x'*300000).decode()})

    def test_finish_does_not_expose_cookie_artifact_and_commit_removes_all_private_data(self):
        identity=self.active()
        self.bridge.input({'id':identity,'operation':'finish'})
        self.bridge.agent({'id':identity,'phase':'interactive'})
        self.assertEqual(self.bridge.view()['phase'],'saving')
        artifact={'version':1,'google_cookies':['private-cookie']}
        self.bridge.agent({'id':identity,'phase':'captured','artifact':artifact})
        self.assertEqual(self.bridge.artifact(),artifact)
        self.assertNotIn('private-cookie',str(self.bridge.view()))
        self.bridge.committed()
        with self.assertRaises(BrowserBridgeError):self.bridge.artifact()
        self.assertIsNone(self.bridge.session['frame'])

    def test_expiry_and_cancel_remove_frames_cookies_and_queued_input(self):
        identity=self.active()
        self.bridge.input({'id':identity,'operation':'text','text':'private-input'})
        self.bridge.session.update(frame='private-frame',artifact={'private':'cookie'})
        with patch('google_browser.time.monotonic',return_value=time.monotonic()+901):
            view=self.bridge.view()
        self.assertEqual(view['phase'],'expired')
        self.assertIsNone(view['frame'])
        self.assertIsNone(self.bridge.session['artifact'])
        self.assertEqual(self.bridge.session['commands'],[{'operation':'cancel'}])
