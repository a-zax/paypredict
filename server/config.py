"""Runtime configuration shared by the API and services."""
import os
import secrets

from .db import STORAGE

_secret_file = STORAGE / ".secret"
if os.environ.get("PAYPREDICT_SECRET"):
    SECRET = os.environ["PAYPREDICT_SECRET"]
else:
    if not _secret_file.exists():
        _secret_file.write_text(secrets.token_hex(32))
    SECRET = _secret_file.read_text().strip()

# Public base URL used in links sent to buyers (pay pages). Falls back to the request's own URL.
PUBLIC_URL = os.environ.get("PAYPREDICT_PUBLIC_URL", "").rstrip("/")
