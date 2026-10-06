"""Optional authenticated reverse browser relay; stores no browser frames or keys."""
import asyncio
import base64
import hmac
import json
import os
import secrets
import time

from aiohttp import web, WSMsgType


class LoginRelay:
    def __init__(self):
        self.agent = None
        self.viewer = None
        self.pending = {}

    def enabled(self):
        try:
            return bool(os.getenv("LOGIN_ACCESS_TOKEN") and os.getenv("LOGIN_AGENT_TOKEN")) and time.time() < float(os.getenv("LOGIN_SESSION_EXPIRES_AT", "0"))
        except ValueError:
            return False

    def access(self, request):
        return self.enabled() and hmac.compare_digest(request.cookies.get("login_access", ""), os.environ["LOGIN_ACCESS_TOKEN"])

    async def http(self, request):
        if not self.enabled():
            raise web.HTTPNotFound()
        path = "/" if request.path == "/login" else request.path_qs
        if path not in ("/", "/api/unlock") and not self.access(request):
            raise web.HTTPForbidden(text="Private login environment")
        if not self.agent or self.agent.closed:
            return web.Response(status=503, text="登录浏览器暂时未连接，请稍后刷新。", content_type="text/plain", headers={"Cache-Control": "no-store"})
        identifier = secrets.token_hex(12)
        future = asyncio.get_running_loop().create_future()
        self.pending[identifier] = future
        headers = {name: request.headers[name] for name in ("Host", "Origin", "Cookie", "Content-Type") if name in request.headers}
        try:
            await self.agent.send_json({"type": "http", "id": identifier, "path": path,
                "method": request.method, "headers": headers,
                "body": base64.b64encode(await request.read()).decode()})
            response = await asyncio.wait_for(future, timeout=30)
            return web.Response(status=response["status"], body=base64.b64decode(response["body"]), headers=response["headers"])
        except (asyncio.TimeoutError, ConnectionError):
            raise web.HTTPServiceUnavailable(text="Login browser disconnected") from None
        finally:
            self.pending.pop(identifier, None)

    async def connect_agent(self, request):
        expected = "Bearer " + os.getenv("LOGIN_AGENT_TOKEN", "")
        if not self.enabled() or not hmac.compare_digest(request.headers.get("Authorization", ""), expected):
            raise web.HTTPForbidden()
        ws = web.WebSocketResponse(heartbeat=20, max_msg_size=4*1024*1024)
        await ws.prepare(request)
        previous = self.agent
        self.agent = ws
        if previous:
            await previous.close()
        try:
            async for message in ws:
                if not self.enabled():
                    break
                if message.type == WSMsgType.TEXT:
                    response = json.loads(message.data)
                    if response.get("type") == "http_response":
                        future = self.pending.get(response.get("id"))
                        if future and not future.done():
                            future.set_result(response)
                    elif response.get("type") == "vnc_closed" and self.viewer:
                        await self.viewer.close()
                elif message.type == WSMsgType.BINARY and self.viewer and not self.viewer.closed:
                    await self.viewer.send_bytes(message.data)
        finally:
            if self.agent is ws:
                self.agent = None
                if self.viewer:
                    await self.viewer.close()
                for future in self.pending.values():
                    if not future.done():
                        future.set_exception(ConnectionError("Login browser disconnected"))
            await ws.close()
        return ws

    async def connect_viewer(self, request):
        if not self.access(request):
            raise web.HTTPForbidden()
        if request.headers.get("Origin") != "https://" + request.host:
            raise web.HTTPForbidden(text="Origin mismatch")
        if not self.agent or self.agent.closed:
            raise web.HTTPServiceUnavailable()
        ws = web.WebSocketResponse(heartbeat=20, max_msg_size=2**20)
        await ws.prepare(request)
        previous = self.viewer
        self.viewer = ws
        if previous:
            await previous.close()
        await self.agent.send_json({"type": "vnc_open"})
        try:
            async for message in ws:
                if not self.enabled() or not self.agent or self.agent.closed:
                    break
                if message.type == WSMsgType.BINARY:
                    await self.agent.send_bytes(message.data)
        finally:
            if self.viewer is ws:
                self.viewer = None
                if self.agent and not self.agent.closed:
                    await self.agent.send_json({"type": "vnc_close"})
            await ws.close()
        return ws

    def install(self, app):
        app.router.add_get("/internal/login-agent", self.connect_agent)
        app.router.add_get("/websockify", self.connect_viewer)
        app.router.add_get("/login", self.http)
        app.router.add_get("/desktop", self.http)
        app.router.add_route("*", "/api/{path:.*}", self.http)
        app.router.add_get("/novnc/{path:.*}", self.http)
