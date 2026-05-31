# Blood Bank V7.4.4 STABLE_LOGIN_FIX

Стартовий вхід після чистої БД:
- Логін: Sepsis
- Пароль: Sepsis1986

Аварійне відновлення адміністратора після деплою:
1. У Render Environment додати `API_TOKEN`.
2. Відкрити: `/api/emergency/reset-admin?token=ВАШ_API_TOKEN`
3. Увійти: `Sepsis / Sepsis1986`

Перевірка локально:
```bash
python smoke_test.py
```
