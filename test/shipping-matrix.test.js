'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

const FREE_ITEM_ID = '1005007275021771';
const FREE_SKU_ID = '12000040029370608';
const FREE_FIXTURE_NAME = `shipping-calculate-${FREE_ITEM_ID}.json`;
const FREE_PRODUCT_FIXTURE_NAME = `product-${FREE_ITEM_ID}.json`;

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function normalizeCurrentFreeSkuContext(updateRow) {
  const fixture = loadFixture(FREE_PRODUCT_FIXTURE_NAME);
  const data = JSON.parse(JSON.stringify(fixture.data));
  if (updateRow) updateRow(data.skuInfo.priceList[0]);
  return core.normalizeProduct(
    data,
    `https://aliexpress.ru/item/${FREE_ITEM_ID}.html?sku_id=${FREE_SKU_ID}`,
  );
}

test('real free-shipping fixture records one exact naturally captured zero-cost method', () => {
  const fixture = loadFixture(FREE_FIXTURE_NAME);

  assert.equal(fixture.sourceUrl, 'https://aliexpress.ru/aer-api/v1/pdp/web/freight/calculate');
  assert.equal(fixture.transport, 'fetch');
  assert.equal(fixture.request.productId, 1005007275021771);
  assert.equal(fixture.request.productIdV2, FREE_ITEM_ID);
  assert.equal(fixture.request.skuId, FREE_SKU_ID);
  assert.equal(fixture.request.country, 'MD');
  assert.equal(fixture.request.count, 1);
  assert.equal(fixture.request.tradeCurrency, 'CNY');
  assert.equal(fixture.request.minPrice, 76.51);
  assert.equal(fixture.request.maxPrice, 76.51);
  assert.equal(fixture.request.buyerPrice, '1145');
  assert.equal(fixture.request.freeDelivery, null);
  assert.deepEqual(fixture.response.to, {
    country: 'MD',
    city: '924500010001000000',
    region: '924500010000000000',
    countryName: 'Moldova',
    cityName: 'Kishinev',
    regionName: 'Kishinev Region',
  });
  assert.equal(fixture.response.displayMultipleMethods, false);
  assert.equal(fixture.response.methods.length, 1);
  assert.deepEqual(fixture.response.freeMethods, []);
  assert.equal(Object.hasOwn(fixture.response, 'error'), false);
  assert.equal(Object.hasOwn(fixture.response, 'success'), false);
  assert.equal(Object.hasOwn(fixture.response, 'ok'), false);
  assert.equal(Object.hasOwn(fixture.response, 'code'), false);

  const method = fixture.response.methods[0];
  assert.equal(method.groupName, 'Post office');
  assert.equal(method.serviceName, 'CAINIAO_FULFILLMENT_STD');
  assert.equal(method.service, '');
  assert.equal(method.tracking, false);
  assert.equal(method.serviceGroupType, 'rupost_self_pickup_point');
  assert.equal(method.passportRequired, false);
  assert.equal(method.dateDisplay, '2026-09-12');
  assert.equal(method.dateFormat, '9–12 September');
  assert.equal(method.etaStartDeliveryDate, '2026-09-09');
  assert.equal(method.etaEndDeliveryDate, '2026-09-12');
  assert.equal(Object.hasOwn(method, 'amount'), true);
  assert.equal(Object.hasOwn(method.amount, 'value'), true);
  assert.equal(method.amount.value, 0);
  assert.equal(method.amount.currency, 'USD');
  assert.equal(method.amount.formatted, 'US $0');
});

test('real free-shipping capture matches and preserves zero as Delivery data', () => {
  const fixture = loadFixture(FREE_FIXTURE_NAME);
  const inspection = core.inspectDeliveryCapture(
    fixture.request,
    fixture.response,
    FREE_ITEM_ID,
    FREE_SKU_ID,
  );

  assert.equal(inspection.matched, true);
  assert.equal(inspection.diagnostic, null);
  assert.ok(inspection.delivery);
  assert.equal(inspection.delivery.productId, FREE_ITEM_ID);
  assert.equal(inspection.delivery.skuId, FREE_SKU_ID);
  assert.equal(inspection.delivery.methods.length, 1);
  const method = inspection.delivery.methods[0];
  assert.ok(method.cost);
  assert.equal(method.cost.value, '0');
  assert.equal(method.cost.currency, 'USD');
  assert.equal(method.cost.formatted, 'US $0');
  assert.equal(method.cost.raw.value, 0);

  const formatted = core.formatDelivery(inspection.delivery);
  assert.match(formatted, /Destination: Kishinev, Kishinev Region, Moldova \(MD\)/);
  assert.match(formatted, /Method: Post office/);
  assert.match(formatted, /Service: CAINIAO_FULFILLMENT_STD/);
  assert.match(formatted, /Price: US \$0/);
  assert.match(formatted, /Estimated delivery: 2026-09-09 — 2026-09-12 \(9–12 September\)/);
  assert.doesNotMatch(formatted, /Price: —/);
});

test('real free-shipping ProductData binds the current cross-currency freight price context', () => {
  const fixture = loadFixture(FREE_PRODUCT_FIXTURE_NAME);
  assert.equal(fixture.data.id, FREE_ITEM_ID);
  assert.equal(fixture.data.activeSkuId, FREE_SKU_ID);
  assert.equal(fixture.data.skuInfo.propertyList.length, 1);
  assert.equal(fixture.data.skuInfo.priceList.length, 1);

  const row = fixture.data.skuInfo.priceList[0];
  assert.equal(row.skuId, FREE_SKU_ID);
  assert.equal(row.skuPropIds, '337904');
  assert.equal(row.activityAmount.value, 11.45);
  assert.equal(row.activityAmount.currency, 'USD');
  assert.equal(row.buyerPriceForLogistic, '1145');
  assert.equal(row.logisticAmount.value, 76.51);
  assert.equal(row.logisticAmount.currency, 'CNY');
  assert.equal(row.availQuantity, 204);

  const product = normalizeCurrentFreeSkuContext();
  assert.equal(product.selectedSkuId, FREE_SKU_ID);
  assert.equal(product.selectedSku.price.current.value, '11.45');
  assert.equal(product.selectedSku.price.current.currency, 'USD');
  assert.equal(product.selectedSku.buyerPriceForLogistic, '1145');
  assert.equal(product.selectedSku.logisticAmount.value, 76.51);
  assert.equal(product.selectedSku.logisticAmount.currency, 'CNY');
});

test('real free-shipping capture restores exact current SKU context and exports present Delivery', () => {
  const fixture = loadFixture(FREE_FIXTURE_NAME);
  const initial = normalizeCurrentFreeSkuContext();
  assert.equal(initial.selectedSkuId, FREE_SKU_ID);
  assert.equal(initial.selectedSku.price.current.value, '11.45');
  assert.equal(initial.selectedSku.price.current.currency, 'USD');
  assert.equal(initial.selectedSku.buyerPriceForLogistic, '1145');
  assert.equal(initial.selectedSku.logisticAmount.value, 76.51);
  assert.equal(initial.selectedSku.logisticAmount.currency, 'CNY');

  const cache = core.createDeliveryCache();
  const captured = core.cacheDeliveryCapture(
    cache,
    fixture.request,
    fixture.response,
    FREE_ITEM_ID,
    FREE_SKU_ID,
  );
  assert.equal(captured.matched, true);
  assert.equal(captured.diagnostic, null);
  const environment = core.createShippingEnvironment(fixture.request, captured.delivery);
  const product = core.applyCachedDelivery(initial, cache, environment);

  assert.deepEqual(product.delivery, captured.delivery);
  assert.equal(product.delivery.methods[0].cost.value, '0');
  assert.deepEqual(product._meta.sections.delivery, {
    state: 'present',
    sources: ['native:shipping-calculate'],
    diagnostic: null,
  });
  assert.equal(product._meta.completeness.state, 'partial');
  assert.equal(product._meta.completeness.notObservedSections.includes('delivery'), false);

  const wrongDestination = {
    ...environment,
    destination: { ...environment.destination, cityCode: 'different-city' },
  };
  const unmatched = core.applyCachedDelivery(initial, cache, wrongDestination);
  assert.equal(unmatched.delivery, null);
  assert.deepEqual(unmatched._meta.sections.delivery, {
    state: 'not-observed',
    sources: [],
    diagnostic: null,
  });

  const changedLogisticPrice = normalizeCurrentFreeSkuContext((row) => {
    row.logisticAmount.value = 76.52;
  });
  assert.equal(core.applyCachedDelivery(changedLogisticPrice, cache, environment).delivery, null);

  const changedBuyerPrice = normalizeCurrentFreeSkuContext((row) => {
    row.buyerPriceForLogistic = '1146';
  });
  assert.equal(core.applyCachedDelivery(changedBuyerPrice, cache, environment).delivery, null);

  const incompatibleLogisticCurrency = normalizeCurrentFreeSkuContext((row) => {
    row.logisticAmount.currency = 'EUR';
  });
  assert.equal(core.applyCachedDelivery(incompatibleLogisticCurrency, cache, environment).delivery, null);

  const copied = JSON.parse(core.exportProduct(product));
  assert.deepEqual(copied.delivery.methods[0].cost, product.delivery.methods[0].cost);
  assert.deepEqual(copied._meta.sections.delivery, product._meta.sections.delivery);
  assert.deepEqual(copied._meta.completeness, product._meta.completeness);

  const chatgpt = core.exportForChatGPT(product);
  assert.match(chatgpt, /DELIVERY:\nDestination: Kishinev, Kishinev Region, Moldova \(MD\)/);
  assert.match(chatgpt, /Price: US \$0/);
  assert.doesNotMatch(chatgpt, /DELIVERY:[\s\S]*?Price: —/);
});

test('real free-shipping capture fails closed when displayed SKU currency is missing', () => {
  const fixture = loadFixture(FREE_FIXTURE_NAME);
  const initial = normalizeCurrentFreeSkuContext((row) => {
    delete row.activityAmount.currency;
  });
  assert.equal(initial._meta.selectedSkuResolved, true);
  assert.equal(initial.selectedSkuId, FREE_SKU_ID);
  assert.equal(initial.selectedSku.skuId, FREE_SKU_ID);
  assert.equal(initial.selectedSku.price.current.value, '11.45');
  assert.equal(initial.selectedSku.price.current.currency, null);
  assert.equal(initial.selectedSku.buyerPriceForLogistic, '1145');
  assert.equal(initial.selectedSku.logisticAmount.value, 76.51);
  assert.equal(initial.selectedSku.logisticAmount.currency, 'CNY');

  const cache = core.createDeliveryCache();
  const captured = core.cacheDeliveryCapture(
    cache,
    fixture.request,
    fixture.response,
    FREE_ITEM_ID,
    FREE_SKU_ID,
  );
  assert.equal(captured.matched, true);
  assert.equal(captured.diagnostic, null);
  const environment = core.createShippingEnvironment(fixture.request, captured.delivery);
  assert.equal(environment.tradeCurrency, 'CNY');
  const product = core.applyCachedDelivery(initial, cache, environment);

  assert.equal(product._meta.selectedSkuResolved, true);
  assert.equal(product.selectedSkuId, FREE_SKU_ID);
  assert.equal(product.selectedSku.skuId, FREE_SKU_ID);
  assert.equal(product.delivery, null);
  assert.deepEqual(product._meta.sections.delivery, {
    state: 'not-observed',
    sources: [],
    diagnostic: null,
  });
});

test('existing real paid-shipping fixture remains paid', () => {
  const fixture = loadFixture('shipping-calculate-1005008195850531.json');
  const inspection = core.inspectDeliveryCapture(
    fixture.request,
    fixture.response,
    '1005008195850531',
    '12000056550848689',
  );

  assert.equal(inspection.matched, true);
  assert.equal(inspection.diagnostic, null);
  assert.ok(inspection.delivery);
  assert.equal(inspection.delivery.methods.length, 1);
  const method = inspection.delivery.methods[0];
  assert.equal(method.groupName, 'Post office');
  assert.equal(method.serviceName, 'CAINIAO_STANDARD');
  assert.equal(method.cost.value, '8.52');
  assert.equal(method.cost.currency, 'USD');
  assert.equal(method.cost.formatted, '$ 8.52');
  assert.match(core.formatDelivery(inspection.delivery), /Price: \$ 8\.52/);

  const productFixture = loadFixture('product-1005008195850531.json');
  const paidRow = productFixture.data.skuInfo.priceList
    .find((row) => row.skuId === '12000056550848689');
  paidRow.logisticAmount = { value: 99, currency: 'USD', formatted: '$ 99.00' };
  const product = core.normalizeProduct(
    productFixture.data,
    'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689',
  );
  const cache = core.createDeliveryCache();
  const captured = core.cacheDeliveryCapture(
    cache,
    fixture.request,
    fixture.response,
    '1005008195850531',
    '12000056550848689',
  );
  const environment = core.createShippingEnvironment(fixture.request, captured.delivery);
  const restored = core.applyCachedDelivery(product, cache, environment);
  assert.deepEqual(restored.delivery, captured.delivery);
  assert.equal(restored.delivery.methods[0].cost.value, '8.52');
});
