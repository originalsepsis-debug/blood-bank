#!/usr/bin/env python3
"""Local smoke test for Blood Bank V7.4.4.
Run: python smoke_test.py
It uses SQLite test DB and does not touch production DATABASE_URL.
"""
import os
import tempfile

os.environ.pop("DATABASE_URL", None)
os.environ["SQLITE_PATH"] = os.path.join(tempfile.gettempdir(), "blood_bank_smoke_v744.sqlite3")
os.environ.setdefault("SECRET_KEY", "smoke-test-secret")
os.environ.setdefault("API_TOKEN", "smoke-token")
os.environ.setdefault("DEFAULT_ADMIN_USERNAME", "Sepsis")
os.environ.setdefault("DEFAULT_ADMIN_PASSWORD", "Sepsis1986")
try:
    os.remove(os.environ["SQLITE_PATH"])
except FileNotFoundError:
    pass

from bloodbank import create_app

app = create_app()
client = app.test_client()

checks = []
def check(name, ok, detail=""):
    checks.append((name, bool(ok), detail))
    print(("OK   " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

r = client.get("/login")
check("GET /login", r.status_code == 200 and "Банк крові" in r.get_data(as_text=True), str(r.status_code))

r = client.post("/login", data={"username":"Sepsis", "password":"Sepsis1986"}, follow_redirects=False)
check("POST /login default admin", r.status_code in (302, 303), str(r.status_code))

r = client.get("/api/public-health")
check("GET /api/public-health", r.status_code == 200 and r.json.get("ok"), str(r.status_code))

r = client.get("/api/emergency/reset-admin?token=smoke-token")
check("GET /api/emergency/reset-admin", r.status_code == 200 and r.json.get("ok"), str(r.status_code))

r = client.post("/login", data={"username":"Sepsis", "password":"Sepsis1986"}, follow_redirects=False)
check("POST /login after reset", r.status_code in (302, 303), str(r.status_code))

bad = [c for c in checks if not c[1]]
if bad:
    raise SystemExit(1)
print("Smoke test passed")
