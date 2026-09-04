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

const SECTION_SOURCES = {
  sizeGuide: 'productData',
  gallery: 'ssr:__AER_DATA__',
  ratingSummary: 'ssr:__AER_DATA__',
  store: 'ssr:__AER_DATA__',
  characteristics: 'dom:characteristics',
  description: 'dom:description',
  delivery: 'native:shipping-calculate',
};

function createDiagnostic(section, specification = 'missing') {
  const state = typeof specification === 'string' ? specification : specification.state;
  const diagnostic = typeof specification === 'string' ? null : specification.diagnostic;
  if (state === 'not-observed') return core.createSectionDiagnostic(state);
  return core.createSectionDiagnostic(state, [SECTION_SOURCES[section]], diagnostic);
}

function withSectionStates(product, overrides = {}, selectedSkuResolved = product._meta.selectedSkuResolved) {
  const sections = {};
  [...core.PRODUCT_SECTION_ORDER].reverse().forEach((section) => {
    sections[section] = createDiagnostic(section, overrides[section] || 'missing');
  });
  const next = {
    ...product,
    _meta: { ...product._meta, selectedSkuResolved, sections },
  };
  next._meta.completeness = core.assessProductCompleteness(next);
  return next;
}

function relayProduct(pageUrl = 'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689') {
  return core.normalizeProduct(loadFixture('product-1005008195850531.json').data, pageUrl, {
    source: 'network:productData',
  });
}

test('initial normalization stores deterministic partial completeness without treating Size Guide missing as unresolved', () => {
  const product = relayProduct();
  assert.deepEqual(product._meta.completeness, {
    state: 'partial',
    notObservedSections: ['gallery', 'ratingSummary', 'store', 'characteristics', 'description', 'delivery'],
    invalidSections: [],
    coreIssues: [],
  });
  assert.equal(product._meta.sections.sizeGuide.state, 'missing');
  assert.equal(product._meta.completeness.notObservedSections.includes('sizeGuide'), false);
});

test('present and missing sections are resolved, so multiple known absences still produce complete', () => {
  const product = withSectionStates(relayProduct(), {
    gallery: 'present',
  });
  product.gallery = {
    source: 'ssr',
    items: [{ type: 'image', imageUrl: 'https://example.test/safe.jpg', previewUrl: 'https://example.test/safe.jpg' }],
  };
  const expected = {
    state: 'complete',
    notObservedSections: [],
    invalidSections: [],
    coreIssues: [],
  };
  assert.deepEqual(core.assessProductCompleteness(product), expected);
  assert.deepEqual(JSON.parse(core.exportProduct(product))._meta.completeness, expected);

  const chatgpt = core.exportForChatGPT(product);
  assert.match(chatgpt, /^ALIEXPRESS PRODUCT\n/);
  assert.match(chatgpt, /Data status: COMPLETE/);
  assert.doesNotMatch(chatgpt, /Not observed:|Invalid sections:|Core issues:|_meta|"sources"/);
  assert.equal(core.formatProductStatus(product), 'Complete · 7 combinations · Bundle: 7 · source: API');
});

test('not-observed sections produce deterministic partial warnings while safe product data remains exportable', () => {
  const product = withSectionStates(relayProduct(), {
    gallery: 'present',
    delivery: 'not-observed',
  });
  product.gallery = {
    source: 'ssr',
    items: [{ type: 'image', imageUrl: 'https://example.test/safe.jpg', previewUrl: 'https://example.test/safe.jpg' }],
  };
  const full = JSON.parse(core.exportProduct(product));
  assert.deepEqual(full._meta.completeness, {
    state: 'partial',
    notObservedSections: ['delivery'],
    invalidSections: [],
    coreIssues: [],
  });
  assert.equal(full.title, product.title);
  assert.equal(full.skus.length, 7);

  const chatgpt = core.exportForChatGPT(product);
  assert.match(chatgpt, /Data status: PARTIAL\nNot observed: Delivery/);
  assert.match(chatgpt, /Title: ZIGBEE Smart Switch/);
  assert.match(chatgpt, /GALLERY:\nImages: 1\nVideos: 0/);
  assert.doesNotMatch(chatgpt, /https:\/\/example\.test\/safe\.jpg/);
  assert.equal(full.gallery.items[0].imageUrl, 'https://example.test/safe.jpg');
  assert.doesNotMatch(chatgpt, /"state"|"sources"|section diagnostics/i);
  assert.equal(
    core.formatProductStatus(product),
    'Partial · 7 combinations · Bundle: 7 · not observed: Delivery · source: API',
  );
});

test('invalid sections have priority over partial and retain safe diagnostics in fixed section order', () => {
  const product = withSectionStates(relayProduct(), {
    gallery: { state: 'invalid', diagnostic: 'traversal-limit' },
    characteristics: { state: 'invalid', diagnostic: 'conflict' },
    delivery: 'not-observed',
  });
  const expected = {
    state: 'invalid',
    notObservedSections: ['delivery'],
    invalidSections: [
      { section: 'gallery', diagnostic: 'traversal-limit' },
      { section: 'characteristics', diagnostic: 'conflict' },
    ],
    coreIssues: [],
  };
  assert.deepEqual(core.assessProductCompleteness(product), expected);
  assert.deepEqual(JSON.parse(core.exportProduct(product))._meta.completeness, expected);

  const chatgpt = core.exportForChatGPT(product);
  assert.match(chatgpt, /Data status: INVALID/);
  assert.match(chatgpt, /Invalid sections: Gallery \(traversal-limit\), Characteristics \(conflict\)/);
  assert.match(chatgpt, /Not observed: Delivery/);
  assert.match(chatgpt, /7 real combinations from priceList/);
  assert.doesNotMatch(chatgpt, /"diagnostic"|"sources"|_meta/);
  assert.equal(
    core.formatProductStatus(product),
    'Invalid · 7 combinations · Bundle: 7 · Gallery: traversal-limit, Characteristics: conflict · not observed: Delivery · source: API',
  );
});

test('every established invalid diagnostic makes a resolved product invalid', () => {
  for (const diagnostic of ['traversal-limit', 'conflict', 'schema-mismatch']) {
    const product = withSectionStates(relayProduct(), {
      gallery: { state: 'invalid', diagnostic },
    });
    assert.deepEqual(core.assessProductCompleteness(product), {
      state: 'invalid',
      notObservedSections: [],
      invalidSections: [{ section: 'gallery', diagnostic }],
      coreIssues: [],
    });
  }
});

test('an unresolved selected SKU becomes a deterministic core issue without inventing price or stock', () => {
  const fixture = clone(loadFixture('product-1005008195850531.json'));
  fixture.data.activeSkuId = '99999999999999999';
  const unresolved = core.normalizeProduct(
    fixture.data,
    'https://aliexpress.ru/item/1005008195850531.html',
    { source: 'network:productData' },
  );
  const product = withSectionStates(unresolved, {}, false);
  product._meta.completeness = {
    state: 'complete', notObservedSections: [], invalidSections: [], coreIssues: [],
  };

  const full = JSON.parse(core.exportProduct(product));
  assert.deepEqual(full._meta.completeness, {
    state: 'partial',
    notObservedSections: [],
    invalidSections: [],
    coreIssues: ['selected-sku-unresolved'],
  });
  assert.equal(full.selectedSku, null);
  assert.equal(full.price, null);

  const chatgpt = core.exportForChatGPT(product);
  assert.match(chatgpt, /Data status: PARTIAL\nCore issues: selected SKU unresolved/);
  assert.match(chatgpt, /Selected SKU: 99999999999999999 \(not resolved\)/);
  assert.match(chatgpt, /Price: Selected SKU unresolved; 4 unique SKU prices:/);
  assert.match(chatgpt, /Regular price: —\nStock: —/);
});

test('enrichment, Delivery cache, SKU switches, and same-item refresh keep completeness current', () => {
  const shippingFixture = loadFixture('shipping-calculate-1005008195850531.json');
  const pageA = 'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689';
  const pageB = 'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848683';
  let product = core.enrichProductFallbacks(relayProduct(pageA), {
    galleryInspection: { value: null, diagnostic: null, observed: true },
    structuredRatingInspection: { value: null, diagnostic: null, observed: true },
    structuredStoreInspection: { value: null, diagnostic: null, observed: true },
    characteristicsInspection: { value: null, diagnostic: null, observed: true },
    descriptionInspection: { value: null, diagnostic: null, observed: true },
  });
  assert.deepEqual(product._meta.completeness.notObservedSections, ['delivery']);

  const cache = core.createDeliveryCache();
  const captured = core.cacheDeliveryCapture(cache, shippingFixture.request, shippingFixture.response);
  const environment = core.createShippingEnvironment(shippingFixture.request, captured.delivery);
  product = core.applyCachedDelivery(product, cache, environment);
  assert.equal(product._meta.completeness.state, 'complete');

  const switched = core.synchronizeProductPageContext(product, pageB, cache, environment);
  assert.equal(switched._meta.completeness.state, 'partial');
  assert.deepEqual(switched._meta.completeness.notObservedSections, ['delivery']);

  const restored = core.synchronizeProductPageContext(switched, pageA, cache, environment);
  assert.equal(restored._meta.completeness.state, 'complete');
  assert.deepEqual(restored._meta.completeness.notObservedSections, []);

  const refreshedBase = relayProduct(pageA);
  const carried = core.carryProductSections(refreshedBase, restored);
  assert.equal(carried._meta.sections.gallery.state, 'missing');
  assert.equal(carried._meta.completeness.state, 'partial');
  assert.deepEqual(carried._meta.completeness.notObservedSections, ['delivery']);
  const refreshed = core.applyCachedDelivery(carried, cache, environment);
  assert.equal(refreshed._meta.completeness.state, 'complete');

  const presentGallery = core.enrichProductFallbacks(refreshed, {
    structuredGallery: {
      items: [{ type: 'image', imageUrl: 'https://example.test/gallery.jpg', previewUrl: 'https://example.test/gallery.jpg' }],
    },
  });
  assert.equal(presentGallery._meta.sections.gallery.state, 'present');
  assert.equal(presentGallery._meta.completeness.state, 'complete');
  const invalidGallery = core.enrichProductFallbacks(presentGallery, {
    galleryInspection: { value: null, diagnostic: 'schema-mismatch', observed: true },
  });
  assert.equal(invalidGallery._meta.completeness.state, 'invalid');
  assert.deepEqual(invalidGallery._meta.completeness.invalidSections, [
    { section: 'gallery', diagnostic: 'schema-mismatch' },
  ]);
});
