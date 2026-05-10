# Банк крові V5.4.5 — Label/PWA Fix

Виправлено:
- PWA install name більше не показує V3
- Login screen більше не показує V4
- manifest.json оновлено
- service-worker cache змінено на blood-bank-v5-4-5-cache
- додано /api/version

Після деплою:
1. GitHub commit
2. Render → Manual Deploy → Clear build cache & deploy
3. На телефоні видалити стару PWA і встановити заново
4. Або очистити кеш сайту
