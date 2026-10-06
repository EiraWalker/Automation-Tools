"""Poll mail, persist work, and retry claims without marking mail as read."""
import argparse
import json
import logging
import os
from pathlib import Path
import signal
import sqlite3
import threading
import time

from bundlefoundry import BASE, SLUG, BundleFoundry, NeedsLogin, RetryLater
from gmail import Gmail, newsletter_links
from vault import Vault

LOG = logging.getLogger("free-bundles")


class Queue:
    def __init__(self, directory):
        self.db = sqlite3.connect(Path(directory) / "queue.sqlite3")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, links TEXT, done INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, next_attempt REAL DEFAULT 0)")
        self.db.execute("CREATE TABLE IF NOT EXISTS results (url TEXT PRIMARY KEY, status TEXT, updated REAL)")
        self.db.commit()

    def contains(self, message_id):
        return bool(self.db.execute("SELECT 1 FROM messages WHERE id=?", (message_id,)).fetchone())

    def add(self, message):
        links = newsletter_links(message)
        self.db.execute("INSERT OR IGNORE INTO messages(id,links,done) VALUES(?,?,?)", (message["id"], json.dumps(links), not links))
        self.db.commit()

    def process(self, site):
        rows = self.db.execute("SELECT id,links,attempts FROM messages WHERE done=0 AND next_attempt<=? ORDER BY rowid LIMIT 25", (time.time(),)).fetchall()
        for message_id, links, attempts in rows:
            try:
                for link in json.loads(links):
                    url = site.resolve(link)
                    result = self.db.execute("SELECT status FROM results WHERE url=?", (url,)).fetchone()
                    if result:
                        continue
                    status = site.claim(url)
                    self.db.execute("INSERT OR REPLACE INTO results VALUES(?,?,?)", (url, status, time.time()))
                    self.db.commit()
                    LOG.info("bundle=%s status=%s", url.rsplit("/", 1)[-1], status)
                self.db.execute("UPDATE messages SET done=1 WHERE id=?", (message_id,))
            except (NeedsLogin, RetryLater, ValueError) as error:
                delay = 21600 if isinstance(error, NeedsLogin) else min(21600, 120 * 2 ** min(attempts, 8))
                self.db.execute("UPDATE messages SET attempts=attempts+1,next_attempt=? WHERE id=?", (time.time() + delay, message_id))
                # Exception messages are deliberately controlled by the integrations, never raw HTTP bodies.
                LOG.warning("message=%s issue=%s retry_seconds=%s", message_id, error, delay)
            self.db.commit()


def run(vault, stop, once=False, report=None):
    """Run one mailbox consumer; report operational state without secrets."""
    report = report or (lambda **_: None)
    queue = Queue(vault.directory)
    gmail = Gmail(vault)
    site = BundleFoundry(vault)
    queue.db.execute("UPDATE messages SET next_attempt=0 WHERE done=0")
    queue.db.commit()
    poll_interval = max(60, int(os.getenv("POLL_SECONDS", "43200")))
    mail_at = 0
    heartbeat_at = 0
    try:
        while not stop.is_set():
            try:
                now = time.monotonic()
                if now >= mail_at:
                    mail_at = now + poll_interval
                    for message in gmail.messages():
                        if not queue.contains(message["id"]):
                            queue.add(gmail.message(message["id"]))
                    queue.process(site)
                    pending = queue.db.execute("SELECT COUNT(*) FROM messages WHERE done=0").fetchone()[0]
                    report(automation_state="running", last_success=time.time(), pending_messages=pending)
                if now >= heartbeat_at:
                    heartbeat_at = now + 900
                    site.page(BASE + "/my-bundles")
            except (NeedsLogin, RetryLater) as error:
                LOG.error("worker issue=%s", error)
                report(automation_state="needs_authorization" if isinstance(error, NeedsLogin) else "retrying", last_error=str(error))
            except Exception as error:
                LOG.error("unexpected_error=%s", type(error).__name__)
                report(automation_state="retrying", last_error="unexpected integration error")
            if once:
                break
            # Website keep-alive does not cause additional Gmail reads.
            stop.wait(max(1, min(mail_at, heartbeat_at) - time.monotonic()))
    finally:
        queue.db.close()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", default=os.getenv("STATE_DIR", "state"))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--doctor", action="store_true")
    parser.add_argument("--seed-email", type=Path)
    parser.add_argument("--probe", help="read public free-tier availability; no claim")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    vault = Vault(args.state)
    saved = vault.load()
    if args.doctor:
        print(json.dumps({"gmail_configured": bool(saved.get("gmail", {}).get("refresh_token")),
                          "bundle_session_configured": bool(saved.get("bundle_cookies")),
                          "account_configured": bool(saved.get("account")),
                          "connectivity_tested": False}))
        return
    if args.probe:
        if not SLUG.fullmatch("/bundle/" + args.probe):
            parser.error("invalid bundle slug")
        b = BundleFoundry().page(BASE + "/bundle/" + args.probe, authenticated=False)["bundle"]
        print(json.dumps({k: b.get(k) for k in ("title", "status", "has_free_tier", "free_tier_available", "free_tier_remaining")}, ensure_ascii=False))
        return
    if args.seed_email:
        queue = Queue(args.state)
        queue.add(json.loads(args.seed_email.read_text()))
        queue.db.close()
        print("Email queued; use --once or start the worker after authentication.")
        return
    if not saved.get("gmail", {}).get("refresh_token") or not saved.get("bundle_cookies"):
        parser.exit(2, "Authentication missing. Run setup_auth.py on your own computer first. No background worker has been started.\n")
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    run(vault, stop, once=args.once)


if __name__ == "__main__":
    main()
