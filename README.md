# Ali Helper

Минимальный Tampermonkey userscript для страниц товаров и отзывов AliExpress. Он очищает и переключает URL, перехватывает уже загружаемые данные, строит единую модель вариантов/SKU, поддерживает ограниченный сбор Reviews и копирует данные в обычном или ChatGPT-friendly виде.

## Установка

1. Откройте `src/ali-helper.user.js` как raw-файл или создайте новый userscript в Tampermonkey.
2. Вставьте содержимое файла целиком и сохраните.
3. Откройте страницу вида `https://aliexpress.ru/item/ITEM_ID.html`.

Скрипт не покупает, не добавляет в корзину, не отправляет сообщения продавцу и не изменяет аккаунт. Он читает загружаемые страницей данные, копирует текст, выполняет явную навигацию RU/COM или одну same-tab Product → Reviews навигацию после Product action и, пока действует ограниченная авторизация workflow, может проверенно и ограниченно прокручивать документ Reviews.

## Язык интерфейса

Ali Helper поддерживает английский и русский интерфейс. Переключатель `EN/RU`
находится в заголовке панели. Если сохранённого выбора ещё нет, helper выбирает
первый поддерживаемый язык браузера и использует английский как fallback, не
записывая вычисленное значение. Явный выбор пользователя сохраняется и
применяется после перезагрузки или перехода на другую страницу.

`EN/RU` меняет только интерфейс helper. Product action `RU / COM` независимо
переключает рынок AliExpress. Язык интерфейса не меняет Product/Reviews exports,
не запускает, не перезапускает, не продлевает и не изменяет сбор Reviews; само
переключение языка меняет только представление панели и не запускает Product/Reviews workflow, навигацию или прокрутку.

## Ограниченный сбор Reviews в 0.1.29

Основное Product action — `Collect product + reviews for ChatGPT` / `Собрать товар + отзывы для ChatGPT`. Нормальный workflow требует один явный пользовательский клик:

1. Helper создаёт ограниченный Product snapshot.
2. Один раз открывает Reviews того же item в той же вкладке, сохраняя только доказанный текущий `sku_id`, если он есть.
3. Недавний точный handoff автоматически запускает ограниченный Review workflow без второго подтверждения `Start review collection`.

Авторизация автоматического старта действует 60 секунд от создания Product workflow и никогда не выходит за полный срок handoff до 15 минут. Это короткое ограниченное окно запуска, а не обещание non-replayable security. Если 60 секунд истекли, но полный handoff ещё валиден, Reviews может показать явный fallback `Start review collection` / `Начать сбор отзывов`.

Прямых Helper Review API requests — 0. После автоматической или fallback-авторизации Helper выполняет только bounded verified document scrolling; возникающие из-за прокрутки native Review requests создаёт сама страница AliExpress. Ограничения: максимум 9 helper scroll activations, 15 секунд на шаг, до 120 секунд на automatic run в пределах срока handoff, retention presets 10/30/50/100 с default 30. Coverage может оставаться частичным; reload уже активного automatic workflow его не возобновляет.

Combined Product + Reviews output записывается в clipboard только отдельным явным copy action. Копирование само не запускает Review requests или прокрутку и не утверждает, что собраны все Reviews.

## Архитектура первой итерации

- `URL`: распознавание item page, сохранение `sku_id`, удаление известных tracking-параметров, RU/COM.
- `Sources`: перехват `fetch`/XHR `productData` на `document-start`; затем SSR JSON и React props как fallback.
- `Normalize`: единая модель `product`; комбинации берутся только из `priceList`, а значения связываются через `skuPropIds`.
- `Export`: отдельные чистые форматтеры для вариантов и ChatGPT — без зависимости от DOM.
- `Reviews`: нормальный однокликовый Product → Reviews workflow с 60-секундным auto-start и bounded fallback использует verified document scroll и native AliExpress Review requests, без собственного sender.
- `UI`: изолированная floating panel в Shadow DOM; настройки хранятся через Tampermonkey storage.

## Проверка

```text
npm test
```

Тесты покрывают URL normalization и две исследованные формы данных: `Bundle` 7×1 и `Color` 9 × `Size` 5 с 45 реальными SKU, включая разрешение выбранного SKU из URL и `sizeData`.
