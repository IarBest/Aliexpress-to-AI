'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ali-helper.user.js'), 'utf8');

test('panel breakpoint keeps widths through 767px narrow and switches at 768px', () => {
  const cases = [
    [390, 'narrow'],
    [480, 'narrow'],
    [481, 'narrow'],
    [767, 'narrow'],
    [768, 'desktop'],
    [800, 'desktop'],
    [801, 'desktop'],
    [1920, 'desktop'],
  ];
  cases.forEach(([width, expected]) => assert.equal(core.panelModeForWidth(width), expected, `${width}px`));
});

test('fresh narrow presentation is minimized without changing either desktop preference', () => {
  for (const desktopCollapsed of [false, true]) {
    const settings = { panelCollapsed: desktopCollapsed };
    const state = core.createPanelLayoutState(390, settings.panelCollapsed);
    assert.equal(state.mode, 'narrow');
    assert.equal(core.isPanelLayoutCollapsed(state), true);
    assert.equal(state.desktopCollapsed, desktopCollapsed);
    assert.equal(settings.panelCollapsed, desktopCollapsed);
    assert.equal(core.panelCollapsedPreferenceToPersist(state), null);
  }
});

test('narrow toggles stay page-local and desktop restoration uses the persisted preference', () => {
  for (const desktopCollapsed of [false, true]) {
    let state = core.createPanelLayoutState(767, desktopCollapsed);
    state = core.togglePanelLayoutState(state);
    assert.equal(core.isPanelLayoutCollapsed(state), false);
    assert.equal(state.desktopCollapsed, desktopCollapsed);
    assert.equal(core.panelCollapsedPreferenceToPersist(state), null);

    state = core.setPanelLayoutViewport(state, 768);
    assert.equal(state.mode, 'desktop');
    assert.equal(core.isPanelLayoutCollapsed(state), desktopCollapsed);
    assert.equal(core.panelCollapsedPreferenceToPersist(state), desktopCollapsed);

    state = core.setPanelLayoutViewport(state, 767);
    assert.equal(core.isPanelLayoutCollapsed(state), false, 'page-local narrow choice survives a breakpoint round trip');
  }
});

test('desktop toggles update only the desktop collapse preference', () => {
  let state = core.createPanelLayoutState(1920, false);
  state = core.togglePanelLayoutState(state);
  assert.equal(state.desktopCollapsed, true);
  assert.equal(state.narrowCollapsed, true);
  assert.equal(core.panelCollapsedPreferenceToPersist(state), true);

  state = core.setPanelLayoutMode(state, 'narrow');
  assert.equal(core.isPanelLayoutCollapsed(state), true);
  state = core.togglePanelLayoutState(state);
  assert.equal(state.desktopCollapsed, true);
  assert.equal(core.panelCollapsedPreferenceToPersist(state), null);
});

test('product action contract keeps exactly six unique existing identities and labels', () => {
  const actions = core.PRODUCT_PANEL_CONTRACT.actions;
  assert.deepEqual(actions.map(({ id, label }) => [id, label]), [
    ['clean-url', 'Copy clean URL'],
    ['market', 'RU / COM'],
    ['product', 'Copy product'],
    ['variants', 'Copy variants'],
    ['chatgpt', 'Copy for ChatGPT'],
    ['description', 'Copy description'],
  ]);
  assert.equal(actions.length, 6);
  assert.equal(new Set(actions.map(({ id }) => id)).size, 6);
});

test('product-data gate remains limited to product, variants, ChatGPT, and description', () => {
  const gated = core.PRODUCT_PANEL_CONTRACT.actions
    .filter(({ requiresProduct }) => requiresProduct)
    .map(({ id }) => id);
  assert.deepEqual(gated, ['product', 'variants', 'chatgpt', 'description']);
  assert.equal(core.PRODUCT_PANEL_CONTRACT.actions.find(({ id }) => id === 'clean-url').requiresProduct, false);
  assert.equal(core.PRODUCT_PANEL_CONTRACT.actions.find(({ id }) => id === 'market').requiresProduct, false);
});

test('product rows preserve desktop organization and use three pairs only in narrow mode', () => {
  assert.deepEqual(
    core.PRODUCT_PANEL_CONTRACT.actions.map(({ id, desktopWide }) => [id, desktopWide]),
    [
      ['clean-url', false],
      ['market', false],
      ['product', false],
      ['variants', false],
      ['chatgpt', true],
      ['description', true],
    ],
  );
  const productStart = source.indexOf('function createPanel(runtime)');
  const productEnd = source.indexOf('function createReviewsPanel(runtime)');
  const productSource = source.slice(productStart, productEnd);
  assert.match(productSource, /renderPanelActionButtons\(PRODUCT_PANEL_CONTRACT\.actions\)/);
  assert.match(productSource, /\.wide \{ grid-column:1\/-1; \}/);
  assert.match(productSource, /\.grid \.wide \{ grid-column:auto; \}/);
});

test('Reviews uses the shared shell contract and retains its existing two stacked actions', () => {
  assert.equal(core.REVIEWS_PANEL_CONTRACT.shell, core.PRODUCT_PANEL_CONTRACT.shell);
  assert.deepEqual(core.REVIEWS_PANEL_CONTRACT.actions.map(({ id, label }) => [id, label]), [
    ['reviews', 'Copy reviews JSON'],
    ['reviews-chatgpt', 'Copy reviews for ChatGPT'],
  ]);
  const productStart = source.indexOf('function createPanel(runtime)');
  const productEnd = source.indexOf('function createReviewsPanel(runtime)');
  const reviewsEnd = source.indexOf('function startReviewsPage');
  const productSource = source.slice(productStart, productEnd);
  const reviewsSource = source.slice(productEnd, reviewsEnd);
  assert.equal((productSource.match(/SHARED_PANEL_STYLES/g) || []).length, 1);
  assert.equal((productSource.match(/bindResponsivePanel\(/g) || []).length, 1);
  assert.equal((reviewsSource.match(/SHARED_PANEL_STYLES/g) || []).length, 1);
  assert.equal((reviewsSource.match(/bindResponsivePanel\(/g) || []).length, 1);
  assert.match(reviewsSource, /\.actions \{ display:flex; flex-direction:column; gap:7px; \}/);
  assert.match(reviewsSource, /renderPanelActionButtons\(REVIEWS_PANEL_CONTRACT\.actions, 'action'\)/);
});

test('responsive transitions retain one state and one unchanged action contract', () => {
  const actions = core.PRODUCT_PANEL_CONTRACT.actions;
  let state = core.createPanelLayoutState(1920, false);
  for (const width of [767, 768, 767, 1920, 767, 768]) {
    state = core.setPanelLayoutViewport(state, width);
    assert.deepEqual(Object.keys(state).sort(), ['desktopCollapsed', 'mode', 'narrowCollapsed']);
    assert.equal(core.PRODUCT_PANEL_CONTRACT.actions, actions);
    assert.equal(new Set(actions.map(({ id }) => id)).size, 6);
  }

  const bindStart = source.indexOf('function bindResponsivePanel');
  const bindEnd = source.indexOf('function createPanel(runtime)');
  assert.ok(bindStart >= 0 && bindEnd > bindStart);
  const transitionSource = source.slice(bindStart, bindEnd);
  assert.doesNotMatch(transitionSource, /createElement|appendChild|innerHTML|renderPanelActionButtons|setProduct|setReviews|install\w*Interceptor/);
});

test('responsive controller installs one media listener and removes it idempotently', () => {
  const listeners = new Set();
  const calls = { added: 0, removed: 0 };
  const mediaQuery = {
    matches: true,
    addEventListener(type, listener) {
      assert.equal(type, 'change');
      calls.added += 1;
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'change');
      calls.removed += 1;
      listeners.delete(listener);
    },
    change(matches) {
      this.matches = matches;
      [...listeners].forEach((listener) => listener({ matches }));
    },
  };
  const applied = [];
  const persisted = [];
  const controller = core.createResponsivePanelController(
    mediaQuery,
    false,
    (state, view) => applied.push({ state, view }),
    (value) => persisted.push(value),
  );

  assert.equal(calls.added, 1);
  assert.equal(listeners.size, 1);
  assert.equal(applied.at(-1).state.mode, 'narrow');
  assert.equal(applied.at(-1).view.ariaExpanded, 'false');
  controller.toggle();
  assert.equal(persisted.length, 0);
  mediaQuery.change(false);
  assert.equal(applied.at(-1).state.mode, 'desktop');
  assert.equal(applied.at(-1).view.ariaExpanded, 'true');
  controller.toggle();
  assert.deepEqual(persisted, [true]);

  const appliesBeforeDestroy = applied.length;
  controller.destroy();
  controller.destroy();
  assert.equal(calls.removed, 1);
  assert.equal(listeners.size, 0);
  mediaQuery.change(true);
  assert.equal(applied.length, appliesBeforeDestroy);
});

test('shared narrow shell contract drives clearance, bounds, and internal body scrolling', () => {
  assert.deepEqual(core.PANEL_SHELL_CONTRACT, {
    id: 'responsive-panel-v1',
    narrowMaxWidth: 767,
    narrowLowerClearance: 120,
    narrowExpandedMaxViewportHeight: 50,
    narrowCollapsedMaxWidth: 180,
    narrowCollapsedMaxHeight: 52,
  });
  assert.match(source, /bottom:calc\(\$\{PANEL_SHELL_CONTRACT\.narrowLowerClearance\}px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.doesNotMatch(source, /narrowLowerClearance:\s*72\b/);
  assert.match(source, /max-height:min\(\$\{PANEL_SHELL_CONTRACT\.narrowExpandedMaxViewportHeight\}dvh/);
  assert.match(source, /\.panel\.collapsed \{ width:\$\{PANEL_SHELL_CONTRACT\.narrowCollapsedMaxWidth\}px; max-height:\$\{PANEL_SHELL_CONTRACT\.narrowCollapsedMaxHeight\}px; \}/);
  assert.match(source, /\.body \{ flex:1 1 auto; min-height:0; max-height:none; overflow-x:hidden; overflow-y:auto;/);
});

test('120px narrow reservation models the accepted 390x844 purchase clearance', () => {
  const viewportHeight = 844;
  const purchaseToolbarTop = 739;
  const helperBottom = viewportHeight - core.PANEL_SHELL_CONTRACT.narrowLowerClearance;
  const states = ['minimized', 'expanded', 'disclosure-open', 'disclosure-and-settings-open'];

  assert.equal(helperBottom, 724);
  assert.equal(purchaseToolbarTop - helperBottom, 15);
  assert.deepEqual(states.map(() => helperBottom), [724, 724, 724, 724]);
});

test('120px narrow reservation keeps the 360x600 shell inside its viewport', () => {
  const viewport = { width: 360, height: 600 };
  const rightInset = 12;
  const horizontalInset = 24;
  const expandedWidth = Math.min(320, viewport.width - horizontalInset);
  const expandedHeight = viewport.height * (core.PANEL_SHELL_CONTRACT.narrowExpandedMaxViewportHeight / 100);
  const helperBottom = viewport.height - core.PANEL_SHELL_CONTRACT.narrowLowerClearance;
  const helperTop = helperBottom - expandedHeight;
  const helperLeft = viewport.width - rightInset - expandedWidth;

  assert.equal(expandedHeight, 300);
  assert.equal(helperBottom, 480);
  assert.equal(helperTop, 180);
  assert.equal(expandedWidth, 320);
  assert.equal(helperLeft, 28);
  assert.ok(helperTop >= 0);
  assert.ok(helperLeft >= 0);
  assert.ok(helperLeft + expandedWidth <= viewport.width);
});

test('800x600 uses desktop mode and the normal desktop bottom placement', () => {
  const viewport = { width: 800, height: 600 };
  assert.equal(core.panelModeForWidth(viewport.width), 'desktop');
  assert.match(source, /:host \{ all:initial; position:fixed; right:16px; bottom:16px;/);
});

test('toggle view exposes a stable name and synchronized accessible state', () => {
  let state = core.createPanelLayoutState(390, false);
  const collapsed = core.panelToggleView(state);
  assert.equal(collapsed.ariaLabel, 'Toggle Ali Helper panel');
  assert.equal(collapsed.ariaExpanded, 'false');
  assert.equal(collapsed.symbol, '+');

  state = core.togglePanelLayoutState(state);
  const expanded = core.panelToggleView(state);
  assert.equal(expanded.ariaLabel, collapsed.ariaLabel);
  assert.equal(expanded.ariaExpanded, 'true');
  assert.equal(expanded.symbol, '—');
  assert.match(source, /button:focus-visible, summary:focus-visible, input:focus-visible/);
  const bindStart = source.indexOf('function bindResponsivePanel');
  const bindEnd = source.indexOf('function createPanel(runtime)');
  const bindSource = source.slice(bindStart, bindEnd);
  assert.match(bindSource, /toggle\.setAttribute\('aria-label', toggleView\.ariaLabel\)/);
  assert.match(bindSource, /toggle\.setAttribute\('aria-expanded', toggleView\.ariaExpanded\)/);
  const nativeToggle = /<button type="button" class="icon" data-action="toggle">—<\/button>/g;
  assert.equal((source.match(nativeToggle) || []).length, 2);
});

test('panel builders contain no request-producing or purchase-control behavior', () => {
  const uiStart = source.indexOf('const SHARED_PANEL_STYLES');
  const uiEnd = source.indexOf('function startReviewsPage');
  assert.ok(uiStart >= 0 && uiEnd > uiStart);
  const uiSource = source.slice(uiStart, uiEnd);
  assert.doesNotMatch(uiSource, /\bfetch\s*\(|\bXMLHttpRequest\b|GM_xmlhttpRequest|\.open\s*\(|\.send\s*\(|\.click\s*\(/);
  assert.doesNotMatch(uiSource, /freight\/calculate|product-reviews|add\s*to\s*cart|buy\s*now|checkout|seller_chat_btn/i);
  const productStart = source.indexOf('function createPanel(runtime)');
  const reviewsStart = source.indexOf('function createReviewsPanel(runtime)');
  const reviewsEnd = source.indexOf('function startReviewsPage');
  const productActions = [...source.slice(productStart, reviewsStart).matchAll(/action === '([^']+)'/g)]
    .map((match) => match[1]);
  const reviewActions = [...source.slice(reviewsStart, reviewsEnd).matchAll(/action === '([^']+)'/g)]
    .map((match) => match[1]);
  assert.deepEqual(productActions, [
    'toggle', 'clean-url', 'market', 'product', 'variants', 'chatgpt', 'description', 'shipping-debug',
  ]);
  assert.deepEqual(reviewActions, ['toggle', 'reviews', 'reviews-chatgpt']);
});
