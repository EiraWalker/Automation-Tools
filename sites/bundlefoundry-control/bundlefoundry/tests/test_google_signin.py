import unittest
from unittest.mock import Mock
from google_signin import GoogleSignIn, GoogleSignInError


class GoogleSignInTests(unittest.TestCase):
    def page(self, url, selectors=None):
        page=Mock(url=url)
        selectors=selectors or {}
        def locate(selector):
            nodes=Mock()
            found=selectors.get(selector,[])
            nodes.count.return_value=len(found)
            nodes.nth.side_effect=lambda i:found[i]
            return nodes
        page.locator.side_effect=locate
        return page

    def test_password_cleared_after_one_official_submission_and_phone_wait(self):
        field=Mock();field.is_visible.return_value=True
        page=self.page('https://accounts.google.com/v3/signin/challenge/pwd',{'input[type=password]':[field]})
        button=Mock()
        original=page.locator.side_effect
        page.locator.side_effect=lambda selector:button if selector=='#passwordNext' else original(selector)
        flow=GoogleSignIn(page,'owner@example.com','test-password')
        self.assertEqual(flow.step()['phase'],'signing_in')
        field.fill.assert_called_once_with('test-password',timeout=5000)
        self.assertIsNone(flow.password)
        flow.step()
        field.fill.assert_called_once()
        page.url='https://accounts.google.com/v3/signin/challenge/dp'
        page.locator.side_effect=self.page(page.url).locator.side_effect
        self.assertEqual(flow.step()['phase'],'waiting_for_phone')

    def test_password_is_cleared_even_if_official_form_submission_fails(self):
        field=Mock();field.is_visible.return_value=True;field.fill.side_effect=RuntimeError('test failure')
        flow=GoogleSignIn(self.page('https://accounts.google.com/signin/challenge/pwd',{'input[type=password]':[field]}),'owner@example.com','test-password')
        with self.assertRaises(RuntimeError):flow.step()
        self.assertIsNone(flow.password)

    def test_google_rejection_and_unexpected_hosts_stop_without_forwarding_credentials(self):
        for url in ['https://accounts.google.com/v3/signin/rejected','https://other.example/login']:
            flow=GoogleSignIn(self.page(url),'owner@example.com','test-password')
            with self.assertRaises(GoogleSignInError):flow.step()
            self.assertIsNone(flow.password)

    def test_otp_challenge_is_reported_instead_of_claiming_phone_confirmation(self):
        node=Mock();node.is_visible.return_value=True
        flow=GoogleSignIn(self.page('https://accounts.google.com/signin/challenge/totp',{'input[name=totpPin],input[name=idvPin],input[name=ootpPin]':[node]}),'owner@example.com','test-password')
        self.assertEqual(flow.step()['phase'],'additional_verification')
        self.assertIsNone(flow.password)
