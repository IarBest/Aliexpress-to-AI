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

test('product action contract adds one workflow before the six existing identities and labels', () => {
  const actions = core.PRODUCT_PANEL_CONTRACT.actions;
  assert.deepEqual(actions.map(({ id, label }) => [id, label]), [
    ['review-workflow', 'Collect product + reviews for ChatGPT'],
    ['chatgpt', 'Copy product for ChatGPT'],
    ['product', 'Copy product JSON'],
    ['variants', 'Copy variants'],
    ['description', 'Copy description'],
    ['clean-url', 'Copy clean URL'],
    ['market', 'RU / COM'],
  ]);
  assert.equal(actions.length, 7);
  assert.equal(new Set(actions.map(({ id }) => id)).size, 7);
  assert.deepEqual(actions.filter(({ primary }) => primary).map(({ id }) => id), ['review-workflow']);
});

test('product-data gate remains limited to product, variants, ChatGPT, and description', () => {
  const gated = core.PRODUCT_PANEL_CONTRACT.actions
    .filter(({ requiresProduct }) => requiresProduct)
    .map(({ id }) => id);
  assert.deepEqual(gated, ['review-workflow', 'chatgpt', 'product', 'variants', 'description']);
  assert.equal(core.PRODUCT_PANEL_CONTRACT.actions.find(({ id }) => id === 'clean-url').requiresProduct, false);
  assert.equal(core.PRODUCT_PANEL_CONTRACT.actions.find(({ id }) => id === 'market').requiresProduct, false);
});

test('Product renders two captionless accessible clusters in exact DOM and focus order', () => {
  assert.deepEqual(
    core.PRODUCT_PANEL_GROUPS.map(({ id, ariaLabel, actionIds }) => [id, ariaLabel, actionIds]),
    [
      ['export', 'Product export', ['review-workflow', 'chatgpt', 'product', 'variants', 'description']],
      ['quick', 'Quick actions', ['clean-url', 'market']],
    ],
  );
  assert.equal(Object.isFrozen(core.PRODUCT_PANEL_GROUPS), true);
  core.PRODUCT_PANEL_GROUPS.forEach((group) => {
    assert.equal(Object.isFrozen(group), true);
    assert.equal(Object.isFrozen(group.actionIds), true);
  });
  assert.deepEqual(
    core.PRODUCT_PANEL_CONTRACT.actions.map(({ id, desktopWide }) => [id, desktopWide]),
    [
      ['review-workflow', true],
      ['chatgpt', true],
      ['product', false],
      ['variants', false],
      ['description', true],
      ['clean-url', false],
      ['market', false],
    ],
  );
  const html = core.renderProductActionGroups();
  assert.deepEqual(
    [...html.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
    ['review-workflow', 'chatgpt', 'product', 'variants', 'description', 'clean-url', 'market'],
  );
  assert.equal((html.match(/role="group"/g) || []).length, 2);
  assert.match(html, /class="action-group action-group-export" data-action-group="export" role="group" aria-label="Product export"/);
  assert.match(html, /class="action-group action-group-quick" data-action-group="quick" role="group" aria-label="Quick actions"/);
  assert.doesNotMatch(html, /<h[1-6]\b|group-label|>\s*Quick actions\s*<|>\s*Product export\s*</);
  assert.match(html, /class="wide primary" data-action="review-workflow"/);
  assert.match(html, /class="wide" data-action="chatgpt"/);
  assert.match(html, /data-action="review-workflow" aria-label="Collect product and bounded Reviews for a combined ChatGPT export\."/);
  assert.match(html, /class="wide" data-action="description"/);
  assert.doesNotMatch(html, /class="[^"]*wide[^"]*" data-action="(?:product|variants|clean-url|market)"/);
  const productStart = source.indexOf('function createPanel(runtime)');
  const productEnd = source.indexOf('function createReviewsPanel(runtime)');
  const productSource = source.slice(productStart, productEnd);
  assert.match(productSource, /renderProductActionGroups\(false\)/);
  assert.match(source, /function renderProductActionGroups\(includeText = true\)/);
  assert.match(productSource, /\.action-groups \{ display:grid; gap:15px; \}/);
  assert.match(productSource, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(productSource, /\.grid \{[^}]*gap:8px;/);
  assert.match(productSource, /\.wide \{ grid-column:1\/-1; \}/);
  assert.doesNotMatch(productSource, /\.grid \.wide \{ grid-column:auto; \}/);
  assert.doesNotMatch(productSource, /group-label|>Additional<|label: 'Additional'/);
  assert.match(source, /white-space:normal; overflow-wrap:anywhere/);
});

test('Product actions precede disclosures in the same order used by keyboard navigation', () => {
  const productStart = source.indexOf('function createPanel(runtime)');
  const productEnd = source.indexOf('function createReviewsPanel(runtime)');
  const productSource = source.slice(productStart, productEnd);
  const renderedActions = core.renderProductActionGroups();
  const focusOrder = [...renderedActions.matchAll(/<button[^>]*data-action="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(focusOrder, ['review-workflow', 'chatgpt', 'product', 'variants', 'description', 'clean-url', 'market']);
  assert.ok(productSource.indexOf('renderProductActionGroups(false)') < productSource.indexOf('data-section-disclosure hidden'));
  assert.ok(productSource.indexOf('data-section-disclosure hidden') < productSource.indexOf('data-product-settings'));
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
  assert.match(reviewsSource, /renderReviewsPanelMainContent\(\)/);
  assert.match(core.renderReviewsPanelMainContent(), /data-action="reviews"[\s\S]*data-action="reviews-chatgpt"/);
});

test('Reviews production markup keeps contextual workflow actions ahead of both statuses and permanent actions', () => {
  const html = core.renderReviewsPanelMainContent();
  const position = (marker) => {
    const index = html.indexOf(marker);
    assert.notEqual(index, -1, marker);
    return index;
  };
  const workflowStart = position('data-action="review-workflow-start"');
  const workflowCancel = position('data-action="review-workflow-cancel"');
  const workflowCopy = position('data-action="review-workflow-copy"');
  const workflowStatus = position('data-review-workflow-status');
  const reviewsStatus = position('class="status"');
  const permanentActions = position('class="actions"');

  assert.ok(workflowCopy < workflowStatus, 'ready combined-copy precedes workflow status');
  assert.ok(workflowStatus < reviewsStatus, 'workflow status precedes general Reviews status');
  assert.ok(reviewsStatus < permanentActions, 'general Reviews status precedes permanent actions');
  assert.ok(workflowStart < workflowStatus && workflowStart < reviewsStatus, 'manual Start uses the top workflow action area');
  assert.ok(workflowCancel < workflowStatus, 'running Cancel precedes workflow progress/status');
});

test('hidden Reviews workflow leaves the ordinary status/action flow intact', () => {
  const html = core.renderReviewsPanelMainContent();
  assert.match(html, /<section class="review-workflow" data-review-workflow hidden>/);
  assert.ok(html.indexOf('class="status"') < html.indexOf('class="actions"'));
  assert.deepEqual(
    [...html.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
    ['review-workflow-start', 'review-workflow-cancel', 'review-workflow-copy', 'reviews', 'reviews-chatgpt'],
  );
  assert.match(source, /\.review-workflow\[hidden\] \{ display:none; \}/);
});

test('Reviews owns one passive settings disclosure with exactly the four presets', () => {
  const productStart = source.indexOf('function createPanel(runtime)');
  const reviewsStart = source.indexOf('function createReviewsPanel(runtime)');
  const reviewsEnd = source.indexOf('function startReviewsPage');
  const productSource = source.slice(productStart, reviewsStart);
  const reviewsSource = source.slice(reviewsStart, reviewsEnd);
  assert.equal((reviewsSource.match(/<details class="review-settings">/g) || []).length, 1);
  assert.match(reviewsSource, /<summary data-review-settings-summary><\/summary>/);
  assert.match(reviewsSource, /data-review-retention-label/);
  assert.deepEqual(
    [...reviewsSource.matchAll(/<option value="(10|30|50|100)" data-review-retention-option="\1"(?: selected)?><\/option>/g)]
      .map((match) => match[1]),
    ['10', '30', '50', '100'],
  );
  assert.deepEqual(
    [10, 30, 50, 100].map((cap) => [String(cap), core.t('en', `reviews.retention.${cap}`)]),
    [
      ['10', '10 reviews'],
      ['30', '30 reviews (default)'],
      ['50', '50 reviews'],
      ['100', '100 reviews'],
    ],
  );
  assert.match(reviewsSource, /<option value="30" data-review-retention-option="30" selected><\/option>/);
  assert.match(reviewsSource, /data-review-setting-help/);
  assert.equal(core.t('en', 'reviews.retention.invalid'), 'Not saved. Choose 10, 30, 50, or 100 reviews.');
  assert.doesNotMatch(productSource, /Review settings|passiveReviewRetentionCap|Passive review retention/);
  assert.equal((productSource.match(/data-product-settings/g) || []).length, 1);
});

test('Reviews settings keep the accepted 767/768 shell behavior and add no third action', () => {
  assert.equal(core.panelModeForWidth(767), 'narrow');
  assert.equal(core.createPanelLayoutState(767, false).narrowCollapsed, true);
  assert.equal(core.panelModeForWidth(768), 'desktop');
  assert.equal(core.REVIEWS_PANEL_CONTRACT.actions.length, 2);
  const reviewsStart = source.indexOf('function createReviewsPanel(runtime)');
  const reviewsEnd = source.indexOf('function startReviewsPage');
  const reviewsSource = source.slice(reviewsStart, reviewsEnd);
  assert.match(reviewsSource, /review-setting-control select \{ box-sizing:border-box; width:100%/);
  assert.match(reviewsSource, /@media \(max-width:\$\{PANEL_SHELL_CONTRACT\.narrowMaxWidth\}px\)/);
  assert.doesNotMatch(reviewsSource, /data-action="(?:load|fetch|request|download)/i);
});

test('responsive transitions retain one state and one unchanged action contract', () => {
  const actions = core.PRODUCT_PANEL_CONTRACT.actions;
  let state = core.createPanelLayoutState(1920, false);
  for (const width of [767, 768, 767, 1920, 767, 768]) {
    state = core.setPanelLayoutViewport(state, width);
    assert.deepEqual(Object.keys(state).sort(), ['desktopCollapsed', 'mode', 'narrowCollapsed']);
    assert.equal(core.PRODUCT_PANEL_CONTRACT.actions, actions);
    assert.equal(new Set(actions.map(({ id }) => id)).size, 7);
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
  assert.equal(collapsed.ariaLabel, 'Expand Ali Helper panel.');
  assert.equal(collapsed.ariaExpanded, 'false');
  assert.equal(collapsed.symbol, '+');
  assert.equal(collapsed.tooltip, 'Expand Ali Helper panel.');

  state = core.togglePanelLayoutState(state);
  const expanded = core.panelToggleView(state);
  assert.equal(expanded.ariaLabel, 'Collapse Ali Helper panel.');
  assert.equal(expanded.ariaExpanded, 'true');
  assert.equal(expanded.symbol, '—');
  assert.equal(expanded.tooltip, 'Collapse Ali Helper panel.');
  assert.match(source, /button:focus-visible, summary:focus-visible, input:focus-visible/);
  const bindStart = source.indexOf('function bindResponsivePanel');
  const bindEnd = source.indexOf('function createPanel(runtime)');
  const bindSource = source.slice(bindStart, bindEnd);
  assert.match(bindSource, /toggle\.setAttribute\('aria-label', toggleView\.ariaLabel\)/);
  assert.match(bindSource, /toggle\.setAttribute\('aria-expanded', toggleView\.ariaExpanded\)/);
  assert.match(bindSource, /toggle\.dataset\.tooltip = toggleView\.tooltip/);
  assert.doesNotMatch(bindSource, /toggle\.title|setAttribute\(['"]title/);
  assert.equal((source.match(/\$\{renderPanelHeader\(\)\}/g) || []).length, 2);
  const header = core.renderPanelHeader();
  assert.ok(header.indexOf('data-action="language"') < header.indexOf('data-action="toggle"'));
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
    'language', 'toggle', 'clean-url', 'market', 'review-workflow', 'product', 'variants', 'chatgpt', 'description', 'shipping-debug',
  ]);
  assert.deepEqual(reviewActions, [
    'language', 'toggle', 'review-workflow-start', 'review-workflow-cancel', 'review-workflow-copy', 'reviews', 'reviews-chatgpt',
  ]);
});

test('each existing Product action keeps exactly one original handler mapping', () => {
  const productStart = source.indexOf('function createPanel(runtime)');
  const productEnd = source.indexOf('function createReviewsPanel(runtime)');
  const productSource = source.slice(productStart, productEnd);
  assert.equal((productSource.match(/shadow\.addEventListener\('click'/g) || []).length, 1);
  const mappings = [
    ['clean-url', /copyWithFeedback\(normalizeItemUrl\(location\.href\)\.href, 'copy\.cleanUrlSuccess'\)/g],
    ['market', /location\.assign\(toggleMarketUrl\(location\.href\)\.href\)/g],
    ['product', /copyWithFeedback\(exportProduct\(product\), 'copy\.productJsonSuccess'\)/g],
    ['variants', /copyWithFeedback\(exportVariants\(product\), 'copy\.variantsSuccess'\)/g],
    ['chatgpt', /copyWithFeedback\(exportForChatGPT\(product\), 'copy\.productChatgptSuccess'\)/g],
    ['description', /copyWithFeedback\(exportDescription\(product\), 'copy\.descriptionSuccess'\)/g],
  ];
  mappings.forEach(([actionId, operation]) => {
    assert.equal((productSource.match(new RegExp(`action === '${actionId}'`, 'g')) || []).length, 1, actionId);
    assert.equal((productSource.match(operation) || []).length, 1, `${actionId} operation`);
  });
});

test('shared shell is neutral, status is live but lightweight, and footer branding is safe', () => {
  assert.doesNotMatch(source, /#ffefe8|peach|gradient/i);
  assert.match(source, /header \{[^}]*padding:8px 9px 8px 12px;[^}]*background:#e9eef3;[^}]*border-bottom:1px solid #d7dfe8;/);
  const headerRule = source.match(/header \{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(headerRule, /(?:^|;)\s*height:/);
  assert.match(source, /strong \{[^}]*font-size:14px;[^}]*font-weight:600;/);
  assert.equal((source.match(/\$\{renderPanelHeader\(\)\}/g) || []).length, 2);
  assert.match(core.renderPanelHeader(), /data-action="language"[\s\S]*data-action="toggle"/);
  assert.match(source, /button\.primary \{ color:#fff; background:#365f8c; border-color:#365f8c; \}/);
  assert.match(source, /\.status \{[^}]*border-bottom:1px solid #e4e9ef;/);
  assert.doesNotMatch(source, /\.status \{[^}]*border-radius|\.status \{[^}]*background:/);
  assert.match(source, /\.product-status \{ min-height:0; margin:0 0 9px; padding:0 1px; border-bottom:0; \}/);
  assert.match(source, /\.product-status\[hidden\] \{ display:none; \}/);
  assert.equal((source.match(/role="status" aria-live="polite" aria-atomic="true"/g) || []).length, 2);
  assert.equal((source.match(/href="https:\/\/bigbensoft\.com\/"/g) || []).length, 2);
  assert.equal((source.match(/target="_blank" rel="noopener noreferrer">bigbensoft\.com<\/a>/g) || []).length, 2);
  assert.equal(core.VERSION, '0.1.31');
});
