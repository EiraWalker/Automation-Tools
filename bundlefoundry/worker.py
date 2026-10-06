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
from session_recovery import RecoveringBundleFoundry

LOG = logging.getLogger("free-bundles")


class Queue:
    def __init__(self, directory):
        self.db = sqlite3.connect(Path(directory) / "queue.sqlite3")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, links TEXT, done INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, next_attempt REAL DEFAULT 0)")
        self.db.execute("CREATE TABLE IF NOT EXISTS results (url TEXT PRIMARY KEY, status TEXT, updated REAL)")
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(messages)")}
        if "source" not in columns:
            self.db.execute("ALTER TABLE messages ADD COLUMN source TEXT DEFAULT 'seed'")
        self.db.execute("CREATE TABLE IF NOT EXISTS acceptance (message_id TEXT, url TEXT, evidence TEXT, verified REAL, PRIMARY KEY(message_id,url))")
        self.db.commit()

    def contains(self, message_id, source=None):
        row = self.db.execute("SELECT source FROM messages WHERE id=?", (message_id,)).fetchone()
        return bool(row and (source is None or row[0] == source))

    def add(self, message, source="seed"):
        links = newsletter_links(message)
        # Re-fetch and re-validate previously seeded mail through the live API
        # before allowing it to count as an end-to-end acceptance run.
        self.db.execute("""INSERT INTO messages(id,links,done,source) VALUES(?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET links=excluded.links,source=excluded.source,
            done=CASE WHEN excluded.done=1 THEN 1 ELSE messages.done END
            WHERE messages.source='seed' AND excluded.source='live_gmail'""",
            (message["id"], json.dumps(links), not links, source))
        self.db.commit()

    def acceptance(self):
        row = self.db.execute("SELECT evidence FROM acceptance ORDER BY verified DESC LIMIT 1").fetchone()
        return json.loads(row[0]) if row else None

    def process(self, site):
        rows = self.db.execute("SELECT id,links,attempts,source FROM messages WHERE done=0 AND next_attempt<=? ORDER BY rowid LIMIT 25", (time.time(),)).fetchall()
        for message_id, links, attempts, source in rows:
            try:
                for link in json.loads(links):
                    url = site.resolve(link)
                    result = self.db.execute("SELECT status FROM results WHERE url=?", (url,)).fetchone()
                    if result:
                        continue
                    site.current_message_id = message_id
                    status = site.claim(url)
                    self.db.execute("INSERT OR REPLACE INTO results VALUES(?,?,?)", (url, status, time.time()))
                    receipt = getattr(site, "claim_receipt", None)
                    if source == "live_gmail" and status == "claimed" and isinstance(receipt, dict):
                        if receipt.get("bundle_url") == url and receipt.get("new_claim") is True and receipt.get("tier_number") == 0 and receipt.get("owned_license_types"):
                            evidence = {**receipt, "schema_version": 1, "email_id": message_id,
                                "email_source": "gmail_api", "sender_authentication": "dmarc_pass"}
                            self.db.execute("INSERT OR REPLACE INTO acceptance VALUES(?,?,?,?)",
                                (message_id, url, json.dumps(evidence), evidence["ownership_verified_at"]))
                            LOG.info("project_acceptance_complete=true message=%s bundle_id=%s", message_id, receipt["bundle_id"])
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
    site = RecoveringBundleFoundry(vault)
    queue.db.execute("UPDATE messages SET next_attempt=0 WHERE done=0")
    queue.db.commit()
    poll_interval = max(60, int(os.getenv("POLL_SECONDS", "43200")))
    mail_at = 0
    heartbeat_at = 0
    report(project_acceptance_complete=bool(queue.acceptance()))
    try:
        while not stop.is_set():
            try:
                now = time.monotonic()
                if now >= mail_at:
                    mail_at = now + poll_interval
                    for message in gmail.messages():
                        if not queue.contains(message["id"], source="live_gmail"):
                            queue.add(gmail.message(message["id"]), source="live_gmail")
                    queue.process(site)
                    pending = queue.db.execute("SELECT COUNT(*) FROM messages WHERE done=0").fetchone()[0]
                    report(automation_state="running", last_success=time.time(), pending_messages=pending,
                        project_acceptance_complete=bool(queue.acceptance()))
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
    parser.add_argument("--verify-e2e", action="store_true", help="live Gmail-to-new-claim acceptance; exits nonzero until proven")
    parser.add_argument("--acceptance-status", action="store_true", help="read the private durable acceptance receipt")
    parser.add_argument("--doctor", action="store_true")
    parser.add_argument("--seed-email", type=Path)
    parser.add_argument("--probe", help="read public free-tier availability; no claim")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    vault = Vault(args.state)
    saved = vault.load()
    if args.acceptance_status:
        queue = Queue(vault.directory)
        evidence = queue.acceptance()
        queue.db.close()
        print(json.dumps({"project_acceptance_complete": bool(evidence), "evidence": evidence}, ensure_ascii=False))
        return
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
    run(vault, stop, once=args.once or args.verify_e2e)
    if args.verify_e2e:
        queue = Queue(vault.directory)
        evidence = queue.acceptance()
        queue.db.close()
        print(json.dumps({"project_acceptance_complete": bool(evidence), "evidence": evidence}, ensure_ascii=False))
        if not evidence:
            parser.exit(3, "Acceptance incomplete: no live-email new free claim has been confirmed in this account.\n")


if __name__ == "__main__":
    main()
