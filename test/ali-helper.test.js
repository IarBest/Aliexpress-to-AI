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

function syntheticShippingProduct(skuId, buyerPrice, price) {
  return {
    itemId: 'synthetic-product',
    selectedSkuId: skuId,
    selectedSku: {
      skuId,
      buyerPriceForLogistic: String(buyerPrice),
      price: { current: { value: String(price) } },
    },
    delivery: null,
  };
}

function syntheticCharacteristicsDom(rows, outsideRows = []) {
  const makeItem = (row) => ({
    querySelector(selector) {
      if (selector.includes('ProductCharacteristicsItem__name__')) return row.nameNode || { textContent: row.name };
      if (selector.includes('ProductCharacteristicsItem__value__')) return row.valueNode || { textContent: row.value };
      return null;
    },
  });
  const items = rows.map(makeItem);
  const outsideItems = outsideRows.map(makeItem);
  const boundary = {
    querySelectorAll(selector) {
      return selector.includes('HazeProductCharacteristics__itemForSku') ? items : [];
    },
  };
  return {
    outsideItems,
    querySelector(selector) {
      return selector.includes('HazeProductCharacteristics__groupsContainerForSku') ? boundary : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('HazeProductCharacteristics__groupsContainerForSku')) return [boundary];
      if (selector.includes('HazeProductCharacteristics__itemForSku')) return outsideItems;
      return [];
    },
  };
}

function syntheticDescriptionDom(html, options = {}) {
  const createElement = (tagName, attributes = {}) => ({
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: [],
    attributes,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    matches(selector) {
      return selector === '#content_anchor' && this.attributes.id === 'content_anchor';
    },
  });
  const createText = (value) => ({ nodeType: 3, nodeValue: value, textContent: value });
  const boundary = createElement('div', { id: 'content_anchor' });
  boundary.innerHTML = html;
  const stack = [boundary];
  const voidTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
  const tokens = html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || [];

  tokens.forEach((token) => {
    if (token.startsWith('<!--')) return;
    const closing = token.match(/^<\s*\/\s*([\w-]+)[^>]*>$/);
    if (closing) {
      if (stack.length > 1) stack.pop();
      return;
    }
    const opening = token.match(/^<\s*([\w-]+)([\s\S]*?)\/?\s*>$/);
    if (opening) {
      const attributes = {};
      const attributeSource = opening[2];
      const attributePattern = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      let match;
      while ((match = attributePattern.exec(attributeSource))) {
        if (match[1] === '/') continue;
        attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
      }
      const element = createElement(opening[1], attributes);
      stack.at(-1).childNodes.push(element);
      if (!voidTags.has(opening[1].toLowerCase()) && !/\/\s*>$/.test(token)) stack.push(element);
      return;
    }
    stack.at(-1).childNodes.push(createText(token));
  });

  return {
    boundary,
    querySelector(selector) {
      return options.missing || selector !== '#content_anchor' ? null : boundary;
    },
  };
}

function syntheticRatingDom(values, options = {}) {
  const textNode = (text) => ({ innerText: text, textContent: text });
  const extraInfo = {
    querySelector(selector) {
      if (selector.includes('ratingWrap')) return values.ratingText === null ? null : textNode(values.ratingText);
      if (selector === 'a[href="#reviews_anchor"]') return values.reviewText === null ? null : textNode(values.reviewText);
      if (selector.includes('buyCounter')) return values.boughtText === null ? null : textNode(values.boughtText);
      return null;
    },
  };
  const productRoot = {
    matches(selector) { return selector.includes('HazeProductDescription__root'); },
    querySelector(selector) {
      if (selector === 'h1') return options.missingHeading ? null : textNode('Actual product');
      if (selector.includes('HazeProductDescription__extraInfo')) return extraInfo;
      return null;
    },
  };
  const recommendationRoot = {
    matches() { return true; },
    querySelector(selector) {
      if (selector === 'h1') return null;
      if (selector.includes('HazeProductDescription__extraInfo')) return { textContent: '1.0 999 reviews 8K bought' };
      return null;
    },
  };
  const root = {
    querySelectorAll(selector) {
      return selector.includes('HazeProductDescription__root') ? [recommendationRoot, productRoot] : [];
    },
    querySelector() {
      return options.sellerSentinel || options.recommendationSentinel || null;
    },
  };
  return { root, productRoot, extraInfo, recommendationRoot };
}

function ratingSsrCandidate({ itemId, ratingRaw, reviewCount, feedbackCount }) {
  const props = {
    resolveParams: {},
    analyticEvents: {
      clickAllReviews: { trackingInfo: { itemId, overallRating: ratingRaw } },
      viewWidgetReview: { trackingInfo: { itemId, overallRating: ratingRaw } },
    },
  };
  if (reviewCount !== undefined) props.resolveParams['review.productReviewsCount'] = reviewCount;
  if (feedbackCount !== undefined) props.resolveParams['review.productFeedbacksCount'] = feedbackCount;
  return { props };
}

test('userscript metadata and runtime versions stay in sync', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ali-helper.user.js'), 'utf8');
  const metadataVersion = source.match(/^\/\/ @version\s+(\S+)\s*$/m);
  const runtimeVersion = source.match(/^\s*const VERSION = ['"]([^'"]+)['"];\s*$/m);

  assert.ok(metadataVersion, 'userscript metadata version is missing');
  assert.ok(runtimeVersion, 'runtime VERSION constant is missing');
  assert.equal(runtimeVersion[1], metadataVersion[1]);
});

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
  assert.deepEqual(core.createShippingEnvironment(fixture.request, delivery), {
    destination: {
      countryCode: 'MD',
      regionCode: '924500010000000000',
      cityCode: '924500010001000000',
    },
    tradeCurrency: 'USD',
    count: '1',
  });
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
  const product = {
    itemId: 'synthetic-product',
    selectedSkuId: 'synthetic-sku',
    selectedSku: { buyerPriceForLogistic: null, price: { current: { value: null } } },
    title: 'Synthetic product',
    delivery: null,
  };
  core.cacheDelivery(cache, request, delivery);
  const environment = core.createShippingEnvironment(request, delivery);
  const updated = core.applyCachedDelivery(product, cache, environment);
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
  const delivery = core.normalizeDelivery(base, { to: { country: 'MD', region: 'region-1', city: 'city-1' } });

  assert.equal(core.createShippingContextKey(base, delivery), core.createShippingContextKey({ ...base }, delivery));
  assert.notEqual(core.createShippingContextKey(base, delivery), core.createShippingContextKey({ ...base, productId: 2 }, delivery));
  assert.notEqual(core.createShippingContextKey(base, delivery), core.createShippingContextKey({ ...base, skuId: 'other-synthetic-sku' }, delivery));
  assert.notEqual(core.createShippingContextKey(base, delivery), core.createShippingContextKey({ ...base, tradeCurrency: 'EUR' }, delivery));
  assert.notEqual(core.createShippingContextKey(base, delivery), core.createShippingContextKey({ ...base, count: 2 }, delivery));
  assert.notEqual(core.createShippingContextKey(base, delivery), core.createShippingContextKey({ ...base, buyerPrice: '250' }, delivery));
  assert.notEqual(core.createShippingContextKey(base, delivery), core.createShippingContextKey({ ...base, maxPrice: 2.5 }, delivery));
  assert.notEqual(
    core.createShippingContextKey(base, delivery),
    core.createShippingContextKey(base, { ...delivery, destination: { ...delivery.destination, cityCode: 'city-2' } }),
  );
});

test('synthetic shipping cache retains multiple contexts and returns only a compatible delivery', () => {
  const cache = core.createDeliveryCache();
  const baseRequest = { productId: 'synthetic-product', skuId: 'synthetic-sku', country: 'MD', tradeCurrency: 'USD', count: 1 };
  const firstRequest = { ...baseRequest, buyerPrice: '100', minPrice: 1, maxPrice: 1 };
  const latestRequest = { ...baseRequest, buyerPrice: '200', minPrice: 2, maxPrice: 2 };
  const firstDelivery = core.normalizeDelivery(firstRequest, { to: { country: 'MD', region: 'region-1', city: 'city-1' } });
  const latestDelivery = core.normalizeDelivery(latestRequest, { to: { country: 'MD', region: 'region-1', city: 'city-1' } });

  core.cacheDelivery(cache, firstRequest, firstDelivery);
  core.cacheDelivery(cache, latestRequest, latestDelivery);

  assert.equal(cache.byContext.size, 2);
  const environment = core.createShippingEnvironment(latestRequest, latestDelivery);
  assert.equal(
    core.getCachedDelivery(cache, 'synthetic-product', 'synthetic-sku', environment, { buyerPrice: '200', minPrice: '2', maxPrice: '2' }),
    latestDelivery,
  );
  assert.equal(
    core.getCachedDelivery(cache, 'synthetic-product', 'synthetic-sku', environment, { buyerPrice: '300', minPrice: '3', maxPrice: '3' }),
    null,
  );
});

test('shipping cache rejects an old destination and accepts a new capture for that city', () => {
  const cache = core.createDeliveryCache();
  const requestA = {
    productId: 'synthetic-product', skuId: 'sku-a', country: 'MD', provinceCode: null, cityCode: null,
    tradeCurrency: 'USD', count: 1, buyerPrice: '100', minPrice: 1, maxPrice: 1,
  };
  const requestB = {
    ...requestA, skuId: 'sku-b', buyerPrice: '200', minPrice: 2, maxPrice: 2,
  };
  const responseCity1 = { to: { country: 'MD', region: 'region-1', city: 'city-1' } };
  const responseCity2 = { to: { country: 'MD', region: 'region-2', city: 'city-2' } };
  const deliveryACity1 = core.normalizeDelivery(requestA, responseCity1);
  core.cacheDelivery(cache, requestA, deliveryACity1);

  const deliveryBCity2 = core.normalizeDelivery(requestB, responseCity2);
  core.cacheDelivery(cache, requestB, deliveryBCity2);
  const city2Environment = core.createShippingEnvironment(requestB, deliveryBCity2);
  const productA = syntheticShippingProduct('sku-a', 100, 1);

  assert.equal(core.applyCachedDelivery(productA, cache, city2Environment).delivery, null);

  const deliveryACity2 = core.normalizeDelivery(requestA, responseCity2);
  core.cacheDelivery(cache, requestA, deliveryACity2);
  const refreshedEnvironment = core.createShippingEnvironment(requestA, deliveryACity2);
  assert.equal(core.applyCachedDelivery(productA, cache, refreshedEnvironment).delivery, deliveryACity2);
});

test('shipping cache restores SKU A after SKU B capture when destination and request environment stay unchanged', () => {
  const cache = core.createDeliveryCache();
  const requestA = {
    productId: 'synthetic-product', skuId: 'sku-a', country: 'MD', tradeCurrency: 'USD', count: 1,
    buyerPrice: '100', minPrice: 1, maxPrice: 1,
  };
  const requestB = {
    ...requestA, skuId: 'sku-b', buyerPrice: '200', minPrice: 2, maxPrice: 2,
  };
  const response = { to: { country: 'MD', region: 'region-1', city: 'city-1' } };
  const deliveryA = core.normalizeDelivery(requestA, response);
  const deliveryB = core.normalizeDelivery(requestB, response);
  core.cacheDelivery(cache, requestA, deliveryA);
  core.cacheDelivery(cache, requestB, deliveryB);

  const environmentAfterB = core.createShippingEnvironment(requestB, deliveryB);
  assert.equal(
    core.applyCachedDelivery(syntheticShippingProduct('sku-a', 100, 1), cache, environmentAfterB).delivery,
    deliveryA,
  );
});

test('shipping cache rejects cached delivery after currency or count changes', () => {
  const cache = core.createDeliveryCache();
  const requestA = {
    productId: 'synthetic-product', skuId: 'sku-a', country: 'MD', tradeCurrency: 'USD', count: 1,
    buyerPrice: '100', minPrice: 1, maxPrice: 1,
  };
  const response = { to: { country: 'MD', region: 'region-1', city: 'city-1' } };
  const deliveryA = core.normalizeDelivery(requestA, response);
  core.cacheDelivery(cache, requestA, deliveryA);
  const productA = syntheticShippingProduct('sku-a', 100, 1);

  const eurRequest = { ...requestA, skuId: 'sku-b', tradeCurrency: 'EUR' };
  const eurDelivery = core.normalizeDelivery(eurRequest, response);
  const eurEnvironment = core.createShippingEnvironment(eurRequest, eurDelivery);
  assert.equal(core.applyCachedDelivery(productA, cache, eurEnvironment).delivery, null);

  const countTwoRequest = { ...requestA, skuId: 'sku-b', count: 2 };
  const countTwoDelivery = core.normalizeDelivery(countTwoRequest, response);
  const countTwoEnvironment = core.createShippingEnvironment(countTwoRequest, countTwoDelivery);
  assert.equal(core.applyCachedDelivery(productA, cache, countTwoEnvironment).delivery, null);
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

test('captured live characteristics preserve real name/value pairs and display order', () => {
  const fixture = loadFixture('characteristics-1005009452926938.json');
  const characteristics = core.extractCharacteristicsFromDom(syntheticCharacteristicsDom(fixture.rows));

  assert.equal(fixture.sourceKind, 'DOM observation');
  assert.deepEqual(characteristics, fixture.rows);
  assert.deepEqual(characteristics.map(({ name }) => name), ['Brand Name', 'Model Number', 'Origin', 'Type', 'Material']);

  const productFixture = loadFixture('product-1005009452926938.json');
  const product = core.updateCharacteristics(
    core.normalizeProduct(productFixture.data, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540'),
    characteristics,
  );
  assert.deepEqual(JSON.parse(core.exportProduct(product)).characteristics, fixture.rows);
});

test('missing characteristics return an empty array without breaking product normalization', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');

  assert.deepEqual(core.extractCharacteristicsFromDom(null), []);
  assert.deepEqual(core.extractCharacteristicsFromDom({ querySelectorAll: () => [] }), []);
  assert.deepEqual(product.characteristics, []);
});

test('characteristics collapse formatting whitespace and skip partial rows', () => {
  const characteristics = core.extractCharacteristicsFromDom(syntheticCharacteristicsDom([
    { name: '  Model\n\t Number  ', value: '  Super   Maxi\n dress ' },
    { name: 'Missing value', value: '   ' },
    { name: '', value: 'Missing name' },
  ]));

  assert.deepEqual(characteristics, [{ name: 'Model Number', value: 'Super Maxi dress' }]);
});

test('characteristics extractor ignores third-party rows outside the AliExpress boundary', () => {
  const root = syntheticCharacteristicsDom(
    [{ name: 'Brand Name', value: 'AliExpress product value' }],
    [{ name: 'Store', value: 'Megabonus sentinel' }],
  );

  assert.equal(root.outsideItems.length, 1);
  assert.deepEqual(core.extractCharacteristicsFromDom(root), [
    { name: 'Brand Name', value: 'AliExpress product value' },
  ]);
});

test('ChatGPT export lists characteristics in normalized order and uses a neutral empty marker', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html', {
    characteristics: [
      { name: 'First', value: 'One' },
      { name: 'Second', value: 'Two' },
    ],
  });
  const exported = core.exportForChatGPT(product);
  const emptyExport = core.exportForChatGPT({ ...product, characteristics: [] });

  assert.match(exported, /CHARACTERISTICS:\nFirst: One\nSecond: Two\n\nDESCRIPTION:/);
  assert.match(emptyExport, /CHARACTERISTICS:\n—\n\nDESCRIPTION:/);
});

test('characteristics enrichment preserves the model and is reference-stable for unchanged or absent data', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540');
  const sentinels = {
    price: product.price,
    selectedSku: product.selectedSku,
    skus: product.skus,
    sizeGuide: product.sizeGuide,
    delivery: { sentinel: 'delivery' },
    store: { sentinel: 'store' },
    reviews: [{ sentinel: 'reviews' }],
  };
  Object.assign(product, sentinels);

  const updated = core.updateCharacteristics(product, [{ name: 'Material', value: 'Polyester' }]);

  assert.notEqual(updated, product);
  assert.deepEqual(updated.characteristics, [{ name: 'Material', value: 'Polyester' }]);
  Object.entries(sentinels).forEach(([key, value]) => assert.equal(updated[key], value));
  assert.equal(core.updateCharacteristics(updated, [{ name: 'Material', value: 'Polyester' }]), updated);
  assert.equal(core.updateCharacteristics(updated, []), updated);
});

test('localized rating parser accepts scoped decimal forms and preserves zero', () => {
  assert.equal(core.parseLocalizedRating('5,0'), 5);
  assert.equal(core.parseLocalizedRating('4,6'), 4.6);
  assert.equal(core.parseLocalizedRating('4.6'), 4.6);
  assert.equal(core.parseLocalizedRating(5), 5);
  assert.equal(core.parseLocalizedRating(0), 0);
  for (const value of [null, '', 'rating 4.6', 'garbage', 6, 100]) assert.equal(core.parseLocalizedRating(value), null);
});

test('localized count parser handles observed text, K suffixes, grouping spaces, and zero', () => {
  const cases = new Map([
    ['0', 0], [0, 0], ['13 bought', 13], ['413 purchased', 413],
    ['3K', 3000], ['3K+', 3000], ['3,2K', 3200], ['3.2K', 3200],
    ['1 234', 1234], ['1\u00a0234', 1234], ['1\u202f234', 1234], ['1,234', 1234],
  ]);
  cases.forEach((expected, value) => assert.equal(core.parseLocalizedCount(value), expected, JSON.stringify(value)));
  for (const value of [null, '', 'sold 13', '1.2', '3M', -1, 1.5]) assert.equal(core.parseLocalizedCount(value), null);
});

test('captured live rating/trade observations normalize relay and dress values', () => {
  for (const name of ['rating-trade-1005008195850531.json', 'rating-trade-1005009452926938.json']) {
    const fixture = loadFixture(name);
    const candidate = ratingSsrCandidate({
      itemId: fixture.itemId,
      ratingRaw: fixture.ssr.ratingRaw,
      reviewCount: fixture.ssr.reviewCount,
      feedbackCount: fixture.ssr.feedbackCountObservedButNotUsedForP1,
    });
    const structured = core.extractBasicRatingFromSsrData({ widgets: [candidate] }, fixture.itemId);
    const dom = core.extractBasicRatingFromDom(syntheticRatingDom(fixture.dom).root);
    const summary = core.mergeRatingSummary(structured, dom);
    assert.equal(fixture.sourceKind, 'minimized live SSR and DOM observation');
    assert.deepEqual(
      { rating: summary.rating, reviewCount: summary.reviewCount, boughtCount: summary.boughtCount },
      fixture.expected,
    );
    assert.deepEqual(summary.display, {
      rating: fixture.dom.ratingText,
      reviewCount: fixture.dom.reviewText,
      boughtCount: fixture.dom.boughtText,
    });
  }
});

test('duplicate trusted SSR review widgets agree while conflicts stay unknown', () => {
  const relay = ratingSsrCandidate({ itemId: 'relay', ratingRaw: '5,0', reviewCount: 5 });
  const accepted = core.extractBasicRatingFromSsrData({ children: [relay, clone(relay)] }, 'relay');
  assert.equal(accepted.rating, 5);
  assert.equal(accepted.reviewCount, 5);
  const dress = ratingSsrCandidate({ itemId: 'relay', ratingRaw: '4,6', reviewCount: 36 });
  assert.equal(core.extractBasicRatingFromSsrData({ children: [relay, dress] }, 'relay'), null);

  const conflictingSignals = ratingSsrCandidate({ itemId: 'relay', ratingRaw: '5,0', reviewCount: 5 });
  conflictingSignals.props.analyticEvents.viewWidgetReview.trackingInfo.overallRating = '4,6';
  const conservative = core.extractBasicRatingFromSsrData({ children: [conflictingSignals] }, 'relay');
  assert.equal(conservative.rating, null);
  assert.equal(conservative.reviewCount, 5);
});

test('SSR extractor ignores feedback count and incomplete root product placeholders', () => {
  const root = {
    rating: null,
    reviews: '0',
    tradeInfo: null,
    children: [ratingSsrCandidate({ itemId: 'item', feedbackCount: 30 })],
  };
  assert.equal(core.extractBasicRatingFromSsrData(root, 'item'), null);
  const trusted = ratingSsrCandidate({ itemId: 'item', ratingRaw: '4,6', reviewCount: 36, feedbackCount: 30 });
  const summary = core.extractBasicRatingFromSsrData({ children: [trusted], reviews: '0' }, 'item');
  assert.equal(summary.reviewCount, 36);
  assert.equal(Object.hasOwn(summary, 'feedbackCount'), false);
});

test('SSR extractor prefers a coherent candidate over conflicting partial copies', () => {
  const coherent = ratingSsrCandidate({ itemId: 'item', ratingRaw: '5,0', reviewCount: 5 });
  const partialCount = ratingSsrCandidate({ itemId: 'item', reviewCount: 999 });
  const summary = core.extractBasicRatingFromSsrData({ children: [coherent, partialCount] }, 'item');
  assert.equal(summary.rating, 5);
  assert.equal(summary.reviewCount, 5);
});

test('DOM rating/trade extraction is limited to the actual H1 product boundary', () => {
  const fixture = loadFixture('rating-trade-1005009452926938.json');
  const dom = syntheticRatingDom(fixture.dom, {
    recommendationSentinel: { textContent: '1.0 999 reviews 8K sold' },
    sellerSentinel: { textContent: "85% seller's rating" },
  });
  assert.equal(core.findProductHeaderBoundary(dom.root), dom.productRoot);
  assert.deepEqual(core.extractBasicRatingFromDom(dom.root), {
    rating: 4.6,
    reviewCount: 36,
    boughtCount: 413,
    display: { rating: '4.6', reviewCount: '36 reviews', boughtCount: '413 bought' },
  });
});

test('rating summary merge prioritizes SSR numerics, DOM bought/display, and later enrichment', () => {
  const structured = {
    rating: 5, reviewCount: 5, boughtCount: null,
    display: { rating: null, reviewCount: null, boughtCount: null },
  };
  const dom = {
    rating: 4.6, reviewCount: 4, boughtCount: 13,
    display: { rating: '5.0', reviewCount: '5 reviews', boughtCount: '13 bought' },
  };
  const merged = core.mergeRatingSummary(structured, dom);
  assert.deepEqual(merged, {
    rating: 5, reviewCount: 5, boughtCount: 13,
    display: { rating: '5.0', reviewCount: '5 reviews', boughtCount: '13 bought' },
  });
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  const structuredProduct = core.updateRatingSummary(product, structured);
  const enriched = core.updateRatingSummary(structuredProduct, merged);
  assert.equal(enriched.ratingSummary.boughtCount, 13);
  assert.equal(core.updateRatingSummary(enriched, merged), enriched);
  assert.equal(core.updateRatingSummary(enriched, null), enriched);
});

test('rating summary distinguishes real zero from unknown and remains reference-stable', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  const zero = {
    rating: 0, reviewCount: 0, boughtCount: 0,
    display: { rating: '0', reviewCount: '0 reviews', boughtCount: '0 bought' },
  };
  const updated = core.updateRatingSummary(product, zero);
  assert.deepEqual(updated.ratingSummary, zero);
  assert.equal(core.updateRatingSummary(updated, { rating: null, reviewCount: null, boughtCount: null, display: {} }), updated);
});

test('same-item productData refresh and SKU switch preserve rating summary', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const initial = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540');
  const summary = {
    rating: 4.6, reviewCount: 36, boughtCount: 413,
    display: { rating: '4.6', reviewCount: '36 reviews', boughtCount: '413 bought' },
  };
  const enriched = core.updateRatingSummary(initial, summary);
  const refreshed = core.updateRatingSummary(
    core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html'),
    enriched.ratingSummary,
  );
  const switched = core.updateSelectedSku(enriched, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727530');
  assert.deepEqual(refreshed.ratingSummary, enriched.ratingSummary);
  assert.equal(switched.ratingSummary, enriched.ratingSummary);
});

test('one pre-export fallback enrichment fills available DOM data and is reference-stable', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const pageUrl = 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540';
  const delivery = { productId: fixture.data.productId, skuId: '12000049151727540', methods: [{ sentinel: 'delivery' }] };
  const description = core.buildDescription(
    'dom',
    '<p>Existing description</p><img src="https://example.com/existing.jpg">',
    [
      { type: 'text', text: 'Existing description' },
      { type: 'image', url: 'https://example.com/existing.jpg', alt: null },
    ],
  );
  const ratingSummary = {
    rating: 4.8,
    reviewCount: 66,
    boughtCount: 337,
    display: { rating: '4.8', reviewCount: '66 reviews', boughtCount: '337 bought' },
  };
  const product = core.normalizeProduct(fixture.data, pageUrl);
  product.delivery = delivery;
  const selectedSku = product.selectedSku;
  const selectedPrice = product.price;
  assert.equal(product.ratingSummary, null);
  assert.deepEqual(product.characteristics, []);
  assert.equal(product.description, null);

  const sources = {
    structuredRating: null,
    domRating: ratingSummary,
    characteristics: [{ name: 'Material', value: 'Stainless steel' }],
    description,
  };
  const updatedProduct = core.enrichProductFallbacks(product, sources);

  assert.deepEqual(updatedProduct.characteristics, [{ name: 'Material', value: 'Stainless steel' }]);
  assert.equal(updatedProduct.description, description);
  assert.deepEqual(updatedProduct.ratingSummary, ratingSummary);
  assert.equal(updatedProduct.delivery, delivery);
  assert.equal(updatedProduct.selectedSku, selectedSku);
  assert.equal(updatedProduct.price, selectedPrice);
  assert.equal(updatedProduct.selectedSkuId, '12000049151727540');
  assert.equal(core.enrichProductFallbacks(updatedProduct, sources), updatedProduct);
});

test('stale old product-header values cannot enrich a changed item', () => {
  const oldDom = syntheticRatingDom({ ratingText: '5.0', reviewText: '5 reviews', boughtText: '13 bought' });
  const newDom = syntheticRatingDom({ ratingText: '4.6', reviewText: '36 reviews', boughtText: '413 bought' });
  const oldSummary = core.extractBasicRatingFromDom(oldDom.root);
  const changedSummary = core.extractBasicRatingFromDom(newDom.root);
  assert.equal(core.isStaleRatingSummary(oldDom.productRoot, oldSummary, oldDom.productRoot, oldSummary), true);
  assert.equal(core.isStaleRatingSummary(oldDom.productRoot, changedSummary, oldDom.productRoot, oldSummary), false);
  assert.equal(core.isStaleRatingSummary(newDom.productRoot, oldSummary, oldDom.productRoot, oldSummary), false);
});

test('ChatGPT rating/trade export uses display text, preserves zero, and excludes P3/seller values', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  product.ratingSummary = {
    rating: 5, reviewCount: 5, boughtCount: 13,
    display: { rating: '5.0', reviewCount: '5 reviews', boughtCount: '13 bought' },
  };
  product.store = { rating: '91,63%' };
  product.ratingSummary.feedbackCount = 2;
  const output = core.exportForChatGPT(product);
  assert.match(output, /RATING & TRADE:\nRating: 5\.0\nReviews: 5 reviews\nBought: 13 bought\n\nDELIVERY:/);
  assert.doesNotMatch(output, /91,63|feedback|photos|distribution/i);
  product.ratingSummary = { rating: 0, reviewCount: 0, boughtCount: 0, display: {} };
  assert.match(core.exportForChatGPT(product), /Rating: 0\nReviews: 0\nBought: 0/);
  product.ratingSummary = null;
  assert.match(core.exportForChatGPT(product), /Rating: —\nReviews: —\nBought: —/);
});

test('captured dress fragment preserves four images before heading text inside one h1', () => {
  const fixture = loadFixture('description-1005009452926938.json');
  const description = core.extractDescriptionFromDom(
    syntheticDescriptionDom(fixture.fragment),
    'https://aliexpress.ru/item/1005009452926938.html',
  );

  assert.equal(fixture.sourceKind, 'live DOM observation');
  assert.deepEqual(description.blocks.map((block) => block.type), [
    'image', 'image', 'image', 'image', 'heading',
  ]);
  assert.deepEqual(description.blocks.slice(0, 4).map((block) => block.url), [
    'https://ae-pic-a1.aliexpress-media.com/kf/A8c93a20945fd4085826f8d7f9729865dp.jpg',
    'https://ae-pic-a1.aliexpress-media.com/kf/S00c78b5928944a95939ffd7adb2e405d0.png',
    'https://ae-pic-a1.aliexpress-media.com/kf/Sae4a297f1d354978936186c7ece081f9k.png',
    'https://ae-pic-a1.aliexpress-media.com/kf/S660925d5ba0f4fbfbf008de92b34655dG.png',
  ]);
  assert.deepEqual(description.blocks[4], { type: 'heading', level: 1, text: 'A/B' });
  assert.equal(description.text, 'A/B');
  assert.equal(description.images.length, 4);
  assert.equal(description.rawHtml, fixture.fragment);
});

test('captured relay fragments preserve br boundaries and text-before-images order', () => {
  const fixture = loadFixture('description-1005008195850531.json');
  const pageUrl = 'https://aliexpress.ru/item/1005008195850531.html';
  const textDescription = core.extractDescriptionFromDom(
    syntheticDescriptionDom(fixture.fragments.textWithBreaks),
    pageUrl,
  );
  const mixedDescription = core.extractDescriptionFromDom(
    syntheticDescriptionDom(fixture.fragments.textThenImages),
    pageUrl,
  );

  assert.equal(fixture.sourceKind, 'live DOM observation');
  assert.deepEqual(textDescription.blocks.map((block) => block.type), ['text', 'text', 'text']);
  assert.equal(textDescription.blocks[0].text, 'Note:');
  assert.match(textDescription.blocks[1].text, /ZigBee gateway/);
  assert.match(textDescription.blocks[2].text, /depends on what app/);
  assert.deepEqual(mixedDescription.blocks.map((block) => block.type), ['text', 'image', 'image']);
  assert.equal(mixedDescription.blocks[0].text, 'Add device flow to mobile APP');
  assert.deepEqual(mixedDescription.images.map((image) => image.url), [
    'https://ae-pic-a1.aliexpress-media.com/kf/Sd3f1cd17283f4554921409f61afcb6fal.jpg',
    'https://ae-pic-a1.aliexpress-media.com/kf/S4fecc555ec0c4cf4a397613ed18e91fbM.jpg',
  ]);
});

test('synthetic mostly-text description keeps paragraphs and nested inline text without duplication', () => {
  const html = '<div><p>First <span>inline</span> sentence.</p><p>Second paragraph.</p></div>';
  const description = core.extractDescriptionFromDom(
    syntheticDescriptionDom(html),
    'https://aliexpress.ru/item/1.html',
  );

  assert.deepEqual(description.blocks, [
    { type: 'text', text: 'First inline sentence.' },
    { type: 'text', text: 'Second paragraph.' },
  ]);
  assert.equal(description.text, 'First inline sentence.\nSecond paragraph.');
});

test('synthetic mostly-images description preserves repeated images without deduplication', () => {
  const html = '<div><img src="/same.jpg"><img src="/same.jpg"></div>';
  const description = core.extractDescriptionFromDom(
    syntheticDescriptionDom(html),
    'https://aliexpress.ru/item/1.html',
  );

  assert.deepEqual(description.blocks.map((block) => block.type), ['image', 'image']);
  assert.deepEqual(description.images, [
    { url: 'https://aliexpress.ru/same.jpg', alt: null },
    { url: 'https://aliexpress.ru/same.jpg', alt: null },
  ]);
  assert.equal(description.text, '');
});

test('synthetic alternating description preserves exact text-image document order', () => {
  const html = '<p>Before</p><img src="first.jpg"><div>Middle</div><img src="//cdn.example/second.jpg">';
  const description = core.extractDescriptionFromDom(
    syntheticDescriptionDom(html),
    'https://aliexpress.ru/item/1.html',
  );

  assert.deepEqual(description.blocks, [
    { type: 'text', text: 'Before' },
    { type: 'image', url: 'https://aliexpress.ru/item/first.jpg', alt: null },
    { type: 'text', text: 'Middle' },
    { type: 'image', url: 'https://cdn.example/second.jpg', alt: null },
  ]);
});

test('description URL normalization supports web URL forms and rejects unsafe schemes', () => {
  const pageUrl = 'https://aliexpress.ru/item/1005008195850531.html';

  assert.equal(core.normalizeDescriptionUrl('https://cdn.example/a.jpg', pageUrl), 'https://cdn.example/a.jpg');
  assert.equal(core.normalizeDescriptionUrl('http://cdn.example/a.jpg', pageUrl), 'http://cdn.example/a.jpg');
  assert.equal(core.normalizeDescriptionUrl('//cdn.example/a.jpg', pageUrl), 'https://cdn.example/a.jpg');
  assert.equal(core.normalizeDescriptionUrl('/a.jpg', pageUrl), 'https://aliexpress.ru/a.jpg');
  assert.equal(core.normalizeDescriptionUrl('a.jpg', pageUrl), 'https://aliexpress.ru/item/a.jpg');
  assert.equal(core.normalizeDescriptionUrl('javascript:alert(1)', pageUrl), null);
  assert.equal(core.normalizeDescriptionUrl('data:image/png;base64,synthetic', pageUrl), null);
});

test('synthetic links preserve text or annotate images only when href is safe', () => {
  const html = '<a href="/details">Details</a><a href="https://example.com/view"><img src="/linked.jpg" alt=" Preview "></a><a href="javascript:alert(1)">Unsafe text</a>';
  const description = core.extractDescriptionFromDom(
    syntheticDescriptionDom(html),
    'https://aliexpress.ru/item/1.html',
  );

  assert.deepEqual(description.blocks, [
    { type: 'link', text: 'Details', url: 'https://aliexpress.ru/details' },
    { type: 'image', url: 'https://aliexpress.ru/linked.jpg', alt: 'Preview', linkUrl: 'https://example.com/view' },
    { type: 'text', text: 'Unsafe text' },
  ]);
});

test('description ignores unsafe containers and does not create empty blocks from br elements', () => {
  const html = '<p>Safe<br><br>After</p><script>script sentinel</script><style>style sentinel</style><noscript>noscript sentinel</noscript><template>template sentinel</template>';
  const description = core.extractDescriptionFromDom(
    syntheticDescriptionDom(html),
    'https://aliexpress.ru/item/1.html',
  );

  assert.deepEqual(description.blocks, [
    { type: 'text', text: 'Safe' },
    { type: 'text', text: 'After' },
  ]);
  assert.equal(description.text, 'Safe\nAfter');
  assert.doesNotMatch(description.text, /sentinel/);
});

test('missing or factually empty description boundary returns null', () => {
  const missing = syntheticDescriptionDom('', { missing: true });

  assert.equal(core.extractDescriptionFromDom(null, 'https://aliexpress.ru/item/1.html'), null);
  assert.equal(core.extractDescriptionFromDom(missing, 'https://aliexpress.ru/item/1.html'), null);
  assert.equal(core.extractDescriptionFromDom(syntheticDescriptionDom('<div><br></div>'), 'https://aliexpress.ru/item/1.html'), null);
  assert.equal(core.extractDescriptionFromDom(syntheticDescriptionDom('<script>ignored</script>'), 'https://aliexpress.ru/item/1.html'), null);
});

test('description text and image lists are derived consistently from ordered blocks', () => {
  const blocks = [
    { type: 'heading', level: 2, text: 'Heading' },
    { type: 'image', url: 'https://example.com/one.jpg', alt: null },
    { type: 'link', text: 'Read more', url: 'https://example.com/read' },
    { type: 'image', url: 'https://example.com/two.jpg', alt: 'Two', linkUrl: 'https://example.com/view' },
  ];
  const description = core.buildDescription('dom', '<synthetic>', blocks);

  assert.equal(description.text, 'Heading\nRead more');
  assert.deepEqual(description.images, [
    { url: 'https://example.com/one.jpg', alt: null },
    { url: 'https://example.com/two.jpg', alt: 'Two', linkUrl: 'https://example.com/view' },
  ]);
});

test('description enrichment preserves the model and is reference-stable', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html');
  const description = core.buildDescription('dom', '<p>Captured</p>', [{ type: 'text', text: 'Captured' }]);
  const sentinels = {
    price: product.price,
    selectedSku: product.selectedSku,
    skus: product.skus,
    sizeGuide: product.sizeGuide,
    characteristics: [{ name: 'Sentinel', value: 'kept' }],
    delivery: { sentinel: 'delivery' },
    store: { sentinel: 'store' },
    reviews: [{ sentinel: 'reviews' }],
  };
  Object.assign(product, sentinels);

  const updated = core.updateDescription(product, description);

  assert.notEqual(updated, product);
  assert.equal(updated.description, description);
  Object.entries(sentinels).forEach(([key, value]) => assert.equal(updated[key], value));
  assert.equal(core.updateDescription(updated, description), updated);
  assert.equal(core.updateDescription(updated, { ...description, blocks: [] }), updated);
  assert.equal(core.updateDescription(updated, null), updated);
  assert.equal(core.updateDescription(null, description), null);
});

test('a same-item productData refresh can retain an already extracted description', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const first = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  const description = core.buildDescription('dom', '<p>Existing</p>', [{ type: 'text', text: 'Existing' }]);
  const enriched = core.updateDescription(first, description);
  const refreshed = core.updateDescription(
    core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html'),
    enriched.description,
  );

  assert.equal(refreshed.description, description);
});

test('productData.description is not treated as full seller description', () => {
  const fixture = clone(loadFixture('product-1005008195850531.json'));
  fixture.data.description = '<p>Short API field</p>';

  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');

  assert.equal(product.description, null);
});

test('ChatGPT export preserves description order, excludes raw HTML, and marks absence', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  const rawHtml = '<p>RAW_SENTINEL</p>';
  product.description = core.buildDescription('dom', rawHtml, [
    { type: 'text', text: 'Before' },
    { type: 'image', url: 'https://example.com/one.jpg', alt: null },
    { type: 'heading', level: 1, text: 'A/B' },
    { type: 'link', text: 'Details', url: 'https://example.com/details' },
    { type: 'image', url: 'https://example.com/two.jpg', alt: null },
  ]);

  const exported = core.exportForChatGPT(product);
  const emptyExport = core.exportForChatGPT({ ...product, description: null });

  assert.match(core.exportProduct(product), /RAW_SENTINEL/);
  assert.match(exported, /DESCRIPTION:\nBefore\nImage 1: https:\/\/example\.com\/one\.jpg\nA\/B\nDetails — https:\/\/example\.com\/details\nImage 2: https:\/\/example\.com\/two\.jpg$/);
  assert.doesNotMatch(exported, /RAW_SENTINEL/);
  assert.match(emptyExport, /DESCRIPTION:\n—$/);
});

test('ChatGPT description export does not truncate a 41-image sequence', () => {
  const blocks = Array.from({ length: 41 }, (_, index) => ({
    type: 'image',
    url: `https://example.com/${index + 1}.jpg`,
    alt: null,
  }));
  const output = core.formatDescription(core.buildDescription('dom', '<synthetic>', blocks));

  assert.match(output, /^Image 1: https:\/\/example\.com\/1\.jpg/);
  assert.match(output, /Image 41: https:\/\/example\.com\/41\.jpg$/);
  assert.equal(output.split('\n').length, 41);
});

test('stale description boundary is rejected until its identity or content changes', () => {
  const oldBoundary = {};
  const newBoundary = {};
  const oldDescription = core.buildDescription('dom', '<p>Old</p>', [{ type: 'text', text: 'Old' }]);
  const changedDescription = core.buildDescription('dom', '<p>New</p>', [{ type: 'text', text: 'New' }]);

  assert.equal(core.isStaleDescription(oldBoundary, oldDescription, oldBoundary, oldDescription), true);
  assert.equal(core.isStaleDescription(oldBoundary, changedDescription, oldBoundary, oldDescription), false);
  assert.equal(core.isStaleDescription(newBoundary, oldDescription, oldBoundary, oldDescription), false);
  assert.equal(core.isStaleDescription(null, null, oldBoundary, oldDescription), false);
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
  const environment = core.createShippingEnvironment(shippingFixture.request, deliveryA);
  core.cacheDelivery(cache, shippingFixture.request, deliveryA);

  let product = core.normalizeProduct(
    productFixture.data,
    'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689',
  );
  product = core.applyCachedDelivery(product, cache, environment);
  assert.equal(product.delivery, deliveryA);
  assert.equal(core.applyCachedDelivery({ ...product, itemId: 'other-item', delivery: null }, cache, environment).delivery, null);

  product = core.updateSelectedSku(
    product,
    'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848683',
  );
  product = core.applyCachedDelivery(product, cache, environment);
  assert.equal(product.selectedSkuId, '12000056550848683');
  assert.equal(product.delivery, null);

  product = core.updateSelectedSku(
    product,
    'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689',
  );
  product = core.applyCachedDelivery(product, cache, environment);
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
