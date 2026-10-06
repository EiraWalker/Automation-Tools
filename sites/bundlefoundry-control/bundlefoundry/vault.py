"""Encrypted, atomic storage for refresh tokens and site-only cookies."""
import json
import hashlib
import os
import io
import tarfile
from pathlib import Path

from cryptography.fernet import Fernet


class Vault:
    def __init__(self, directory, key=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory.chmod(0o700)
        self.path = self.directory / "credentials.enc"
        key = key or os.environ.get("CREDENTIAL_KEY")
        key_path = self.directory / "credential.key"
        if not key:
            if key_path.exists():
                key = key_path.read_bytes()
            elif self.path.exists():
                raise ValueError("CREDENTIAL_KEY is required to decrypt existing credentials")
            else:
                key = Fernet.generate_key()
                fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(key)
        self.cipher = Fernet(key.encode() if isinstance(key, str) else key)

    def load(self):
        bootstrap = os.environ.get("CREDENTIALS_ENCRYPTED")
        if bootstrap:
            digest = hashlib.sha256(bootstrap.encode()).hexdigest()
            marker = self.directory / ".bootstrap.sha256"
            previous = marker.read_text() if marker.exists() else None
            # An explicit new cloud secret replaces revoked cookies; unchanged secrets
            # must not overwrite the session cookies refreshed on the persistent disk.
            if previous != digest or not self.path.exists():
                value = json.loads(self.cipher.decrypt(bootstrap.encode()))
                self.save(value)
                marker.write_text(digest)
                marker.chmod(0o600)
                return value
        if not self.path.exists():
            return {}
        return json.loads(self.cipher.decrypt(self.path.read_bytes()))

    def save(self, value):
        payload = self.cipher.encrypt(json.dumps(value).encode())
        temp = self.path.with_suffix(".tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, self.path)

    def restore_browser_profile(self):
        """Decrypt only when starting a browser; preserve an existing live profile."""
        profile = self.directory / "google-browser"
        archive = self.directory / "google-browser.tar.enc"
        if profile.exists() or not archive.exists():
            return False
        data = self.cipher.decrypt(archive.read_bytes())
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as saved:
            for member in saved.getmembers():
                parts = member.name.split("/")
                if parts[0] != "google-browser" or ".." in parts or member.issym() or member.islnk():
                    raise ValueError("Browser archive contains an unsafe path")
            saved.extractall(self.directory, filter="data")
        profile.chmod(0o700)
        return True
