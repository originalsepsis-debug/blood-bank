# Blood Bank V4 PostgreSQL FIX

Виправлено помилку:
`DB startup init error: 'NoneType' object has no attribute 'fetchone'`

## Render
Build Command:
pip install -r requirements.txt

Start Command:
gunicorn app:app

Environment Variables:
SECRET_KEY=...
COOKIE_SECURE=1
REQUIRE_HTTPS=1
DEBUG=0
SESSION_TIMEOUT_MINUTES=30
DATABASE_URL=postgresql://...

Після деплою перевір:
`/api/system/db`
має бути `ok: true`, `postgres: true`.
