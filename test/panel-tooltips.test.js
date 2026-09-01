'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ali-helper.user.js'), 'utf8');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.rect = { left: 100, top: 100, right: 220, bottom: 136, width: 120, height: 36 };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    [...(this.listeners.get(type) || [])].forEach((listener) => listener({
      pointerType: '',
      ...event,
      target: this,
    }));
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

class FakeRoot extends FakeElement {
  constructor(targets) {
    super('shadow-root');
    this.targets = targets;
    this.ownerDocument = {
      createElement: (tagName) => {
        const element = new FakeElement(tagName);
        element.rect = { left: 0, top: 0, right: 180, bottom: 42, width: 180, height: 42 };
        return element;
      },
    };
  }

  querySelectorAll(selector) {
    assert.equal(selector, '[data-tooltip]');
    return this.targets;
  }
}

function createTimers() {
  let nextId = 1;
  const pending = new Map();
  const delays = [];
  return {
    delays,
    setTimer(callback, delay) {
      const id = nextId;
      nextId += 1;
      delays.push(delay);
      pending.set(id, callback);
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    runAll() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
    get size() {
      return pending.size;
    },
  };
}

function setup(tooltipText = 'Helpful result text') {
  const target = new FakeElement('button');
  target.dataset.tooltip = tooltipText;
  const root = new FakeRoot([target]);
  const timers = createTimers();
  const controller = core.createTooltipController(root, {
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    getViewport: () => ({ width: 800, height: 600 }),
  });
  return { target, root, timers, controller, tooltip: root.children[0] };
}

test('tooltip copy is result-oriented and the delay is fixed at 1300ms', () => {
  assert.equal(core.TOOLTIP_DELAY_MS, 1300);
  assert.deepEqual(
    core.PRODUCT_PANEL_CONTRACT.actions.map(({ id, tooltip }) => [id, tooltip]),
    [
      ['chatgpt', 'Copies a concise product summary ready to paste into ChatGPT.'],
      ['product', 'Copies the normalized product data as JSON.'],
      ['variants', 'Copies every real SKU combination in a readable text export.'],
      ['description', 'Copies the full ordered description with text, links, and image URLs.'],
      ['clean-url', 'Copies this item URL without known tracking parameters.'],
      ['market', 'Opens this item on the other AliExpress market (RU or COM).'],
    ],
  );
  assert.equal(
    core.SECTION_DISCLOSURE_CONTRACT.tooltip,
    'Shows the source of each product section and any sections confirmed missing.',
  );
});

test('pointer hover waits for the delay and cancellation prevents visibility', () => {
  const { target, timers, tooltip, controller } = setup();
  target.dispatch('pointerenter', { pointerType: 'mouse' });
  assert.deepEqual(timers.delays, [1300]);
  assert.equal(tooltip.hidden, true);

  target.dispatch('pointerleave', { pointerType: 'mouse' });
  assert.equal(timers.size, 0);
  timers.runAll();
  assert.equal(tooltip.hidden, true);

  target.dispatch('pointerenter', { pointerType: 'mouse' });
  timers.runAll();
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.textContent, 'Helpful result text');
  assert.equal(target.getAttribute('aria-describedby'), 'ali-helper-tooltip');
  assert.equal(tooltip.style.top, '144px');

  target.dispatch('pointerleave', { pointerType: 'mouse' });
  assert.equal(tooltip.hidden, true);
  assert.equal(tooltip.textContent, '');
  assert.equal(target.getAttribute('aria-describedby'), null);
  controller.dispose();
});

test('keyboard focus uses the same delay while touch focus remains tooltip-free', () => {
  const { target, timers, tooltip, controller } = setup();
  target.dispatch('focus');
  assert.deepEqual(timers.delays, [1300]);
  assert.equal(tooltip.hidden, true);
  timers.runAll();
  assert.equal(tooltip.hidden, false);

  target.dispatch('blur');
  assert.equal(tooltip.hidden, true);
  target.dispatch('pointerenter', { pointerType: 'touch' });
  target.dispatch('pointerdown', { pointerType: 'touch' });
  target.dispatch('focus');
  target.dispatch('pointerup', { pointerType: 'touch' });
  assert.equal(timers.size, 0);
  assert.equal(tooltip.hidden, true);

  target.dispatch('blur');
  target.dispatch('focus');
  assert.equal(timers.size, 1);
  target.dispatch('blur');
  assert.equal(timers.size, 0);
  controller.dispose();
});

test('one controller owns one node and one listener set, then dispose removes everything', () => {
  const unsafeText = '<img src=x onerror=alert(1)> plain text';
  const { target, root, timers, controller, tooltip } = setup(unsafeText);
  target.setAttribute('aria-describedby', 'existing-help');
  const listenerCount = target.listenerCount();
  const duplicate = core.createTooltipController(root, {
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  assert.equal(duplicate, controller);
  assert.equal(root.children.length, 1);
  assert.equal(listenerCount, 8);
  assert.equal(target.listenerCount(), listenerCount);
  assert.equal(tooltip.getAttribute('role'), 'tooltip');

  target.dispatch('focus');
  timers.runAll();
  assert.equal(tooltip.textContent, unsafeText);
  assert.equal(target.getAttribute('aria-describedby'), 'existing-help ali-helper-tooltip');
  assert.equal(Object.hasOwn(tooltip, 'innerHTML'), false);

  target.dispatch('blur');
  target.dispatch('focus');
  assert.equal(timers.size, 1);
  controller.dispose();
  controller.dispose();
  assert.equal(timers.size, 0);
  assert.equal(root.children.length, 0);
  assert.equal(target.listenerCount(), 0);
  assert.equal(target.getAttribute('aria-describedby'), 'existing-help');
  timers.runAll();
  assert.equal(root.children.length, 0);
});

test('tooltip implementation uses safe text, ignores pointer interaction, and is disposed by both panels', () => {
  const tooltipStart = source.indexOf('function createTooltipController');
  const tooltipEnd = source.indexOf('function createSectionDiagnostic', tooltipStart);
  const tooltipSource = source.slice(tooltipStart, tooltipEnd);
  assert.match(tooltipSource, /tooltip\.textContent = text/);
  assert.doesNotMatch(tooltipSource, /innerHTML|insertAdjacentHTML/);
  assert.match(source, /\.tooltip \{[^}]*pointer-events:none;/);
  assert.equal((source.match(/const tooltipController = createTooltipController\(shadow\);/g) || []).length, 2);
  assert.equal((source.match(/tooltipController\.dispose\(\);/g) || []).length, 2);
  assert.doesNotMatch(source, /data-tooltip[^\n]*on(?:error|load)|\.title = toggleView/);
});
