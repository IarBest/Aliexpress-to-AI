'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ali-helper.user.js'), 'utf8');

function createStatus(textContent = '', isError = false) {
  const classes = new Set();
  if (isError) classes.add('error');
  return {
    textContent,
    hidden: !textContent,
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); },
    },
  };
}

function createFakeTimers() {
  let nextHandle = 1;
  const pending = new Map();
  const captured = new Map();
  const cleared = [];
  return {
    setTimer(callback, delay) {
      const handle = nextHandle;
      nextHandle += 1;
      const timer = { callback, delay };
      pending.set(handle, timer);
      captured.set(handle, timer);
      return handle;
    },
    clearTimer(handle) {
      cleared.push(handle);
      pending.delete(handle);
    },
    run(handle) {
      const timer = pending.get(handle);
      if (!timer) return false;
      pending.delete(handle);
      timer.callback();
      return true;
    },
    fireCaptured(handle) {
      const timer = captured.get(handle);
      if (!timer) return false;
      timer.callback();
      return true;
    },
    pending,
    captured,
    cleared,
  };
}

test('Product preload keeps the live region hidden and reserves no idle status space', () => {
  const status = createStatus('stale diagnostic');
  const controller = core.createProductStatusController(status);

  controller.clear();

  assert.equal(status.textContent, '');
  assert.equal(status.hidden, true);
  assert.equal(status.classList.contains('error'), false);
  assert.match(source, /\.product-status\[hidden\] \{ display:none; \}/);
  assert.match(source, /class="status product-status" role="status" aria-live="polite" aria-atomic="true"/);

  const productStart = source.indexOf('function createPanel(runtime)');
  const productEnd = source.indexOf('function createReviewsPanel(runtime)');
  const productSource = source.slice(productStart, productEnd);
  const setProductSource = productSource.slice(
    productSource.indexOf('setProduct(product)'),
    productSource.indexOf('setShippingCapture(capture)'),
  );
  assert.match(setProductSource, /statusController\.clear\(\)/);
  assert.doesNotMatch(setProductSource, /formatProductStatus|Complete|combinations|source: API/);
  assert.match(productSource, /dispose\(\) \{\s+statusController\.dispose\(\);/);
  assert.match(productSource, /statusController = createProductStatusController[\s\S]*statusController\.clear\(\);/);
  assert.doesNotMatch(productSource, /product\.waiting|product\.changedWaiting/);
  assert.match(source, /runtime\.ui\?\.setProduct\(null\)/);
});

test('an existing meaningful diagnostic survives a transient overlay', () => {
  const status = createStatus('Existing diagnostic.');
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);

  controller.showTransient('Clean URL copied.');
  const [[handle, timer]] = timers.pending;
  assert.equal(timer.delay, 2800);
  assert.equal(status.textContent, 'Clean URL copied.');
  assert.equal(status.hidden, false);
  assert.equal(status.classList.contains('error'), false);

  timers.run(handle);
  assert.equal(status.textContent, 'Existing diagnostic.');
  assert.equal(status.hidden, false);
  assert.equal(status.classList.contains('error'), false);
});

test('controller captures an initial persistent error from the existing DOM', () => {
  const status = createStatus('Initial normalization error.', true);
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);

  controller.showTransient('Settings saved.');
  const handle = [...timers.pending.keys()][0];
  assert.equal(status.classList.contains('error'), false);

  timers.run(handle);
  assert.equal(status.textContent, 'Initial normalization error.');
  assert.equal(status.hidden, false);
  assert.equal(status.classList.contains('error'), true);
});

test('an explicit persistent diagnostic is restored after transient expiry', () => {
  const status = createStatus();
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);

  controller.showPersistent('Product data is unavailable.');
  controller.showTransient('Clean URL copied.');
  const handle = [...timers.pending.keys()][0];
  timers.run(handle);

  assert.equal(status.textContent, 'Product data is unavailable.');
  assert.equal(status.hidden, false);
  assert.equal(status.classList.contains('error'), false);
});

test('persistent error text and class are restored after transient expiry', () => {
  const status = createStatus();
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);

  controller.showPersistent('productData found but normalization failed', true);
  controller.showTransient('Settings saved.');
  const handle = [...timers.pending.keys()][0];
  assert.equal(status.classList.contains('error'), false);
  timers.run(handle);

  assert.equal(status.textContent, 'productData found but normalization failed');
  assert.equal(status.hidden, false);
  assert.equal(status.classList.contains('error'), true);
});

test('new persistent state interrupts a transient and its stale callback is inert', () => {
  const status = createStatus();
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);

  controller.showPersistent('Loading A');
  controller.showTransient('Clean URL copied.');
  const handle = [...timers.pending.keys()][0];
  controller.showPersistent('Error B', true);

  assert.deepEqual(timers.cleared, [handle]);
  assert.equal(status.textContent, 'Error B');
  assert.equal(status.classList.contains('error'), true);
  assert.equal(timers.fireCaptured(handle), true);
  assert.equal(status.textContent, 'Error B');
  assert.equal(status.hidden, false);
  assert.equal(status.classList.contains('error'), true);
});

test('newer transient is protected from a captured callback owned by the earlier transient', () => {
  const status = createStatus('Existing diagnostic.');
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);

  controller.showTransient('Transient A');
  const firstHandle = [...timers.pending.keys()][0];
  controller.showTransient('Transient B');
  const secondHandle = [...timers.pending.keys()][0];

  assert.notEqual(secondHandle, firstHandle);
  assert.deepEqual(timers.cleared, [firstHandle]);
  assert.equal(timers.fireCaptured(firstHandle), true);
  assert.equal(status.textContent, 'Transient B');
  assert.equal(status.hidden, false);
  assert.equal(status.classList.contains('error'), false);

  assert.equal(timers.run(secondHandle), true);
  assert.equal(status.textContent, 'Existing diagnostic.');
  assert.equal(status.hidden, false);
});

test('clear removes base and transient state and defeats a captured callback', () => {
  const status = createStatus();
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);

  controller.showPersistent('Product data is unavailable.');
  controller.showTransient('Product copied.');
  const handle = [...timers.pending.keys()][0];
  controller.clear();

  assert.deepEqual(timers.cleared, [handle]);
  assert.equal(status.textContent, '');
  assert.equal(status.hidden, true);
  assert.equal(timers.fireCaptured(handle), true);
  assert.equal(status.textContent, '');
  assert.equal(status.hidden, true);
  assert.equal(status.classList.contains('error'), false);
});

test('dispose invalidates a captured callback, clears all state, and remains idempotent', () => {
  const status = createStatus();
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);

  controller.showPersistent('Existing diagnostic.');
  controller.showTransient('Description copied.');
  const handle = [...timers.pending.keys()][0];
  controller.dispose();
  controller.dispose();

  assert.deepEqual(timers.cleared, [handle]);
  assert.equal(timers.pending.size, 0);
  assert.equal(status.textContent, '');
  assert.equal(status.hidden, true);
  assert.equal(timers.fireCaptured(handle), true);
  assert.equal(status.textContent, '');
  assert.equal(status.hidden, true);
  controller.showPersistent('Must not appear.', true);
  controller.showTransient('Must not appear.');
  assert.equal(status.textContent, '');
  assert.equal(timers.pending.size, 0);
});

test('transient feedback clears to hidden when no persistent base exists', () => {
  const status = createStatus();
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);

  controller.showTransient('Product copied.');
  const handle = [...timers.pending.keys()][0];
  timers.run(handle);

  assert.equal(status.textContent, '');
  assert.equal(status.hidden, true);
  assert.equal(status.classList.contains('error'), false);
});

test('transient feedback never restores a product summary cleared on successful resolution', () => {
  const status = createStatus('Complete · 15 combinations · Color: 5, Size: 3 · source: API');
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);

  controller.clear();
  controller.showTransient('Product copied.');
  const handle = [...timers.pending.keys()][0];
  timers.run(handle);

  assert.equal(status.textContent, '');
  assert.equal(status.hidden, true);
  assert.doesNotMatch(status.textContent, /Complete|combinations|source:/);
});

test('Product panel wiring starts status hidden and keeps the Clean URL transient path', () => {
  const productStart = source.indexOf('function createPanel(runtime)');
  const productEnd = source.indexOf('function createReviewsPanel(runtime)');
  const productSource = source.slice(productStart, productEnd);
  const markupIndex = productSource.indexOf('class="status product-status"');
  const controllerIndex = productSource.indexOf('createProductStatusController(status, {');
  const clearIndex = productSource.indexOf('statusController.clear();', controllerIndex);
  assert.ok(markupIndex >= 0 && controllerIndex > markupIndex && clearIndex > controllerIndex);
  assert.match(productSource, /copyWithFeedback\(normalizeItemUrl\(location\.href\)\.href, 'copy\.cleanUrlSuccess'\)/);
  assert.match(productSource, /statusController\.showTransient\(createUiMessage\(successKey\)\)/);

  const status = createStatus();
  const timers = createFakeTimers();
  const controller = core.createProductStatusController(status, timers);
  controller.clear();
  controller.showTransient('Clean URL copied.');
  const handle = [...timers.pending.keys()][0];
  timers.run(handle);
  assert.equal(status.textContent, '');
  assert.equal(status.hidden, true);
});
