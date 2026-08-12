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

- [ ] Найти structured gallery в `productData`/page data раньше DOM fallback.
- [ ] Нормализовать main product image URLs и preview URLs без автоматического
      скачивания.
- [ ] Сохранить video URL и poster/preview, если они однозначно доступны.
- [ ] Сохранить исходный порядок gallery и удалить только точные дубликаты.
- [ ] Добавить cases без video, с video и с отсутствующей gallery.

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

- [ ] Извлечь store name и store URL в известных AliExpress boundaries:
      `#storeInfo`, `RedStoreInfo` и product store container.
- [ ] Получить store ID из `/store/ID`.
- [ ] Предпочесть structured `productData.sellerId`; использовать `seller_id`
      из scoped chat URL только как fallback.
- [ ] Извлечь seller rating, subscribers и однозначные дополнительные stats.
- [ ] Хранить item rating отдельно от seller rating.
- [ ] Не включать Megabonus и другой third-party injected DOM.
- [ ] Добавить regression для `WLIN OOTD Store`: store ID `1103330026`, seller ID
      `2677490623`, seller rating `85%`, subscribers `3K`.
- [ ] Проверить graceful result при частичных или отсутствующих store данных.

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

- [ ] Нормализовать rating, total reviews/ratings, content feedback count и
      bought count из structured/semantic sources.
- [ ] Извлечь 5★/4★/3★/2★/1★ distribution без зависимости от CSS hash.
- [ ] Проверять сумму star distribution против reviews count, когда все значения
      доступны; mismatch показывать как diagnostic, а не скрывать.
- [ ] Сохранить buyer photos count, если источник однозначен.
- [ ] Добавить optional `reviewTopics` только при устойчивом extraction.
- [ ] Добавить regression: rating `4.8`, reviews `610`, feedbacks `283`, bought
      `2001`; stars `562/27/6/5/10`.

Acceptance: значения summary не смешиваются между product, seller и content
feedback; известная star distribution суммируется в 610.

### First-page SSR reviews

- [ ] Распознавать `/item/ITEM_ID/reviews` как отдельный read-only page context.
- [ ] Рекурсивно искать объект с массивом reviews в `#__AER_DATA__` по структуре,
      а не по глубокому `widgets[...]` path.
- [ ] Ограничить recursive traversal depth/visited nodes и диагностировать
      schema mismatch.
- [ ] Нормализовать review как `{ id, productId, skuProperties, reviewer,
      initial, additional, likesAmount }`.
- [ ] В `initial` сохранять date, grade, translated text, original text, images
      и comments.
- [ ] В reviewer сохранять display name, initials/avatar и country flag/code,
      если они доступны.
- [ ] Использовать human `skuProperties` из review, не восстанавливать variant
      через догадки.
- [ ] Дедуплицировать только по устойчивому review ID.

Acceptance: первая SSR page извлекается без network pagination; initial и
additional не схлопываются.

## P4 — Reviews pagination and follow-ups

### Explicit pagination

- [ ] Добавить явное UI action для загрузки следующих страниц
      `product-reviews`; не загружать их при обычном открытии страницы.
- [ ] Формировать payload с `productKey`, `pagination.pageNum`, page size 10,
      `sort: 1`, `filters` и `skuFilter`.
- [ ] Поддержать известные filters: `[]` all, `[1]` photos, `[2]` additional,
      `[1,2]` photos + additional.
- [ ] Кэшировать уже загруженные pages по product/filter/sort context.
- [ ] Добавить разумный configurable cap, первоначально 30–50 reviews.
- [ ] Показывать progress: loaded count, known total и текущую page.
- [ ] Останавливать загрузку по known total или short/empty page.
- [ ] Не угадывать неизвестные sort values до отдельного исследования.
- [ ] Объединять SSR page 1 и API pages без duplicate reviews.

Acceptance: сеть используется только после явного действия; повторный запрос
той же page не выполняется, cap соблюдается.

### Additional/follow-up review semantics

- [ ] Хранить `additional` с собственными id, date, grade, text/originalText,
      images и comments.
- [ ] Покрыть follow-up с рейтингом ниже initial.
- [ ] Покрыть `additional.grade = null`.
- [ ] Покрыть follow-up text при пустом initial/root text.
- [ ] Покрыть photos только в `additional.images`.
- [ ] Не создавать единый `effective rating` без доказанной семантики aggregate.
- [ ] В ChatGPT export явно разделить `Initial rating/review` и
      `Follow-up rating/review`.

Acceptance: initial и follow-up полностью независимы и не теряют свои ratings,
texts или images.

## P5 — ChatGPT/AI export and UI/UX

### Structured AI export

- [ ] Расширять `Copy for ChatGPT` только из normalized model, не из DOM.
- [ ] Добавить sections Title/Clean URL/Item ID и selected SKU/variants.
- [ ] Добавить selected price, regular price и stock.
- [ ] Добавить SELLER, RATING и STAR DISTRIBUTION после появления данных.
- [ ] Добавить VARIANTS summary и отдельный full combinations export.
- [ ] Добавить SIZE GUIDE, CHARACTERISTICS, DELIVERY и ordered DESCRIPTION.
- [ ] Добавить REVIEWS summary и ограниченную выборку reviews.
- [ ] Не выводить автоматически сотни SKU или reviews.
- [ ] Для больших sections показывать summary/current data и предоставлять
      отдельный explicit full export action.
- [ ] Проверить deterministic output на regression fixtures.

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

- [ ] Добавить отдельные cases `.com -> .ru` и `.ru -> .com`.
- [ ] Проверить сохранение `sku_id` и полезного `shpMethod`.
- [ ] Проверить удаление `spm`, всех `utm_*` и известных affiliate params.
- [ ] Проверить сохранение неизвестного query parameter.
- [ ] Проверить удаление hash.
- [ ] Проверить optional trailing slash и URL с/без `.html`.
- [ ] Проверить повторную нормализацию уже clean URL (idempotence).
- [ ] Не превращать cleaning в whitelist query params.

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
