# Банк крові V5.6.5 — Self-Healing Admin Fix

Знайдена помилка:
- у V5.6.4 ensure_default_admin був доданий, але виклик міг не виконуватись у потрібний момент після підключення PostgreSQL / init_db.
- Через це Sepsis / 1986 не створювався автоматично.

Виправлено:
- ensure_default_admin викликається після init_db()
- ensure_default_admin викликається перед login/index
- додано emergency browser endpoint:
  /api/admin/bootstrap-browser?token=API_TOKEN

Після деплою:
1. Render → Clear build cache & deploy
2. Відкрий сайт
3. Увійди:
   login: Sepsis
   password: 1986

Якщо все одно не створиться:
відкрий:
https://твій-сайт.onrender.com/api/admin/bootstrap-browser?token=ТВІЙ_API_TOKEN
