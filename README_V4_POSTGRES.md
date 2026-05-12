# Blood Bank V4 PostgreSQL Edition

Build Command:
pip install -r requirements.txt

Start Command:
gunicorn app:app

Environment Variables:
SECRET_KEY=long_secret
COOKIE_SECURE=1
REQUIRE_HTTPS=1
DEBUG=0
SESSION_TIMEOUT_MINUTES=30
DATABASE_URL=<Render Internal Database URL>
BACKUP_DIR=backups

SQLite fallback works without DATABASE_URL for local testing.
PostgreSQL is recommended on Render so data does not disappear without Persistent Disk.
