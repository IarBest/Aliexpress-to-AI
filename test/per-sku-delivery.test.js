'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../src/ali-helper.user.js');
const source = fs.readFileSync(path.join(__dirname, '../src/ali-helper.user.js'), 'utf8');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const telemetryFixture = fixture('sku-telemetry-1005009452926938.json');
const ITEM = '1005005458737062';
const route = (p, id = p.selectedSkuId) => 'https://aliexpress.ru/item/' + p.itemId + '.html?sku_id=' + id;
const clone = (value) => JSON.parse(JSON.stringify(value));

// Synthetic normalized test models, not invented AliExpress response fixtures.
// The one-dimensional IDs/prices/names are the accepted research observations.
function model(two = false) {
  const groups = two ? [
    { id: '4', name: 'Color', rawName: 'Color', values: [{ id: '11', name: 'Blue' }, { id: '12', name: 'Red' }] },
    { id: '30', name: 'Size', rawName: 'Size', values: [{ id: '21', name: 'S' }, { id: '22', name: 'L' }] },
  ] : [{ id: '1', name: 'Bundle', rawName: 'Bundle', values: [
    { id: '11', name: 'zigbee A' }, { id: '12', name: 'zigbee B' },
    { id: '13', name: 'WiFi A' }, { id: '14', name: 'WiFi B' },
  ] }];
  const vectors = two ? [['11', '21'], ['11', '22'], ['12', '21'], ['12', '22']]
    : [['11'], ['12'], ['13'], ['14']];
  const prices = ['4.95', '4.50', '3.70', '3.20'];
  const regular = ['12.38', '11.25', '9.24', '8.00'];
  const money = (value) => ({ value, currency: 'USD', formatted: '$' + value });
  const skus = vectors.map((vector, i) => ({
    skuId: String(12000033163749327n + BigInt(i)),
    selections: vector.map((id, g) => ({ groupId: groups[g].id, groupName: groups[g].name,
      valueId: id, name: groups[g].values.find((v) => v.id === id).name, rawName: 'raw-' + id })),
    price: { current: money(prices[i]), regular: money(regular[i]) },
    stock: 20 + i, buyerPriceForLogistic: String(Math.round(Number(prices[i]) * 100)),
    skuPropIds: vector, rawSkuAttr: 'retained raw normalized field',
  }));
  return { itemId: ITEM, title: 'Synthetic normalized test model', url: route({ itemId: ITEM, selectedSkuId: skus[0].skuId }),
    variantGroups: groups, skus, selectedSku: skus[0], selectedSkuId: skus[0].skuId, delivery: null,
    _meta: { selectedSkuResolved: true } };
}
function select(p, id) {
  p.selectedSkuId = id;
  p.selectedSku = p.skus.find((sku) => sku.skuId === id);
  p.price = p.selectedSku?.price;
}
function telemetry(p) {
  return JSON.stringify({ sku_attr: p.variantGroups.map((g) => ({ id: g.id, name: g.rawName || g.name, values: g.values.map((v) => v.id) })) });
}

// Minimal ordinary DOM with real descendant/class/attribute selector semantics.
class Element {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.text = text; this.children = [];
    this.isConnected = true; this.disabled = false;
  }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } return this; }
  get textContent() { return this.text + this.children.map((n) => n.textContent).join(''); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  matches(selector) {
    const tag = selector.match(/^[a-z]+/i)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    return [...selector.matchAll(/\[([\w-]+)(\*?=)"([^"]*)"\]/g)].every(([, key, operator, value]) =>
      operator === '*=' ? String(this.getAttribute(key) || '').includes(value) : this.getAttribute(key) === value);
  }
  querySelectorAll(selector) {
    return this.children.flatMap((n) => [...(n.matches(selector) ? [n] : []), ...n.querySelectorAll(selector)]);
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  contains(node) { return node === this || this.children.some((n) => n.contains(node)); }
  getClientRects() { return [{}]; }
  click() { this.onClick?.(); }
}
function dom(p, raw = telemetry(p)) {
  const doc = new Element('document');
  const floor = new Element('div', { 'data-spm': 'sku_floor' });
  const sourceNode = new Element('div', {
    exp_type: 'tab_detail_sku', exp_page_area: 'sku_floor',
    exp_product: 'productId=' + p.itemId, exp_attribute: raw,
  });
  doc.append(floor); floor.append(sourceNode);
  const groups = core.parseSkuTelemetry(raw) || [];
  const domGroups = groups.map((g) => {
    const group = new Element('div', { class: 'SnowSku_SkuPropertyItem__skuProp__newhash' });
    const label = new Element('div', { class: 'SnowSku_SkuPropertyItem__propNameWrap__newhash' }, g.name + ':selected');
    const list = new Element('ul', { class: 'SnowSku_SkuPropertyItem__optionList__newhash' });
    group.append(label, list); sourceNode.append(group);
    g.values.forEach((id, i) => list.append(new Element('li').append(new Element('button', {
      type: 'button', 'data-testid': 'skuProp', id: 'SkuPropertyValue-' + i,
    }))));
    return { group, label, list, buttons: list.querySelectorAll('button') };
  });
  return { doc, floor, sourceNode, domGroups };
}
function mapping(p, d = dom(p)) { return core.inspectNativeSkuMapping(d.doc, p, route(p)); }
function real45() {
  const f = fixture('product-1005009452926938.json');
  return core.normalizeProduct(f.data, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540');
}

test('exact captured single-quoted two-group telemetry parses without evaluating text', () => {
  assert.deepEqual(core.parseSkuTelemetry(telemetryFixture.exp_attribute), [
    { id: '4', name: 'Color', values: ['337917', '337916', '337969', '337981', '337971', '337970', '337948', '337907', '337952'] },
    { id: '30', name: 'Size', values: ['344976', '343564', '343563', '343562', '343565'] },
  ]);
  assert.equal(core.parseSkuTelemetry("({'sku_attr':[]}); fetch('x')"), null);
  assert.equal(core.parseSkuTelemetry('{"sku_attr":[],"sku_attr":[]}'), null);
});
test('captured 45-row fixture maps by group ID, telemetry order and group-local buttons', () => {
  const p = real45(); p.variantGroups.reverse();
  const d = dom(p, telemetryFixture.exp_attribute);
  const result = mapping(p, d);
  assert.equal(result.ok, true);
  assert.deepEqual(result.groups.map((g) => [g.id, g.values.length]), [['4', 9], ['30', 5]]);
  assert.equal(result.groups[0].buttons[5], d.domGroups[0].buttons[5]);
  assert.equal(result.groups[1].buttons[3], d.domGroups[1].buttons[3]);
  assert.equal(result.groups[0].buttons[0].getAttribute('id'), result.groups[1].buttons[0].getAttribute('id'));
  assert.doesNotMatch(JSON.stringify(core.NATIVE_SKU_SELECTORS), /xmad5|34imu|newhash|SkuPropertyValue/);
});
for (const [name, mutate] of [
  ['duplicate group ID', (g) => { g[1].id = g[0].id; }],
  ['duplicate value ID', (g) => { g[0].values[1] = g[0].values[0]; }],
  ['duplicate group name', (g) => { g[1].name = g[0].name; }],
  ['empty group name', (g) => { g[0].name = ''; }],
  ['empty values', (g) => { g[0].values = []; }],
  ['non-numeric ID', (g) => { g[0].id = 'color'; }],
]) test('telemetry rejects ' + name, () => {
  const g = core.parseSkuTelemetry(telemetryFixture.exp_attribute); mutate(g);
  assert.equal(core.parseSkuTelemetry(JSON.stringify({ sku_attr: g })), null);
});
for (const [name, mutate] of [
  ['wrong item', (d) => { d.sourceNode.attrs.exp_product = 'productId=999'; }],
  ['wrong telemetry area', (d) => { d.sourceNode.attrs.exp_page_area = 'other'; }],
  ['missing attribute', (d) => { delete d.sourceNode.attrs.exp_attribute; }],
  ['malformed attribute', (d) => { d.sourceNode.attrs.exp_attribute = '{bad'; }],
  ['duplicate telemetry source', (d) => { d.floor.append(new Element('div', { ...d.sourceNode.attrs })); }],
  ['duplicate floor', (d) => { d.doc.append(new Element('div', { 'data-spm': 'sku_floor' })); }],
  ['count mismatch', (d) => { d.domGroups[0].list.children.pop(); }],
  ['unrelated extra button', (d) => { d.domGroups[0].group.append(new Element('button')); }],
  ['unrelated skuProp outside group', (d) => { d.floor.append(new Element('button', { type: 'button', 'data-testid': 'skuProp' })); }],
  ['ambiguous DOM group', (d) => { d.domGroups[1].label.text = 'Color:other'; }],
  ['wrong option-list type', (d) => { d.domGroups[0].list.tagName = 'DIV'; }],
  ['duplicate list', (d) => { d.domGroups[0].group.append(new Element('ul', { class: 'SkuPropertyItem__optionList__' })); }],
  ['wrong normalized group ID', (d, p) => { p.variantGroups[0].id = '88'; }],
]) test('native mapping fails closed: ' + name, () => {
  const p = model(true); const d = dom(p); mutate(d, p);
  assert.equal(mapping(p, d).ok, false);
});
test('mapping rejects a mismatched route and Reviews route', () => {
  const p = model(); const d = dom(p);
  assert.equal(core.inspectNativeSkuMapping(d.doc, p, 'https://aliexpress.ru/item/999.html').ok, false);
  assert.equal(core.inspectNativeSkuMapping(d.doc, p, 'https://aliexpress.ru/item/' + ITEM + '/reviews').ok, false);
});

for (const two of [false, true]) test('real-row graph and bounded visit/restore plan: ' + (two ? '2x2' : '1x4'), () => {
  const p = model(two); const before = clone(p);
  const plan = core.planVariantDelivery(p, mapping(p));
  assert.equal(plan.ok, true); assert.equal(plan.matrix.fullyConnected, true);
  assert.deepEqual(p, before);
  assert.equal(plan.visit[0], p.selectedSkuId);
  assert.deepEqual([...plan.visit].sort(), p.skus.map((s) => s.skuId).sort());
  for (let i = 0; i < plan.graph.length; i++) for (const j of plan.graph[i]) {
    assert.equal(plan.matrix.rows[i].vector.filter((v, k) => v !== plan.matrix.rows[j].vector[k]).length, 1);
  }
  const full = [...plan.visit, ...plan.restorePaths[plan.visit.at(-1)]];
  assert.equal(full.at(-1), p.selectedSkuId);
  assert.ok(full.length - 1 <= 18);
  for (let i = 1; i < full.length; i++) {
    const a = plan.matrix.rows.findIndex((r) => r.skuId === full[i - 1]);
    const b = plan.matrix.rows.findIndex((r) => r.skuId === full[i]);
    assert.ok(plan.graph[a].includes(b));
  }
  assert.equal(core.planVariantDelivery(p, mapping(p), 1).reason, 'click-cap');
});
test('captured 9x5 matrix analysis is complete but collector rejects 45 rows by cap', () => {
  const p = real45(); const before = structuredClone(p.skus);
  const matrix = core.analyzeRealSkuMatrix(p);
  assert.equal(matrix.ok, true); assert.equal(matrix.fullyConnected, true);
  assert.deepEqual(matrix.cardinalities, [9, 5]); assert.equal(matrix.rows.length, 45);
  assert.equal(core.planVariantDelivery(p, mapping(p, dom(p, telemetryFixture.exp_attribute))).reason, 'sku-cap');
  assert.deepEqual(p.skus, before);
});
for (const [name, change, reason] of [
  ['sparse', (p) => { p.skus.pop(); }, 'sparse'],
  ['duplicate SKU', (p) => { p.skus[1].skuId = p.skus[0].skuId; }, 'matrix'],
  ['duplicate vector', (p) => { p.skus[1].selections = clone(p.skus[0].selections); }, 'matrix'],
  ['missing dimension', (p) => { p.skus[1].selections.pop(); }, 'matrix'],
  ['unknown model value', (p) => { p.skus[1].selections[0].valueId = '999'; }, 'matrix'],
  ['unresolved selected', (p) => { p._meta.selectedSkuResolved = false; }, 'selected'],
  ['selected absent', (p) => { p.selectedSkuId = '999'; }, 'selected'],
]) test('eligibility rejects ' + name, () => {
  const p = model(true); const m = mapping(p); change(p);
  assert.equal(core.planVariantDelivery(p, m).reason, reason);
});
test('three dimensions unsupported even if fully connected; unknown telemetry rejected', () => {
  const p = model(true);
  p.variantGroups.push({ id: '9', name: 'Third', values: [{ id: '99', name: 'Only' }] });
  p.skus.forEach((s) => s.selections.push({ groupId: '9', valueId: '99' }));
  assert.equal(core.analyzeRealSkuMatrix(p).fullyConnected, true);
  assert.equal(core.planVariantDelivery(p, mapping(p)).reason, 'dimensions');
  const one = model(); const m = mapping(one); m.groups[0].values.pop();
  assert.equal(core.planVariantDelivery(one, m).reason, 'mapping');
});

// Safe synthetic passive events use existing parser/cache path; no request sender.
const shippingResponse = () => clone(fixture('shipping-calculate-1005008195850531.json').response);
function capture(p, sku, cache, { cost = '0.90', response = shippingResponse(), requestPatch = {}, invalid = false } = {}) {
  const request = { productIdV2: p.itemId, skuId: sku.skuId, tradeCurrency: 'USD', count: '1',
    ...core.skuShippingPriceContext(sku, { tradeCurrency: 'USD' }), ...requestPatch };
  response.methods[0].amount = { value: cost, currency: 'USD', formatted: '$' + cost };
  const event = core.cacheDeliveryCapture(cache, request, invalid ? { ...response, methods: 'bad' } : response, p.itemId, sku.skuId);
  return { event, environment: core.createShippingEnvironment(request, event.normalized) };
}
function harness(two = false, config = {}) {
  const p = model(two); const d = dom(p); const cache = core.createDeliveryCache();
  let environment = capture(p, p.skus[0], cache).environment;
  let url = route(p), visible = true, environmentEstablished = true, time = 0, sequence = 0;
  const timers = new Map(), clicks = [], states = [];
  let afterClick = null;
  for (const [gIndex, dg] of d.domGroups.entries()) for (const [index, button] of dg.buttons.entries()) {
    button.onClick = () => {
      const value = p.variantGroups[gIndex].values[index].id;
      const vector = p.selectedSku.selections.map((s) => s.valueId);
      vector[gIndex] = value;
      const target = p.skus.find((s) => s.selections.every((v, i) => v.valueId === vector[i]));
      clicks.push(target?.skuId); assert.ok(target, 'native fake resolves only real row');
      select(p, target.skuId); url = route(p);
      if (!config.noCapture) capture(p, target, cache);
      afterClick?.(target, button);
    };
  }
  const controller = core.createVariantDeliveryCollector({
    getContext: () => ({ product: p, pageUrl: url, mapping: mapping(p, d), visible, environment, environmentEstablished }),
    getObservation: (product, sku, env) => core.observeSkuDelivery(product, sku, cache, env),
    now: () => time,
    setTimer(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    onState(state) { states.push(state); },
    ...config.options,
  });
  function tick() {
    assert.ok(timers.size, 'a bounded timer exists');
    const [id, task] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    timers.delete(id); time = Math.max(time, task.at); task.fn();
  }
  return { p, d, cache, controller, clicks, states, timers, tick,
    run() { let n = 0; while (controller.active && ++n < 1600) tick(); assert.ok(n < 1600, 'finite run'); },
    until(predicate) { let n = 0; while (!predicate() && controller.active && ++n < 1500) tick(); assert.ok(predicate()); },
    after(fn) { afterClick = fn; },
    setEnvironment(value) { environment = value; }, get environment() { return environment; },
    setUrl(value) { url = value; }, setVisible(value) { visible = value; },
    setEstablished(value) { environmentEstablished = value; },
    setTime(value) { time = value; },
  };
}

test('collector is explicit-only, second start rejected, one-dimensional pass restores original', () => {
  const h = harness(); assert.equal(h.controller.state.phase, 'idle');
  assert.equal(h.timers.size, 0); assert.equal(h.clicks.length, 0);
  assert.equal(h.controller.start(), true); assert.equal(h.controller.start(), false);
  h.run();
  assert.equal(h.controller.state.phase, 'completed'); assert.equal(h.controller.state.observed, 4);
  assert.equal(h.controller.state.restored, true); assert.equal(h.p.selectedSkuId, h.p.skus[0].skuId);
  assert.equal(h.clicks.length, 4); assert.equal(h.timers.size, 0);
});
test('two-dimensional collector uses adjacent expected routes and restores', () => {
  const h = harness(true); h.controller.start(); h.run();
  assert.equal(h.controller.state.phase, 'completed');
  const plan = core.planVariantDelivery(h.p, mapping(h.p, h.d));
  assert.deepEqual(h.clicks, [...plan.visit.slice(1), ...plan.restorePaths[plan.visit.at(-1)]]);
});
for (const [name, mutate, reason] of [
  ['wrong resulting SKU', (h) => { select(h.p, h.p.skus[3].skuId); h.setUrl(route(h.p)); }, 'route'],
  ['mapping changed', (h) => { h.d.domGroups[0].list.children.pop(); }, 'mapping'],
  ['telemetry order changed', (h) => { const g = core.parseSkuTelemetry(h.d.sourceNode.attrs.exp_attribute); g[0].values.reverse(); h.d.sourceNode.attrs.exp_attribute = JSON.stringify({ sku_attr: g }); }, 'mapping'],
  ['item changed', (h) => { h.setUrl('https://aliexpress.ru/item/999.html?sku_id=123'); }, 'item'],
  ['environment changed', (h) => { h.setEnvironment({ ...h.environment, tradeCurrency: 'EUR' }); }, 'environment'],
  ['price context changed', (h) => { h.p.skus[0].buyerPriceForLogistic = '999'; }, 'price-context'],
  ['document hidden', (h) => { h.setVisible(false); }, 'hidden'],
]) test('collector aborts without alternative retry after ' + name, () => {
  const h = harness(); h.after(() => mutate(h)); h.controller.start(); h.run();
  assert.equal(h.controller.state.phase, 'failed'); assert.equal(h.controller.state.reason, reason);
  assert.equal(h.clicks.length, 1); assert.equal(h.controller.state.restored, false);
});
for (const [name, mutate] of [
  ['disabled', (b) => { b.disabled = true; }],
  ['aria-disabled', (b) => { b.attrs['aria-disabled'] = 'true'; }],
  ['detached', (b) => { b.isConnected = false; }],
  ['invisible', (b) => { b.getClientRects = () => []; }],
]) test('collector rejects ' + name + ' target button before click', () => {
  const h = harness(); mutate(h.d.domGroups[0].buttons[1]); h.controller.start(); h.run();
  assert.equal(h.controller.state.reason, 'control'); assert.equal(h.clicks.length, 0);
});
test('environment must be established by accepted current native capture', () => {
  const h = harness(); h.setEstablished(false);
  assert.equal(h.controller.start(), false); assert.equal(h.controller.state.reason, 'wait-delivery');
  assert.equal(h.clicks.length, 0); assert.equal(h.timers.size, 0);
});
test('hard click ceiling rejects before the first click', () => {
  const h = harness(false, { options: { maxClicks: 1 } });
  assert.equal(h.controller.start(), false); assert.equal(h.controller.state.reason, 'click-cap'); assert.equal(h.clicks.length, 0);
});
test('existing exact cache entries satisfy targets without waiting for another capture', () => {
  const h = harness(false, { noCapture: true });
  h.p.skus.forEach((sku) => capture(h.p, sku, h.cache));
  h.controller.start(); h.run();
  assert.equal(h.controller.state.observed, 4); assert.equal(h.controller.state.phase, 'completed');
  assert.ok(h.states.length < 30);
});
test('wrong-SKU passive capture ignored; timeout remains not-observed, traversal continues', () => {
  const h = harness(false, { noCapture: true });
  h.after(() => capture(h.p, h.p.skus[0], h.cache));
  h.controller.start(); h.run();
  assert.equal(h.controller.state.phase, 'completed'); assert.equal(h.controller.state.observed, 1);
  assert.equal(h.controller.state.visited, 4);
  const snapshot = core.createProductExportSnapshot(h.p, h.cache, h.environment);
  assert.deepEqual(snapshot.skus.map((s) => s.deliveryObservation.state), ['present', 'not-observed', 'not-observed', 'not-observed']);
});
test('invalid matching passive capture is distinct from timeout and does not fabricate delivery', () => {
  const h = harness(false, { noCapture: true });
  h.after((sku) => capture(h.p, sku, h.cache, { invalid: true }));
  h.controller.start(); h.run();
  assert.equal(h.controller.state.visited, 4); assert.equal(h.controller.state.observed, 1);
  assert.equal(core.observeSkuDelivery(h.p, h.p.skus[1], h.cache, h.environment).deliveryObservation.state, 'invalid');
});
test('Cancel safely restores via precomputed real path', () => {
  const h = harness(true); h.controller.start();
  h.until(() => h.clicks.length === 2); h.controller.cancel(); h.run();
  assert.equal(h.controller.state.phase, 'cancelled'); assert.equal(h.controller.state.restored, true);
  assert.equal(h.p.selectedSkuId, h.p.skus[0].skuId);
});
test('Cancel does not fight an external route change', () => {
  const h = harness(); h.controller.start(); h.until(() => h.clicks.length === 1);
  h.setUrl(route(h.p, h.p.skus[3].skuId)); h.controller.cancel(); h.run();
  assert.equal(h.controller.state.phase, 'failed'); assert.equal(h.clicks.length, 1);
});
test('restore failure is explicit and safely stops', () => {
  const h = harness(); h.controller.start();
  h.until(() => h.controller.state.phase === 'restoring');
  h.d.domGroups[0].buttons[0].disabled = true; h.run();
  assert.equal(h.controller.state.phase, 'failed'); assert.equal(h.controller.state.reason, 'restore-control');
  assert.match(core.formatVariantDeliveryProgress(h.controller.state, 'en'), /could not be safely restored/);
  assert.equal(h.clicks.length, 3);
});
test('route/product convergence may wait but exact unexpected route aborts; route timeout is finite', () => {
  const h = harness();
  const original = h.p.selectedSkuId;
  h.after(() => { select(h.p, original); h.setUrl(route(h.p)); });
  h.controller.start(); h.run();
  assert.equal(h.controller.state.reason, 'route-timeout'); assert.equal(h.clicks.length, 1);
});
test('dispose clears timer without any automatic restoration clicks', () => {
  const h = harness(); h.controller.start(); h.controller.dispose();
  assert.equal(h.controller.state.phase, 'failed'); assert.equal(h.timers.size, 0);
  assert.equal(h.controller.start(), false); assert.equal(h.clicks.length, 0);
});

test('projection preserves source fields and selected top-level delivery; no cache internals', () => {
  const p = model(); const cache = core.createDeliveryCache();
  const env = capture(p, p.skus[0], cache).environment;
  const selected = core.applyCachedDelivery(p, cache, env);
  const before = clone(selected);
  const snapshot = core.createProductExportSnapshot(selected, cache, env);
  assert.deepEqual(selected, before); assert.notEqual(snapshot, selected);
  assert.notEqual(snapshot.skus[0], selected.skus[0]);
  assert.deepEqual(snapshot.delivery, selected.delivery);
  assert.equal(snapshot.selectedSku, snapshot.skus[0]);
  assert.equal(snapshot.skus[0].rawSkuAttr, selected.skus[0].rawSkuAttr);
  const output = JSON.parse(core.exportProduct(snapshot));
  assert.equal(output.skus[0].deliveryObservation.state, 'present');
  assert.equal(output.skus[1].deliveryObservation.state, 'not-observed');
  assert.doesNotMatch(JSON.stringify(output), /byContext|contextKeysBySku|matchAnyPrice/);
});
for (const [name, alter] of [
  ['destination', (env) => { env.destination.cityCode = 'other'; }],
  ['currency', (env) => { env.tradeCurrency = 'EUR'; }],
  ['count', (env) => { env.count = '2'; }],
  ['price', (env, p) => { p.skus[0].price.current.value = '99'; }],
  ['buyer price context', (env, p) => { p.skus[0].buyerPriceForLogistic = '999'; }],
  ['item', (env, p) => { p.itemId = '999'; }],
  ['SKU', (env, p) => { p.skus[0].skuId = '999'; }],
]) test('projection exact binding prevents leakage: ' + name, () => {
  const p = model(); const cache = core.createDeliveryCache();
  const env = capture(p, p.skus[0], cache).environment; alter(env, p);
  const snapshot = core.createProductExportSnapshot(p, cache, env);
  assert.equal(snapshot.skus[0].delivery, null); assert.equal(snapshot.skus[0].deliveryObservation.state, 'not-observed');
});
test('projection distinguishes all states and retains multiple methods and equal shipping rows', () => {
  const p = model(); const cache = core.createDeliveryCache();
  const response = shippingResponse(); response.displayMultipleMethods = true;
  response.methods.push({ ...clone(response.methods[0]), serviceName: 'SECOND_NATIVE_METHOD', amount: { value: '2', currency: 'USD', formatted: '$2' } });
  const env = capture(p, p.skus[0], cache, { cost: '5.77', response }).environment;
  capture(p, p.skus[1], cache, { invalid: true });
  capture(p, p.skus[2], cache); capture(p, p.skus[3], cache);
  const snapshot = core.createProductExportSnapshot(p, cache, env);
  assert.deepEqual(snapshot.skus.map((s) => s.deliveryObservation.state), ['present', 'invalid', 'present', 'present']);
  assert.equal(snapshot.skus[1].delivery, null);
  assert.deepEqual(snapshot.skus[1].deliveryObservation, { state: 'invalid', sources: ['native:shipping-calculate'], diagnostic: 'schema-mismatch' });
  const variants = core.exportVariants(snapshot), ai = core.exportForChatGPT(snapshot);
  for (const output of [variants, ai]) {
    for (const sku of p.skus) {
      assert.ok(output.includes(sku.skuId)); assert.ok(output.includes(sku.price.current.formatted));
      assert.ok(output.includes(sku.price.regular.formatted)); assert.ok(output.includes(core.formatSelections(sku)));
    }
    assert.match(output, /invalid \(schema-mismatch\)/); assert.match(output, /SECOND_NATIVE_METHOD/);
    assert.match(output, /\$5.77/); assert.match(output, /\$2/);
    assert.equal(output.split('\n').filter((line) => line.includes('$0.90')).length, 2);
  }
  assert.equal(snapshot.skus[0].delivery.methods.length, 2);
});
test('uncaptured export says not observed; all 45 prices exported without collector cap', () => {
  const p = real45(); const snapshot = core.createProductExportSnapshot(p, core.createDeliveryCache(), null);
  const text = core.exportForChatGPT(snapshot);
  assert.equal(text.split('\n').filter((line) => /\| not observed$/.test(line)).length, 45);
  p.skus.forEach((s) => assert.ok(text.includes(s.skuId)));
  assert.doesNotMatch(text, /\| (?:free|unavailable)$/i);
});
test('Product to Reviews handoff retains the same projected matrix and 256 KiB gate', () => {
  const p = model(); const cache = core.createDeliveryCache();
  const env = capture(p, p.skus[1], cache, { cost: '3.48' }).environment;
  const snapshot = core.createProductExportSnapshot(p, cache, env);
  let stored;
  const starter = core.createProductReviewWorkflowStarter({
    getPageUrl: () => route(p), getProduct: () => snapshot, formatProduct: core.exportForChatGPT,
    now: () => 1000, createWorkflowId: () => 'variant-delivery-test-0001',
    storage: { setItem(key, value) { stored = JSON.parse(value); }, removeItem() {} }, navigate() {},
  });
  assert.equal(starter.start(), true);
  assert.equal(stored.productChatgptText, core.exportForChatGPT(snapshot));
  assert.match(stored.productChatgptText, /\$3.48/);
  let errorCode;
  const large = core.createProductReviewWorkflowStarter({
    getPageUrl: () => route(p), getProduct: () => snapshot,
    formatProduct: () => core.exportForChatGPT(snapshot) + 'x'.repeat(256 * 1024),
    onError(code) { errorCode = code; },
    storage: { setItem() { assert.fail('oversized snapshot cannot be stored'); } },
  });
  assert.equal(large.start(), false); assert.equal(errorCode, 'tooLarge');
});
test('collector has no network sender; native click is the only page mutation', () => {
  const block = source.slice(source.indexOf('  const VARIANT_DELIVERY_LIMITS'), source.indexOf('  function humanVariantName'));
  assert.doesNotMatch(block, /\bfetch\b|\bXMLHttpRequest\b|GM[_\.].*request|freight\/calculate|\.send\s*\(|\.open\s*\(|location\.(assign|replace)|dispatchEvent/i);
  assert.equal((block.match(/button\.click\(\)/g) || []).length, 1);
  assert.doesNotMatch(block, /cookie|headers|preferWarehouse|scItemId|_bx-v/);
});
test('collector dedicated UI is secondary, localized and survives product updates', () => {
  const block = source.slice(source.indexOf('  function createPanel(runtime)'), source.indexOf('  function createReviewsPanel(runtime)'));
  assert.match(block, /data-action="delivery-collect" disabled/);
  assert.doesNotMatch(block, /class="primary" data-action="delivery-collect"/);
  assert.match(block, /data-delivery-progress role="status"/);
  assert.match(block, /statusController\.clear\(\);\s+renderCollector\(\)/);
  assert.match(block, /autoRedirect\.disabled = busy/);
  for (const locale of ['en', 'ru']) {
    const state = { phase: 'running', visited: 2, observed: 1, total: 4 };
    const text = core.formatVariantDeliveryProgress(state, locale);
    assert.ok(text.includes('2/4')); assert.ok(text.includes('1'));
    assert.ok(core.t(locale, 'deliveryCollector.help').length > 60);
    assert.ok(core.t(locale, 'deliveryCollector.cancel'));
  }
});
test('all Product export handlers use one snapshot and block intermediate-SKU actions', () => {
  const begin = source.indexOf("shadow.addEventListener('click', (event) => {", source.indexOf('  function createPanel(runtime)'));
  const end = source.indexOf("    autoRedirect.addEventListener('change'", begin);
  const effects = []; let handler; let busy = true;
  const snapshot = core.createProductExportSnapshot(model(), core.createDeliveryCache(), null);
  let snapshots = 0;
  const runtime = { product: model(), deliveryCollector: { get active() { return busy; }, start() { effects.push('start'); }, cancel() { effects.push('cancel'); } },
    createExportSnapshot() { snapshots++; return snapshot; }, reviewWorkflowStarter: { start() { effects.push('reviews'); } } };
  vm.runInNewContext(source.slice(begin, end), {
    shadow: { addEventListener(type, fn) { handler = fn; } }, runtime,
    exportProduct: core.exportProduct, exportVariants: core.exportVariants, exportForChatGPT: core.exportForChatGPT, exportDescription: core.exportDescription,
    copyWithFeedback(text) { effects.push(text); }, renderCollector() {}, reviewWorkflowButton: {},
    location: { href: route(snapshot), assign() { effects.push('navigate'); } },
  });
  const click = (action) => handler({ target: { closest() { return { dataset: { action } }; } } });
  for (const action of ['product', 'variants', 'chatgpt', 'description', 'market', 'review-workflow', 'delivery-collect']) click(action);
  assert.deepEqual(effects, []); assert.equal(snapshots, 0);
  click('delivery-cancel'); assert.deepEqual(effects, ['cancel']);
  busy = false;
  for (const action of ['product', 'variants', 'chatgpt']) click(action);
  assert.equal(snapshots, 3);
  assert.deepEqual(effects.slice(1), [core.exportProduct(snapshot), core.exportVariants(snapshot), core.exportForChatGPT(snapshot)]);
  const before = effects.slice(1);
  core.t('ru', 'deliveryCollector.start');
  assert.deepEqual(before, [core.exportProduct(snapshot), core.exportVariants(snapshot), core.exportForChatGPT(snapshot)]);
  assert.match(source, /getProduct: \(\) => runtime\.createExportSnapshot\(\)/);
});

test('maximum 2x4 real matrix has bounded real-edge paths from every original SKU', () => {
  const p = model(true);
  p.variantGroups[1].values.push({ id: '23', name: 'M' }, { id: '24', name: 'XL' });
  const vectors = [['11', '21'], ['11', '22'], ['11', '23'], ['11', '24'],
    ['12', '21'], ['12', '22'], ['12', '23'], ['12', '24']];
  p.skus = vectors.map((vector, i) => ({
    ...clone(p.skus[0]), skuId: String(100 + i),
    selections: vector.map((valueId, group) => ({ groupId: p.variantGroups[group].id, valueId })),
  }));
  for (const row of p.skus) {
    select(p, row.skuId);
    const plan = core.planVariantDelivery(p, mapping(p), 100);
    assert.equal(plan.ok, true);
    assert.equal(plan.maxClicks, 18);
    assert.equal(plan.visit.length, 8); assert.equal(new Set(plan.visit).size, 8);
    assert.ok(plan.worstClicks <= 9);
    for (const [id, steps] of Object.entries(plan.restorePaths)) {
      const current = [id, ...steps];
      assert.equal(current.at(-1), row.skuId);
      assert.ok(current.every((skuId) => p.skus.some((s) => s.skuId === skuId)));
    }
  }
});
test('exact two-group selection vector mismatch aborts even with expected selected SKU ID', () => {
  const h = harness(true);
  h.after(() => {
    h.p.selectedSku = clone(h.p.selectedSku);
    h.p.selectedSku.selections[0].valueId = '12';
  });
  h.controller.start(); h.run();
  assert.equal(h.controller.state.reason, 'selected'); assert.equal(h.clicks.length, 1);
});
test('route and normalized selected SKU must both converge before the next click', () => {
  const h = harness(); let expected;
  const original = h.p.selectedSkuId;
  h.after((target) => { expected = target.skuId; select(h.p, original); });
  h.controller.start(); h.tick(); h.tick();
  assert.equal(h.clicks.length, 1); assert.equal(h.controller.state.visited, 1);
  select(h.p, expected); h.after(null);
  h.run(); assert.equal(h.controller.state.phase, 'completed');
});
test('overall timeout stops collection and restores original with finite separate restore budget', () => {
  const h = harness(false, { noCapture: true });
  h.controller.start(); h.until(() => h.clicks.length === 1);
  h.setTime(120001); h.run();
  assert.equal(h.controller.state.phase, 'failed'); assert.equal(h.controller.state.reason, 'total-timeout');
  assert.equal(h.controller.state.restored, true); assert.equal(h.clicks.length, 2);
  const r = harness(); r.controller.start(); r.until(() => r.controller.state.phase === 'restoring');
  r.setTime(200000); r.run();
  assert.equal(r.controller.state.reason, 'restore-timeout'); assert.equal(r.clicks.length, 3);
});
test('frozen destination changes abort during Cancel instead of forcing restoration', () => {
  const h = harness(); h.controller.start(); h.until(() => h.clicks.length === 1);
  h.setEnvironment({ ...h.environment, destination: { ...h.environment.destination, cityCode: 'new-destination' } });
  h.controller.cancel(); h.run();
  assert.equal(h.controller.state.reason, 'environment'); assert.equal(h.clicks.length, 1);
});
test('another-environment cache result does not satisfy shipping wait', () => {
  const h = harness(false, { noCapture: true });
  h.after((sku) => {
    const response = shippingResponse(); response.to.city = 'other';
    capture(h.p, sku, h.cache, { response });
  });
  h.controller.start(); h.run();
  assert.equal(h.controller.state.observed, 1); assert.equal(h.controller.state.visited, 4);
});
test('legacy invalid wildcard remains selected-only; per-SKU projection requires exact price', () => {
  const p = model(); const cache = core.createDeliveryCache();
  const result = capture(p, p.skus[0], cache, { requestPatch: { buyerPrice: { malformed: true } } });
  assert.equal(result.event.diagnostic, 'schema-mismatch');
  assert.equal(core.applyCachedDelivery(p, cache, result.environment)._meta.sections.delivery.state, 'invalid');
  assert.equal(core.createProductExportSnapshot(p, cache, result.environment).skus[0].deliveryObservation.state, 'not-observed');
});
test('arbitrary-SKU shipping price context preserves captured cross-currency semantics and real zero', () => {
  const f = fixture('shipping-calculate-1005007275021771.json');
  const data = fixture('product-1005007275021771.json').data;
  const p = core.normalizeProduct(data, 'https://aliexpress.ru/item/' + data.id + '.html?sku_id=' + f.request.skuId);
  const cache = core.createDeliveryCache();
  const observation = core.cacheDeliveryCapture(cache, f.request, f.response, p.itemId, p.selectedSkuId);
  assert.equal(observation.diagnostic, null);
  const env = core.createShippingEnvironment(f.request, observation.normalized);
  const snapshot = core.createProductExportSnapshot(p, cache, env);
  assert.equal(snapshot.skus[0].deliveryObservation.state, 'present');
  assert.equal(snapshot.skus[0].delivery.methods[0].cost.value, '0');
  assert.deepEqual(core.skuShippingPriceContext(p.skus[0], env), {
    buyerPrice: String(f.request.buyerPrice), minPrice: String(f.request.minPrice), maxPrice: String(f.request.maxPrice),
  });
  const before = structuredClone(p);
  Object.freeze(p.skus[0]); Object.freeze(p.skus); Object.freeze(p);
  core.createProductExportSnapshot(p, cache, env); assert.deepEqual(p, before);
});
test('collector start rejects ambiguous route SKU and external selected value', () => {
  for (const bad of ['?sku_id=1&sku_id=2', '']) {
    const h = harness(); h.setUrl('https://aliexpress.ru/item/' + ITEM + '.html' + bad);
    assert.equal(h.controller.start(), false); assert.equal(h.clicks.length, 0);
  }
});
test('telemetry parser enforces bounded grammar and unique normalized model group names', () => {
  for (const raw of ['', null, "'unterminated", '{"sku_attr":null}', '['.repeat(10) + ']'.repeat(10), 'x'.repeat(32769),
    '{"sku_attr":[{"id":"1","name":"a\\\\b","values":["1"]}]}']) assert.equal(core.parseSkuTelemetry(raw), null);
  const p = model(true), d = dom(p);
  p.variantGroups[1].name = p.variantGroups[0].name;
  assert.equal(mapping(p, d).ok, false);
});
test('all accepted one-dimensional research prices and delivery differences remain separate export rows', () => {
  const p = model(), cache = core.createDeliveryCache();
  const costs = ['5.77', '3.48', '0.90', '0.90'];
  let environment;
  p.skus.forEach((sku, i) => { environment = capture(p, sku, cache, { cost: costs[i] }).environment; });
  const snapshot = core.createProductExportSnapshot(p, cache, environment);
  const text = core.formatRealSkuMatrix(snapshot);
  const lines = text.split('\n').slice(1);
  assert.equal(lines.length, 4);
  lines.forEach((line, i) => {
    assert.ok(line.includes(p.skus[i].price.current.formatted));
    assert.ok(line.includes(p.skus[i].price.regular.formatted));
    assert.ok(line.includes('$' + costs[i]));
  });
  assert.notEqual(lines[2], lines[3]);
});
