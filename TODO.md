# TODO

Живой технический roadmap Ali Helper. P0 закрыт после успешного live
Tampermonkey smoke test. P0–P7 являются capability groups, а не фактическим
execution order. Текущий приоритет определяется оставшимися открытыми и явно
research-gated пунктами.

## Definition of done

Это reusable per-task completion template, а не checklist готовности всего
проекта. Пункт считается завершённым только если:

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
- [ ] **Deferred research:** подтвердить higher-priority `sellerId` в реально
      captured raw `productData` response. Normalized `sellerId` уже работает
      из подтверждённых SSR/scoped DOM sources; новый API source принимать
      только если будущий capture докажет однозначную связь поля с current item.
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

- [ ] **Deferred research:** повторно искать original React
      `dangerouslySetInnerHTML.__html` для `#content_anchor` только если будущая
      live evidence откроет безопасный preferred source. Текущий production DOM
      fallback через `#content_anchor.innerHTML` реализован и протестирован.
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
- [x] Не использовать `logisticAmount` как стоимость доставки.
- [x] Нормализовать method/group, `serviceName`, cost, currency, ETA/date range
      и destination, если оно известно.
- [x] Связать shipping result с конкретным SKU ID в normalized model.
- [x] Кэшировать результат по SKU/request context в рамках page session.
- [x] Инвалидировать/переключать displayed shipping при смене selected SKU.
- [ ] **Deferred / design-gated:** определить truthful unavailable/blocked
      shipping state для passive mode. Captured partial response уже
      нормализуется как neutral partial Delivery, но отсутствие response нельзя
      безопасно отличить от ситуации, когда AliExpress не запускал `calculate`.
- [x] Добавить tests для free, paid и нескольких shipping methods.

Passive runtime binding, page-session cache и защита от stale delivery
подтверждены вторым live Tampermonkey smoke test. Ali Helper по-прежнему не
строит и не отправляет собственный `calculate` request.

Ранее планировались helper-generated SKU-specific payload и explicit/current-SKU
sender. Этот план superseded принятой production architecture: Ali Helper
пассивно перехватывает native `calculate`, связывает captured request context с
product/SKU/environment и кэширует результат. Собственные shipping requests
сейчас не требуются и не разрешены production design. Возможный `Refresh
shipping` является отдельной будущей research-gated функцией.

Acceptance: стоимость и ETA принадлежат конкретному SKU; массовых запросов и
подмены shipping через `logisticAmount` нет.

Passive selected-SKU shipping acceptance завершён.

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

### Passive pagination

Production passive native capture реализован: Ali Helper наблюдает responses
только после действий самой страницы и не создаёт review requests. Explicit
sender и `Load reviews` action не входят в критерий завершения passive
pagination. SSR page 1, native page 2+, context isolation, contiguous merge,
capture cap, gaps/conflicts, follow-ups и active-context export реализованы.

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
- [ ] Сделать bounded passive retained-review cap configurable с default 30
      reviews на context. Настройка влияет только на сохранение passive
      observations в page-session memory и не создаёт, не повторяет, не
      подавляет и иначе не управляет native AliExpress review requests.

#### Optional active-loading research — deferred

- [ ] **Deferred research:** добавить explicit `Load reviews` / next-page sender
      только после доказательства, что userscript может безопасно формировать
      собственный request.
- [ ] **Deferred research:** доказать обязательность/семантику opaque `_bx-v` и
      auth/runtime boundary перед любым helper-generated review request.
- [ ] **Deferred research:** если sender будет разрешён, строить request только
      из доказанного semantic body, без копирования opaque native state.
- [ ] **Deferred / design-gated:** определить known-total/progress/stop logic для
      active loading; текущий response не содержит total, hasNext или cursor.
- [ ] **Deferred research:** проверить native repeat-request/cache behavior,
      только если это потребуется для будущего active sender.

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
- [x] Для больших sections показывать summary/current data и предоставлять
      отдельный explicit full export action.
      Description покрыт отдельно: основной product ChatGPT export сохраняет
      normalized heading/text/link visible text в source order с бюджетом 2500
      символов, исключает image URLs и link destination URLs, сообщает counts и
      explicit omission diagnostics; `Copy description` экспортирует полный
      ordered normalized Description без `rawHtml`. SKU combinations используют
      bounded summary + `Copy variants`; reviews — limited ChatGPT sample + full
      JSON. Для новой large section при необходимости создаётся отдельная
      falsifiable задача на limiting/full export.
- [x] Проверить deterministic output на regression fixtures.

Reviews ChatGPT export: default sample = 5; formatter clamp = 1–20;
privacy-minimized text export. Полная fidelity normalized reviews остаётся
доступной через `Copy reviews JSON`.

Acceptance: основной export остаётся читаемым и ограниченным по объёму, а полные
данные доступны отдельными действиями.

### Panel states and actions

- [x] **Superseded by P6:** старую модель loading/ready/partial/error заменил
      contract `complete` / `partial` / `invalid`; waiting/error presentation
      уже существует, а принятый UI остаётся compact status surface.
- [x] Добавить в Product panel compact native `Sources & missing sections`:
      безопасные semantic per-section sources и подтверждённые `missing` только
      для поддерживаемых missing-capable sections, без raw URL/provenance и без
      изменения export/schema. `not-observed` и `invalid` остаются в основном
      status.
- [x] **Superseded and generalized by P6:** product-side contract реализован
      через `product._meta.sections`; reviews сохраняют отдельный safe
      diagnostics contract.
- [x] Сохранить collapsible panel и settings через Tampermonkey storage.
- [x] Проверить layout на desktop и узком viewport без перекрытия основных
      AliExpress controls. Исторически v0.1.22 не проходил narrow check при
      390×844: fixed panel перекрывал product content и нижнюю область purchase
      controls. Принятый responsive pass добавил narrow breakpoint,
      viewport-safe нижний clearance, bounded expanded height и internal
      scrolling с сохранением desktop layout; Product и общий Reviews shell
      проверены, пересечение с reference purchase controls в accepted live smoke
      равно нулю. Final contract совпадает с native transition: `<=767px` narrow,
      `>=768px` desktop; persistent fixed/sticky purchase controls защищены
      reservation `120px + safe-area`. Transient overlap с обычным inline content
      принят как overlay behavior; production не inspect/measure/move/hide/modify
      purchase controls.
- [x] Корректно обновлять panel после SPA item/SKU changes.
- [x] Завершить responsive organization/layout существующих actions без
      перегрузки панели. Desktop сохраняет принятый direct-action layout; narrow
      mode использует три ряда по две кнопки, и все шесть Product actions остаются
      напрямую доступны. Новые active network actions и menu не добавлены.
- [ ] **Conditional:** если будет одобрено ещё одно persistent action и action
      set вырастет, рассмотреть sections/menu или equivalent grouping в рамках
      соответствующего UI pass; отдельная реализация сейчас не требуется.

Collapse/settings persistence и SPA SKU update подтверждены существующими tests
и P0 live smoke history; при item change runtime очищает текущий product и ждёт
данные нового item.

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

- [x] Аудировать selectors на полный CSS-module hash и заменить устойчивыми
      fragments/IDs/attributes.
- [x] Добавить systematic limit-reached regressions и explicit safe diagnostics
      для relevant bounded traversals beyond reviews; сами depth/visited limits
      уже применяются широко.
  - Reconciliation: aggregate/gather-all scans fail closed при фактическом
    `maxVisited` / `maxDepth` cutoff; candidate, найденный до cutoff, не считается
    полным результатом. Контракт покрывает Size Guide, Gallery, Store, SSR review
    summary и exported/core basic-rating helper.
  - Store existence сохраняет доказанный early match как `true`, а truncated miss
    как `traversal-limit` / UNKNOWN; trusted current-item chat binding остаётся
    достаточным независимо от незавершённого analytics scan.
  - ProductData сохраняет first-match semantics: доказанный early candidate —
    success, complete miss — обычный `null`, truncated miss — `traversal-limit`.
    Legacy/simple extractor APIs сохранены. Aggregate SSR bound равен 80 после
    наблюдения live AliExpress SSR до depth 66; reviews-page scanner не расширялся.
- [x] Унифицировать per-section source/missing/schema diagnostics. Контракт
      находится в `product._meta.sections` для `sizeGuide`, `gallery`,
      `ratingSummary`, `store`, `characteristics`, `description` и `delivery`:
      states — `present` / `missing` / `not-observed` / `invalid`, а invalid
      diagnostics — `traversal-limit` / `conflict` / `schema-mismatch`.
      Provenance использует только фиксированные semantic labels; Delivery до
      matching passive native observation остаётся `not-observed`. Эти
      diagnostics сами по себе не определяют whole-product completeness,
      blocking sections или export gating; graceful partial model оформлен
      отдельным пунктом ниже.
- [x] Реализовать graceful partial model вместо молча неверного полного export.
      `_meta.completeness` публикует `complete` / `partial` / `invalid`: `present`
      и `missing` считаются resolved, `not-observed` делает product partial, а
      любой invalid section — whole product invalid. `selected-sku-unresolved`
      является core issue и даёт partial при отсутствии invalid. Списки
      `notObservedSections`, `invalidSections` и `coreIssues` deterministic.
      `Copy product` сохраняет machine-readable completeness; panel и `Copy for
      ChatGPT` показывают compact status, не блокируя export при partial/invalid.
      Reviews model не получает PDP completeness.
- [x] Управлять runtime-owned timer/listener lifecycle. PDP владеет одним interval
      handle и переиспользует его при SPA item/SKU changes; dispose очищает
      interval и pending `DOMContentLoaded`. Reviews SSR discovery владеет не
      более чем одним retry timeout; success, exhaustion и dispose не оставляют
      pending timer. Captured timer callbacks после dispose inert.
- [x] Добавить page-level runtime singleton/teardown guard. Registry
      `__aliHelperRuntimeV1__` переиспользуется повторным `start()`: создаётся
      только один product/reviews controller и один `pagehide` listener. Dispose
      idempotent; disposed registration намеренно terminal для текущего document,
      а fresh full document load естественно создаёт новый runtime.
- [x] Добавить regression proof idempotence для оставшегося fetch/XHR wrapper
      stack и intentional layering. Протестированы:
      product/shipping repeated install;
      existing reviews idempotence;
      все 6 fetch-порядков установки;
      product↔shipping XHR orders;
      native fetch ровно один раз;
      native XHR open/send ровно один раз;
      args/this/Promise семантика сохранена;
      endpoint isolation;
      отсутствие helper-generated requests.
- [x] Проверить отсутствие duplicate panel/listeners.
- [x] Закрыть late old-item response case без trustworthy payload item ID и
      добавить asynchronous regression. Explicit `productId` / `itemId` / `id`
      authoritative: mismatch отклоняется. Identity-less `network:productData`
      принимается только при совпадении request-time item ID с текущим runtime
      item: fetch фиксирует ID синхронно при invocation, XHR — в matching
      `open()`, поэтому late A не bind-ится к B. SSR/React без candidate ID не
      наследует текущий item ID и fail closed как identity-less/unbound fallback.
- [x] Не включать source URLs с tokens/tracking в diagnostics/export.

Production DOM selectors используют semantic IDs, `data-testid` и class-name
fragments, а не complete CSS-module hashes. Mount guard проверяет
`#ali-helper-host`, listeners принадлежат только созданному guarded panel
instance. Export/debug paths sanitise либо не сохраняют sensitive source/network
URL material.

Acceptance: при изменении AliExpress schema helper сообщает partial/error state,
не экспортирует правдоподобные неправильные данные и не накапливает runtime
handlers.

## P7 — Testing matrix

Не требуется немедленно искать все товары. По мере реализации вести
обезличенную matrix fixtures/live references для следующих случаев:

- [x] товар без вариантов;

  Reconciliation: real `productData` capture item `1005004235856766`, observed
  2026-08-27 on `aliexpress.ru` in the current Moldova session:
  `propertyList = 0`, `priceList = 1`, and `activeSkuId = sole skuId = observed
  URL sku_id`. The normalized product has zero variant groups, one real SKU,
  and empty selections; UI/export use a neutral no-variant representation, not
  synthetic Default/Single/Standard. The captured fixture and regression live
  in the P7 matrix test. Historical price/stock are regression evidence, not
  current-offer assertions.
- [x] одна variant dimension;
- [x] две и более variant dimensions;
- [x] реально captured отсутствующие/sparse Cartesian combinations; synthetic
      удаление priceList row доказывает parser behavior, но не закрывает matrix;

  Reconciliation: real `productData` capture item `1005010146755036`, observed
  2026-08-27 on `aliexpress.ru` in the current Moldova session, has `Color 2 ×
  Shoe Size 7`: theoretical Cartesian 14 versus a complete captured `priceList`
  of 9 unique actual rows. Exact gaps are Wine Red `338038` + 39 `380598`, Wine
  Red `338038` + 40 `380590`, Black `337907` + 36 `380593`, Black `337907` + 37
  `380587`, and Black `337907` + 38 `380599`. Every accepted value occurs in an
  actual SKU, so orphan values are zero; raw `disabled=false`, while live
  impossible cross-selections used `optionPartial`. Parser and exports retain
  only the 9 real `priceList` combinations and synthesize no missing SKU rows.
  The minimized fixture is `test/fixtures/product-1005010146755036.json`; its
  proof lives in `test/product-matrix.test.js`. Historical price/stock are
  regression evidence, not current-offer assertions.
- [x] большое число SKU;
- [x] size guide CM/IN;
- [x] отсутствие size guide;
- [x] description преимущественно text;
- [x] description преимущественно images;
- [x] реально captured free shipping; synthetic zero-cost test недостаточен;

  Reconciliation: real natural `freight/calculate` capture for item
  `1005007275021771`, SKU `12000040029370608`, observed 2026-08-28 on
  `aliexpress.ru` in the Moldova/current session for destination Moldova /
  Kishinev Region / Kishinev. One real method, Post office /
  `CAINIAO_FULFILLMENT_STD`, has raw `amount.value = 0`, currency USD, and
  formatted `US $0`; `freeMethods=[]` and request `freeDelivery=null` prove
  that the free state comes from the real method amount rather than hints.
  ProductData displays USD 11.45 while the freight request identity is
  `logisticAmount` CNY 76.51 (`buyerPriceForLogistic=1145`). The production
  cache uses cross-currency `logisticAmount` only when both currencies are
  explicitly known, the logistic currency matches the request currency, the
  display currency differs, and a logistic value is present; missing display
  currency fails closed to `Delivery not-observed`. Delivery remains `present`
  with source `native:shipping-calculate`, the existing paid case remains paid,
  and fixtures/tests document historical region/session-dependent evidence.
- [x] paid shipping;
- [ ] реально captured несколько shipping methods; synthetic multi-method test
      недостаточен;
- [x] много reviews;
- [x] translated review и original text;
- [ ] реально captured review только с original text;
- [x] additional/follow-up review;
- [x] photos в initial и только в follow-up;
- [ ] реально captured seller/store отсутствует или доступен частично;
- [x] third-party extension DOM рядом с product/store blocks.

Закрытые matrix cases опираются на существующие captured product, Description,
shipping и review fixtures/tests: Relay `Bundle: 7`, Dress `Color 9 × Size 5` и
45 SKU, CM/IN, Relay без size guide, dated text/image Description observations,
paid `calculate`, passive 30-review capture, independent translated/original и
follow-up semantics, а также scoped third-party DOM exclusion.

Для каждого case фиксировать item/source date, ожидаемые counts/relations и
ограничения region/session без сохранения персональных данных.

## Future / optional

Эти идеи не блокируют основной roadmap:

- [ ] **Deferred research:** Bulk shipping calculation только по явному действию
      и с hard cap, после доказательства безопасного active shipping
      sender/runtime boundary.
- [ ] Исследование и декодирование review SKU filters.
- [ ] Исследование дополнительных `sort` values для reviews.
- [ ] Более богатое извлечение `Most mentioned in reviews`.
- [ ] **Deferred / needs design evidence:** Optional self-contained
      export/archive только при доказанной потребности и определённом формате.
- [ ] **Deferred / needs design evidence:** Browser extension version только
      если ограничения Tampermonkey окажутся существенными; Tampermonkey остаётся
      предпочтительной платформой.

Отдельный ordered Description-image-URL export superseded действием `Copy
description`, которое экспортирует полный ordered normalized Description,
включая image URLs в исходном контексте.
