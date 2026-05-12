# Банк крові V6.0 Stable Clean Architecture

Чистий стабільний реліз після V5.x.

Зроблено:
- прибрано другорядний новий UI
- залишено класичний робочий інтерфейс
- централізована ROLE_PERMISSIONS
- API /api/permissions
- API /api/version
- API /api/health
- PostgreSQL safe rollback/autocommit з V5.9.5 збережено
- PWA cache v6.0
- Audit XLSX/CSV як кнопки
- doctor/nurse/admin/transfusion отримують різний доступ
- збережено Telegram, PWA, QR/Barcode, traceability, incompatibility, temperature, writeoffs, daily reports

Після деплою:
1. /api/tx-reset
2. /api/health
3. /api/health-debug
4. login
