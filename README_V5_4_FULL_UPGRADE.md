# Blood Bank V5.4 Full Upgrade

Додано:
- V5.2: розширений реєстр реакцій, електронне підтвердження трансфузії
- V5.3: API endpoints для інтеграцій, external event, API token
- V5.4: Dockerfile, docker-compose, nginx.conf, migrations.py, full audit endpoint, backup encryption status placeholder

Render:
Build: pip install -r requirements.txt
Start: gunicorn app:app

ENV:
SECRET_KEY=...
COOKIE_SECURE=1
REQUIRE_HTTPS=1
DEBUG=0
SESSION_TIMEOUT_MINUTES=30
DATABASE_URL=postgresql://...
AUTO_BACKUP_HOURS=24
API_TOKEN=довгий_api_ключ
Optional:
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
BACKUP_ENCRYPTION_KEY=...
