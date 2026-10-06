"""Obtain Epic website cookies using its official single-use SSO exchange."""
import os
import re
import time
from urllib.parse import urlencode, urlsplit


class EpicSessionError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def website_session(payload):
    if not isinstance(payload, dict) or set(payload) != {'exchange_code'} or not isinstance(payload['exchange_code'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,256}', payload['exchange_code']):
        raise ValueError('invalid SSO input')
    from playwright.sync_api import sync_playwright
    from session_recovery import prepare_browser_runtime
    executable = prepare_browser_runtime()
    url = 'https://www.epicgames.com/id/exchange?' + urlencode({'exchangeCode': payload['exchange_code'], 'redirectUrl': 'https://store.epicgames.com/'})
    # No profiles, traces, images, passwords, stealth, or challenge solvers.
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**({'executable_path': executable} if executable else {}), headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context()
        try:
            page = context.new_page()
            response = page.goto(url, wait_until='domcontentloaded', timeout=35000)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                current = urlsplit(page.url)
                if current.hostname == 'store.epicgames.com':
                    cookies = []
                    for cookie in context.cookies():
                        domain = cookie['domain'].lstrip('.').lower()
                        if domain != 'epicgames.com' and not domain.endswith('.epicgames.com'):
                            continue
                        expires = cookie['expires'] if cookie['expires'] > 0 else time.time() + 8 * 3600
                        cookies.append({'name': cookie['name'], 'value': cookie['value'], 'domain': domain,
                                        'subdomains': cookie['domain'].startswith('.'), 'path': cookie['path'], 'expires': expires * 1000})
                    if not cookies:
                        raise EpicSessionError('checkout_action_required')
                    return {'cookies': cookies}
                if current.hostname != 'www.epicgames.com' or '/login' in current.path or '/challenge' in current.path:
                    raise EpicSessionError('verification_required')
                if response and response.status >= 400:
                    raise EpicSessionError('verification_required')
                if page.locator('input[type="password"],input[name="totpPin"],iframe[src*="arkoselabs"]').count():
                    raise EpicSessionError('verification_required')
                page.wait_for_timeout(500)
            raise EpicSessionError('verification_required')
        finally:
            context.close()
            browser.close()
