// Same local, loopback-only browser export pattern as BundleFoundry Google recovery.
export default String.raw`"""Export Epic cookies locally; upload only to the owner-private Site."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.parse import urlencode, urlsplit

CLIENT = '34a02cf8f4414e29b15921876da36f9a'
REDIRECT = 'https://www.epicgames.com/id/api/redirect?' + urlencode({'clientId': CLIENT, 'responseType': 'code'})
LOGIN = 'https://www.epicgames.com/id/login?' + urlencode({'redirectUrl': REDIRECT})

def chrome_path(explicit):
    candidates = [explicit] if explicit else ['google-chrome', 'google-chrome-stable', 'chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        str(Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe'),
        str(Path(os.environ.get('LOCALAPPDATA', 'C:/Users/Default/AppData/Local')) / 'Google/Chrome/Application/chrome.exe')]
    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found
    raise RuntimeError('Install Google Chrome or specify --chrome.')

def capture(context):
    existing = set(context.pages)
    page = context.new_page()
    page.goto(LOGIN, wait_until='domcontentloaded', timeout=45000)
    print('请在专用 Chrome 窗口的 Epic 官网登录或完成验证。密码和验证码不会被脚本读取。', flush=True)
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        for tab in context.pages:
            if tab in existing:
                continue
            url = urlsplit(tab.url)
            if url.hostname == 'www.epicgames.com' and url.path == '/id/api/redirect':
                try:
                    code = json.loads(tab.locator('body').inner_text(timeout=1000)).get('authorizationCode')
                except Exception:
                    continue
                if not isinstance(code, str) or len(code) < 16:
                    continue
                cookies = []
                for cookie in context.cookies():
                    domain = cookie['domain'].lstrip('.').lower()
                    if domain != 'epicgames.com' and not domain.endswith('.epicgames.com'):
                        continue
                    expiry = cookie['expires'] if cookie['expires'] > 0 else time.time() + 8 * 3600
                    cookies.append({'name': cookie['name'], 'value': cookie['value'], 'domain': domain,
                        'subdomains': cookie['domain'].startswith('.'), 'path': cookie['path'], 'expires': expiry * 1000,
                        'http_only': cookie.get('httpOnly', False), 'same_site': cookie.get('sameSite', 'Lax')})
                if not cookies:
                    raise RuntimeError('Epic website cookies were not issued.')
                return {'version': 1, 'authorizationCode': code, 'cookies': cookies}
        time.sleep(0.5)
    raise RuntimeError('Official login was not completed within 15 minutes.')

def export(args):
    from playwright.sync_api import sync_playwright
    if args.output.exists():
        raise RuntimeError('Output already exists; choose another --output path.')
    process = None
    with tempfile.TemporaryDirectory(prefix='epic-local-auth-') as temp:
        os.chmod(temp, 0o700)
        if args.cdp:
            address = urlsplit(args.cdp)
            if address.scheme != 'http' or address.hostname not in ('127.0.0.1', 'localhost') or address.username or address.password:
                raise RuntimeError('--cdp must point to your own loopback-only Chrome debugging endpoint.')
            endpoint = args.cdp
        else:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
            endpoint = 'http://127.0.0.1:' + str(port)
            command = [chrome_path(args.chrome), '--user-data-dir=' + temp,
                '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + str(port), '--no-first-run']
            if hasattr(os, 'geteuid') and os.geteuid() == 0:
                command.insert(1, '--no-sandbox')
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            with sync_playwright() as p:
                browser = None
                for _ in range(60):
                    try:
                        browser = p.chromium.connect_over_cdp(endpoint); break
                    except Exception:
                        if process and process.poll() is not None:
                            raise RuntimeError('Chrome exited before connecting.')
                        time.sleep(1)
                if browser is None:
                    raise RuntimeError('Cannot connect to the dedicated Chrome session.')
                data = capture(browser.contexts[0])
                if process:
                    try:
                        browser.new_browser_cdp_session().send('Browser.close')
                    except Exception:
                        pass
        finally:
            if process and process.poll() is None:
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.terminate(); process.wait(timeout=15)
        with args.output.open('x', encoding='utf-8') as out:
            args.output.chmod(0o600); json.dump(data, out)
        print('会话已导出，自有临时浏览器已关闭。请立即将 ' + str(args.output) + ' 上传到私有 Sites，然后删除文件。使用 --cdp 时原有浏览器保持打开。')

if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--chrome')
    parser.add_argument('--cdp', help='Reuse an explicitly enabled local dedicated Chrome session.')
    parser.add_argument('--output', type=Path, default=Path('epic-session-import.json'))
    try:
        export(parser.parse_args())
    except KeyboardInterrupt:
        raise SystemExit('已取消，凭据不会上传。')
    except Exception as error:
        # Never print exception text, browser URLs, codes, cookies, or input.
        print('导出未完成。错误类型：' + type(error).__name__)
        raise SystemExit(1)
`;
