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

function fakeTimers() {
  let nextHandle = 1;
  const intervals = new Map();
  const timeouts = new Map();
  const clearedIntervals = [];
  const clearedTimeouts = [];
  return {
    intervals,
    timeouts,
    clearedIntervals,
    clearedTimeouts,
    setInterval(callback, delay) {
      const handle = nextHandle++;
      intervals.set(handle, { callback, delay });
      return handle;
    },
    clearInterval(handle) {
      clearedIntervals.push(handle);
      intervals.delete(handle);
    },
    setTimeout(callback, delay) {
      const handle = nextHandle++;
      timeouts.set(handle, { callback, delay });
      return handle;
    },
    clearTimeout(handle) {
      clearedTimeouts.push(handle);
      timeouts.delete(handle);
    },
    runTimeout(handle) {
      const timer = timeouts.get(handle);
      timeouts.delete(handle);
      timer.callback();
    },
  };
}

function fakePageWindow() {
  const listeners = new Map();
  const added = [];
  const removed = [];
  return {
    listeners,
    added,
    removed,
    addEventListener(type, callback, options) {
      added.push({ type, callback, options });
      listeners.set(type, callback);
    },
    removeEventListener(type, callback) {
      removed.push({ type, callback });
      if (listeners.get(type) === callback) listeners.delete(type);
    },
    dispatch(type) {
      listeners.get(type)?.();
    },
  };
}

test('product runtime singleton reuses one controller, polling interval, and pagehide listener', () => {
  const pageWindow = fakePageWindow();
  const timers = fakeTimers();
  let controllers = 0;
  let scans = 0;
  let spaState = 'item-a';
  const createController = () => {
    controllers += 1;
    const polling = core.createProductPollingLifecycle(() => {
      scans += 1;
      spaState = spaState === 'item-a' ? 'item-b' : 'item-a';
    }, timers);
    polling.start();
    return { polling, dispose: () => polling.dispose() };
  };

  const first = core.startPageRuntimeSingleton(pageWindow, 'product', createController);
  const capturedInterval = timers.intervals.get(first.controller.polling.intervalHandle).callback;
  const second = core.startPageRuntimeSingleton(pageWindow, 'product', createController);
  assert.equal(second, first);
  assert.equal(first.mode, 'product');
  assert.equal(pageWindow[core.RUNTIME_REGISTRY_KEY], first);
  assert.equal(controllers, 1);
  assert.equal(timers.intervals.size, 1);
  assert.equal(timers.intervals.values().next().value.delay, 1000);
  assert.equal(pageWindow.added.filter(({ type }) => type === 'pagehide').length, 1);
  assert.equal(scans, 1);

  capturedInterval();
  assert.equal(scans, 2);
  assert.equal(spaState, 'item-a');
  assert.equal(timers.intervals.size, 1);
  pageWindow.dispatch('pagehide');
  assert.equal(first.active, false);
  assert.equal(first.disposed, true);
  assert.deepEqual(timers.clearedIntervals, [1]);
  assert.equal(timers.intervals.size, 0);
  assert.equal(pageWindow.listeners.has('pagehide'), false);
  capturedInterval();
  assert.equal(scans, 2);
  assert.equal(core.startPageRuntimeSingleton(pageWindow, 'product', createController), first);
  assert.equal(controllers, 1);
});

test('reviews runtime singleton starts only one SSR retry chain', () => {
  const pageWindow = fakePageWindow();
  const timers = fakeTimers();
  let controllers = 0;
  let inspections = 0;
  const createController = () => {
    controllers += 1;
    const retry = core.createReviewsSsrRetryLifecycle(
      () => { inspections += 1; return { reviewPage: null, diagnostic: 'missing' }; },
      () => assert.fail('unexpected SSR seed'),
      () => {},
      timers,
    );
    retry.start();
    return { retry, dispose: () => retry.dispose() };
  };

  const first = core.startPageRuntimeSingleton(pageWindow, 'reviews', createController);
  const second = core.startPageRuntimeSingleton(pageWindow, 'reviews', createController);
  assert.equal(second, first);
  assert.equal(first.mode, 'reviews');
  assert.equal(controllers, 1);
  assert.equal(inspections, 1);
  assert.equal(timers.timeouts.size, 1);
  assert.equal(timers.timeouts.values().next().value.delay, 500);
  assert.equal(pageWindow.added.filter(({ type }) => type === 'pagehide').length, 1);
});

test('reviews SSR retries advance one pending timer and stop after successful seeding', () => {
  const timers = fakeTimers();
  const results = [
    { reviewPage: null, diagnostic: 'missing-1' },
    { reviewPage: null, diagnostic: 'missing-2' },
    { reviewPage: { itemId: '100' }, diagnostic: null },
  ];
  const seeded = [];
  const exhausted = [];
  const retry = core.createReviewsSsrRetryLifecycle(
    () => results.shift(),
    (reviewPage) => seeded.push(reviewPage),
    (diagnostic) => exhausted.push(diagnostic),
    timers,
  );

  retry.start();
  assert.equal(retry.attempts, 1);
  assert.equal(timers.timeouts.size, 1);
  const firstHandle = retry.timeoutHandle;
  timers.runTimeout(firstHandle);
  assert.equal(retry.attempts, 2);
  assert.equal(timers.timeouts.size, 1);
  assert.notEqual(retry.timeoutHandle, firstHandle);
  timers.runTimeout(retry.timeoutHandle);
  assert.equal(retry.seeded, true);
  assert.equal(retry.timeoutHandle, null);
  assert.equal(timers.timeouts.size, 0);
  assert.deepEqual(seeded, [{ itemId: '100' }]);
  assert.deepEqual(exhausted, []);
});

test('reviews SSR retry exhaustion is terminal with no pending timer', () => {
  const timers = fakeTimers();
  const exhausted = [];
  const retry = core.createReviewsSsrRetryLifecycle(
    () => ({ reviewPage: null, diagnostic: 'still-missing' }),
    () => assert.fail('unexpected SSR seed'),
    (diagnostic) => exhausted.push(diagnostic),
    timers,
  );

  retry.start();
  while (retry.timeoutHandle !== null) timers.runTimeout(retry.timeoutHandle);
  assert.equal(retry.attempts, 8);
  assert.equal(timers.timeouts.size, 0);
  assert.deepEqual(exhausted, ['still-missing']);
});

test('reviews SSR retry teardown clears its timeout and captured callback becomes inert', () => {
  const timers = fakeTimers();
  let inspections = 0;
  const retry = core.createReviewsSsrRetryLifecycle(
    () => { inspections += 1; return { reviewPage: null, diagnostic: 'missing' }; },
    () => assert.fail('unexpected SSR seed'),
    () => assert.fail('unexpected exhaustion'),
    timers,
  );

  retry.start();
  const handle = retry.timeoutHandle;
  const capturedRetry = timers.timeouts.get(handle).callback;
  retry.dispose();
  assert.equal(retry.active, false);
  assert.deepEqual(timers.clearedTimeouts, [handle]);
  assert.equal(timers.timeouts.size, 0);
  capturedRetry();
  assert.equal(inspections, 1);
  assert.equal(retry.attempts, 1);
  assert.equal(retry.timeoutHandle, null);
});

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

function syntheticReviewSummaryDom(fixture, options = {}) {
  const observation = fixture.dom || fixture;
  const textNode = (text) => ({
    innerText: text,
    textContent: text,
    children: [],
  });
  const gradeRowsData = options.gradeRows || observation.gradeRows || [];
  const countRowsData = options.countRows || observation.countRows || [];
  const gradeRows = gradeRowsData.map((row) => ({
    querySelectorAll(selector) {
      if (selector.includes('StarGroup__starActive__')) return Array.from({ length: row.activeStars });
      if (selector.includes('StarGroup__star__')) return Array.from({ length: row.totalStars });
      return [];
    },
  }));
  const countRows = countRowsData.map((row) => textNode(row.text));
  const gradeGroup = {
    querySelectorAll(selector) {
      return selector.includes('Grades__gradeWrapper__') ? gradeRows : [];
    },
  };
  const countGroup = { children: countRows };
  const ratingRoot = {
    querySelector(selector) {
      if (selector.includes('AdditionalSection__gradeCount__')) return countGroup;
      if (selector.includes('AdditionalSection__grade__')) return gradeGroup;
      return null;
    },
  };

  const buyerPhotos = options.buyerPhotos === undefined ? observation.buyerPhotos : options.buyerPhotos;
  const photoWrapper = buyerPhotos && {
    querySelectorAll(selector) {
      if (selector !== '*') return [];
      return [
        textNode(buyerPhotos.heading),
        textNode(options.photoDisplay ?? buyerPhotos.display),
        ...Array.from({ length: buyerPhotos.renderedThumbnailCount || 0 }, () => textNode('thumbnail')),
      ];
    },
  };

  const topicsObservation = options.topics === undefined ? observation.topics : options.topics;
  const topicNodes = (topicsObservation?.topics || []).map((topic) => ({
    className: options.conflictingMood
      ? `${topic.className} RedReviewsTags_Tag__positiveTagMood__x RedReviewsTags_Tag__negativeTagMood__x`
      : topic.className,
    querySelector(selector) {
      if (selector.includes('Tag__tagText__')) return textNode(topic.text);
      if (selector.includes('Tag__counter__')) return textNode(topic.count);
      return null;
    },
  }));
  const topicWrapper = topicsObservation && {
    querySelectorAll(selector) {
      if (selector === '*') return [textNode(options.topicHeading ?? topicsObservation.heading)];
      return selector.includes('Tag__tag__') ? topicNodes : [];
    },
  };

  const boundary = {
    querySelector(selector) {
      if (selector.includes('RedReviewsTabs__desktop__')) return options.missingTabs ? null : {};
      if (selector.includes('MainSection__mainSection__')) return options.missingRatingRoot ? null : ratingRoot;
      if (selector.includes('RedReviewsGallery__defaultWrapper__')) return photoWrapper;
      return null;
    },
    querySelectorAll(selector) {
      return selector.includes('RedReviewsTags__tagsWrapper__') && topicWrapper ? [topicWrapper] : [];
    },
  };
  const anchor = { parentElement: boundary };
  const root = {
    querySelector(selector) {
      return selector === '#reviews_anchor' && !options.missingAnchor ? anchor : null;
    },
  };
  return { root, boundary, ratingRoot, gradeRows, countRows, photoWrapper, topicWrapper };
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

function syntheticStoreDom(fixture, options = {}) {
  const anchor = (href) => ({
    href,
    getAttribute(name) { return name === 'href' ? href : null; },
  });
  const storeAnchor = anchor(fixture.header.storeHref);
  const chatAnchor = anchor(options.chatHref ?? fixture.chat.href);
  const title = {
    innerText: fixture.header.title.text,
    textContent: fixture.header.title.text,
    closest(selector) { return selector === 'a[href]' ? storeAnchor : null; },
  };
  const stats = fixture.header.stats.map((stat) => ({ innerText: stat.text, textContent: stat.text }));
  const header = {
    querySelector(selector) {
      if (selector.includes('RedStoreInfo_Header__title__')) return title;
      if (selector.includes('RedStoreInfo_Header__headerContainer__')) return storeAnchor;
      return null;
    },
    querySelectorAll(selector) {
      return selector.includes('RedStoreInfo_StatItem__statItem__') ? stats : [];
    },
  };
  const chatButton = { closest(selector) { return selector === 'a[href]' ? chatAnchor : null; } };
  const boundary = {
    matches(selector) { return selector === '#storeInfo'; },
    querySelector(selector) {
      if (selector === '[data-testid="store_header"]') return header;
      if (selector === '[data-testid="seller_chat_btn"]') return options.missingChat ? null : chatButton;
      return null;
    },
  };
  return {
    boundary,
    megabonusSentinel: options.megabonusSentinel || null,
    querySelector(selector) {
      if (selector === '#storeInfo') return options.missingBoundary ? null : boundary;
      return this.megabonusSentinel;
    },
  };
}

test('userscript metadata and runtime versions stay in sync', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ali-helper.user.js'), 'utf8');
  const metadataVersion = source.match(/^\/\/ @version\s+(\S+)\s*$/m);
  const runtimeVersion = source.match(/^\s*const VERSION = ['"]([^'"]+)['"];\s*$/m);

  assert.ok(metadataVersion, 'userscript metadata version is missing');
  assert.ok(runtimeVersion, 'runtime VERSION constant is missing');
  assert.equal(runtimeVersion[1], metadataVersion[1]);
});

test('normalizes COM to RU and RU to COM with canonical hosts', () => {
  const cases = [
    {
      input: 'https://www.aliexpress.com/item/1005008195850531.html',
      market: 'ru',
      expected: 'https://aliexpress.ru/item/1005008195850531.html',
    },
    {
      input: 'https://aliexpress.ru/item/1005008195850531.html',
      market: 'com',
      expected: 'https://www.aliexpress.com/item/1005008195850531.html',
    },
  ];

  for (const { input, market, expected } of cases) {
    assert.equal(core.normalizeItemUrl(input, market).href, expected);
  }
});

test('toggles canonical market URLs in both directions', () => {
  assert.equal(
    core.toggleMarketUrl('https://www.aliexpress.com/item/1005008195850531.html').href,
    'https://aliexpress.ru/item/1005008195850531.html',
  );
  assert.equal(
    core.toggleMarketUrl('https://aliexpress.ru/item/1005008195850531.html').href,
    'https://www.aliexpress.com/item/1005008195850531.html',
  );
});

test('preserves useful and repeated unknown query state while cleaning and switching markets', () => {
  const input = 'https://www.aliexpress.com/item/1005009452926938.html?sku_id=12000049151727540&shpMethod=AE_CN_SUPER_ECONOMY_G&future_param=a&future_param=b&spm=tracking';
  const result = core.normalizeItemUrl(input, 'ru');

  assert.equal(result.href, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540&shpMethod=AE_CN_SUPER_ECONOMY_G&future_param=a&future_param=b');
  assert.equal(result.searchParams.get('sku_id'), '12000049151727540');
  assert.equal(result.searchParams.get('shpMethod'), 'AE_CN_SUPER_ECONOMY_G');
  assert.deepEqual(result.searchParams.getAll('future_param'), ['a', 'b']);
});

test('removes the established tracking parameter matrix case-insensitively', () => {
  const trackingNames = [
    'spm', 'UTM_Source', 'utm_medium', 'utm_campaign',
    'aff_fcid', 'aff_fsk', 'aff_platform', 'aff_trace_key', 'affiliate_id', 'af',
  ];
  const query = new URLSearchParams([
    ...trackingNames.map((name) => [name, 'remove-me']),
    ['future_param', 'keep-me'],
  ]);
  const result = core.normalizeItemUrl(`https://aliexpress.ru/item/1005008195850531.html?${query}`);

  for (const name of trackingNames) assert.equal(result.searchParams.has(name), false, name);
  assert.equal(result.searchParams.get('future_param'), 'keep-me');
});

test('removes URL fragments during normalization', () => {
  for (const hash of ['#reviews', '#anything']) {
    const result = core.normalizeItemUrl(`https://aliexpress.ru/item/1005008195850531.html${hash}`);
    assert.equal(result.hash, '');
    assert.equal(result.href, 'https://aliexpress.ru/item/1005008195850531.html');
  }
});

test('canonicalizes every accepted item pathname form', () => {
  for (const pathname of [
    '/item/1005008195850531',
    '/item/1005008195850531/',
    '/item/1005008195850531.html',
    '/item/1005008195850531.html/',
  ]) {
    assert.equal(
      core.normalizeItemUrl(`https://aliexpress.ru${pathname}`).href,
      'https://aliexpress.ru/item/1005008195850531.html',
      pathname,
    );
  }
});

test('normalization is idempotent for dirty and already-canonical URLs', () => {
  const inputs = [
    'https://www.aliexpress.com/item/1005009452926938/?spm=tracking&sku_id=12000049151727540&shpMethod=AE_CN_SUPER_ECONOMY_G&future_param=keep-me#reviews',
    'https://aliexpress.ru/item/1005008195850531.html?future_param=keep-me',
  ];

  for (const input of inputs) {
    const once = core.normalizeItemUrl(input);
    const twice = core.normalizeItemUrl(once);
    assert.equal(twice.href, once.href);
  }
});

test('rejects invalid PDP inputs and unrelated-host item-shaped URLs', () => {
  const invalidInputs = [
    'https://aliexpress.ru/',
    'https://aliexpress.ru/item/not-a-number.html',
    'https://aliexpress.ru/item/123/reviews',
    'https://example.com/item/123.html',
    'https://shop.example.org/item/1005008195850531.html',
  ];

  for (const input of invalidInputs) assert.throws(() => core.normalizeItemUrl(input), undefined, input);
});

test('canonicalizes accepted AliExpress protocol and port state', () => {
  const result = core.normalizeItemUrl('http://www.aliexpress.com:8080/item/1005008195850531/');
  assert.equal(result.href, 'https://www.aliexpress.com/item/1005008195850531.html');
  assert.equal(result.protocol, 'https:');
  assert.equal(result.port, '');
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

  assert.equal(
    core.formatProductStatus(product),
    'Partial · 7 combinations · Bundle: 7 · not observed: Gallery, Rating Summary, Store, Characteristics, Description, Delivery · source: API',
  );
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

  assert.match(exported, /CHARACTERISTICS:\nFirst: One\nSecond: Two\n\nGALLERY:\n—\n\nDESCRIPTION:/);
  assert.match(emptyExport, /CHARACTERISTICS:\n—\n\nGALLERY:\n—\n\nDESCRIPTION:/);
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

test('captured relay SSR gallery is found structurally and preserves video-first order', () => {
  const fixture = loadFixture('gallery-1005008195850531.json');
  const root = { unrelated: { widgets: [{ children: [{ deeper: fixture }] }] } };
  const gallery = core.extractGalleryFromSsrData(root, fixture.props.id);

  assert.equal(fixture.props.skuInfo, null);
  assert.equal(fixture.props.activeSkuId, '0');
  assert.equal(gallery.source, 'ssr:__AER_DATA__');
  assert.equal(gallery.items.length, 7);
  assert.deepEqual(gallery.items.map((item) => item.type), ['video', 'image', 'image', 'image', 'image', 'image', 'image']);
  assert.deepEqual(gallery.items[0], {
    type: 'video',
    imageUrl: 'https://ae-pic-a1.aliexpress-media.com/kf/S0eab51705bf14f4fb4e86dccb88feb41a.jpg',
    previewUrl: 'https://ae-pic-a1.aliexpress-media.com/kf/S0eab51705bf14f4fb4e86dccb88feb41a.jpg',
    videoUrl: 'https://video.aliexpress-media.com/play/u/ae_sg_item/p/1/e/6/t/10301/5000454646732.mp4',
  });
  assert.equal(gallery.items.at(-1).imageUrl, 'https://ae-pic-a1.aliexpress-media.com/kf/Sd6f26cea218141799d5dcbdbe7db9fd0n.jpg');
});

test('captured no-video SSR gallery keeps all six observed image records', () => {
  const fixture = loadFixture('gallery-1005005933779962.json');
  const gallery = core.extractGalleryFromSsrData({ layout: [{ props: { id: 'recommendation', gallery: fixture.props.gallery } }, fixture] }, fixture.props.id);

  assert.equal(gallery.items.length, 6);
  assert.ok(gallery.items.every((item) => item.type === 'image' && item.videoUrl === null));
  assert.deepEqual(gallery.items.map((item) => item.imageUrl), fixture.props.gallery.map((item) => item.imageUrl));
});

test('SSR gallery requires an exact expected item ID and rejects same-item conflicts', () => {
  const fixture = loadFixture('gallery-1005008195850531.json');
  assert.equal(core.extractGalleryFromSsrData({ nested: fixture }, '100500819585053'), null);
  assert.equal(core.extractGalleryFromSsrData({ nested: fixture }, null), null);
  const conflict = clone(fixture);
  conflict.props.gallery[1].imageUrl = 'https://example.com/conflict.jpg';
  assert.equal(core.extractGalleryFromSsrData({ copies: [fixture, clone(fixture)] }, fixture.props.id).items.length, 7);
  assert.equal(core.extractGalleryFromSsrData({ copies: [fixture, conflict] }, fixture.props.id), null);
});

test('synthetic missing, empty, and invalid SSR gallery cases return null', () => {
  assert.equal(core.extractGalleryFromSsrData({ props: { id: 'item' } }, 'item'), null);
  assert.equal(core.extractGalleryFromSsrData({ props: { id: 'item', gallery: [] } }, 'item'), null);
  assert.equal(core.extractGalleryFromSsrData({ props: { id: 'item', gallery: [{ imageUrl: 'data:image/png,x', previewUrl: 'https://example.com/p.jpg', videoUrl: null }] } }, 'item'), null);
});

test('synthetic gallery exact-dedupe preserves first occurrence and URL distinctions', () => {
  const base = { imageUrl: 'https://example.com/a.jpg', previewUrl: 'https://example.com/a.jpg', videoUrl: null };
  const gallery = core.normalizeGallery([
    base,
    clone(base),
    { ...base, imageUrl: 'https://example.com/a.jpg_640x640.jpg' },
    { ...base, imageUrl: 'https://example.com/a.jpg_.webp' },
    { ...base, imageUrl: 'https://example.com/a.jpg?size=640' },
    { ...base, previewUrl: 'https://example.com/preview.jpg' },
  ], 'synthetic');

  assert.equal(gallery.items.length, 5);
  assert.equal(gallery.items[0].imageUrl, base.imageUrl);
  assert.equal(gallery.items[0].previewUrl, base.previewUrl);
  assert.equal(gallery.items[1].imageUrl, 'https://example.com/a.jpg_640x640.jpg');
  assert.equal(gallery.items[4].previewUrl, 'https://example.com/preview.jpg');
});

test('gallery update and combined enrichment preserve unrelated normalized state', () => {
  const productFixture = loadFixture('product-1005009452926938.json');
  const galleryFixture = loadFixture('gallery-1005008195850531.json');
  const pageUrl = 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540';
  const product = core.normalizeProduct(productFixture.data, pageUrl);
  const delivery = { sentinel: 'delivery' };
  const description = core.buildDescription('dom', '<p>Existing</p>', [{ type: 'text', text: 'Existing' }]);
  const ratingSummary = { rating: 4.6, reviewCount: 36, boughtCount: 414, display: {} };
  product.delivery = delivery;
  product.description = description;
  product.ratingSummary = ratingSummary;
  const selectedSku = product.selectedSku;
  const price = product.price;
  const gallery = core.normalizeGallery(galleryFixture.props.gallery, 'ssr:__AER_DATA__');
  const updated = core.enrichProductFallbacks(product, {
    structuredGallery: gallery,
    characteristics: [{ name: 'Material', value: 'Polyester' }],
  });

  assert.equal(updated.gallery, gallery);
  assert.equal(updated.delivery, delivery);
  assert.equal(updated.description, description);
  assert.equal(updated.ratingSummary, ratingSummary);
  assert.equal(updated.selectedSku, selectedSku);
  assert.equal(updated.price, price);
  assert.equal(updated.selectedSkuId, '12000049151727540');
  assert.deepEqual(updated.characteristics, [{ name: 'Material', value: 'Polyester' }]);
  assert.equal(core.enrichProductFallbacks(updated, { structuredGallery: clone(gallery) }), updated);
  const refreshed = core.updateGallery(core.normalizeProduct(productFixture.data, pageUrl), updated.gallery);
  assert.equal(refreshed.gallery, updated.gallery);
  assert.equal(core.updateSelectedSku(updated, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727530').gallery, gallery);
});

test('unknown DOM SKU-main is never used when structured gallery is unavailable', () => {
  const product = { gallery: null };
  const unknownDomGallery = core.normalizeGallery(
    loadFixture('gallery-1005008195850531.json').props.gallery,
    'dom:untrusted-sku-main',
  );

  assert.equal(core.enrichProductFallbacks(product, { domGallery: unknownDomGallery }), product);
  assert.equal(product.gallery, null);
});

test('ChatGPT gallery export preserves every item and keeps description separate', () => {
  const productFixture = loadFixture('product-1005008195850531.json');
  const galleryFixture = loadFixture('gallery-1005008195850531.json');
  const product = core.normalizeProduct(productFixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  product.gallery = core.normalizeGallery(galleryFixture.props.gallery, 'ssr:__AER_DATA__');
  product.description = core.buildDescription('dom', '<img src="https://example.com/description.jpg">', [
    { type: 'image', url: 'https://example.com/description.jpg', alt: null },
  ]);
  const output = core.exportForChatGPT(product);

  assert.match(output, /GALLERY:\nItem 1 \(video\)\nVideo: .*5000454646732\.mp4\nImage\/poster: .*S0eab.*\nPreview: .*S0eab/);
  assert.match(output, /Item 7 \(image\)\nImage: .*Sd6f26.*\nPreview: .*Sd6f26/);
  assert.match(output, /DESCRIPTION:\nBlocks: 1\nText\/heading\/link blocks: 0\nImages: 1\nLinks: 0\nText characters: 0/);
  assert.doesNotMatch(output.slice(output.indexOf('DESCRIPTION:')), /https:\/\/example\.com\/description\.jpg/);
  assert.match(output, /1 image URLs omitted/);
  assert.doesNotMatch(core.formatGallery(product.gallery), /description\.jpg/);
  assert.match(core.exportForChatGPT({ ...product, gallery: null }), /GALLERY:\n—\n\nDESCRIPTION:/);
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
      buyerPhotosCount: null,
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
    contentFeedbackCount: null,
    boughtCount: 413,
    starDistribution: null,
    buyerPhotosCount: null,
    reviewTopics: null,
    diagnostics: { starDistributionTotal: null, starDistributionMatchesReviewCount: null },
    display: { rating: '4.6', reviewCount: '36 reviews', boughtCount: '413 bought', buyerPhotosCount: null },
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
    rating: 5, reviewCount: 5, contentFeedbackCount: null, boughtCount: 13,
    starDistribution: null, buyerPhotosCount: null, reviewTopics: null,
    diagnostics: { starDistributionTotal: null, starDistributionMatchesReviewCount: null },
    display: { rating: '5.0', reviewCount: '5 reviews', boughtCount: '13 bought', buyerPhotosCount: null },
  });
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  const structuredProduct = core.updateRatingSummary(product, structured, ['ssr:__AER_DATA__']);
  const enriched = core.updateRatingSummary(structuredProduct, merged, [
    'ssr:__AER_DATA__', 'dom:product-header',
  ]);
  assert.equal(enriched.ratingSummary.boughtCount, 13);
  assert.equal(core.updateRatingSummary(enriched, merged, [
    'ssr:__AER_DATA__', 'dom:product-header',
  ]), enriched);
  assert.equal(core.updateRatingSummary(enriched, null, [
    'ssr:__AER_DATA__', 'dom:product-header',
  ]), enriched);
});

test('rating summary distinguishes real zero from unknown and remains reference-stable', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  const zero = {
    rating: 0, reviewCount: 0, boughtCount: 0,
    display: { rating: '0', reviewCount: '0 reviews', boughtCount: '0 bought' },
  };
  const updated = core.updateRatingSummary(product, zero, ['dom:product-header']);
  assert.deepEqual(updated.ratingSummary, {
    ...zero,
    contentFeedbackCount: null,
    starDistribution: null,
    buyerPhotosCount: null,
    reviewTopics: null,
    diagnostics: { starDistributionTotal: null, starDistributionMatchesReviewCount: null },
    display: { ...zero.display, buyerPhotosCount: null },
  });
  assert.equal(core.updateRatingSummary(
    updated,
    { rating: null, reviewCount: null, boughtCount: null, display: {} },
    ['dom:product-header'],
  ), updated);
});

test('same-item productData refresh and SKU switch preserve rating summary', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const initial = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540');
  const summary = {
    rating: 4.6, reviewCount: 36, boughtCount: 413,
    display: { rating: '4.6', reviewCount: '36 reviews', boughtCount: '413 bought' },
  };
  const enriched = core.updateRatingSummary(initial, summary, ['dom:product-header']);
  const refreshed = core.updateRatingSummary(
    core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005009452926938.html'),
    enriched.ratingSummary,
    ['dom:product-header'],
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
  assert.deepEqual(updatedProduct.ratingSummary, {
    ...ratingSummary,
    contentFeedbackCount: null,
    starDistribution: null,
    buyerPhotosCount: null,
    reviewTopics: null,
    diagnostics: { starDistributionTotal: null, starDistributionMatchesReviewCount: null },
    display: { ...ratingSummary.display, buyerPhotosCount: null },
  });
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

test('ChatGPT rating/trade export includes the extended summary and preserves zero', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  product.ratingSummary = {
    rating: 5, reviewCount: 5, boughtCount: 13,
    display: { rating: '5.0', reviewCount: '5 reviews', boughtCount: '13 bought' },
  };
  product.store = { rating: '91,63%' };
  product.ratingSummary.contentFeedbackCount = 2;
  const output = core.exportForChatGPT(product);
  assert.match(output, /RATING & TRADE:\nRating: 5\.0\nReviews: 5 reviews\nContent feedbacks: 2\nBought: 13 bought\nStars: —\nStar total: —\nStar total matches reviews: —\nBuyer photos: —\nReview topics:\n—\n\nSTORE \/ SELLER:[\s\S]*\n\nDELIVERY:/);
  assert.doesNotMatch(output, /91,63/);
  product.ratingSummary = { rating: 0, reviewCount: 0, boughtCount: 0, display: {} };
  assert.match(core.exportForChatGPT(product), /Rating: 0\nReviews: 0\nContent feedbacks: —\nBought: 0/);
  product.ratingSummary = null;
  assert.match(core.exportForChatGPT(product), /Rating: —\nReviews: —\nContent feedbacks: —\nBought: —/);
});

test('captured Review Context SSR is structurally bound to the exact current item', () => {
  const expectations = [
    ['review-summary-1005008195850531.json', 5, 5, 2],
    ['review-summary-1005009452926938.json', 4.6, 36, 30],
  ];
  for (const [name, rating, reviewCount, contentFeedbackCount] of expectations) {
    const fixture = loadFixture(name);
    const root = { unrelatedDepth: { widgets: [fixture.ssr] } };
    const summary = core.extractReviewSummaryFromSsrData(root, fixture.itemId);
    assert.equal(summary.rating, rating);
    assert.equal(summary.reviewCount, reviewCount);
    assert.equal(summary.contentFeedbackCount, contentFeedbackCount);
    assert.equal(summary.boughtCount, null);
    assert.equal(summary.starDistribution, null);
  }
});

test('Review Context SSR accepts widget-family version drift and numeric item IDs', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  const ssr = clone(fixture.ssr);
  ssr.widgetId = 'bx/RedReviewsContextWidget/9.9.9';
  ssr.children[0].widgetId = 'bx/RedReviewsTabs/8.8.8';
  ssr.children[0].children[0].widgetId = 'bx/RedReviewsProductFeedbackList/7.7.7';
  const summary = core.extractReviewSummaryFromSsrData({ arbitrary: [ssr] }, String(fixture.itemId));
  assert.equal(summary.rating, 4.6);
  assert.equal(summary.reviewCount, 36);
  assert.equal(summary.contentFeedbackCount, 30);
});

test('Review Context SSR ignores feedback lists outside the matched current-item tabs', () => {
  const fixture = loadFixture('review-summary-1005008195850531.json');
  const ssr = clone(fixture.ssr);
  ssr.children.push({
    widgetId: 'bx/RedReviewsProductFeedbackList/0.99.0',
    props: {
      placement: 'PDP',
      resolveParams: {
        'review.productReviewsCount': 999,
        'review.productFeedbacksCount': 888,
      },
    },
  });
  const summary = core.extractReviewSummaryFromSsrData(ssr, fixture.itemId);
  assert.equal(summary.reviewCount, 5);
  assert.equal(summary.contentFeedbackCount, 2);
});

test('Review Context SSR rejects different-item and contradictory tracking bindings', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  const differentItem = clone(fixture.ssr);
  differentItem.children[0].props.analyticEvents.clickAllReviews.trackingInfo.itemId = 1005000000000001;
  differentItem.children[0].props.analyticEvents.viewWidgetReview.trackingInfo.itemId = 1005000000000001;
  assert.equal(core.extractReviewSummaryFromSsrData(differentItem, fixture.itemId), null);

  const contradictory = clone(fixture.ssr);
  contradictory.children[0].props.analyticEvents.viewWidgetReview.trackingInfo.itemId = 1005000000000002;
  assert.equal(core.extractReviewSummaryFromSsrData(contradictory, fixture.itemId), null);

  const ratingConflict = clone(fixture.ssr);
  ratingConflict.children[0].props.analyticEvents.viewWidgetReview.trackingInfo.overallRating = '4,8';
  assert.equal(core.extractReviewSummaryFromSsrData(ratingConflict, fixture.itemId), null);
});

test('Review Context SSR combines partial totals, permits duplicates, and fails conflicting fields closed', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  const tabs = clone(fixture.ssr.children[0]);
  const feedback = tabs.children[0];
  tabs.children.push(clone(feedback));
  let summary = core.extractReviewSummaryFromSsrData({
    widgetId: fixture.ssr.widgetId,
    children: [tabs],
  }, fixture.itemId);
  assert.equal(summary.reviewCount, 36);
  assert.equal(summary.contentFeedbackCount, 30);

  const partialTabs = clone(fixture.ssr.children[0]);
  const reviewsOnly = clone(partialTabs.children[0]);
  delete reviewsOnly.props.resolveParams['review.productFeedbacksCount'];
  const feedbacksOnly = clone(partialTabs.children[0]);
  delete feedbacksOnly.props.resolveParams['review.productReviewsCount'];
  partialTabs.children = [reviewsOnly, feedbacksOnly];
  summary = core.extractReviewSummaryFromSsrData({
    widgetId: fixture.ssr.widgetId,
    children: [partialTabs],
  }, fixture.itemId);
  assert.equal(summary.reviewCount, 36);
  assert.equal(summary.contentFeedbackCount, 30);

  const conflictingTabs = clone(fixture.ssr.children[0]);
  const conflict = clone(conflictingTabs.children[0]);
  conflict.props.resolveParams['review.productReviewsCount'] = 37;
  conflictingTabs.children.push(conflict);
  summary = core.extractReviewSummaryFromSsrData({
    widgetId: fixture.ssr.widgetId,
    children: [conflictingTabs],
  }, fixture.itemId);
  assert.equal(summary.rating, 4.6);
  assert.equal(summary.reviewCount, null);
  assert.equal(summary.contentFeedbackCount, 30);
});

test('Review Context SSR preserves real zero totals', () => {
  const fixture = loadFixture('review-summary-1005008195850531.json');
  const ssr = clone(fixture.ssr);
  const params = ssr.children[0].children[0].props.resolveParams;
  params['review.productReviewsCount'] = 0;
  params['review.productFeedbacksCount'] = 0;
  const summary = core.extractReviewSummaryFromSsrData(ssr, fixture.itemId);
  assert.equal(summary.reviewCount, 0);
  assert.equal(summary.contentFeedbackCount, 0);
});

test('Review Context SSR normalizes the observed Needles 4,8 rating and totals', () => {
  const fixture = loadFixture('review-summary-1005008195850531.json');
  const ssr = clone(fixture.ssr);
  const tabs = ssr.children[0];
  for (const event of Object.values(tabs.props.analyticEvents)) {
    event.trackingInfo.itemId = 1005005933779962;
    event.trackingInfo.overallRating = '4,8';
  }
  const params = tabs.children[0].props.resolveParams;
  params['review.productReviewsCount'] = 66;
  params['review.productFeedbacksCount'] = 12;
  const summary = core.extractReviewSummaryFromSsrData(ssr, '1005005933779962');
  assert.equal(summary.rating, 4.8);
  assert.equal(summary.reviewCount, 66);
  assert.equal(summary.contentFeedbackCount, 12);
});

test('captured Relay and Dress DOM distributions map grades by active stars', () => {
  const cases = [
    ['review-summary-1005008195850531.json', { 5: 5, 4: 0, 3: 0, 2: 0, 1: 0 }],
    ['review-summary-1005009452926938.json', { 5: 29, 4: 3, 3: 2, 2: 2, 1: 0 }],
  ];
  for (const [name, expected] of cases) {
    const fixture = loadFixture(name);
    const dom = syntheticReviewSummaryDom(fixture);
    assert.equal(core.findReviewSummaryBoundary(dom.root), dom.boundary);
    assert.deepEqual(core.parseStarDistribution(dom.boundary), expected);
    const merged = core.mergeRatingSummary(
      core.extractReviewSummaryFromSsrData(fixture.ssr, fixture.itemId),
      null,
      core.extractReviewSummaryFromDom(dom.root),
    );
    assert.equal(merged.diagnostics.starDistributionTotal, merged.reviewCount);
    assert.equal(merged.diagnostics.starDistributionMatchesReviewCount, true);
  }
});

test('star distribution supports shuffled rows and never infers grade from array position', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  const order = [2, 4, 0, 3, 1];
  const dom = syntheticReviewSummaryDom(fixture, {
    gradeRows: order.map((index) => fixture.dom.gradeRows[index]),
    countRows: order.map((index) => fixture.dom.countRows[index]),
  });
  assert.deepEqual(core.parseStarDistribution(dom.boundary), { 5: 29, 4: 3, 3: 2, 2: 2, 1: 0 });
});

test('invalid or incomplete star structures fail closed instead of returning a partial distribution', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  const repeated = clone(fixture.dom.gradeRows);
  repeated[4].activeStars = 2;
  assert.equal(core.parseStarDistribution(syntheticReviewSummaryDom(fixture, { gradeRows: repeated }).boundary), null);

  const missingGrade = clone(fixture.dom.gradeRows);
  missingGrade[4].activeStars = 0;
  assert.equal(core.parseStarDistribution(syntheticReviewSummaryDom(fixture, { gradeRows: missingGrade }).boundary), null);
  assert.equal(core.parseStarDistribution(syntheticReviewSummaryDom(fixture, {
    gradeRows: fixture.dom.gradeRows.slice(0, 4),
  }).boundary), null);
  assert.equal(core.parseStarDistribution(syntheticReviewSummaryDom(fixture, {
    countRows: fixture.dom.countRows.slice(0, 4),
  }).boundary), null);
  const malformedCounts = clone(fixture.dom.countRows);
  malformedCounts[0].text = 'many';
  assert.equal(core.parseStarDistribution(syntheticReviewSummaryDom(fixture, { countRows: malformedCounts }).boundary), null);
});

test('star mismatch diagnostics retain the full distribution and report false', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  const counts = clone(fixture.dom.countRows);
  counts[0].text = '28';
  const domSummary = core.extractReviewSummaryFromDom(syntheticReviewSummaryDom(fixture, { countRows: counts }).root);
  const summary = core.mergeRatingSummary(
    core.extractReviewSummaryFromSsrData(fixture.ssr, fixture.itemId),
    null,
    domSummary,
  );
  assert.deepEqual(summary.starDistribution, { 5: 28, 4: 3, 3: 2, 2: 2, 1: 0 });
  assert.equal(summary.diagnostics.starDistributionTotal, 35);
  assert.equal(summary.diagnostics.starDistributionMatchesReviewCount, false);
});

test('review boundary requires the scoped anchor, tabs, and product-rating structure', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  assert.equal(core.findReviewSummaryBoundary(syntheticReviewSummaryDom(fixture, { missingAnchor: true }).root), null);
  assert.equal(core.findReviewSummaryBoundary(syntheticReviewSummaryDom(fixture, { missingTabs: true }).root), null);
  assert.equal(core.findReviewSummaryBoundary(syntheticReviewSummaryDom(fixture, { missingRatingRoot: true }).root), null);
  const dom = syntheticReviewSummaryDom(fixture);
  dom.root.outside = fixture.dom.outsideSentinels;
  assert.deepEqual(core.parseStarDistribution(core.findReviewSummaryBoundary(dom.root)), {
    5: 29, 4: 3, 3: 2, 2: 2, 1: 0,
  });
});

test('buyer-photo summary uses View all count rather than rendered thumbnails', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  assert.equal(fixture.dom.buyerPhotos.renderedThumbnailCount, 30);
  const photos = core.extractBuyerPhotos(syntheticReviewSummaryDom(fixture).boundary);
  assert.deepEqual(photos, { value: 31, display: 'View all (31)' });
  const summary = core.extractReviewSummaryFromDom(syntheticReviewSummaryDom(fixture).root);
  assert.equal(summary.buyerPhotosCount, 31);
  assert.equal(summary.display.buyerPhotosCount, 'View all (31)');
});

test('buyer-photo absence stays unknown while semantic zero is preserved', () => {
  const relay = loadFixture('review-summary-1005008195850531.json');
  assert.deepEqual(core.extractBuyerPhotos(syntheticReviewSummaryDom(relay).boundary), { value: null, display: null });
  const zeroPhotos = { heading: 'All photos from buyers', display: 'View all (0)', renderedThumbnailCount: 0 };
  assert.deepEqual(core.extractBuyerPhotos(syntheticReviewSummaryDom(relay, { buyerPhotos: zeroPhotos }).boundary), {
    value: 0,
    display: 'View all (0)',
  });
  assert.deepEqual(core.extractBuyerPhotos(syntheticReviewSummaryDom(relay, {
    buyerPhotos: zeroPhotos,
    photoDisplay: 'View everything',
  }).boundary), { value: null, display: null });
});

test('captured Dress topics preserve localized text, count, mood, order, and no invented ID', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  const topics = core.extractReviewTopics(syntheticReviewSummaryDom(fixture).boundary);
  assert.equal(topics.length, 7);
  assert.deepEqual(topics[0], { text: 'Идеальный размер', count: 3, mood: 'positive' });
  assert.deepEqual(topics[5], { text: 'Неправильный цвет', count: 2, mood: 'negative' });
  assert.deepEqual(topics.at(-1), {
    text: 'Не подходит для больших размеров груди', count: 2, mood: 'negative',
  });
  assert.equal(Object.hasOwn(topics[0], 'id'), false);
});

test('topics are optional and guarded by the exact scoped semantic heading', () => {
  const relay = loadFixture('review-summary-1005008195850531.json');
  assert.equal(core.extractReviewTopics(syntheticReviewSummaryDom(relay).boundary), null);
  const dress = loadFixture('review-summary-1005009452926938.json');
  assert.equal(core.extractReviewTopics(syntheticReviewSummaryDom(dress, {
    topicHeading: 'Review filters',
  }).boundary), null);
  const malformed = clone(dress.dom.topics);
  malformed.topics[0].count = 'many';
  const topics = core.extractReviewTopics(syntheticReviewSummaryDom(dress, { topics: malformed }).boundary);
  assert.equal(topics.length, 6);
  assert.equal(topics.some((topic) => topic.text === 'Идеальный размер'), false);
  const ambiguous = core.extractReviewTopics(syntheticReviewSummaryDom(dress, { conflictingMood: true }).boundary);
  assert.ok(ambiguous.every((topic) => topic.mood === null));
});

test('rating diagnostics are recomputed after merge and null patches preserve same-item data', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  const structured = core.extractReviewSummaryFromSsrData(fixture.ssr, fixture.itemId);
  const reviewDom = core.extractReviewSummaryFromDom(syntheticReviewSummaryDom(fixture).root);
  let summary = core.mergeRatingSummary(structured, null, reviewDom);
  assert.equal(summary.diagnostics.starDistributionMatchesReviewCount, true);
  summary = core.withRatingDiagnostics({ ...summary, reviewCount: 35 });
  assert.equal(summary.diagnostics.starDistributionTotal, 36);
  assert.equal(summary.diagnostics.starDistributionMatchesReviewCount, false);

  const productFixture = loadFixture('product-1005009452926938.json');
  const product = core.normalizeProduct(productFixture.data, fixture.sourceUrl);
  const enriched = core.updateRatingSummary(
    product,
    core.mergeRatingSummary(structured, null, reviewDom),
    ['ssr:__AER_DATA__', 'dom:review-section'],
  );
  const unchanged = core.updateRatingSummary(enriched, {
    rating: null,
    reviewCount: null,
    contentFeedbackCount: null,
    starDistribution: null,
    buyerPhotosCount: null,
    reviewTopics: null,
    display: {},
  }, ['ssr:__AER_DATA__', 'dom:review-section']);
  assert.equal(unchanged, enriched);
});

test('combined review enrichment preserves selected SKU, price, delivery, store, and product sections', () => {
  const productFixture = loadFixture('product-1005009452926938.json');
  const reviewFixture = loadFixture('review-summary-1005009452926938.json');
  const pageUrl = `${reviewFixture.sourceUrl}`;
  let product = core.normalizeProduct(productFixture.data, pageUrl);
  const sentinels = {
    delivery: { methods: [{ sentinel: 'delivery' }] },
    store: { name: 'WLIN OOTD Store' },
    gallery: { items: [{ type: 'image', imageUrl: 'https://example.com/gallery.jpg' }] },
    description: core.buildDescription('dom', '<p>description</p>', [{ type: 'text', text: 'description' }]),
    characteristics: [{ name: 'Material', value: 'Synthetic' }],
  };
  Object.assign(product, sentinels);
  const selectedSku = product.selectedSku;
  const price = product.price;
  const ratingDom = syntheticRatingDom({ ratingText: '4.6', reviewText: '36 reviews', boughtText: '414 bought' });
  const enriched = core.enrichProductFallbacks(product, {
    structuredRating: core.extractReviewSummaryFromSsrData(reviewFixture.ssr, reviewFixture.itemId),
    domRating: core.extractBasicRatingFromDom(ratingDom.root),
    reviewDomSummary: core.extractReviewSummaryFromDom(syntheticReviewSummaryDom(reviewFixture).root),
  });
  assert.equal(enriched.selectedSku, selectedSku);
  assert.equal(enriched.price, price);
  for (const field of ['delivery', 'store', 'gallery', 'description', 'characteristics']) {
    assert.equal(enriched[field], sentinels[field]);
  }
  assert.equal(enriched.ratingSummary.contentFeedbackCount, 30);
  assert.equal(enriched.ratingSummary.boughtCount, 414);
  assert.equal(enriched.ratingSummary.buyerPhotosCount, 31);
  assert.equal(enriched.ratingSummary.reviewTopics.length, 7);
  assert.equal(core.enrichProductFallbacks(enriched, {}), enriched);
});

test('review DOM stale protection rejects the old boundary until content changes', () => {
  const relay = loadFixture('review-summary-1005008195850531.json');
  const dress = loadFixture('review-summary-1005009452926938.json');
  const oldDom = syntheticReviewSummaryDom(relay);
  const oldSummary = core.extractReviewSummaryFromDom(oldDom.root);
  const changedSummary = core.extractReviewSummaryFromDom(syntheticReviewSummaryDom(dress).root);
  assert.equal(core.isStaleRatingSummary(oldDom.boundary, oldSummary, oldDom.boundary, oldSummary), true);
  assert.equal(core.isStaleRatingSummary(oldDom.boundary, changedSummary, oldDom.boundary, oldSummary), false);
});

test('ChatGPT review summary reports counts, topics, and mismatch diagnostics honestly', () => {
  const productFixture = loadFixture('product-1005009452926938.json');
  const reviewFixture = loadFixture('review-summary-1005009452926938.json');
  const product = core.normalizeProduct(productFixture.data, reviewFixture.sourceUrl);
  const structured = core.extractReviewSummaryFromSsrData(reviewFixture.ssr, reviewFixture.itemId);
  const counts = clone(reviewFixture.dom.countRows);
  counts[0].text = '28';
  const reviewDom = core.extractReviewSummaryFromDom(syntheticReviewSummaryDom(reviewFixture, { countRows: counts }).root);
  product.ratingSummary = core.mergeRatingSummary(structured, {
    boughtCount: 414,
    display: { boughtCount: '414 bought' },
  }, reviewDom);
  const output = core.exportForChatGPT(product);
  assert.match(output, /Content feedbacks: 30/);
  assert.match(output, /Stars: 5★ 28 \| 4★ 3 \| 3★ 2 \| 2★ 2 \| 1★ 0/);
  assert.match(output, /Star total: 35\nStar total matches reviews: no/);
  assert.match(output, /Buyer photos: 31/);
  assert.match(output, /Review topics:\n- Идеальный размер — 3 — positive/);
});

test('seller percentage parser accepts captured locale forms and preserves true zero', () => {
  assert.equal(core.parseLocalizedPercentage('85%'), 85);
  assert.equal(core.parseLocalizedPercentage('84,98%'), 84.98);
  assert.equal(core.parseLocalizedPercentage('84.98%'), 84.98);
  assert.equal(core.parseLocalizedPercentage('0%'), 0);
  assert.equal(core.parseLocalizedPercentage(0), 0);
  assert.equal(core.parseLocalizedPercentage('4,4 item\'s rating'), null);
  assert.equal(core.parseLocalizedPercentage('101%'), null);
});

test('captured WLIN SSR store is found structurally and bound to the exact current item', () => {
  const fixture = loadFixture('store-ssr-1005009452926938.json');
  const root = { unrelated: [{ childrenChanged: { widget: fixture.fragment } }] };
  const store = core.extractStoreFromSsrData(root, fixture.itemId);

  assert.equal(fixture.sourceKind, 'live #__AER_DATA__ observation');
  assert.deepEqual(store, {
    name: 'WLIN OOTD Store',
    url: 'https://aliexpress.ru/store/1103330026',
    storeId: '1103330026',
    sellerId: '2677490623',
    sellerRating: {
      kind: 'positiveFeedbackPercentage',
      value: 84.98,
      display: "84,98% seller's rating",
    },
    subscribers: { value: 2919, display: '3K subscribers' },
  });
  assert.notEqual(store.storeId, store.sellerId);
  assert.equal(core.extractStoreFromSsrData(root, '1005005933779962'), null);
});

test('synthetic chat-bound mutation of captured SSR yields a partial store', () => {
  const fixture = loadFixture('store-ssr-1005009452926938.json');
  const partial = clone(fixture.fragment);
  delete partial.props.url;
  delete partial.props.subscribersCount;
  delete partial.props.positiveReviews;
  delete partial.props.subscribersCountFormatted;
  delete partial.props.stats;
  delete partial.props.subtitles;
  delete partial.props.analytics;

  assert.deepEqual(core.extractStoreFromSsrData({ moved: partial }, fixture.itemId), {
    name: 'WLIN OOTD Store',
    url: null,
    storeId: null,
    sellerId: '2677490623',
    sellerRating: {
      kind: 'positiveFeedbackPercentage', value: null, display: null,
    },
    subscribers: { value: null, display: null },
  });
});

test('synthetic analytics-bound mutation of captured SSR yields a partial store', () => {
  const fixture = loadFixture('store-ssr-1005009452926938.json');
  const partial = clone(fixture.fragment);
  delete partial.props.chatLink;
  delete partial.props.subscribersCount;
  delete partial.props.positiveReviews;
  delete partial.props.subscribersCountFormatted;
  delete partial.props.stats;
  delete partial.props.subtitles;

  assert.deepEqual(core.extractStoreFromSsrData({ moved: partial }, fixture.itemId), {
    name: 'WLIN OOTD Store',
    url: 'https://aliexpress.ru/store/1103330026',
    storeId: '1103330026',
    sellerId: '2677490623',
    sellerRating: {
      kind: 'positiveFeedbackPercentage', value: null, display: null,
    },
    subscribers: { value: null, display: null },
  });
});

test('synthetic generic analytics widget without store evidence is not accepted', () => {
  const itemId = '1005009452926938';
  assert.equal(core.extractStoreFromSsrData({
    widget: {
      props: {
        id: '2677490623',
        name: 'Not proven store',
        analytics: { something: { itemId } },
      },
    },
  }, itemId), null);
});

test('captured Needles SSR store keeps plain subscribers and ignores unsupported store stats', () => {
  const fixture = loadFixture('store-ssr-1005005933779962.json');
  const store = core.extractStoreFromSsrData({ moved: { again: [fixture.fragment] } }, fixture.itemId);

  assert.equal(store.name, 'Better off Store');
  assert.equal(store.storeId, '1100036170');
  assert.equal(store.sellerId, '2660067190');
  assert.deepEqual(store.sellerRating, {
    kind: 'positiveFeedbackPercentage', value: 94.09, display: "94,09% seller's rating",
  });
  assert.deepEqual(store.subscribers, { value: 320, display: '320 subscribers' });
  assert.equal(JSON.stringify(store).includes("item's rating"), false);
  assert.equal(JSON.stringify(store).includes('5K reviews'), false);
  assert.equal(JSON.stringify(store).includes('Orders delivered'), false);
  assert.equal(store.sellerRating.value, fixture.fragment.props.positiveReviews.percentages);
  assert.notEqual(store.sellerRating.value, Number(fixture.fragment.props.positiveReviews.number));
});

test('SSR store candidates fail closed for mismatched item or conflicting seller IDs', () => {
  const fixture = loadFixture('store-ssr-1005009452926938.json');
  const mismatch = clone(fixture.fragment);
  mismatch.props.chatLink = mismatch.props.chatLink.replace(fixture.itemId, '1005005933779962');
  assert.equal(core.extractStoreFromSsrData({ mismatch }, fixture.itemId), null);

  const noBinding = clone(fixture.fragment);
  noBinding.props.chatLink = null;
  noBinding.props.analytics.viewStoreTop.trackingInfo.itemId = '1005005933779962';
  assert.equal(core.extractStoreFromSsrData({ noBinding }, fixture.itemId), null);

  const conflictingSeller = clone(fixture.fragment);
  conflictingSeller.props.chatLink = conflictingSeller.props.chatLink.replace('seller_id=2677490623', 'seller_id=999');
  const store = core.extractStoreFromSsrData({ conflictingSeller }, fixture.itemId);
  assert.equal(store.sellerId, null);
  assert.equal(store.name, 'WLIN OOTD Store');
});

test('conflicting matched SSR store candidates fail closed instead of mixing stores', () => {
  const fixture = loadFixture('store-ssr-1005009452926938.json');
  const conflictingStore = clone(fixture.fragment);
  conflictingStore.props.name = 'Conflicting Store';
  conflictingStore.props.url = 'https://aliexpress.ru/store/999';

  assert.equal(core.extractStoreFromSsrData({
    first: fixture.fragment,
    second: conflictingStore,
  }, fixture.itemId), null);
});

test('store URL parsing uses only the confirmed aliexpress.ru /store/digits shape', () => {
  assert.equal(core.storeIdFromUrl('https://aliexpress.ru/store/1103330026'), '1103330026');
  assert.equal(core.storeIdFromUrl('https://aliexpress.ru/store/1103330026/'), '1103330026');
  assert.equal(core.storeIdFromUrl('https://www.aliexpress.com/store/1103330026'), null);
  assert.equal(core.storeIdFromUrl('https://aliexpress.ru/shop/1103330026'), null);
  assert.equal(core.storeIdFromUrl('https://example.com/store/1103330026'), null);

  const unknown = core.normalizeStore({ name: 'Observed store', url: 'https://example.com/actual-store' });
  assert.equal(unknown.url, 'https://example.com/actual-store');
  assert.equal(unknown.storeId, null);
});

test('captured DOM store extraction stays inside #storeInfo and ignores item rating and Megabonus', () => {
  const fixture = loadFixture('store-dom-1005005933779962.json');
  const megabonus = { textContent: "99% seller's rating 8K subscribers", href: 'https://aliexpress.ru/store/999' };
  const root = syntheticStoreDom(fixture, { megabonusSentinel: megabonus });
  const store = core.extractStoreFromDom(root, fixture.itemId, `https://aliexpress.ru/item/${fixture.itemId}.html`);

  assert.deepEqual(store, {
    name: 'Better off Store',
    url: 'https://aliexpress.ru/store/1100036170',
    storeId: '1100036170',
    sellerId: '2660067190',
    sellerRating: {
      kind: 'positiveFeedbackPercentage', value: 94.09, display: "94,09% seller's rating",
    },
    subscribers: { value: 320, display: '320 subscribers' },
  });
  assert.equal(JSON.stringify(store).includes("item's rating"), false);
  assert.equal(JSON.stringify(store).includes('999'), false);
});

test('scoped DOM chat seller fallback rejects a mismatched chat item', () => {
  const fixture = loadFixture('store-dom-1005005933779962.json');
  const mismatchedHref = fixture.chat.href.replace(fixture.itemId, '1005009452926938');
  assert.equal(core.extractStoreFromDom(
    syntheticStoreDom(fixture, { chatHref: mismatchedHref }),
    fixture.itemId,
    `https://aliexpress.ru/item/${fixture.itemId}.html`,
  ), null);
  const partial = core.extractStoreFromDom(
    syntheticStoreDom(fixture, { missingChat: true }),
    fixture.itemId,
    `https://aliexpress.ru/item/${fixture.itemId}.html`,
  );
  assert.equal(partial.sellerId, null);
  assert.equal(partial.name, 'Better off Store');
});

test('store normalization preserves zeros, supports partial data, and returns null for total absence', () => {
  assert.deepEqual(core.normalizeStore({
    sellerRating: { value: 0, display: "0% seller's rating" },
    subscribers: { value: '0', display: '0 subscribers' },
  }), {
    name: null,
    url: null,
    storeId: null,
    sellerId: null,
    sellerRating: {
      kind: 'positiveFeedbackPercentage', value: 0, display: "0% seller's rating",
    },
    subscribers: { value: 0, display: '0 subscribers' },
  });
  assert.equal(core.normalizeStore({}), null);
  assert.equal(core.normalizeStore(null), null);
});

test('store field merge keeps raw SSR subscribers with trusted rounded DOM display', () => {
  const structured = core.normalizeStore({
    name: 'Structured Store',
    sellerRating: { value: 84.98 },
    subscribers: { value: 2919 },
  });
  const dom = core.normalizeStore({
    name: 'DOM Store',
    url: 'https://aliexpress.ru/store/1103330026',
    sellerId: '2677490623',
    sellerRating: { value: 84.98, display: "84,98% seller's rating" },
    subscribers: { value: 3000, display: '3K subscribers' },
  });
  const merged = core.mergeStore(structured, dom);
  assert.equal(merged.name, 'Structured Store');
  assert.equal(merged.storeId, '1103330026');
  assert.equal(merged.sellerRating.display, "84,98% seller's rating");
  assert.equal(merged.subscribers.value, 2919);
  assert.equal(merged.subscribers.display, '3K subscribers');
});

test('store field merge keeps seller-rating conflict protection separate from subscribers', () => {
  const structured = core.normalizeStore({
    sellerRating: { value: 84.98 },
    subscribers: { value: 2919 },
  });
  const conflictingDom = core.normalizeStore({
    sellerRating: { value: 91.63, display: "91,63% seller's rating" },
    subscribers: { value: 3000, display: '3K subscribers' },
  });
  const merged = core.mergeStore(structured, conflictingDom);

  assert.deepEqual(merged.sellerRating, {
    kind: 'positiveFeedbackPercentage', value: 84.98, display: null,
  });
  assert.deepEqual(merged.subscribers, { value: 2919, display: '3K subscribers' });
});

test('store enrichment is reference-stable and preserves all existing normalized fields', () => {
  const productFixture = loadFixture('product-1005009452926938.json');
  const galleryFixture = loadFixture('gallery-1005005933779962.json');
  const storeFixture = loadFixture('store-ssr-1005009452926938.json');
  const pageUrl = 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540';
  const product = core.normalizeProduct(productFixture.data, pageUrl);
  product.gallery = core.normalizeGallery(galleryFixture.props.gallery, 'ssr:__AER_DATA__');
  product.ratingSummary = { rating: 4.6, reviewCount: 36, boughtCount: 414, display: {} };
  product.characteristics = [{ name: 'Material', value: 'Cotton' }];
  product.description = { source: 'dom', rawHtml: '<p>Seller text</p>', blocks: [{ type: 'text', text: 'Seller text' }] };
  product.delivery = { productId: product.itemId, skuId: product.selectedSkuId, methods: [] };
  const references = {
    gallery: product.gallery,
    ratingSummary: product.ratingSummary,
    characteristics: product.characteristics,
    description: product.description,
    delivery: product.delivery,
    selectedSku: product.selectedSku,
    price: product.price,
  };
  const store = core.extractStoreFromSsrData(storeFixture.fragment, storeFixture.itemId);
  const enriched = core.enrichProductFallbacks(product, { structuredStore: store });

  assert.equal(enriched.store.name, 'WLIN OOTD Store');
  Object.entries(references).forEach(([field, value]) => assert.equal(enriched[field], value));
  assert.equal(core.enrichProductFallbacks(enriched, { structuredStore: clone(store) }), enriched);
  assert.match(core.exportProduct(enriched), /"store": \{/);
  assert.match(core.exportForChatGPT(enriched), /STORE \/ SELLER:\nStore: WLIN OOTD Store/);
});

test('same-item productData refresh and SKU switch preserve store while stale old-item DOM is rejected', () => {
  const productFixture = loadFixture('product-1005009452926938.json');
  const storeFixture = loadFixture('store-ssr-1005009452926938.json');
  const store = core.extractStoreFromSsrData(storeFixture.fragment, storeFixture.itemId);
  const initial = core.updateStore(core.normalizeProduct(
    productFixture.data,
    'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540',
  ), store, ['ssr:__AER_DATA__']);
  const refreshed = core.updateStore(core.normalizeProduct(
    productFixture.data,
    'https://aliexpress.ru/item/1005009452926938.html',
  ), initial.store, ['ssr:__AER_DATA__']);
  const switched = core.updateSelectedSku(initial, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727530');
  const oldBoundary = { sentinel: 'old store boundary' };

  assert.deepEqual(refreshed.store, initial.store);
  assert.equal(switched.store, initial.store);
  assert.equal(core.isStaleStore(oldBoundary, clone(store), oldBoundary, store), true);
  assert.equal(core.isStaleStore({ sentinel: 'new boundary' }, clone(store), oldBoundary, store), false);
  assert.equal(core.extractStoreFromSsrData(storeFixture.fragment, '1005005933779962'), null);
});

test('ChatGPT store section handles full, zero, and absent store without item-rating leakage', () => {
  const productFixture = loadFixture('product-1005009452926938.json');
  const storeFixture = loadFixture('store-ssr-1005009452926938.json');
  const product = core.normalizeProduct(productFixture.data, 'https://aliexpress.ru/item/1005009452926938.html');
  product.store = core.extractStoreFromSsrData(storeFixture.fragment, storeFixture.itemId);
  const output = core.exportForChatGPT(product);
  assert.match(output, /RATING & TRADE:[\s\S]*STORE \/ SELLER:\nStore: WLIN OOTD Store[\s\S]*Seller rating value: 84\.98%[\s\S]*Subscribers value: 2919\n\nDELIVERY:/);
  assert.doesNotMatch(output, /item's rating|4,4 item's rating/);

  product.store = core.normalizeStore({ sellerRating: { value: 0 }, subscribers: { value: 0 } });
  assert.match(core.exportForChatGPT(product), /Seller rating value: 0%[\s\S]*Subscribers value: 0/);
  product.store = null;
  assert.match(core.exportForChatGPT(product), /STORE \/ SELLER:\n—\n\nDELIVERY:/);
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

test('short text-only ChatGPT description preserves ordered content without a limitation marker', () => {
  const description = core.buildDescription('dom', '<synthetic>', [
    { type: 'heading', level: 2, text: 'Materials' },
    { type: 'text', text: 'Cotton and linen.' },
  ]);

  assert.equal(core.formatDescriptionForChatGPT(description), [
    'Blocks: 2',
    'Text/heading/link blocks: 2',
    'Images: 0',
    'Links: 0',
    'Text characters: 26',
    '',
    'Materials',
    'Cotton and linen.',
  ].join('\n'));
});

test('ChatGPT description omits image URLs while full export retains every image in order', () => {
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

  const mainExport = core.exportForChatGPT(product);
  const fullExport = core.exportDescription(product);

  assert.match(core.exportProduct(product), /RAW_SENTINEL/);
  assert.match(mainExport, /DESCRIPTION:\nBlocks: 5\nText\/heading\/link blocks: 3\nImages: 2\nLinks: 1\nText characters: 16\n\nBefore\nA\/B\nDetails/);
  assert.doesNotMatch(mainExport, /https:\/\/example\.com\/(?:one\.jpg|two\.jpg|details)/);
  assert.match(mainExport, /\[Description limited: 2 image URLs, 1 link URLs omitted\. Use Copy description for the full ordered normalized description\.\]$/);
  assert.doesNotMatch(mainExport, /RAW_SENTINEL/);

  const firstImage = fullExport.indexOf('Image 1: https://example.com/one.jpg');
  const link = fullExport.indexOf('Details — https://example.com/details');
  const secondImage = fullExport.indexOf('Image 2: https://example.com/two.jpg');
  assert.ok(firstImage > -1 && firstImage < link && link < secondImage);
  assert.doesNotMatch(fullExport, /RAW_SENTINEL/);
});

test('a many-image description reports omissions without leaking image URLs', () => {
  const blocks = Array.from({ length: 41 }, (_, index) => ({
    type: 'image',
    url: `https://example.com/${index + 1}.jpg`,
    alt: null,
  }));
  blocks.splice(20, 0, { type: 'text', text: 'Useful seller text' });
  const description = core.buildDescription('dom', '<synthetic>', blocks);
  const mainOutput = core.formatDescriptionForChatGPT(description);
  const fullOutput = core.formatDescription(description);

  assert.match(mainOutput, /Blocks: 42[\s\S]*Images: 41[\s\S]*Useful seller text/);
  assert.doesNotMatch(mainOutput, /https:\/\/example\.com/);
  assert.match(mainOutput, /41 image URLs omitted/);
  assert.match(fullOutput, /^Image 1: https:\/\/example\.com\/1\.jpg/);
  assert.match(fullOutput, /Image 41: https:\/\/example\.com\/41\.jpg$/);
  assert.ok(fullOutput.indexOf('/20.jpg') < fullOutput.indexOf('Useful seller text'));
  assert.ok(fullOutput.indexOf('Useful seller text') < fullOutput.indexOf('/21.jpg'));
});

test('link blocks keep visible text in main export and destinations only in full export', () => {
  const description = core.buildDescription('dom', '<synthetic>', [
    { type: 'text', text: 'Start' },
    { type: 'link', text: 'Care guide', url: 'https://example.com/care' },
    { type: 'image', url: 'https://example.com/chart.jpg', alt: null, linkUrl: 'https://example.com/chart' },
  ]);
  const mainOutput = core.formatDescriptionForChatGPT(description);
  const fullOutput = core.formatDescription(description);

  assert.match(mainOutput, /Links: 2[\s\S]*Start\nCare guide/);
  assert.doesNotMatch(mainOutput, /https:\/\/example\.com/);
  assert.match(mainOutput, /1 image URLs, 2 link URLs omitted/);
  assert.match(fullOutput, /Care guide — https:\/\/example\.com\/care/);
  assert.match(fullOutput, /Image 1: https:\/\/example\.com\/chart\.jpg → https:\/\/example\.com\/chart/);
});

test('ChatGPT description enforces the default 2500-character text budget', () => {
  const first = 'A'.repeat(1400);
  const second = 'B'.repeat(1300);
  const description = core.buildDescription('dom', '<synthetic>', [
    { type: 'text', text: first },
    { type: 'heading', level: 2, text: second },
    { type: 'text', text: 'TAIL' },
  ]);
  const output = core.formatDescriptionForChatGPT(description);
  const body = output.split('\n\n')[1];

  assert.equal(body, `${first}\n${'B'.repeat(1100)}`);
  assert.equal(first.length + 1100, 2500);
  assert.match(output, /Text characters: 2704/);
  assert.match(output, /\[Description limited: 204 text characters omitted\./);
  assert.doesNotMatch(output, /TAIL/);
});

test('ChatGPT description truncates an oversized block instead of dropping it', () => {
  const description = core.buildDescription('dom', '<synthetic>', [
    { type: 'heading', level: 1, text: 'ABCDEFGHIJ' },
    { type: 'text', text: 'later' },
  ]);
  const output = core.formatDescriptionForChatGPT(description, { textBudget: 6 });

  assert.match(output, /Text characters: 15\n\nABCDEF\n\n\[Description limited: 9 text characters omitted\./);
  assert.doesNotMatch(output, /later/);
});

test('description formatters have stable missing-description semantics', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');

  assert.equal(core.formatDescriptionForChatGPT(null), '—');
  assert.equal(core.formatDescriptionForChatGPT({ blocks: [] }), '—');
  assert.match(core.exportForChatGPT({ ...product, description: null }), /DESCRIPTION:\n—$/);
  assert.match(core.exportDescription({ ...product, description: null }), /Blocks: 0\nImages: 0\nLinks: 0\n\nDESCRIPTION:\n—$/);
});

test('main product export bounds only Description and leaves Gallery and section order intact', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  product.gallery = {
    items: [{ type: 'image', imageUrl: 'https://gallery.example/full.jpg', previewUrl: 'https://gallery.example/preview.jpg' }],
  };
  product.description = core.buildDescription('dom', '<p>RAW_ONLY</p>', [
    { type: 'text', text: 'Seller copy' },
    { type: 'image', url: 'https://description.example/image.jpg', alt: null },
  ]);
  const output = core.exportForChatGPT(product);

  assert.match(output, /GALLERY:\nItem 1 \(image\)\nImage: https:\/\/gallery\.example\/full\.jpg\nPreview: https:\/\/gallery\.example\/preview\.jpg\n\nDESCRIPTION:/);
  assert.doesNotMatch(output, /https:\/\/description\.example/);
  assert.ok(output.indexOf('CHARACTERISTICS:') < output.indexOf('GALLERY:'));
  assert.ok(output.indexOf('GALLERY:') < output.indexOf('DESCRIPTION:'));
});

test('ChatGPT export keeps the resolved dress SKU current price unchanged', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const product = core.normalizeProduct(
    fixture.data,
    'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540',
  );
  const output = core.exportForChatGPT(product);

  assert.match(output, /Selected SKU: 12000049151727540\n/);
  assert.match(output, /Price: \$\u00a026\.08\n/);
  assert.doesNotMatch(output, /Selected SKU unresolved/);
});

test('unresolved ChatGPT price summary deduplicates formatted prices, ignores missing prices, and does not mutate the product', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  product.selectedSku = null;
  product.selectedSkuId = 'unresolved-sku';
  product.skus = [
    { price: { current: { value: '10', currency: 'USD', formatted: '$10.00' } } },
    { price: { current: null } },
    { price: { current: { value: '10.0', currency: 'USD', formatted: '$10.00' } } },
    { price: { current: { value: '12', currency: 'USD', formatted: '$12.00' } } },
    { price: { current: { value: '13', currency: 'USD', formatted: '$13.00' } } },
    { price: {} },
  ];
  const before = clone({ skus: product.skus, selectedSku: product.selectedSku, selectedSkuId: product.selectedSkuId });

  const output = core.exportForChatGPT(product);

  assert.match(output, /Selected SKU: unresolved-sku \(not resolved\)/);
  assert.match(output, /Price: Selected SKU unresolved; 3 unique SKU prices: \$10\.00 \| \$12\.00 \| \$13\.00/);
  assert.doesNotMatch(output, /Price:.*–/);
  assert.doesNotMatch(output, /Price:.*—.*\|/);
  assert.deepEqual(
    { skus: product.skus, selectedSku: product.selectedSku, selectedSkuId: product.selectedSkuId },
    before,
  );
  assert.ok(output.indexOf('CHARACTERISTICS:') < output.indexOf('GALLERY:'));
  assert.ok(output.indexOf('GALLERY:') < output.indexOf('DESCRIPTION:'));
  assert.match(output, /DESCRIPTION:\n/);
});

test('unresolved ChatGPT price summary describes one unique price without claiming it is selected', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  product.selectedSku = null;
  product.skus = [
    { price: { current: { formatted: '$10' } } },
    { price: { current: { formatted: '$10' } } },
  ];

  assert.match(
    core.exportForChatGPT(product),
    /Price: Selected SKU unresolved; 1 unique SKU price: \$10\n/,
  );
});

test('unresolved ChatGPT price summary reports when no current SKU prices are available', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  product.selectedSku = null;
  product.selectedSkuId = null;
  product.skus = [{ price: {} }, { price: { current: null } }, { price: { current: {} } }];

  const output = core.exportForChatGPT(product);
  assert.match(output, /Selected SKU: — \(not resolved\)/);
  assert.match(output, /Price: Selected SKU unresolved; no current SKU prices available\n/);
});

test('unresolved ChatGPT price summary shows the first five unique prices and exact omitted count', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  product.selectedSku = null;
  product.skus = ['$12.34', '$13.20', '$15.00', '$16.10', '$17.50', '$18.25', '$19.75', '$12.34']
    .map((formatted) => ({ price: { current: { formatted } } }));

  const output = core.exportForChatGPT(product);
  assert.match(
    output,
    /Price: Selected SKU unresolved; 7 unique SKU prices: \$12\.34 \| \$13\.20 \| \$15\.00 \| \$16\.10 \| \$17\.50 \(\+2 more\)\n/,
  );
  assert.doesNotMatch(output, /\$18\.25|\$19\.75/);
});

test('full Description export is isolated from raw HTML and unrelated product data', () => {
  const product = {
    title: 'Test item',
    url: 'https://aliexpress.ru/item/123.html',
    itemId: '123',
    store: { name: 'UNRELATED_STORE_SENTINEL' },
    reviews: [{ text: 'UNRELATED_REVIEW_SENTINEL' }],
    description: core.buildDescription('dom', '<p>RAW_HTML_SENTINEL</p>', [
      { type: 'text', text: 'Complete text' },
      { type: 'image', url: 'https://example.com/full.jpg', alt: null },
    ]),
  };
  const output = core.exportDescription(product);

  assert.match(output, /^ALIEXPRESS DESCRIPTION\n\nTitle: Test item/);
  assert.match(output, /Source: dom[\s\S]*Blocks: 2\nImages: 1\nLinks: 0[\s\S]*DESCRIPTION:\nComplete text\nImage 1: https:\/\/example\.com\/full\.jpg$/);
  assert.doesNotMatch(output, /RAW_HTML_SENTINEL|UNRELATED_STORE_SENTINEL|UNRELATED_REVIEW_SENTINEL/);
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

test('productData binding accepts only explicit current item identity', () => {
  assert.equal(core.isProductDataBoundToItem({ id: 'B' }, 'B'), true);
  assert.equal(core.isProductDataBoundToItem({ id: 'A' }, 'B'), false);
});

test('identity-less network productData requires matching request-time item identity', () => {
  const data = { skuInfo: { propertyList: [], priceList: [] } };
  const snapshot = clone(data);

  assert.equal(core.isProductDataBoundToItem(data, 'A', {
    source: 'network:productData', requestItemId: 'A',
  }), true);
  assert.equal(core.isProductDataBoundToItem(data, 'B', {
    source: 'network:productData', requestItemId: 'A',
  }), false);
  assert.equal(core.isProductDataBoundToItem(data, 'A', {
    source: 'network:productData', requestItemId: null,
  }), false);
  assert.deepEqual(data, snapshot);
});

test('explicit productData identity takes precedence over request-time identity', () => {
  assert.equal(core.isProductDataBoundToItem({ id: 'A' }, 'B', {
    source: 'network:productData', requestItemId: 'A',
  }), false);
  assert.equal(core.isProductDataBoundToItem({ id: 'B' }, 'B', {
    source: 'network:productData', requestItemId: 'A',
  }), true);
});

test('SSR and React fallbacks keep explicit current-item binding and fail closed without it', () => {
  const fixture = loadFixture('product-1005008195850531.json');

  assert.equal(core.isProductDataBoundToItem(fixture.data, fixture.data.id, {
    source: 'ssr:__AER_DATA__',
  }), true);
  assert.equal(core.isProductDataBoundToItem(fixture.data, fixture.data.id, {
    source: 'react:__reactProps',
  }), true);
  assert.equal(core.isProductDataBoundToItem({ skuInfo: fixture.data.skuInfo }, fixture.data.id, {
    source: 'ssr:__AER_DATA__',
  }), false);
});

test('delayed fetch productData is bound at invocation and cannot become the next SPA product', async () => {
  let resolveNative;
  let currentItemId = 'A';
  let product = null;
  let capturedRequestItemId = null;
  let calls = 0;
  const nativePromise = new Promise((resolve) => { resolveNative = resolve; });
  const originalFetch = (...args) => {
    calls += 1;
    assert.deepEqual(args, ['/api/productData?item=A', { method: 'POST' }]);
    return nativePromise;
  };
  const pageWindow = {
    fetch: originalFetch,
    location: { href: 'https://aliexpress.ru/item/A.html' },
  };
  core.installProductDataInterceptor(pageWindow, (data, meta) => {
    capturedRequestItemId = meta.requestItemId;
    if (core.isProductDataBoundToItem(data, currentItemId, meta)) product = data;
  }, () => currentItemId);

  const returned = pageWindow.fetch('/api/productData?item=A', { method: 'POST' });
  assert.equal(returned, nativePromise);
  currentItemId = 'B';
  pageWindow.location.href = 'https://aliexpress.ru/item/B.html';
  resolveNative({
    clone: () => ({ json: async () => ({ data: { skuInfo: { propertyList: [], priceList: [] } } }) }),
  });
  await returned;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls, 1);
  assert.equal(capturedRequestItemId, 'A');
  assert.equal(product, null);
});

test('XHR productData captures request item identity at open time', () => {
  let currentItemId = 'A';
  let captured = null;
  class FakeXHR {
    constructor() {
      this.listeners = {};
      this.responseType = '';
      this.responseText = '';
    }

    open(...args) { this.openArgs = args; }
    send(...args) { this.sendArgs = args; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    finish(payload) {
      this.responseText = JSON.stringify(payload);
      this.listeners.loadend();
    }
  }
  const pageWindow = {
    location: { href: 'https://aliexpress.ru/item/A.html' },
    XMLHttpRequest: FakeXHR,
  };
  core.installProductDataInterceptor(pageWindow, (data, meta) => { captured = { data, meta }; }, () => currentItemId);

  const xhr = new pageWindow.XMLHttpRequest();
  xhr.open('POST', '/api/productData?item=A', true);
  currentItemId = 'B';
  xhr.send('native-body');
  xhr.finish({ data: { skuInfo: { propertyList: [], priceList: [] } } });

  assert.deepEqual(xhr.openArgs, ['POST', '/api/productData?item=A', true]);
  assert.deepEqual(xhr.sendArgs, ['native-body']);
  assert.equal(captured.meta.requestItemId, 'A');
  assert.equal(core.isProductDataBoundToItem(captured.data, currentItemId, captured.meta), false);
});

test('recognizes exact AliExpress reviews routes without changing PDP semantics', () => {
  const base = 'https://aliexpress.ru/item/1005009452926938/reviews';
  assert.equal(core.isReviewsPage(base), true);
  assert.equal(core.isReviewsPage(`${base}?sku_id=12000049151727538`), true);
  assert.equal(core.isReviewsPage(`${base}?spm=tracking&anything=kept`), true);
  assert.equal(core.getReviewsItemId(`${base}?sku_id=1#fragment`), '1005009452926938');
  assert.equal(core.isReviewsPage('https://aliexpress.ru/item/1005009452926938.html'), false);
  assert.equal(core.isReviewsPage(`${base}/extra`), false);
  assert.equal(core.isReviewsPage('https://example.com/item/1005009452926938/reviews'), false);
  assert.equal(core.getReviewsItemId('https://example.com/item/1005009452926938/reviews'), null);
  assert.equal(core.isItemPage('https://aliexpress.ru/item/1005009452926938.html'), true);
  assert.equal(core.isItemPage(base), false);
  assert.equal(core.getItemId(base), null);
});

test('extracts the real minimized Relay first-page SSR candidate by structure', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const nested = { arbitrary: { deep: [{ unrelated: [] }, { candidate: fixture.widget }] } };
  const result = core.extractReviewsPageFromSsrData(nested, fixture.itemId);
  assert.equal(fixture.sanitized, true);
  assert.equal(fixture.capturedAt, '2026-08-13');
  assert.equal(result.itemId, fixture.itemId);
  assert.equal(result.source, 'ssr:__AER_DATA__');
  assert.equal(result.reviews.length, 5);
  assert.deepEqual(result.reviews.map((review) => review.id), fixture.widget.props.reviews.map((review) => review.root.id));
});

test('normalizes Relay sparse and rating-only natural cases without inferred fields', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const reviews = core.extractReviewsPageFromSsrData({ widget: fixture.widget }, fixture.itemId).reviews;
  assert.equal(reviews[0].skuProperties, null);
  assert.equal(reviews[0].reviewer.initials, null);
  assert.equal(reviews[1].reviewer.countryFlagUrl, null);
  assert.equal(reviews[3].reviewer.avatarUrl, null);
  assert.equal(reviews[2].initial.text, null);
  assert.equal(reviews[2].initial.originalText, null);
  assert.deepEqual(reviews[2].initial.images, []);
  assert.deepEqual(reviews[2].initial.comments, []);
  assert.equal(reviews[2].additional, null);
  assert.equal(reviews[2].likesAmount, 0);
  assert.equal(Object.hasOwn(reviews[0].initial, 'effectiveText'), false);
  assert.equal(Object.hasOwn(reviews[0], 'countryCode'), false);
});

test('normalizes Dress text, media, comments, reviewer and non-zero likes', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const result = core.extractReviewsPageFromSsrData({ movedAgain: [{ widget: fixture.widget }] }, fixture.itemId);
  assert.equal(result.reviews.length, 10);
  const first = result.reviews[0];
  assert.equal(first.productId, fixture.itemId);
  assert.equal(first.skuProperties, 'Lining B Navy Blue | M');
  assert.deepEqual(first.reviewer, {
    displayName: 'Reviewer D1',
    initials: null,
    avatarUrl: 'https://fixtures.invalid/avatar-d1.png',
    countryFlagUrl: 'https://fixtures.invalid/ru.svg',
  });
  assert.equal(first.initial.dateRaw, '1 June 2026');
  assert.equal(first.initial.grade, 5);
  assert.equal(first.initial.text, 'Translated dress review D1.');
  assert.equal(first.initial.originalText, 'Original dress review D1.');
  assert.deepEqual(first.initial.images, [{ id: 'dress-image-1', url: 'https://fixtures.invalid/dress-image-1.jpeg' }]);
  assert.deepEqual(first.initial.comments[0], {
    id: 'dress-comment-1',
    authorDisplayName: 'Store D',
    authorInitials: null,
    authorAvatarUrl: 'https://fixtures.invalid/store.png',
    dateRaw: '6 June 2026',
    text: 'Public reply D1.',
    originalText: null,
  });
  assert.equal(first.likesAmount, 8);
  assert.equal(result.reviews[8].initial.originalText, null);
});

test('keeps text and originalText independent, including both-null reviews', () => {
  const relay = loadFixture('reviews-ssr-1005008195850531.json');
  const dress = loadFixture('reviews-ssr-1005009452926938.json');
  const relayReviews = core.extractReviewsPageFromSsrData(relay, relay.itemId).reviews;
  const dressReviews = core.extractReviewsPageFromSsrData(dress, dress.itemId).reviews;
  assert.notEqual(relayReviews[0].initial.text, relayReviews[0].initial.originalText);
  assert.equal(dressReviews[8].initial.text, 'Displayed dress review D9.');
  assert.equal(dressReviews[8].initial.originalText, null);
  assert.equal(relayReviews[2].initial.text, null);
  assert.equal(relayReviews[2].initial.originalText, null);
  assert.equal(Object.hasOwn(dressReviews[0].initial, 'language'), false);
  assert.equal(Object.hasOwn(dressReviews[0].initial, 'effectiveText'), false);
});

test('normalizes real-observed additional objects separately from initial reviews', () => {
  const fixture = loadFixture('reviews-ssr-additional-32882927175.json');
  const result = core.extractReviewsPageFromSsrData({ widgets: [fixture.widget] }, fixture.itemId);
  assert.equal(result.reviews.length, 2);
  const first = result.reviews[0];
  assert.equal(first.id, 'additional-root-1');
  assert.equal(first.additional.id, 'additional-followup-1');
  assert.notEqual(first.id, first.additional.id);
  assert.equal(first.additional.dateRaw, 'Added 16 June 2026');
  assert.equal(first.additional.grade, 4);
  assert.equal(first.additional.text, 'Follow-up review A1.');
  assert.equal(first.additional.originalText, null);
  assert.equal(first.initial.images.length, 1);
  assert.equal(first.additional.images.length, 3);
  assert.deepEqual(first.additional.comments, []);
  assert.equal(first.likesAmount, 3);
});

test('accepts widget family version drift and requires PRP screen placement', () => {
  const fixture = loadFixture('reviews-ssr-additional-32882927175.json');
  const versionDrift = clone(fixture);
  versionDrift.widget.widgetId = 'bx/RedReviewsProductFeedbackList/0.99.1';
  assert.ok(core.extractReviewsPageFromSsrData(versionDrift, fixture.itemId));
  const wrongPlacement = clone(fixture);
  wrongPlacement.widget.props.placement = 'PDP';
  assert.equal(core.extractReviewsPageFromSsrData(wrongPlacement, fixture.itemId), null);
  const wrongArea = clone(fixture);
  wrongArea.widget.props.pageArea = 'carousel';
  assert.equal(core.extractReviewsPageFromSsrData(wrongArea, fixture.itemId), null);
});

test('requires exact current product binding for every review and rejects empty lists', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  assert.equal(core.extractReviewsPageFromSsrData(fixture, '999'), null);
  const mixed = clone(fixture);
  mixed.widget.props.reviews[2].product.id = '999';
  assert.equal(core.extractReviewsPageFromSsrData(mixed, fixture.itemId), null);
  const missing = clone(fixture);
  delete missing.widget.props.reviews[1].product.id;
  assert.equal(core.extractReviewsPageFromSsrData(missing, fixture.itemId), null);
  const empty = clone(fixture);
  empty.widget.props.reviews = [];
  assert.equal(core.extractReviewsPageFromSsrData(empty, fixture.itemId), null);
});

test('ignores gallery, topic, summary and unrelated review-shaped arrays', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const root = {
    gallery: { widgetId: 'bx/RedReviewsGallery/0.31.1', props: { placement: 'PRP', pageArea: 'screen', reviews: fixture.widget.props.reviews } },
    topics: { widgetId: 'bx/RedReviewsTags/0.8.0', props: { placement: 'PRP', pageArea: 'screen', reviews: fixture.widget.props.reviews } },
    candidate: fixture.widget,
  };
  assert.equal(core.extractReviewsPageFromSsrData(root, fixture.itemId).reviews.length, 5);
  delete root.candidate;
  assert.equal(core.extractReviewsPageFromSsrData(root, fixture.itemId), null);
});

test('bounded traversal does not depend on a diagnostic deep path', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  let within = fixture.widget;
  for (let index = 0; index < 20; index += 1) within = { moved: within };
  assert.ok(core.extractReviewsPageFromSsrData(within, fixture.itemId));
  let beyond = fixture.widget;
  for (let index = 0; index < 50; index += 1) beyond = { moved: beyond };
  assert.equal(core.extractReviewsPageFromSsrData(beyond, fixture.itemId, { maxDepth: 10 }), null);
  assert.equal(core.extractReviewsPageFromSsrData({ noise: [{}, {}, fixture.widget] }, fixture.itemId, { maxVisited: 1 }), null);
});

test('deduplicates identical same-key records and keeps first source occurrence', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const first = fixture.widget.props.reviews[0];
  fixture.widget.props.reviews.splice(1, 0, clone(first));
  const result = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  assert.equal(result.reviews.length, 5);
  assert.equal(result.reviews[0].id, 'relay-review-1');
});

test('fails a candidate on conflicting duplicate content for the same stable key', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const conflict = clone(fixture.widget.props.reviews[0]);
  conflict.root.text = 'Conflicting content.';
  fixture.widget.props.reviews.push(conflict);
  assert.equal(core.extractReviewsPageFromSsrData(fixture, fixture.itemId), null);
});

test('does not deduplicate equal content when review IDs differ', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const secondId = clone(fixture.widget.props.reviews[0]);
  secondId.root.id = 'relay-review-distinct';
  fixture.widget.props.reviews.push(secondId);
  const result = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  assert.equal(result.reviews.length, 6);
});

test('accepts identical multiple SSR candidates and rejects candidate conflicts', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const identical = { one: fixture.widget, elsewhere: { two: clone(fixture.widget) } };
  assert.equal(core.extractReviewsPageFromSsrData(identical, fixture.itemId).reviews.length, 5);
  const conflicting = clone(fixture.widget);
  conflicting.props.reviews[0].root.text = 'Candidate conflict.';
  assert.equal(core.extractReviewsPageFromSsrData({ one: fixture.widget, two: conflicting }, fixture.itemId), null);
  const reordered = clone(fixture.widget);
  reordered.props.reviews.reverse();
  assert.equal(core.extractReviewsPageFromSsrData({ one: fixture.widget, two: reordered }, fixture.itemId), null);
});

test('fails closed when any matching SSR candidate is structurally malformed', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const malformed = clone(fixture.widget);
  delete malformed.props.reviews[0].root.id;
  assert.equal(core.extractReviewsPageFromSsrData({ valid: fixture.widget, malformed }, fixture.itemId), null);
});

test('strict review normalization fails the whole candidate for malformed records', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const mutations = [
    (record) => { delete record.root.id; },
    (record) => { record.root.images = {}; },
    (record) => { record.root.comments = null; },
    (record) => { record.additional = {}; },
    (record) => { record.interaction.likesAmount = '0'; },
    (record) => { record.root.grade = 6; },
    (record) => { record.reviewer.avatar = 'javascript:alert(1)'; },
  ];
  mutations.forEach((mutate) => {
    const malformed = clone(fixture);
    mutate(malformed.widget.props.reviews[0]);
    assert.equal(core.extractReviewsPageFromSsrData(malformed, fixture.itemId), null);
  });
});

test('strict additional, image and comment shapes fail closed', () => {
  const fixture = loadFixture('reviews-ssr-additional-32882927175.json');
  const mutations = [
    (record) => { delete record.additional.id; },
    (record) => { record.additional.images = null; },
    (record) => { record.additional.comments = {}; },
    (record) => { record.additional.images[0].url = 'data:image/png;base64,x'; },
    (record) => { delete record.root.images[0].id; },
  ];
  mutations.forEach((mutate) => {
    const malformed = clone(fixture);
    mutate(malformed.widget.props.reviews[0]);
    assert.equal(core.extractReviewsPageFromSsrData(malformed, fixture.itemId), null);
  });
});

test('preserves source order and verbatim SKU/date strings without page-size inference', () => {
  const relay = loadFixture('reviews-ssr-1005008195850531.json');
  const additional = loadFixture('reviews-ssr-additional-32882927175.json');
  const relayResult = core.extractReviewsPageFromSsrData(relay, relay.itemId);
  const additionalResult = core.extractReviewsPageFromSsrData(additional, additional.itemId);
  assert.deepEqual(relayResult.reviews.map((review) => review.id), ['relay-review-1', 'relay-review-2', 'relay-review-3', 'relay-review-4', 'relay-review-5']);
  assert.equal(relayResult.reviews.length, 5);
  assert.equal(additionalResult.reviews[0].skuProperties, 'express | EU plug | 3 hole 2usb 2.5M');
  assert.equal(additionalResult.reviews[0].additional.dateRaw, 'Added 16 June 2026');
  assert.equal(Object.hasOwn(additionalResult, 'pageSize'), false);
  assert.equal(Object.hasOwn(additionalResult, 'hasNext'), false);
});

test('reviews-page JSON export contains only the normalized safe model', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  fixture.widget.props.reviews[0].root.analyticEvents = { trackingInfo: { spm: 'secret-ish-tracking' } };
  fixture.widget.props.reviews[0].interaction.isLiked = true;
  const reviewPage = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  const text = core.exportReviewsPage(reviewPage);
  const exported = JSON.parse(text);
  assert.deepEqual(Object.keys(exported), ['itemId', 'source', 'reviews']);
  assert.equal(exported.itemId, fixture.itemId);
  assert.equal(exported.reviews.length, 10);
  assert.doesNotMatch(text, /analyticEvents|trackingInfo|isLiked|spm|secret-ish-tracking/);
  assert.equal(Object.hasOwn(exported.reviews[0].initial, 'effectiveRating'), false);
});

test('SSR review inspection reports success without changing the extracted page model', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const inspection = core.inspectReviewsPageFromSsrData(fixture, fixture.itemId);
  assert.equal(inspection.diagnostic, 'ok');
  assert.equal(inspection.reviewPage.reviews.length, 10);
  assert.deepEqual(core.extractReviewsPageFromSsrData(fixture, fixture.itemId), inspection.reviewPage);
});

test('SSR review inspection distinguishes safe failure diagnostics without raw details', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const malformed = clone(fixture);
  delete malformed.widget.props.reviews[0].root.id;
  const conflicting = clone(fixture.widget);
  conflicting.props.reviews[0].root.text = 'Synthetic conflict.';
  const cases = [
    [core.inspectReviewsPageFromSsrData(fixture, null), 'invalid-item-id'],
    [core.inspectReviewsPageFromSsrData(fixture, 'not-an-item-id'), 'invalid-item-id'],
    [core.inspectReviewsPageFromSsrData({ unrelated: true }, fixture.itemId), 'no-candidate'],
    [core.inspectReviewsPageFromSsrData(malformed, fixture.itemId), 'invalid-candidate'],
    [core.inspectReviewsPageFromSsrData({ one: fixture.widget, two: conflicting }, fixture.itemId), 'conflicting-candidates'],
    [core.inspectReviewsPageFromSsrData({ noise: [{}, {}, fixture.widget] }, fixture.itemId, { maxVisited: 1 }), 'traversal-limit'],
  ];
  cases.forEach(([inspection, expected]) => {
    assert.equal(inspection.reviewPage, null);
    assert.equal(inspection.diagnostic, expected);
    assert.deepEqual(Object.keys(inspection).sort(), ['diagnostic', 'reviewPage']);
  });
});

function nativeReviewBody(itemId, overrides = {}) {
  return {
    productKey: { id: itemId, sourceId: 0 },
    pagination: { pageNum: 2, pageSize: 10 },
    sort: 1,
    filters: [],
    skuFilter: [],
    ...overrides,
  };
}

function nativeReviewBatch(itemId, pageNum, reviews, context = {}) {
  return {
    itemId,
    source: 'native:product-reviews',
    context: { sort: 1, filters: [], skuFilter: [], pageSize: 10, ...context },
    pageNum,
    reviews,
  };
}

test('native review endpoint matcher is same-origin, exact-path, and query-opaque', () => {
  const base = 'https://aliexpress.ru/item/1005009452926938/reviews';
  const endpoint = 'https://aliexpress.ru/aer-jsonapi/review/v5/desktop/product-reviews';
  assert.equal(core.isNativeReviewEndpoint(`${endpoint}?_bx-v=opaque&anything=ignored`, base), true);
  assert.equal(core.isNativeReviewEndpoint('/aer-jsonapi/review/v5/desktop/product-reviews?x=1', base), true);
  assert.equal(core.isNativeReviewEndpoint(`${endpoint}/extra`, base), false);
  assert.equal(core.isNativeReviewEndpoint('https://www.aliexpress.ru/aer-jsonapi/review/v5/desktop/product-reviews', base), false);
  assert.equal(core.isNativeReviewEndpoint('https://example.com/aer-jsonapi/review/v5/desktop/product-reviews', base), false);
});

test('normalizes confirmed native review request contexts without mutating wire arrays', () => {
  const itemId = '1005009452926938';
  const filters = [2, 1, 2];
  const skuFilter = ['12000049151727541', '12000049151727537', '12000049151727537'];
  const normalized = core.normalizeNativeReviewRequest(nativeReviewBody(itemId, {
    pagination: { pageNum: 3, pageSize: 10 }, sort: 2, filters, skuFilter,
  }), itemId);
  assert.deepEqual(normalized, {
    itemId, sourceId: 0, pageNum: 3, pageSize: 10, sort: 2,
    filters: [2, 1, 2], skuFilter: ['12000049151727541', '12000049151727537', '12000049151727537'],
  });
  const context = core.canonicalizeReviewContext(normalized);
  assert.deepEqual(context, {
    sort: 2, filters: [1, 2], skuFilter: ['12000049151727537', '12000049151727541'], pageSize: 10,
  });
  assert.deepEqual(filters, [2, 1, 2]);
  assert.deepEqual(skuFilter, ['12000049151727541', '12000049151727537', '12000049151727537']);
});

test('native review request normalizer accepts passive schema drift but fails unsafe shapes closed', () => {
  const itemId = '1005009452926938';
  assert.equal(core.normalizeNativeReviewRequest(nativeReviewBody(itemId, { pagination: { pageNum: 1, pageSize: 25 }, sort: 17, filters: [0, 9] }), itemId).sort, 17);
  const invalid = [
    null,
    nativeReviewBody('999'),
    nativeReviewBody(itemId, { productKey: { id: itemId, sourceId: 0.5 } }),
    nativeReviewBody(itemId, { pagination: { pageNum: 0, pageSize: 10 } }),
    nativeReviewBody(itemId, { pagination: { pageNum: 1, pageSize: 101 } }),
    nativeReviewBody(itemId, { sort: '1' }),
    nativeReviewBody(itemId, { filters: [1, '2'] }),
    nativeReviewBody(itemId, { skuFilter: [12000049151727537] }),
    nativeReviewBody(itemId, { skuFilter: ['sku-blue'] }),
  ];
  invalid.forEach((body) => assert.equal(core.normalizeNativeReviewRequest(body, itemId), null));
});

test('normalizes native response through the existing review model and accepts a real empty envelope', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const raw = fixture.widget.props.reviews.slice(0, 2);
  const reviews = core.normalizeNativeReviewResponse({ data: { reviews: raw } }, fixture.itemId);
  assert.deepEqual(reviews, core.normalizeReviewCandidate(raw, fixture.itemId));
  assert.deepEqual(core.normalizeNativeReviewResponse({ data: { reviews: [] } }, fixture.itemId), []);
  assert.equal(core.normalizeNativeReviewResponse({}, fixture.itemId), null);
  assert.equal(core.normalizeNativeReviewResponse({ data: { reviews: {} } }, fixture.itemId), null);
  const malformed = clone(raw);
  delete malformed[0].root.id;
  assert.equal(core.normalizeNativeReviewResponse({ data: { reviews: malformed } }, fixture.itemId), null);
  assert.equal(core.normalizeNativeReviewResponse({ data: { reviews: raw } }, '999'), null);
});

test('native request and response combine into one raw-free canonical batch', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const body = nativeReviewBody(fixture.itemId, { filters: [2, 1, 2] });
  const batch = core.normalizeNativeReviewBatch(body, { data: { reviews: fixture.widget.props.reviews.slice(0, 1) } }, fixture.itemId);
  assert.deepEqual(Object.keys(batch), ['itemId', 'source', 'context', 'pageNum', 'reviews']);
  assert.equal(batch.source, 'native:product-reviews');
  assert.deepEqual(batch.context.filters, [1, 2]);
  assert.equal(JSON.stringify(batch).includes('_bx-v'), false);
});

test('passive review fetch wrapper is idempotent and preserves one native invocation and original arguments', async () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const responseJson = { data: { reviews: fixture.widget.props.reviews.slice(0, 1) } };
  let calls = 0;
  let receivedThis;
  let receivedArgs;
  const originalResponse = { clone: () => ({ json: async () => responseJson }) };
  const originalFetch = function (...args) {
    calls += 1;
    receivedThis = this;
    receivedArgs = args;
    return Promise.resolve(originalResponse);
  };
  const pageWindow = { fetch: originalFetch, location: { href: `https://aliexpress.ru/item/${fixture.itemId}/reviews` } };
  const batches = [];
  core.installNativeReviewInterceptor(pageWindow, fixture.itemId, (batch, sequence) => batches.push({ batch, sequence }));
  const wrapper = pageWindow.fetch;
  core.installNativeReviewInterceptor(pageWindow, fixture.itemId, () => assert.fail('double wrapper'));
  assert.equal(pageWindow.fetch, wrapper);
  const init = { method: 'POST', body: JSON.stringify(nativeReviewBody(fixture.itemId)), headers: { 'Content-Type': 'application/json' }, credentials: 'include', signal: { marker: true } };
  const url = 'https://aliexpress.ru/aer-jsonapi/review/v5/desktop/product-reviews?_bx-v=opaque';
  const returned = pageWindow.fetch(url, init);
  assert.equal(await returned, originalResponse);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(receivedThis, pageWindow);
  assert.equal(receivedArgs[0], url);
  assert.equal(receivedArgs[1], init);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].batch.pageNum, 2);
  assert.equal(batches[0].sequence, 1);
});

test('passive review interceptor assigns invocation sequences before reverse fetch completion', async () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const deferred = () => {
    let resolve;
    const promise = new Promise((accept) => { resolve = accept; });
    return { promise, resolve };
  };
  const first = deferred();
  const second = deferred();
  const responses = [first, second];
  let calls = 0;
  const pageWindow = {
    location: { href: `https://aliexpress.ru/item/${fixture.itemId}/reviews` },
    fetch(...args) {
      assert.equal(args.length, 2);
      const current = responses[calls];
      calls += 1;
      return current.promise;
    },
  };
  const callbacks = [];
  core.installNativeReviewInterceptor(pageWindow, fixture.itemId, (batch, sequence) => {
    callbacks.push({ pageNum: batch.pageNum, filters: batch.context.filters, sequence });
  });
  const endpoint = 'https://aliexpress.ru/aer-jsonapi/review/v5/desktop/product-reviews';
  const requestOne = pageWindow.fetch(endpoint, { body: JSON.stringify(nativeReviewBody(fixture.itemId)) });
  const requestTwo = pageWindow.fetch(endpoint, { body: JSON.stringify(nativeReviewBody(fixture.itemId, {
    pagination: { pageNum: 1, pageSize: 10 }, filters: [1],
  })) });
  const responseOne = { marker: 'one', clone: () => ({ json: async () => ({ data: { reviews: [] } }) }) };
  const responseTwo = { marker: 'two', clone: () => ({ json: async () => ({ data: { reviews: [] } }) }) };
  second.resolve(responseTwo);
  assert.equal(await requestTwo, responseTwo);
  await new Promise((resolve) => setImmediate(resolve));
  first.resolve(responseOne);
  assert.equal(await requestOne, responseOne);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.deepEqual(callbacks, [
    { pageNum: 1, filters: [1], sequence: 2 },
    { pageNum: 2, filters: [], sequence: 1 },
  ]);
});

test('passive review wrapper leaves unrelated and malformed traffic harmless', async () => {
  let calls = 0;
  let nextJson = { malformed: true };
  const response = { clone: () => ({ json: async () => nextJson }) };
  const pageWindow = {
    location: { href: 'https://aliexpress.ru/item/100/reviews' },
    fetch: async () => { calls += 1; return response; },
  };
  let callbacks = 0;
  core.installNativeReviewInterceptor(pageWindow, '100', () => { callbacks += 1; throw new Error('callback failure'); });
  assert.equal(await pageWindow.fetch('https://aliexpress.ru/other', { body: 'not json' }), response);
  assert.equal(await pageWindow.fetch('https://aliexpress.ru/aer-jsonapi/review/v5/desktop/product-reviews', { body: '{' }), response);
  nextJson = { data: { reviews: [] } };
  assert.equal(await pageWindow.fetch('https://aliexpress.ru/aer-jsonapi/review/v5/desktop/product-reviews', { body: JSON.stringify(nativeReviewBody('100')) }), response);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 3);
  assert.equal(callbacks, 1);
});

test('review cache seeds SSR, merges default pages through cap, and ignores page four', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const ssrPage = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  const page1 = ssrPage.reviews;
  const page2 = page1.map((review, index) => ({ ...review, id: `page-2-${index}` }));
  const page3 = page1.map((review, index) => ({ ...review, id: `page-3-${index}` }));
  const page4 = page1.map((review, index) => ({ ...review, id: `page-4-${index}` }));
  let cache = core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage);
  let active = core.getActiveReviewPage(cache);
  assert.equal(active.source, 'ssr:__AER_DATA__');
  assert.equal(active.loadedCount, 10);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, page2));
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 3, page3));
  active = core.getActiveReviewPage(cache);
  assert.equal(active.loadedCount, 30);
  assert.deepEqual(active.pagesLoaded, [1, 2, 3]);
  assert.equal(active.captureCapReached, true);
  const beforePage4 = active.reviews;
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 4, page4));
  active = core.getActiveReviewPage(cache);
  assert.deepEqual(active.pagesLoaded, [1, 2, 3]);
  assert.deepEqual(active.reviews, beforePage4);
  assert.equal(active.captureCapReached, true);
});

test('page-slot cap admission is independent of out-of-order response application', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const ssrPage = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  const makePage = (pageNum) => ssrPage.reviews.map((review, index) => ({ ...review, id: `slot-${pageNum}-${index}` }));
  let cache = core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 3, makePage(3)), 1);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 4, makePage(4)), 2);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, makePage(2)), 3);
  const active = core.getActiveReviewPage(cache);
  assert.deepEqual(active.pagesLoaded, [1, 2, 3]);
  assert.equal(active.loadedCount, 30);
  assert.equal(active.captureCapReached, true);
  assert.equal(Object.hasOwn(active, 'diagnostic'), false);
  const entry = cache.contexts.get(cache.activeContextKey);
  assert.equal(entry.pages.has(4), false);
  assert.equal(entry.ignoredBeyondCap, true);

  let pageFourFirst = core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage);
  pageFourFirst = core.applyNativeReviewBatch(pageFourFirst, nativeReviewBatch(fixture.itemId, 4, makePage(4)), 1);
  pageFourFirst = core.applyNativeReviewBatch(pageFourFirst, nativeReviewBatch(fixture.itemId, 2, makePage(2)), 2);
  pageFourFirst = core.applyNativeReviewBatch(pageFourFirst, nativeReviewBatch(fixture.itemId, 3, makePage(3)), 3);
  assert.deepEqual(core.getActiveReviewPage(pageFourFirst).pagesLoaded, [1, 2, 3]);
  assert.equal(core.getActiveReviewPage(pageFourFirst).loadedCount, 30);
});

test('page-slot policy admits only complete nominal pages inside the capture window', () => {
  assert.equal(core.isReviewPageWithinCaptureCap(1, 100, 30), true);
  assert.equal(core.isReviewPageWithinCaptureCap(2, 100, 30), false);
  assert.equal(core.isReviewPageWithinCaptureCap(4, 7, 30), true);
  assert.equal(core.isReviewPageWithinCaptureCap(5, 7, 30), false);
  assert.equal(core.isReviewPageWithinCaptureCap(3, 10, 30), true);
  assert.equal(core.isReviewPageWithinCaptureCap(4, 10, 30), false);
});

test('late older-context response is cached without stealing active context', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const ssrPage = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  const defaultPage2 = ssrPage.reviews.slice(0, 2).map((review, index) => ({ ...review, id: `late-default-${index}` }));
  const photosPage1 = ssrPage.reviews.slice(0, 1);
  let cache = core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 1, photosPage1, { filters: [1] }), 2);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, defaultPage2), 1);
  const active = core.getActiveReviewPage(cache);
  assert.deepEqual(active.context.filters, [1]);
  assert.equal(active.loadedCount, 1);
  assert.equal(cache.activeSequence, 2);
  const defaultKey = core.createReviewContextKey(fixture.itemId, { sort: 1, filters: [], skuFilter: [], pageSize: 10 });
  assert.deepEqual([...cache.contexts.get(defaultKey).pages.keys()].sort(), [1, 2]);

  let ordinary = core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage);
  ordinary = core.applyNativeReviewBatch(ordinary, nativeReviewBatch(fixture.itemId, 2, defaultPage2), 1);
  ordinary = core.applyNativeReviewBatch(ordinary, nativeReviewBatch(fixture.itemId, 1, photosPage1, { filters: [1] }), 2);
  assert.deepEqual(core.getActiveReviewPage(ordinary).context.filters, [1]);
});

test('empty newer context remains active after a late older response', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const ssrPage = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  const defaultPage2 = ssrPage.reviews.slice(0, 1).map((review) => ({ ...review, id: 'late-after-empty' }));
  let cache = core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 1, [], { filters: [1, 2] }), 2);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, defaultPage2), 1);
  const active = core.getActiveReviewPage(cache);
  assert.deepEqual(active.context.filters, [1, 2]);
  assert.deepEqual(active.reviews, []);
  assert.equal(active.loadedCount, 0);
});

test('review cache is page-stable, rejects conflicts, and restores preserved contexts', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const ssrPage = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  let cache = core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage);
  const defaultPage2 = ssrPage.reviews.slice(0, 2).map((review, index) => ({ ...review, id: `default-2-${index}` }));
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, defaultPage2));
  const stable = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, defaultPage2));
  assert.equal(stable, cache);
  const conflicting = clone(defaultPage2);
  conflicting[0].initial.text = 'Conflict';
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, conflicting));
  assert.equal(core.getActiveReviewPage(cache).diagnostic, 'page-conflict');
  const photos = nativeReviewBatch(fixture.itemId, 1, ssrPage.reviews.slice(0, 1), { filters: [1] });
  cache = core.applyNativeReviewBatch(cache, photos);
  assert.deepEqual(core.getActiveReviewPage(cache).context.filters, [1]);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, defaultPage2));
  assert.deepEqual(core.getActiveReviewPage(cache).pagesLoaded, [1, 2]);
});

test('review cache keeps sort, SKU, Additional, and empty combined contexts independent', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const reviews = core.normalizeReviewCandidate(fixture.widget.props.reviews.slice(0, 1), fixture.itemId);
  let cache = core.createReviewCache(fixture.itemId);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 1, reviews, { sort: 2 }));
  const sortKey = cache.activeContextKey;
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 1, reviews, { skuFilter: ['12000049151727541', '12000049151727537'] }));
  const skuKey = cache.activeContextKey;
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 1, reviews, { filters: [2] }));
  const additionalKey = cache.activeContextKey;
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 1, [], { filters: [2, 1] }));
  const active = core.getActiveReviewPage(cache);
  assert.equal(cache.contexts.size, 4);
  assert.notEqual(sortKey, skuKey);
  assert.notEqual(skuKey, additionalKey);
  assert.deepEqual(active.context.filters, [1, 2]);
  assert.equal(active.loadedCount, 0);
  assert.deepEqual(active.reviews, []);
  const stableEmpty = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 1, [], { filters: [2, 1] }));
  assert.equal(stableEmpty, cache);
  const emptyConflict = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 1, reviews, { filters: [1, 2] }));
  assert.equal(core.getActiveReviewPage(emptyConflict).diagnostic, 'page-conflict');
  assert.deepEqual(core.getActiveReviewPage(emptyConflict).reviews, []);
});

test('cross-page review dedupe keeps identical records, fails conflicts, and keeps equal text with distinct IDs', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const records = core.normalizeReviewCandidate(fixture.widget.props.reviews.slice(0, 2), fixture.itemId);
  let cache = core.createReviewCache(fixture.itemId);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 1, records));
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, [records[0], { ...records[0], id: 'same-content-different-id' }]));
  assert.equal(core.getActiveReviewPage(cache).loadedCount, 3);
  const conflict = clone(records[0]);
  conflict.initial.text = 'Cross-page conflict';
  let conflictCache = core.createReviewCache(fixture.itemId);
  conflictCache = core.applyNativeReviewBatch(conflictCache, nativeReviewBatch(fixture.itemId, 1, records));
  conflictCache = core.applyNativeReviewBatch(conflictCache, nativeReviewBatch(fixture.itemId, 2, [conflict]));
  const conflicted = core.getActiveReviewPage(conflictCache);
  assert.equal(conflicted.diagnostic, 'review-conflict');
  assert.deepEqual(conflicted.reviews, []);
});

test('review merge with a page gap exports only the contiguous prefix until the gap is filled', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const records = core.normalizeReviewCandidate(fixture.widget.props.reviews.slice(0, 1), fixture.itemId);
  let cache = core.createReviewCache(fixture.itemId);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 1, records));
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 3, [{ ...records[0], id: 'page-3' }]));
  let active = core.getActiveReviewPage(cache);
  assert.deepEqual(active.pagesLoaded, [1, 3]);
  assert.equal(active.loadedCount, 1);
  assert.equal(active.diagnostic, 'page-gap');
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, [{ ...records[0], id: 'page-2' }]));
  active = core.getActiveReviewPage(cache);
  assert.deepEqual(active.pagesLoaded, [1, 2, 3]);
  assert.equal(active.loadedCount, 3);
  assert.equal(Object.hasOwn(active, 'diagnostic'), false);
});

test('active reviews export exposes context/cap metadata without raw network fields', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const ssrPage = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  let cache = core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage);
  cache = core.applyNativeReviewBatch(cache, nativeReviewBatch(fixture.itemId, 2, ssrPage.reviews.slice(0, 1)));
  const text = core.exportReviewsPage(core.getActiveReviewPage(cache));
  const exported = JSON.parse(text);
  assert.deepEqual(Object.keys(exported), ['itemId', 'source', 'context', 'pagesLoaded', 'loadedCount', 'captureCap', 'captureCapReached', 'reviews']);
  assert.equal(exported.source, 'ssr+native');
  assert.doesNotMatch(text, /raw request|raw response|_bx-v|headers|analyticEvents|trackingInfo|isLiked|spm/);
});

test('reviews ChatGPT formatter has deterministic full-string layout and multiline indentation', () => {
  const reviewPage = {
    itemId: '123', source: 'native:product-reviews',
    context: { sort: 2, filters: [1], skuFilter: ['10'], pageSize: 10 },
    pagesLoaded: [1], loadedCount: 1, captureCap: 30, captureCapReached: false,
    reviews: [{
      id: 'private-review-id', productId: '123', skuProperties: null,
      reviewer: { displayName: 'Private Reviewer', initials: 'PR', avatarUrl: 'https://fixtures.invalid/avatar.png', countryFlagUrl: 'https://fixtures.invalid/flag.svg' },
      initial: {
        dateRaw: null, grade: null, text: 'Line one\nLine two', originalText: null,
        images: [{ id: 'private-image-id', url: 'https://fixtures.invalid/image.jpg' }],
        comments: [
          { id: 'comment-1', authorDisplayName: 'Author 1', authorInitials: 'A1', authorAvatarUrl: null, dateRaw: 'Day 1', text: 'Reply one', originalText: null },
          { id: 'comment-2', authorDisplayName: 'Author 2', authorInitials: 'A2', authorAvatarUrl: null, dateRaw: 'Day 2', text: null, originalText: 'Original reply\nsecond line' },
          { id: 'comment-3', authorDisplayName: 'Author 3', authorInitials: 'A3', authorAvatarUrl: null, dateRaw: 'Day 3', text: 'Hidden reply', originalText: null },
        ],
      },
      additional: {
        id: 'private-follow-up-id', dateRaw: 'Later', grade: 4, text: null, originalText: null,
        images: [], comments: [],
      },
      likesAmount: 0,
    }],
  };
  assert.equal(core.formatReviewsForChatGPT(reviewPage), [
    'ALIEXPRESS REVIEWS',
    '',
    'Item ID: 123',
    'Source: passive native',
    '',
    'Context:',
    'Sort: New reviews first',
    'Filters: With photos',
    'SKU filter: 1 IDs',
    'Page size: 10',
    '',
    'Pages: 1',
    'Captured: 1 reviews',
    'Capture cap: 30',
    'Cap reached: no',
    'Diagnostic: —',
    'Sample: first 1 of 1',
    '',
    'Review 1',
    'SKU: —',
    'Likes: 0',
    '',
    'Initial:',
    'Date: —',
    'Rating: null',
    'Displayed text:',
    '  Line one',
    '  Line two',
    'Images: 1',
    'Comments: 3 (showing first 2)',
    'Comment 1:',
    'Date: Day 1',
    'Displayed text:',
    '  Reply one',
    'Comment 2:',
    'Date: Day 2',
    'Original text:',
    '  Original reply',
    '  second line',
    '',
    'Follow-up:',
    'Date: Later',
    'Rating: 4',
    'Text: none',
    'Images: 0',
    'Comments: 0',
  ].join('\n'));
});

test('Relay SSR ChatGPT export reports default context, five reviews, null text, zero likes, and no follow-ups', () => {
  const fixture = loadFixture('reviews-ssr-1005008195850531.json');
  const ssrPage = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  const active = core.getActiveReviewPage(core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage));
  const text = core.formatReviewsForChatGPT(active);
  assert.match(text, /^ALIEXPRESS REVIEWS\n\n/);
  assert.match(text, new RegExp(`Item ID: ${fixture.itemId}`));
  assert.match(text, /Source: SSR/);
  assert.match(text, /Sort: Top reviews\nFilters: All\nSKU filter: none\nPage size: 10/);
  assert.match(text, /Captured: 5 reviews/);
  assert.match(text, /Sample: first 5 of 5/);
  assert.equal((text.match(/^Review \d+$/gm) || []).length, 5);
  assert.match(text, /Likes: 0/);
  assert.ok((text.match(/Text: none/g) || []).length >= 1);
  assert.equal((text.match(/Follow-up: none/g) || []).length, 5);
});

test('Dress ChatGPT export samples first five of twenty in normalized merged order and honors sampleSize', () => {
  const ssrFixture = loadFixture('reviews-ssr-1005009452926938.json');
  const nativeFixture = loadFixture('reviews-native-page2-1005009452926938.json');
  const ssrPage = core.extractReviewsPageFromSsrData(ssrFixture, ssrFixture.itemId);
  let cache = core.seedReviewCacheFromSsr(core.createReviewCache(ssrFixture.itemId), ssrPage);
  const batch = core.normalizeNativeReviewBatch(nativeFixture.request.body, nativeFixture.response, nativeFixture.itemId);
  cache = core.applyNativeReviewBatch(cache, batch);
  const active = core.getActiveReviewPage(cache);
  const text = core.formatReviewsForChatGPT(active);
  assert.equal(active.loadedCount, 20);
  assert.match(text, /Sample: first 5 of 20/);
  assert.equal((text.match(/^Review \d+$/gm) || []).length, 5);
  ssrPage.reviews.slice(0, 5).forEach((review) => assert.match(text, new RegExp(review.initial.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  assert.doesNotMatch(text, /Translated dress review D6\./);
  const two = core.formatReviewsForChatGPT(active, { sampleSize: 2 });
  assert.match(two, /Sample: first 2 of 20/);
  assert.equal((two.match(/^Review \d+$/gm) || []).length, 2);
  assert.match(core.formatReviewsForChatGPT(active, { sampleSize: 0 }), /Sample: first 1 of 20/);
  assert.match(core.formatReviewsForChatGPT(active, { sampleSize: 99 }), /Sample: first 20 of 20/);
  assert.match(core.formatReviewsForChatGPT(active, { sampleSize: '2' }), /Sample: first 5 of 20/);
});

test('Dress ChatGPT export keeps useful review content while excluding identity, IDs, and URL noise', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const ssrPage = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  const active = core.getActiveReviewPage(core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage));
  const sample = active.reviews.slice(0, 5);
  const text = core.formatReviewsForChatGPT(active);
  sample.forEach((review) => {
    [review.id, review.reviewer.displayName, review.reviewer.initials, review.reviewer.avatarUrl, review.reviewer.countryFlagUrl]
      .filter(Boolean).forEach((value) => assert.equal(text.includes(value), false));
    review.initial.images.forEach((image) => {
      assert.equal(text.includes(image.id), false);
      assert.equal(text.includes(image.url), false);
    });
    review.initial.comments.forEach((comment) => {
      [comment.id, comment.authorDisplayName, comment.authorInitials, comment.authorAvatarUrl]
        .filter(Boolean).forEach((value) => assert.equal(text.includes(value), false));
      if (comment.text !== null) assert.ok(text.includes(comment.text));
      if (comment.originalText !== null) assert.ok(text.includes(comment.originalText));
    });
    assert.ok(text.includes(`SKU: ${review.skuProperties ?? '—'}`));
    assert.ok(text.includes(`Rating: ${review.initial.grade}`));
    assert.ok(text.includes(`Likes: ${review.likesAmount}`));
    assert.ok(text.includes(`Images: ${review.initial.images.length}`));
    if (review.initial.text !== null) assert.ok(text.includes(review.initial.text));
    if (review.initial.originalText !== null) assert.ok(text.includes(review.initial.originalText));
  });
  assert.match(text, /Displayed text:\n  Translated dress review D1\.\nOriginal text:\n  Original dress review D1\./);
  assert.doesNotMatch(text, /_bx-v|https?:\/\//);
});

test('real Additional context exports distinct initial and follow-up semantics without effective fields', () => {
  const fixture = loadFixture('reviews-native-additional-32882927175.json');
  let cache = core.createReviewCache(fixture.itemId);
  const batch = core.normalizeNativeReviewBatch(fixture.request.body, fixture.response, fixture.itemId);
  cache = core.applyNativeReviewBatch(cache, batch);
  const text = core.formatReviewsForChatGPT(core.getActiveReviewPage(cache));
  assert.match(text, /Filters: Additional/);
  assert.match(text, /Initial:\nDate: [^\n]+\nRating: 5[\s\S]*?Follow-up:\nDate: [^\n]+\nRating: 4/);
  assert.match(text, /Initial:\nDate: [^\n]+\nRating: 5[\s\S]*?Follow-up:\nDate: [^\n]+\nRating: 2/);
  assert.match(text, /Follow-up:\nDate: [^\n]+\nRating: null/);
  assert.match(text, /Initial:\nDate: [^\n]+\nRating: 5\nText: none[\s\S]*?Follow-up:[\s\S]*?Displayed text:/);
  assert.match(text, /Initial:[\s\S]*?Images: 0[\s\S]*?Follow-up:[\s\S]*?Images: 1/);
  assert.doesNotMatch(text, /effectiveRating|latestRating|averageRating|effectiveText/i);
  fixture.response.data.reviews.forEach((raw) => {
    [raw.root.id, raw.additional.id, raw.reviewer.name, raw.reviewer.avatar, raw.reviewer.countryFlag]
      .filter(Boolean).forEach((value) => assert.equal(text.includes(String(value)), false));
  });
});

test('empty combined context and unknown codes remain explicit and deterministic', () => {
  const fixture = loadFixture('reviews-native-contexts-1005009452926938.json');
  const capture = fixture.captures.photosAdditional;
  let cache = core.createReviewCache(fixture.itemId);
  cache = core.applyNativeReviewBatch(cache, core.normalizeNativeReviewBatch(capture.body, capture.response, fixture.itemId));
  const emptyText = core.formatReviewsForChatGPT(core.getActiveReviewPage(cache));
  assert.match(emptyText, /Filters: With photos \+ Additional/);
  assert.match(emptyText, /Captured: 0 reviews/);
  assert.match(emptyText, /Sample: none$/);
  assert.doesNotMatch(emptyText, /^Review 1$/m);
  const unknown = {
    ...core.getActiveReviewPage(cache),
    context: { sort: 7, filters: [1, 9], skuFilter: [], pageSize: 10 },
  };
  const unknownText = core.formatReviewsForChatGPT(unknown);
  assert.match(unknownText, /Sort: Sort 7/);
  assert.match(unknownText, /Filters: With photos \+ Filter 9/);
});

test('reviews ChatGPT formatter exposes non-contiguous pages and safe diagnostics without re-merging', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const review = core.normalizeReviewCandidate(fixture.widget.props.reviews.slice(0, 1), fixture.itemId)[0];
  const text = core.formatReviewsForChatGPT({
    itemId: fixture.itemId, source: 'ssr+native',
    context: { sort: 1, filters: [], skuFilter: [], pageSize: 10 },
    pagesLoaded: [1, 3], loadedCount: 1, captureCap: 30, captureCapReached: false,
    diagnostic: 'page-gap', reviews: [review],
  });
  assert.match(text, /Source: SSR \+ passive native/);
  assert.match(text, /Pages: 1, 3/);
  assert.match(text, /Diagnostic: page-gap/);
  assert.match(text, /Sample: first 1 of 1/);
});

test('normalized reviews JSON export remains full fidelity while ChatGPT export is privacy-minimized', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const ssrPage = core.extractReviewsPageFromSsrData(fixture, fixture.itemId);
  const active = core.getActiveReviewPage(core.seedReviewCacheFromSsr(core.createReviewCache(fixture.itemId), ssrPage));
  const exported = JSON.parse(core.exportReviewsPage(active));
  assert.equal(exported.reviews[0].id, active.reviews[0].id);
  assert.deepEqual(exported.reviews[0].reviewer, active.reviews[0].reviewer);
  assert.deepEqual(exported.reviews[0].initial.images, active.reviews[0].initial.images);
  assert.deepEqual(exported.reviews[0].initial.comments, active.reviews[0].initial.comments);
  const aiText = core.formatReviewsForChatGPT(active);
  assert.equal(aiText.includes(active.reviews[0].id), false);
  assert.equal(aiText.includes(active.reviews[0].reviewer.displayName), false);
  assert.equal(aiText.includes(active.reviews[0].initial.images[0].url), false);
  assert.equal(Object.hasOwn(exported, '_meta'), false);
  assert.doesNotMatch(aiText, /Data status:|completeness/i);
});

test('review status humanizes only confirmed sort/filter codes and reports passive capture', () => {
  const status = core.formatReviewsPageStatus({
    source: 'native:product-reviews', loadedCount: 0, pagesLoaded: [1], captureCap: 30, captureCapReached: false,
    context: { sort: 7, filters: [1, 2, 9], skuFilter: ['1', '2'], pageSize: 10 },
  });
  assert.match(status, /Sort 7/);
  assert.match(status, /With photos/);
  assert.match(status, /Additional/);
  assert.match(status, /Filter 9/);
  assert.match(status, /SKU filter · 2 IDs/);
  assert.match(status, /retention cap: 30/);
  assert.match(status, /passive native/);
  assert.doesNotMatch(status, /loaded by Ali Helper/i);
});

test('real native Dress page-2 fixture preserves the confirmed request and ten compatible records', () => {
  const fixture = loadFixture('reviews-native-page2-1005009452926938.json');
  assert.equal(fixture.sourceKind, 'minimized sanitized derivative of live native fetch capture');
  assert.equal(fixture.capturedAt, '2026-08-13');
  assert.equal(fixture.sanitized, true);
  assert.equal(fixture.request.method, 'POST');
  assert.equal(fixture.request.pathname, '/aer-jsonapi/review/v5/desktop/product-reviews');
  assert.deepEqual(core.normalizeNativeReviewRequest(fixture.request.body, fixture.itemId), {
    itemId: fixture.itemId, sourceId: 0, pageNum: 2, pageSize: 10, sort: 1, filters: [], skuFilter: [],
  });
  const reviews = core.normalizeNativeReviewResponse(fixture.response, fixture.itemId);
  assert.equal(reviews.length, 10);
  assert.deepEqual(reviews.map((review) => review.id), fixture.response.data.reviews.map((review) => review.root.id));
  assert.equal(reviews[5].initial.text, null);
  assert.doesNotMatch(JSON.stringify(fixture), /_bx-v|analyticEvents|trackingInfo|isLiked|spm/);
});

test('real native context fixture covers page3, Photos, combined empty, SKU, sort2, and independent Needles', () => {
  const fixture = loadFixture('reviews-native-contexts-1005009452926938.json');
  const { captures } = fixture;
  assert.equal(core.normalizeNativeReviewRequest(captures.page3.body, fixture.itemId).pageNum, 3);
  assert.equal(captures.page3.responseReviewCount, 10);
  assert.deepEqual(core.normalizeNativeReviewRequest(captures.photos.body, fixture.itemId).filters, [1]);
  assert.equal(captures.photos.responseReviewCount, 10);
  assert.equal(captures.photos.observedRootImageCounts.every((count) => count > 0), true);
  assert.deepEqual(core.normalizeNativeReviewRequest(captures.photosAdditional.body, fixture.itemId).filters, [1, 2]);
  assert.deepEqual(core.normalizeNativeReviewResponse(captures.photosAdditional.response, fixture.itemId), []);
  assert.deepEqual(core.normalizeNativeReviewRequest(captures.navyBlueSku.body, fixture.itemId).skuFilter, [
    '12000049151727537', '12000049151727538', '12000049151727539', '12000049151727540', '12000049151727541',
  ]);
  assert.equal(core.normalizeNativeReviewRequest(captures.newReviews.body, fixture.itemId).sort, 2);
  const needles = core.normalizeNativeReviewRequest(nativeReviewBody('1005005933779962'), '1005005933779962');
  assert.equal(needles.itemId, '1005005933779962');
  assert.equal(needles.pageNum, 2);
});

test('real native Additional fixture preserves independent lower/null grades and follow-up-only content', () => {
  const fixture = loadFixture('reviews-native-additional-32882927175.json');
  assert.equal(fixture.originalReviewCount, 10);
  assert.equal(fixture.retainedReviewCount, 4);
  assert.deepEqual(core.normalizeNativeReviewRequest(fixture.request.body, fixture.itemId).filters, [2]);
  const reviews = core.normalizeNativeReviewResponse(fixture.response, fixture.itemId);
  assert.equal(reviews.length, 4);
  assert.equal(reviews[0].initial.grade, 5);
  assert.equal(reviews[0].additional.grade, 4);
  assert.equal(reviews[1].initial.grade, 5);
  assert.equal(reviews[1].additional.grade, 2);
  assert.equal(reviews[2].additional.grade, null);
  assert.equal(reviews[3].initial.text, null);
  assert.notEqual(reviews[3].additional.text, null);
  assert.equal(reviews[1].initial.images.length, 0);
  assert.equal(reviews[1].additional.images.length, 1);
  assert.equal(reviews.every((review) => review.additional.comments.length === 0), true);
  assert.equal(reviews.every((review) => !Object.hasOwn(review, 'effectiveRating') && !Object.hasOwn(review, 'effectiveText')), true);
});

test('Photos request context never becomes a response-content validator', () => {
  const fixture = loadFixture('reviews-native-additional-32882927175.json');
  const additionalOnlyPhoto = clone(fixture.response.data.reviews[1]);
  assert.equal(additionalOnlyPhoto.root.images.length, 0);
  assert.equal(additionalOnlyPhoto.additional.images.length, 1);
  const batch = core.normalizeNativeReviewBatch(
    nativeReviewBody(fixture.itemId, { pagination: { pageNum: 1, pageSize: 10 }, filters: [1] }),
    { data: { reviews: [additionalOnlyPhoto] } },
    fixture.itemId,
  );
  assert.ok(batch);
  assert.deepEqual(batch.context.filters, [1]);
  assert.equal(batch.reviews[0].initial.images.length, 0);
  assert.equal(batch.reviews[0].additional.images.length, 1);
});
