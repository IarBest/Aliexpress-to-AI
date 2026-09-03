# Ali Helper

Минимальный Tampermonkey userscript для страниц товаров и отзывов AliExpress. Он очищает и переключает URL, перехватывает уже загружаемые данные, строит единую модель вариантов/SKU, поддерживает ограниченный сбор Reviews и копирует данные в обычном или ChatGPT-friendly виде.

## Установка

1. Откройте `src/ali-helper.user.js` как raw-файл или создайте новый userscript в Tampermonkey.
2. Вставьте содержимое файла целиком и сохраните.
3. Откройте страницу вида `https://aliexpress.ru/item/ITEM_ID.html`.

Скрипт не покупает, не добавляет в корзину, не отправляет сообщения и не изменяет аккаунт. Он читает загружаемые страницей данные, копирует текст, выполняет только явную навигацию RU/COM или Product → Reviews и после отдельного подтверждения может ограниченно прокручивать документ Reviews.

## Язык интерфейса

Ali Helper поддерживает английский и русский интерфейс. Переключатель `EN/RU`
находится в заголовке панели. Если сохранённого выбора ещё нет, helper выбирает
первый поддерживаемый язык браузера и использует английский как fallback, не
записывая вычисленное значение. Явный выбор пользователя сохраняется и
применяется после перезагрузки или перехода на другую страницу.

`EN/RU` меняет только интерфейс helper. Product action `RU / COM` независимо
переключает рынок AliExpress. Язык интерфейса не меняет Product/Reviews exports,
не запускает, не перезапускает, не продлевает и не изменяет сбор Reviews; само
переключение языка не создаёт network traffic.

## Ограниченный сбор Reviews в 0.1.28

Workflow намеренно требует два явных клика:

1. На Product нажмите `Collect reviews for ChatGPT` / `Собрать отзывы для ChatGPT`. Helper сохраняет ограниченный Product snapshot и один раз открывает соответствующий Reviews route в той же вкладке.
2. На Reviews нажмите `Start review collection` / `Начать сбор отзывов`. Только этот второй клик разрешает автоматическую прокрутку Reviews.

Открытие, восстановление или reload Reviews сами по себе никогда не запускают
прокрутку. Helper не формирует и не отправляет прямые Review API requests. После
второго клика bounded document scroll может вызвать native Review requests самой
страницы AliExpress. Сбор можно отменить; максимум — 9 helper scroll activations,
15 секунд на шаг и до 120 секунд на автоматический run в пределах срока handoff.
Retention presets: 10/30/50/100, по умолчанию 30; coverage может быть частичным.

Combined Product + Reviews export записывается в clipboard только после
отдельного явного copy action и сам не вызывает Review requests или прокрутку.

## Архитектура первой итерации

- `URL`: распознавание item page, сохранение `sku_id`, удаление известных tracking-параметров, RU/COM.
- `Sources`: перехват `fetch`/XHR `productData` на `document-start`; затем SSR JSON и React props как fallback.
- `Normalize`: единая модель `product`; комбинации берутся только из `priceList`, а значения связываются через `skuPropIds`.
- `Export`: отдельные чистые форматтеры для вариантов и ChatGPT — без зависимости от DOM.
- `Reviews`: двухкликовый bounded workflow использует только document scroll и native AliExpress Review requests, без собственного sender.
- `UI`: изолированная floating panel в Shadow DOM; настройки хранятся через Tampermonkey storage.

## Проверка

```text
npm test
```

Тесты покрывают URL normalization и две исследованные формы данных: `Bundle` 7×1 и `Color` 9 × `Size` 5 с 45 реальными SKU, включая разрешение выбранного SKU из URL и `sizeData`.
