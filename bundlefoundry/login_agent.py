"""Connect the private browser gateway outward to the user's Render service."""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import ssl
import time

from aiohttp import ClientSession, ClientTimeout, WSMsgType


async def session(config):
    ssl_context = ssl.create_default_context()
    tasks = set()
    writer = None
    pump = None
    async with ClientSession(trust_env=True, timeout=ClientTimeout(total=40)) as public, ClientSession(timeout=ClientTimeout(total=25)) as local:
        async with public.ws_connect(config["origin"].replace("https://", "wss://") + "/internal/login-agent",
                headers={"Authorization": "Bearer " + config["agent_token"]}, ssl=ssl_context, heartbeat=20, max_msg_size=4*1024*1024) as ws:
            async def http(command):
                try:
                    async with local.request(command["method"], "http://127.0.0.1:18081" + command["path"],
                            headers=command["headers"], data=base64.b64decode(command["body"])) as response:
                        headers = {name: response.headers[name] for name in ("Content-Type", "Cache-Control", "Set-Cookie", "Referrer-Policy", "X-Content-Type-Options", "Location") if name in response.headers}
                        await ws.send_json({"type": "http_response", "id": command["id"], "status": response.status,
                            "headers": headers, "body": base64.b64encode(await response.read()).decode()})
                except Exception:
                    await ws.send_json({"type": "http_response", "id": command["id"], "status": 503,
                        "headers": {"Cache-Control": "no-store"}, "body": base64.b64encode(b"Login browser unavailable").decode()})

            async def copy(reader):
                try:
                    while True:
                        data = await reader.read(65536)
                        if not data:
                            break
                        await ws.send_bytes(data)
                except asyncio.CancelledError:
                    raise
                except OSError:
                    pass
                if not ws.closed:
                    await ws.send_json({"type": "vnc_closed"})

            async for message in ws:
                if time.time() >= config["expires_at"]:
                    break
                if message.type == WSMsgType.BINARY and writer:
                    writer.write(message.data);await writer.drain()
                elif message.type == WSMsgType.TEXT:
                    command = json.loads(message.data)
                    if command["type"] == "http":
                        task = asyncio.create_task(http(command));tasks.add(task);task.add_done_callback(tasks.discard)
                    elif command["type"] == "vnc_open":
                        if pump:
                            pump.cancel();await asyncio.gather(pump, return_exceptions=True)
                        if writer:
                            writer.close();await writer.wait_closed()
                        reader, writer = await asyncio.open_connection("127.0.0.1", 5905)
                        pump = asyncio.create_task(copy(reader))
                    elif command["type"] == "vnc_close":
                        if pump:
                            pump.cancel();await asyncio.gather(pump, return_exceptions=True);pump = None
                        if writer:
                            writer.close();await writer.wait_closed();writer = None
            if pump:
                pump.cancel();await asyncio.gather(pump, return_exceptions=True)
            if writer:
                writer.close();await writer.wait_closed()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


async def run(config):
    while time.time() < config["expires_at"]:
        try:
            await session(config)
        except Exception:
            pass  # Never log URLs, auth headers, browser frames, or clipboard data.
        await asyncio.sleep(3)


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    asyncio.run(run(json.loads(parser.parse_args().config.read_text())))
