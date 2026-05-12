# V6.1.6 Patient / Components / iPhone Scanner Fix

- Пацієнт більше не блокується role-hidden/safeShow.
- Картки компонентів не вилазять: на вузькому екрані стають в 1 колонку.
- iPhone/Safari: ручний ввід QR/Barcode винесено наверх; file/camera залишено як допоміжний варіант.
- Пояснення: Safari/iPhone не підтримує BarcodeDetector, тому реальне сканування камерою можливе тільки через зовнішній JS-декодер або ручний ввід.
