"""Official Google login in an ordinary browser; secrets live only during submission."""
import json
import time
from urllib.parse import urlsplit
from session_recovery import select_google_account


class GoogleSignInError(Exception):
    def __init__(self, code):
        self.code=code
        super().__init__(code)


class GoogleSignIn:
    def __init__(self, page, account, password):
        self.page=page
        self.account=account
        self.password=password
        self.email_sent=False
        self.password_sent_at=None
        self.chosen=False

    def clear(self):
        self.password=None

    def visible(self, selector):
        nodes=self.page.locator(selector)
        for i in range(nodes.count()):
            node=nodes.nth(i)
            if node.is_visible():return node
        return None

    def step(self):
        url=urlsplit(self.page.url)
        if url.hostname=='bundlefoundry.com':
            node=self.visible('[data-page]')
            if node:
                user=(json.loads(node.get_attribute('data-page') or '{}').get('props',{}).get('auth') or {}).get('user') or {}
                if user.get('email'):
                    self.clear()
                    if user['email'].lower()!=self.account.lower():raise GoogleSignInError('account_mismatch')
                    return {'phase':'captured'}
            return {'phase':'signing_in'}
        if url.hostname!='accounts.google.com' or url.path.endswith('/rejected'):
            self.clear()
            raise GoogleSignInError('google_session_rejected')
        password=self.visible('input[type=password]')
        if password is not None:
            if self.password_sent_at is None and self.password is not None:
                try:
                    password.fill(self.password,timeout=5000)
                    self.page.locator('#passwordNext').click(timeout=5000)
                    self.password_sent_at=time.monotonic()
                finally:self.clear()
            elif self.password_sent_at and time.monotonic()-self.password_sent_at>5 and password.get_attribute('aria-invalid')=='true':
                raise GoogleSignInError('invalid_password')
            return {'phase':'signing_in'}
        if '/challenge/' in url.path:
            self.clear()
            if self.visible('input[name=totpPin],input[name=idvPin],input[name=ootpPin]') is not None:
                return {'phase':'additional_verification'}
            result={'phase':'waiting_for_phone'}
            number=self.visible('samp, .v4qgkf')
            if number:
                value=number.inner_text().strip()
                if value.isdigit() and 1<=len(value)<=3:result['challenge_number']=value
            return result
        email=self.visible('input[type=email]')
        if email is not None and not self.email_sent:
            email.fill(self.account,timeout=5000)
            self.page.locator('#identifierNext').click(timeout=5000)
            self.email_sent=True
        elif not self.chosen:
            self.chosen=select_google_account(self.page,self.account)
        return {'phase':'signing_in'}
