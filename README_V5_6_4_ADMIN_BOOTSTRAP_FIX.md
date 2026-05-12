# Банк крові V5.6.4 — Admin Bootstrap Fix

Виправлено:
- якщо в PostgreSQL немає активного admin, система сама створить:
  login: Sepsis
  password: 1986
- додано emergency endpoint:
  POST /api/admin/bootstrap
  Header: X-API-Token: твій API_TOKEN

Після деплою:
Render → Manual Deploy → Clear build cache & deploy
