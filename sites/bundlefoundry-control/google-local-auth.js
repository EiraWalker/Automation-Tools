export default String.raw`"""Run on your own computer; upload the result only to your owner-private Site."""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tarfile
import tempfile
import time
from urllib.parse import urlsplit

BASE = 'https://bundlefoundry.com'
FILES = {'Local State', 'Default/Cookies', 'Default/Cookies-journal',
         'Default/Network/Cookies', 'Default/Network/Cookies-journal',
         'Default/Preferences', 'Default/Secure Preferences'}


def chrome_path(explicit=None):
    paths = [explicit] if explicit else [
        'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        str(Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe'),
        str(Path(os.environ.get('LOCALAPPDATA', 'C:/Users/Default/AppData/Local')) / 'Google/Chrome/Application/chrome.exe')]
    for path in paths:
        found = shutil.which(path)
        if found:
            return found
    raise RuntimeError('Install Google Chrome, or specify --chrome with its executable path.')


def export_session(account, chrome, destination):
    from playwright.sync_api import sync_playwright
    with tempfile.TemporaryDirectory(prefix='bundlefoundry-google-') as root:
        profile = Path(root) / 'google-browser'
        profile.mkdir(mode=0o700)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        args = [chrome, '--user-data-dir=' + str(profile),
                '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + str(port),
                '--no-first-run', BASE + '/auth/google/redirect']
        if hasattr(os, 'geteuid') and os.geteuid() == 0:
            args.insert(1, '--no-sandbox')
        process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        google, bundle = [], []
        try:
            with sync_playwright() as p:
                browser = None
                for _ in range(60):
                    try:
                        browser = p.chromium.connect_over_cdp('http://127.0.0.1:' + str(port))
                        break
                    except Exception:
                        if process.poll() is not None:
                            raise RuntimeError('Chrome closed before connection.')
                        time.sleep(1)
                if browser is None:
                    raise RuntimeError('Could not connect to the dedicated Chrome window.')
                context = browser.contexts[0]
                print('请在打开的 Chrome 中完成 Google 登录和验证。密码只输入 Google 官方页面。', flush=True)
                deadline = time.monotonic() + 900
                while time.monotonic() < deadline:
                    complete = False
                    for page in context.pages:
                        if urlsplit(page.url).hostname != 'bundlefoundry.com':
                            continue
                        node = page.locator('[data-page]').first
                        if not node.count():
                            continue
                        try:
                            props = json.loads(node.get_attribute('data-page') or '{}').get('props', {})
                        except Exception:
                            continue
                        user = (props.get('auth') or {}).get('user') or {}
                        if not user.get('email'):
                            continue
                        if user['email'].lower() != account.lower():
                            raise RuntimeError('The signed-in account differs from the expected account.')
                        google = [c for c in context.cookies() if c['domain'].lstrip('.') == 'google.com'
                                  or c['domain'].lstrip('.').endswith('.google.com')]
                        bundle = [c for c in context.cookies([BASE]) if c['domain'].lstrip('.') == 'bundlefoundry.com'
                                  or c['domain'].lstrip('.').endswith('.bundlefoundry.com')]
                        if not google or not bundle:
                            raise RuntimeError('The browser did not issue the required login cookies.')
                        complete = True
                        break
                    if complete:
                        break
                    time.sleep(1)
                else:
                    raise RuntimeError('Login was not completed within 15 minutes.')
                # Google profile archives must never retain a hidden site login.
                import re
                context.clear_cookies(domain=re.compile(r'(^|\.)bundlefoundry\.com$'))
                try:
                    browser.new_browser_cdp_session().send('Browser.close')
                except Exception:
                    pass
        finally:
            if process.poll() is None:
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(timeout=15)
        if not google or not bundle:
            raise RuntimeError('No verified login session was exported.')
        packed = io.BytesIO()
        with tarfile.open(fileobj=packed, mode='w:gz') as archive:
            for relative in sorted(FILES):
                path = profile / relative
                if path.is_file() and not path.is_symlink():
                    archive.add(path, arcname='google-browser/' + relative, recursive=False)
        data = {'version': 1, 'account': account, 'google_cookies': google, 'bundle_cookies': bundle,
                'profile': base64.b64encode(packed.getvalue()).decode()}
        if destination.exists():
            raise RuntimeError('Output already exists; choose a new --output path.')
        with destination.open('x', encoding='utf-8') as out:
            destination.chmod(0o600)
            json.dump(data, out)
        print('已保存 ' + str(destination) + '。它包含登录凭据，请只上传到私有 Sites 页面，完成后删除。')


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--account')
    parser.add_argument('--chrome')
    parser.add_argument('--output', type=Path, default=Path('google-session-import.json'))
    args = parser.parse_args()
    account = args.account or input('Google / BundleFoundry 账号邮箱：').strip()
    if '@' not in account:
        parser.error('Enter the same account used by your private Site.')
    export_session(account, chrome_path(args.chrome), args.output)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit('已取消，浏览器资料不会上传。')
    except Exception as error:
        # Browser exceptions can contain URLs and page contents; expose only type.
        print('授权未完成。错误类型：' + type(error).__name__)
        raise SystemExit(1)
`;
