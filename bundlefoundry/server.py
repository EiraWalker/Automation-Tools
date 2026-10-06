"""Always-on Render service with a single mailbox worker and public health status."""
import logging
import os
import threading

from vault import Vault
from worker import Queue, run
from aiohttp import web


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


def application(status):
    app = web.Application(client_max_size=16384)

    async def health(request):
        return web.json_response(status.snapshot(), headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    for path in ("/", "/health", "/status"):
        app.router.add_get(path, health)
    # Interactive verification belongs behind owner-private ChatGPT Sites OAuth.
    # Never mount the legacy shared-token browser relay on the public Render app.
    return app


def continuous_polling_enabled():
    return os.getenv("CONTINUOUS_POLLING_ENABLED", "true").lower() == "true"


def consume(vault, stop, status):
    while not stop.is_set():
        try:
            saved = vault.load()
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
    logging.info("service listening; Google authorization is required before claims can run")
    try:
        web.run_app(application(status), host="0.0.0.0", port=int(os.getenv("PORT", "8000")), access_log=None, print=None)
    finally:
        stop.set()
        worker.join(timeout=35)


if __name__ == "__main__":
    main()
