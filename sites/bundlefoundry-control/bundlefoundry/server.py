"""Always-on Render service with a single mailbox worker and public health status."""
import logging
import os
import threading
import asyncio
import hmac

from vault import Vault
from worker import Queue, run
from aiohttp import web
from external_runner import run_external


class Status:
    def __init__(self):
        self.lock = threading.Lock()
        self.values = {"service_live": True, "automation_state": "waiting_for_authorization",
            "continuous_polling_enabled": continuous_polling_enabled(), "project_acceptance_complete": False}

    def report(self, **values):
        with self.lock:
            if values.get("automation_state") == "running":
                self.values.pop("last_error", None)
            self.values.update(values)

    def snapshot(self):
        with self.lock:
            return dict(self.values)


def application(status, vault=None):
    app = web.Application(client_max_size=4 * 1024 * 1024)

    async def health(request):
        return web.json_response(status.snapshot(), headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    for path in ("/", "/health", "/status"):
        app.router.add_get(path, health)
    # Interactive verification belongs behind owner-private ChatGPT Sites OAuth.
    # Never mount the legacy shared-token browser relay on the public Render app.
    if vault is not None:
        lock = asyncio.Lock()

        async def cloud_run(request):
            secret = os.getenv("AUTOMATION_SERVICE_TOKEN", "")
            supplied = request.headers.get("Authorization", "")
            if len(secret) < 32 or not hmac.compare_digest(supplied, "Bearer " + secret):
                return web.json_response({"error": "unauthorized"}, status=401)
            if lock.locked():
                return web.json_response({"error": "run_in_progress"}, status=409)
            async with lock:
                try:
                    payload = await request.json()
                    result = await asyncio.to_thread(run_external, payload, vault)
                except ValueError:
                    return web.json_response({"error": "invalid_batch"}, status=400)
                except Exception as error:
                    logging.warning("cloud run issue=%s", type(error).__name__)
                    return web.json_response({"error": "run_failed_check_session"}, status=503)
                status.report(automation_state=result.get("automation_state", "external_scheduler_ready"),
                              session_recovery=result.get("session_recovery", {}),
                              project_acceptance_complete=result["project_acceptance_complete"])
                return web.json_response(result, headers={"Cache-Control": "private, no-store"})

        app.router.add_post("/internal/run", cloud_run)

        from google_browser import GoogleBrowserBridge, BrowserBridgeError
        bridge = GoogleBrowserBridge()

        async def google_browser(request):
            agent = request.match_info['action'] == 'agent'
            secret = os.getenv('GOOGLE_BROWSER_AGENT_TOKEN' if agent else 'AUTOMATION_SERVICE_TOKEN', '')
            if len(secret)<32 or not hmac.compare_digest(request.headers.get('Authorization',''),'Bearer '+secret):
                return web.json_response({'error':'unauthorized'},status=401)
            try:
                action=request.match_info['action']
                if action=='state' and request.method=='GET':result=bridge.view()
                elif request.method!='POST':return web.json_response({'error':'not_found'},status=404)
                elif action=='start':result=bridge.start()
                elif action=='input':result=bridge.input(await request.json())
                elif action=='agent':result=bridge.agent(await request.json())
                elif action=='commit':
                    if lock.locked():return web.json_response({'error':'run_in_progress'},status=409)
                    async with lock:
                        payload=await request.json()
                        payload['google_session_import']=bridge.artifact()
                        result=await asyncio.to_thread(run_external,payload,vault)
                        bridge.committed()
                else:return web.json_response({'error':'not_found'},status=404)
                return web.json_response(result,headers={'Cache-Control':'private, no-store'})
            except BrowserBridgeError as error:
                return web.json_response({'error':error.code},status=409)
            except Exception as error:
                logging.warning('private Google browser issue=%s',type(error).__name__)
                return web.json_response({'error':'browser_action_incomplete'},status=503)

        app.router.add_route('*','/internal/google-browser/{action}',google_browser)

        async def epic_web_session(request):
            secret = os.getenv("AUTOMATION_SERVICE_TOKEN", "")
            if len(secret) < 32 or not hmac.compare_digest(request.headers.get("Authorization", ""), "Bearer " + secret):
                return web.json_response({"error": "unauthorized"}, status=401)
            if request.content_length and request.content_length > 128000:
                return web.json_response({"error": "invalid_sso_input"}, status=400)
            if lock.locked():
                return web.json_response({"error": "run_in_progress"}, status=409)
            async with lock:
                try:
                    from epic_session import website_session, EpicSessionError
                    result = await asyncio.to_thread(website_session, await request.json())
                    return web.json_response(result, headers={"Cache-Control": "private, no-store"})
                except ValueError:
                    return web.json_response({"error": "invalid_sso_input"}, status=400)
                except EpicSessionError as error:
                    return web.json_response({"error": error.code}, status=403)
                except Exception as error:
                    # Playwright error text may contain the SSO URL: never log it.
                    logging.warning("epic browser issue=%s", type(error).__name__)
                    return web.json_response({"error": "checkout_action_required"}, status=503)

        app.router.add_post("/internal/epic/web-session", epic_web_session)
    return app


def continuous_polling_enabled():
    return os.getenv("CONTINUOUS_POLLING_ENABLED", "true").lower() == "true"


def consume(vault, stop, status):
    while not stop.is_set():
        try:
            saved = vault.load()
            if os.getenv("SCHEDULER_MODE") == "sites":
                ready = bool(saved.get("account") and saved.get("bundle_cookies") and len(os.getenv("AUTOMATION_SERVICE_TOKEN", "")) >= 32)
                status.report(automation_state="external_scheduler_ready" if ready else "waiting_for_authorization")
                stop.wait(30)
                continue
            ready = bool(saved.get("account") and saved.get("gmail", {}).get("refresh_token") and saved.get("bundle_cookies"))
            if ready:
                if not continuous_polling_enabled():
                    status.report(automation_state="ready_requires_always_on_plan")
                    stop.wait(30)
                    continue
                status.report(automation_state="starting")
                run(vault, stop, report=status.report)
                return
            status.report(automation_state="waiting_for_authorization")
        except Exception as error:
            logging.error("credential configuration issue=%s", type(error).__name__)
            status.report(automation_state="invalid_credentials")
        stop.wait(30)


def main():
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    stop = threading.Event()
    status = Status()
    vault = Vault(os.getenv("STATE_DIR", "state"))
    queue = Queue(vault.directory)
    status.report(project_acceptance_complete=bool(queue.acceptance()))
    queue.db.close()
    worker = threading.Thread(target=consume, args=(vault, stop, status), name="gmail-consumer", daemon=True)
    worker.start()
    if os.getenv("AUTO_RELOGIN_ENABLED", "false").lower() == "true":
        def prepare_browser():
            try:
                from session_recovery import prepare_browser_runtime
                prepare_browser_runtime()
                status.report(browser_runtime_ready=True)
            except Exception as error:
                logging.warning("browser provision issue=%s", type(error).__name__)
                status.report(browser_runtime_ready=False, browser_runtime_error_code=getattr(error, "code", "browser_provision_failed"))
        threading.Thread(target=prepare_browser, name="browser-provision", daemon=True).start()
    logging.info("service listening; Google authorization is required before claims can run")
    try:
        web.run_app(application(status, vault), host="0.0.0.0", port=int(os.getenv("PORT", "8000")), access_log=None, print=None)
    finally:
        stop.set()
        worker.join(timeout=35)


if __name__ == "__main__":
    main()
