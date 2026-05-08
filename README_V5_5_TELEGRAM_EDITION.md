# Банк крові V5.5 — Telegram Edition

Додано:
- Telegram status page
- Test Telegram button
- Telegram delivery logs
- Retry queue
- Anti-spam duplicate suppression
- Silent mode: TELEGRAM_SILENT_START / TELEGRAM_SILENT_END
- Event hooks: нова вимога, реакція, backup, notification test

Render Environment Variables:
TELEGRAM_ENABLED=1
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
TELEGRAM_SILENT_START=22
TELEGRAM_SILENT_END=7
TELEGRAM_ANTI_SPAM_MINUTES=10

Як отримати chat_id:
1. Напиши своєму боту будь-яке повідомлення.
2. Відкрий: https://api.telegram.org/bot<TOKEN>/getUpdates
3. Знайди chat.id
