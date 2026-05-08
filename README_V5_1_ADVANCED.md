# Blood Bank V5.1 Advanced Improvements

Додано:
- QR/Barcode scanner через камеру (BarcodeDetector)
- Offline queue для POST дій
- Browser/PWA notifications test
- Роль медсестри розширена: може відмічати використання, списання, реакції
- Автоматичний backup раз на AUTO_BACKUP_HOURS при активності системи
- Dashboard графічні bar-блоки
- Security audit endpoint
- PWA service worker cache v5.1

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
Optional:
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
