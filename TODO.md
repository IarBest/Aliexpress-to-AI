# TODO

Живой технический roadmap Ali Helper. P0 закрыт после успешного live
Tampermonkey smoke test. Следующий практический этап — shipping для current
selected SKU (P2); расширение product extraction (P1: characteristics,
description, rating/store/gallery и т. д.) выполняется после shipping. Нумерация
разделов сохранена как классификация roadmap, а не как фактический execution
order.

## Definition of done

Пункт считается завершённым только если:

- [ ] код реализован и ограничен заявленной задачей;
- [ ] regression tests добавлены или обновлены;
- [ ] весь test suite проходит;
- [ ] `node --check src/ali-helper.user.js` проходит;
- [ ] relevant live smoke test выполнен, если изменение зависит от Tampermonkey,
      браузерного sandbox или актуальной страницы AliExpress;
- [ ] документация обновлена, если изменилось пользовательское поведение;
- [ ] diff проверен на случайные и чувствительные данные;
- [ ] изменение оформлено отдельным понятным логическим commit.

Checkbox нельзя отмечать только потому, что код написан. При изменении схемы
AliExpress нужно зафиксировать фактическое расхождение и сохранить корректную
регрессию, а не подгонять fixture под parser.

## P0 — Correctness / baseline fixes

P0 являлся обязательным gate перед P1–P7 и закрыт после успешного live
Tampermonkey smoke test на актуальном userscript после commit `d48de66`.

### Настоящий `sizeData` и единицы измерения

Текущий `normalizeSizeGuide()` передаёт unit только из полей объекта и теряет
единицы, когда `CM` и `IN` являются ключами `byUnitTables`.

- [x] Добавить минимизированный regression fixture с реальным shape
      `byCountryTables -> byUnitTables -> CM/IN`.
- [x] Научить parser распознавать unit из ключа `byUnitTables`, не требуя поля
      `unit` внутри таблицы.
- [x] Сохранить две различимые normalized tables: `CM` и `IN`.
- [x] Сохранить generic fallback для иных table-like shapes.
- [x] Проверить порядок columns/rows и отсутствие смешивания CM/IN.
- [x] Проверить ChatGPT export: обе таблицы имеют явные unit labels.

Acceptance: настоящий AliExpress shape даёт две таблицы с корректными units;
существующие generic cases продолжают работать.

### Обновление selected SKU без реконструкции товара

Сейчас `scanFallbacks()` преобразует normalized model обратно в искусственный
`productData`, затем повторно вызывает `normalizeProduct()`. Это может потерять
raw SKU fields, buyer price, discount и будущие store/description/delivery/review
данные.

- [x] Добавить чистую операцию наподобие `updateSelectedSku(product, currentUrl)`.
- [x] При SPA-изменении только `sku_id` обновлять `selectedSkuId`, `selectedSku`,
      selected price и stock без повторной нормализации всего товара.
- [x] Сохранять остальные ссылки/поля normalized model неизменными, включая raw
      SKU data, buyer price, discount, size guide и будущие разделы.
- [x] Добавить unit test перехода с одного существующего SKU на другой.
- [x] Добавить unit test неизвестного/отсутствующего `sku_id` и documented
      fallback к `activeSkuId` только там, где это действительно уместно.
- [x] Проверить, что normalized model и export отражают новый selected SKU,
      variant, price и stock; status panel при этом показывает runtime/extraction
      status и не обязан дублировать выбранный SKU.

Acceptance: SPA URL change корректно меняет выбранную комбинацию, цену и stock,
не пересоздавая и не обедняя normalized product.

### Реальные regression fixtures

Regression tests используют обезличенные автоматически минимизированные
fragments фактически captured `productData` responses. Fixtures сохраняют
исходный `{ data: ... }` wrapper и captured structural values; synthetic objects
допустимы только для изолированных generic unit tests.

- [x] Добавить Fixture A для item `1005008195850531` с настоящими именами полей
      и значений: `Bundle` — 7 values, `priceList` — 7 SKU.
- [x] Проверить Fixture A: каждая комбинация происходит из `priceList`, а не из
      Cartesian product.
- [x] Добавить Fixture B для item `1005009452926938`: `Color` — 9, `Size` — 5,
      `priceList` — 45 SKU.
- [x] Проверить Fixture B: SKU `12000049151727540` соответствует
      `Lining B Navy Blue + L`.
- [x] Сохранить в Fixture B raw Color `name: "Clear"` и проверить human-facing
      `displayName: "Lining B Navy Blue"`.
- [x] Включить в Fixture B настоящий `sizeData` с CM и IN, не упрощая shape ради
      текущего parser.
- [x] Удалить из fixtures персональные, auth и tracking данные.
- [x] Оставить fixtures читаемыми и достаточно маленькими для review.

Acceptance: реальные counts, ID relations, `displayName` preference и обе size
tables проверяются без искусственно сгенерированных комбинаций.

### Live Tampermonkey smoke test

Node tests не проверяют `document-start`, `unsafeWindow`, реальный fetch/XHR
interceptor и Tampermonkey storage. Перед важными release milestones выполнять
и записывать результат этого manual checklist:

- [x] Установить актуальный `src/ali-helper.user.js` в Tampermonkey.
- [x] Сделать fresh reload item page, не полагаясь на уже hydrated SPA state.
- [x] Проверить, что interceptor ловит настоящий `productData`.
- [x] Проверить переход панели `Waiting -> Ready` без ручных кликов по SKU.
- [x] Для item `1005008195850531` увидеть status
      `Ready · 7 combinations · Bundle: 7 · source: API`.
- [x] Проверить, что Copy variants содержит ровно 7 реальных комбинаций.
- [x] Сменить SKU на странице и проверить в normalized model и Copy for ChatGPT:
      SKU `12000056550848689`, `Bundle: 433 Remote`, price `$1.92`, regular price
      `$3.20`, stock `1000`.
- [x] Проверить Copy clean URL: tracking удалён, `sku_id` сохранён.
- [x] Проверить `.com -> .ru` при включённой настройке и отсутствие redirect при
      выключенной.
- [x] Проверить сворачивание панели и сохранение settings после reload.
- [x] Проверить clipboard actions панели.
- [x] Убедиться, что script не выполняет cart, Buy now, subscribe, messaging,
      checkout или другие account mutations.

Acceptance: checklist проходит в реальном Tampermonkey runtime; найденные
region/session differences документируются отдельно от parser regressions.

## P1 — Product extraction

### Gallery

- [x] Найти structured gallery в `productData`/page data раньше DOM fallback.
- [x] Нормализовать main product image URLs и preview URLs без автоматического
      скачивания.
- [x] Сохранить video URL и poster/preview, если они однозначно доступны.
- [x] Сохранить исходный порядок gallery и удалить только точные дубликаты.
- [x] Добавить cases без video, с video и с отсутствующей gallery.

Текущий подтверждённый runtime source — product-level `props.gallery` из
`#__AER_DATA__`. Поиск bounded и structural, с точным совпадением item ID;
глубокий widget path не хардкодится. Gallery path в `productData` API пока не
подтверждён и не реализован. Scoped `SnowProductGallery` DOM исследован, но
production DOM fallback намеренно отложен: hydrated DOM содержит leading
current SKU-main, который пока нельзя надёжно отделить в DOM-only case. Поэтому
runtime работает fail-closed и использует только подтверждённый SSR source;
description, recommendation, store и injected images с Gallery не смешиваются.

Live Tampermonkey smoke подтверждён 2026-08-12:

- item `1005008195850531`: SSR source, 7 items, первый item — video
  `5000454646732.mp4`; current SKU-main не добавлен. Сохранились rating/trade,
  8 characteristics, 106 description blocks и native delivery;
- item `1005009452926938`: SSR source, 7 items, первый item — video
  `5000259286007.mp4`; SKU switch до `12000049151727540` сохранил Gallery,
  `Lining B Navy Blue + L`, price `$26.08`, rating/trade, 5 characteristics и
  47 description blocks;
- item `1005005933779962`: SSR source, 6 image items, video отсутствует;
  current SKU-main не добавлен. Сохранились rating/trade, 7 characteristics,
  8 description blocks и native delivery.

После fail-closed correction отдельный fresh reload item `1005008195850531`
повторно подтвердил SSR source, 7 items, первый video и Gallery перед Description
в Copy for ChatGPT.

Acceptance: `product.gallery` не зависит от ChatGPT formatter и не включает
картинки recommendation/store/extension DOM.

### Basic rating and trade summary

- [x] Извлечь product rating из structured data, затем semantic DOM fallback.
- [x] Нормализовать reviews/ratings count и bought/orders count.
- [x] Разделить неизвестное значение, настоящий `0` и отсутствующий источник.
- [x] Добавить regression tests для чисел с locale formatting (`3K`, пробелы,
      запятая как decimal separator).

Live Tampermonkey smoke подтверждён 2026-08-12:

- item `1005008195850531`: rating `5`, reviews `5`, bought `13`; Copy product
  также сохранил 8 characteristics и seller description (106 blocks);
- item `1005009452926938`: rating `4.6`, reviews `36`; исторический fixture
  зафиксировал bought `413`, а повторный fresh reload показал естественно
  выросший live DOM count `414`; Copy product также сохранил 5 characteristics
  и seller description (47 blocks);
- дополнительный item `1005005933779962`: rating `4.8`, reviews `66`, bought
  `337`; pre-export hydration race закрыт синхронным fallback enrichment перед
  Copy product / Copy for ChatGPT, при этом сохранились 7 characteristics и
  seller description с первым image URL.

Acceptance: rating и trade counts попадают в normalized model без смешивания с
seller rating или recommendation cards.

### Store / seller

- [x] Извлечь store name и store URL из подтверждённого store-level
      `#__AER_DATA__` и scoped `#storeInfo` / `RedStoreInfo` DOM.
- [x] Получить store ID только из подтверждённого URL shape
      `https://aliexpress.ru/store/<digits>`.
- [ ] Подтвердить `sellerId` в реально captured raw `productData` response и,
      если поле действительно существует и однозначно связано с current item,
      поставить его выше текущих SSR/DOM sources.
- [x] Использовать текущий production priority для seller ID: matched
      store-level `#__AER_DATA__` → `seller_id` из scoped `#storeInfo` chat URL
      → `null`.
- [x] Извлечь seller rating percentage и subscribers без включения
      неподтверждённых дополнительных store stats.
- [x] Хранить item rating отдельно от seller rating.
- [x] Не включать Megabonus и другой third-party injected DOM.
- [x] Добавить captured WLIN regression: store ID `1103330026`, seller ID
      `2677490623`, seller rating `84.98%`, subscribers display `3K`.
- [x] Проверить partial/absent Store и fail-closed conflicting/current-item
      cases.

Реализованная normalized модель `product.store` содержит `name`, `url`,
`storeId`, `sellerId`, `sellerRating { kind, value, display }` и
`subscribers { value, display }`. `storeId` и `sellerId` — разные идентификаторы;
seller rating остаётся percentage и не преобразуется в 5-star scale. Store
widget `"item's rating"` не экспортируется. `positiveReviews.number`, store
stats/tags/orders не используются. DOM читается только внутри `#storeInfo`, а
initial `#__AER_DATA__` не переносится на другой SPA item. Текущие production
sources не выполняют дополнительных network requests.

Live Tampermonkey smoke 2026-08-13 на реально активном Ali Helper `v0.1.7`:

- WLIN / Dress `1005009452926938`: `WLIN OOTD Store`, store ID `1103330026`,
  seller ID `2677490623`, seller rating `84.98` / `84,98% seller's rating`,
  subscribers raw `2920` / display `3K subscribers`. Product rating `4.6`
  остался отдельным, `"item's rating"` не экспортировался; SKU switch сохранил
  Store, Gallery, characteristics и description. Captured fixture остаётся с
  историческим raw subscribers `2919`.
- Needles `1005005933779962`: `Better off Store`, store ID `1100036170`, seller
  ID `2660067190`, seller rating `94.09` / `94,09% seller's rating`, subscribers
  `320` / `320 subscribers`. Одновременно сохранились delivery, rating/trade,
  characteristics, Gallery и Description.
- Relay `1005008195850531`: `Scimagic-RC CHN Long Store`, store ID `5041265`,
  seller ID `238863723`, seller rating `91.64` / `91,64% seller's rating`,
  subscribers raw `3809` / display `4K subscribers`. Значения являются
  динамическим live observation; drift от предыдущего наблюдения нормален.

Acceptance: store/seller model формируется только из scoped semantic sources;
item и seller ratings не смешиваются.

### Characteristics

- [x] Добавить scoped DOM extractor для
      `[class*="HazeProductCharacteristics__itemForSku"]`.
- [x] Читать name/value через стабильные fragments
      `ProductCharacteristicsItem__name__` и
      `ProductCharacteristicsItem__value__`.
- [x] Не использовать полный CSS-module hash.
- [x] Нормализовать пары name/value с сохранением отображаемого порядка.
- [x] Считать отсутствие characteristics допустимым partial result.
- [x] Добавить DOM fixture/case, доказывающий исключение third-party DOM.

Live Tampermonkey smoke подтверждён для item `1005009452926938` (5 пар) и
`1005008195850531` (8 пар). Смена SKU платья не изменила product-level
characteristics. Естественный same-tab SPA переход между товарами через текущий
AliExpress UI не воспроизводится; защита от stale characteristics между items
остаётся покрыта regression test.

Acceptance: normalized `characteristics` содержит только product pairs, а
отсутствующий блок не переводит весь product extraction в error.

### Full seller description

- [ ] Найти original React `dangerouslySetInnerHTML.__html` для
      `#content_anchor` как preferred source.
- [x] Использовать `#content_anchor.innerHTML` как fallback.
- [x] Не считать краткий `productData.description` полным seller description.
- [x] Разобрать description в `{ rawHtml, blocks, text, images }`.
- [x] Сохранять исходный порядок headings, text, images, links и других полезных
      блоков вместо раздельного flattening.
- [x] Нормализовать относительные/protocol-relative image URLs без скачивания.
- [x] Исключить scripts, styles и unsafe markup из human text export, сохраняя
      диагностический raw HTML согласно принятой модели.
- [x] Добавить cases mostly-text, mostly-images и чередующихся text/image blocks.

Live Tampermonkey smoke подтверждён 2026-08-11:

- item `1005008195850531`: raw HTML — 9122 chars, 106 blocks, 40 images;
- item `1005009452926938`: raw HTML — 4726 chars, 47 blocks, 41 images;
- captured dress regression сохраняет порядок `4 images → h1 "A/B"`;
- ChatGPT export сохраняет document order, выводит все description image URLs
  и не включает `rawHtml`;
- SKU `12000049151727540 → 12000049151727530` не изменяет product-level
  description;
- повторные runtime scans не вызывают лишний UI update.

React original HTML в доступном browser execution context не обнаружен;
соответствующий preferred-source TODO остаётся открытым.

Acceptance: порядок seller content восстанавливается, а image URLs остаются
связаны с соответствующими разделами.

## P2 — Shipping for selected SKU

- [x] Зафиксировать минимизированный request/response fixture `calculate` для
      одного SKU без account-sensitive данных.
- [ ] Построить SKU-specific payload из `productId`, selected `skuId`, buyer
      price, count, destination/currency и `freightExt` только при необходимости.
- [x] Не использовать `logisticAmount` как стоимость доставки.
- [x] Нормализовать method/group, `serviceName`, cost, currency, ETA/date range
      и destination, если оно известно.
- [x] Связать shipping result с конкретным SKU ID в normalized model.
- [ ] По умолчанию запрашивать shipping только для selected SKU по явному
      действию или строго контролируемому current-SKU flow.
- [x] Кэшировать результат по SKU/request context в рамках page session.
- [x] Инвалидировать/переключать displayed shipping при смене selected SKU.
- [ ] Показать partial/error state при unavailable/blocked `calculate` response.
- [x] Добавить tests для free, paid и нескольких shipping methods.

Passive runtime binding, page-session cache и защита от stale delivery
подтверждены вторым live Tampermonkey smoke test. Ali Helper по-прежнему не
строит и не отправляет собственный `calculate` request.

Acceptance: стоимость и ETA принадлежат конкретному SKU; массовых запросов и
подмены shipping через `logisticAmount` нет.

## P3 — Review summary and SSR reviews

### Review summary

- [x] Нормализовать product rating, total reviews, content feedback count и
      bought count из structured/semantic sources.
- [x] Извлечь 5★/4★/3★/2★/1★ distribution без зависимости от полного CSS hash.
- [x] Проверять сумму star distribution против review count, когда все значения
      доступны; mismatch показывать как diagnostic, а не скрывать.
- [x] Сохранить buyer photos count из отдельного summary source.
- [x] Добавить optional `reviewTopics` из подтверждённого scoped DOM.
- [x] Добавить реальные captured regressions для Review Summary на текущих
      товарах; historical roadmap reference `4.8 / 610 / 283 / 2001 /
      562-27-6-5-10` не превращать в fixture, поскольку provenance/item ID не
      восстановлены. В git history найдено только его появление в commit
      `c2359ccd01aee28b3f8cbd5373c5d2cd2bc76dbd` (`docs: add project roadmap`),
      без исходного capture.

Normalized extension реализован в существующем `ratingSummary`:

```text
ratingSummary {
  rating, reviewCount, contentFeedbackCount, boughtCount,
  starDistribution, buyerPhotosCount, reviewTopics,
  diagnostics {
    starDistributionTotal, starDistributionMatchesReviewCount
  },
  display { rating, reviewCount, boughtCount, buyerPhotosCount }
}
```

Structured boundary: `#__AER_DATA__` → `RedReviewsContextWidget` → доказанно
связанный с exact current item `RedReviewsTabs` → descendant
`RedReviewsProductFeedbackList`. `reviewCount` и `contentFeedbackCount` — разные
поля. Семантика raw `review.productFeedbacksCount` остаётся нейтральной, поэтому
normalized name — `contentFeedbackCount`.

DOM boundary начинается с parent `#reviews_anchor` и принимается только при
наличии `RedReviewsTabs__desktop__` и
`GlowReviewsProductRating_MainSection__mainSection__`. Star grade определяется
количеством active stars, а не row index. Полная distribution сохраняется и при
mismatch, который отражается в diagnostics. Buyer photos берутся из отдельного
`View all (N)`, а не по числу rendered thumbnails. `reviewTopics` optional и
fail-closed при неподтверждённой locale/section semantics. Bought продолжает
использовать existing product-header DOM source; подтверждённого structured
bought source нет.

Live smoke 2026-08-13 на реально активном Ali Helper v0.1.8:

- Relay `1005008195850531`: rating 5; reviews 5; content feedbacks 2; bought 13;
  stars `5/0/0/0/0`; star total 5; matches reviews yes; buyer photos null;
  topics null.
- Dress `1005009452926938`: rating 4.6; reviews 36; content feedbacks 30;
  bought 414; stars `29/3/2/2/0`; star total 36; matches reviews yes; buyer
  photos 31; topics 7. Summary показывал 31 при 30 rendered thumbnails.
- Needles `1005005933779962`: rating 4.8; reviews 66; content feedbacks 12;
  bought 338; stars `60/2/1/1/2`; star total 66; matches reviews yes; buyer
  photos 8; topics 6.

`Copy product` и `Copy for ChatGPT` сохраняли Review Summary вместе со Store,
Gallery, Characteristics, Description, selected SKU и price. Delivery на
последнем Dress reload естественно отсутствовала; preservation при существующем
capture покрыт regression test. Live counts — dated observations, а не вечные
expectations.

Individual reviews и pagination в этот scope не входят; дополнительных
review/API requests реализация не делает.

Acceptance: значения summary не смешиваются между product, seller и content
feedback; полная star distribution сохраняется и честно диагностируется.

### First-page SSR reviews

- [x] Распознавать `/item/ITEM_ID/reviews` как отдельный read-only page context.
- [x] Рекурсивно искать `RedReviewsProductFeedbackList/*` с массивом reviews
      структурно, без hardcoded deep `widgets[...]` path.
- [x] Ограничивать traversal depth/visited nodes и выдавать safe schema
      diagnostics.
- [x] Нормализовать review как `{ id, productId, skuProperties, reviewer,
      initial, additional, likesAmount }`.
- [x] В `initial` сохранять `dateRaw`, grade, displayed text, `originalText`,
      images и comments.
- [x] В reviewer сохранять display name, initials, avatar URL и country flag URL.
- [x] Использовать human `product.skuProperties` verbatim, не восстанавливать
      SKU через product matrix.
- [x] Дедуплицировать только по устойчивому `${productId}:${reviewId}`.

Acceptance: первая SSR page извлекается без собственных network requests;
`initial` и `additional` остаются независимыми; conflicting/malformed schema
fail closed; safe diagnostic не содержит raw review данных.

#### Reviews page context и SSR source

Фактический route — `/item/<ITEM_ID>/reviews`. Item ID берётся только из
pathname; query-параметры `sku_id`, `spm` и прочие не участвуют в item binding.
Семантика существующих PDP helpers `isItemPage`/`getItemId` не менялась.
Reviews page использует отдельный runtime, где productData и shipping
interceptors не запускаются.

Production candidate — widget family `RedReviewsProductFeedbackList/*`; numeric
widget version, включая наблюдавшуюся `0.35.0`, не хардкодится. Guards:
`placement === "PRP"`, `pageArea === "screen"`, а `props.reviews` является
непустым массивом. Каждый review обязан иметь
`record.product.id === item ID из pathname`; отсутствующий или несовпадающий ID
делает весь candidate недоверенным. Deep `widgets[...]` path не является частью
production schema.

#### Normalized model

```text
review {
  id,
  productId,
  skuProperties,
  reviewer { displayName, initials, avatarUrl, countryFlagUrl },
  initial {
    dateRaw, grade, text, originalText,
    images [{ id, url }],
    comments [{
      id, authorDisplayName, authorInitials, authorAvatarUrl,
      dateRaw, text, originalText
    }]
  },
  additional: null | {
    id, dateRaw, grade, text, originalText, images, comments
  },
  likesAmount
}
```

`text` и `originalText` не схлопываются, а `dateRaw` не преобразуется в Date.
`additional` сохраняет собственные ID/rating/content; effective text/rating не
вычисляются. `interaction.isLiked`, analytics и tracking не входят в normalized
или export model. Country code/name не выводятся из имени SVG-файла; роль автора
comment не угадывается.

#### Dedupe, conflicts и safe diagnostics

Dedupe key — `${productId}:${id}`. Для полностью одинакового normalized review
с тем же key сохраняется первое вхождение; conflicting content с тем же key
делает candidate недоверенным. Несколько identical ordered SSR candidates
допустимы, conflicting candidates fail closed; lists не объединяются. Text,
date и reviewer для dedupe не используются.

Безопасные diagnostic states: `ok`, `invalid-item-id`, `no-candidate`,
`invalid-candidate`, `conflicting-candidates`, `traversal-limit`. Они не содержат
review text, IDs, raw paths, analytics, tracking payload или stack traces. После
bounded retries reviews-page UI показывает соответствующую safe причину.

#### Reviews-page UI и export

Минимальный success status —
`Reviews ready · N first-page reviews · source: SSR`; действия —
`Copy reviews JSON` и `Copy reviews for ChatGPT`. JSON export содержит полный
normalized active context, а ChatGPT export — его metadata и ограниченную
privacy-minimized выборку reviews. Panel использует существующий collapse
setting. Product buttons PDP не переносятся, reviews не сохраняются в
persistent storage. Explicit Load more не реализован; pagination остаётся
пассивной и происходит только после native действий страницы.

#### Captured fixtures и sanitization

Real sanitized derivatives от 2026-08-13:

- `reviews-ssr-1005008195850531.json` — Relay, 5 records;
- `reviews-ssr-1005009452926938.json` — Dress, 10 records;
- `reviews-ssr-additional-32882927175.json` — 2 records с реальным follow-up
  shape.

Fixtures явно помечены `sanitized: true`; `sanitizationNotes` перечисляют
псевдонимизированные категории. Schema, nullability, order и relations сохранены;
analytics, tracking и `isLiked` удалены. Эти derivatives не выдаются за raw
captures.

#### Live smoke — 2026-08-13

- Relay: 5 SSR reviews, 5 direct DOM cards.
- Dress: 10 SSR reviews, 10 DOM cards; первые ratings 5/5/3, human SKU и text
  совпали; translated/original, images, comments и non-zero likes сохранены.
- Needles: 10 SSR reviews; первые ratings 5/1/5 и SKU strings совпали;
  rating-only cases с null text нормализованы корректно.
- Item `32882927175`: 10 first-page reviews, 2 с `additional`; follow-up имеет
  собственный ID, grade 4, `Added 16 June 2026`, text и 3 additional images.
- Copy reviews JSON содержит только normalized data, без `analyticEvents`,
  `trackingInfo`, `isLiked` и `spm`.

Smoke выполнялся на реально активном Ali Helper v0.1.9.

#### Оставшиеся ограничения

Production passive native capture page 2+, filter/sort/SKU contexts и SSR +
native merge реализованы в P4. Будущими остаются explicit helper-controlled
loading, configurable cap и progress/stop logic для такой загрузки. Несколько
additional objects и review videos пока не наблюдались. `product.reviews` на PDP
не сохраняется и не объединяется с reviews-page model.

## P4 — Reviews pagination and follow-ups

### Explicit pagination

Production passive native capture реализован: Ali Helper наблюдает responses
только после действий самой страницы и не создаёт review requests. Explicit
sender и `Load reviews` action не реализованы; обязательность и семантика opaque
`_bx-v` для собственного request остаются недоказанными. Поэтому весь P4 не
считается завершённым.

- [x] Пассивно перехватывать native AliExpress review pagination/filter/sort/SKU
      responses только после действий самой страницы; Ali Helper не создаёт
      review requests.
- [x] Подтвердить native endpoint:
      `POST /aer-jsonapi/review/v5/desktop/product-reviews`.
- [x] Нормализовать wire request context: `productKey.id/sourceId`,
      `pagination.pageNum/pageSize`, `sort`, `filters`, `skuFilter`.
- [x] Кэшировать captured pages по item + canonical query context:
      `pageSize / sort / filters / skuFilter`.
- [x] Seed default context из SSR page 1 и объединять с native page 2+.
- [x] Дедуплицировать по `${productId}:${reviewId}` и fail-safe обрабатывать
      conflicts/page gaps.
- [x] Разделять All / Photos / Additional / SKU / sort contexts и сохранять
      inactive cache в page-session memory.
- [x] Ограничить retained passive capture до 30 reviews на context без
      блокировки native AliExpress requests.
- [x] Показывать loaded count/pages/context/cap в reviews-page status/export.
- [x] Не угадывать неизвестные sort/filter codes: human labels только для
      wire-confirmed values, остальные generic.
- [ ] Добавить explicit `Load reviews` / next-page action только если отдельно
      будет доказано, что userscript может безопасно формировать собственный
      request.
- [ ] Доказать обязательность/семантику opaque `_bx-v` и auth/runtime boundary
      перед любым helper-generated review request.
- [ ] Если sender когда-либо будет разрешён — строить request только из
      доказанного semantic body, без копирования opaque native state.
- [ ] Сделать capture/load cap configurable; текущий production passive cap
      фиксирован на 30.
- [ ] Добавить known-total/progress/stop logic для helper-controlled loading,
      если такой loading вообще будет реализован.
- [ ] Проверить native repeat-request/cache behavior, если это станет нужно.

#### Confirmed native wire protocol

Transport — native `fetch`; endpoint —
`POST /aer-jsonapi/review/v5/desktop/product-reviews`. Подтверждённый semantic
request:

```json
{
  "productKey": { "id": "<itemId>", "sourceId": 0 },
  "pagination": { "pageNum": 1, "pageSize": 10 },
  "sort": 1,
  "filters": [],
  "skuFilter": []
}
```

SSR default — page 1; lazy native loads — page 2 и page 3; page size — 10.
Default context: `sort: 1`, `filters: []`, `skuFilter: []`. Смена context
сбрасывает `pageNum` в 1. Response имеет shape
`{ data: { reviews: [...] } }`; total, hasNext, cursor, page/pageSize echo и
filter/sort echo отсутствуют. API records имеют ту же review shape, что SSR,
поэтому используются existing `normalizeReviewRecord` /
`normalizeReviewCandidate` без adapter.

Wire-confirmed contexts:

- All — `filters: []`;
- With photos — `filters: [1]`;
- Additional — `filters: [2]`;
- With photos + Additional — `filters: [1,2]`;
- Top reviews — `sort: 1`;
- New reviews first — `sort: 2`.

Sort 3/4 наблюдались только в SSR UI config и не считаются wire-confirmed.
Navy Blue Dress SKU context передаёт пять machine IDs:
`12000049151727537`, `12000049151727538`, `12000049151727539`,
`12000049151727540`, `12000049151727541`.

#### Passive-only architecture и cache

Endpoint matcher требует same-origin и exact pathname; query, включая `_bx-v`,
не входит в semantic context. `_bx-v` не читается, не хранится и не
экспортируется. Interceptor устанавливается только в reviews-page runtime.
Wrapper вызывает original fetch ровно один раз с исходными arguments, а
request/response пассивно читает через clone. Helper-generated review requests
и XHR capture отсутствуют: подтверждённый live transport — `fetch`.

Cache существует только в page-session memory, без GM persistence. Canonical
context состоит из `itemId`, `pageSize`, `sort`, sorted/unique `filters` и
sorted/unique `skuFilter`; pages хранятся отдельно по `pageNum`. Default page 1
seeded из SSR, page 2+ приходят из native responses. Filter/sort/SKU contexts не
смешиваются, inactive contexts сохраняются.

Passive capture cap — 30 reviews на context; native requests beyond cap не
блокируются. Admission зависит от page slot (`pageNum/pageSize/cap`), а не от
response completion order: при cap 30 / pageSize 10 сохраняются pages 1–3, а
page 4+ не занимает cache даже при завершении раньше page 2. Request sequence
назначается при invocation native fetch. Late response старого context может
пополнить свой cache, но не может переключить active context после более нового
request.

Merge использует только contiguous pages от page 1: `pageNum` ascending и
source order внутри page. Dedupe key — `${productId}:${id}`; identical duplicate
оставляет первое вхождение. Conflicting content по одному key даёт
`review-conflict`, разные данные одной page — `page-conflict`. При gap export
содержит только contiguous prefix и diagnostic до прихода missing page. Silent
overwrite отсутствует.

#### Native fixtures и live smoke — 2026-08-13

Sanitized native derivatives:

- `reviews-native-page2-1005009452926938.json`;
- `reviews-native-additional-32882927175.json`;
- `reviews-native-contexts-1005009452926938.json`.

В fixtures отсутствуют `_bx-v`, analytics, tracking и `isLiked`; PII, media и
text pseudonymized согласно notes. Semantic request body и response schema
сохранены.

Dated smoke на активном Ali Helper v0.1.10 подтвердил:

- Dress: 10 SSR → native page 2 = 20 → native page 3 = 30/cap; Photos
  (`filters: [1]`) — отдельный active context, возврат All восстановил cached
  30; Photos+Additional (`filters: [1,2]`) page 1 с пустым reviews валиден;
  Navy Blue SKU передал пять machine IDs; `sort: 2` сохранился отдельно.
- Needles: 10 → 30 через cascaded native scroll capture.
- Additional item: реальные lower/null grades, follow-up-only text и
  additional-only photo.
- Relay: site drift дал native empty page 2; merge сохранил 5 reviews и
  pages `[1,2]`, empty page валиден.
- Copy JSON содержит только normalized model, без raw network/tracking/`_bx-v`.

### Additional/follow-up review semantics

- [x] Хранить `additional` с собственными id, date, grade, text/originalText,
      images и comments.
- [x] Покрыть follow-up с рейтингом ниже initial.
- [x] Покрыть `additional.grade = null`.
- [x] Покрыть follow-up text при пустом initial/root text.
- [x] Покрыть photos только в `additional.images`.
- [x] Не создавать единый `effective rating` или text.
- [x] В ChatGPT export явно разделить `Initial rating/review` и
      `Follow-up rating/review`.

Real native observations: rating transitions `5 → 4` и `5 → 2`;
`additional.grade = null`; `initial.text = null` при non-null
`additional.text`; `initial.images = 0` при `additional.images = 1`.
`additional.comments` были `[]` во всех retained observed cases; non-empty
additional comments не предполагаются.

Acceptance: initial и follow-up полностью независимы и не теряют свои ratings,
texts или images.

## P5 — ChatGPT/AI export and UI/UX

### Structured AI export

- [x] Расширять `Copy for ChatGPT` только из normalized model, не из DOM.
- [x] Добавить sections Title/Clean URL/Item ID и selected SKU/variants.
- [x] Добавить selected price, regular price и stock.
      P5C: resolved selected SKU продолжает показывать selected normalized current
      price; unresolved selection теперь обозначается явно. Доступные current SKU
      prices форматируются через `formatMoney()`, дедуплицируются по отображаемой
      строке и сохраняют first-seen order; выводятся первые 5 через `|`, затем точное
      `(+N more)`. Пустые price data сообщаются явно; min/max range не подразумевается.
- [x] Добавить SELLER, RATING и STAR DISTRIBUTION после появления данных.
- [x] Добавить VARIANTS summary и отдельный full combinations export.
- [x] Добавить SIZE GUIDE, CHARACTERISTICS, DELIVERY и ordered DESCRIPTION.
- [x] Добавить REVIEWS summary и ограниченную выборку reviews.
- [x] Не выводить автоматически сотни SKU или reviews.
- [ ] Для больших sections показывать summary/current data и предоставлять
      отдельный explicit full export action.
      Description покрыт отдельно: основной product ChatGPT export сохраняет
      normalized heading/text/link visible text в source order с бюджетом 2500
      символов, исключает image URLs и link destination URLs, сообщает counts и
      explicit omission diagnostics; `Copy description` экспортирует полный
      ordered normalized Description без `rawHtml`. Общий пункт остаётся открыт
      для других sections, которым в будущем действительно потребуется limiting.
- [x] Проверить deterministic output на regression fixtures.

Reviews ChatGPT export: default sample = 5; formatter clamp = 1–20;
privacy-minimized text export. Полная fidelity normalized reviews остаётся
доступной через `Copy reviews JSON`.

Acceptance: основной export остаётся читаемым и ограниченным по объёму, а полные
данные доступны отдельными действиями.

### Panel states and actions

- [ ] Ввести явные loading/ready/partial/error states вместо одного status text.
- [ ] Показывать найденные sources и отсутствующие optional sections.
- [ ] Давать понятную schema/source error без вывода чувствительных данных.
- [ ] Сохранить collapsible panel и settings через Tampermonkey storage.
- [ ] Проверить layout на desktop и узком viewport без перекрытия основных
      AliExpress controls.
- [ ] Корректно обновлять panel после SPA item/SKU changes.
- [ ] Организовать actions без перегрузки панели: Copy clean URL, product JSON,
      variants, ChatGPT, description, reviews, Load reviews, Refresh shipping.
- [ ] При росте действий использовать sections/menu вместо постоянной сетки всех
      кнопок.

Acceptance: UI отражает partial data честно, не дублируется и остаётся удобным
после SPA navigation.

## P6 — URL hardening, resilience, and diagnostics

### URL normalization

- [x] Добавить отдельные cases `.com -> .ru` и `.ru -> .com`.
- [x] Проверить сохранение `sku_id` и полезного `shpMethod`.
- [x] Проверить удаление `spm`, всех `utm_*` и известных affiliate params.
- [x] Проверить сохранение неизвестного query parameter.
- [x] Проверить удаление hash.
- [x] Проверить optional trailing slash и URL с/без `.html`.
- [x] Проверить повторную нормализацию уже clean URL (idempotence).
- [x] Не превращать cleaning в whitelist query params.

Implementation note (P6A): canonical hosts are `aliexpress.ru` for RU and
`www.aliexpress.com` for COM. Useful and unknown query parameters, including
repeated unknown values, survive; known tracking is removed case-insensitively,
and hash is removed. Accepted PDP path variants canonicalize to
`/item/<id>.html`, and normalization is idempotent. Item-shaped URLs on
unrelated hosts now fail closed through the existing `isItemPage()` policy;
`getItemId()` semantics were intentionally not changed.

AliExpress may immediately redirect COM navigation back to RU through its own
regional gateway; this does not invalidate deterministic RU/COM formatter
tests.

Deferred micro-hardening: an explicit `targetMarket` value other than `ru` or
`com` currently falls through to COM. Current production callers pass only
valid `ru` / `com`; this was intentionally not changed in P6A.

Acceptance: известный tracking удаляется, неизвестное/полезное состояние не
теряется, результат стабилен при повторном вызове.

### Runtime resilience

- [ ] Аудировать selectors на полный CSS-module hash и заменить устойчивыми
      fragments/IDs/attributes.
- [ ] Сохранить жёсткие limits recursive traversals и tests на достижение limits.
- [ ] Записывать source used и безопасный schema mismatch diagnostic.
- [ ] Реализовать graceful partial model вместо молча неверного полного export.
- [ ] Управлять lifecycle polling/observers: не оставлять бесконечные interval
      leaks после SPA navigation или teardown.
- [ ] Сделать повторную инициализацию idempotent.
- [ ] Проверить отсутствие двойного wrapping fetch/XHR.
- [ ] Проверить отсутствие duplicate panel/listeners.
- [ ] Обработать смену item ID без принятия запоздавшего response старого товара.
- [ ] Не включать source URLs с tokens/tracking в diagnostics/export.

Acceptance: при изменении AliExpress schema helper сообщает partial/error state,
не экспортирует правдоподобные неправильные данные и не накапливает runtime
handlers.

## P7 — Testing matrix

Не требуется немедленно искать все товары. По мере реализации вести
обезличенную matrix fixtures/live references для следующих случаев:

- [ ] товар без вариантов;
- [ ] одна variant dimension;
- [ ] две и более variant dimensions;
- [ ] отсутствующие Cartesian combinations;
- [ ] большое число SKU;
- [ ] size guide CM/IN;
- [ ] отсутствие size guide;
- [ ] description преимущественно text;
- [ ] description преимущественно images;
- [ ] free shipping;
- [ ] paid shipping;
- [ ] несколько shipping methods;
- [ ] много reviews;
- [ ] translated review и original text;
- [ ] review только с original text;
- [ ] additional/follow-up review;
- [ ] photos в initial и только в follow-up;
- [ ] seller/store отсутствует или доступен частично;
- [ ] third-party extension DOM рядом с product/store blocks.

Для каждого case фиксировать item/source date, ожидаемые counts/relations и
ограничения region/session без сохранения персональных данных.

## Future / optional

Эти идеи не блокируют основной roadmap:

- [ ] Bulk shipping calculation только по явному действию и с hard cap.
- [ ] Исследование и декодирование review SKU filters.
- [ ] Исследование дополнительных `sort` values для reviews.
- [ ] Более богатое извлечение `Most mentioned in reviews`.
- [ ] Отдельный export ordered description image URLs.
- [ ] Optional self-contained export/archive, только при доказанной потребности.
- [ ] Browser extension version, только если ограничения Tampermonkey окажутся
      существенными; Tampermonkey остаётся предпочтительной платформой.
