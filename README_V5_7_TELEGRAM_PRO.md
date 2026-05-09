# Банк крові V5.7 — Telegram PRO

Додано:
- персональне підключення Telegram для кожного користувача
- кнопка «Підключити Telegram»
- users.telegram_chat_id / telegram_username / telegram_enabled
- налаштування типів сповіщень
- Telegram webhook endpoint /telegram/webhook
- polling sync /api/telegram/poll
- команди бота:
  /stock
  /critical
  /requests
  /expiring

ENV додатково:
TELEGRAM_BOT_USERNAME=імʼя_бота_без_@
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...  # fallback/global chat

Порядок підключення:
1. Вказати TELEGRAM_BOT_USERNAME у Render.
2. Зайти в систему → Мій Telegram.
3. Натиснути «Підключити Telegram».
4. У Telegram натиснути START.
5. У системі натиснути «Синхронізувати START».
6. Натиснути «Тест мені».
