'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ali-helper.user.js'), 'utf8');

function productWithSections(sections) {
  return { _meta: { sections } };
}

function createDisclosureStub() {
  const children = [];
  const summaryAttributes = new Map();
  const summary = {
    setAttribute(name, value) { summaryAttributes.set(name, value); },
    removeAttribute(name) { summaryAttributes.delete(name); },
    getAttribute(name) { return summaryAttributes.get(name) ?? null; },
  };
  const badge = { hidden: true, textContent: '', dataset: {} };
  const content = {
    replaceChildren() { children.length = 0; },
    appendChild(node) { children.push(node); },
  };
  const disclosure = {
    hidden: true,
    open: false,
    ownerDocument: {
      createElement(tagName) {
        return { tagName: tagName.toUpperCase(), className: '', textContent: '' };
      },
    },
    querySelector(selector) {
      if (selector === '[data-section-disclosure-content]') return content;
      if (selector === '[data-completeness-badge]') return badge;
      if (selector === 'summary') return summary;
      return null;
    },
  };
  return { disclosure, children, summary, badge };
}

test('section disclosure contract is fixed, Product-only display vocabulary', () => {
  assert.equal(core.SECTION_DISCLOSURE_CONTRACT.id, 'section-disclosure-v1');
  assert.equal(core.SECTION_DISCLOSURE_CONTRACT.summary, 'Sources & missing sections');
  assert.equal(Object.isFrozen(core.SECTION_DISCLOSURE_CONTRACT), true);
  assert.equal(Object.isFrozen(core.SECTION_DISCLOSURE_CONTRACT.sectionLabels), true);
  assert.equal(Object.isFrozen(core.SECTION_DISCLOSURE_CONTRACT.sourceAliases), true);
  assert.deepEqual(Object.keys(core.SECTION_DISCLOSURE_CONTRACT.sectionLabels), core.PRODUCT_SECTION_ORDER);
  assert.deepEqual(Object.keys(core.SECTION_DISCLOSURE_CONTRACT.sourceAliases), core.SECTION_SOURCE_ORDER);
  assert.deepEqual(core.PRODUCT_CONFIRMED_MISSING_SECTIONS, [
    'sizeGuide',
    'gallery',
    'ratingSummary',
    'store',
    'characteristics',
    'description',
  ]);
  assert.equal(Object.isFrozen(core.PRODUCT_CONFIRMED_MISSING_SECTIONS), true);
  assert.equal(core.PRODUCT_CONFIRMED_MISSING_SECTIONS.includes('delivery'), false);
});

test('present rows use deterministic section and source order with safe aliases only', () => {
  const model = core.createSectionDisclosureModel(productWithSections({
    delivery: {
      state: 'present',
      sources: ['native:shipping-calculate', 'productData', 'https://attacker.invalid/source'],
    },
    gallery: {
      state: 'present',
      sources: ['dom:description', 'ssr:__AER_DATA__', 'productData'],
    },
  }));

  assert.deepEqual(model, {
    present: [
      { label: 'Gallery', sources: ['Product API', 'Page data', 'Description section'] },
      { label: 'Delivery', sources: ['Product API', 'Shipping API'] },
    ],
    confirmedMissing: [],
    hidden: false,
  });
  assert.doesNotMatch(JSON.stringify(model), /attacker|https?:\/\//);
});

test('confirmed missing sections are capability-filtered in deterministic section order', () => {
  const model = core.createSectionDisclosureModel(productWithSections({
    delivery: { state: 'missing', sources: [] },
    sizeGuide: { state: 'missing', sources: [] },
    description: { state: 'missing', sources: [] },
  }));

  assert.deepEqual(model.present, []);
  assert.deepEqual(model.confirmedMissing, ['Size Guide', 'Description']);
  assert.equal(model.hidden, false);
});

test('disclosure projection filters noncanonical metadata without mutating its input', () => {
  const sections = {
    unknownSection: { state: 'missing', sources: ['unknown:source'] },
    delivery: { state: 'missing', sources: ['native:shipping-calculate'] },
    description: { state: 'missing', sources: [] },
    store: {
      state: 'present',
      sources: ['dom:store', 'unknown:source', 'productData', 'dom:store'],
    },
  };
  const product = productWithSections(sections);
  const snapshot = JSON.parse(JSON.stringify(sections));
  const originalKeyOrder = Object.keys(sections);
  const originalSourceArrays = Object.fromEntries(
    Object.entries(sections).map(([sectionId, section]) => [sectionId, section.sources]),
  );
  const originalSourceContents = Object.fromEntries(
    Object.entries(sections).map(([sectionId, section]) => [sectionId, [...section.sources]]),
  );
  const { disclosure, children } = createDisclosureStub();

  const model = core.createSectionDisclosureModel(product);
  const renderedModel = core.renderSectionDisclosure(disclosure, product);

  const expectedModel = {
    present: [{ label: 'Store', sources: ['Product API', 'Store section'] }],
    confirmedMissing: ['Description'],
    hidden: false,
  };
  assert.deepEqual(model, expectedModel);
  assert.deepEqual(renderedModel, expectedModel);
  assert.deepEqual(children.map(({ textContent }) => textContent), [
    'Store: Product API, Store section',
    'Confirmed missing: Description',
  ]);
  assert.deepEqual(sections, snapshot);
  assert.deepEqual(Object.keys(sections), originalKeyOrder);
  Object.entries(sections).forEach(([sectionId, section]) => {
    assert.equal(section.sources, originalSourceArrays[sectionId], `${sectionId} source array reference`);
    assert.deepEqual(section.sources, originalSourceContents[sectionId], `${sectionId} source array contents`);
  });
  assert.equal(sections.store.sources.includes('unknown:source'), true);
  assert.equal(sections.delivery.state, 'missing');
  assert.equal(sections.unknownSection.state, 'missing');
});

test('not-observed, invalid, malformed, and unknown-source entries stay out of disclosure', () => {
  const model = core.createSectionDisclosureModel(productWithSections({
    sizeGuide: { state: 'not-observed', sources: ['productData'] },
    gallery: { state: 'invalid', sources: ['productData'] },
    ratingSummary: { state: 'present', sources: ['https://attacker.invalid/source'] },
    store: null,
    unknownSection: { state: 'missing', sources: [] },
  }));

  assert.deepEqual(model, { present: [], confirmedMissing: [], hidden: true });
});

test('renderer creates text-only rows and closes a disclosure when it becomes empty', () => {
  const { disclosure, children } = createDisclosureStub();
  const visible = core.renderSectionDisclosure(disclosure, productWithSections({
    store: { state: 'present', sources: ['dom:store'] },
    description: { state: 'missing', sources: [] },
  }));

  assert.equal(visible.hidden, false);
  assert.equal(disclosure.hidden, false);
  assert.deepEqual(children.map(({ tagName, className, textContent }) => ({ tagName, className, textContent })), [
    { tagName: 'DIV', className: 'section-source-row', textContent: 'Store: Store section' },
    { tagName: 'DIV', className: 'confirmed-missing-row', textContent: 'Confirmed missing: Description' },
  ]);

  disclosure.open = true;
  const empty = core.renderSectionDisclosure(disclosure, productWithSections({
    store: { state: 'not-observed', sources: ['dom:store'] },
  }));
  assert.equal(empty.hidden, true);
  assert.equal(disclosure.hidden, true);
  assert.equal(disclosure.open, false);
  assert.deepEqual(children, []);
});

test('complete Product state has no completeness badge or exceptional accessible label', () => {
  const { disclosure, children, summary, badge } = createDisclosureStub();
  const result = core.renderProductSectionDisclosure(disclosure, productWithSections({
    store: { state: 'present', sources: ['dom:store'] },
  }));

  assert.equal(result.completeness.state, 'complete');
  assert.equal(disclosure.hidden, false);
  assert.equal(badge.hidden, true);
  assert.equal(badge.textContent, '');
  assert.equal(badge.dataset.state, undefined);
  assert.equal(summary.getAttribute('aria-label'), null);
  assert.deepEqual(children.map(({ textContent }) => textContent), ['Store: Store section']);
});

test('partial Product state exposes a text badge and keeps its issues inside the disclosure', () => {
  const { disclosure, children, summary, badge } = createDisclosureStub();
  const result = core.renderProductSectionDisclosure(disclosure, productWithSections({
    delivery: { state: 'not-observed', sources: [] },
  }));

  assert.equal(result.completeness.state, 'partial');
  assert.equal(disclosure.hidden, false);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, 'Partial');
  assert.equal(badge.dataset.state, 'partial');
  assert.equal(
    summary.getAttribute('aria-label'),
    'Sources & missing sections. Product status: Partial.',
  );
  assert.deepEqual(children.map(({ className, textContent }) => ({ className, textContent })), [
    { className: 'completeness-detail-row', textContent: 'Not observed: Delivery' },
  ]);
});

test('invalid Product state exposes a text badge and names invalid sections without color dependence', () => {
  const { disclosure, children, summary, badge } = createDisclosureStub();
  const result = core.renderProductSectionDisclosure(disclosure, productWithSections({
    gallery: { state: 'invalid', sources: [], diagnostic: 'conflict' },
  }));

  assert.equal(result.completeness.state, 'invalid');
  assert.equal(disclosure.hidden, false);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, 'Invalid');
  assert.equal(badge.dataset.state, 'invalid');
  assert.equal(
    summary.getAttribute('aria-label'),
    'Sources & missing sections. Product status: Invalid.',
  );
  assert.deepEqual(children.map(({ className, textContent }) => ({ className, textContent })), [
    { className: 'completeness-detail-row', textContent: 'Invalid: Gallery (conflict)' },
  ]);
});

test('Product owns one native disclosure after actions and before Settings; Reviews owns none', () => {
  const productStart = source.indexOf('function createPanel(runtime)');
  const reviewsStart = source.indexOf('function createReviewsPanel(runtime)');
  const reviewsEnd = source.indexOf('function startReviewsPage');
  const productSource = source.slice(productStart, reviewsStart);
  const reviewsSource = source.slice(reviewsStart, reviewsEnd);
  const actionsIndex = productSource.indexOf('renderProductActionGroups()');
  const disclosureIndex = productSource.indexOf('data-section-disclosure hidden');
  const settingsIndex = productSource.indexOf('<summary>Settings</summary>');

  assert.ok(actionsIndex >= 0 && disclosureIndex > actionsIndex && settingsIndex > disclosureIndex);
  assert.equal((productSource.match(/data-section-disclosure hidden/g) || []).length, 1);
  assert.match(productSource, /<details class="section-disclosure" data-section-disclosure hidden>/);
  assert.match(productSource, /<summary>\$\{SECTION_DISCLOSURE_CONTRACT\.summary\}<span class="completeness-badge" data-completeness-badge hidden><\/span><\/summary>/);
  assert.doesNotMatch(reviewsSource, /data-section-disclosure|SECTION_DISCLOSURE_CONTRACT/);
});

test('disclosure renderer is passive and inserts allowlisted content through textContent', () => {
  const start = source.indexOf('function createSectionDisclosureModel');
  const end = source.indexOf('function createSectionDiagnostic', start);
  const disclosureSource = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(disclosureSource, /row\.textContent = `\$\{label\}: \$\{sources\.join\(', '\)\}`/);
  assert.match(disclosureSource, /row\.textContent = `Confirmed missing: \$\{model\.confirmedMissing\.join\(', '\)\}`/);
  assert.doesNotMatch(disclosureSource, /innerHTML|insertAdjacentHTML|\bfetch\s*\(|\bXMLHttpRequest\b|\.click\s*\(/);
});

test('Product body wheel bridge scrolls a real overflow range and consumes only movement', () => {
  const body = { clientHeight: 351, scrollHeight: 424, scrollTop: 0 };
  const handler = core.createPanelBodyWheelHandler(body);
  const calls = { prevented: 0, stopped: 0 };
  const event = {
    deltaY: 40,
    deltaMode: 0,
    preventDefault() { calls.prevented += 1; },
    stopPropagation() { calls.stopped += 1; },
  };

  handler(event);
  assert.equal(body.scrollTop, 40);
  assert.deepEqual(calls, { prevented: 1, stopped: 1 });

  event.deltaY = 1000;
  handler(event);
  assert.equal(body.scrollTop, 73, 'wheel movement clamps to the exact bottom');
  assert.deepEqual(calls, { prevented: 2, stopped: 2 });

  handler(event);
  assert.equal(body.scrollTop, 73);
  assert.deepEqual(calls, { prevented: 2, stopped: 2 }, 'a boundary wheel is not consumed');
});

test('Product body wheel bridge handles line/page deltas and ignores non-scrollable bodies', () => {
  const lineBody = { clientHeight: 100, scrollHeight: 500, scrollTop: 100 };
  core.createPanelBodyWheelHandler(lineBody)({ deltaY: -2, deltaMode: 1 });
  assert.equal(lineBody.scrollTop, 68);

  const pageBody = { clientHeight: 120, scrollHeight: 500, scrollTop: 0 };
  core.createPanelBodyWheelHandler(pageBody)({ deltaY: 1, deltaMode: 2 });
  assert.equal(pageBody.scrollTop, 120);

  const fixedBody = { clientHeight: 200, scrollHeight: 200, scrollTop: 0 };
  core.createPanelBodyWheelHandler(fixedBody)({ deltaY: 80, deltaMode: 0 });
  assert.equal(fixedBody.scrollTop, 0);
});

test('Product body wheel bridge leaves horizontal-dominant native behavior untouched', () => {
  let storedScrollTop = 100;
  let scrollTopAssignments = 0;
  const body = {
    clientHeight: 100,
    scrollHeight: 500,
    get scrollTop() { return storedScrollTop; },
    set scrollTop(value) {
      scrollTopAssignments += 1;
      storedScrollTop = value;
    },
  };
  const handler = core.createPanelBodyWheelHandler(body);
  const calls = { prevented: 0, stopped: 0 };
  const event = (deltaX, deltaY) => ({
    deltaX,
    deltaY,
    deltaMode: 0,
    preventDefault() { calls.prevented += 1; },
    stopPropagation() { calls.stopped += 1; },
  });

  handler(event(50, 1));
  assert.equal(body.scrollTop, 100);
  assert.equal(scrollTopAssignments, 0, 'bridge does not assign scrollTop for a 50/1 gesture');
  assert.deepEqual(calls, { prevented: 0, stopped: 0 });

  handler(event(50, 0));
  assert.equal(body.scrollTop, 100);
  assert.equal(scrollTopAssignments, 0, 'bridge does not assign scrollTop for a pure horizontal gesture');
  assert.deepEqual(calls, { prevented: 0, stopped: 0 });

  handler(event(1, 50));
  assert.equal(body.scrollTop, 150);
  assert.equal(scrollTopAssignments, 1);
  assert.deepEqual(calls, { prevented: 1, stopped: 1 });
});

test('Product body wheel bridge leaves top, bottom, and non-overflow boundaries unconsumed', () => {
  const calls = { prevented: 0, stopped: 0 };
  const event = (deltaY) => ({
    deltaX: 0,
    deltaY,
    deltaMode: 0,
    preventDefault() { calls.prevented += 1; },
    stopPropagation() { calls.stopped += 1; },
  });

  const body = { clientHeight: 100, scrollHeight: 500, scrollTop: 0 };
  const handler = core.createPanelBodyWheelHandler(body);
  handler(event(-50));
  assert.equal(body.scrollTop, 0);

  body.scrollTop = 400;
  handler(event(50));
  assert.equal(body.scrollTop, 400);

  const fixedBody = { clientHeight: 200, scrollHeight: 200, scrollTop: 0 };
  core.createPanelBodyWheelHandler(fixedBody)(event(50));
  assert.equal(fixedBody.scrollTop, 0);
  assert.deepEqual(calls, { prevented: 0, stopped: 0 });
});

test('wheel bridge is Product-only, non-passive, and removed during panel disposal', () => {
  const productStart = source.indexOf('function createPanel(runtime)');
  const reviewsStart = source.indexOf('function createReviewsPanel(runtime)');
  const reviewsEnd = source.indexOf('function startReviewsPage');
  const productSource = source.slice(productStart, reviewsStart);
  const reviewsSource = source.slice(reviewsStart, reviewsEnd);

  assert.match(source, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
  assert.match(source, /removeEventListener\('wheel', onWheel\)/);
  assert.match(productSource, /const disposeWheelScroll = bindPanelBodyWheelScroll\(panelBody\)/);
  assert.match(productSource, /disposeWheelScroll\(\);\s+responsivePanel\.destroy\(\);/);
  assert.doesNotMatch(reviewsSource, /bindPanelBodyWheelScroll|disposeWheelScroll/);
});
