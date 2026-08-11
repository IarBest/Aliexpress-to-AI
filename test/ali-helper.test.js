'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

function loadFixture(name) {
  const fixturePath = path.join(__dirname, 'fixtures', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('normalizes COM URL, removes tracking and hash, and keeps sku_id and unknown params', () => {
  const input = 'https://www.aliexpress.com/item/1005008195850531.html?spm=a2g0o&utm_source=x&af=739_607243&sku_id=123&mystery=keep#frag';
  const result = core.normalizeItemUrl(input, 'ru');
  assert.equal(result.href, 'https://aliexpress.ru/item/1005008195850531.html?sku_id=123&mystery=keep');
});

test('recognizes only AliExpress item pages', () => {
  assert.equal(core.isItemPage('https://aliexpress.ru/item/1005008195850531.html'), true);
  assert.equal(core.isItemPage('https://aliexpress.ru/item/1005008195850531/reviews'), false);
  assert.equal(core.isItemPage('https://example.com/item/1005008195850531.html'), false);
});

test('shipping matcher accepts only the known AliExpress freight/calculate endpoint', () => {
  const pageUrl = 'https://aliexpress.ru/item/1005008195850531.html';

  assert.equal(core.isShippingCalculateUrl('/aer-api/v1/pdp/web/freight/calculate', pageUrl), true);
  assert.equal(core.isShippingCalculateUrl('https://api.aliexpress.com/aer-api/v1/pdp/web/freight/calculate?synthetic=1', pageUrl), true);
  assert.equal(core.isShippingCalculateUrl('/aer-api/v1/pdp/web/freight/calculate/', pageUrl), true);
  assert.equal(core.isShippingCalculateUrl('https://example.com/aer-api/v1/pdp/web/freight/calculate', pageUrl), false);
  assert.equal(core.isShippingCalculateUrl('/other/calculate', pageUrl), false);
  assert.equal(core.isShippingCalculateUrl('/aer-api/v1/pdp/web/freight/calculator', pageUrl), false);
  assert.equal(core.isShippingCalculateUrl('/aer-api/v1/pdp/web/freight?calculate=1', pageUrl), false);
  assert.equal(core.isShippingCalculateUrl('/aer-api/v1/pdp/web/freight/calculate', 'https://example.com/item/1'), false);
});

test('synthetic shipping debug capture redacts sensitive JSON without changing its shape', () => {
  const syntheticRequest = {
    skuId: 'synthetic-sku',
    token: 'synthetic-token',
    destination: {
      countryCode: 'MD',
      city: 'Chisinau',
      postalCode: 'MD-0000',
      recipientName: 'Synthetic Person',
    },
  };
  const syntheticResponse = {
    data: { serviceName: 'Synthetic delivery', accountId: 'synthetic-account' },
    email: 'synthetic@example.com',
  };

  const capture = core.createShippingDebugCapture(
    'https://synthetic-user:synthetic-pass@api.aliexpress.com/aer-api/v1/pdp/web/freight/calculate?token=synthetic-token#fragment',
    'fetch',
    syntheticRequest,
    syntheticResponse,
    'https://aliexpress.ru/item/1005008195850531.html',
  );

  assert.equal(capture.sourceUrl, 'https://api.aliexpress.com/aer-api/v1/pdp/web/freight/calculate');
  assert.equal(capture.transport, 'fetch');
  assert.equal(capture.request.skuId, 'synthetic-sku');
  assert.equal(capture.request.token, '[REDACTED]');
  assert.equal(capture.request.destination.countryCode, 'MD');
  assert.equal(capture.request.destination.city, 'Chisinau');
  assert.equal(capture.request.destination.postalCode, '[REDACTED]');
  assert.equal(capture.request.destination.recipientName, '[REDACTED]');
  assert.equal(capture.response.data.serviceName, 'Synthetic delivery');
  assert.equal(capture.response.data.accountId, '[REDACTED]');
  assert.equal(capture.response.email, '[REDACTED]');
  assert.equal(syntheticRequest.token, 'synthetic-token');
});

test('captured freight/calculate fixture normalizes SKU, destination, method, cost, and ETA', () => {
  const fixture = loadFixture('shipping-calculate-1005008195850531.json');
  const delivery = core.normalizeDelivery(fixture.request, fixture.response);

  assert.equal(fixture.sourceUrl, 'https://aliexpress.ru/aer-api/v1/pdp/web/freight/calculate');
  assert.equal(fixture.transport, 'fetch');
  assert.equal(delivery.productId, '1005008195850531');
  assert.equal(delivery.skuId, '12000056550848689');
  assert.deepEqual(delivery.destination, {
    countryCode: 'MD',
    countryName: 'Moldova',
    regionCode: '924500010000000000',
    regionName: 'Kishinev Region',
    cityCode: '924500010001000000',
    cityName: 'Kishinev',
  });
  assert.equal(delivery.displayMultipleMethods, false);
  assert.equal(delivery.methods.length, 1);
  assert.equal(delivery.methods[0].groupName, 'Post office');
  assert.equal(delivery.methods[0].serviceName, 'CAINIAO_STANDARD');
  assert.equal(delivery.methods[0].service, '');
  assert.equal(delivery.methods[0].cost.value, '8.52');
  assert.equal(delivery.methods[0].cost.currency, 'USD');
  assert.equal(delivery.methods[0].cost.formatted, '$ 8.52');
  assert.equal(delivery.methods[0].etaStartDate, '2026-08-22');
  assert.equal(delivery.methods[0].etaEndDate, '2026-08-25');
  assert.equal(delivery.methods[0].dateDisplay, '2026-08-25');
  assert.equal(delivery.methods[0].dateFormat, '22–25 August');
  assert.equal(delivery.methods[0].tracking, false);
  assert.equal(delivery.methods[0].serviceGroupType, 'rupost_self_pickup_point');
  assert.equal(delivery.methods[0].passportRequired, false);
});

test('captured delivery appears in ChatGPT export for its selected SKU', () => {
  const productFixture = loadFixture('product-1005008195850531.json');
  const shippingFixture = loadFixture('shipping-calculate-1005008195850531.json');
  const product = core.normalizeProduct(
    productFixture.data,
    'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689',
  );
  product.delivery = core.normalizeDelivery(shippingFixture.request, shippingFixture.response);

  const exported = core.exportForChatGPT(product);
  assert.match(exported, /DELIVERY:\nDestination: Kishinev, Kishinev Region, Moldova \(MD\)/);
  assert.match(exported, /Method: Post office/);
  assert.match(exported, /Service: CAINIAO_STANDARD/);
  assert.match(exported, /Price: \$ 8\.52/);
  assert.match(exported, /Estimated delivery: 2026-08-22 — 2026-08-25 \(22–25 August\)/);
});

test('synthetic delivery keeps multiple methods and a zero-cost method', () => {
  const delivery = core.normalizeDelivery(
    { productId: 'synthetic-product', skuId: 'synthetic-sku', country: 'MD' },
    {
      displayMultipleMethods: true,
      methods: [
        { groupName: 'Synthetic free', serviceName: 'SYNTHETIC_FREE', amount: { value: 0, currency: 'USD', formatted: '$ 0.00' } },
        { groupName: 'Synthetic paid', serviceName: 'SYNTHETIC_PAID', amount: { value: 4, currency: 'USD', formatted: '$ 4.00' } },
      ],
    },
  );

  assert.equal(delivery.methods.length, 2);
  assert.equal(delivery.methods[0].cost.value, '0');
  assert.equal(delivery.methods[0].cost.formatted, '$ 0.00');
  assert.match(core.formatDelivery(delivery), /Method 1: Synthetic free/);
  assert.match(core.formatDelivery(delivery), /Method 2: Synthetic paid/);
});

test('synthetic partial shipping response remains a valid neutral delivery', () => {
  const request = { productId: 'synthetic-product', skuId: 'synthetic-sku', country: 'MD' };
  const delivery = core.normalizeDelivery(
    request,
    { to: { countryName: 'Synthetic country' } },
  );

  assert.equal(delivery.skuId, 'synthetic-sku');
  assert.equal(delivery.destination.countryCode, 'MD');
  assert.equal(delivery.destination.countryName, 'Synthetic country');
  assert.deepEqual(delivery.methods, []);
  assert.equal(delivery.displayMultipleMethods, null);
  assert.match(core.formatDelivery(delivery), /Methods: —/);

  const cache = core.createDeliveryCache();
  const product = { itemId: 'synthetic-product', selectedSkuId: 'synthetic-sku', title: 'Synthetic product', delivery: null };
  core.cacheDelivery(cache, request, delivery);
  const updated = core.applyCachedDelivery(product, cache);
  assert.equal(updated.title, 'Synthetic product');
  assert.equal(updated.delivery, delivery);
});

test('shipping cache key distinguishes material request context', () => {
  const base = {
    productId: 1,
    skuId: 'synthetic-sku',
    country: 'MD',
    provinceCode: null,
    cityCode: null,
    tradeCurrency: 'USD',
    count: 1,
    buyerPrice: '192',
    minPrice: 1.92,
    maxPrice: 1.92,
  };

  assert.equal(core.createShippingContextKey(base), core.createShippingContextKey({ ...base }));
  assert.notEqual(core.createShippingContextKey(base), core.createShippingContextKey({ ...base, productId: 2 }));
  assert.notEqual(core.createShippingContextKey(base), core.createShippingContextKey({ ...base, skuId: 'other-synthetic-sku' }));
  assert.notEqual(core.createShippingContextKey(base), core.createShippingContextKey({ ...base, country: 'RO' }));
  assert.notEqual(core.createShippingContextKey(base), core.createShippingContextKey({ ...base, provinceCode: 'synthetic-province' }));
  assert.notEqual(core.createShippingContextKey(base), core.createShippingContextKey({ ...base, cityCode: 'synthetic-city' }));
  assert.notEqual(core.createShippingContextKey(base), core.createShippingContextKey({ ...base, tradeCurrency: 'EUR' }));
  assert.notEqual(core.createShippingContextKey(base), core.createShippingContextKey({ ...base, count: 2 }));
  assert.notEqual(core.createShippingContextKey(base), core.createShippingContextKey({ ...base, buyerPrice: '250' }));
  assert.notEqual(core.createShippingContextKey(base), core.createShippingContextKey({ ...base, maxPrice: 2.5 }));
});

test('synthetic shipping cache retains contexts and points each SKU to its latest delivery', () => {
  const cache = core.createDeliveryCache();
  const baseRequest = { productId: 'synthetic-product', skuId: 'synthetic-sku', country: 'MD', tradeCurrency: 'USD', count: 1 };
  const firstDelivery = { productId: 'synthetic-product', skuId: 'synthetic-sku', marker: 'first' };
  const latestDelivery = { productId: 'synthetic-product', skuId: 'synthetic-sku', marker: 'latest' };

  core.cacheDelivery(cache, { ...baseRequest, buyerPrice: '100' }, firstDelivery);
  core.cacheDelivery(cache, { ...baseRequest, buyerPrice: '200' }, latestDelivery);

  assert.equal(cache.byContext.size, 2);
  assert.equal(core.getCachedDelivery(cache, 'synthetic-product', 'synthetic-sku'), latestDelivery);
});

test('real single-dimension fixture has Bundle: 7 values and 7 priceList SKUs', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689');

  assert.equal(product.itemId, '1005008195850531');
  assert.equal(product.variantGroups.length, 1);
  assert.equal(product.variantGroups[0].id, '205');
  assert.equal(product.variantGroups[0].name, 'Bundle');
  assert.equal(product.variantGroups[0].values.length, 7);
  const firstValue = product.variantGroups[0].values.find((value) => value.id === '357383');
  const remoteValue = product.variantGroups[0].values.find((value) => value.id === '357390');
  assert.deepEqual({ raw: firstValue.rawName, display: firstValue.name }, { raw: 'Bundle1', display: '1CH Zigbee 7-32V' });
  assert.deepEqual({ raw: remoteValue.rawName, display: remoteValue.name }, { raw: 'Bundle8', display: '433 Remote' });
  assert.equal(product.skus.length, fixture.data.skuInfo.priceList.length);
  assert.equal(product.skus.length, 7);
  const sixSixtySku = product.skus.find((sku) => sku.skuId === '12000056550848683');
  const oneNinetyTwoSku = product.skus.find((sku) => sku.skuId === '12000056550848689');
  assert.deepEqual(sixSixtySku.skuPropIds, ['357383']);
  assert.deepEqual(oneNinetyTwoSku.skuPropIds, ['357390']);
  assert.match(sixSixtySku.price.current.formatted, /^\$\u00a06\.60$/);
  assert.equal(sixSixtySku.buyerPriceForLogistic, '660');
  assert.match(oneNinetyTwoSku.price.current.formatted, /^\$\u00a01\.92$/);
  assert.equal(oneNinetyTwoSku.buyerPriceForLogistic, '192');
  assert.equal(Object.hasOwn(sixSixtySku.price, 'buyer'), false);
  assert.equal(Object.hasOwn(oneNinetyTwoSku.price, 'buyer'), false);
  const exportedSku = JSON.parse(core.exportProduct(product)).selectedSku;
  assert.equal(exportedSku.buyerPriceForLogistic, '192');
  assert.equal(Object.hasOwn(exportedSku.price, 'buyer'), false);
  assert.equal(product.selectedSku.selections[0].name, '433 Remote');
});

test('formats product status with real combinations and a human-facing source', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(
    fixture.data,
    'https://aliexpress.ru/item/1005008195850531.html',
    { source: 'network:productData' },
  );

  assert.equal(core.formatProductStatus(product), 'Ready · 7 combinations · Bundle: 7 · source: API');
  assert.equal(core.formatSourceLabel('ssr:__AER_DATA__'), 'SSR');
  assert.equal(core.formatSourceLabel('react:__reactProps'), 'React');
  assert.equal(core.formatSourceLabel('custom-source'), 'custom-source');
});

test('real multi-dimension fixture maps priceList SKU through displayName', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540');

  assert.deepEqual(product.variantGroups.map((group) => [group.name, group.values.length]), [['Color', 9], ['Size', 5]]);
  assert.deepEqual(product.variantGroups.map((group) => [group.name, group.id]), [['Color', '4'], ['Size', '30']]);
  assert.equal(product.skus.length, fixture.data.skuInfo.priceList.length);
  assert.equal(product.skus.length, 45);
  assert.equal(product.selectedSkuId, '12000049151727540');
  assert.deepEqual(product.selectedSku.skuPropIds, ['337970', '343562']);
  assert.deepEqual(product.selectedSku.selections.map((selection) => selection.name), ['Lining B Navy Blue', 'L']);
  assert.equal(product.selectedSku.selections[0].rawName, 'Clear');
  assert.equal(product.selectedSku.price.current.value, '26.08');
  assert.equal(product.selectedSku.price.current.currency, 'USD');
  assert.equal(product.selectedSku.price.regular.value, '37.25');
  assert.equal(product.selectedSku.price.regular.currency, 'USD');
  assert.equal(product.selectedSku.stock, 593);
  assert.equal(JSON.parse(core.exportProduct(product)).skus.length, 45);
});

test('real byUnitTables sizeData preserves separate CM and IN tables', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540');
  const cm = product.sizeGuide.tables.find((table) => table.unit === 'CM');
  const inches = product.sizeGuide.tables.find((table) => table.unit === 'IN');

  assert.deepEqual(fixture.data.skuInfo.sizeData.defaults, { countryCode: 'Manufacturer-size3', unit: 'IN' });
  assert.equal(product.sizeGuide.tables.length, 2);
  assert.deepEqual(cm.columns, ['Size', 'Bust Size', 'Skirt Length', 'Waist Size']);
  assert.deepEqual(cm.rows[3], ['L', '92', '100', '77']);
  assert.deepEqual(inches.columns, ['Size', 'Bust Size', 'Skirt Length', 'Waist Size']);
  assert.deepEqual(inches.rows[3], ['L', '36.22', '39.37', '30.31']);
  assert.notDeepEqual(cm.rows, inches.rows);

  const exported = core.exportForChatGPT(product);
  assert.match(exported, /Table \(CM\)/);
  assert.match(exported, /Table \(IN\)/);
  assert.match(exported, /Size \| Bust Size \| Skirt Length \| Waist Size/);
});

test('sizeData generic table fallback remains supported', () => {
  const sizeGuide = core.normalizeSizeGuide({
    tables: [{ unit: 'MM', columns: ['Size', 'Length'], rows: [['A', 125]] }],
  });

  assert.equal(sizeGuide.tables.length, 1);
  assert.equal(sizeGuide.tables[0].unit, 'MM');
  assert.deepEqual(sizeGuide.tables[0].rows, [['A', '125']]);
});

test('sizeData preserves an arbitrary byUnitTables key', () => {
  const sizeGuide = core.normalizeSizeGuide({
    byCountryTables: {
      default: {
        byUnitTables: {
          MM: { titles: ['Size', 'Length'], rows: [['A', 125]] },
        },
      },
    },
  });

  assert.equal(sizeGuide.tables.length, 1);
  assert.equal(sizeGuide.tables[0].unit, 'MM');
  assert.deepEqual(sizeGuide.tables[0].rows, [['A', '125']]);
});

test('does not invent a missing Cartesian combination', () => {
  const fixture = clone(loadFixture('product-1005009452926938.json'));
  fixture.data.skuInfo.priceList.splice(10, 1);
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html');

  assert.equal(fixture.data.skuInfo.priceList.length, 44);
  assert.equal(product.skus.length, 44);
});

test('initial normalization falls back to activeSkuId when URL has no sku_id', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html');

  assert.equal(product.selectedSkuId, fixture.data.activeSkuId);
  assert.deepEqual(product.selectedSku.selections.map((selection) => selection.name), ['Lining B White', 'S']);
});

test('initial normalization falls back to activeSkuId when URL sku_id is unknown', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=99999999999999999');

  assert.equal(product.selectedSkuId, fixture.data.activeSkuId);
  assert.equal(product.selectedSku.skuId, fixture.data.activeSkuId);
});

test('updateSelectedSku changes only selected state for a valid SPA sku_id', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540');
  const description = { sentinel: 'description' };
  const store = { sentinel: 'store' };
  const delivery = { sentinel: 'delivery' };
  const reviews = [{ sentinel: 'reviews' }];
  product.description = description;
  product.store = store;
  product.delivery = delivery;
  product.reviews = reviews;
  const originalSelected = product.skus.find((sku) => sku.skuId === '12000049151727540');
  const originalBuyerPriceForLogistic = originalSelected.buyerPriceForLogistic;
  const originalDiscount = originalSelected.price.discount;
  const originalSkuAttr = originalSelected.rawSkuAttr;

  const updated = core.updateSelectedSku(product, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727530');

  assert.notEqual(updated, product);
  assert.equal(updated.selectedSkuId, '12000049151727530');
  assert.deepEqual(updated.selectedSku.selections.map((selection) => selection.name), ['Lining B Pink', 'L']);
  assert.equal(updated.price.current.value, '26.08');
  assert.equal(updated.selectedSku.stock, 496);
  assert.equal(updated.variantGroups, product.variantGroups);
  assert.equal(updated.skus, product.skus);
  assert.equal(updated.sizeGuide, product.sizeGuide);
  assert.equal(updated.description, description);
  assert.equal(updated.store, store);
  assert.equal(updated.delivery, null);
  assert.equal(updated.reviews, reviews);
  assert.equal(updated.skus.find((sku) => sku.skuId === '12000049151727540').buyerPriceForLogistic, originalBuyerPriceForLogistic);
  assert.equal(Object.hasOwn(updated.skus.find((sku) => sku.skuId === '12000049151727540').price, 'buyer'), false);
  assert.equal(updated.skus.find((sku) => sku.skuId === '12000049151727540').price.discount, originalDiscount);
  assert.equal(updated.skus.find((sku) => sku.skuId === '12000049151727540').rawSkuAttr, originalSkuAttr);
  assert.match(core.exportForChatGPT(updated), /Selected variants: Color: Lining B Pink; Size: L/);
  assert.match(core.exportForChatGPT(updated), /Price: \$\u00a026\.08/);
});

test('SKU change clears stale delivery and restores cached delivery when returning', () => {
  const productFixture = loadFixture('product-1005008195850531.json');
  const shippingFixture = loadFixture('shipping-calculate-1005008195850531.json');
  const cache = core.createDeliveryCache();
  const deliveryA = core.normalizeDelivery(shippingFixture.request, shippingFixture.response);
  core.cacheDelivery(cache, shippingFixture.request, deliveryA);

  let product = core.normalizeProduct(
    productFixture.data,
    'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689',
  );
  product = core.applyCachedDelivery(product, cache);
  assert.equal(product.delivery, deliveryA);
  assert.equal(core.applyCachedDelivery({ ...product, itemId: 'other-item', delivery: null }, cache).delivery, null);

  product = core.updateSelectedSku(
    product,
    'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848683',
  );
  product = core.applyCachedDelivery(product, cache);
  assert.equal(product.selectedSkuId, '12000056550848683');
  assert.equal(product.delivery, null);

  product = core.updateSelectedSku(
    product,
    'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689',
  );
  product = core.applyCachedDelivery(product, cache);
  assert.equal(product.selectedSkuId, '12000056550848689');
  assert.equal(product.delivery, deliveryA);
});

test('updateSelectedSku keeps the last valid selection for unknown or absent sku_id', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540');

  const unknown = core.updateSelectedSku(product, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=99999999999999999');
  const absent = core.updateSelectedSku(product, 'https://aliexpress.ru/item/1005009452926938.html');

  assert.equal(unknown, product);
  assert.equal(absent, product);
  assert.equal(product.selectedSkuId, '12000049151727540');
  assert.equal(product.selectedSku.skuId, '12000049151727540');
});

test('recursively finds nested productData without a hardcoded path', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const found = core.findProductDataCandidate({ widgets: [{ children: [{ props: { response: fixture } }] }] });

  assert.equal(found.data, fixture.data);
  assert.match(found.path, /widgets/);
});
