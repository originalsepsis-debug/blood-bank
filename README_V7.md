Blood Bank V7.4.1 — Bugfix Validation UI Audit

# Blood Bank V7.4.1 — Security UI Polish

Чиста модульна версія банку крові. V7.4.1 — фінальне полірування безпеки: trace-кнопки без unit_code в inline JS, валідація дат, temperature roles, nurse_user_id і DB login rate-limit.

## Render variables

```text
DATABASE_URL=Internal PostgreSQL URL
SECRET_KEY=довгий стабільний секрет
API_TOKEN=довгий секрет для readiness
POSTGRES_ONLY=1
COOKIE_SECURE=1
REQUIRE_HTTPS=1
SESSION_TIMEOUT_MINUTES=60
MAX_CONTENT_LENGTH=52428800
TELEGRAM_BOT_TOKEN=опційно
```

Health check:

```text
/api/public-health
```

Readiness:

```text
/api/render-readiness?token=API_TOKEN
```

## Основні модулі V7

- авторизація, перший вхід, зміна пароля;
- ролі admin / transfusion / doctor / nurse;
- користувачі;
- повна картка пацієнта;
- повна форма вимоги;
- склад і одиниці компонентів;
- FEFO-підбір сумісних одиниць;
- часткова видача;
- повернення компонента;
- підтвердження використання;
- списання і протерміновані одиниці;
- рухи компонентів;
- звіти CSV / Excel / PDF / МОЗ-подібний Excel;
- кошик і відновлення;
- простежуваність;
- Telegram-модуль;
- температурний журнал;
- backup / restore;
- міграція V6 → V7;
- контроль цілісності;
- журнал дій;
- PWA і мобільна адаптація.

## V7.4.1 виправлення

- Прибрано `__pycache__` і `.pyc` з релізного ZIP.
- Додано PWA icons 192/512.
- Restore backup без secrets зберігає поточний Telegram bot token.
- Readiness показує security warning, якщо `SECRET_KEY` випадковий.
- Оновлено версію, manifest і service worker cache до V7.4.1.

## V7.1.1 виправлення

- Виправлено PostgreSQL readiness bug `request_id=''`.
- Обмежено доступ doctor/nurse до пацієнтів, складу, звітів і простежуваності.
- Додано реальні Flask cookie security settings і session timeout.
- Замінено небезпечні `SELECT MAX(id)` на безпечне отримання ID.
- Після restore/import оновлюються PostgreSQL sequences.
- Додано простий rate-limit логіну.
- ZIP очищено від `__pycache__`.

## V7.1.2 hardening

- Додано довідник компонентів і select у формах.
- Додано консервативну сумісність для еритроцитарних компонентів і плазми; тромбоцити/кріо лишаються точним збігом до локального затвердження правил.
- Telegram HTML-текст екранується перед відправкою.
- Додано MAX_CONTENT_LENGTH для upload backup/migration.
- Readiness у production вимагає API_TOKEN.
- Покращено audit details для редагувань.

## V7.1.5 виправлення

- Заблоковано весь інтерфейс і API для користувачів із `first_login=1`, крім `/change-password`, `/logout` і `/api/me`.
- Додано `patients.created_by`; лікар/медсестра бачать пацієнтів, яких створили напряму, а також пацієнтів зі своїх/призначених вимог.
- Уточнено логіку медсестри: медсестра бачить і може підтвердити використання по вимогах, де вона вказана в `nurse_name` або є автором вимоги.
- API тепер жорстко відхиляє `component_type`, якого немає в активному довіднику компонентів.
- Перед кожним restore автоматично створюється emergency backup поточної бази.
- Telegram bot token виключено з backup за замовчуванням; backup лишається конфіденційним, бо містить медичні дані.
- README і PWA оновлено до V7.1.5.

## Важливо

Backup-файли містять медичні дані, користувачів і журнали дій. Зберігати їх треба як конфіденційні службові архіви. Telegram bot token не включається у стандартний backup.

МОЗ Excel — це внутрішній МОЗ-подібний шаблон. Для точної офіційної форми потрібен затверджений зразок.


## V7.1.5 виправлення
- Додано мапінг legacy-компонентів при міграції V6→V7. Невідомі компоненти показуються в аналізі та пропускаються при імпорті.
- Додано скориговані підсумки звітів: факт, нетто, корекції, скориговано.
- Додано попередження, що backup містить медичні та персональні дані.
- Оновлено PWA/cache до V7.1.5.


## V7.4.1 FIX_TEMPERATURE_DEVICE_ID
- Додано валідацію числових параметрів `device_id`, `limit`, `user_id` із відповіддю 400 замість 500.
- Розділено дубльований `auditList` на `reportAuditList` і `systemAuditList`.
- Прибрано дубльований audit-запис при видаленні температурного запису.
- Для зміни пароля після першого входу додано перевірку старого пароля.
- Оновлено PWA cache і manifest до 7.4.1.
