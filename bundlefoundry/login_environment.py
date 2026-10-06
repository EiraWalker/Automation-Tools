"""Private temporary noVNC gateway; Google credentials stay inside real Chrome.

Requires an existing headed Chrome CDP port and localhost-only VNC server.
No request, keyboard, clipboard, OAuth-code, or cookie values are logged.
"""
import argparse
import asyncio
import hmac
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import tarfile
import time
import urllib.parse

from aiohttp import web, WSMsgType
from playwright.async_api import async_playwright

from bundlefoundry import BASE, parse_page, site_cookie
from vault import Vault


ENTRY = """<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Google 登录环境</title>
<style>body{font:16px system-ui;background:#f4f6fa;color:#172038;max-width:640px;margin:12vh auto;padding:24px}main{background:white;padding:32px;border-radius:16px}h1{font-size:24px}</style>
<main><h1>Google 登录环境</h1><p id="message">这个入口受访问保护，请使用你的专属登录链接。</p>
<p>登录将在真实 Chrome 浏览器的 Google 页面进行。无需向聊天发送密码或验证码。</p></main>
<script>const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
if(token){document.getElementById('message').textContent='正在验证访问链接…';fetch('/api/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}).then(async r=>{if(r.ok)location.replace('/desktop');else document.getElementById('message').textContent='链接失效或已过期。'}).catch(()=>document.getElementById('message').textContent='连接失败，请刷新重试。');}</script></html>"""

DESKTOP = """<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Google 登录浏览器</title>
<style>body{margin:0;background:#eaf0f8;font:14px system-ui;color:#172038}header{padding:10px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}button{padding:8px 12px;border:1px solid #ccd4e0;border-radius:8px;background:white;cursor:pointer}iframe{width:100%;height:calc(100vh - 100px);border:0;background:#202020}small{display:block;padding:0 16px 8px}#state{flex:1}</style>
<header><b>Google 登录浏览器</b><span id="state">连接浏览器…</span><button id="login">打开 BundleFoundry Google 登录</button><button id="save">保存并关闭浏览器</button></header>
<small>直接在下方真实浏览器的 accounts.google.com 页面登录。页面顶部地址栏可核对来源。成功后会自动加密保存 BundleFoundry 会话。Gmail 后台 OAuth 授权另需配置。</small>
<iframe src="/novnc/vnc.html?autoconnect=true&amp;resize=scale&amp;path=/websockify" allow="clipboard-read; clipboard-write" title="真实 Chrome 浏览器"></iframe>
<script>async function act(path){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await r.json();if(!r.ok)alert(data.error||'操作失败');}
document.getElementById('login').onclick=()=>act('/api/login');document.getElementById('save').onclick=()=>act('/api/finish');
async function status(){try{const r=await fetch('/api/status');if(!r.ok){location.replace('/');return;}const s=await r.json();document.getElementById('state').textContent=s.profile_encrypted?'已保存并关闭；Google 浏览器资料已加密':s.bundle_session_saved?'BundleFoundry 会话已加密保存':'等待你完成 Google 登录';}catch{document.getElementById('state').textContent='暂时断开，正在重连…';}}status();setInterval(status,3000);</script></html>"""


class Gateway:
    def __init__(self, vault, access_file, expected_account, novnc, ttl=86400, reuse_access=False):
        self.vault = vault
        self.expected_account = expected_account.lower()
        self.novnc = Path(novnc).resolve()
        self.access_file = Path(access_file)
        self.access_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Explicitly resuming a private session keeps its original expiry.
        if reuse_access and self.access_file.exists():
            self.token = self.access_file.read_text().strip()
            self.deadline = self.access_file.stat().st_mtime + ttl
        else:
            self.token = secrets.token_urlsafe(32)
            self.access_file.write_text(self.token)
            self.access_file.chmod(0o600)
            self.deadline = time.time() + ttl
        self.browser = None
        self.saved = False
        self.profile_encrypted = False
        self.lock = asyncio.Lock()

    def authorized(self, request):
        return time.time() < self.deadline and hmac.compare_digest(request.cookies.get("login_access", ""), self.token)

    @web.middleware
    async def protect(self, request, handler):
        if request.path not in ("/", "/api/unlock") and not self.authorized(request):
            raise web.HTTPForbidden(text="Private login environment")
        if request.method == "POST":
            origin = request.headers.get("Origin", "")
            parts = urllib.parse.urlsplit(origin)
            # Compare to the original public Host, preserved by the tunnel.
            if parts.scheme not in ("http", "https") or parts.netloc != request.host:
                raise web.HTTPForbidden(text="Origin mismatch")
        response = await handler(request)
        if not response.prepared:
            response.headers.update({"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"})
        return response

    async def entry(self, request):
        return web.Response(text=ENTRY, content_type="text/html")

    async def unlock(self, request):
        try:
            token = (await request.json()).get("token", "")
        except (ValueError, AttributeError):
            raise web.HTTPForbidden()
        if not isinstance(token, str) or time.time() >= self.deadline or not hmac.compare_digest(token, self.token):
            raise web.HTTPForbidden()
        response = web.json_response({"ok": True})
        response.set_cookie("login_access", self.token, max_age=int(self.deadline-time.time()), secure=True, httponly=True, samesite="Strict", path="/")
        return response

    async def desktop(self, request):
        return web.Response(text=DESKTOP, content_type="text/html")

    async def status(self, request):
        return web.json_response({"bundle_session_saved": self.saved, "profile_encrypted": self.profile_encrypted})

    async def login(self, request):
        if self.profile_encrypted or not self.browser:
            return web.json_response({"error": "浏览器已关闭，请重新启动登录环境。"}, status=409)
        context = self.browser.contexts[0]
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(BASE + "/auth/google/redirect", wait_until="domcontentloaded")
        return web.json_response({"ok": True})

    async def capture(self):
        async with self.lock:
            if not self.browser or self.profile_encrypted:
                return False
            context = self.browser.contexts[0]
            # Do not poll the site's session while the Google callback is pending.
            if not any(urllib.parse.urlsplit(page.url).hostname == "bundlefoundry.com" for page in context.pages):
                return False
            response = await context.request.get(BASE + "/my-bundles", timeout=15000)
            props = parse_page(await response.body())
            email = (props.get("auth", {}).get("user") or {}).get("email", "").lower()
            if not email or email != self.expected_account:
                return False
            cookies = [dict(cookie, secure=True) for cookie in await context.cookies() if site_cookie(cookie)]
            if not cookies:
                return False
            saved = self.vault.load()
            saved.update(account=email, bundle_cookies=cookies)
            self.vault.save(saved)
            self.saved = True
            return True

    async def finish(self, request):
        if self.profile_encrypted:
            return web.json_response({"ok": True})
        if not await self.capture():
            return web.json_response({"error": "请先完成对应账号的 BundleFoundry 登录。"}, status=409)
        async with self.lock:
            await self.close_chrome()
            # Archive only this purpose-created profile, after Chrome flushes it.
            profile = self.vault.directory / "google-browser"
            await asyncio.to_thread(self.encrypt_profile, profile)
            self.profile_encrypted = True
        return web.json_response({"ok": True})

    async def close_chrome(self):
        # Closing a Playwright CDP connection only disconnects its client.
        # Explicitly close the real Chrome process before archiving live SQLite.
        cdp = await self.browser.new_browser_cdp_session()
        processes = await cdp.send("SystemInfo.getProcessInfo")
        pid = next(int(p["id"]) for p in processes["processInfo"] if p["type"] == "browser")
        try:
            await cdp.send("Browser.close")
        except Exception:
            if self.browser.is_connected():
                raise
        for _ in range(100):
            stat = Path("/proc") / str(pid) / "stat"
            try:
                exited = stat.read_text().split(") ", 1)[1].split()[0] == "Z"
            except FileNotFoundError:
                exited = True
            if exited:
                return
            await asyncio.sleep(.1)
        raise RuntimeError("Chrome is still running; profile has not been removed")

    def encrypt_profile(self, profile):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w:gz") as archive:
            def select(member):
                if member.issym() or member.islnk() or any(p in {"Cache", "Code Cache", "GPUCache", "ShaderCache"} for p in Path(member.name).parts):
                    return None
                return member
            archive.add(profile, arcname="google-browser", filter=select)
        encrypted = self.vault.cipher.encrypt(data.getvalue())
        destination = self.vault.directory / "google-browser.tar.enc"
        temporary = destination.with_suffix(".tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(encrypted);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary, destination)
        # Google profile remains reusable as an encrypted archive, not plaintext.
        shutil.rmtree(profile)

    async def websocket(self, request):
        ws = web.WebSocketResponse(heartbeat=20, max_msg_size=2**20)
        await ws.prepare(request)
        reader, writer = await asyncio.open_connection("127.0.0.1", 5905)

        async def vnc_to_web():
            while time.time() < self.deadline:
                data = await reader.read(65536)
                if not data:
                    break
                await ws.send_bytes(data)
            await ws.close()

        outgoing = asyncio.create_task(vnc_to_web())
        try:
            async for message in ws:
                if time.time() >= self.deadline:
                    break
                if message.type == WSMsgType.BINARY:
                    writer.write(message.data);await writer.drain()
                elif message.type == WSMsgType.ERROR:
                    break
        finally:
            outgoing.cancel()
            await asyncio.gather(outgoing, return_exceptions=True)
            writer.close();await writer.wait_closed();await ws.close()
        return ws

    async def watch(self):
        while time.time() < self.deadline:
            try:
                await self.capture()
            except Exception:
                pass  # No browser URLs, exception bodies, or credential logs.
            await asyncio.sleep(15)

    def app(self):
        app = web.Application(middlewares=[self.protect], client_max_size=16384)
        app.router.add_get("/", self.entry)
        app.router.add_post("/api/unlock", self.unlock)
        app.router.add_get("/desktop", self.desktop)
        app.router.add_get("/api/status", self.status)
        app.router.add_post("/api/login", self.login)
        app.router.add_post("/api/finish", self.finish)
        app.router.add_get("/websockify", self.websocket)
        app.router.add_static("/novnc/", self.novnc, show_index=False)
        return app


async def serve(args):
    vault = Vault(args.state)
    gate = Gateway(vault, args.access_file, args.account, args.novnc, reuse_access=args.reuse_access)
    async with async_playwright() as playwright:
        gate.browser = await playwright.chromium.connect_over_cdp("http://127.0.0.1:9225")
        runner = web.AppRunner(gate.app(), access_log=None)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", args.port).start()
        watcher = asyncio.create_task(gate.watch())
        try:
            await asyncio.sleep(86400)
        finally:
            watcher.cancel();await asyncio.gather(watcher, return_exceptions=True)
            await runner.cleanup()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", default="state")
    parser.add_argument("--access-file", required=True)
    parser.add_argument("--account", required=True)
    parser.add_argument("--novnc", required=True)
    parser.add_argument("--port", type=int, default=18081)
    parser.add_argument("--reuse-access", action="store_true", help="resume the current private link without extending its expiry")
    asyncio.run(serve(parser.parse_args()))


if __name__ == "__main__":
    main()
