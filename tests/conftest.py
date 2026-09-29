import os
import sys
import tempfile
from pathlib import Path

# Isolated storage for the whole test session - must be set before `server` is imported.
os.environ["PAYPREDICT_STORAGE"] = tempfile.mkdtemp(prefix="pp_test_")
os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from server.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


def _signup(client, email, business):
    r = client.post("/api/auth/signup", json=dict(name="Test User", email=email, password="test-pass-123", business_name=business))
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


@pytest.fixture(scope="session")
def org_a(client):
    """A business with the sample ledger loaded (trains a real model once per session)."""
    h = _signup(client, "owner-a@example.com", "Alpha Packaging")
    assert client.post("/api/import/sample", headers=h).status_code == 200
    return h


@pytest.fixture(scope="session")
def org_b(client):
    return _signup(client, "owner-b@example.com", "Beta Traders")
