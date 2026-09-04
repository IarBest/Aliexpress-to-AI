'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ali-helper.user.js'), 'utf8');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function createStatus(text = '') {
  const classes = new Set();
  return {
    textContent: text,
    hidden: false,
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
  };
}

function createTimers() {
  let nextHandle = 1;
  const pending = new Map();
  const delays = [];
  return {
    pending,
    delays,
    setTimer(callback, delay) {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, callback);
      delays.push(delay);
      return handle;
    },
    clearTimer(handle) { pending.delete(handle); },
    run(handle) {
      const callback = pending.get(handle);
      pending.delete(handle);
      callback?.();
    },
  };
}

function createLanguageButton() {
  const codes = {
    en: { dataset: {} },
    ru: { dataset: {} },
  };
  const attributes = new Map();
  return {
    dataset: {},
    codes,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    querySelector(selector) {
      const match = selector.match(/data-language-code="(en|ru)"/);
      return match ? codes[match[1]] : null;
    },
  };
}

test('locale resolver accepts only exact stored values and deterministically scans preferred languages', () => {
  assert.deepEqual(core.SUPPORTED_UI_LANGUAGES, ['en', 'ru']);
  assert.equal(core.resolveUiLanguage('en', ['ru-RU']), 'en');
  assert.equal(core.resolveUiLanguage('ru', ['en-US']), 'ru');

  const malformed = [
    'EN', 'RU', 'en-US', '', 1, true, false, null, undefined, [], {}, new String('en'),
  ];
  malformed.forEach((value) => {
    assert.equal(core.isUiLanguage(value), false, `reject ${String(value)}`);
  });

  assert.equal(core.resolveUiLanguage(undefined, ['ru']), 'ru');
  assert.equal(core.resolveUiLanguage(undefined, ['ru-RU']), 'ru');
  assert.equal(core.resolveUiLanguage(undefined, ['ru-MD']), 'ru');
  assert.equal(core.resolveUiLanguage(undefined, ['en']), 'en');
  assert.equal(core.resolveUiLanguage(undefined, ['en-US']), 'en');
  assert.equal(core.resolveUiLanguage(undefined, ['en-GB']), 'en');
  assert.equal(core.resolveUiLanguage(undefined, ['fr-FR', 'de-DE', 'ru-MD']), 'ru');
  assert.equal(core.resolveUiLanguage(undefined, ['fr-FR', 'de-DE']), 'en');
  assert.equal(core.resolveUiLanguage(undefined, 'ru-RU'), 'en');
});

test('preferred-language production input uses navigator.languages with navigator.language fallback', () => {
  assert.deepEqual(core.getPreferredUiLanguages({ languages: ['fr-FR', 'ru-MD'], language: 'en-US' }), [
    'fr-FR', 'ru-MD', 'en-US',
  ]);
  assert.deepEqual(core.getPreferredUiLanguages({ languages: [], language: 'ru-RU' }), ['ru-RU']);
  assert.deepEqual(core.getPreferredUiLanguages({ language: 'en-GB' }), ['en-GB']);
  assert.deepEqual(core.getPreferredUiLanguages({}), []);
});

test('settings keep uiLanguage optional, do not repair malformed storage, and persist only explicit switches', () => {
  const stored = Object.freeze({
    autoRedirectComToRu: false,
    panelCollapsed: true,
    passiveReviewRetentionCap: 50,
    uiLanguage: 'RU',
    futureField: 'preserved',
  });
  let reads = 0;
  const loaded = core.loadSettings(() => {
    reads += 1;
    return stored;
  });
  assert.equal(reads, 1);
  assert.equal(Object.hasOwn(loaded, 'uiLanguage'), false);
  assert.deepEqual(loaded, {
    autoRedirectComToRu: false,
    panelCollapsed: true,
    passiveReviewRetentionCap: 50,
    futureField: 'preserved',
  });
  assert.equal(stored.uiLanguage, 'RU');

  const writes = [];
  const runtime = { settings: { ...loaded }, uiLanguage: 'ru' };
  assert.deepEqual(core.applyUiLanguageSelection(runtime, 'en', (settings) => writes.push({ ...settings })), {
    accepted: true,
    uiLanguage: 'en',
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    autoRedirectComToRu: false,
    panelCollapsed: true,
    passiveReviewRetentionCap: 50,
    futureField: 'preserved',
    uiLanguage: 'en',
  });
  assert.deepEqual(core.applyUiLanguageSelection(runtime, 'en-US', () => writes.push('unexpected')), {
    accepted: false,
    uiLanguage: 'en',
  });
  assert.equal(writes.length, 1);

  core.toggleMarketUrl('https://aliexpress.ru/item/1005008195850531.html');
  assert.equal(runtime.settings.uiLanguage, 'en', 'RU/COM navigation never mutates UI language');
});

test('EN and RU dictionaries have exact plain-string parity, safe interpolation, and English fallback', () => {
  const enKeys = Object.keys(core.UI_STRINGS.en).sort();
  const ruKeys = Object.keys(core.UI_STRINGS.ru).sort();
  assert.deepEqual(ruKeys, enKeys);
  assert.ok(enKeys.length > 70);
  for (const locale of core.SUPPORTED_UI_LANGUAGES) {
    Object.values(core.UI_STRINGS[locale]).forEach((value) => {
      assert.equal(typeof value, 'string');
      assert.doesNotMatch(value, /<\/?[A-Za-z][^>]*>/, `${locale} contains localized HTML`);
    });
  }

  const unsafe = '<img src=x onerror=alert(1)>';
  assert.equal(core.t('ru', 'copy.failed', { error: unsafe }), `Не удалось скопировать: ${unsafe}`);
  assert.equal(core.t('ru', 'only.en', {}, { en: { 'only.en': 'English fallback' }, ru: {} }), 'English fallback');
  assert.equal(core.t('de', 'action.productJson'), 'Copy product JSON');
});

test('accepted Product and Reviews label tables preserve exact action IDs, order, and primary geometry', () => {
  const productIds = ['review-workflow', 'chatgpt', 'product', 'variants', 'description', 'clean-url', 'market'];
  const productKeys = core.PRODUCT_PANEL_CONTRACT.actions.map(({ labelKey }) => labelKey);
  assert.deepEqual(core.PRODUCT_PANEL_CONTRACT.actions.map(({ id }) => id), productIds);
  assert.deepEqual(productKeys.map((key) => core.t('en', key)), [
    'Collect product + reviews for ChatGPT',
    'Copy product for ChatGPT',
    'Copy product JSON',
    'Copy variants',
    'Copy description',
    'Copy clean URL',
    'RU / COM',
  ]);
  assert.deepEqual(productKeys.map((key) => core.t('ru', key)), [
    'Собрать товар + отзывы для ChatGPT',
    'Скопировать товар для ChatGPT',
    'JSON товара',
    'Варианты',
    'Описание',
    'Чистый URL',
    'RU / COM',
  ]);
  assert.deepEqual(core.PRODUCT_PANEL_CONTRACT.actions.filter(({ primary }) => primary).map(({ id }) => id), ['review-workflow']);
  assert.equal(
    core.t('en', 'tooltip.reviewWorkflow'),
    'Collects the product and bounded Reviews for a combined ChatGPT export.',
  );
  assert.equal(
    core.t('ru', 'tooltip.reviewWorkflow'),
    'Собирает товар и ограниченный набор отзывов для объединённого экспорта в ChatGPT.',
  );

  const reviewKeys = core.REVIEWS_PANEL_CONTRACT.actions.map(({ labelKey }) => labelKey);
  assert.deepEqual(core.REVIEWS_PANEL_CONTRACT.actions.map(({ id }) => id), ['reviews', 'reviews-chatgpt']);
  assert.deepEqual(reviewKeys.map((key) => core.t('en', key)), ['Copy reviews JSON', 'Copy reviews for ChatGPT']);
  assert.deepEqual(reviewKeys.map((key) => core.t('ru', key)), [
    'Скопировать отзывы в JSON',
    'Скопировать отзывы для ChatGPT',
  ]);
  assert.doesNotMatch(reviewKeys.map((key) => core.t('en', key)).join(' '), /Collect|Load|Fetch/);
});

test('shared header renders EN/RU before collapse and exposes a non-color-only active locale', () => {
  const html = core.renderPanelHeader();
  assert.match(html, /<button type="button" class="language" data-action="language">/);
  assert.match(html, /<span data-language-code="en">EN<\/span><span aria-hidden="true">\/<\/span><span data-language-code="ru">RU<\/span>/);
  assert.ok(html.indexOf('data-action="language"') < html.indexOf('data-action="toggle"'));

  const button = createLanguageButton();
  core.applyLanguageControl(button, 'en');
  assert.equal(button.getAttribute('aria-label'), 'Interface language: English. Switch to Russian.');
  assert.equal(button.dataset.tooltip, 'Switch the Ali Helper interface to Russian.');
  assert.equal(button.codes.en.dataset.active, 'true');
  assert.equal(button.codes.ru.dataset.active, undefined);

  core.applyLanguageControl(button, 'ru');
  assert.equal(button.getAttribute('aria-label'), 'Язык интерфейса: русский. Переключить на английский.');
  assert.equal(button.dataset.tooltip, 'Переключить интерфейс Ali Helper на английский.');
  assert.equal(button.codes.en.dataset.active, undefined);
  assert.equal(button.codes.ru.dataset.active, 'true');
  assert.match(source, /\[data-language-code\]\[data-active="true"\] \{ font-weight:800; text-decoration:underline;/);
});

test('locale refresh preserves responsive state and does not persist or install another listener', () => {
  const listeners = new Set();
  const applied = [];
  const persisted = [];
  const mediaQuery = {
    matches: false,
    addEventListener(type, listener) { assert.equal(type, 'change'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'change'); listeners.delete(listener); },
  };
  const controller = core.createResponsivePanelController(
    mediaQuery,
    true,
    (state, view) => applied.push({ state, view }),
    (value) => persisted.push(value),
    'en',
  );
  const stateBefore = applied.at(-1).state;
  const applyCount = applied.length;
  controller.setLocale('ru');
  assert.equal(applied.length, applyCount + 1);
  assert.equal(applied.at(-1).state, stateBefore);
  assert.equal(applied.at(-1).view.ariaLabel, 'Развернуть панель Ali Helper.');
  assert.deepEqual(persisted, []);
  assert.equal(listeners.size, 1);
  controller.destroy();
});

test('Product status descriptors retranslate persistent and transient layers without restarting expiry', () => {
  const status = createStatus();
  const timers = createTimers();
  let locale = 'en';
  const controller = core.createProductStatusController(status, {
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    formatMessage: (message) => core.formatUiMessage(locale, message),
  });

  controller.showPersistent(core.createUiMessage('product.normalizationFailed', { error: 'raw detail' }), true);
  controller.showTransient(core.createUiMessage('copy.productJsonSuccess'));
  const handle = [...timers.pending.keys()][0];
  assert.equal(status.textContent, 'Product JSON copied.');
  assert.deepEqual(timers.delays, [2800]);

  locale = 'ru';
  controller.refresh();
  assert.equal(status.textContent, 'JSON товара скопирован.');
  assert.deepEqual([...timers.pending.keys()], [handle]);
  assert.deepEqual(timers.delays, [2800]);
  timers.run(handle);
  assert.equal(status.textContent, 'Данные товара получены, но их не удалось обработать: raw detail');
  assert.equal(status.classList.contains('error'), true);

  controller.showPersistent(core.createUiMessage('product.normalizationFailed', { error: 'raw detail' }), true);
  assert.equal(status.textContent, 'Данные товара получены, но их не удалось обработать: raw detail');
  assert.equal(status.classList.contains('error'), true);
  locale = 'en';
  controller.refresh();
  assert.equal(status.textContent, 'productData found but normalization failed: raw detail');
  assert.equal(status.classList.contains('error'), true);
  controller.dispose();
});

test('RU disclosure localizes display aliases while canonical section/source/diagnostic IDs remain untouched', () => {
  const product = {
    selectedSkuId: null,
    skus: [{ skuId: '1' }],
    _meta: {
      sections: {
        sizeGuide: { state: 'present', sources: ['productData'] },
        gallery: { state: 'invalid', sources: [], diagnostic: 'conflict' },
        ratingSummary: { state: 'not-observed', sources: [] },
        store: { state: 'present', sources: ['dom:store'] },
        characteristics: { state: 'missing', sources: [] },
        description: { state: 'present', sources: ['dom:description'] },
        delivery: { state: 'present', sources: ['native:shipping-calculate'] },
      },
    },
  };
  const before = JSON.stringify(product);
  const model = core.createSectionDisclosureModel(product, 'ru');
  assert.deepEqual(model.present, [
    { label: 'Таблица размеров', sources: ['API товара'] },
    { label: 'Магазин', sources: ['Раздел магазина'] },
    { label: 'Описание', sources: ['Раздел описания'] },
    { label: 'Доставка', sources: ['API доставки'] },
  ]);
  assert.deepEqual(model.confirmedMissing, ['Характеристики']);
  assert.equal(core.formatUiDiagnostic('conflict', 'ru'), 'конфликт данных');
  assert.equal(core.formatUiDiagnostic('review-conflict', 'ru'), 'конфликт данных отзывов');
  assert.equal(JSON.stringify(product), before);
  assert.deepEqual(core.PRODUCT_SECTION_ORDER, [
    'sizeGuide', 'gallery', 'ratingSummary', 'store', 'characteristics', 'description', 'delivery',
  ]);
  assert.ok(core.SECTION_SOURCE_ORDER.includes('native:shipping-calculate'));
});

test('Review statuses use passive Russian wording and the accepted additional-review context', () => {
  const ready = core.formatReviewsPageStatus({
    source: 'ssr:__AER_DATA__',
    loadedCount: 5,
    captureCap: 30,
  }, 'ru');
  assert.equal(ready, 'Отзывы готовы · На первой странице: 5 · лимит хранения: 30 · источник: данные страницы');
  assert.doesNotMatch(ready, /SSR/);

  const captured = core.formatReviewsPageStatus({
    source: 'native:product-reviews',
    loadedCount: 20,
    captureCap: 30,
    captureCapReached: true,
    diagnostic: 'review-conflict',
    pagesLoaded: [1, 2],
    context: { sort: 2, filters: [2], skuFilter: ['11'], pageSize: 10 },
  }, 'ru');
  assert.match(captured, /^Отзывы обнаружены · Количество: 20/);
  assert.match(captured, /Дополнительные отзывы/);
  assert.doesNotMatch(captured, /Дополненные|Отзывы собраны|native|SSR/);
  assert.match(captured, /конфликт данных отзывов/);
});

test('UI language changes leave every clipboard/export payload byte-identical', () => {
  const productFixture = loadFixture('product-1005008195850531.json');
  const product = core.normalizeProduct(
    productFixture.data,
    'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000056550848689',
  );
  const reviewFixture = loadFixture('reviews-ssr-1005008195850531.json');
  const firstPage = core.extractReviewsPageFromSsrData(reviewFixture, reviewFixture.itemId);
  assert.ok(firstPage);
  const reviewCache = core.seedReviewCacheFromSsr(
    core.createReviewCache(reviewFixture.itemId, 30),
    firstPage,
  );
  const reviewPage = core.getActiveReviewPage(reviewCache);
  assert.ok(reviewPage);

  const runtime = { settings: { ...core.DEFAULT_SETTINGS }, uiLanguage: 'en' };
  const snapshots = [];
  for (const locale of ['en', 'ru']) {
    core.applyUiLanguageSelection(runtime, locale, () => {});
    snapshots.push([
      core.exportProduct(product),
      core.exportVariants(product),
      core.exportDescription(product),
      core.exportForChatGPT(product),
      core.exportReviewsPage(reviewPage),
      core.formatReviewsForChatGPT(reviewPage),
    ]);
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
});

test('panel locale updates are in-place and retain the accepted shell/network boundary', () => {
  const localeFunctions = [...source.matchAll(/function applyLocale\(nextLocale\) \{([\s\S]*?)\n    \}/g)];
  assert.equal(localeFunctions.length, 2);
  localeFunctions.forEach((match) => {
    assert.match(match[1], /\.refresh\(\)/);
    assert.match(match[1], /scrollTop/);
    assert.doesNotMatch(match[1], /innerHTML|createPanelHost|appendChild|addEventListener|createTooltipController|bindResponsivePanel/);
  });
  assert.equal((source.match(/shadow\.addEventListener\('click'/g) || []).length, 2);
  assert.match(source, /\.panel \{ width:320px;/);
  assert.match(source, /header \{ display:flex; align-items:center; gap:6px;/);
  assert.match(source, /\.panel\.collapsed \{ width:\$\{PANEL_SHELL_CONTRACT\.narrowCollapsedMaxWidth\}px;/);
  assert.doesNotMatch(source, /uiLanguage[^\n]*(?:location\.hostname|aliexpress\.(?:ru|com))|BroadcastChannel/);

  const uiStart = source.indexOf('const SHARED_PANEL_STYLES');
  const uiEnd = source.indexOf('function startReviewsPage');
  const uiSource = source.slice(uiStart, uiEnd);
  assert.doesNotMatch(uiSource, /\bfetch\s*\(|\bXMLHttpRequest\b|GM_xmlhttpRequest|freight\/calculate|product-reviews/);
});

test('metadata and safe text application keep release-finalization files and version out of scope', () => {
  assert.match(source, /^\/\/ @description:ru Помощник AliExpress только для чтения:/m);
  assert.doesNotMatch(source, /^\/\/ @name:ru/m);
  assert.match(source, /^\/\/ @version\s+0\.1\.30$/m);
  assert.equal(core.VERSION, '0.1.30');
  assert.equal(core.t('en', 'footer.safety', { version: core.VERSION }), 'Read/copy/navigation/scroll · v0.1.30');
  assert.equal(core.t('ru', 'footer.safety', { version: core.VERSION }), 'Чтение/копирование/переходы/прокрутка · v0.1.30');
  const localeApplyStart = source.indexOf('function applyPanelActionLocale');
  const localeApplyEnd = source.indexOf('function bindResponsivePanel', localeApplyStart);
  const localeApplySource = source.slice(localeApplyStart, localeApplyEnd);
  assert.match(localeApplySource, /textContent = t\(/);
  assert.match(localeApplySource, /setAttribute\('aria-label'/);
  assert.doesNotMatch(localeApplySource, /innerHTML|insertAdjacentHTML/);
  assert.match(source, /renderProductActionGroups\(false\)/);
  assert.match(source, /renderPanelActionButtons\(REVIEWS_PANEL_CONTRACT\.actions, 'action', false\)/);
});
