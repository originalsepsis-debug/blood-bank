# Blood Bank V5 Core Pack

Додано:
- Журнал трансфузій
- QR/Barcode поле для пакета
- Темна тема
- Автосписання прострочених компонентів
- Dashboard V2
- Telegram alert-заготовка
- PWA cache покращено

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
Optional:
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
