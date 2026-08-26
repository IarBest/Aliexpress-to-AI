'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nested(value, wrapperCount) {
  let result = value;
  for (let index = 0; index < wrapperCount; index += 1) result = { next: result };
  return result;
}

function assertSection(actual, state, sources = [], diagnostic = null) {
  assert.deepEqual(actual, { state, sources, diagnostic });
}

function asObservation(inspection, valueKey) {
  return {
    value: inspection[valueKey],
    diagnostic: inspection.diagnostic,
    observed: true,
  };
}

function syntheticProduct(itemId) {
  return core.normalizeProduct(
    { id: itemId, activeSkuId: null, skuInfo: { propertyList: [], priceList: [] } },
    `https://aliexpress.ru/item/${itemId}.html`,
  );
}

function syntheticCharacteristicsDom(rows) {
  const items = rows.map((row) => ({
    querySelector(selector) {
      if (selector.includes('ProductCharacteristicsItem__name__')) return { textContent: row.name };
      if (selector.includes('ProductCharacteristicsItem__value__')) return { textContent: row.value };
      return null;
    },
  }));
  const boundary = {
    querySelectorAll(selector) {
      return selector.includes('HazeProductCharacteristics__itemForSku') ? items : [];
    },
  };
  return {
    boundary,
    querySelectorAll(selector) {
      return selector.includes('HazeProductCharacteristics__groupsContainerForSku') ? [boundary] : [];
    },
  };
}

function syntheticCharacteristicsBoundaries(...doms) {
  return {
    querySelectorAll(selector) {
      return selector.includes('HazeProductCharacteristics__groupsContainerForSku')
        ? doms.map((dom) => dom.boundary)
        : [];
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
      const attributePattern = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      let match;
      while ((match = attributePattern.exec(opening[2]))) {
        if (match[1] !== '/') attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
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
      return !options.missing && selector === '#content_anchor' ? boundary : null;
    },
  };
}

function syntheticRatingDom(values) {
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
    querySelector(selector) {
      if (selector === 'h1') return textNode('Product');
      if (selector.includes('HazeProductDescription__extraInfo')) return extraInfo;
      return null;
    },
  };
  return {
    querySelectorAll(selector) {
      return selector.includes('HazeProductDescription__root') ? [productRoot] : [];
    },
  };
}

function syntheticReviewSummaryDom(fixture) {
  const observation = fixture.dom;
  const textNode = (text) => ({ innerText: text, textContent: text, children: [] });
  const gradeRows = observation.gradeRows.map((row) => ({
    querySelectorAll(selector) {
      if (selector.includes('StarGroup__starActive__')) return Array.from({ length: row.activeStars });
      if (selector.includes('StarGroup__star__')) return Array.from({ length: row.totalStars });
      return [];
    },
  }));
  const gradeGroup = {
    querySelectorAll(selector) {
      return selector.includes('Grades__gradeWrapper__') ? gradeRows : [];
    },
  };
  const countGroup = { children: observation.countRows.map((row) => textNode(row.text)) };
  const ratingRoot = {
    querySelector(selector) {
      if (selector.includes('AdditionalSection__gradeCount__')) return countGroup;
      if (selector.includes('AdditionalSection__grade__')) return gradeGroup;
      return null;
    },
  };
  const photoWrapper = observation.buyerPhotos && {
    querySelectorAll(selector) {
      if (selector !== '*') return [];
      return [
        textNode(observation.buyerPhotos.heading),
        textNode(observation.buyerPhotos.display),
      ];
    },
  };
  const topicNodes = (observation.topics?.topics || []).map((topic) => ({
    className: topic.className,
    querySelector(selector) {
      if (selector.includes('Tag__tagText__')) return textNode(topic.text);
      if (selector.includes('Tag__counter__')) return textNode(topic.count);
      return null;
    },
  }));
  const topicWrapper = observation.topics && {
    querySelectorAll(selector) {
      if (selector === '*') return [textNode(observation.topics.heading)];
      return selector.includes('Tag__tag__') ? topicNodes : [];
    },
  };
  const boundary = {
    querySelector(selector) {
      if (selector.includes('RedReviewsTabs__desktop__')) return {};
      if (selector.includes('MainSection__mainSection__')) return ratingRoot;
      if (selector.includes('RedReviewsGallery__defaultWrapper__')) return photoWrapper;
      return null;
    },
    querySelectorAll(selector) {
      return selector.includes('RedReviewsTags__tagsWrapper__') && topicWrapper ? [topicWrapper] : [];
    },
  };
  const anchor = { parentElement: boundary };
  return {
    querySelector(selector) {
      return selector === '#reviews_anchor' ? anchor : null;
    },
  };
}

function syntheticStoreDom(fixture, options = {}) {
  const anchor = (href) => ({
    href,
    getAttribute(name) { return name === 'href' ? href : null; },
  });
  const storeAnchor = anchor(fixture.header.storeHref);
  const chatAnchor = anchor(options.chatHref ?? fixture.chat.href);
  const title = {
    innerText: options.empty ? '' : fixture.header.title.text,
    textContent: options.empty ? '' : fixture.header.title.text,
    closest(selector) { return selector === 'a[href]' ? storeAnchor : null; },
  };
  const stats = options.empty ? [] : fixture.header.stats.map((stat) => ({ innerText: stat.text, textContent: stat.text }));
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
    querySelector(selector) {
      if (selector === '[data-testid="store_header"]') return header;
      if (selector === '[data-testid="seller_chat_btn"]') return options.empty ? null : chatButton;
      return null;
    },
  };
  return {
    querySelector(selector) {
      return selector === '#storeInfo' && !options.missing ? boundary : null;
    },
  };
}

function ratingCandidate(itemId, rating, reviewCount) {
  return {
    props: {
      analyticEvents: {
        clickAllReviews: { trackingInfo: { itemId, overallRating: rating } },
        viewWidgetReview: { trackingInfo: { itemId, overallRating: rating } },
      },
      resolveParams: { 'review.productReviewsCount': reviewCount },
    },
  };
}

function galleryCandidate(label, itemId) {
  const url = `https://example.com/${label}.jpg`;
  return { props: { id: itemId, gallery: [{ imageUrl: url, previewUrl: url, videoUrl: null }] } };
}

test('section diagnostic contract orders and allowlists semantic sources without leaking raw provenance', () => {
  assert.equal(Object.isFrozen(core.SECTION_SOURCE_ORDER), true);
  assert.deepEqual(core.SECTION_SOURCE_ORDER, [
    'productData',
    'ssr:__AER_DATA__',
    'dom:product-header',
    'dom:review-section',
    'dom:store',
    'dom:characteristics',
    'dom:description',
    'native:shipping-calculate',
  ]);

  const present = core.createSectionDiagnostic('present', [
    'dom:store',
    'https://aliexpress.ru/path?_bx-v=secret&spm=tracking&token=value',
    'productData',
    'dom:store',
    'authorization',
  ]);
  assertSection(present, 'present', ['productData', 'dom:store']);
  assertSection(core.createSectionDiagnostic('missing', 'dom:description'), 'missing', ['dom:description']);
  assertSection(core.createSectionDiagnostic('not-observed'), 'not-observed');
  assertSection(
    core.createSectionDiagnostic('invalid', ['ssr:__AER_DATA__'], 'schema-mismatch'),
    'invalid',
    ['ssr:__AER_DATA__'],
    'schema-mismatch',
  );
  assert.throws(() => core.createSectionDiagnostic('unknown'));
  assert.throws(
    () => core.createSectionDiagnostic('present'),
    /present section diagnostics require a semantic source/i,
  );
  assert.throws(() => core.createSectionDiagnostic('present', [], 'conflict'));
  assert.throws(() => core.createSectionDiagnostic('invalid', [], 'unknown'));

  assertSection(core.sectionDiagnosticFromObservations([
    core.createSectionObservation('dom:store', { name: 'DOM' }),
    core.createSectionObservation('ssr:__AER_DATA__', { name: 'SSR' }),
    core.createSectionObservation('dom:store', { name: 'duplicate' }),
  ], true), 'present', ['ssr:__AER_DATA__', 'dom:store']);
  assertSection(core.sectionDiagnosticFromObservations([
    core.createSectionObservation('dom:description', null),
  ], false), 'missing', ['dom:description']);
  assertSection(core.sectionDiagnosticFromObservations([
    core.createSectionObservation('native:shipping-calculate', null, null, false),
  ], false), 'not-observed');
  assertSection(core.sectionDiagnosticFromObservations([
    core.createSectionObservation('ssr:__AER_DATA__', { ignored: true }, null, false),
  ], true), 'not-observed');
  assertSection(core.sectionDiagnosticFromObservations([
    core.createSectionObservation('dom:description', null, 'schema-mismatch'),
    core.createSectionObservation('ssr:__AER_DATA__', null, 'conflict'),
    core.createSectionObservation('productData', null, 'traversal-limit'),
  ], false), 'invalid', ['productData', 'ssr:__AER_DATA__', 'dom:description'], 'traversal-limit');

  const product = syntheticProduct('100');
  const metadata = JSON.stringify(product._meta.sections);
  assert.doesNotMatch(metadata, /https?:\/\/|[?&]|_bx-v|spm|utm_|token|cookie|authorization/i);
  assert.deepEqual(Object.keys(product._meta.sections), [
    'sizeGuide', 'gallery', 'ratingSummary', 'store', 'characteristics', 'description', 'delivery',
  ]);
  Object.values(product._meta.sections).forEach((entry) => {
    assert.deepEqual(Object.keys(entry), ['state', 'sources', 'diagnostic']);
    entry.sources.forEach((source) => assert.ok(core.SECTION_SOURCE_ORDER.includes(source)));
  });
});

test('Size Guide diagnostics distinguish captured Dress, Relay absence, unknown schema, and traversal limit', () => {
  const dressFixture = loadFixture('product-1005009452926938.json');
  const relayFixture = loadFixture('product-1005008195850531.json');
  const dress = core.normalizeProduct(dressFixture.data, 'https://aliexpress.ru/item/1005009452926938.html');
  const relay = core.normalizeProduct(relayFixture.data, 'https://aliexpress.ru/item/1005008195850531.html');

  assert.equal(dress.skus.length, 45);
  assert.deepEqual(dress.variantGroups.map((group) => group.values.length), [9, 5]);
  assert.deepEqual(dress.sizeGuide.tables.map((table) => table.unit), ['CM', 'IN']);
  assertSection(dress._meta.sections.sizeGuide, 'present', ['productData']);
  assert.equal(relay.skus.length, 7);
  assertSection(relay._meta.sections.sizeGuide, 'missing', ['productData']);

  for (const absent of [null, undefined]) {
    const absentFixture = clone(relayFixture);
    absentFixture.data.skuInfo.sizeData = absent;
    const product = core.normalizeProduct(absentFixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
    assert.equal(product.sizeGuide, null);
    assertSection(product._meta.sections.sizeGuide, 'missing', ['productData']);
  }

  for (const primitive of ['', 0, false]) {
    const primitiveFixture = clone(relayFixture);
    primitiveFixture.data.skuInfo.sizeData = primitive;
    const product = core.normalizeProduct(primitiveFixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
    assert.deepEqual(product.sizeGuide.tables, []);
    assert.equal(product.sizeGuide.raw, primitive);
    assertSection(product._meta.sections.sizeGuide, 'invalid', ['productData'], 'schema-mismatch');
  }

  const malformedFixture = clone(dressFixture);
  malformedFixture.data.skuInfo.sizeData = { heading: 'Observed but unknown size chart' };
  const malformed = core.normalizeProduct(malformedFixture.data, 'https://aliexpress.ru/item/1005009452926938.html');
  assert.deepEqual(malformed.sizeGuide.tables, []);
  assertSection(malformed._meta.sections.sizeGuide, 'invalid', ['productData'], 'schema-mismatch');

  const table = { unit: 'CM', columns: ['Size'], rows: [['S']] };
  const limited = core.inspectSizeGuide({ ...table, hidden: nested(table, 3) }, { maxDepth: 2 });
  assert.deepEqual(limited, { sizeGuide: null, diagnostic: 'traversal-limit' });
  assertSection(core.sectionDiagnosticFromObservations([
    core.createSectionObservation('productData', limited.sizeGuide, limited.diagnostic),
  ], false), 'invalid', ['productData'], 'traversal-limit');
});

test('Gallery diagnostics preserve the captured Relay value and distinguish miss, schema, conflict, and limit', () => {
  const fixture = loadFixture('gallery-1005008195850531.json');
  const snapshot = clone(fixture);
  const relayProduct = core.normalizeProduct(
    loadFixture('product-1005008195850531.json').data,
    'https://aliexpress.ru/item/1005008195850531.html',
  );
  const presentInspection = core.inspectGalleryFromSsrData({ moved: fixture }, fixture.props.id);
  const present = core.enrichProductFallbacks(relayProduct, {
    galleryInspection: asObservation(presentInspection, 'gallery'),
  });
  assert.equal(present.gallery, presentInspection.gallery);
  assert.equal(present.gallery.items.length, 7);
  assert.deepEqual(present.gallery.items.map((item) => item.type), ['video', 'image', 'image', 'image', 'image', 'image', 'image']);
  assertSection(present._meta.sections.gallery, 'present', ['ssr:__AER_DATA__']);
  assert.deepEqual(fixture, snapshot);

  const cases = [
    [core.inspectGalleryFromSsrData({ unrelated: true }, fixture.props.id), 'missing', null],
    [core.inspectGalleryFromSsrData({ props: {
      id: fixture.props.id,
      gallery: [{ imageUrl: 'data:image/png,x', previewUrl: 'https://example.com/p.jpg', videoUrl: null }],
    } }, fixture.props.id), 'invalid', 'schema-mismatch'],
    [core.inspectGalleryFromSsrData({
      one: galleryCandidate('one', fixture.props.id),
      two: galleryCandidate('two', fixture.props.id),
    }, fixture.props.id), 'invalid', 'conflict'],
    [core.inspectGalleryFromSsrData({ candidate: fixture }, fixture.props.id, { maxVisited: 1 }), 'invalid', 'traversal-limit'],
  ];
  for (const [inspection, state, diagnostic] of cases) {
    const product = core.enrichProductFallbacks(relayProduct, {
      galleryInspection: asObservation(inspection, 'gallery'),
    });
    assert.equal(product.gallery, null);
    assertSection(product._meta.sections.gallery, state, ['ssr:__AER_DATA__'], diagnostic);
  }

  const mixedConflict = core.inspectGalleryFromSsrData({
    one: galleryCandidate('one', fixture.props.id),
    two: galleryCandidate('two', fixture.props.id),
    malformed: { props: { id: fixture.props.id, gallery: 'unknown-shape' } },
  }, fixture.props.id);
  assert.deepEqual(mixedConflict, { gallery: null, diagnostic: 'conflict' });
});

test('Store diagnostics cover captured SSR, DOM-only, composite provenance, and safe partial values', () => {
  const dressStoreFixture = loadFixture('store-ssr-1005009452926938.json');
  const dressProduct = core.normalizeProduct(
    loadFixture('product-1005009452926938.json').data,
    'https://aliexpress.ru/item/1005009452926938.html',
  );
  const dressInspection = core.inspectStoreFromSsrData(dressStoreFixture.fragment, dressStoreFixture.itemId);
  const dress = core.enrichProductFallbacks(dressProduct, {
    structuredStoreInspection: asObservation(dressInspection, 'store'),
  });
  assert.equal(dress.store.name, 'WLIN OOTD Store');
  assertSection(dress._meta.sections.store, 'present', ['ssr:__AER_DATA__']);

  const ssrFixture = loadFixture('store-ssr-1005005933779962.json');
  const domFixture = loadFixture('store-dom-1005005933779962.json');
  const ssrInspection = core.inspectStoreFromSsrData(ssrFixture.fragment, ssrFixture.itemId);
  const domInspection = core.inspectStoreFromDom(
    syntheticStoreDom(domFixture),
    domFixture.itemId,
    `https://aliexpress.ru/item/${domFixture.itemId}.html`,
  );
  assert.equal(domInspection.diagnostic, null);
  assert.equal(domInspection.store.name, 'Better off Store');

  const carrier = syntheticProduct(ssrFixture.itemId);
  const domOnly = core.enrichProductFallbacks(carrier, {
    domStoreInspection: asObservation(domInspection, 'store'),
  });
  assertSection(domOnly._meta.sections.store, 'present', ['dom:store']);
  const composite = core.enrichProductFallbacks(carrier, {
    structuredStoreInspection: asObservation(ssrInspection, 'store'),
    domStoreInspection: asObservation(domInspection, 'store'),
  });
  assert.equal(composite.store.name, 'Better off Store');
  assert.deepEqual(composite.store.subscribers, { value: 320, display: '320 subscribers' });
  assertSection(composite._meta.sections.store, 'present', ['ssr:__AER_DATA__', 'dom:store']);

  const partialFragment = clone(dressStoreFixture.fragment);
  delete partialFragment.props.url;
  delete partialFragment.props.subscribersCount;
  delete partialFragment.props.positiveReviews;
  delete partialFragment.props.subtitles;
  delete partialFragment.props.analytics;
  const partial = core.inspectStoreFromSsrData({ partialFragment }, dressStoreFixture.itemId);
  assert.equal(partial.diagnostic, null);
  assert.equal(partial.store.name, 'WLIN OOTD Store');
});

test('Store diagnostics distinguish complete miss, relevant schema mismatch, conflict, and traversal limit', () => {
  const fixture = loadFixture('store-ssr-1005009452926938.json');
  const conflict = clone(fixture.fragment);
  conflict.props.name = 'Conflicting Store';
  conflict.props.url = 'https://aliexpress.ru/store/999';
  const unboundMalformed = core.inspectStoreFromSsrData({
    props: { positiveReviews: null },
  }, fixture.itemId);
  assert.deepEqual(unboundMalformed, { store: null, diagnostic: null });

  const mismatchedMalformed = core.inspectStoreFromSsrData({
    props: {
      positiveReviews: null,
      analytics: { itemId: '1005008195850531' },
    },
  }, fixture.itemId);
  assert.deepEqual(mismatchedMalformed, { store: null, diagnostic: null });

  const inspections = [
    [core.inspectStoreFromSsrData({ unrelated: true }, fixture.itemId), 'missing', null],
    [core.inspectStoreFromSsrData({ props: {
      positiveReviews: null,
      analytics: { itemId: fixture.itemId },
    } }, fixture.itemId), 'invalid', 'schema-mismatch'],
    [core.inspectStoreFromSsrData({ props: {
      positiveReviews: null,
      chatLink: `https://aliexpress.ru/chat?item_id=${fixture.itemId}`,
    } }, fixture.itemId), 'invalid', 'schema-mismatch'],
    [core.inspectStoreFromSsrData({ one: fixture.fragment, two: conflict }, fixture.itemId), 'invalid', 'conflict'],
    [core.inspectStoreFromSsrData({ candidate: fixture.fragment }, fixture.itemId, { maxVisited: 1 }), 'invalid', 'traversal-limit'],
  ];
  for (const [inspection, state, diagnostic] of inspections) {
    const product = core.enrichProductFallbacks(syntheticProduct(fixture.itemId), {
      structuredStoreInspection: asObservation(inspection, 'store'),
    });
    assert.equal(product.store, null);
    assertSection(product._meta.sections.store, state, ['ssr:__AER_DATA__'], diagnostic);
  }

  const missingDom = core.inspectStoreFromDom(
    syntheticStoreDom(loadFixture('store-dom-1005005933779962.json'), { missing: true }),
    '1005005933779962',
    'https://aliexpress.ru/item/1005005933779962.html',
  );
  assert.deepEqual({ store: missingDom.store, diagnostic: missingDom.diagnostic }, { store: null, diagnostic: null });
});

test('Store present sources exclude a fully conflicting DOM observation and include corroboration or fallback', () => {
  const structured = core.normalizeStore({
    name: 'Structured Store',
    url: 'https://aliexpress.ru/store/1001',
    sellerId: '2001',
    sellerRating: { value: 91, display: "91% seller's rating" },
    subscribers: { value: 10, display: '10 subscribers' },
  });
  const fullyConflictingDom = core.normalizeStore({
    name: 'Different Store',
    url: 'https://aliexpress.ru/store/1002',
    sellerId: '2002',
    sellerRating: { value: 82, display: "82% seller's rating" },
    subscribers: { value: 20, display: '20 subscribers' },
  });
  const conflicting = core.enrichProductFallbacks(syntheticProduct('100'), {
    structuredStoreInspection: { value: structured, diagnostic: null, observed: true },
    domStoreInspection: { value: fullyConflictingDom, diagnostic: null, observed: true },
  });
  assert.equal(conflicting.store.name, 'Structured Store');
  assert.equal(conflicting.store.storeId, '1001');
  assertSection(conflicting._meta.sections.store, 'present', ['ssr:__AER_DATA__']);

  const corroboratingDom = core.normalizeStore({ name: 'Structured Store' });
  const corroborated = core.enrichProductFallbacks(syntheticProduct('100'), {
    structuredStoreInspection: { value: structured, diagnostic: null, observed: true },
    domStoreInspection: { value: corroboratingDom, diagnostic: null, observed: true },
  });
  assertSection(corroborated._meta.sections.store, 'present', ['ssr:__AER_DATA__', 'dom:store']);

  const partialStructured = core.normalizeStore({ name: 'Structured Store' });
  const fallbackDom = core.normalizeStore({
    url: 'https://aliexpress.ru/store/1001',
    sellerId: '2001',
  });
  const supplemented = core.enrichProductFallbacks(syntheticProduct('100'), {
    structuredStoreInspection: { value: partialStructured, diagnostic: null, observed: true },
    domStoreInspection: { value: fallbackDom, diagnostic: null, observed: true },
  });
  assert.equal(supplemented.store.name, 'Structured Store');
  assert.equal(supplemented.store.storeId, '1001');
  assertSection(supplemented._meta.sections.store, 'present', ['ssr:__AER_DATA__', 'dom:store']);
});

test('Rating diagnostics record captured SSR and both DOM contributors without replacing domain diagnostics', () => {
  const productFixture = loadFixture('product-1005009452926938.json');
  const ratingFixture = loadFixture('rating-trade-1005009452926938.json');
  const reviewFixture = loadFixture('review-summary-1005009452926938.json');
  const structured = core.inspectRatingFromSsrData(reviewFixture.ssr, reviewFixture.itemId);
  const header = core.inspectBasicRatingFromDom(syntheticRatingDom(ratingFixture.dom));
  const reviewDom = core.inspectReviewSummaryFromDom(syntheticReviewSummaryDom(reviewFixture));
  const product = core.enrichProductFallbacks(
    core.normalizeProduct(productFixture.data, reviewFixture.sourceUrl),
    {
      structuredRatingInspection: asObservation(structured, 'summary'),
      domRatingInspection: asObservation(header, 'summary'),
      reviewDomSummaryInspection: asObservation(reviewDom, 'summary'),
    },
  );

  assert.equal(product.ratingSummary.rating, 4.6);
  assert.equal(product.ratingSummary.reviewCount, 36);
  assert.equal(product.ratingSummary.contentFeedbackCount, 30);
  assert.equal(product.ratingSummary.boughtCount, ratingFixture.expected.boughtCount);
  assert.equal(product.ratingSummary.buyerPhotosCount, 31);
  assert.deepEqual(product.ratingSummary.diagnostics, {
    starDistributionTotal: 36,
    starDistributionMatchesReviewCount: true,
  });
  assertSection(product._meta.sections.ratingSummary, 'present', [
    'ssr:__AER_DATA__', 'dom:product-header', 'dom:review-section',
  ]);
});

test('Rating diagnostics distinguish missing, schema mismatch, conflict, and traversal limit', () => {
  const itemId = '100';
  const missing = core.enrichProductFallbacks(syntheticProduct(itemId), {
    structuredRatingInspection: { value: null, diagnostic: null, observed: true },
    domRatingInspection: { value: null, diagnostic: null, observed: true },
    reviewDomSummaryInspection: { value: null, diagnostic: null, observed: true },
  });
  assertSection(missing._meta.sections.ratingSummary, 'missing', [
    'ssr:__AER_DATA__', 'dom:product-header', 'dom:review-section',
  ]);

  const malformedDom = core.inspectBasicRatingFromDom(syntheticRatingDom({
    ratingText: 'rating unknown', reviewText: 'reviews unknown', boughtText: 'bought unknown',
  }));
  assert.equal(malformedDom.diagnostic, 'schema-mismatch');
  const malformed = core.enrichProductFallbacks(syntheticProduct(itemId), {
    domRatingInspection: asObservation(malformedDom, 'summary'),
  });
  assertSection(malformed._meta.sections.ratingSummary, 'invalid', ['dom:product-header'], 'schema-mismatch');

  const conflictInspection = core.inspectRatingFromSsrData({
    one: ratingCandidate(itemId, '5.0', 5),
    two: ratingCandidate(itemId, '4.0', 6),
  }, itemId);
  assert.equal(conflictInspection.diagnostic, 'conflict');
  const conflict = core.enrichProductFallbacks(syntheticProduct(itemId), {
    structuredRatingInspection: asObservation(conflictInspection, 'summary'),
  });
  assertSection(conflict._meta.sections.ratingSummary, 'invalid', ['ssr:__AER_DATA__'], 'conflict');

  const limitedInspection = core.inspectRatingFromSsrData(
    { candidate: ratingCandidate(itemId, '5.0', 5) },
    itemId,
    { maxVisited: 1 },
  );
  assert.equal(limitedInspection.diagnostic, 'traversal-limit');
  const limited = core.enrichProductFallbacks(syntheticProduct(itemId), {
    structuredRatingInspection: asObservation(limitedInspection, 'summary'),
  });
  assertSection(limited._meta.sections.ratingSummary, 'invalid', ['ssr:__AER_DATA__'], 'traversal-limit');
});

test('Rating SSR aggregation requires item binding and rejects cross-inspector disagreement', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  const unbound = ratingCandidate(fixture.itemId, '4.9', 99);
  delete unbound.props.analyticEvents.clickAllReviews.trackingInfo.itemId;
  delete unbound.props.analyticEvents.viewWidgetReview.trackingInfo.itemId;
  const ignored = core.inspectRatingFromSsrData({
    unbound,
    wrongItem: ratingCandidate('1005008195850531', '4.8', 88),
  }, fixture.itemId);
  assert.deepEqual(ignored, { summary: null, diagnostic: null });

  const disagreeingRoot = {
    reviewContext: fixture.ssr,
    basic: ratingCandidate(fixture.itemId, '4.1', 37),
  };
  const review = core.inspectReviewSummaryFromSsrData(disagreeingRoot, fixture.itemId);
  const basic = core.inspectBasicRatingFromSsrData(disagreeingRoot, fixture.itemId);
  assert.deepEqual(
    { rating: review.summary.rating, reviewCount: review.summary.reviewCount, diagnostic: review.diagnostic },
    { rating: 4.6, reviewCount: 36, diagnostic: null },
  );
  assert.deepEqual(
    { rating: basic.summary.rating, reviewCount: basic.summary.reviewCount, diagnostic: basic.diagnostic },
    { rating: 4.1, reviewCount: 37, diagnostic: null },
  );
  assert.deepEqual(
    core.inspectRatingFromSsrData(disagreeingRoot, fixture.itemId),
    { summary: null, diagnostic: 'conflict' },
  );

  const trustworthyContext = clone(fixture.ssr);
  const trustworthyTabs = trustworthyContext.children[0];
  trustworthyTabs.props.analyticEvents.clickAllReviews.trackingInfo.overallRating = '4.5';
  trustworthyTabs.props.analyticEvents.viewWidgetReview.trackingInfo.overallRating = '4.5';
  const internallyConflictingBasicRoot = {
    reviewContext: trustworthyContext,
    agreeingBasic: ratingCandidate(fixture.itemId, '4.5', null),
    conflictingBasic: ratingCandidate(fixture.itemId, '3.0', null),
  };
  const trustworthyReview = core.inspectReviewSummaryFromSsrData(
    internallyConflictingBasicRoot,
    fixture.itemId,
  );
  assert.equal(trustworthyReview.summary.rating, 4.5);
  assert.equal(trustworthyReview.summary.reviewCount, 36);
  assert.equal(trustworthyReview.diagnostic, null);
  assert.deepEqual(
    core.inspectBasicRatingFromSsrData(internallyConflictingBasicRoot, fixture.itemId),
    { summary: null, diagnostic: 'conflict' },
  );
  assert.deepEqual(
    core.inspectRatingFromSsrData(internallyConflictingBasicRoot, fixture.itemId),
    { summary: null, diagnostic: 'conflict' },
  );

  const agreeing = core.inspectRatingFromSsrData({
    reviewContext: fixture.ssr,
    basic: ratingCandidate(fixture.itemId, '4.6', 36),
  }, fixture.itemId);
  assert.equal(agreeing.diagnostic, null);
  assert.equal(agreeing.summary.rating, 4.6);
  assert.equal(agreeing.summary.reviewCount, 36);
  assert.equal(agreeing.summary.contentFeedbackCount, 30);
  const agreeingProduct = core.enrichProductFallbacks(syntheticProduct(fixture.itemId), {
    structuredRatingInspection: asObservation(agreeing, 'summary'),
  });
  assertSection(agreeingProduct._meta.sections.ratingSummary, 'present', ['ssr:__AER_DATA__']);
});

test('Rating present sources exclude a fully conflicting header and include corroboration or fallback', () => {
  const structured = {
    rating: 5,
    reviewCount: 5,
    contentFeedbackCount: 4,
    boughtCount: null,
    display: {},
  };
  const fullyConflictingHeader = {
    rating: 4,
    reviewCount: 6,
    boughtCount: null,
    display: {},
  };
  const conflicting = core.enrichProductFallbacks(syntheticProduct('100'), {
    structuredRatingInspection: { value: structured, diagnostic: null, observed: true },
    domRatingInspection: { value: fullyConflictingHeader, diagnostic: null, observed: true },
  });
  assert.equal(conflicting.ratingSummary.rating, 5);
  assert.equal(conflicting.ratingSummary.reviewCount, 5);
  assertSection(conflicting._meta.sections.ratingSummary, 'present', ['ssr:__AER_DATA__']);

  const corroborated = core.enrichProductFallbacks(syntheticProduct('100'), {
    structuredRatingInspection: { value: structured, diagnostic: null, observed: true },
    domRatingInspection: {
      value: { rating: 5, reviewCount: 6, boughtCount: null, display: {} },
      diagnostic: null,
      observed: true,
    },
  });
  assertSection(corroborated._meta.sections.ratingSummary, 'present', [
    'ssr:__AER_DATA__', 'dom:product-header',
  ]);

  const supplemented = core.enrichProductFallbacks(syntheticProduct('100'), {
    structuredRatingInspection: {
      value: { contentFeedbackCount: 4, display: {} },
      diagnostic: null,
      observed: true,
    },
    domRatingInspection: {
      value: {
        rating: 4,
        reviewCount: 6,
        boughtCount: 2,
        display: { rating: '4.0', reviewCount: '6 reviews', boughtCount: '2 bought' },
      },
      diagnostic: null,
      observed: true,
    },
  });
  assert.equal(supplemented.ratingSummary.contentFeedbackCount, 4);
  assert.equal(supplemented.ratingSummary.boughtCount, 2);
  assertSection(supplemented._meta.sections.ratingSummary, 'present', [
    'ssr:__AER_DATA__', 'dom:product-header',
  ]);
});

test('bound Review Context classifies conflicting feedback totals without discarding a trustworthy rating', () => {
  const fixture = loadFixture('review-summary-1005009452926938.json');
  const context = clone(fixture.ssr);
  const tabs = context.children[0];
  const conflictingFeedback = clone(tabs.children[0]);
  conflictingFeedback.props.resolveParams['review.productReviewsCount'] = 37;
  conflictingFeedback.props.resolveParams['review.productFeedbacksCount'] = 31;
  tabs.children.push(conflictingFeedback);

  const partial = core.inspectReviewSummaryFromSsrData(context, fixture.itemId);
  assert.equal(partial.diagnostic, null);
  assert.equal(partial.summary.rating, 4.6);
  assert.equal(partial.summary.reviewCount, null);
  assert.equal(partial.summary.contentFeedbackCount, null);

  delete tabs.props.analyticEvents.clickAllReviews.trackingInfo.overallRating;
  delete tabs.props.analyticEvents.viewWidgetReview.trackingInfo.overallRating;
  assert.deepEqual(
    core.inspectReviewSummaryFromSsrData(context, fixture.itemId),
    { summary: null, diagnostic: 'conflict' },
  );
});

test('unobserved or diagnosed non-null observations cannot populate or merge present sections', () => {
  const galleryFixture = loadFixture('gallery-1005008195850531.json');
  const gallery = core.inspectGalleryFromSsrData(galleryFixture, galleryFixture.props.id).gallery;
  const base = syntheticProduct(galleryFixture.props.id);
  const ignored = core.enrichProductFallbacks(base, {
    galleryInspection: { value: gallery, diagnostic: null, observed: false },
    structuredRatingInspection: {
      value: { rating: 5, reviewCount: 5, display: {} },
      diagnostic: null,
      observed: false,
    },
    structuredStoreInspection: {
      value: core.normalizeStore({ name: 'Ignored Store' }),
      diagnostic: null,
      observed: false,
    },
  });
  assert.equal(ignored.gallery, null);
  assert.equal(ignored.ratingSummary, null);
  assert.equal(ignored.store, null);
  for (const section of ['gallery', 'ratingSummary', 'store']) {
    assertSection(ignored._meta.sections[section], 'not-observed');
  }

  const diagnosedObservation = core.createSectionObservation(
    'ssr:__AER_DATA__',
    { rating: 5 },
    'schema-mismatch',
  );
  assert.equal(diagnosedObservation.value, null);
  assertSection(
    core.sectionDiagnosticFromObservations([diagnosedObservation], true),
    'invalid',
    ['ssr:__AER_DATA__'],
    'schema-mismatch',
  );

  const invalidGallery = core.enrichProductFallbacks(base, {
    galleryInspection: { value: gallery, diagnostic: 'schema-mismatch', observed: true },
  });
  assert.equal(invalidGallery.gallery, null);
  assertSection(
    invalidGallery._meta.sections.gallery,
    'invalid',
    ['ssr:__AER_DATA__'],
    'schema-mismatch',
  );

  const validHeaderFallback = core.enrichProductFallbacks(base, {
    structuredRatingInspection: {
      value: { rating: 5, reviewCount: 5, display: {} },
      diagnostic: 'schema-mismatch',
      observed: true,
    },
    domRatingInspection: {
      value: { rating: 4, reviewCount: 4, boughtCount: null, display: {} },
      diagnostic: null,
      observed: true,
    },
  });
  assert.equal(validHeaderFallback.ratingSummary.rating, 4);
  assert.equal(validHeaderFallback.ratingSummary.reviewCount, 4);
  assertSection(
    validHeaderFallback._meta.sections.ratingSummary,
    'present',
    ['dom:product-header'],
  );
});

test('Characteristics diagnostics distinguish captured DOM, missing boundary, and malformed rows', () => {
  const fixture = loadFixture('characteristics-1005009452926938.json');
  const presentInspection = core.inspectCharacteristicsFromDom(syntheticCharacteristicsDom(fixture.rows));
  const present = core.enrichProductFallbacks(
    core.normalizeProduct(
      loadFixture('product-1005009452926938.json').data,
      'https://aliexpress.ru/item/1005009452926938.html',
    ),
    { characteristicsInspection: asObservation(presentInspection, 'characteristics') },
  );
  assert.deepEqual(present.characteristics, fixture.rows);
  assertSection(present._meta.sections.characteristics, 'present', ['dom:characteristics']);

  const missingInspection = core.inspectCharacteristicsFromDom({ querySelectorAll: () => [] });
  const missing = core.enrichProductFallbacks(syntheticProduct('100'), {
    characteristicsInspection: asObservation(missingInspection, 'characteristics'),
  });
  assertSection(missing._meta.sections.characteristics, 'missing', ['dom:characteristics']);

  const malformedBoundary = syntheticCharacteristicsDom([
    { name: 'Missing value', value: '' },
    { name: '', value: 'Missing name' },
  ]);
  const malformedInspection = core.inspectCharacteristicsFromDom(malformedBoundary);
  assert.equal(malformedInspection.diagnostic, 'schema-mismatch');
  const malformed = core.enrichProductFallbacks(syntheticProduct('100'), {
    characteristicsInspection: asObservation(malformedInspection, 'characteristics'),
  });
  assertSection(malformed._meta.sections.characteristics, 'invalid', ['dom:characteristics'], 'schema-mismatch');
});

test('Characteristics zero-item duplicate boundaries are neutral and all-empty boundaries are missing', () => {
  const validBoundary = syntheticCharacteristicsDom([{ name: 'Material', value: 'Cotton' }]);
  const emptyBoundaryA = syntheticCharacteristicsDom([]);
  const emptyBoundaryB = syntheticCharacteristicsDom([]);
  for (const boundaries of [
    [validBoundary, emptyBoundaryA],
    [emptyBoundaryA, validBoundary],
  ]) {
    const validWithEmpty = core.inspectCharacteristicsFromDom(
      syntheticCharacteristicsBoundaries(...boundaries),
    );
    assert.deepEqual(validWithEmpty.characteristics, [{ name: 'Material', value: 'Cotton' }]);
    assert.equal(validWithEmpty.diagnostic, null);
    const product = core.enrichProductFallbacks(syntheticProduct('100'), {
      characteristicsInspection: asObservation(validWithEmpty, 'characteristics'),
    });
    assert.deepEqual(product.characteristics, [{ name: 'Material', value: 'Cotton' }]);
    assertSection(product._meta.sections.characteristics, 'present', ['dom:characteristics']);
  }

  const allEmptyInspection = core.inspectCharacteristicsFromDom(
    syntheticCharacteristicsBoundaries(emptyBoundaryA, emptyBoundaryB),
  );
  assert.deepEqual(allEmptyInspection.characteristics, []);
  assert.equal(allEmptyInspection.diagnostic, null);
  const allEmpty = core.enrichProductFallbacks(syntheticProduct('100'), {
    characteristicsInspection: asObservation(allEmptyInspection, 'characteristics'),
  });
  assert.deepEqual(allEmpty.characteristics, []);
  assertSection(allEmpty._meta.sections.characteristics, 'missing', ['dom:characteristics']);
});

test('Characteristics identical valid boundaries dedupe while differing valid boundaries conflict', () => {
  const boundaryA = syntheticCharacteristicsDom([{ name: 'Material', value: 'Cotton' }]);
  const matchingBoundary = syntheticCharacteristicsDom([{ name: 'Material', value: 'Cotton' }]);
  const matchingBoundaries = core.inspectCharacteristicsFromDom(
    syntheticCharacteristicsBoundaries(boundaryA, matchingBoundary),
  );
  assert.deepEqual(matchingBoundaries.characteristics, [{ name: 'Material', value: 'Cotton' }]);
  assert.equal(matchingBoundaries.boundary, boundaryA.boundary);
  assert.equal(matchingBoundaries.diagnostic, null);
  const matchingProduct = core.enrichProductFallbacks(syntheticProduct('100'), {
    characteristicsInspection: asObservation(matchingBoundaries, 'characteristics'),
  });
  assert.deepEqual(matchingProduct.characteristics, [{ name: 'Material', value: 'Cotton' }]);
  assert.equal(matchingProduct.characteristics.length, 1);
  assertSection(matchingProduct._meta.sections.characteristics, 'present', ['dom:characteristics']);

  const boundaryB = syntheticCharacteristicsDom([{ name: 'Material', value: 'Polyester' }]);
  const conflictingBoundaries = core.inspectCharacteristicsFromDom(
    syntheticCharacteristicsBoundaries(boundaryA, boundaryB),
  );
  assert.deepEqual(conflictingBoundaries.characteristics, []);
  assert.equal(conflictingBoundaries.boundary, boundaryA.boundary);
  assert.equal(conflictingBoundaries.diagnostic, 'conflict');
});

test('Characteristics non-empty malformed duplicate boundaries fail closed', () => {
  const validBoundary = syntheticCharacteristicsDom([{ name: 'Material', value: 'Cotton' }]);

  const malformedBoundary = syntheticCharacteristicsDom([
    { name: 'Missing value', value: '' },
    { name: '', value: 'Missing name' },
  ]);
  for (const boundaries of [
    [validBoundary, malformedBoundary],
    [malformedBoundary, validBoundary],
  ]) {
    const validWithMalformed = core.inspectCharacteristicsFromDom(
      syntheticCharacteristicsBoundaries(...boundaries),
    );
    assert.deepEqual(validWithMalformed.characteristics, []);
    assert.equal(validWithMalformed.diagnostic, 'schema-mismatch');
    const product = core.enrichProductFallbacks(syntheticProduct('100'), {
      characteristicsInspection: asObservation(validWithMalformed, 'characteristics'),
    });
    assert.deepEqual(product.characteristics, []);
    assertSection(
      product._meta.sections.characteristics,
      'invalid',
      ['dom:characteristics'],
      'schema-mismatch',
    );
  }
});

test('Characteristics stale history retains duplicate boundary identities and aggregate conflict fingerprints', () => {
  const rows = [{ name: 'Material', value: 'Cotton' }];
  const first = syntheticCharacteristicsDom(rows);
  const second = syntheticCharacteristicsDom(rows);
  const withBoundaries = (...doms) => ({
    querySelectorAll(selector) {
      return selector.includes('HazeProductCharacteristics__groupsContainerForSku')
        ? doms.map((dom) => dom.boundary)
        : [];
    },
  });
  const characteristicsEqual = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((row, index) => (
      row.name === right[index]?.name && row.value === right[index]?.value
    ));

  const duplicateSnapshot = core.snapshotStaleDomObservations(
    {},
    withBoundaries(first, second),
    '1005008195850531',
    'https://aliexpress.ru/item/1005008195850531.html',
  );
  const duplicateHistory = duplicateSnapshot.characteristics.history;
  assert.equal(duplicateHistory.some((observation) => observation.boundary === first.boundary), true);
  assert.equal(duplicateHistory.some((observation) => observation.boundary === second.boundary), true);

  const remainingSecond = core.inspectCharacteristicsFromDom(withBoundaries(second));
  assert.equal(remainingSecond.boundary, second.boundary);
  assert.equal(core.matchesStaleSectionObservation(
    duplicateHistory,
    remainingSecond.boundary,
    remainingSecond.characteristics,
    remainingSecond.diagnostic,
    characteristicsEqual,
  ), true);

  const conflicting = syntheticCharacteristicsDom([{ name: 'Material', value: 'Polyester' }]);
  const conflictRoot = withBoundaries(first, conflicting);
  const conflictInspection = core.inspectCharacteristicsFromDom(conflictRoot);
  assert.deepEqual(conflictInspection.characteristics, []);
  assert.equal(conflictInspection.diagnostic, 'conflict');
  const conflictSnapshot = core.snapshotStaleDomObservations(
    {},
    conflictRoot,
    '1005008195850531',
    'https://aliexpress.ru/item/1005008195850531.html',
  );
  assert.equal(core.matchesStaleSectionObservation(
    conflictSnapshot.characteristics.history,
    conflictInspection.boundary,
    conflictInspection.characteristics,
    conflictInspection.diagnostic,
    characteristicsEqual,
  ), true);
});

test('Description diagnostics preserve captured Dress and Relay blocks and distinguish missing, empty, and malformed DOM', () => {
  const cases = [
    ['description-1005009452926938.json', (fixture) => fixture.fragment, 5],
    ['description-1005008195850531.json', (fixture) => fixture.fragments.textThenImages, 3],
  ];
  for (const [fixtureName, selectHtml, expectedBlocks] of cases) {
    const fixture = loadFixture(fixtureName);
    const inspection = core.inspectDescriptionFromDom(
      syntheticDescriptionDom(selectHtml(fixture)),
      `https://aliexpress.ru/item/${fixture.itemId}.html`,
    );
    assert.equal(inspection.diagnostic, null);
    assert.equal(inspection.description.blocks.length, expectedBlocks);
    const product = core.enrichProductFallbacks(syntheticProduct(fixture.itemId), {
      descriptionInspection: asObservation(inspection, 'description'),
    });
    assertSection(product._meta.sections.description, 'present', ['dom:description']);
  }

  for (const root of [syntheticDescriptionDom('', { missing: true }), syntheticDescriptionDom('<div><br></div>')]) {
    const inspection = core.inspectDescriptionFromDom(root, 'https://aliexpress.ru/item/100.html');
    assert.equal(inspection.description, null);
    assert.equal(inspection.diagnostic, null);
    const product = core.enrichProductFallbacks(syntheticProduct('100'), {
      descriptionInspection: asObservation(inspection, 'description'),
    });
    assertSection(product._meta.sections.description, 'missing', ['dom:description']);
  }

  const malformedInspection = core.inspectDescriptionFromDom(
    syntheticDescriptionDom('<img src="data:image/png;base64,unsafe">'),
    'https://aliexpress.ru/item/100.html',
  );
  assert.equal(malformedInspection.description, null);
  assert.equal(malformedInspection.diagnostic, 'schema-mismatch');
  const malformed = core.enrichProductFallbacks(syntheticProduct('100'), {
    descriptionInspection: asObservation(malformedInspection, 'description'),
  });
  assertSection(malformed._meta.sections.description, 'invalid', ['dom:description'], 'schema-mismatch');
});

test('Delivery diagnostics move from not-observed to captured present and reject wrong selected context', () => {
  const productFixture = loadFixture('product-1005008195850531.json');
  const shippingFixture = loadFixture('shipping-calculate-1005008195850531.json');
  const pageUrl = 'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689';
  const initial = core.normalizeProduct(productFixture.data, pageUrl);
  assertSection(initial._meta.sections.delivery, 'not-observed');

  const inspection = core.inspectDeliveryCapture(
    shippingFixture.request,
    shippingFixture.response,
    initial.itemId,
    initial.selectedSkuId,
  );
  assert.equal(inspection.matched, true);
  assert.equal(inspection.diagnostic, null);
  assert.equal(inspection.delivery.skuId, initial.selectedSkuId);

  const cache = core.createDeliveryCache();
  core.cacheDeliveryCapture(cache, shippingFixture.request, shippingFixture.response);
  const environment = core.createShippingEnvironment(shippingFixture.request, inspection.delivery);
  const present = core.applyCachedDelivery(initial, cache, environment);
  assert.deepEqual(present.delivery, inspection.delivery);
  assertSection(present._meta.sections.delivery, 'present', ['native:shipping-calculate']);

  const wrongSkuRequest = { ...shippingFixture.request, skuId: '12000056550848683' };
  const wrongInspection = core.inspectDeliveryCapture(
    wrongSkuRequest,
    shippingFixture.response,
    initial.itemId,
    initial.selectedSkuId,
  );
  assert.equal(wrongInspection.matched, false);
  const wrongCache = core.createDeliveryCache();
  core.cacheDeliveryCapture(wrongCache, wrongSkuRequest, shippingFixture.response);
  const wrongEnvironment = core.createShippingEnvironment(wrongSkuRequest, wrongInspection.normalized);
  const unchanged = core.applyCachedDelivery(initial, wrongCache, wrongEnvironment);
  assert.equal(unchanged.delivery, null);
  assertSection(unchanged._meta.sections.delivery, 'not-observed');

  const otherItemRequest = { ...shippingFixture.request, productIdV2: '1005009452926938' };
  const otherItem = core.inspectDeliveryCapture(
    otherItemRequest,
    shippingFixture.response,
    initial.itemId,
    initial.selectedSkuId,
  );
  assert.equal(otherItem.matched, true);
  assert.equal(otherItem.delivery, null);
  assert.equal(otherItem.diagnostic, 'schema-mismatch');
});

test('Delivery capture rejects error envelopes and empty methods but accepts a recognized partial response', () => {
  const fixture = loadFixture('shipping-calculate-1005008195850531.json');
  const expectedItemId = '1005008195850531';
  const expectedSkuId = '12000056550848689';
  const rejectedResponses = [
    { error: 'denied' },
    { methods: [{}] },
    { error: 'denied', methods: [{ service: 'x' }] },
    { success: false, to: { countryName: 'X' } },
    { code: 500, methods: [{ service: 'x' }] },
    { to: null },
    { to: {} },
    { methods: null },
    { displayMultipleMethods: null },
  ];
  for (const response of rejectedResponses) {
    const inspection = core.inspectDeliveryCapture(
      fixture.request,
      response,
      expectedItemId,
      expectedSkuId,
    );
    assert.equal(inspection.matched, true);
    assert.equal(inspection.delivery, null);
    assert.equal(inspection.diagnostic, 'schema-mismatch');
  }

  const contradictoryRequests = [
    { ...fixture.request, productId: '999', productIdV2: expectedItemId },
    { ...fixture.request, productId: Number(expectedItemId), productIdV2: '999' },
  ];
  for (const contradictoryRequest of contradictoryRequests) {
    const contradictoryIds = core.inspectDeliveryCapture(
      contradictoryRequest,
      fixture.response,
      expectedItemId,
      expectedSkuId,
    );
    assert.equal(contradictoryIds.matched, true);
    assert.equal(contradictoryIds.delivery, null);
    assert.equal(contradictoryIds.diagnostic, 'schema-mismatch');
    const contradictoryCache = core.createDeliveryCache();
    core.cacheDeliveryCapture(contradictoryCache, contradictoryRequest, fixture.response);
    const contradictoryProduct = core.applyCachedDelivery(
      core.normalizeProduct(
        loadFixture('product-1005008195850531.json').data,
        `https://aliexpress.ru/item/${expectedItemId}.html?sku_id=${expectedSkuId}`,
      ),
      contradictoryCache,
      core.createShippingEnvironment(contradictoryRequest, contradictoryIds.normalized),
    );
    assert.equal(contradictoryProduct.delivery, null);
    assert.notEqual(contradictoryProduct._meta.sections.delivery.state, 'present');
  }

  const denied = core.inspectDeliveryCapture(
    fixture.request,
    { error: 'denied' },
    expectedItemId,
    expectedSkuId,
  );
  assert.doesNotMatch(JSON.stringify(denied.normalized), /denied|error/i);

  const partial = core.inspectDeliveryCapture(
    fixture.request,
    { to: { countryName: 'Synthetic' } },
    expectedItemId,
    expectedSkuId,
  );
  assert.equal(partial.matched, true);
  assert.equal(partial.diagnostic, null);
  assert.equal(partial.delivery.destination.countryName, 'Synthetic');
  assert.deepEqual(partial.delivery.methods, []);

  const explicitEmptyMethods = core.inspectDeliveryCapture(
    fixture.request,
    { methods: [] },
    expectedItemId,
    expectedSkuId,
  );
  assert.equal(explicitEmptyMethods.matched, true);
  assert.equal(explicitEmptyMethods.diagnostic, null);
  assert.deepEqual(explicitEmptyMethods.delivery.methods, []);

  const explicitSuccess = core.inspectDeliveryCapture(
    fixture.request,
    {
      success: true,
      code: 200,
      to: { countryName: 'Synthetic' },
      methods: [{ service: 'x' }],
    },
    expectedItemId,
    expectedSkuId,
  );
  assert.equal(explicitSuccess.matched, true);
  assert.equal(explicitSuccess.diagnostic, null);
  assert.equal(explicitSuccess.delivery.destination.countryName, 'Synthetic');
  assert.equal(explicitSuccess.delivery.methods[0].service, 'x');
});

test('Delivery capture rejects nested object scalars without leaking coercions or arbitrary raw fields', () => {
  const fixture = loadFixture('shipping-calculate-1005008195850531.json');
  const responses = [
    { methods: [{ service: { x: 1 } }] },
    { to: { country: { x: 1 } } },
    { methods: [{ amount: { value: { x: 1 }, currency: { x: 1 } } }] },
  ];
  for (const response of responses) {
    const inspection = core.inspectDeliveryCapture(
      fixture.request,
      response,
      '1005008195850531',
      '12000056550848689',
    );
    assert.equal(inspection.matched, true);
    assert.equal(inspection.delivery, null);
    assert.equal(inspection.diagnostic, 'schema-mismatch');
    assert.doesNotMatch(JSON.stringify(inspection.normalized), /\[object Object\]|"x":1/);

    const cache = core.createDeliveryCache();
    core.cacheDeliveryCapture(cache, fixture.request, response);
    const environment = core.createShippingEnvironment(fixture.request, inspection.normalized);
    const product = core.applyCachedDelivery(
      core.normalizeProduct(
        loadFixture('product-1005008195850531.json').data,
        'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689',
      ),
      cache,
      environment,
    );
    assert.equal(product.delivery, null);
    assertSection(product._meta.sections.delivery, 'invalid', ['native:shipping-calculate'], 'schema-mismatch');
    assert.doesNotMatch(core.exportProduct(product), /\[object Object\]|"x"\s*:/);
  }
});

test('Delivery request context rejects unsafe scalars and caches only an invalid selected-SKU observation', () => {
  const fixture = loadFixture('shipping-calculate-1005008195850531.json');
  const productFixture = loadFixture('product-1005008195850531.json');
  const itemId = '1005008195850531';
  const skuId = '12000056550848689';
  const pageUrl = `https://aliexpress.ru/item/${itemId}.html?sku_id=${skuId}`;
  for (const field of ['tradeCurrency', 'count', 'buyerPrice', 'minPrice', 'maxPrice']) {
    const request = { ...fixture.request, [field]: { unsafe: field } };
    const inspection = core.inspectDeliveryCapture(
      request,
      fixture.response,
      itemId,
      skuId,
    );
    assert.equal(inspection.matched, true, field);
    assert.equal(inspection.delivery, null, field);
    assert.equal(inspection.diagnostic, 'schema-mismatch', field);
    assert.doesNotMatch(JSON.stringify(inspection.normalized), /\[object Object\]|"unsafe"/, field);

    const cache = core.createDeliveryCache();
    core.cacheDeliveryCapture(cache, request, fixture.response, itemId, skuId);
    const product = core.applyCachedDelivery(
      core.normalizeProduct(productFixture.data, pageUrl),
      cache,
      core.createShippingEnvironment(request, inspection.normalized),
    );
    assert.equal(product.delivery, null, field);
    assertSection(
      product._meta.sections.delivery,
      'invalid',
      ['native:shipping-calculate'],
      'schema-mismatch',
    );
    assert.doesNotMatch(core.exportProduct(product), /\[object Object\]|"unsafe"/, field);
  }
});

test('Delivery alias-conflict quarantine and a later valid item remain isolated in separate cache buckets', () => {
  const relayFixture = loadFixture('product-1005008195850531.json');
  const dressFixture = loadFixture('product-1005009452926938.json');
  const shippingFixture = loadFixture('shipping-calculate-1005008195850531.json');
  const itemA = relayFixture.data.id;
  const skuA = shippingFixture.request.skuId;
  const itemB = dressFixture.data.id;
  const skuB = '12000049151727540';
  const productA = core.normalizeProduct(
    relayFixture.data,
    `https://aliexpress.ru/item/${itemA}.html?sku_id=${skuA}`,
  );
  const productB = core.normalizeProduct(
    dressFixture.data,
    `https://aliexpress.ru/item/${itemB}.html?sku_id=${skuB}`,
  );
  const cache = core.createDeliveryCache();
  const conflictingARequest = {
    ...shippingFixture.request,
    productId: Number(itemA),
    productIdV2: itemB,
  };
  const conflictingA = core.cacheDeliveryCapture(
    cache,
    conflictingARequest,
    shippingFixture.response,
    itemA,
    skuA,
  );
  assert.equal(conflictingA.matched, true);
  assert.equal(conflictingA.delivery, null);
  assert.equal(conflictingA.diagnostic, 'schema-mismatch');
  const environmentA = core.createShippingEnvironment(conflictingARequest, conflictingA.normalized);
  const quarantinedA = core.applyCachedDelivery(productA, cache, environmentA);
  assert.equal(quarantinedA.delivery, null);
  assertSection(
    quarantinedA._meta.sections.delivery,
    'invalid',
    ['native:shipping-calculate'],
    'schema-mismatch',
  );

  const validBRequest = {
    ...shippingFixture.request,
    productId: Number(itemB),
    productIdV2: itemB,
    skuId: skuB,
    tradeCurrency: productB.price.current.currency,
    buyerPrice: productB.selectedSku.buyerPriceForLogistic,
    minPrice: productB.price.current.value,
    maxPrice: productB.price.current.value,
  };
  const validB = core.cacheDeliveryCapture(
    cache,
    validBRequest,
    shippingFixture.response,
    itemB,
    skuB,
  );
  assert.equal(validB.matched, true);
  assert.equal(validB.diagnostic, null);
  const environmentB = core.createShippingEnvironment(validBRequest, validB.normalized);
  const deliveredB = core.applyCachedDelivery(productB, cache, environmentB);
  assert.equal(deliveredB.delivery.productId, itemB);
  assert.equal(deliveredB.delivery.skuId, skuB);
  assertSection(deliveredB._meta.sections.delivery, 'present', ['native:shipping-calculate']);

  const stillQuarantinedA = core.applyCachedDelivery(productA, cache, environmentA);
  assert.equal(stillQuarantinedA.delivery, null);
  assertSection(
    stillQuarantinedA._meta.sections.delivery,
    'invalid',
    ['native:shipping-calculate'],
    'schema-mismatch',
  );
});

test('Delivery diagnostics expose malformed matching capture and reset/restore across SKU switches', () => {
  const productFixture = loadFixture('product-1005008195850531.json');
  const shippingFixture = loadFixture('shipping-calculate-1005008195850531.json');
  const pageA = 'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689';
  const malformedResponse = { ...shippingFixture.response, methods: 'invalid-methods' };
  const malformedInspection = core.inspectDeliveryCapture(
    shippingFixture.request,
    malformedResponse,
    '1005008195850531',
    '12000056550848689',
  );
  assert.equal(malformedInspection.matched, true);
  assert.equal(malformedInspection.delivery, null);
  assert.equal(malformedInspection.diagnostic, 'schema-mismatch');

  const malformedCache = core.createDeliveryCache();
  core.cacheDeliveryCapture(malformedCache, shippingFixture.request, malformedResponse);
  const malformedEnvironment = core.createShippingEnvironment(shippingFixture.request, malformedInspection.normalized);
  const malformed = core.applyCachedDelivery(
    core.normalizeProduct(productFixture.data, pageA),
    malformedCache,
    malformedEnvironment,
  );
  assert.equal(malformed.delivery, null);
  assertSection(malformed._meta.sections.delivery, 'invalid', ['native:shipping-calculate'], 'schema-mismatch');

  const cache = core.createDeliveryCache();
  const captured = core.cacheDeliveryCapture(cache, shippingFixture.request, shippingFixture.response);
  const environment = core.createShippingEnvironment(shippingFixture.request, captured.delivery);
  let product = core.applyCachedDelivery(core.normalizeProduct(productFixture.data, pageA), cache, environment);
  assertSection(product._meta.sections.delivery, 'present', ['native:shipping-calculate']);

  product = core.updateSelectedSku(
    product,
    'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848683',
  );
  assert.equal(product.delivery, null);
  assertSection(product._meta.sections.delivery, 'not-observed');
  product = core.applyCachedDelivery(product, cache, environment);
  assertSection(product._meta.sections.delivery, 'not-observed');

  product = core.updateSelectedSku(product, pageA);
  product = core.applyCachedDelivery(product, cache, environment);
  assert.equal(product.delivery.skuId, '12000056550848689');
  assertSection(product._meta.sections.delivery, 'present', ['native:shipping-calculate']);
});

test('pre-export page synchronization switches Relay SKU immediately and handles Delivery by exact cache context', () => {
  const productFixture = loadFixture('product-1005008195850531.json');
  const shippingFixture = loadFixture('shipping-calculate-1005008195850531.json');
  const skuA = '12000056550848689';
  const skuB = '12000056550848683';
  const pageA = `https://aliexpress.ru/item/1005008195850531.html?sku_id=${skuA}`;
  const pageB = `https://aliexpress.ru/item/1005008195850531.html?sku_id=${skuB}`;
  const cache = core.createDeliveryCache();
  const capturedA = core.cacheDeliveryCapture(cache, shippingFixture.request, shippingFixture.response);
  const environment = core.createShippingEnvironment(shippingFixture.request, capturedA.delivery);
  const initial = core.applyCachedDelivery(core.normalizeProduct(productFixture.data, pageA), cache, environment);
  assert.equal(initial.delivery.skuId, skuA);
  assertSection(initial._meta.sections.delivery, 'present', ['native:shipping-calculate']);

  const cleared = core.synchronizeProductPageContext(initial, pageB, cache, environment);
  assert.equal(cleared.selectedSkuId, skuB);
  assert.equal(cleared.selectedSku.selections[0].name, '1CH Zigbee 7-32V');
  assert.equal(cleared.price.current.value, '6.6');
  assert.equal(cleared.url, pageB);
  assert.equal(cleared.delivery, null);
  assertSection(cleared._meta.sections.delivery, 'not-observed');

  const stableSections = ['sizeGuide', 'gallery', 'ratingSummary', 'store', 'characteristics', 'description'];
  for (const section of stableSections) {
    assert.equal(cleared[section], initial[section]);
    assert.equal(cleared._meta.sections[section], initial._meta.sections[section]);
  }
  const initialMeta = clone(initial._meta);
  const clearedMeta = clone(cleared._meta);
  delete initialMeta.sections.delivery;
  delete clearedMeta.sections.delivery;
  assert.deepEqual(clearedMeta, initialMeta);

  const chatgpt = core.exportForChatGPT(cleared);
  assert.match(chatgpt, new RegExp(`Selected SKU: ${skuB}`));
  assert.match(chatgpt, /Selected variants: Bundle: 1CH Zigbee 7-32V/);
  assert.match(chatgpt, /Price: \$\s*6\.60/);
  assert.doesNotMatch(chatgpt, new RegExp(`Selected SKU: ${skuA}`));

  const requestB = {
    ...shippingFixture.request,
    skuId: skuB,
    buyerPrice: '660',
    minPrice: 6.6,
    maxPrice: 6.6,
  };
  const capturedB = core.cacheDeliveryCapture(cache, requestB, shippingFixture.response);
  const restored = core.synchronizeProductPageContext(initial, pageB, cache, environment);
  assert.deepEqual(restored.delivery, capturedB.delivery);
  assert.equal(restored.delivery.skuId, skuB);
  assertSection(restored._meta.sections.delivery, 'present', ['native:shipping-calculate']);
  for (const section of stableSections) {
    assert.equal(restored[section], initial[section]);
    assert.equal(restored._meta.sections[section], initial._meta.sections[section]);
  }
});

test('pre-poll SPA callbacks synchronize location before accepting ProductData or shipping', async () => {
  const dressFixture = loadFixture('product-1005009452926938.json');
  const relayFixture = loadFixture('product-1005008195850531.json');
  const shippingFixture = loadFixture('shipping-calculate-1005008195850531.json');
  const itemA = dressFixture.data.id;
  const itemB = relayFixture.data.id;
  const skuA = '12000049151727540';
  const skuB = shippingFixture.request.skuId;
  const liveLocation = {
    href: `https://aliexpress.ru/item/${itemA}.html?sku_id=${skuA}`,
  };
  const listeners = new Map();
  const fakeDocument = {
    title: 'Synthetic AliExpress item',
    readyState: 'loading',
    body: null,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const requests = [];
  const nativeFetch = (input, init) => {
    let resolveResponse;
    const promise = new Promise((resolve) => { resolveResponse = resolve; });
    const request = {
      url: typeof input === 'string' ? input : input.url,
      init,
      promise,
      respond(payload) {
        resolveResponse({
          clone() {
            return { json: async () => payload };
          },
        });
      },
    };
    requests.push(request);
    return promise;
  };
  const pageWindow = { fetch: nativeFetch, location: liveLocation };
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: liveLocation });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  let runtime = null;
  const flushCallbacks = () => new Promise((resolve) => setImmediate(resolve));
  try {
    runtime = core.startProductPage(pageWindow, {});

    const delayedProductAPromise = pageWindow.fetch(
      `https://aliexpress.ru/api/productData?item=${itemA}`,
    );
    const delayedProductA = requests.at(-1);
    const delayedShippingARequest = {
      ...shippingFixture.request,
      productId: Number(itemA),
      productIdV2: itemA,
      skuId: skuA,
    };
    const delayedShippingAPromise = pageWindow.fetch(
      'https://aliexpress.ru/aer-api/v1/pdp/web/freight/calculate',
      { method: 'POST', body: JSON.stringify(delayedShippingARequest) },
    );
    const delayedShippingA = requests.at(-1);

    liveLocation.href = `https://aliexpress.ru/item/${itemB}.html?sku_id=${skuB}`;
    const productBPromise = pageWindow.fetch(
      `https://aliexpress.ru/api/productData?item=${itemB}`,
    );
    const productBRequest = requests.at(-1);
    productBRequest.respond({ data: relayFixture.data });
    await productBPromise;
    await flushCallbacks();
    await flushCallbacks();

    assert.equal(runtime.itemId, itemB);
    assert.equal(runtime.product.itemId, itemB);
    assert.equal(runtime.product.selectedSkuId, skuB);

    const shippingBPromise = pageWindow.fetch(
      'https://aliexpress.ru/aer-api/v1/pdp/web/freight/calculate',
      { method: 'POST', body: JSON.stringify(shippingFixture.request) },
    );
    const shippingBRequest = requests.at(-1);
    shippingBRequest.respond(shippingFixture.response);
    await shippingBPromise;
    await flushCallbacks();
    await flushCallbacks();
    assert.equal(runtime.shippingCapture.request.productIdV2, itemB);
    assert.equal(runtime.product.delivery.skuId, skuB);
    const acceptedProductB = runtime.product;
    const acceptedShippingB = runtime.shippingCapture;
    const acceptedEnvironmentB = runtime.shippingEnvironment;
    assert.equal(core.shippingCaptureMatchesProduct(acceptedShippingB, acceptedProductB), true);

    delayedProductA.respond({ data: dressFixture.data });
    delayedShippingA.respond(shippingFixture.response);
    await Promise.all([delayedProductAPromise, delayedShippingAPromise]);
    await flushCallbacks();
    await flushCallbacks();

    assert.equal(runtime.product, acceptedProductB);
    assert.equal(runtime.product.itemId, itemB);
    assert.equal(runtime.product.delivery.skuId, skuB);
    assert.equal(runtime.shippingCapture, acceptedShippingB);

    const otherSkuId = '12000056550848683';
    const otherPageUrl = `https://aliexpress.ru/item/${itemB}.html?sku_id=${otherSkuId}`;
    const otherSkuProduct = core.updateSelectedSku(runtime.product, otherPageUrl);
    const otherSkuRequest = {
      ...shippingFixture.request,
      skuId: otherSkuId,
      buyerPrice: otherSkuProduct.selectedSku.buyerPriceForLogistic,
      minPrice: otherSkuProduct.price.current.value,
      maxPrice: otherSkuProduct.price.current.value,
    };
    const otherSkuPromise = pageWindow.fetch(
      'https://aliexpress.ru/aer-api/v1/pdp/web/freight/calculate',
      { method: 'POST', body: JSON.stringify(otherSkuRequest) },
    );
    const otherSkuCapture = requests.at(-1);
    otherSkuCapture.respond(shippingFixture.response);
    await otherSkuPromise;
    await flushCallbacks();
    await flushCallbacks();
    assert.equal(runtime.shippingCapture, acceptedShippingB);
    assert.equal(runtime.shippingEnvironment, acceptedEnvironmentB);
    assert.equal(runtime.product.selectedSkuId, skuB);
    assert.equal(runtime.product.delivery.skuId, skuB);

    const delayedOldSkuPromise = pageWindow.fetch(
      'https://aliexpress.ru/aer-api/v1/pdp/web/freight/calculate',
      { method: 'POST', body: JSON.stringify(shippingFixture.request) },
    );
    const delayedOldSkuCapture = requests.at(-1);
    liveLocation.href = otherPageUrl;
    runtime.refreshProductEnrichment();
    assert.equal(runtime.product.selectedSkuId, otherSkuId);
    assert.equal(runtime.shippingCapture, null);
    assert.equal(core.shippingCaptureMatchesProduct(acceptedShippingB, runtime.product), false);
    const environmentAfterSwitch = runtime.shippingEnvironment;

    delayedOldSkuCapture.respond(shippingFixture.response);
    await delayedOldSkuPromise;
    await flushCallbacks();
    await flushCallbacks();
    assert.equal(runtime.product.selectedSkuId, otherSkuId);
    assert.equal(runtime.shippingCapture, null);
    assert.equal(runtime.shippingEnvironment, environmentAfterSwitch);
  } finally {
    runtime?.dispose();
    if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
    else delete globalThis.location;
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else delete globalThis.document;
  }
});

test('runtime keeps accepted DOM history across A to B to C so a later A reappearance stays quarantined', async () => {
  const productAData = loadFixture('product-1005008195850531.json').data;
  const productBData = loadFixture('product-1005009452926938.json').data;
  const itemA = productAData.id;
  const itemB = productBData.id;
  const itemC = '1005000000000003';
  const productCData = { ...clone(productAData), id: itemC, name: 'Synthetic distinct product C' };
  const characteristicsA = syntheticCharacteristicsDom([{ name: 'Runtime stage', value: 'A' }]);
  const characteristicsB = syntheticCharacteristicsDom([{ name: 'Runtime stage', value: 'B' }]);
  let mountedCharacteristics = characteristicsA;
  const liveLocation = { href: `https://aliexpress.ru/item/${itemA}.html` };
  const listeners = new Map();
  const fakeDocument = {
    title: 'Synthetic AliExpress item',
    readyState: 'loading',
    body: null,
    querySelector() { return null; },
    querySelectorAll(selector) {
      return mountedCharacteristics.querySelectorAll(selector);
    },
    getElementById() { return null; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const requests = [];
  const nativeFetch = (input) => {
    let resolveResponse;
    const promise = new Promise((resolve) => { resolveResponse = resolve; });
    requests.push({
      promise,
      respond(payload) {
        resolveResponse({ clone: () => ({ json: async () => payload }) });
      },
      url: typeof input === 'string' ? input : input.url,
    });
    return promise;
  };
  const pageWindow = { fetch: nativeFetch, location: liveLocation };
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: liveLocation });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  const flushCallbacks = () => new Promise((resolve) => setImmediate(resolve));
  const respondWithProduct = async (itemId, data) => {
    const promise = pageWindow.fetch(`https://aliexpress.ru/api/productData?item=${itemId}`);
    requests.at(-1).respond({ data });
    await promise;
    await flushCallbacks();
    await flushCallbacks();
  };
  let runtime = null;
  try {
    runtime = core.startProductPage(pageWindow, {});
    await respondWithProduct(itemA, productAData);
    runtime.refreshProductEnrichment();
    assert.deepEqual(runtime.product.characteristics, [{ name: 'Runtime stage', value: 'A' }]);
    assert.equal(runtime.characteristicsBoundary, characteristicsA.boundary);

    liveLocation.href = `https://aliexpress.ru/item/${itemB}.html`;
    await respondWithProduct(itemB, productBData);
    assert.deepEqual(
      runtime.staleCharacteristicsObservations.map((observation) => observation.boundary),
      [characteristicsA.boundary],
    );

    mountedCharacteristics = characteristicsB;
    runtime.refreshProductEnrichment();
    assert.deepEqual(runtime.product.characteristics, [{ name: 'Runtime stage', value: 'B' }]);
    assert.equal(runtime.characteristicsBoundary, characteristicsB.boundary);
    assert.deepEqual(
      runtime.staleCharacteristicsObservations.map((observation) => observation.boundary),
      [characteristicsA.boundary],
    );

    liveLocation.href = `https://aliexpress.ru/item/${itemC}.html`;
    await respondWithProduct(itemC, productCData);
    assert.equal(runtime.itemId, itemC);
    assert.equal(runtime.product.itemId, itemC);
    assert.deepEqual(
      runtime.staleCharacteristicsObservations.map((observation) => observation.boundary),
      [characteristicsA.boundary, characteristicsB.boundary],
    );

    mountedCharacteristics = characteristicsA;
    runtime.refreshProductEnrichment();
    assert.deepEqual(runtime.product.characteristics, []);
    assert.equal(runtime.characteristicsBoundary, null);
    assertSection(runtime.product._meta.sections.characteristics, 'not-observed');
  } finally {
    runtime?.dispose();
    if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
    else delete globalThis.location;
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else delete globalThis.document;
  }
});

test('SSR inspection cache reruns every inspector on same-node hydration and reuses an unchanged snapshot', () => {
  const itemId = '1005008195850531';
  const script = { textContent: '{"phase":"shell"}' };
  const calls = { rating: 0, gallery: 0, store: 0 };
  const inspectors = Object.fromEntries(Object.keys(calls).map((name) => [
    name,
    (expectedItemId, currentScript) => {
      calls[name] += 1;
      return { expectedItemId, text: currentScript.textContent, name };
    },
  ]));

  const shell = core.refreshSsrInspectionCache(null, itemId, script, inspectors);
  assert.deepEqual(calls, { rating: 1, gallery: 1, store: 1 });
  const reusedShell = core.refreshSsrInspectionCache(shell, itemId, script, inspectors);
  assert.equal(reusedShell, shell);
  assert.deepEqual(calls, { rating: 1, gallery: 1, store: 1 });

  script.textContent = '{"phase":"hydrated"}';
  const hydrated = core.refreshSsrInspectionCache(reusedShell, itemId, script, inspectors);
  assert.notEqual(hydrated, shell);
  assert.equal(hydrated.script, script);
  assert.equal(hydrated.text, script.textContent);
  assert.deepEqual(calls, { rating: 2, gallery: 2, store: 2 });
  for (const name of Object.keys(calls)) {
    assert.deepEqual(hydrated.inspections[name], { expectedItemId: itemId, text: script.textContent, name });
  }

  const reusedHydrated = core.refreshSsrInspectionCache(hydrated, itemId, script, inspectors);
  assert.equal(reusedHydrated, hydrated);
  assert.deepEqual(calls, { rating: 2, gallery: 2, store: 2 });
});

test('ProductData interceptor binds id-less candidates to safe request query identity instead of the current page', async () => {
  const itemA = '1005008195850531';
  const itemB = '1005009452926938';
  const idlessData = { skuInfo: { propertyList: [], priceList: [] } };
  const pageWindow = {
    location: { href: `https://aliexpress.ru/item/${itemB}.html` },
    fetch() {
      return Promise.resolve({ clone: () => ({ json: async () => ({ data: idlessData }) }) });
    },
  };
  const capturedData = [];
  core.installProductDataInterceptor(
    pageWindow,
    (data, meta) => capturedData.push({
      data,
      meta,
      boundToCurrentPage: core.isProductDataBoundToItem(data, itemB, meta),
    }),
  );

  await pageWindow.fetch(`/api/productData?itemId=${itemA}`);
  await pageWindow.fetch(`/api/productData?itemId=${itemA}&productId=${itemB}`);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(capturedData.length, 2);
  assert.equal(capturedData[0].data, idlessData);
  assert.equal(capturedData[0].meta.requestItemId, itemA);
  assert.equal(capturedData[0].boundToCurrentPage, false);
  assert.equal(capturedData[1].meta.requestItemId, null);
  assert.equal(capturedData[1].boundToCurrentPage, false);
  assert.equal(core.productDataRequestItemId(
    `/api/productData?itemId=${itemA}&productId=${itemB}`,
    pageWindow.location.href,
  ), null);
});

test('multi-hop SPA transitions retain the last real stale snapshot until a new boundary replaces it', () => {
  const boundaryA = { id: 'boundary-a' };
  const storeA = core.normalizeStore({ name: 'Store A' });
  const acceptedA = core.preserveStaleSectionObservation(null, boundaryA, storeA, null);
  assert.deepEqual(acceptedA, { boundary: boundaryA, value: storeA, diagnostic: null });

  const emptyTransitionB = core.preserveStaleSectionObservation(acceptedA, null, null, 'schema-mismatch');
  assert.equal(emptyTransitionB, acceptedA);
  assert.equal(core.isStaleStore(
    boundaryA,
    clone(storeA),
    emptyTransitionB.boundary,
    emptyTransitionB.value,
    null,
    emptyTransitionB.diagnostic,
  ), true);

  const boundaryB = { id: 'boundary-b' };
  const storeB = core.normalizeStore({ name: 'Store B' });
  const replacedByB = core.preserveStaleSectionObservation(
    emptyTransitionB,
    boundaryB,
    storeB,
    null,
  );
  assert.notEqual(replacedByB, acceptedA);
  assert.deepEqual(replacedByB, { boundary: boundaryB, value: storeB, diagnostic: null });
  assert.equal(core.isStaleStore(
    boundaryA,
    clone(storeA),
    replacedByB.boundary,
    replacedByB.value,
    null,
    replacedByB.diagnostic,
  ), false);
  assert.equal(core.isStaleStore(
    boundaryB,
    clone(storeB),
    replacedByB.boundary,
    replacedByB.value,
    null,
    replacedByB.diagnostic,
  ), true);
});

test('phase-aware DOM snapshots retain recorded A and live B histories before C', () => {
  const itemA = '1005008195850531';
  const itemB = '1005009452926938';
  const urlA = `https://aliexpress.ru/item/${itemA}.html`;
  const urlB = `https://aliexpress.ru/item/${itemB}.html`;
  const characteristicsA = syntheticCharacteristicsDom([{ name: 'Stage', value: 'A' }]);
  const characteristicsB = syntheticCharacteristicsDom([{ name: 'Stage', value: 'B' }]);
  const descriptionA = syntheticDescriptionDom('<p>Description A</p>');
  const descriptionB = syntheticDescriptionDom('<p>Description B</p>');
  const combinedRoot = (characteristics, description, title = null) => {
    const header = title ? {
      querySelector(selector) {
        return selector === 'h1' ? { textContent: title } : null;
      },
    } : null;
    return {
      querySelectorAll(selector) {
        if (header && selector.includes('HazeProductDescription__root')) return [header];
        return characteristics.querySelectorAll(selector);
      },
      querySelector(selector) {
        return description.querySelector(selector);
      },
    };
  };
  const liveDomA = combinedRoot(characteristicsA, descriptionA);
  const liveDomB = combinedRoot(characteristicsB, descriptionB);
  const unrecordedA = {
    product: syntheticProduct(itemA),
    characteristicsBoundary: null,
    characteristics: [],
    characteristicsDiagnostic: null,
    descriptionBoundary: null,
    description: null,
    descriptionDiagnostic: null,
  };
  const quarantinedA = core.snapshotStaleDomObservations(unrecordedA, liveDomA, itemA, urlA);
  assert.equal(quarantinedA.characteristics.boundary, characteristicsA.boundary, 'unrecorded A characteristics');
  assert.deepEqual(quarantinedA.characteristics.value, [{ name: 'Stage', value: 'A' }]);
  assert.equal(quarantinedA.description.boundary, descriptionA.boundary, 'unrecorded A description');
  assert.equal(quarantinedA.description.value.text, 'Description A');

  const recordedA = {
    product: syntheticProduct(itemA),
    characteristicsBoundary: characteristicsA.boundary,
    characteristics: [{ name: 'Stage', value: 'A' }],
    characteristicsDiagnostic: null,
    descriptionBoundary: descriptionA.boundary,
    description: core.inspectDescriptionFromDom(descriptionA, urlA).description,
    descriptionDiagnostic: null,
  };

  const outgoingA = core.snapshotStaleDomObservations(recordedA, liveDomB, itemA, urlA);
  assert.equal(outgoingA.characteristics.boundary, characteristicsB.boundary);
  assert.deepEqual(outgoingA.characteristics.value, [{ name: 'Stage', value: 'B' }]);
  assert.deepEqual(
    outgoingA.characteristics.history.map((observation) => observation.boundary),
    [characteristicsA.boundary, characteristicsB.boundary],
  );
  assert.equal(outgoingA.description.boundary, descriptionB.boundary);
  assert.equal(outgoingA.description.value.text, 'Description B');
  assert.deepEqual(
    outgoingA.description.history.map((observation) => observation.boundary),
    [descriptionA.boundary, descriptionB.boundary],
  );

  const productlessB = {
    product: null,
    staleCharacteristicsObservations: outgoingA.characteristics.history,
    staleCharacteristicsBoundary: outgoingA.characteristics.boundary,
    staleCharacteristics: outgoingA.characteristics.value,
    staleCharacteristicsDiagnostic: outgoingA.characteristics.diagnostic,
    characteristicsBoundary: null,
    characteristics: [],
    characteristicsDiagnostic: null,
    staleDescriptionObservations: outgoingA.description.history,
    staleDescriptionBoundary: outgoingA.description.boundary,
    staleDescription: outgoingA.description.value,
    staleDescriptionDiagnostic: outgoingA.description.diagnostic,
    descriptionBoundary: null,
    description: null,
    descriptionDiagnostic: null,
  };
  const outgoingB = core.snapshotStaleDomObservations(productlessB, liveDomB, itemB, urlB);
  assert.equal(outgoingB.characteristics.boundary, characteristicsB.boundary, 'productless B characteristics');
  assert.deepEqual(outgoingB.characteristics.value, [{ name: 'Stage', value: 'B' }]);
  assert.equal(outgoingB.description.boundary, descriptionB.boundary, 'productless B description');
  assert.equal(outgoingB.description.value.text, 'Description B');
  assert.deepEqual(
    outgoingB.characteristics.history.map((observation) => observation.boundary),
    [characteristicsA.boundary, characteristicsB.boundary],
  );
  assert.deepEqual(
    outgoingB.description.history.map((observation) => observation.boundary),
    [descriptionA.boundary, descriptionB.boundary],
  );
  const characteristicsEqual = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((row, index) => (
      row.name === right[index]?.name && row.value === right[index]?.value
    ));
  for (const dom of [characteristicsA, characteristicsB]) {
    const reappeared = core.inspectCharacteristicsFromDom(dom);
    assert.equal(core.matchesStaleSectionObservation(
      outgoingB.characteristics.history,
      reappeared.boundary,
      reappeared.characteristics,
      reappeared.diagnostic,
      characteristicsEqual,
    ), true);
  }
  for (const [dom, pageUrl] of [[descriptionA, urlA], [descriptionB, urlB]]) {
    const reappeared = core.inspectDescriptionFromDom(dom, pageUrl);
    assert.equal(core.matchesStaleSectionObservation(
      outgoingB.description.history,
      reappeared.boundary,
      reappeared.description,
      reappeared.diagnostic,
      core.descriptionsEqual,
    ), true);
  }

  const overlapAB = core.inspectCharacteristicsFromDom({
    querySelectorAll(selector) {
      return selector.includes('HazeProductCharacteristics__groupsContainerForSku')
        ? [characteristicsA.boundary, characteristicsB.boundary]
        : [];
    },
  });
  assert.deepEqual(overlapAB.characteristics, []);
  assert.equal(overlapAB.diagnostic, 'conflict');
  const productB = core.normalizeProduct(
    loadFixture('product-1005009452926938.json').data,
    urlB,
  );
  const liveBOnly = combinedRoot(characteristicsB, descriptionB, productB.title);
  const refreshedOutgoingB = core.snapshotStaleDomObservations({
    product: productB,
    staleCharacteristicsObservations: outgoingB.characteristics.history,
    characteristicsBoundary: overlapAB.boundary,
    characteristics: overlapAB.characteristics,
    characteristicsDiagnostic: overlapAB.diagnostic,
  }, liveBOnly, itemB, urlB);
  assert.equal(refreshedOutgoingB.characteristics.boundary, characteristicsB.boundary, 'refreshed B characteristics');
  assert.deepEqual(refreshedOutgoingB.characteristics.value, [{ name: 'Stage', value: 'B' }]);
  assert.equal(refreshedOutgoingB.characteristics.diagnostic, null);

  const unchangedCharacteristicsBAtC = core.inspectCharacteristicsFromDom(liveBOnly);
  assert.equal(core.matchesStaleSectionObservation(
    refreshedOutgoingB.characteristics.history,
    unchangedCharacteristicsBAtC.boundary,
    unchangedCharacteristicsBAtC.characteristics,
    unchangedCharacteristicsBAtC.diagnostic,
    characteristicsEqual,
  ), true);

  const unchangedBAtC = core.inspectDescriptionFromDom(descriptionB, urlB);
  assert.equal(core.isStaleDescription(
    unchangedBAtC.boundary,
    unchangedBAtC.description,
    outgoingB.description.boundary,
    outgoingB.description.value,
    unchangedBAtC.diagnostic,
    outgoingB.description.diagnostic,
  ), true);
});

test('same-item ProductData refresh carries section values and diagnostics while a new item starts clean', () => {
  const relayFixture = loadFixture('product-1005008195850531.json');
  const dressFixture = loadFixture('product-1005009452926938.json');
  const galleryFixture = loadFixture('gallery-1005008195850531.json');
  const descriptionFixture = loadFixture('description-1005008195850531.json');
  const gallery = core.inspectGalleryFromSsrData(galleryFixture, galleryFixture.props.id);
  const description = core.inspectDescriptionFromDom(
    syntheticDescriptionDom(descriptionFixture.fragments.textThenImages),
    'https://aliexpress.ru/item/1005008195850531.html',
  );
  let enriched = core.normalizeProduct(relayFixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  enriched = core.enrichProductFallbacks(enriched, {
    galleryInspection: asObservation(gallery, 'gallery'),
    structuredRatingInspection: { value: { rating: 5, reviewCount: 5, display: {} }, diagnostic: null, observed: true },
    structuredStoreInspection: { value: core.normalizeStore({ name: 'Captured store' }), diagnostic: null, observed: true },
    characteristicsInspection: { value: [{ name: 'Material', value: 'Plastic' }], diagnostic: null, observed: true },
    descriptionInspection: asObservation(description, 'description'),
  });
  enriched.delivery = { productId: enriched.itemId, skuId: enriched.selectedSkuId, methods: [] };
  enriched._meta.sections.delivery = core.createSectionDiagnostic('present', ['native:shipping-calculate']);

  const sameBase = core.normalizeProduct(relayFixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  const carried = core.carryProductSections(sameBase, enriched);
  for (const section of ['gallery', 'ratingSummary', 'store', 'characteristics', 'description']) {
    assert.equal(carried[section], enriched[section]);
    assert.equal(carried._meta.sections[section], enriched._meta.sections[section]);
  }
  assert.equal(carried.delivery, null);
  assertSection(carried._meta.sections.delivery, 'not-observed');

  const newBase = core.normalizeProduct(dressFixture.data, 'https://aliexpress.ru/item/1005009452926938.html');
  assert.equal(core.carryProductSections(newBase, enriched), newBase);
  for (const section of ['gallery', 'ratingSummary', 'store', 'description']) {
    assert.equal(newBase[section], null);
    assertSection(newBase._meta.sections[section], 'not-observed');
  }
  assert.deepEqual(newBase.characteristics, []);
  assertSection(newBase._meta.sections.characteristics, 'not-observed');
  assertSection(newBase._meta.sections.sizeGuide, 'present', ['productData']);
});

test('enrichment updates values and diagnostics atomically, remains refresh-stable, and does not alter ChatGPT format', () => {
  const fixture = loadFixture('product-1005008195850531.json');
  const galleryFixture = loadFixture('gallery-1005008195850531.json');
  const base = core.normalizeProduct(fixture.data, 'https://aliexpress.ru/item/1005008195850531.html');
  const missing = core.enrichProductFallbacks(base, {
    galleryInspection: { value: null, diagnostic: null, observed: true },
  });
  assert.equal(missing.gallery, null);
  assertSection(missing._meta.sections.gallery, 'missing', ['ssr:__AER_DATA__']);

  const invalid = core.enrichProductFallbacks(missing, {
    galleryInspection: { value: null, diagnostic: 'schema-mismatch', observed: true },
  });
  assert.equal(invalid.gallery, null);
  assertSection(invalid._meta.sections.gallery, 'invalid', ['ssr:__AER_DATA__'], 'schema-mismatch');

  const gallery = core.inspectGalleryFromSsrData(galleryFixture, galleryFixture.props.id).gallery;
  const presentInput = { galleryInspection: { value: gallery, diagnostic: null, observed: true } };
  const present = core.enrichProductFallbacks(invalid, presentInput);
  assert.equal(present.gallery, gallery);
  assertSection(present._meta.sections.gallery, 'present', ['ssr:__AER_DATA__']);
  assert.equal(core.enrichProductFallbacks(present, presentInput), present);

  for (const diagnostic of ['conflict', 'schema-mismatch', 'traversal-limit']) {
    const degraded = core.enrichProductFallbacks(present, {
      galleryInspection: { value: null, diagnostic, observed: true },
    });
    assert.notEqual(degraded, present);
    assert.equal(degraded.gallery, null);
    assertSection(degraded._meta.sections.gallery, 'invalid', ['ssr:__AER_DATA__'], diagnostic);
    assert.equal(present.gallery, gallery);
    assertSection(present._meta.sections.gallery, 'present', ['ssr:__AER_DATA__']);
  }

  const withMetadata = core.exportForChatGPT(present);
  const withoutMetadataProduct = { ...present, _meta: { ...present._meta } };
  delete withoutMetadataProduct._meta.sections;
  assert.equal(withMetadata, core.exportForChatGPT(withoutMetadataProduct));
  assert.doesNotMatch(withMetadata, /section diagnostics|schema-mismatch|traversal-limit|not-observed/i);
  const fullJson = JSON.parse(core.exportProduct(present));
  assert.deepEqual(fullJson._meta.sections.gallery, present._meta.sections.gallery);
});

test('reviews-page diagnostics and safe export contract remain independent from PDP section metadata', () => {
  const fixture = loadFixture('reviews-ssr-1005009452926938.json');
  const inspection = core.inspectReviewsPageFromSsrData(fixture, fixture.itemId);
  assert.equal(inspection.diagnostic, 'ok');
  assert.equal(inspection.reviewPage.source, 'ssr:__AER_DATA__');
  const exported = JSON.parse(core.exportReviewsPage(inspection.reviewPage));
  assert.deepEqual(Object.keys(exported), ['itemId', 'source', 'reviews']);
  assert.equal(Object.hasOwn(exported, '_meta'), false);

  const malformed = clone(fixture);
  delete malformed.widget.props.reviews[0].root.id;
  assert.equal(core.inspectReviewsPageFromSsrData(malformed, fixture.itemId).diagnostic, 'invalid-candidate');
  assert.doesNotMatch(JSON.stringify(exported), /_bx-v|headers|cookie|authorization|spm/i);
});
