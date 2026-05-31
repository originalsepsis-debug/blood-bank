# AUDIT STATUS — V7.4.4 STABLE_LOGIN_FIX

## Виправлено
- Додано аварійне відновлення адміністратора: `/api/emergency/reset-admin?token=API_TOKEN`.
- Зафіксовано стандартний аварійний доступ: `Sepsis / Sepsis1986` через env `DEFAULT_ADMIN_*`.
- Seed admin більше не перезаписує існуючих користувачів, створюється тільки якщо немає активного admin, і не змушує міняти пароль при першому вході.
- Виправлено `current_user()` для коректної зміни пароля: додано `password_hash`.
- Login-сторінку ізольовано: без JS, без auto-reload, без dashboard/PWA-залежностей.
- Додано `smoke_test.py`.

## Не чіпалось
- Склад, рухи, звіти, Telegram, PWA, права ролей, логіка вимог.

## Перевірено локально
- Python compile.
- Flask app init на SQLite.
- GET `/login`.
- POST `/login` з `Sepsis / Sepsis1986`.
- GET `/api/public-health` без залежності від first-login redirect.
- GET `/api/emergency/reset-admin` без залежності від first-login redirect.
- Повторний login після reset-admin.
