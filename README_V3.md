V3: backup/restore, session timeout, login lockout, IP audit, ABO/Rh compatibility, expiry alerts, patient history, PDF/Excel, PWA, dashboard.
Build: pip install -r requirements.txt
Start: gunicorn app:app
ENV: SECRET_KEY COOKIE_SECURE=1 REQUIRE_HTTPS=1 DEBUG=0 optional DB_PATH=/var/data/blood_bank_v3.db BACKUP_DIR=/var/data/backups
