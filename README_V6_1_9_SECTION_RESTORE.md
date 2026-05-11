# V6.1.9 SECTION RESTORE HOTFIX

Виправлено регресію після V6.1.8: кнопки `Склад`, `Dashboard PRO`, `Температура` викликали `safeOpenFeature('stock'/'dashboardPro'/'temperature')`, але фінальний override V6.1.8 перетворив `safeOpenFeature` на простий `show(id)`. Через це фронтенд шукав неіснуючі HTML id `stock`, `dashboardPro`, `temperature` замість `stockSec`, `dashboardProSec`, `temperatureSec`.

## Що зроблено
- Додано фінальний роутер секцій V6.1.9 у `static/shared.js`.
- Відновлено правильні alias-и:
  - `stock` → `stockSec`
  - `dashboardPro` → `dashboardProSec`
  - `temperature` → `temperatureSec`
  - `patient` → `patientsSec`
  - інші службові alias-и для QR, журналу, кошика, попереджень тощо.
- При відкритті секції автоматично запускаються відповідні loader-и:
  - `loadStock()`
  - `loadDashboardPro()`
  - `loadTemperature()`
- Виправлено дубльований `onclick` у кнопці `Пацієнт`.
- Пацієнт лишається окремим розділом і не повинен показуватись зверху в інших розділах.
- Для admin/transfusion примусово відновлено видимість `stockSec`, `dashboardProSec`, `temperatureSec`, `componentsSec` після застосування role visibility.

