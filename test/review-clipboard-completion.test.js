'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../src/ali-helper.user.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ali-helper.user.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const copyStart = source.indexOf('  function copyText(');
const copyEnd = source.indexOf('\n  function installProductDataInterceptor(', copyStart);
assert.ok(copyStart >= 0 && copyEnd > copyStart, 'production clipboard boundary must exist');
const copySource = source.slice(copyStart, copyEnd);
const listenerStart = source.indexOf("    shadow.addEventListener('click', async (event) => {",
  source.indexOf('  function createReviewsPanel(runtime)'));
const listenerEnd = source.indexOf('\n    });\n    (document.body', listenerStart);
assert.ok(listenerStart >= 0 && listenerEnd > listenerStart, 'production Reviews listener must exist');
const listenerSource = source.slice(listenerStart, listenerEnd + '\n    });'.length);
const productListenerStart = source.indexOf('    async function copyWithFeedback(',
  source.indexOf('  function createPanel(runtime)'));
const productListenerEnd = source.indexOf("\n    autoRedirect.addEventListener('change'", productListenerStart);
assert.ok(productListenerStart >= 0 && productListenerEnd > productListenerStart,
  'production Product copy listener must exist');
const productListenerSource = source.slice(productListenerStart, productListenerEnd);
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'reviews-ssr-1005009452926938.json'), 'utf8',
));
const ITEM_ID = fixture.itemId;
const SKU_ID = '12000049151727540';
const PRODUCT_URL = `https://aliexpress.ru/item/${ITEM_ID}.html?sku_id=${SKU_ID}`;
const REVIEWS_URL = `https://aliexpress.ru/item/${ITEM_ID}/reviews?sku_id=${SKU_ID}`;

function clipboardBoundary(globals) {
  return vm.runInNewContext(`${copySource}\ncopyText;`, globals);
}

function fakeTimers(initialNow = 1000) {
  let now = initialNow;
  let nextHandle = 1;
  const pending = new Map();
  return {
    pending,
    now: () => now,
    setTimeout(callback, delay) {
      const handle = nextHandle++;
      pending.set(handle, { callback, delay, at: now + delay });
      return handle;
    },
    clearTimeout(handle) { pending.delete(handle); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...pending.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        pending.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = target;
    },
  };
}

function contextualUi({ GM_setClipboard, navigator, navigate, initialNow } = {}) {
  const events = [];
  const statuses = [];
  const timers = fakeTimers(initialNow);
  let pageUrl = REVIEWS_URL;
  const handoff = {
    ...core.createReviewWorkflowHandoff({
      workflowId: 'workflow-clipboard-0001',
      itemId: ITEM_ID,
      originProductUrl: PRODUCT_URL,
      originSelectedSkuId: SKU_ID,
      startedAt: 1000,
      productChatgptText: 'ALIEXPRESS PRODUCT\n\nStored product',
      reviewsUrl: REVIEWS_URL,
    }),
    phase: 'active',
  };
  const values = new Map([[core.REVIEW_WORKFLOW_STORAGE_KEY, JSON.stringify(handoff)]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const reviewPage = core.extractReviewsPageFromSsrData(fixture, ITEM_ID);
  const cache = core.seedReviewCacheFromSsr(core.createReviewCache(ITEM_ID, 10), reviewPage);
  const controller = core.createReviewAutoScrollWorkflow({
    handoff,
    timers,
    now: timers.now,
    getPageUrl: () => pageUrl,
    getCache: () => cache,
    terminalizeHandoff(phase) {
      events.push(phase);
      core.terminalizeReviewWorkflowHandoff(storage, handoff, phase);
    },
    removeHandoff() {
      events.push('removed');
      core.removeReviewWorkflowHandoff(storage);
    },
    navigate(url) {
      events.push(url);
      return navigate?.(url);
    },
  });
  controller.observe(cache, core.getActiveReviewPage(cache), { source: 'ssr' });
  assert.equal(controller.state.canCopy, true);
  let listener;
  vm.runInNewContext(`${copySource}\n${listenerSource}`, {
    GM_setClipboard,
    navigator,
    shadow: { addEventListener(type, callback) { assert.equal(type, 'click'); listener = callback; } },
    runtime: { reviewWorkflow: controller, reviewPage: core.getActiveReviewPage(cache) },
    createUiMessage: core.createUiMessage,
    exportReviewsPage: core.exportReviewsPage,
    formatReviewsForChatGPT: core.formatReviewsForChatGPT,
    flash(message, isError = false) { statuses.push({ message, isError }); },
  });
  return {
    controller,
    events,
    statuses,
    storage,
    timers,
    observeUrl(url) {
      pageUrl = url;
      controller.observe(cache, core.getActiveReviewPage(cache), { source: 'ssr' });
    },
    click(action = 'review-workflow-copy') {
      return listener({ target: { closest: () => ({ dataset: { action } }) } });
    },
  };
}

function assertRetryAvailable(ui) {
  assert.equal(ui.controller.state.copyPending, false);
  assert.equal(ui.controller.state.canCopy, true);
  assert.equal(JSON.parse(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY)).phase, 'active');
  assert.deepEqual(ui.events, []);
}

function assertTimeoutFeedback(ui) {
  assert.equal(ui.statuses.length, 1);
  assert.equal(ui.statuses[0].message.key, 'workflow.copyTimeout');
  assert.equal(core.formatUiMessage('en', ui.statuses[0].message),
    'Could not confirm that copying finished. No automatic return was performed.');
  assert.equal(core.formatUiMessage('ru', ui.statuses[0].message),
    'Не удалось подтвердить завершение копирования. Автоматический возврат не выполнен.');
}

test('ordinary GM clipboard copy preserves the immediate default and the two-argument write', async () => {
  const calls = [];
  const copyText = clipboardBoundary({ GM_setClipboard: (...args) => calls.push(args) });
  await copyText('ordinary export');
  assert.deepEqual(calls, [['ordinary export', 'text']]);
});

test('completion-aware GM clipboard copy remains pending until its callback and writes exactly once', async () => {
  const calls = [];
  const copyText = clipboardBoundary({ GM_setClipboard: (...args) => calls.push(args) });
  let settled = false;
  const operation = copyText('combined export', { waitForCompletion: true })
    .then(() => { settled = true; });
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'combined export');
  assert.equal(calls[0][1], 'text');
  assert.equal(typeof calls[0][2], 'function');
  calls[0][2]();
  calls[0][2]();
  await operation;
  assert.equal(settled, true);
  assert.equal(calls.length, 1);
});

test('completion-aware GM clipboard synchronous throw rejects its one attempted write', async () => {
  const error = new Error('clipboard denied');
  let attempts = 0;
  const copyText = clipboardBoundary({ GM_setClipboard() { attempts += 1; throw error; } });
  await assert.rejects(copyText('combined export', { waitForCompletion: true }), (value) => value === error);
  assert.equal(attempts, 1);
});

test('native clipboard promise completion and rejection remain authoritative for both copy modes', async () => {
  for (const options of [undefined, { waitForCompletion: true }]) {
    let resolveWrite;
    const write = new Promise((resolve) => { resolveWrite = resolve; });
    const calls = [];
    const copyText = clipboardBoundary({ navigator: { clipboard: {
      writeText(text) { calls.push(text); return write; },
    } } });
    let settled = false;
    const result = copyText('native export', options);
    assert.equal(result, write);
    result.then(() => { settled = true; });
    await new Promise(setImmediate);
    assert.equal(settled, false);
    resolveWrite();
    await result;
    assert.equal(settled, true);
    assert.deepEqual(calls, ['native export']);

    const error = new Error('native clipboard denied');
    let rejectedWrites = 0;
    const failingCopy = clipboardBoundary({ navigator: { clipboard: {
      writeText() { rejectedWrites += 1; return Promise.reject(error); },
    } } });
    await assert.rejects(failingCopy('native export', options), (value) => value === error);
    assert.equal(rejectedWrites, 1);
  }
});

test('actual contextual Reviews action waits for GM completion before cleanup and one Product return', async () => {
  const writes = [];
  const ui = contextualUi({ GM_setClipboard: (...args) => writes.push(args) });
  const action = ui.click();
  await new Promise(setImmediate);
  assert.equal(ui.controller.state.copyPending, true);
  assert.equal(writes.length, 1);
  assert.match(writes[0][0], /Format: ali-helper-combined-text\/v2/);
  assert.deepEqual(ui.events, []);
  assert.deepEqual(ui.statuses, []);
  assert.equal(JSON.parse(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY)).phase, 'active');
  await ui.click();
  assert.equal(writes.length, 1, 'a second action during the pending clipboard write is unavailable');
  assert.equal(core.REVIEW_WORKFLOW_CLIPBOARD_COMPLETION_TIMEOUT_MS, 5000);
  ui.timers.advance(4999);
  await new Promise(setImmediate);
  assert.equal(ui.controller.state.copyPending, true);
  assert.deepEqual(ui.events, []);
  writes[0][2]();
  writes[0][2]();
  await action;
  assert.deepEqual(ui.events, ['completed', 'removed', PRODUCT_URL]);
  assert.equal(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY), null);
  assert.equal(ui.controller.state.copyPending, false);
  assert.deepEqual(ui.statuses, [], 'successful navigation needs no transient flash');
  const restored = core.restoreReviewWorkflowHandoff(ui.storage, REVIEWS_URL, 1001);
  assert.equal(restored.record, null);
  assert.equal(restored.requiresAutoStart, false);
  ui.timers.advance(1);
  await new Promise(setImmediate);
  assert.deepEqual(ui.events, ['completed', 'removed', PRODUCT_URL]);
  assert.deepEqual(ui.statuses, []);
});

test('actual contextual Reviews action reports confirmed copy after expiry as localized success without another cleanup', async () => {
  const writes = [];
  const ui = contextualUi({
    GM_setClipboard: (...args) => writes.push(args),
    initialNow: 1000 + core.REVIEW_WORKFLOW_TTL_MS - 1000,
  });
  const action = ui.click();
  assert.equal(writes.length, 1);
  assert.equal(ui.controller.state.copyPending, true);
  ui.timers.advance(1000);
  assert.equal(ui.controller.state.phase, 'expired');
  assert.equal(ui.controller.state.canCopy, false);
  assert.deepEqual(ui.events, ['expired', 'removed']);
  assert.deepEqual(ui.statuses, []);
  writes[0][2]();
  await action;
  assert.equal(writes.length, 1);
  assert.equal(ui.controller.state.copyPending, false);
  assert.equal(ui.controller.state.phase, 'expired');
  assert.equal(ui.controller.state.canCopy, false);
  assert.deepEqual(ui.events, ['expired', 'removed'], 'confirmed copy must not repeat terminal cleanup');
  assert.equal(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY), null);
  assert.equal(ui.statuses.length, 1);
  assert.equal(ui.statuses[0].message.key, 'workflow.returnExpired');
  assert.equal(ui.statuses[0].isError, false, 'expiry cancels automatic return without turning copy success into an error');
  assert.equal(core.formatUiMessage('en', ui.statuses[0].message),
    'Product and reviews copied. Automatic return was cancelled because the review workflow expired.');
  assert.equal(core.formatUiMessage('ru', ui.statuses[0].message),
    'Товар и отзывы скопированы. Автоматический возврат отменён, потому что срок сбора отзывов истёк.');
  writes[0][2]();
  ui.timers.advance(4000);
  await action;
  assert.deepEqual(ui.events, ['expired', 'removed']);
  assert.equal(ui.statuses.length, 1);
  const restored = core.restoreReviewWorkflowHandoff(ui.storage, REVIEWS_URL, ui.timers.now());
  assert.equal(restored.record, null);
  assert.equal(restored.requiresAutoStart, false);
});

test('actual contextual Reviews action never promises retry when clipboard timeout follows expiry', async () => {
  const writes = [];
  const ui = contextualUi({
    GM_setClipboard: (...args) => writes.push(args),
    initialNow: 1000 + core.REVIEW_WORKFLOW_TTL_MS - 1000,
  });
  const action = ui.click();
  ui.timers.advance(1000);
  assert.equal(ui.controller.state.phase, 'expired');
  assert.equal(ui.controller.state.canCopy, false);
  assert.equal(ui.controller.state.copyPending, true);
  assert.deepEqual(ui.events, ['expired', 'removed']);
  assert.deepEqual(ui.statuses, []);
  ui.timers.advance(4000);
  await action;
  assert.equal(writes.length, 1);
  assert.equal(ui.controller.state.copyPending, false);
  assert.equal(ui.controller.state.phase, 'expired');
  assert.equal(ui.controller.state.canCopy, false);
  assert.deepEqual(ui.events, ['expired', 'removed']);
  assert.equal(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY), null);
  assertTimeoutFeedback(ui);
  assert.equal(ui.statuses[0].isError, true);
  assert.doesNotMatch(core.formatUiMessage('en', ui.statuses[0].message), /try again|retry/i);
  assert.doesNotMatch(core.formatUiMessage('ru', ui.statuses[0].message), /повтор|попробовать.*снова/i);
  writes[0][2]();
  ui.timers.advance(5000);
  await action;
  assert.equal(writes.length, 1);
  assert.equal(ui.controller.state.canCopy, false);
  assert.deepEqual(ui.events, ['expired', 'removed']);
  assertTimeoutFeedback(ui);
});

test('actual contextual GM action with no callback settles at 5000ms with honest timeout feedback and retry', async () => {
  const writes = [];
  const ui = contextualUi({ GM_setClipboard: (...args) => writes.push(args) });
  let settled = false;
  const action = ui.click().then(() => { settled = true; });
  await new Promise(setImmediate);
  ui.timers.advance(4999);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(ui.controller.state.copyPending, true);
  ui.timers.advance(1);
  await action;
  assert.equal(settled, true);
  assert.equal(writes.length, 1);
  assertRetryAvailable(ui);
  assertTimeoutFeedback(ui);
});

test('late GM callback after timeout cannot clean up, navigate, or flash success', async () => {
  const writes = [];
  const ui = contextualUi({ GM_setClipboard: (...args) => writes.push(args) });
  const action = ui.click();
  ui.timers.advance(5000);
  await action;
  assertRetryAvailable(ui);
  assertTimeoutFeedback(ui);
  writes[0][2]();
  writes[0][2]();
  await new Promise(setImmediate);
  assert.equal(writes.length, 1);
  assertRetryAvailable(ui);
  assertTimeoutFeedback(ui);
});

test('late timed-out GM callback cannot release a newer pending retry or affect its one successful return', async () => {
  const writes = [];
  const ui = contextualUi({ GM_setClipboard: (...args) => writes.push(args) });
  const first = ui.click();
  ui.timers.advance(5000);
  await first;
  assertRetryAvailable(ui);
  assertTimeoutFeedback(ui);
  const retry = ui.click();
  assert.equal(writes.length, 2, 'each explicit attempt writes once');
  assert.equal(ui.controller.state.copyPending, true);
  writes[0][2]();
  await new Promise(setImmediate);
  assert.equal(ui.controller.state.copyPending, true, 'old completion must not release the retry');
  assert.deepEqual(ui.events, []);
  assertTimeoutFeedback(ui);
  await ui.click();
  assert.equal(writes.length, 2, 'old completion must not enable a third attempt');
  writes[1][2]();
  await retry;
  assert.equal(ui.controller.state.copyPending, false);
  assert.deepEqual(ui.events, ['completed', 'removed', PRODUCT_URL]);
  assert.equal(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY), null);
  assertTimeoutFeedback(ui);
  writes[0][2]();
  ui.timers.advance(5000);
  await new Promise(setImmediate);
  assert.equal(writes.length, 2);
  assert.deepEqual(ui.events, ['completed', 'removed', PRODUCT_URL]);
  assertTimeoutFeedback(ui);
});

test('actual contextual native pending Promise times out and late settlement cannot affect a successful retry', async () => {
  const writes = [];
  const completions = [];
  const ui = contextualUi({ navigator: { clipboard: {
    writeText(text) {
      writes.push(text);
      return new Promise((resolve) => completions.push(resolve));
    },
  } } });
  const first = ui.click();
  ui.timers.advance(5000);
  await first;
  assert.equal(writes.length, 1);
  assertRetryAvailable(ui);
  assertTimeoutFeedback(ui);
  const retry = ui.click();
  assert.equal(writes.length, 2);
  completions[0]();
  await new Promise(setImmediate);
  assert.equal(ui.controller.state.copyPending, true);
  assert.deepEqual(ui.events, []);
  assertTimeoutFeedback(ui);
  completions[1]();
  await retry;
  assert.equal(ui.controller.state.copyPending, false);
  assert.deepEqual(ui.events, ['completed', 'removed', PRODUCT_URL]);
  assert.equal(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY), null);
  assertTimeoutFeedback(ui);
  ui.timers.advance(5000);
  await new Promise(setImmediate);
  assert.equal(writes.length, 2);
  assert.deepEqual(ui.events, ['completed', 'removed', PRODUCT_URL]);
  assertTimeoutFeedback(ui);
});

test('actual contextual native rejection before timeout remains copy-failed and retryable', async () => {
  let writes = 0;
  let rejectWrite;
  const ui = contextualUi({ navigator: { clipboard: {
    writeText() {
      writes += 1;
      return new Promise((resolve, reject) => { rejectWrite = reject; });
    },
  } } });
  const action = ui.click();
  ui.timers.advance(4999);
  rejectWrite(new Error('native clipboard denied'));
  await action;
  assert.equal(writes, 1);
  assertRetryAvailable(ui);
  assert.equal(ui.statuses.length, 1);
  assert.equal(ui.statuses[0].message.key, 'copy.failed');
  assert.equal(ui.statuses[0].isError, true);
  assert.match(core.formatUiMessage('en', ui.statuses[0].message), /native clipboard denied/);
  ui.timers.advance(1);
  await new Promise(setImmediate);
  assertRetryAvailable(ui);
  assert.equal(ui.statuses.length, 1);
});

test('actual contextual stale success after observed Product and restored Reviews reports cancellation without navigation', async () => {
  const writes = [];
  const ui = contextualUi({ GM_setClipboard: (...args) => writes.push(args) });
  const action = ui.click();
  ui.observeUrl(PRODUCT_URL);
  ui.observeUrl(REVIEWS_URL);
  writes[0][2]();
  await action;
  assert.equal(writes.length, 1);
  assert.deepEqual(ui.events, ['completed', 'removed']);
  assert.equal(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY), null);
  assert.equal(ui.controller.state.copyPending, false);
  assert.equal(ui.statuses.length, 1);
  assert.equal(ui.statuses[0].message.key, 'workflow.returnCancelled');
  assert.equal(ui.statuses[0].isError, false);
  assert.equal(core.formatUiMessage('en', ui.statuses[0].message),
    'Product and reviews copied. Automatic return was cancelled because the page changed.');
  assert.equal(core.formatUiMessage('ru', ui.statuses[0].message),
    'Товар и отзывы скопированы. Автоматический возврат отменён, потому что страница изменилась.');
  const restored = core.restoreReviewWorkflowHandoff(ui.storage, REVIEWS_URL, ui.timers.now());
  assert.equal(restored.record, null);
  assert.equal(restored.requiresAutoStart, false);
});

test('actual contextual Reviews action reports GM throw as copy failure without cleanup or navigation', async () => {
  let writes = 0;
  const ui = contextualUi({ GM_setClipboard() { writes += 1; throw new Error('clipboard denied'); } });
  await ui.click();
  assert.equal(writes, 1);
  assert.deepEqual(ui.events, []);
  assert.equal(JSON.parse(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY)).phase, 'active');
  assert.equal(ui.controller.state.copyPending, false);
  assert.equal(ui.statuses.length, 1);
  assert.equal(ui.statuses[0].isError, true);
  assert.equal(ui.statuses[0].message.key, 'copy.failed');
  assert.match(core.formatUiMessage('en', ui.statuses[0].message), /clipboard denied/);
  assertRetryAvailable(ui);
  ui.timers.advance(5000);
  await new Promise(setImmediate);
  assert.equal(writes, 1);
  assertRetryAvailable(ui);
  assert.equal(ui.statuses.length, 1);
});

test('actual contextual Reviews action preserves GM success and localizes Product-return failure', async () => {
  const writes = [];
  const ui = contextualUi({
    GM_setClipboard: (...args) => writes.push(args),
    navigate() { throw new Error('navigation denied'); },
  });
  const action = ui.click();
  assert.deepEqual(ui.events, []);
  writes[0][2]();
  await action;
  assert.equal(writes.length, 1);
  assert.deepEqual(ui.events, ['completed', 'removed', PRODUCT_URL]);
  assert.equal(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY), null);
  assert.equal(ui.statuses.length, 1);
  assert.equal(ui.statuses[0].message.key, 'workflow.returnFailed');
  assert.equal(ui.statuses[0].isError, true);
  assert.match(core.formatUiMessage('en', ui.statuses[0].message), /Product and reviews copied/);
  assert.match(core.formatUiMessage('ru', ui.statuses[0].message), /Товар и отзывы скопированы/);
  assert.doesNotMatch(core.formatUiMessage('en', ui.statuses[0].message), /navigation denied/);
});

test('ordinary Reviews JSON and ChatGPT actions retain the ordinary GM clipboard path and stay on Reviews', async () => {
  for (const [action, successKey] of [
    ['reviews', 'reviews.copyJsonSuccess'],
    ['reviews-chatgpt', 'reviews.copyChatgptSuccess'],
  ]) {
    const writes = [];
    const ui = contextualUi({ GM_setClipboard: (...args) => writes.push(args) });
    await ui.click(action);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].length, 2, 'independent Reviews copying preserves the default GM call');
    assert.deepEqual(ui.events, []);
    assert.equal(ui.statuses.length, 1);
    assert.equal(ui.statuses[0].message.key, successKey);
    assert.equal(ui.statuses[0].isError, false);
    assert.equal(JSON.parse(ui.storage.getItem(core.REVIEW_WORKFLOW_STORAGE_KEY)).phase, 'active');
    assert.equal(ui.controller.state.copyPending, false);
    assert.equal([...ui.timers.pending.values()].some((timer) => timer.delay === 5000), false,
      'ordinary Reviews actions never start a clipboard completion timeout');
  }
});

test('ordinary Product exports use their production listener and immediate two-argument GM writes', async () => {
  const writes = [];
  const statuses = [];
  const product = { itemId: ITEM_ID };
  const shippingCapture = { itemId: ITEM_ID, source: 'test shipping debug' };
  let listener;
  vm.runInNewContext(`${copySource}\n${productListenerSource}`, {
    GM_setClipboard: (...args) => writes.push(args),
    shadow: { addEventListener(type, callback) { assert.equal(type, 'click'); listener = callback; } },
    runtime: { product, shippingCapture, refreshProductEnrichment: () => product },
    location: { href: `${PRODUCT_URL}&utm_source=test#description` },
    normalizeItemUrl: core.normalizeItemUrl,
    exportProduct: () => 'Product JSON export',
    exportVariants: () => 'Variants export',
    exportForChatGPT: () => 'Product ChatGPT export',
    exportDescription: () => 'Description export',
    shippingCaptureMatchesProduct: () => true,
    createUiMessage: core.createUiMessage,
    statusController: { showTransient(message) { statuses.push(message); } },
    flash() { assert.fail('ordinary Product copy must succeed immediately'); },
  });
  for (const [action, expectedText, successKey] of [
    ['product', 'Product JSON export', 'copy.productJsonSuccess'],
    ['chatgpt', 'Product ChatGPT export', 'copy.productChatgptSuccess'],
    ['variants', 'Variants export', 'copy.variantsSuccess'],
    ['description', 'Description export', 'copy.descriptionSuccess'],
    ['clean-url', PRODUCT_URL, 'copy.cleanUrlSuccess'],
    ['shipping-debug', JSON.stringify(shippingCapture, null, 2), 'copy.shippingDebugSuccess'],
  ]) {
    listener({ target: { closest: () => ({ dataset: { action } }) } });
    await new Promise(setImmediate);
    assert.deepEqual(writes.at(-1), [expectedText, 'text'], `${action} must not await a GM callback`);
    assert.equal(statuses.at(-1).key, successKey);
  }
  assert.equal(writes.length, 6);
  assert.equal(statuses.length, 6);
});
