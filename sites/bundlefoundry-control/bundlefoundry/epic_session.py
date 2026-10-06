"""Obtain Epic website cookies using its official single-use SSO exchange."""
import os
import re
import time
import math
from urllib.parse import urlencode, urlsplit


class EpicSessionError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def website_session(payload):
    if not isinstance(payload, dict) or 'exchange_code' not in payload or set(payload) - {'exchange_code', 'cookies'} or not isinstance(payload['exchange_code'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,256}', payload['exchange_code']):
        raise ValueError('invalid SSO input')
    imported = payload.get('cookies', [])
    if not isinstance(imported, list) or len(imported) > 100:
        raise ValueError('invalid cookie count')
    cookies = []
    for cookie in imported:
        if (not isinstance(cookie, dict) or not isinstance(cookie.get('domain'), str)
                or not re.fullmatch(r'(?:[a-z0-9.-]+\.)?epicgames\.com', cookie['domain'])
                or not isinstance(cookie.get('name'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', cookie['name'])
                or not isinstance(cookie.get('value'), str) or len(cookie['value']) > 8192 or re.search(r'[\x00-\x20\x7f;]', cookie['value'])
                or not isinstance(cookie.get('path'), str) or not cookie['path'].startswith('/')
                or not isinstance(cookie.get('subdomains'), bool)
                or not isinstance(cookie.get('expires'), (int, float)) or not math.isfinite(cookie['expires'])):
            raise ValueError('invalid Epic cookie scope')
        if cookie['expires'] <= time.time() * 1000:
            continue
        cookies.append({'name': cookie['name'], 'value': cookie['value'], 'path': cookie['path'],
                        'domain': ('.' if cookie['subdomains'] else '') + cookie['domain'], 'secure': True,
                        'httpOnly': cookie.get('http_only') is True, 'sameSite': cookie.get('same_site') if cookie.get('same_site') in {'Lax', 'Strict', 'None'} else 'Lax',
                        'expires': cookie['expires'] / 1000})
    from playwright.sync_api import sync_playwright
    from session_recovery import prepare_browser_runtime
    executable = prepare_browser_runtime()
    url = 'https://www.epicgames.com/id/exchange?' + urlencode({'exchangeCode': payload['exchange_code'], 'redirectUrl': 'https://store.epicgames.com/'})
    # No profiles, traces, images, passwords, stealth, or challenge solvers.
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**({'executable_path': executable} if executable else {}), headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context()
        try:
            if cookies:
                context.add_cookies(cookies)
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
                                        'subdomains': cookie['domain'].startswith('.'), 'path': cookie['path'], 'expires': expires * 1000,
                                        'http_only': cookie.get('httpOnly', False), 'same_site': cookie.get('sameSite', 'Lax')})
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
