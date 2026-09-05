'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ali-helper.user.js'), 'utf8');
const ITEM_ID = '321';
const BASE_CONTEXT = Object.freeze({ sort: 1, filters: [], skuFilter: [], pageSize: 10 });

function review(id) {
  return { id, productId: ITEM_ID };
}

function reviews(pageNum, count = 10, prefix = 'default') {
  return Array.from({ length: count }, (_, index) => review(`${prefix}-${pageNum}-${index}`));
}

function batch(pageNum, context = {}, count = 10, prefix = 'default') {
  return {
    itemId: ITEM_ID,
    source: 'native:product-reviews',
    context: { ...BASE_CONTEXT, ...context },
    pageNum,
    reviews: reviews(pageNum, count, prefix),
  };
}

test('passive review retention settings accept exactly the four numeric presets', () => {
  assert.deepEqual(core.PASSIVE_REVIEW_RETENTION_CAP_OPTIONS, [10, 30, 50, 100]);
  for (const cap of [10, 30, 50, 100]) {
    assert.equal(core.isPassiveReviewRetentionCap(cap), true);
    assert.equal(core.normalizeSettings({ passiveReviewRetentionCap: cap }).passiveReviewRetentionCap, cap);
  }
});

test('stored passive review retention rejects malformed and non-preset values without clamping', () => {
  const rejected = [
    '30', ' 30 ', 30.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY, {}, [], 20, 200, 999, new Number(30),
  ];
  for (const value of rejected) {
    assert.equal(core.isPassiveReviewRetentionCap(value), false, `reject ${String(value)}`);
    assert.equal(core.normalizeSettings({ passiveReviewRetentionCap: value }).passiveReviewRetentionCap, 30);
  }
});

test('settings load defaults old storage to 30, preserves unknown fields, and performs no rewrite', () => {
  const oldSettings = Object.freeze({ autoRedirectComToRu: false, panelCollapsed: true, futureField: 'preserved' });
  const reads = [];
  const loaded = core.loadSettings((key, fallback) => {
    reads.push({ key, fallback });
    return oldSettings;
  });
  assert.deepEqual(reads, [{ key: 'ali-helper:settings:v1', fallback: {} }]);
  assert.deepEqual(loaded, {
    autoRedirectComToRu: false,
    panelCollapsed: true,
    passiveReviewRetentionCap: 30,
    futureField: 'preserved',
  });
  assert.deepEqual(oldSettings, { autoRedirectComToRu: false, panelCollapsed: true, futureField: 'preserved' });
  const loadStart = source.indexOf('function loadSettings');
  const loadEnd = source.indexOf('function saveSettings', loadStart);
  assert.doesNotMatch(source.slice(loadStart, loadEnd), /GM_setValue|saveSettings/);
});

test('missing and malformed settings containers resolve to independent default objects', () => {
  const missing = core.normalizeSettings({});
  const malformed = [null, undefined, false, 'settings', [], 7]
    .map((value) => core.normalizeSettings(value));
  assert.equal(missing.passiveReviewRetentionCap, 30);
  malformed.forEach((settings) => assert.deepEqual(settings, core.DEFAULT_SETTINGS));
  missing.panelCollapsed = true;
  assert.equal(core.DEFAULT_SETTINGS.panelCollapsed, false);
});

test('interactive selection stores a number, preserves unrelated settings, and rejects tampering visibly upstream', () => {
  const saved = [];
  const runtime = {
    settings: { ...core.DEFAULT_SETTINGS, futureField: 'preserved' },
    reviewCache: core.createReviewCache(ITEM_ID, 30),
    reviewPage: null,
  };
  const accepted = core.applyPassiveReviewRetentionCapSelection(
    runtime,
    '50',
    (settings) => saved.push({ ...settings }),
  );
  assert.deepEqual(accepted, { accepted: true, preference: 50, activeCaptureCap: null });
  assert.equal(runtime.settings.passiveReviewRetentionCap, 50);
  assert.equal(runtime.reviewCache.defaultCap, 50);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].passiveReviewRetentionCap, 50);
  assert.equal(typeof saved[0].passiveReviewRetentionCap, 'number');
  assert.equal(saved[0].futureField, 'preserved');

  for (const invalid of ['20', '200', '999', ' 50 ', '50.0', '', 50, null, {}]) {
    const rejected = core.applyPassiveReviewRetentionCapSelection(runtime, invalid, () => saved.push('unexpected'));
    assert.deepEqual(rejected, { accepted: false, preference: 50, activeCaptureCap: null });
    assert.equal(runtime.settings.passiveReviewRetentionCap, 50);
    assert.equal(runtime.reviewCache.defaultCap, 50);
    assert.equal(saved.length, 1);
  }
});

test('new review contexts snapshot the future default while old contexts keep their original cap', () => {
  let cache = core.createReviewCache(ITEM_ID, 30);
  cache = core.applyNativeReviewBatch(cache, batch(1));
  const contextAKey = cache.activeContextKey;
  assert.equal(core.getActiveReviewPage(cache).captureCap, 30);
  assert.equal(cache.contexts.get(contextAKey).captureCap, 30);

  cache = core.setReviewCacheDefaultCap(cache, 50);
  assert.equal(core.getActiveReviewPage(cache).captureCap, 30);
  cache = core.applyNativeReviewBatch(cache, batch(1, { filters: [1] }, 10, 'photos'));
  const contextBKey = cache.activeContextKey;
  assert.equal(core.getActiveReviewPage(cache).captureCap, 50);
  assert.equal(cache.contexts.get(contextBKey).captureCap, 50);

  cache = core.setReviewCacheDefaultCap(cache, 30);
  assert.equal(core.getActiveReviewPage(cache).captureCap, 50);
  cache = core.applyNativeReviewBatch(cache, batch(1, { sort: 2 }, 10, 'newest'));
  assert.equal(core.getActiveReviewPage(cache).captureCap, 30);

  cache = core.applyNativeReviewBatch(cache, batch(1, { filters: [1] }, 10, 'photos'));
  assert.equal(cache.activeContextKey, contextBKey);
  assert.equal(core.getActiveReviewPage(cache).captureCap, 50);
  cache = core.applyNativeReviewBatch(cache, batch(1));
  assert.equal(cache.activeContextKey, contextAKey);
  assert.equal(core.getActiveReviewPage(cache).captureCap, 30);
});

test('increasing the future default neither recovers a rejected page nor changes old exports', () => {
  let cache = core.createReviewCache(ITEM_ID, 30);
  for (const pageNum of [1, 2, 3, 4]) cache = core.applyNativeReviewBatch(cache, batch(pageNum));
  const before = core.getActiveReviewPage(cache);
  assert.deepEqual(before.pagesLoaded, [1, 2, 3]);
  assert.equal(before.loadedCount, 30);
  assert.equal(before.captureCap, 30);
  assert.equal(before.captureCapReached, true);

  cache = core.setReviewCacheDefaultCap(cache, 50);
  let after = core.getActiveReviewPage(cache);
  assert.deepEqual(after, before);
  cache = core.applyNativeReviewBatch(cache, batch(4));
  after = core.getActiveReviewPage(cache);
  assert.deepEqual(after.pagesLoaded, [1, 2, 3]);
  assert.equal(after.captureCap, 30);
  assert.equal(JSON.parse(core.exportReviewsPage(after)).captureCap, 30);
});

test('decreasing the future default does not truncate an existing higher-cap context', () => {
  let cache = core.createReviewCache(ITEM_ID, 50);
  for (const pageNum of [1, 2, 3, 4]) {
    cache = core.applyNativeReviewBatch(cache, batch(pageNum, { filters: [1] }, 10, 'photos'));
  }
  const before = core.getActiveReviewPage(cache);
  assert.equal(before.loadedCount, 40);
  assert.equal(before.captureCap, 50);
  assert.equal(before.captureCapReached, false);

  cache = core.setReviewCacheDefaultCap(cache, 30);
  const after = core.getActiveReviewPage(cache);
  assert.deepEqual(after, before);
  assert.equal(after.loadedCount, 40);
  assert.equal(after.captureCap, 50);
});

test('lower-level arbitrary caps retain whole-page admission semantics', () => {
  for (const [cap, admittedPages] of [[15, [1]], [25, [1, 2]], [31, [1, 2, 3]]]) {
    let cache = core.createReviewCache(ITEM_ID, cap);
    for (const pageNum of [1, 2, 3, 4]) cache = core.applyNativeReviewBatch(cache, batch(pageNum));
    const active = core.getActiveReviewPage(cache);
    assert.equal(active.captureCap, cap);
    assert.deepEqual(active.pagesLoaded, admittedPages, `cap ${cap}`);
    assert.equal(active.loadedCount, admittedPages.length * 10);
    assert.equal(active.captureCapReached, true);
  }
});

test('status and export report the active snapshot without changing the export key set', () => {
  let cache = core.createReviewCache(ITEM_ID, 30);
  cache = core.applyNativeReviewBatch(cache, batch(1));
  cache = core.setReviewCacheDefaultCap(cache, 50);
  const oldContext = core.getActiveReviewPage(cache);
  assert.match(core.formatReviewsPageStatus(oldContext), /retention cap: 30/);
  let exported = JSON.parse(core.exportReviewsPage(oldContext));
  assert.equal(exported.captureCap, 30);
  assert.deepEqual(Object.keys(exported), [
    'itemId', 'source', 'context', 'selection', 'pagesLoaded', 'loadedCount', 'captureCap', 'captureCapReached', 'reviews',
  ]);

  cache = core.applyNativeReviewBatch(cache, batch(1, { filters: [1] }, 10, 'photos'));
  const newContext = core.getActiveReviewPage(cache);
  assert.match(core.formatReviewsPageStatus(newContext), /retention cap: 50/);
  exported = JSON.parse(core.exportReviewsPage(newContext));
  assert.equal(exported.captureCap, 50);
  assert.deepEqual(Object.keys(exported), [
    'itemId', 'source', 'context', 'selection', 'pagesLoaded', 'loadedCount', 'captureCap', 'captureCapReached', 'reviews',
  ]);
  assert.match(core.formatReviewsPageStatus({
    source: 'ssr:__AER_DATA__', loadedCount: 5, captureCap: 30,
  }), /first-page reviews · retention cap: 30 · source: SSR/);
});
