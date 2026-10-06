"""Authenticated cloud-task ingress with an opaque, encrypted durable checkpoint."""
import json
import os
import re
import tempfile
import hashlib

from bundlefoundry import BASE, BundleFoundry, NeedsLogin
from session_recovery import RecoveringBundleFoundry
from gmail import newsletter_links
from vault import Vault
from worker import Queue

TABLES = {
    "messages": ("id", "links", "done", "attempts", "next_attempt", "source"),
    "results": ("url", "status", "updated"),
    "acceptance": ("message_id", "url", "evidence", "verified"),
}


def run_external(payload, bootstrap_vault):
    """Caller is the private Sites updater; no provider tokens cross this API."""
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list) or len(payload["messages"]) > 25:
        raise ValueError("invalid batch")
    expected = bootstrap_vault.load().get("account", "").lower()
    actual = payload.get("source_account", "")
    if not isinstance(actual, str) or not expected or actual.lower() != expected:
        raise ValueError("source account mismatch")
    session_test = payload.get("session_recovery_test") is True
    if session_test and os.getenv("SESSION_RECOVERY_TEST_ENABLED", "false").lower() != "true":
        raise ValueError("session recovery test is disabled")
    for message in payload["messages"]:
        if not isinstance(message, dict) or not re.fullmatch(r"[a-f0-9]{1,64}", message.get("id", "")):
            raise ValueError("invalid message identity")
        if not isinstance(message.get("payload"), dict):
            raise ValueError("missing Gmail MIME payload")
    with tempfile.TemporaryDirectory(prefix="free-bundle-run-") as root:
        vault = Vault(root, key=os.environ["CREDENTIAL_KEY"])
        saved = bootstrap_vault.load()
        bootstrap_digest = hashlib.sha256(os.environ.get("CREDENTIALS_ENCRYPTED", "").encode()).hexdigest()
        checkpoint = payload.get("checkpoint_encrypted")
        restored = None
        if checkpoint:
            if not isinstance(checkpoint, str) or len(checkpoint) > 1500000:
                raise ValueError("invalid checkpoint")
            restored = json.loads(vault.cipher.decrypt(checkpoint.encode()))
            if restored.get("schema_version") != 1 or restored.get("credentials", {}).get("account", "").lower() != expected:
                raise ValueError("checkpoint account mismatch")
            # Explicit credential updates replace revoked cookies or import an
            # audited recovery journal; unchanged bootstrap preserves renewals.
            if restored.get("bootstrap_sha256") == bootstrap_digest:
                saved = restored["credentials"]
        vault.save(saved)
        # Bootstrap is intentionally loaded before saving renewed state, so later
        # Vault.load calls cannot replace it with stale environment cookies.
        vault.load()
        vault.save(saved)
        queue = Queue(root)
        try:
            if restored:
                for table, columns in TABLES.items():
                    rows = restored.get("queue", {}).get(table, [])
                    queue.db.executemany(f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", rows)
                queue.db.commit()
            # Connector returns live Gmail API MIME trees; revalidate every body.
            for message in payload["messages"]:
                newsletter_links(message)
                queue.add(message, source="live_gmail")
            test_evidence = None
            if session_test:
                # Invalidate only this run's site session. Preserve Google and the original checkpoint.
                invalidated = vault.load()
                invalidated["bundle_cookies"] = []
                invalidated.pop("session_recovery", None)
                vault.save(invalidated)
                try:
                    BundleFoundry(vault).page(BASE + "/my-bundles")
                except NeedsLogin:
                    test_evidence = {"site_session_invalid_before_login": True}
                else:
                    raise ValueError("session invalidation could not be verified")
            site = RecoveringBundleFoundry(vault)
            automation_state = "running"
            try:
                site.page(BASE + "/my-bundles")
                if session_test:
                    if site.recovery.summary().get("status") != "relogged_in":
                        raise ValueError("test did not perform automatic login")
                    test_evidence.update(google_session_reused=True, account_verified=True,
                                         site_session_valid_after_login=True, no_interactive_input=True,
                                         browser_profile_reencrypted=True, verified_at=site.recovery.summary()["verified_at"])
                else:
                    queue.process(site)
                    recovery_status = site.recovery.summary().get("status")
                    if recovery_status in ("needs_authorization", "retrying"):
                        automation_state = recovery_status
            except NeedsLogin:
                automation_state = "needs_authorization"
                if session_test:
                    # Never replace a working durable checkpoint with a failed test session.
                    raise
            evidence = queue.acceptance()
            state = {"schema_version": 1, "bootstrap_sha256": bootstrap_digest, "credentials": vault.load(), "queue": {
                table: queue.db.execute(f"SELECT {','.join(columns)} FROM {table}").fetchall()
                for table, columns in TABLES.items()
            }}
            pending = queue.db.execute("SELECT COUNT(*) FROM messages WHERE done=0").fetchone()[0]
            results = [{"bundle_url": row[0], "status": row[1], "updated_at": row[2]}
                       for row in state["queue"]["results"]]
            return {"checkpoint_encrypted": vault.cipher.encrypt(json.dumps(state).encode()).decode(),
                    "project_acceptance_complete": bool(evidence), "acceptance": evidence,
                    "pending_messages": pending, "results": results,
                    "automation_state": automation_state, "session_recovery": site.recovery.summary(),
                    **({"session_recovery_test": test_evidence} if test_evidence else {})}
        finally:
            queue.db.close()
