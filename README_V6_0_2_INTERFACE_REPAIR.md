# Банк крові V6.0.2 Interface Repair

Виправлено:
- залишки openRoleFeature більше не ламають сайт
- додано safeOpenFeature/openRoleFeature fallback
- прибрано залишки другорядного UI
- таблиці/журнали мають horizontal scroll і не вилазять за поля
- nav-кнопки не обрізаються
- audit XLSX/CSV як нормальні кнопки
- порожні картки не виглядають зламаними
- PWA cache v6.0.2

Після деплою:
1. Clear build cache & deploy
2. В браузері: Оновити кеш / або відкрити інкогніто
3. /api/version має показати V6.0.2
