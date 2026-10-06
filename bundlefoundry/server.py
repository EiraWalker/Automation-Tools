"""Always-on Render service with a single mailbox worker and public health status."""
import http.server
import json
import logging
import os
import signal
import threading

from vault import Vault
from worker import run


class Status:
    def __init__(self):
        self.lock = threading.Lock()
        self.values = {"service_live": True, "automation_state": "waiting_for_authorization",
            "continuous_polling_enabled": continuous_polling_enabled()}

    def report(self, **values):
        with self.lock:
            if values.get("automation_state") == "running":
                self.values.pop("last_error", None)
            self.values.update(values)

    def snapshot(self):
        with self.lock:
            return dict(self.values)


def handler(status):
    class Health(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path not in ("/", "/health", "/status"):
                self.send_error(404)
                return
            body = json.dumps(status.snapshot()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    return Health


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
    worker = threading.Thread(target=consume, args=(vault, stop, status), name="gmail-consumer", daemon=True)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT", "8000"))), handler(status))
    server.daemon_threads = True

    def shutdown(*_):
        stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    worker.start()
    logging.info("service listening; Google authorization is required before claims can run")
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        stop.set()
        server.server_close()
        worker.join(timeout=35)


if __name__ == "__main__":
    main()
