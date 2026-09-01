// ==UserScript==
// @name         Ali Helper
// @namespace    https://github.com/local/ali-helper
// @version      0.1.26
// @description  Read-only AliExpress URL cleaner and product/variant exporter
// @match        https://aliexpress.ru/item/*
// @match        https://www.aliexpress.com/item/*
// @match        https://aliexpress.com/item/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

/* global GM_getValue, GM_setValue, GM_setClipboard, unsafeWindow */

(function factory(root) {
  'use strict';

  const VERSION = '0.1.26';
  const SETTINGS_KEY = 'ali-helper:settings:v1';
  const NATIVE_REVIEW_PATHNAME = '/aer-jsonapi/review/v5/desktop/product-reviews';
  const REVIEW_CAPTURE_CAP = 30;
  const PASSIVE_REVIEW_RETENTION_CAP_OPTIONS = Object.freeze([10, 30, 50, 100]);
  const AGGREGATE_SSR_MAX_DEPTH = 80;
  const RUNTIME_REGISTRY_KEY = '__aliHelperRuntimeV1__';
  const INITIAL_REVIEW_CONTEXT = Object.freeze({ sort: 1, filters: [], skuFilter: [], pageSize: 10 });
  const CHARACTERISTICS_BOUNDARY_SELECTOR = '[class*="HazeProductCharacteristics__groupsContainerForSku"]';
  const CHARACTERISTICS_ITEM_SELECTOR = '[class*="HazeProductCharacteristics__itemForSku"]';
  const CHARACTERISTICS_NAME_SELECTOR = '[class*="ProductCharacteristicsItem__name__"]';
  const CHARACTERISTICS_VALUE_SELECTOR = '[class*="ProductCharacteristicsItem__value__"]';
  const PRODUCT_HEADER_SELECTOR = '[class*="HazeProductDescription__root"]';
  const PRODUCT_HEADER_INFO_SELECTOR = '[class*="HazeProductDescription__extraInfo"]';
  const PRODUCT_RATING_SELECTOR = '[class*="HazeProductDescription__ratingWrap"]';
  const PRODUCT_REVIEW_COUNT_SELECTOR = 'a[href="#reviews_anchor"]';
  const PRODUCT_BOUGHT_COUNT_SELECTOR = '[class*="HazeProductDescription__buyCounter"]';
  const REVIEW_ANCHOR_SELECTOR = '#reviews_anchor';
  const REVIEW_TABS_SELECTOR = '[class*="RedReviewsTabs__desktop__"]';
  const REVIEW_RATING_ROOT_SELECTOR = '[class*="GlowReviewsProductRating_MainSection__mainSection__"]';
  const REVIEW_GRADE_GROUP_SELECTOR = '[class*="GlowReviewsProductRating_AdditionalSection__grade__"]';
  const REVIEW_COUNT_GROUP_SELECTOR = '[class*="GlowReviewsProductRating_AdditionalSection__gradeCount__"]';
  const REVIEW_GRADE_ROW_SELECTOR = '[class*="GlowReviewsProductRating_Grades__gradeWrapper__"]';
  const REVIEW_STAR_SELECTOR = '[class*="GlowReviewsProductRating_StarGroup__star__"]';
  const REVIEW_ACTIVE_STAR_SELECTOR = '[class*="GlowReviewsProductRating_StarGroup__starActive__"]';
  const REVIEW_PHOTOS_SELECTOR = '[class*="RedReviewsGallery__defaultWrapper__"]';
  const REVIEW_TOPICS_SELECTOR = '[class*="RedReviewsTags__tagsWrapper__"]';
  const REVIEW_TOPIC_SELECTOR = '[class*="RedReviewsTags_Tag__tag__"]';
  const REVIEW_TOPIC_TEXT_SELECTOR = '[class*="RedReviewsTags_Tag__tagText__"]';
  const REVIEW_TOPIC_COUNT_SELECTOR = '[class*="RedReviewsTags_Tag__counter__"]';
  const STORE_BOUNDARY_SELECTOR = '#storeInfo';
  const STORE_HEADER_SELECTOR = '[data-testid="store_header"]';
  const STORE_TITLE_SELECTOR = '[class*="RedStoreInfo_Header__title__"]';
  const STORE_HEADER_LINK_SELECTOR = 'a[class*="RedStoreInfo_Header__headerContainer__"][href]';
  const STORE_STAT_SELECTOR = '[class*="RedStoreInfo_StatItem__statItem__"]';
  const STORE_CHAT_BUTTON_SELECTOR = '[data-testid="seller_chat_btn"]';
  const DESCRIPTION_BOUNDARY_SELECTOR = '#content_anchor';
  const DESCRIPTION_IGNORED_TAGS = new Set(['script', 'style', 'noscript', 'template']);
  const DESCRIPTION_RELEVANT_MEDIA_TAGS = new Set(['img', 'video', 'source', 'iframe']);
  const DESCRIPTION_BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'dt', 'dd',
    'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hr', 'li', 'main', 'nav',
    'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
    'thead', 'tr', 'ul',
  ]);
  const DEFAULT_SETTINGS = Object.freeze({
    autoRedirectComToRu: true,
    panelCollapsed: false,
    passiveReviewRetentionCap: REVIEW_CAPTURE_CAP,
  });

  function isPassiveReviewRetentionCap(value) {
    return typeof value === 'number' && PASSIVE_REVIEW_RETENTION_CAP_OPTIONS.includes(value);
  }

  function normalizePassiveReviewRetentionCap(value) {
    return isPassiveReviewRetentionCap(value) ? value : REVIEW_CAPTURE_CAP;
  }

  function parsePassiveReviewRetentionCapSelection(value) {
    if (typeof value !== 'string' || !/^(10|30|50|100)$/.test(value)) return null;
    const cap = Number(value);
    return isPassiveReviewRetentionCap(cap) ? cap : null;
  }

  function normalizeSettings(value) {
    const stored = isPlainObject(value) ? value : {};
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      passiveReviewRetentionCap: normalizePassiveReviewRetentionCap(stored.passiveReviewRetentionCap),
    };
  }
  const PANEL_SHELL_CONTRACT = Object.freeze({
    id: 'responsive-panel-v1',
    narrowMaxWidth: 767,
    narrowLowerClearance: 120,
    narrowExpandedMaxViewportHeight: 50,
    narrowCollapsedMaxWidth: 180,
    narrowCollapsedMaxHeight: 52,
  });
  const TOOLTIP_DELAY_MS = 1300;
  const PRODUCT_PANEL_ACTIONS = Object.freeze([
    {
      id: 'chatgpt',
      label: 'Copy for ChatGPT',
      tooltip: 'Copies a concise product summary ready to paste into ChatGPT.',
      requiresProduct: true,
      desktopWide: true,
      primary: true,
    },
    {
      id: 'product',
      label: 'Copy product',
      tooltip: 'Copies the normalized product data as JSON.',
      requiresProduct: true,
      desktopWide: false,
    },
    {
      id: 'variants',
      label: 'Copy variants',
      tooltip: 'Copies every real SKU combination in a readable text export.',
      requiresProduct: true,
      desktopWide: false,
    },
    {
      id: 'description',
      label: 'Copy description',
      tooltip: 'Copies the full ordered description with text, links, and image URLs.',
      requiresProduct: true,
      desktopWide: true,
    },
    {
      id: 'clean-url',
      label: 'Copy clean URL',
      tooltip: 'Copies this item URL without known tracking parameters.',
      requiresProduct: false,
      desktopWide: false,
    },
    {
      id: 'market',
      label: 'RU / COM',
      tooltip: 'Opens this item on the other AliExpress market (RU or COM).',
      requiresProduct: false,
      desktopWide: false,
    },
  ].map(Object.freeze));
  const PRODUCT_PANEL_GROUPS = Object.freeze([
    { id: 'export', ariaLabel: 'Product export', actionIds: ['chatgpt', 'product', 'variants', 'description'] },
    { id: 'quick', ariaLabel: 'Quick actions', actionIds: ['clean-url', 'market'] },
  ].map((group) => Object.freeze({ ...group, actionIds: Object.freeze(group.actionIds) })));
  const REVIEWS_PANEL_ACTIONS = Object.freeze([
    { id: 'reviews', label: 'Copy reviews JSON', requiresReviews: true },
    { id: 'reviews-chatgpt', label: 'Copy reviews for ChatGPT', requiresReviews: true },
  ].map(Object.freeze));
  const PRODUCT_PANEL_CONTRACT = Object.freeze({
    shell: PANEL_SHELL_CONTRACT,
    actions: PRODUCT_PANEL_ACTIONS,
  });
  const REVIEWS_PANEL_CONTRACT = Object.freeze({
    shell: PANEL_SHELL_CONTRACT,
    actions: REVIEWS_PANEL_ACTIONS,
  });
  const SECTION_SOURCE_ORDER = Object.freeze([
    'productData',
    'ssr:__AER_DATA__',
    'dom:product-header',
    'dom:review-section',
    'dom:store',
    'dom:characteristics',
    'dom:description',
    'native:shipping-calculate',
  ]);
  const SECTION_SOURCE_LABELS = new Set(SECTION_SOURCE_ORDER);
  const SECTION_STATES = new Set(['present', 'missing', 'not-observed', 'invalid']);
  const SECTION_DIAGNOSTICS = new Set(['schema-mismatch', 'conflict', 'traversal-limit']);
  const SECTION_DIAGNOSTIC_PRIORITY = Object.freeze(['traversal-limit', 'conflict', 'schema-mismatch']);
  const PRODUCT_SECTION_ORDER = Object.freeze([
    'sizeGuide',
    'gallery',
    'ratingSummary',
    'store',
    'characteristics',
    'description',
    'delivery',
  ]);
  const PRODUCT_CONFIRMED_MISSING_SECTIONS = Object.freeze([
    'sizeGuide',
    'gallery',
    'ratingSummary',
    'store',
    'characteristics',
    'description',
  ]);
  const SECTION_DISCLOSURE_CONTRACT = Object.freeze({
    id: 'section-disclosure-v1',
    summary: 'Sources & missing sections',
    tooltip: 'Shows the source of each product section and any sections confirmed missing.',
    sectionLabels: Object.freeze({
      sizeGuide: 'Size Guide',
      gallery: 'Gallery',
      ratingSummary: 'Rating Summary',
      store: 'Store',
      characteristics: 'Characteristics',
      description: 'Description',
      delivery: 'Delivery',
    }),
    sourceAliases: Object.freeze({
      productData: 'Product API',
      'ssr:__AER_DATA__': 'Page data',
      'dom:product-header': 'Product header',
      'dom:review-section': 'Review summary',
      'dom:store': 'Store section',
      'dom:characteristics': 'Characteristics section',
      'dom:description': 'Description section',
      'native:shipping-calculate': 'Shipping API',
    }),
  });
  const PRODUCT_CORE_ISSUE_ORDER = Object.freeze(['selected-sku-unresolved']);

  // For present sections, sources contributed accepted values. Otherwise they
  // name the trusted sources that were checked for the current item context.

  const TRACKING_PARAM_NAMES = new Set([
    'spm', 'scm', 'pvid', 'algo_exp_id', 'pdp_npi', 'gps-id', 'ws_ab_test',
    'aff_fcid', 'aff_fsk', 'aff_platform', 'aff_trace_key', 'aff_short_key',
    'affiliate_id', 'affiliate_key', 'terminal_id', 'af', 'afsmartredirect',
    'srcsns', 'spreadtype', 'biztype', 'social_params', 'gatewayadapt',
  ]);

  function panelModeForWidth(viewportWidth) {
    const width = Number(viewportWidth);
    return Number.isFinite(width) && width >= 0 && width <= PANEL_SHELL_CONTRACT.narrowMaxWidth
      ? 'narrow'
      : 'desktop';
  }

  function createPanelLayoutStateForMode(mode, desktopCollapsed) {
    return Object.freeze({
      mode: mode === 'narrow' ? 'narrow' : 'desktop',
      desktopCollapsed: Boolean(desktopCollapsed),
      narrowCollapsed: true,
    });
  }

  function createPanelLayoutState(viewportWidth, desktopCollapsed) {
    return createPanelLayoutStateForMode(panelModeForWidth(viewportWidth), desktopCollapsed);
  }

  function setPanelLayoutMode(state, mode) {
    return Object.freeze({
      ...state,
      mode: mode === 'narrow' ? 'narrow' : 'desktop',
    });
  }

  function setPanelLayoutViewport(state, viewportWidth) {
    return setPanelLayoutMode(state, panelModeForWidth(viewportWidth));
  }

  function togglePanelLayoutState(state) {
    if (state.mode === 'narrow') {
      return Object.freeze({ ...state, narrowCollapsed: !state.narrowCollapsed });
    }
    return Object.freeze({ ...state, desktopCollapsed: !state.desktopCollapsed });
  }

  function isPanelLayoutCollapsed(state) {
    return state.mode === 'narrow' ? state.narrowCollapsed : state.desktopCollapsed;
  }

  function panelCollapsedPreferenceToPersist(state) {
    return state.mode === 'desktop' ? state.desktopCollapsed : null;
  }

  function panelToggleView(state) {
    const collapsed = isPanelLayoutCollapsed(state);
    return Object.freeze({
      symbol: collapsed ? '+' : '—',
      ariaLabel: 'Toggle Ali Helper panel',
      ariaExpanded: String(!collapsed),
      tooltip: collapsed ? 'Expand Ali Helper panel.' : 'Collapse Ali Helper panel.',
    });
  }

  function createResponsivePanelController(mediaQuery, desktopCollapsed, onApply, onPersist) {
    let layoutState = createPanelLayoutStateForMode(
      mediaQuery.matches ? 'narrow' : 'desktop',
      desktopCollapsed,
    );
    const apply = () => onApply(layoutState, panelToggleView(layoutState));
    const onMediaChange = (event) => {
      layoutState = setPanelLayoutMode(layoutState, event.matches ? 'narrow' : 'desktop');
      apply();
    };
    let removeMediaListener = () => {};
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onMediaChange);
      removeMediaListener = () => mediaQuery.removeEventListener('change', onMediaChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(onMediaChange);
      removeMediaListener = () => mediaQuery.removeListener(onMediaChange);
    }
    apply();
    return Object.freeze({
      toggle() {
        layoutState = togglePanelLayoutState(layoutState);
        const desktopPreference = panelCollapsedPreferenceToPersist(layoutState);
        if (desktopPreference !== null) onPersist(desktopPreference);
        apply();
      },
      destroy() {
        removeMediaListener();
        removeMediaListener = () => {};
      },
    });
  }

  function asString(value) {
    return value === null || value === undefined ? null : String(value);
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
  }

  function normalizeSectionSources(sources) {
    const requested = new Set((Array.isArray(sources) ? sources : [sources])
      .filter((source) => SECTION_SOURCE_LABELS.has(source)));
    return SECTION_SOURCE_ORDER.filter((source) => requested.has(source));
  }

  function createSectionDisclosureModel(product) {
    const sections = product?._meta?.sections || {};
    const present = [];
    const confirmedMissing = [];
    PRODUCT_SECTION_ORDER.forEach((sectionId) => {
      const section = sections[sectionId];
      const label = SECTION_DISCLOSURE_CONTRACT.sectionLabels[sectionId];
      if (section?.state === 'present') {
        const sources = normalizeSectionSources(section.sources)
          .map((source) => SECTION_DISCLOSURE_CONTRACT.sourceAliases[source])
          .filter(Boolean);
        if (sources.length) present.push({ label, sources });
      } else if (section?.state === 'missing' && PRODUCT_CONFIRMED_MISSING_SECTIONS.includes(sectionId)) {
        confirmedMissing.push(label);
      }
    });
    return {
      present,
      confirmedMissing,
      hidden: present.length === 0 && confirmedMissing.length === 0,
    };
  }

  function renderSectionDisclosure(disclosure, product) {
    const model = createSectionDisclosureModel(product);
    const content = disclosure?.querySelector?.('[data-section-disclosure-content]');
    if (!disclosure || !content) return model;
    disclosure.hidden = model.hidden;
    content.replaceChildren();
    if (model.hidden) {
      disclosure.open = false;
      return model;
    }
    const ownerDocument = disclosure.ownerDocument || document;
    model.present.forEach(({ label, sources }) => {
      const row = ownerDocument.createElement('div');
      row.className = 'section-source-row';
      row.textContent = `${label}: ${sources.join(', ')}`;
      content.appendChild(row);
    });
    if (model.confirmedMissing.length) {
      const row = ownerDocument.createElement('div');
      row.className = 'confirmed-missing-row';
      row.textContent = `Confirmed missing: ${model.confirmedMissing.join(', ')}`;
      content.appendChild(row);
    }
    return model;
  }

  function renderProductSectionDisclosure(disclosure, product) {
    const model = renderSectionDisclosure(disclosure, product);
    const summary = disclosure?.querySelector?.('summary');
    const badge = disclosure?.querySelector?.('[data-completeness-badge]');
    const content = disclosure?.querySelector?.('[data-section-disclosure-content]');
    const completeness = assessProductCompleteness(product);
    const exceptional = completeness.state === 'partial' || completeness.state === 'invalid';
    const stateLabel = exceptional
      ? `${completeness.state[0].toUpperCase()}${completeness.state.slice(1)}`
      : '';

    if (badge) {
      badge.hidden = !exceptional;
      badge.textContent = stateLabel;
      if (exceptional) badge.dataset.state = completeness.state;
      else delete badge.dataset.state;
    }
    if (summary) {
      if (exceptional) {
        summary.setAttribute(
          'aria-label',
          `${SECTION_DISCLOSURE_CONTRACT.summary}. Product status: ${stateLabel}.`,
        );
      } else {
        summary.removeAttribute('aria-label');
      }
    }
    if (!exceptional || !disclosure || !content) return { model, completeness };

    disclosure.hidden = false;
    const ownerDocument = disclosure.ownerDocument || document;
    const issueRows = [];
    if (completeness.invalidSections.length) {
      issueRows.push(`Invalid: ${completeness.invalidSections
        .map(({ section, diagnostic }) => `${formatProductSectionLabel(section)} (${diagnostic})`)
        .join(', ')}`);
    }
    if (completeness.notObservedSections.length) {
      issueRows.push(`Not observed: ${completeness.notObservedSections.map(formatProductSectionLabel).join(', ')}`);
    }
    if (completeness.coreIssues.length) {
      issueRows.push(`Core issues: ${completeness.coreIssues.map(formatProductCoreIssue).join(', ')}`);
    }
    issueRows.forEach((text) => {
      const row = ownerDocument.createElement('div');
      row.className = 'completeness-detail-row';
      row.textContent = text;
      content.appendChild(row);
    });
    return { model, completeness };
  }

  function createProductStatusController(status, options = {}) {
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const clearDelayMs = options.clearDelayMs ?? 2800;
    let baseMessage = status.textContent || '';
    let baseIsError = Boolean(baseMessage && status.classList.contains('error'));
    let transientMessage = '';
    let clearHandle = null;
    let revision = 0;
    let disposed = false;

    function invalidateTransient() {
      revision += 1;
      const handle = clearHandle;
      clearHandle = null;
      transientMessage = '';
      if (handle !== null) clearTimer(handle);
    }
    function render(message, isError) {
      status.textContent = message;
      status.classList.toggle('error', isError);
      status.hidden = !message;
    }
    function clear() {
      if (disposed) return;
      baseMessage = '';
      baseIsError = false;
      invalidateTransient();
      render('', false);
    }
    return {
      showPersistent(message, isError = false) {
        if (disposed) return;
        baseMessage = message;
        baseIsError = Boolean(message && isError);
        invalidateTransient();
        render(baseMessage, baseIsError);
      },
      showTransient(message) {
        if (disposed) return;
        invalidateTransient();
        transientMessage = message;
        const ownRevision = revision;
        render(transientMessage, false);
        clearHandle = setTimer(() => {
          if (disposed || ownRevision !== revision) return;
          clearHandle = null;
          transientMessage = '';
          revision += 1;
          render(baseMessage, baseIsError);
        }, clearDelayMs);
      },
      clear,
      dispose() {
        if (disposed) return;
        baseMessage = '';
        baseIsError = false;
        invalidateTransient();
        render('', false);
        disposed = true;
      },
    };
  }

  function createPanelBodyWheelHandler(body) {
    return (event) => {
      if (!body || !Number.isFinite(event?.deltaY) || event.deltaY === 0) return;
      if (Math.abs(event?.deltaX || 0) > Math.abs(event.deltaY)) return;
      const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
      if (maxScrollTop === 0) return;
      const deltaScale = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2 ? body.clientHeight : 1;
      const nextScrollTop = Math.max(0, Math.min(
        maxScrollTop,
        body.scrollTop + event.deltaY * deltaScale,
      ));
      if (nextScrollTop === body.scrollTop) return;
      body.scrollTop = nextScrollTop;
      event.preventDefault?.();
      event.stopPropagation?.();
    };
  }

  function bindPanelBodyWheelScroll(body) {
    const onWheel = createPanelBodyWheelHandler(body);
    body.addEventListener('wheel', onWheel, { passive: false });
    return () => body.removeEventListener('wheel', onWheel);
  }

  const TOOLTIP_CONTROLLERS = new WeakMap();

  function createTooltipController(root, options = {}) {
    const existing = TOOLTIP_CONTROLLERS.get(root);
    if (existing) return existing;

    const ownerDocument = root.ownerDocument || document;
    const tooltip = ownerDocument.createElement('div');
    const delay = Number.isFinite(options.delay) && options.delay >= 0
      ? options.delay
      : TOOLTIP_DELAY_MS;
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const getViewport = options.getViewport || (() => ({
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    }));
    const targets = Array.from(root.querySelectorAll('[data-tooltip]'));
    const bindings = [];
    let pendingTimer = null;
    let pendingTarget = null;
    let visibleTarget = null;
    let previousDescribedBy = null;
    let disposed = false;

    tooltip.id = 'ali-helper-tooltip';
    tooltip.className = 'tooltip';
    tooltip.hidden = true;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('data-ali-helper-tooltip', '');
    root.appendChild(tooltip);

    function clearPending(target = null) {
      if (target && pendingTarget !== target) return;
      if (pendingTimer !== null) clearTimer(pendingTimer);
      pendingTimer = null;
      pendingTarget = null;
    }

    function restoreDescription() {
      if (!visibleTarget) return;
      if (previousDescribedBy === null) {
        visibleTarget.removeAttribute('aria-describedby');
      } else {
        visibleTarget.setAttribute('aria-describedby', previousDescribedBy);
      }
      previousDescribedBy = null;
    }

    function hideVisible(target = null) {
      if (target && visibleTarget !== target) return;
      restoreDescription();
      visibleTarget = null;
      tooltip.hidden = true;
      tooltip.textContent = '';
    }

    function positionTooltip(target) {
      if (typeof target.getBoundingClientRect !== 'function'
        || typeof tooltip.getBoundingClientRect !== 'function') return;
      const targetRect = target.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const viewport = getViewport();
      const inset = 8;
      const gap = 8;
      const maxLeft = Math.max(inset, viewport.width - tooltipRect.width - inset);
      const left = Math.max(inset, Math.min(
        maxLeft,
        targetRect.left + (targetRect.width - tooltipRect.width) / 2,
      ));
      let top = targetRect.bottom + gap;
      if (top + tooltipRect.height > viewport.height - inset) {
        top = targetRect.top - tooltipRect.height - gap;
      }
      tooltip.style.left = `${Math.round(left)}px`;
      tooltip.style.top = `${Math.round(Math.max(inset, top))}px`;
    }

    function show(target) {
      if (disposed) return;
      const text = target?.dataset?.tooltip;
      if (typeof text !== 'string' || !text.trim()) return;
      hideVisible();
      visibleTarget = target;
      previousDescribedBy = target.getAttribute('aria-describedby');
      const describedBy = new Set((previousDescribedBy || '').split(/\s+/).filter(Boolean));
      describedBy.add(tooltip.id);
      target.setAttribute('aria-describedby', Array.from(describedBy).join(' '));
      tooltip.textContent = text;
      tooltip.hidden = false;
      positionTooltip(target);
    }

    function schedule(target) {
      if (disposed || visibleTarget === target
        || (pendingTarget === target && pendingTimer !== null)) return;
      clearPending();
      hideVisible();
      pendingTarget = target;
      pendingTimer = setTimer(() => {
        const scheduledTarget = pendingTarget;
        pendingTimer = null;
        pendingTarget = null;
        if (scheduledTarget === target) show(target);
      }, delay);
    }

    function cancel(target) {
      clearPending(target);
      hideVisible(target);
    }

    targets.forEach((target) => {
      const state = { hovered: false, focusEligible: false, focusFromPointer: false };
      const listeners = {
        pointerenter(event) {
          if (event.pointerType === 'touch') return;
          state.hovered = true;
          schedule(target);
        },
        pointerleave() {
          state.hovered = false;
          if (!state.focusEligible) cancel(target);
        },
        pointerdown(event) {
          state.focusFromPointer = true;
          if (event.pointerType === 'touch') {
            state.hovered = false;
            cancel(target);
          }
        },
        pointerup() {
          state.focusFromPointer = false;
        },
        pointercancel() {
          state.focusFromPointer = false;
        },
        focus() {
          state.focusEligible = !state.focusFromPointer;
          if (state.focusEligible) schedule(target);
        },
        blur() {
          state.focusEligible = false;
          state.focusFromPointer = false;
          if (!state.hovered) cancel(target);
        },
        click() {
          cancel(target);
        },
      };
      Object.entries(listeners).forEach(([type, listener]) => {
        target.addEventListener(type, listener);
        bindings.push([target, type, listener]);
      });
    });

    const controller = Object.freeze({
      dispose() {
        if (disposed) return;
        disposed = true;
        clearPending();
        hideVisible();
        bindings.forEach(([target, type, listener]) => target.removeEventListener(type, listener));
        tooltip.remove();
        TOOLTIP_CONTROLLERS.delete(root);
      },
    });
    TOOLTIP_CONTROLLERS.set(root, controller);
    return controller;
  }

  function createSectionDiagnostic(state, sources = [], diagnostic = null) {
    if (!SECTION_STATES.has(state)) throw new Error(`Unknown section state: ${state}`);
    const normalizedSources = normalizeSectionSources(sources);
    if (state === 'present' && !normalizedSources.length) {
      throw new Error('Present section diagnostics require a semantic source');
    }
    if (state === 'invalid') {
      if (!SECTION_DIAGNOSTICS.has(diagnostic)) throw new Error(`Unknown section diagnostic: ${diagnostic}`);
    } else if (diagnostic !== null) {
      throw new Error(`Section state ${state} cannot carry a diagnostic`);
    }
    return { state, sources: normalizedSources, diagnostic };
  }

  function sectionDiagnosticsEqual(left, right) {
    return Boolean(left && right
      && left.state === right.state
      && left.diagnostic === right.diagnostic
      && Array.isArray(left.sources)
      && Array.isArray(right.sources)
      && left.sources.length === right.sources.length
      && left.sources.every((source, index) => source === right.sources[index]));
  }

  function assessProductCompleteness(product) {
    const sections = product?._meta?.sections || {};
    const notObservedSections = PRODUCT_SECTION_ORDER.filter((section) => (
      sections[section]?.state === 'not-observed'
    ));
    const hasInvalidSection = PRODUCT_SECTION_ORDER.some((section) => sections[section]?.state === 'invalid');
    const invalidSections = PRODUCT_SECTION_ORDER.flatMap((section) => {
      const entry = sections[section];
      return entry?.state === 'invalid' && SECTION_DIAGNOSTICS.has(entry.diagnostic)
        ? [{ section, diagnostic: entry.diagnostic }]
        : [];
    });
    const observedCoreIssues = new Set();
    if (product?._meta?.selectedSkuResolved === false) observedCoreIssues.add('selected-sku-unresolved');
    const coreIssues = PRODUCT_CORE_ISSUE_ORDER.filter((issue) => observedCoreIssues.has(issue));
    const state = hasInvalidSection
      ? 'invalid'
      : notObservedSections.length || coreIssues.length
        ? 'partial'
        : 'complete';
    return { state, notObservedSections, invalidSections, coreIssues };
  }

  function productCompletenessEqual(left, right) {
    return Boolean(left && right
      && left.state === right.state
      && Array.isArray(left.notObservedSections)
      && Array.isArray(right.notObservedSections)
      && left.notObservedSections.length === right.notObservedSections.length
      && left.notObservedSections.every((section, index) => section === right.notObservedSections[index])
      && Array.isArray(left.invalidSections)
      && Array.isArray(right.invalidSections)
      && left.invalidSections.length === right.invalidSections.length
      && left.invalidSections.every((entry, index) => entry.section === right.invalidSections[index]?.section
        && entry.diagnostic === right.invalidSections[index]?.diagnostic)
      && Array.isArray(left.coreIssues)
      && Array.isArray(right.coreIssues)
      && left.coreIssues.length === right.coreIssues.length
      && left.coreIssues.every((issue, index) => issue === right.coreIssues[index]));
  }

  function withProductCompleteness(product) {
    if (!product) return product;
    const completeness = assessProductCompleteness(product);
    if (productCompletenessEqual(product._meta?.completeness, completeness)) return product;
    return {
      ...product,
      _meta: { ...(product._meta || {}), completeness },
    };
  }

  function withSectionDiagnostic(product, section, diagnostic) {
    if (!product) return product;
    const previous = product._meta?.sections?.[section];
    if (sectionDiagnosticsEqual(previous, diagnostic)) return withProductCompleteness(product);
    return withProductCompleteness({
      ...product,
      _meta: {
        ...(product._meta || {}),
        sections: { ...(product._meta?.sections || {}), [section]: diagnostic },
      },
    });
  }

  function withSectionValueAndDiagnostic(product, section, value, diagnostic, equal = (left, right) => left === right) {
    if (!product) return product;
    const sameValue = equal(product[section], value);
    const sameDiagnostic = sectionDiagnosticsEqual(product._meta?.sections?.[section], diagnostic);
    if (sameValue && sameDiagnostic) return withProductCompleteness(product);
    return withProductCompleteness({
      ...product,
      [section]: sameValue ? product[section] : value,
      _meta: {
        ...(product._meta || {}),
        sections: { ...(product._meta?.sections || {}), [section]: diagnostic },
      },
    });
  }

  function presentSectionDiagnostic(product, section, sources, preservePreviousSources = false) {
    const previousSources = preservePreviousSources && product?._meta?.sections?.[section]?.state === 'present'
      ? product._meta.sections[section].sources
      : [];
    return createSectionDiagnostic('present', [...previousSources, ...sources]);
  }

  function createSectionObservation(source, value, diagnostic = null, observed = true) {
    const wasObserved = Boolean(observed);
    const normalizedDiagnostic = wasObserved && SECTION_DIAGNOSTICS.has(diagnostic) ? diagnostic : null;
    return {
      source: normalizeSectionSources([source])[0] || null,
      value: wasObserved && !normalizedDiagnostic ? value : null,
      diagnostic: normalizedDiagnostic,
      observed: wasObserved,
    };
  }

  function observationFromInput(inputs, inspectionKey, valueKey, source) {
    if (Object.prototype.hasOwnProperty.call(inputs, inspectionKey)) {
      const inspection = inputs[inspectionKey] || {};
      return createSectionObservation(
        source,
        inspection.value ?? null,
        inspection.diagnostic ?? null,
        inspection.observed !== false,
      );
    }
    if (Object.prototype.hasOwnProperty.call(inputs, valueKey)) {
      return createSectionObservation(source, inputs[valueKey] ?? null);
    }
    return null;
  }

  function applyMissingSectionDiagnostic(product, section, observations) {
    const diagnostic = sectionDiagnosticFromObservations(observations, false);
    if (product?._meta?.sections?.[section]?.state === 'present' && diagnostic.state !== 'invalid') {
      return product;
    }
    const emptyValue = section === 'characteristics' ? [] : null;
    const equal = ({
      gallery: galleriesEqual,
      ratingSummary: ratingSummariesEqual,
      store: storesEqual,
      characteristics: characteristicsEqual,
      description: descriptionsEqual,
    })[section] || ((left, right) => left === right);
    return withSectionValueAndDiagnostic(product, section, emptyValue, diagnostic, equal);
  }

  function firstSectionDiagnostic(observations) {
    const diagnostics = new Set(observations
      .filter((observation) => observation?.observed !== false)
      .map((observation) => observation?.diagnostic)
      .filter((diagnostic) => SECTION_DIAGNOSTICS.has(diagnostic)));
    return SECTION_DIAGNOSTIC_PRIORITY.find((diagnostic) => diagnostics.has(diagnostic)) || null;
  }

  function sectionDiagnosticFromObservations(observations, hasValue) {
    const usable = (observations || []).filter(Boolean);
    const observed = usable.filter((observation) => observation.observed !== false);
    if (hasValue) {
      const contributingSources = observed
        .filter((observation) => observation.value !== null && observation.value !== undefined)
        .map((observation) => observation.source);
      if (contributingSources.length) return createSectionDiagnostic('present', contributingSources);
    }
    const diagnostic = firstSectionDiagnostic(observed);
    if (diagnostic) {
      return createSectionDiagnostic('invalid', observed.map((observation) => observation.source), diagnostic);
    }
    if (observed.length) return createSectionDiagnostic('missing', observed.map((observation) => observation.source));
    return createSectionDiagnostic('not-observed');
  }

  function hasUnvisitedDepthCutoff(depthCutoffs, seen) {
    for (const value of depthCutoffs) {
      if (!seen.has(value)) return true;
    }
    return false;
  }

  function boundedTraversalReachedLimit(stack, seen, visited, maxVisited, depthCutoffs) {
    if (hasUnvisitedDepthCutoff(depthCutoffs, seen)) return true;
    return visited >= maxVisited && stack.some(({ value }) => (
      value && typeof value === 'object' && !seen.has(value)
    ));
  }

  function isProductDataBoundToItem(data, currentItemId, meta = {}) {
    const payloadItemId = asString(firstDefined(data?.productId, data?.itemId, data?.id));
    const expectedItemId = asString(currentItemId);
    if (!expectedItemId) return false;
    if (payloadItemId) return payloadItemId === expectedItemId;
    if (meta.source !== 'network:productData') return false;
    const requestItemId = asString(meta.requestItemId);
    return Boolean(requestItemId && requestItemId === expectedItemId);
  }

  function productDataRequestItemId(input, baseUrl) {
    try {
      const value = typeof input === 'string' ? input : input?.url;
      const url = new URL(value, baseUrl);
      const candidates = [...url.searchParams.entries()]
        .filter(([key]) => ['item', 'itemid', 'productid', 'productidv2']
          .includes(key.toLowerCase().replace(/[_-]/g, '')))
        .map(([, candidate]) => candidate.trim());
      if (!candidates.length) return undefined;
      if (candidates.some((candidate) => !/^\d+$/.test(candidate))) return null;
      const ids = candidates;
      const unique = [...new Set(ids)];
      return unique.length === 1 ? unique[0] : null;
    } catch (_) {
      return undefined;
    }
  }

  function isItemPage(input) {
    try {
      const url = input instanceof URL ? input : new URL(input);
      return /(^|\.)aliexpress\.(ru|com)$/i.test(url.hostname)
        && /^\/item\/\d+(?:\.html)?\/?$/i.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function getItemId(input) {
    try {
      const url = input instanceof URL ? input : new URL(input);
      return url.pathname.match(/^\/item\/(\d+)(?:\.html)?\/?$/i)?.[1] || null;
    } catch (_) {
      return null;
    }
  }

  function isReviewsPage(input) {
    try {
      const url = input instanceof URL ? input : new URL(input);
      return /(^|\.)aliexpress\.(ru|com)$/i.test(url.hostname)
        && /^\/item\/\d+\/reviews\/?$/i.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function getReviewsItemId(input) {
    try {
      const url = input instanceof URL ? input : new URL(input);
      if (!/(^|\.)aliexpress\.(ru|com)$/i.test(url.hostname)) return null;
      return url.pathname.match(/^\/item\/(\d+)\/reviews\/?$/i)?.[1] || null;
    } catch (_) {
      return null;
    }
  }

  function createProductPollingLifecycle(scanFallbacks, timers = globalThis) {
    let active = true;
    let intervalHandle = null;
    const run = () => {
      if (!active) return;
      scanFallbacks();
    };
    return {
      get active() { return active; },
      get intervalHandle() { return intervalHandle; },
      start() {
        if (!active || intervalHandle !== null) return;
        intervalHandle = timers.setInterval(run, 1000);
        run();
      },
      dispose() {
        if (!active) return;
        active = false;
        if (intervalHandle !== null) {
          timers.clearInterval(intervalHandle);
          intervalHandle = null;
        }
      },
    };
  }

  function createReviewsSsrRetryLifecycle(inspect, onSeed, onExhausted, timers = globalThis) {
    let active = true;
    let seeded = false;
    let attempts = 0;
    let timeoutHandle = null;
    const readSsr = () => {
      if (!active || seeded) return;
      timeoutHandle = null;
      const inspection = inspect();
      if (inspection.reviewPage) {
        seeded = true;
        onSeed(inspection.reviewPage);
        return;
      }
      attempts += 1;
      if (attempts < 8) timeoutHandle = timers.setTimeout(readSsr, 500);
      else onExhausted(inspection.diagnostic);
    };
    return {
      get active() { return active; },
      get seeded() { return seeded; },
      get attempts() { return attempts; },
      get timeoutHandle() { return timeoutHandle; },
      start() {
        if (!active || seeded || attempts > 0 || timeoutHandle !== null) return;
        readSsr();
      },
      dispose() {
        if (!active) return;
        active = false;
        if (timeoutHandle !== null) {
          timers.clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      },
    };
  }

  function startPageRuntimeSingleton(pageWindow, mode, createController) {
    const existing = pageWindow?.[RUNTIME_REGISTRY_KEY];
    if (existing) return existing;
    const controller = createController();
    const registration = {
      mode,
      controller,
      get active() { return !registration.disposed && controller.active !== false; },
      disposed: false,
      dispose() {
        if (registration.disposed) return;
        registration.disposed = true;
        pageWindow?.removeEventListener?.('pagehide', onPageHide);
        controller.dispose();
      },
    };
    const onPageHide = () => registration.dispose();
    pageWindow[RUNTIME_REGISTRY_KEY] = registration;
    pageWindow.addEventListener?.('pagehide', onPageHide, { once: true });
    return registration;
  }

  function isTrackingParam(name) {
    const normalized = name.toLowerCase();
    return normalized.startsWith('utm_') || TRACKING_PARAM_NAMES.has(normalized);
  }

  function normalizeItemUrl(input, targetMarket) {
    const url = input instanceof URL ? new URL(input.href) : new URL(input);
    if (!isItemPage(url)) throw new Error('URL is not an AliExpress item page');
    const itemId = getItemId(url);

    const requestedMarket = targetMarket || (/\.ru$/i.test(url.hostname) ? 'ru' : 'com');
    url.protocol = 'https:';
    url.hostname = requestedMarket === 'ru' ? 'aliexpress.ru' : 'www.aliexpress.com';
    url.port = '';
    url.pathname = `/item/${itemId}.html`;
    url.hash = '';

    for (const name of Array.from(url.searchParams.keys())) {
      if (isTrackingParam(name)) url.searchParams.delete(name);
    }
    return url;
  }

  function toggleMarketUrl(input) {
    const url = input instanceof URL ? input : new URL(input);
    return normalizeItemUrl(url, /\.ru$/i.test(url.hostname) ? 'com' : 'ru');
  }

  function networkInputUrl(input) {
    if (typeof input === 'string') return input;
    if (input?.url) return String(input.url);
    return String(input);
  }

  function isAliExpressHostname(hostname) {
    return /(^|\.)aliexpress\.(?:com|ru)$/i.test(hostname);
  }

  function isShippingCalculateUrl(input, pageUrl) {
    try {
      const page = new URL(pageUrl);
      const target = new URL(networkInputUrl(input), page);
      return /^https?:$/.test(target.protocol)
        && isAliExpressHostname(page.hostname)
        && isAliExpressHostname(target.hostname)
        && target.pathname.replace(/\/+$/, '').toLowerCase() === '/aer-api/v1/pdp/web/freight/calculate';
    } catch (_) {
      return false;
    }
  }

  function sanitizeNetworkUrl(input, pageUrl) {
    try {
      const url = new URL(networkInputUrl(input), pageUrl);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function isSensitiveCaptureKey(key) {
    const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
    return /(token|cookie|authorization|password|passwd|passcode|secret|credential|session|csrf|xsrf)/.test(normalized)
      || /^(?:auth|apikey|accesskey|sign|signature|x5sec|sid|utdid|deviceid)$/.test(normalized)
      || /(phone|mobile|email|address|street|postalcode|postcode|zipcode|recipient|receiver|consignee|contact)/.test(normalized)
      || /^(?:zip|housenumber|apartment|line1|line2|district|latitude|longitude|lat|lng|firstname|lastname|fullname|username|login|userid|memberid|buyerid|customerid|taxid|passport|identity|ip|ipaddress|card|cardnumber|iban)$/.test(normalized)
      || /(account|profile)/.test(normalized);
  }

  function redactSensitiveJson(value) {
    const seen = new WeakSet();
    function visit(current) {
      if (!current || typeof current !== 'object') return current;
      if (seen.has(current)) return '[REDACTED: circular]';
      seen.add(current);
      if (Array.isArray(current)) return current.map(visit);
      return Object.fromEntries(Object.entries(current).map(([key, child]) => [
        key,
        isSensitiveCaptureKey(key) ? '[REDACTED]' : visit(child),
      ]));
    }
    return visit(value);
  }

  function createShippingDebugCapture(sourceUrl, transport, request, response, pageUrl) {
    return {
      sourceUrl: sanitizeNetworkUrl(sourceUrl, pageUrl),
      transport,
      request: redactSensitiveJson(request),
      response: redactSensitiveJson(response),
    };
  }

  function splitSkuPropIds(value) {
    if (Array.isArray(value)) return value.map(asString).filter(Boolean);
    return String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
  }

  function normalizeMoney(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' || typeof value === 'string') {
      return { value: String(value), currency: null, formatted: String(value), raw: value };
    }
    if (typeof value !== 'object') return null;
    const amount = firstDefined(value.value, value.amount, value.price, value.minAmount, value.minPrice);
    const currency = firstDefined(value.currency, value.currencyCode, value.tradeCurrency);
    const formatted = firstDefined(value.formatted, value.display, value.text, value.formattedAmount);
    return {
      value: asString(amount),
      currency: asString(currency),
      formatted: asString(formatted) || [amount, currency].filter(Boolean).join(' '),
      raw: value,
    };
  }

  function optionalBoolean(value) {
    return value === undefined || value === null ? null : Boolean(value);
  }

  function isPlainRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function isSafeTextValue(value) {
    return value === null || value === undefined || value === ''
      || typeof value === 'string'
      || (typeof value === 'number' && Number.isFinite(value));
  }

  function safeText(...values) {
    if (values.length === 1) return isSafeTextValue(values[0]) ? asString(values[0]) : null;
    const value = values.find((candidate) => candidate !== undefined && candidate !== null
      && candidate !== '' && isSafeTextValue(candidate));
    return asString(value);
  }

  const DELIVERY_MONEY_FIELDS = Object.freeze([
    'value', 'amount', 'price', 'minAmount', 'minPrice',
    'currency', 'currencyCode', 'tradeCurrency',
    'formatted', 'display', 'text', 'formattedAmount',
  ]);

  function isSafeDeliveryMoney(value) {
    if (value === null || value === undefined || value === '') return true;
    if (typeof value === 'string') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!isPlainRecord(value)) return false;
    const supplied = DELIVERY_MONEY_FIELDS.filter((field) => (
      Object.prototype.hasOwnProperty.call(value, field)
      && value[field] !== null && value[field] !== undefined && value[field] !== ''
    ));
    return supplied.length > 0 && supplied.every((field) => isSafeTextValue(value[field]));
  }

  function normalizeDeliveryMoney(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' || typeof value === 'string') return normalizeMoney(value);
    if (!isPlainRecord(value)) return null;
    const amount = safeText(value.value, value.amount, value.price, value.minAmount, value.minPrice);
    const currency = safeText(value.currency, value.currencyCode, value.tradeCurrency);
    const formatted = safeText(value.formatted, value.display, value.text, value.formattedAmount);
    const raw = Object.fromEntries(DELIVERY_MONEY_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(value, field) && isSafeTextValue(value[field]))
      .map((field) => [field, value[field]]));
    return {
      value: amount,
      currency,
      formatted: formatted || [amount, currency].filter(Boolean).join(' '),
      raw,
    };
  }

  function normalizeDelivery(request, response) {
    const shippingRequest = isPlainRecord(request) ? request : {};
    const shippingResponse = isPlainRecord(response) ? response : {};
    const destination = isPlainRecord(shippingResponse.to) ? shippingResponse.to : {};
    return {
      productId: safeText(shippingRequest.productIdV2, shippingRequest.productId),
      skuId: safeText(shippingRequest.skuId),
      destination: {
        countryCode: safeText(destination.country, destination.countryCode, shippingRequest.country),
        countryName: safeText(destination.countryName),
        regionCode: safeText(destination.region, destination.regionCode, shippingRequest.provinceCode),
        regionName: safeText(destination.regionName),
        cityCode: safeText(destination.city, destination.cityCode, shippingRequest.cityCode),
        cityName: safeText(destination.cityName),
      },
      displayMultipleMethods: optionalBoolean(shippingResponse.displayMultipleMethods),
      methods: (Array.isArray(shippingResponse.methods) ? shippingResponse.methods : []).map((method) => ({
        groupName: safeText(method?.groupName),
        serviceName: safeText(method?.serviceName),
        service: safeText(method?.service),
        cost: normalizeDeliveryMoney(method?.amount),
        etaStartDate: safeText(method?.etaStartDeliveryDate),
        etaEndDate: safeText(method?.etaEndDeliveryDate),
        dateDisplay: safeText(method?.dateDisplay),
        dateFormat: safeText(method?.dateFormat),
        tracking: optionalBoolean(method?.tracking),
        serviceGroupType: safeText(method?.serviceGroupType),
        passportRequired: optionalBoolean(method?.passportRequired),
      })),
    };
  }

  function inspectDeliveryCapture(request, response, expectedItemId, expectedSkuId) {
    const delivery = normalizeDelivery(request, response);
    const requestProductIds = isPlainRecord(request)
      ? [request.productIdV2, request.productId]
        .filter((value) => value !== null && value !== undefined && value !== '')
      : [];
    const validRequest = isPlainRecord(request)
      && requestProductIds.every(isSafeTextValue)
      && [
        'skuId', 'tradeCurrency', 'count', 'buyerPrice', 'minPrice', 'maxPrice',
        'country', 'provinceCode', 'cityCode',
      ].every((field) => !Object.prototype.hasOwnProperty.call(request, field)
        || isSafeTextValue(request[field]));
    const safeRequestProductIds = requestProductIds.filter(isSafeTextValue).map(asString);
    const requestBindingConflict = validRequest
      && new Set(safeRequestProductIds).size > 1;
    const expectedProductId = asString(expectedItemId);
    const boundProductId = expectedProductId && safeRequestProductIds.includes(expectedProductId)
      ? expectedProductId
      : delivery.productId;
    const normalizedDelivery = boundProductId === delivery.productId
      ? delivery
      : { ...delivery, productId: boundProductId };
    const hasBinding = Boolean(normalizedDelivery.productId && normalizedDelivery.skuId);
    const matchesExpected = hasBinding
      && (!expectedProductId || safeRequestProductIds.includes(expectedProductId))
      && (!expectedSkuId || normalizedDelivery.skuId === asString(expectedSkuId));
    if (!matchesExpected) {
      return { delivery: null, normalized: normalizedDelivery, matched: false, diagnostic: null };
    }
    if (!validRequest || requestBindingConflict) {
      return { delivery: null, normalized: normalizedDelivery, matched: true, diagnostic: 'schema-mismatch' };
    }
    const validResponse = isPlainRecord(response);
    const responseCode = validResponse ? response.code : null;
    const numericResponseCode = typeof responseCode === 'number'
      ? responseCode
      : (typeof responseCode === 'string' && /^\d+$/.test(responseCode.trim())
        ? Number(responseCode)
        : null);
    const explicitFailure = validResponse && (
      (Object.prototype.hasOwnProperty.call(response, 'error')
        && response.error !== null && response.error !== undefined && response.error !== '' && response.error !== false)
      || response.success === false
      || response.ok === false
      || (numericResponseCode !== null && numericResponseCode >= 400)
      || (typeof responseCode === 'string' && /^(?:error|fail(?:ed|ure)?)\b/i.test(responseCode.trim()))
    );
    const validDestination = !validResponse || response.to === null || response.to === undefined
      || (isPlainRecord(response.to) && [
        'country', 'countryCode', 'countryName', 'region', 'regionCode', 'regionName', 'city', 'cityCode', 'cityName',
      ].every((field) => !Object.prototype.hasOwnProperty.call(response.to, field)
        || isSafeTextValue(response.to[field])));
    const validDisplayMultipleMethods = !validResponse
      || response.displayMultipleMethods === null || response.displayMultipleMethods === undefined
      || typeof response.displayMultipleMethods === 'boolean';
    const methodHasRecognizedValue = (method, index) => {
      const normalized = normalizedDelivery.methods[index];
      return [
        normalized?.groupName,
        normalized?.serviceName,
        normalized?.service,
        normalized?.etaStartDate,
        normalized?.etaEndDate,
        normalized?.dateDisplay,
        normalized?.dateFormat,
        normalized?.serviceGroupType,
        normalized?.cost?.value,
        normalized?.cost?.currency,
        normalized?.cost?.formatted,
      ].some((value) => value !== null && value !== undefined && value !== '');
    };
    const validMethods = !validResponse || response.methods === null || response.methods === undefined
      || (Array.isArray(response.methods)
        && response.methods.every((method, index) => isPlainRecord(method)
          && [
            'groupName', 'serviceName', 'service', 'etaStartDeliveryDate', 'etaEndDeliveryDate',
            'dateDisplay', 'dateFormat', 'serviceGroupType',
          ].every((field) => !Object.prototype.hasOwnProperty.call(method, field)
            || isSafeTextValue(method[field]))
          && (!Object.prototype.hasOwnProperty.call(method, 'tracking')
            || method.tracking === null || method.tracking === undefined || typeof method.tracking === 'boolean')
          && (!Object.prototype.hasOwnProperty.call(method, 'passportRequired')
            || method.passportRequired === null || method.passportRequired === undefined
            || typeof method.passportRequired === 'boolean')
           && isSafeDeliveryMoney(method.amount)
           && methodHasRecognizedValue(method, index)));
    const hasResponseDestination = validResponse && isPlainRecord(response.to)
      && [
        'country', 'countryCode', 'countryName', 'region', 'regionCode', 'regionName', 'city', 'cityCode', 'cityName',
      ].some((field) => Object.prototype.hasOwnProperty.call(response.to, field)
        && safeText(response.to[field]));
    const recognizedResponse = validResponse && (
      hasResponseDestination
      || typeof response.displayMultipleMethods === 'boolean'
      || (Array.isArray(response.methods) && (response.methods.length === 0 || normalizedDelivery.methods.length > 0))
    );
    if (explicitFailure || !validResponse || !recognizedResponse || !validDestination
      || !validDisplayMultipleMethods || !validMethods) {
      return { delivery: null, normalized: normalizedDelivery, matched: true, diagnostic: 'schema-mismatch' };
    }
    return { delivery: normalizedDelivery, normalized: normalizedDelivery, matched: true, diagnostic: null };
  }

  function shippingRequestContext(request = {}) {
    return {
      productId: safeText(request.productIdV2, request.productId),
      skuId: safeText(request.skuId),
      tradeCurrency: safeText(request.tradeCurrency),
      count: safeText(request.count),
      buyerPrice: safeText(request.buyerPrice),
      minPrice: safeText(request.minPrice),
      maxPrice: safeText(request.maxPrice),
    };
  }

  function shippingDestinationContext(delivery = {}) {
    return {
      countryCode: asString(delivery.destination?.countryCode),
      regionCode: asString(delivery.destination?.regionCode),
      cityCode: asString(delivery.destination?.cityCode),
    };
  }

  function createShippingEnvironment(request, delivery) {
    const context = shippingRequestContext(request);
    return {
      destination: shippingDestinationContext(delivery),
      tradeCurrency: context.tradeCurrency,
      count: context.count,
    };
  }

  function shippingPriceContext(request = {}) {
    const context = shippingRequestContext(request);
    return {
      buyerPrice: context.buyerPrice,
      minPrice: context.minPrice,
      maxPrice: context.maxPrice,
    };
  }

  function createShippingContextKey(request, delivery) {
    const context = shippingRequestContext(request);
    return JSON.stringify({
      productId: context.productId,
      skuId: context.skuId,
      environment: createShippingEnvironment(request, delivery),
      price: shippingPriceContext(request),
    });
  }

  function createDeliveryCache() {
    return { byContext: new Map(), contextKeysBySku: new Map() };
  }

  function productSkuKey(productId, skuId) {
    return JSON.stringify([asString(productId), asString(skuId)]);
  }

  function cacheDeliveryEntry(cache, request, delivery, diagnostic = null) {
    if (!cache || !delivery?.productId || !delivery?.skuId) return null;
    const contextKey = createShippingContextKey(request, delivery);
    const skuKey = productSkuKey(delivery.productId, delivery.skuId);
    const storageKey = JSON.stringify([skuKey, contextKey]);
    const contextKeys = cache.contextKeysBySku.get(skuKey) || [];
    const previousIndex = contextKeys.indexOf(storageKey);
    if (previousIndex !== -1) contextKeys.splice(previousIndex, 1);
    contextKeys.push(storageKey);
    cache.contextKeysBySku.set(skuKey, contextKeys);
    cache.byContext.set(storageKey, {
      productId: asString(delivery.productId),
      skuId: asString(delivery.skuId),
      delivery: diagnostic ? null : delivery,
      diagnostic,
      matchAnyPrice: Boolean(diagnostic && ['buyerPrice', 'minPrice', 'maxPrice']
        .some((field) => Object.prototype.hasOwnProperty.call(request || {}, field)
          && !isSafeTextValue(request[field]))),
      environment: createShippingEnvironment(request, delivery),
      price: shippingPriceContext(request),
    });
    return storageKey;
  }

  function cacheDelivery(cache, request, delivery) {
    return cacheDeliveryEntry(cache, request, delivery);
  }

  function cacheDeliveryCapture(cache, request, response, expectedItemId, expectedSkuId) {
    const inspection = inspectDeliveryCapture(request, response, expectedItemId, expectedSkuId);
    if (inspection.matched) {
      cacheDeliveryEntry(cache, request, inspection.normalized, inspection.diagnostic);
    }
    return inspection;
  }

  function shippingCaptureMatchesProduct(capture, product) {
    if (!capture || !product?.itemId || !product?.selectedSkuId) return false;
    return inspectDeliveryCapture(
      capture.request,
      capture.response,
      product.itemId,
      product.selectedSkuId,
    ).matched;
  }

  function contextsEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function getCachedDeliveryEntry(cache, productId, skuId, environment, price) {
    if (!cache || !productId || !skuId || !environment) return null;
    const contextKeys = cache.contextKeysBySku.get(productSkuKey(productId, skuId)) || [];
    for (let index = contextKeys.length - 1; index >= 0; index -= 1) {
      const entry = cache.byContext.get(contextKeys[index]);
      if (entry
        && entry.productId === asString(productId)
        && entry.skuId === asString(skuId)
        && contextsEqual(entry.environment, environment)
        && (entry.matchAnyPrice || contextsEqual(entry.price, price))) return entry;
    }
    return null;
  }

  function getCachedDelivery(cache, productId, skuId, environment, price) {
    return getCachedDeliveryEntry(cache, productId, skuId, environment, price)?.delivery || null;
  }

  function selectedSkuShippingPriceContext(product, environment) {
    const logisticAmount = product?.selectedSku?.logisticAmount;
    const requestCurrency = asString(environment?.tradeCurrency);
    const logisticCurrency = asString(logisticAmount?.currency);
    const currentCurrency = asString(product?.selectedSku?.price?.current?.currency);
    const hasLogisticPrice = logisticAmount?.value !== null
      && logisticAmount?.value !== undefined
      && logisticAmount?.value !== '';
    // logisticAmount is not a shipping charge. AliExpress can use it as minPrice/maxPrice
    // request identity when freight currency explicitly differs from displayed SKU currency.
    const useLogisticPrice = requestCurrency
      && currentCurrency
      && logisticCurrency === requestCurrency
      && currentCurrency !== requestCurrency
      && hasLogisticPrice;
    const selectedPrice = useLogisticPrice
      ? logisticAmount.value
      : product?.selectedSku?.price?.current?.value;
    const currentPrice = asString(selectedPrice);
    return {
      buyerPrice: asString(product?.selectedSku?.buyerPriceForLogistic),
      minPrice: currentPrice,
      maxPrice: currentPrice,
    };
  }

  function applyCachedDelivery(product, cache, environment) {
    if (!product) return product;
    const entry = getCachedDeliveryEntry(
      cache,
      product.itemId,
      product.selectedSkuId,
      environment,
      selectedSkuShippingPriceContext(product, environment),
    );
    const delivery = entry?.delivery || null;
    const diagnostic = delivery
      ? createSectionDiagnostic('present', ['native:shipping-calculate'])
      : entry?.diagnostic
        ? createSectionDiagnostic('invalid', ['native:shipping-calculate'], entry.diagnostic)
        : createSectionDiagnostic('not-observed');
    const updated = product.delivery === delivery ? product : { ...product, delivery };
    return withSectionDiagnostic(updated, 'delivery', diagnostic);
  }

  function humanVariantName(value) {
    return asString(firstDefined(value?.displayName, value?.name, value?.valueName, value?.id)) || 'Unknown';
  }

  function normalizeVariantGroups(propertyList) {
    return (Array.isArray(propertyList) ? propertyList : []).map((group, groupIndex) => ({
      id: asString(firstDefined(group.id, group.propertyId, group.skuPropertyId, groupIndex)),
      name: asString(firstDefined(group.displayName, group.name, group.propertyName, `Variant ${groupIndex + 1}`)),
      rawName: asString(group.name),
      values: (Array.isArray(group.values) ? group.values : []).map((value) => ({
        id: asString(firstDefined(value.id, value.propertyValueId, value.valueId)),
        name: humanVariantName(value),
        rawName: asString(value.name),
        displayName: asString(value.displayName),
        imagePreviewUrl: asString(value.imagePreviewUrl),
        imageMainUrl: asString(value.imageMainUrl),
        colorValue: asString(value.colorValue),
        disabled: Boolean(value.disabled),
      })),
    }));
  }

  function buildVariantValueIndex(groups) {
    const index = new Map();
    for (const group of groups) {
      for (const value of group.values) index.set(value.id, { group, value });
    }
    return index;
  }

  function normalizeSkus(priceList, variantGroups) {
    const valueIndex = buildVariantValueIndex(variantGroups);
    return (Array.isArray(priceList) ? priceList : []).map((sku) => {
      const skuPropIds = splitSkuPropIds(firstDefined(sku.skuPropIds, sku.skuPropertyIds, sku.propIds));
      const selections = skuPropIds.map((valueId) => {
        const match = valueIndex.get(valueId);
        return match ? {
          groupId: match.group.id,
          groupName: match.group.name,
          valueId,
          name: match.value.name,
          rawName: match.value.rawName,
        } : { groupId: null, groupName: 'Unknown', valueId, name: valueId, rawName: null };
      });
      const currentAmount = firstDefined(sku.activityAmount, sku.saleAmount, sku.amount);
      return {
        skuId: asString(firstDefined(sku.skuId, sku.id)),
        skuPropIds,
        selections,
        price: {
          current: normalizeMoney(currentAmount),
          regular: normalizeMoney(sku.amount),
          discount: firstDefined(sku.discount, null),
        },
        buyerPriceForLogistic: asString(firstDefined(sku.buyerPriceForLogistic, sku.buyerPrice)),
        stock: firstDefined(sku.availQuantity, sku.quantity, sku.stock, null),
        available: sku.disabled === undefined ? null : !sku.disabled,
        freightExt: firstDefined(sku.freightExt, null),
        logisticAmount: firstDefined(sku.logisticAmount, null),
        rawSkuAttr: firstDefined(sku.skuAttr, null),
      };
    });
  }

  function looksLikeTable(value) {
    if (!value || typeof value !== 'object') return false;
    const columns = firstDefined(value.columns, value.headers, value.header, value.titles);
    const rows = firstDefined(value.rows, value.data, value.values, value.body);
    return Array.isArray(columns) && Array.isArray(rows);
  }

  function normalizeTable(table, fallbackUnit) {
    const rawColumns = firstDefined(table.columns, table.headers, table.header, table.titles, []);
    const rawRows = firstDefined(table.rows, table.data, table.values, table.body, []);
    return {
      unit: asString(firstDefined(table.unit, table.measurementUnit, fallbackUnit)),
      columns: rawColumns.map((column) => asString(firstDefined(column?.name, column?.title, column?.label, column)) || ''),
      rows: rawRows.map((row) => {
        const cells = Array.isArray(row) ? row : firstDefined(row?.cells, row?.values, row?.data, Object.values(row || {}));
        return (Array.isArray(cells) ? cells : [cells]).map((cell) => asString(firstDefined(cell?.value, cell?.text, cell)) || '');
      }),
      raw: table,
    };
  }

  function inspectSizeGuide(sizeData, limits = {}) {
    if (sizeData === null || sizeData === undefined) return { sizeGuide: null, diagnostic: null };
    const maxDepth = limits.maxDepth || 12;
    const tables = [];
    const seen = new WeakSet();
    const depthCutoffs = new Set();
    function walk(value, unit, depth) {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      if (depth > maxDepth) {
        depthCutoffs.add(value);
        return;
      }
      seen.add(value);
      const nextUnit = firstDefined(value.unit, value.measurementUnit, unit);
      if (looksLikeTable(value)) tables.push(normalizeTable(value, nextUnit));
      for (const [key, child] of Object.entries(value)) {
        if (key === 'byUnitTables' && child && typeof child === 'object' && !Array.isArray(child)) {
          for (const [unitKey, unitTable] of Object.entries(child)) {
            walk(unitTable, unitKey, depth + 2);
          }
        } else {
          walk(child, nextUnit, depth + 1);
        }
      }
    }
    walk(sizeData, null, 0);
    if (hasUnvisitedDepthCutoff(depthCutoffs, seen)) {
      return { sizeGuide: null, diagnostic: 'traversal-limit' };
    }
    return {
      sizeGuide: { tables, raw: sizeData },
      diagnostic: tables.length ? null : 'schema-mismatch',
    };
  }

  function normalizeSizeGuide(sizeData, limits = {}) {
    return inspectSizeGuide(sizeData, limits).sizeGuide;
  }

  function normalizeHumanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeCharacteristics(rows) {
    return (Array.isArray(rows) ? rows : []).flatMap((row) => {
      const name = normalizeHumanText(row?.name);
      const value = normalizeHumanText(row?.value);
      return name && value ? [{ name, value }] : [];
    });
  }

  function findCharacteristicsBoundary(rootNode) {
    if (!rootNode) return null;
    if (typeof rootNode.matches === 'function' && rootNode.matches(CHARACTERISTICS_BOUNDARY_SELECTOR)) return rootNode;
    return typeof rootNode.querySelector === 'function' ? rootNode.querySelector(CHARACTERISTICS_BOUNDARY_SELECTOR) : null;
  }

  function inspectCharacteristicsFromDom(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') {
      return { characteristics: [], boundary: null, diagnostic: null, observations: [] };
    }
    const boundaries = Array.from(rootNode.querySelectorAll(CHARACTERISTICS_BOUNDARY_SELECTOR));
    if (typeof rootNode.matches === 'function' && rootNode.matches(CHARACTERISTICS_BOUNDARY_SELECTOR)) boundaries.unshift(rootNode);
    const observations = boundaries.map((boundary) => {
      const items = Array.from(boundary.querySelectorAll(CHARACTERISTICS_ITEM_SELECTOR));
      const rows = items.map((item) => {
        const nameElement = item.querySelector(CHARACTERISTICS_NAME_SELECTOR);
        const valueElement = item.querySelector(CHARACTERISTICS_VALUE_SELECTOR);
        return {
          name: nameElement?.innerText ?? nameElement?.textContent,
          value: valueElement?.innerText ?? valueElement?.textContent,
        };
      });
      const characteristics = normalizeCharacteristics(rows);
      return {
        boundary,
        characteristics,
        diagnostic: !characteristics.length && items.length ? 'schema-mismatch' : null,
      };
    });
    if (observations.some((observation) => observation.diagnostic)) {
      return {
        characteristics: [],
        boundary: observations[0].boundary,
        diagnostic: 'schema-mismatch',
        observations,
      };
    }
    const contributing = observations.filter((observation) => observation.characteristics.length);
    if (contributing.length > 1) {
      const first = contributing[0].characteristics;
      if (!contributing.every((observation) => characteristicsEqual(first, observation.characteristics))) {
        return {
          characteristics: [],
          boundary: contributing[0].boundary,
          diagnostic: 'conflict',
          observations,
        };
      }
    }
    const accepted = contributing[0] || observations[0]
      || { boundary: null, characteristics: [], diagnostic: null };
    return {
      characteristics: accepted.characteristics,
      boundary: accepted.boundary,
      diagnostic: accepted.diagnostic,
      observations,
    };
  }

  function extractCharacteristicsFromDom(rootNode) {
    return inspectCharacteristicsFromDom(rootNode).characteristics;
  }

  function characteristicsEqual(left, right) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((row, index) => row.name === right[index]?.name && row.value === right[index]?.value);
  }

  function updateCharacteristics(product, rows, sources = ['dom:characteristics']) {
    if (!product) return product;
    const characteristics = normalizeCharacteristics(rows);
    if (!characteristics.length) return product;
    return withSectionValueAndDiagnostic(
      product,
      'characteristics',
      characteristics,
      presentSectionDiagnostic(product, 'characteristics', sources),
      characteristicsEqual,
    );
  }

  function validGalleryUrl(value) {
    if (typeof value !== 'string' || value !== value.trim() || !/^https?:\/\//i.test(value)) return null;
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? value : null;
    } catch (_) {
      return null;
    }
  }

  function normalizeGallery(records, source) {
    if (!Array.isArray(records) || !source) return null;
    const items = [];
    const seen = new Set();
    for (const record of records) {
      const imageUrl = validGalleryUrl(record?.imageUrl);
      const previewUrl = validGalleryUrl(record?.previewUrl);
      const videoUrl = record?.videoUrl === null || record?.videoUrl === undefined
        ? null
        : validGalleryUrl(record.videoUrl);
      if (!imageUrl || !previewUrl || (record?.videoUrl !== null && record?.videoUrl !== undefined && !videoUrl)) continue;
      const item = { type: videoUrl ? 'video' : 'image', imageUrl, previewUrl, videoUrl };
      const key = JSON.stringify([item.type, item.imageUrl, item.previewUrl, item.videoUrl]);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
    return items.length ? { source, items } : null;
  }

  function galleriesEqual(left, right) {
    if (left === right) return true;
    if (!left || !right || left.source !== right.source
      || !Array.isArray(left.items) || !Array.isArray(right.items)
      || left.items.length !== right.items.length) return false;
    return left.items.every((item, index) => {
      const other = right.items[index];
      return item.type === other?.type
        && item.imageUrl === other.imageUrl
        && item.previewUrl === other.previewUrl
        && item.videoUrl === other.videoUrl;
    });
  }

  function inspectGalleryFromSsrData(rootValue, expectedItemId, limits = {}) {
    const itemId = asString(expectedItemId);
    if (!itemId) return { gallery: null, diagnostic: null };
    const maxDepth = limits.maxDepth || AGGREGATE_SSR_MAX_DEPTH;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const depthCutoffs = new Set();
    const stack = [{ value: rootValue, depth: 0 }];
    const candidates = [];
    let sawEmptyCandidate = false;
    let sawInvalidCandidate = false;
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      if (current.depth > maxDepth) {
        depthCutoffs.add(value);
        continue;
      }
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value) && value.props && typeof value.props === 'object') {
        const props = value.props;
        if (asString(props.id) === itemId && Object.prototype.hasOwnProperty.call(props, 'gallery')) {
          if (!Array.isArray(props.gallery)) {
            sawInvalidCandidate = true;
          } else if (!props.gallery.length) {
            sawEmptyCandidate = true;
          } else {
            const gallery = normalizeGallery(props.gallery, 'ssr:__AER_DATA__');
            if (gallery) candidates.push(gallery);
            else sawInvalidCandidate = true;
          }
        }
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    if (boundedTraversalReachedLimit(stack, seen, visited, maxVisited, depthCutoffs)) {
      return { gallery: null, diagnostic: 'traversal-limit' };
    }
    if (!candidates.length) {
      return { gallery: null, diagnostic: sawInvalidCandidate ? 'schema-mismatch' : null };
    }
    const first = candidates[0];
    const conflict = sawEmptyCandidate || !candidates.every((candidate) => galleriesEqual(first, candidate));
    return {
      gallery: conflict || sawInvalidCandidate ? null : first,
      diagnostic: conflict ? 'conflict' : (sawInvalidCandidate ? 'schema-mismatch' : null),
    };
  }

  function extractGalleryFromSsrData(rootValue, expectedItemId, limits = {}) {
    return inspectGalleryFromSsrData(rootValue, expectedItemId, limits).gallery;
  }

  function updateGallery(product, gallery, sources = ['ssr:__AER_DATA__']) {
    if (!product || !gallery) return product;
    return withSectionValueAndDiagnostic(
      product,
      'gallery',
      gallery,
      presentSectionDiagnostic(product, 'gallery', sources),
      galleriesEqual,
    );
  }

  function nullableString(value) {
    return value === null || value === undefined ? null : (typeof value === 'string' ? value : undefined);
  }

  function normalizeReviewId(value) {
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    return null;
  }

  function normalizeReviewUrl(value) {
    if (value === null || value === undefined) return null;
    return validGalleryUrl(value) || undefined;
  }

  function normalizeReviewGrade(value) {
    if (value === null || value === undefined) return null;
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : undefined;
  }

  function normalizeReviewImage(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = normalizeReviewId(raw.id);
    const url = normalizeReviewUrl(raw.url);
    return id && url ? { id, url } : null;
  }

  function normalizeReviewComment(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = normalizeReviewId(raw.id);
    const authorDisplayName = nullableString(raw.commenterName);
    const authorInitials = nullableString(raw.commenterInitials);
    const authorAvatarUrl = normalizeReviewUrl(raw.commenterAvatar);
    const dateRaw = nullableString(raw.date);
    const text = nullableString(raw.text);
    const originalText = nullableString(raw.originalText);
    if (!id || [authorDisplayName, authorInitials, authorAvatarUrl, dateRaw, text, originalText].includes(undefined)) return null;
    return { id, authorDisplayName, authorInitials, authorAvatarUrl, dateRaw, text, originalText };
  }

  function normalizeReviewPart(raw, requireId = false) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || !Array.isArray(raw.images) || !Array.isArray(raw.comments)) return null;
    const id = normalizeReviewId(raw.id);
    const dateRaw = nullableString(raw.date);
    const grade = normalizeReviewGrade(raw.grade);
    const text = nullableString(raw.text);
    const originalText = nullableString(raw.originalText);
    const images = raw.images.map(normalizeReviewImage);
    const comments = raw.comments.map(normalizeReviewComment);
    if ((requireId && !id) || [dateRaw, grade, text, originalText].includes(undefined)
      || images.includes(null) || comments.includes(null)) return null;
    return { id, dateRaw, grade, text, originalText, images, comments };
  }

  function normalizeReviewRecord(raw, expectedItemId) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || !raw.product || typeof raw.product !== 'object' || Array.isArray(raw.product)
      || !raw.reviewer || typeof raw.reviewer !== 'object' || Array.isArray(raw.reviewer)
      || !raw.root || typeof raw.root !== 'object' || Array.isArray(raw.root)
      || !raw.interaction || typeof raw.interaction !== 'object' || Array.isArray(raw.interaction)
      || !Object.prototype.hasOwnProperty.call(raw, 'additional')) return null;
    const productId = normalizeReviewId(raw.product.id);
    const id = normalizeReviewId(raw.root.id);
    const skuProperties = nullableString(raw.product.skuProperties);
    const displayName = nullableString(raw.reviewer.name);
    const initials = nullableString(raw.reviewer.initials);
    const avatarUrl = normalizeReviewUrl(raw.reviewer.avatar);
    const countryFlagUrl = normalizeReviewUrl(raw.reviewer.countryFlag);
    const initialPart = normalizeReviewPart(raw.root, true);
    const additionalPart = raw.additional === null ? null : normalizeReviewPart(raw.additional, true);
    const likesAmount = raw.interaction.likesAmount;
    if (!productId || productId !== asString(expectedItemId) || !id
      || [skuProperties, displayName, initials, avatarUrl, countryFlagUrl].includes(undefined)
      || !initialPart || (raw.additional !== null && !additionalPart)
      || !Number.isSafeInteger(likesAmount) || likesAmount < 0) return null;
    const { id: initialId, ...initial } = initialPart;
    return {
      id: initialId,
      productId,
      skuProperties,
      reviewer: { displayName, initials, avatarUrl, countryFlagUrl },
      initial,
      additional: additionalPart,
      likesAmount,
    };
  }

  function normalizedReviewsEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function normalizeReviewCandidate(records, expectedItemId) {
    if (!Array.isArray(records) || !records.length) return null;
    const reviews = [];
    const byKey = new Map();
    for (const raw of records) {
      const review = normalizeReviewRecord(raw, expectedItemId);
      if (!review) return null;
      const key = `${review.productId}:${review.id}`;
      const previous = byKey.get(key);
      if (previous) {
        if (!normalizedReviewsEqual(previous, review)) return null;
        continue;
      }
      byKey.set(key, review);
      reviews.push(review);
    }
    return reviews;
  }

  function inspectReviewsPageFromSsrData(rootValue, expectedItemId, limits = {}) {
    const itemId = asString(expectedItemId);
    if (!itemId || !/^\d+$/.test(itemId)) return { reviewPage: null, diagnostic: 'invalid-item-id' };
    const maxDepth = limits.maxDepth || 45;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const stack = [{ value: rootValue, depth: 0 }];
    const candidates = [];
    let invalidCandidate = false;
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value) || current.depth > maxDepth) continue;
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value)
        && typeof value.widgetId === 'string'
        && /(?:^|\/)RedReviewsProductFeedbackList\//.test(value.widgetId)
        && value.props?.placement === 'PRP'
        && value.props?.pageArea === 'screen'
        && Array.isArray(value.props.reviews)) {
        const reviews = normalizeReviewCandidate(value.props.reviews, itemId);
        if (reviews) candidates.push(reviews);
        else invalidCandidate = true;
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    if (stack.length && visited >= maxVisited) return { reviewPage: null, diagnostic: 'traversal-limit' };
    if (invalidCandidate) return { reviewPage: null, diagnostic: 'invalid-candidate' };
    if (!candidates.length) return { reviewPage: null, diagnostic: 'no-candidate' };
    const first = candidates[0];
    if (!candidates.every((candidate) => normalizedReviewsEqual(first, candidate))) {
      return { reviewPage: null, diagnostic: 'conflicting-candidates' };
    }
    return {
      reviewPage: { itemId, source: 'ssr:__AER_DATA__', reviews: first },
      diagnostic: 'ok',
    };
  }

  function extractReviewsPageFromSsrData(rootValue, expectedItemId, limits = {}) {
    return inspectReviewsPageFromSsrData(rootValue, expectedItemId, limits).reviewPage;
  }

  function exportReviewsPage(reviewPage) {
    const exported = reviewPage.context ? {
      itemId: reviewPage.itemId,
      source: reviewPage.source,
      context: reviewPage.context,
      pagesLoaded: reviewPage.pagesLoaded,
      loadedCount: reviewPage.loadedCount,
      captureCap: reviewPage.captureCap,
      captureCapReached: reviewPage.captureCapReached,
      ...(reviewPage.diagnostic ? { diagnostic: reviewPage.diagnostic } : {}),
      reviews: reviewPage.reviews,
    } : {
      itemId: reviewPage.itemId,
      source: reviewPage.source,
      reviews: reviewPage.reviews,
    };
    return JSON.stringify(exported, null, 2);
  }

  function humanizeReviewsSource(source) {
    return ({
      'ssr:__AER_DATA__': 'SSR',
      'ssr+native': 'SSR + passive native',
      'native:product-reviews': 'passive native',
    })[source] || 'unknown';
  }

  function formatReviewsPages(pages) {
    if (!Array.isArray(pages) || !pages.length) return '—';
    const contiguous = pages[0] === 1 && pages.every((page, index) => page === index + 1);
    return contiguous && pages.length > 1 ? `1–${pages.at(-1)}` : pages.join(', ');
  }

  function indentReviewText(value) {
    return String(value).split(/\r\n|\r|\n/).map((line) => `  ${line}`).join('\n');
  }

  function formatReviewTextFields(part) {
    if (part.text === null && part.originalText === null) return ['Text: none'];
    const lines = [];
    if (part.text !== null) lines.push('Displayed text:', indentReviewText(part.text));
    if (part.originalText !== null) lines.push('Original text:', indentReviewText(part.originalText));
    return lines;
  }

  function formatReviewComments(comments) {
    const total = comments.length;
    const shown = comments.slice(0, 2);
    const lines = [`Comments: ${total}${total > shown.length ? ` (showing first ${shown.length})` : ''}`];
    shown.forEach((comment, index) => {
      lines.push(
        `Comment ${index + 1}:`,
        `Date: ${comment.dateRaw ?? '—'}`,
        ...formatReviewTextFields(comment),
      );
    });
    return lines;
  }

  function formatReviewPart(label, part) {
    if (part === null) return [`${label}: none`];
    return [
      `${label}:`,
      `Date: ${part.dateRaw ?? '—'}`,
      `Rating: ${part.grade === null ? 'null' : part.grade}`,
      ...formatReviewTextFields(part),
      `Images: ${part.images.length}`,
      ...formatReviewComments(part.comments),
    ];
  }

  function formatReviewsForChatGPT(reviewPage, options = {}) {
    const requestedSampleSize = options.sampleSize;
    const sampleSize = Number.isInteger(requestedSampleSize)
      ? Math.min(20, Math.max(1, requestedSampleSize))
      : 5;
    const context = reviewPage.context;
    const sortLabel = context.sort === 1 ? 'Top reviews'
      : (context.sort === 2 ? 'New reviews first' : `Sort ${context.sort}`);
    const filterLabels = context.filters.map((code) => ({ 1: 'With photos', 2: 'Additional' }[code] || `Filter ${code}`));
    const reviews = reviewPage.reviews.slice(0, sampleSize);
    const lines = [
      'ALIEXPRESS REVIEWS',
      '',
      `Item ID: ${reviewPage.itemId}`,
      `Source: ${humanizeReviewsSource(reviewPage.source)}`,
      '',
      'Context:',
      `Sort: ${sortLabel}`,
      `Filters: ${filterLabels.length ? filterLabels.join(' + ') : 'All'}`,
      `SKU filter: ${context.skuFilter.length ? `${context.skuFilter.length} IDs` : 'none'}`,
      `Page size: ${context.pageSize}`,
      '',
      `Pages: ${formatReviewsPages(reviewPage.pagesLoaded)}`,
      `Captured: ${reviewPage.loadedCount} reviews`,
      `Capture cap: ${reviewPage.captureCap}`,
      `Cap reached: ${reviewPage.captureCapReached ? 'yes' : 'no'}`,
      `Diagnostic: ${reviewPage.diagnostic || '—'}`,
      reviews.length ? `Sample: first ${reviews.length} of ${reviewPage.loadedCount}` : 'Sample: none',
    ];
    reviews.forEach((review, index) => {
      lines.push(
        '',
        `Review ${index + 1}`,
        `SKU: ${review.skuProperties ?? '—'}`,
        `Likes: ${review.likesAmount}`,
        '',
        ...formatReviewPart('Initial', review.initial),
        '',
        ...formatReviewPart('Follow-up', review.additional),
      );
    });
    return lines.join('\n');
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isNativeReviewEndpoint(input, baseUrl) {
    try {
      const base = new URL(baseUrl);
      const value = typeof input === 'string' || input instanceof URL ? input : input?.url;
      const url = new URL(value, base);
      return /(^|\.)aliexpress\.(ru|com)$/i.test(base.hostname)
        && url.origin === base.origin
        && url.pathname === NATIVE_REVIEW_PATHNAME;
    } catch (_) {
      return false;
    }
  }

  function normalizeNativeReviewRequest(raw, expectedItemId) {
    const itemId = asString(expectedItemId);
    if (!isPlainObject(raw) || !/^\d+$/.test(itemId || '')
      || !isPlainObject(raw.productKey) || !isPlainObject(raw.pagination)) return null;
    const requestItemId = asString(raw.productKey.id);
    const { sourceId } = raw.productKey;
    const { pageNum, pageSize } = raw.pagination;
    const { sort, filters, skuFilter } = raw;
    if (requestItemId !== itemId
      || !Number.isSafeInteger(sourceId) || sourceId < 0
      || !Number.isSafeInteger(pageNum) || pageNum < 1
      || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
      || !Number.isSafeInteger(sort) || sort < 1
      || !Array.isArray(filters) || !filters.every((code) => Number.isSafeInteger(code) && code >= 0)
      || !Array.isArray(skuFilter) || !skuFilter.every((skuId) => typeof skuId === 'string' && /^\d+$/.test(skuId))) return null;
    return {
      itemId,
      sourceId,
      pageNum,
      pageSize,
      sort,
      filters: filters.slice(),
      skuFilter: skuFilter.slice(),
    };
  }

  function canonicalizeReviewContext(value) {
    if (!isPlainObject(value)
      || !Number.isSafeInteger(value.sort) || value.sort < 1
      || !Number.isSafeInteger(value.pageSize) || value.pageSize < 1 || value.pageSize > 100
      || !Array.isArray(value.filters) || !value.filters.every((code) => Number.isSafeInteger(code) && code >= 0)
      || !Array.isArray(value.skuFilter) || !value.skuFilter.every((skuId) => typeof skuId === 'string' && /^\d+$/.test(skuId))) return null;
    return {
      sort: value.sort,
      filters: [...new Set(value.filters)].sort((left, right) => left - right),
      skuFilter: [...new Set(value.skuFilter)].sort((left, right) => left.localeCompare(right)),
      pageSize: value.pageSize,
    };
  }

  function createReviewContextKey(itemId, context) {
    const normalized = canonicalizeReviewContext(context);
    const normalizedItemId = asString(itemId);
    if (!normalized || !/^\d+$/.test(normalizedItemId || '')) return null;
    return JSON.stringify([
      normalizedItemId,
      normalized.pageSize,
      normalized.sort,
      normalized.filters,
      normalized.skuFilter,
    ]);
  }

  function normalizeNativeReviewResponse(response, expectedItemId) {
    if (!isPlainObject(response) || !isPlainObject(response.data) || !Array.isArray(response.data.reviews)) return null;
    if (!response.data.reviews.length) return [];
    return normalizeReviewCandidate(response.data.reviews, expectedItemId);
  }

  function normalizeNativeReviewBatch(rawRequest, rawResponse, expectedItemId) {
    const request = normalizeNativeReviewRequest(rawRequest, expectedItemId);
    if (!request) return null;
    const reviews = normalizeNativeReviewResponse(rawResponse, request.itemId);
    if (!reviews) return null;
    const context = canonicalizeReviewContext(request);
    return {
      itemId: request.itemId,
      source: 'native:product-reviews',
      context,
      pageNum: request.pageNum,
      reviews,
    };
  }

  function createReviewCache(itemId, cap = REVIEW_CAPTURE_CAP) {
    const normalizedItemId = asString(itemId);
    if (!/^\d+$/.test(normalizedItemId || '') || !Number.isSafeInteger(cap) || cap < 1) return null;
    return {
      itemId: normalizedItemId,
      defaultCap: cap,
      activeContextKey: null,
      activeSequence: 0,
      nextSequence: 0,
      contexts: new Map(),
    };
  }

  function setReviewCacheDefaultCap(cache, cap) {
    if (!cache || !Number.isSafeInteger(cap) || cap < 1 || cache.defaultCap === cap) return cache;
    return { ...cache, defaultCap: cap };
  }

  function applyPassiveReviewRetentionCapSelection(runtime, value, persist = saveSettings) {
    const previousCap = normalizePassiveReviewRetentionCap(runtime?.settings?.passiveReviewRetentionCap);
    const selectedCap = parsePassiveReviewRetentionCapSelection(value);
    if (!runtime || !isPlainObject(runtime.settings) || selectedCap === null) {
      return { accepted: false, preference: previousCap, activeCaptureCap: runtime?.reviewPage?.captureCap ?? null };
    }
    runtime.settings.passiveReviewRetentionCap = selectedCap;
    runtime.reviewCache = setReviewCacheDefaultCap(runtime.reviewCache, selectedCap);
    if (typeof persist === 'function') persist(runtime.settings);
    return { accepted: true, preference: selectedCap, activeCaptureCap: runtime.reviewPage?.captureCap ?? null };
  }

  function reviewEntry(context, captureCap) {
    return {
      context,
      captureCap,
      pages: new Map(),
      diagnostic: null,
      ignoredBeyondCap: false,
      hasSsr: false,
      hasNative: false,
    };
  }

  function isReviewPageWithinCaptureCap(pageNum, pageSize, cap) {
    if (!Number.isSafeInteger(pageNum) || pageNum < 1
      || !Number.isSafeInteger(pageSize) || pageSize < 1
      || !Number.isSafeInteger(cap) || cap < 1) return false;
    return pageNum === 1 || pageNum <= Math.floor(cap / pageSize);
  }

  function updateReviewCachePage(cache, itemId, context, pageNum, reviews, source, sequence) {
    if (!cache || cache.itemId !== itemId || !Number.isSafeInteger(pageNum) || pageNum < 1 || !Array.isArray(reviews)) return cache;
    const canonical = canonicalizeReviewContext(context);
    const contextKey = createReviewContextKey(itemId, canonical);
    if (!canonical || !contextKey) return cache;
    const makeActive = source === 'native';
    const hasExplicitSequence = makeActive && Number.isSafeInteger(sequence) && sequence >= 1;
    const resolvedSequence = makeActive
      ? (hasExplicitSequence ? sequence : cache.nextSequence + 1)
      : cache.activeSequence;
    const nextSequence = makeActive ? Math.max(cache.nextSequence, resolvedSequence) : cache.nextSequence;
    const shouldActivate = makeActive && resolvedSequence >= cache.activeSequence;
    const activeContextKey = shouldActivate ? contextKey : (cache.activeContextKey || contextKey);
    const activeSequence = shouldActivate ? resolvedSequence : cache.activeSequence;
    const currentEntry = cache.contexts.get(contextKey);
    const hasExisting = Boolean(currentEntry?.pages.has(pageNum));
    const existing = currentEntry?.pages.get(pageNum);
    if (hasExisting && normalizedReviewsEqual(existing, reviews)) {
      const sourceAlreadyRecorded = source === 'ssr' ? currentEntry.hasSsr : currentEntry.hasNative;
      if (!hasExplicitSequence && sourceAlreadyRecorded && cache.activeContextKey === contextKey) return cache;
      if (cache.activeContextKey === activeContextKey && cache.activeSequence === activeSequence
        && cache.nextSequence === nextSequence && sourceAlreadyRecorded) return cache;
      if (sourceAlreadyRecorded) return { ...cache, activeContextKey, activeSequence, nextSequence };
      const contexts = new Map(cache.contexts);
      contexts.set(contextKey, {
        ...currentEntry,
        hasSsr: currentEntry.hasSsr || source === 'ssr',
        hasNative: currentEntry.hasNative || source === 'native',
      });
      return { ...cache, activeContextKey, activeSequence, nextSequence, contexts };
    }
    const contexts = new Map(cache.contexts);
    const entry = currentEntry
      ? { ...currentEntry, pages: new Map(currentEntry.pages) }
      : reviewEntry(canonical, cache.defaultCap);
    if (hasExisting) {
      entry.diagnostic = 'page-conflict';
    } else if (isReviewPageWithinCaptureCap(pageNum, canonical.pageSize, entry.captureCap)) entry.pages.set(pageNum, reviews);
    else entry.ignoredBeyondCap = true;
    if (source === 'ssr') entry.hasSsr = true;
    if (source === 'native') entry.hasNative = true;
    contexts.set(contextKey, entry);
    return { ...cache, activeContextKey, activeSequence, nextSequence, contexts };
  }

  function seedReviewCacheFromSsr(cache, reviewPage) {
    if (!cache || !reviewPage || reviewPage.itemId !== cache.itemId || !Array.isArray(reviewPage.reviews)) return cache;
    return updateReviewCachePage(cache, cache.itemId, INITIAL_REVIEW_CONTEXT, 1, reviewPage.reviews, 'ssr');
  }

  function applyNativeReviewBatch(cache, batch, sequence) {
    if (!cache || !batch || batch.itemId !== cache.itemId || batch.source !== 'native:product-reviews') return cache;
    return updateReviewCachePage(cache, batch.itemId, batch.context, batch.pageNum, batch.reviews, 'native', sequence);
  }

  function mergeReviewContext(entry) {
    if (!entry) return null;
    const pagesLoaded = [...entry.pages.keys()].sort((left, right) => left - right);
    const merged = [];
    const byKey = new Map();
    let expectedPage = 1;
    let diagnostic = entry.diagnostic;
    for (const pageNum of pagesLoaded) {
      if (pageNum !== expectedPage) {
        diagnostic ||= 'page-gap';
        break;
      }
      for (const review of entry.pages.get(pageNum)) {
        const key = `${review.productId}:${review.id}`;
        const previous = byKey.get(key);
        if (previous && !normalizedReviewsEqual(previous, review)) {
          return { pagesLoaded, reviews: [], diagnostic: 'review-conflict' };
        }
        if (!previous) {
          byKey.set(key, review);
          merged.push(review);
        }
      }
      expectedPage += 1;
    }
    return { pagesLoaded, reviews: merged, diagnostic };
  }

  function getActiveReviewPage(cache) {
    if (!cache?.activeContextKey) return null;
    const entry = cache.contexts.get(cache.activeContextKey);
    const merged = mergeReviewContext(entry);
    if (!entry || !merged) return null;
    const loadedCount = merged.reviews.length;
    const retainedCount = [...entry.pages.values()].reduce((total, page) => total + page.length, 0);
    return {
      itemId: cache.itemId,
      source: entry.hasSsr && entry.hasNative ? 'ssr+native' : (entry.hasNative ? 'native:product-reviews' : 'ssr:__AER_DATA__'),
      context: entry.context,
      pagesLoaded: merged.pagesLoaded,
      loadedCount,
      captureCap: entry.captureCap,
      captureCapReached: entry.ignoredBeyondCap || retainedCount >= entry.captureCap,
      ...(merged.diagnostic ? { diagnostic: merged.diagnostic } : {}),
      reviews: merged.reviews,
    };
  }

  function formatReviewContext(context) {
    const labels = [];
    if (context.sort !== 1) labels.push(context.sort === 2 ? 'New reviews first' : `Sort ${context.sort}`);
    labels.push(...context.filters.map((code) => ({ 1: 'With photos', 2: 'Additional' }[code] || `Filter ${code}`)));
    if (context.skuFilter.length) labels.push(`SKU filter · ${context.skuFilter.length} IDs`);
    return labels;
  }

  function formatReviewsPageStatus(reviewPage) {
    if (reviewPage.source === 'ssr:__AER_DATA__') {
      return `Reviews ready · ${reviewPage.loadedCount} first-page reviews · retention cap: ${reviewPage.captureCap} · source: SSR`;
    }
    const labels = formatReviewContext(reviewPage.context);
    const pages = reviewPage.pagesLoaded;
    const contiguous = pages.length > 1 && pages.every((page, index) => page === index + 1);
    if (contiguous) labels.unshift(`pages 1–${pages.at(-1)}`);
    else if (pages.length) labels.unshift(`pages ${pages.join(', ')}`);
    labels.push(`retention cap: ${reviewPage.captureCap}`);
    if (reviewPage.captureCapReached) labels.push('capture cap reached');
    if (reviewPage.diagnostic) labels.push(reviewPage.diagnostic);
    return `Reviews captured · ${reviewPage.loadedCount} reviews${labels.length ? ` · ${labels.join(' · ')}` : ''} · passive native`;
  }

  function parseLocalizedRating(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 5 ? value : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!/^\d+(?:[.,]\d+)?$/.test(text)) return null;
    const rating = Number(text.replace(',', '.'));
    return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null;
  }

  function parseLocalizedCount(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const suffix = '(?:\\s+[A-Za-z]+)?';
    const thousandsMatch = text.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*[Kk]\\+?${suffix}$`));
    if (thousandsMatch) {
      const count = Number(thousandsMatch[1].replace(',', '.')) * 1000;
      return Number.isSafeInteger(count) && count >= 0 ? count : null;
    }
    const plainMatch = text.match(new RegExp(`^(\\d{1,3}(?:[ ,\\u00a0\\u202f]\\d{3})+|\\d+)${suffix}$`));
    if (!plainMatch) return null;
    const count = Number(plainMatch[1].replace(/[ ,\u00a0\u202f]/g, ''));
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  }

  function parseLocalizedPercentage(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*%?$/);
    if (!match) return null;
    const percentage = Number(match[1].replace(',', '.'));
    return Number.isFinite(percentage) && percentage >= 0 && percentage <= 100 ? percentage : null;
  }

  function safeHttpUrl(value, baseUrl) {
    if (typeof value !== 'string' || value !== value.trim() || !value) return null;
    try {
      const url = new URL(value, baseUrl);
      return /^https?:$/.test(url.protocol) ? value : null;
    } catch (_) {
      return null;
    }
  }

  function storeIdFromUrl(value) {
    const input = safeHttpUrl(value);
    if (!input) return null;
    try {
      const url = new URL(input);
      return url.hostname.toLowerCase() === 'aliexpress.ru'
        ? url.pathname.match(/^\/store\/(\d+)\/?$/)?.[1] || null
        : null;
    } catch (_) {
      return null;
    }
  }

  function decimalId(value) {
    const text = asString(value)?.trim();
    return text && /^\d+$/.test(text) ? text : null;
  }

  function emptyStore() {
    return {
      name: null,
      url: null,
      storeId: null,
      sellerId: null,
      sellerRating: { kind: 'positiveFeedbackPercentage', value: null, display: null },
      subscribers: { value: null, display: null },
    };
  }

  function normalizeStore(input) {
    if (!input || typeof input !== 'object') return null;
    const store = emptyStore();
    store.name = normalizeHumanText(input.name) || null;
    store.url = safeHttpUrl(input.url);
    store.storeId = storeIdFromUrl(store.url);
    store.sellerId = decimalId(input.sellerId);
    store.sellerRating.value = parseLocalizedPercentage(input.sellerRating?.value);
    store.sellerRating.display = normalizeHumanText(input.sellerRating?.display) || null;
    store.subscribers.value = parseLocalizedCount(input.subscribers?.value);
    store.subscribers.display = normalizeHumanText(input.subscribers?.display) || null;
    const hasValue = store.name || store.url || store.sellerId
      || store.sellerRating.value !== null || store.sellerRating.display
      || store.subscribers.value !== null || store.subscribers.display;
    return hasValue ? store : null;
  }

  function parseStoreChatLink(value, expectedItemId, pageUrl) {
    if (value && typeof value === 'object') {
      const itemId = asString(firstDefined(value.item_id, value.itemId));
      return itemId === asString(expectedItemId)
        ? { itemId, sellerId: decimalId(firstDefined(value.seller_id, value.sellerId)) }
        : null;
    }
    const input = safeHttpUrl(value, pageUrl || 'https://aliexpress.ru/');
    if (!input) return null;
    try {
      const url = new URL(input, pageUrl || 'https://aliexpress.ru/');
      if (!isAliExpressHostname(url.hostname)) return null;
      const itemId = url.searchParams.get('item_id');
      return itemId === asString(expectedItemId)
        ? { itemId, sellerId: decimalId(url.searchParams.get('seller_id')) }
        : null;
    } catch (_) {
      return null;
    }
  }

  function hasMismatchedStoreChatItem(value, expectedItemId, pageUrl) {
    if (!value) return false;
    if (typeof value === 'object') {
      const itemId = asString(firstDefined(value.item_id, value.itemId));
      return Boolean(itemId && itemId !== asString(expectedItemId));
    }
    try {
      const url = new URL(value, pageUrl || 'https://aliexpress.ru/');
      const itemId = url.searchParams.get('item_id');
      return Boolean(itemId && itemId !== asString(expectedItemId));
    } catch (_) {
      return false;
    }
  }

  function inspectExpectedStoreItem(rootValue, expectedItemId, limits = {}) {
    const itemId = asString(expectedItemId);
    if (!rootValue || !itemId) return { matched: false, diagnostic: null };
    const maxDepth = limits.maxDepth || 12;
    const maxVisited = limits.maxVisited || 3000;
    const seen = new WeakSet();
    const depthCutoffs = new Set();
    const stack = [{ value: rootValue, depth: 0 }];
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      if (current.depth > maxDepth) {
        depthCutoffs.add(value);
        continue;
      }
      seen.add(value);
      visited += 1;
      for (const [key, child] of Object.entries(value)) {
        if (/^item_?id$/i.test(key) && asString(child) === itemId) {
          return { matched: true, diagnostic: null };
        }
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    return boundedTraversalReachedLimit(stack, seen, visited, maxVisited, depthCutoffs)
      ? { matched: false, diagnostic: 'traversal-limit' }
      : { matched: false, diagnostic: null };
  }

  function containsExpectedStoreItem(rootValue, expectedItemId, limits = {}) {
    return inspectExpectedStoreItem(rootValue, expectedItemId, limits).matched;
  }

  function subtitleValue(props, type) {
    const matches = (Array.isArray(props?.subtitles) ? props.subtitles : [])
      .filter((subtitle) => subtitle?.type === type)
      .map((subtitle) => normalizeHumanText(subtitle.value))
      .filter(Boolean);
    return matches.length === 1 ? matches[0] : null;
  }

  function inspectStoreFromSsrProps(props, expectedItemId, limits = {}) {
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
      return { store: null, diagnostic: null };
    }
    if (hasMismatchedStoreChatItem(props.chatLink, expectedItemId)) {
      return { store: null, diagnostic: null };
    }
    const chat = parseStoreChatLink(props.chatLink, expectedItemId);
    const subtitles = Array.isArray(props.subtitles) ? props.subtitles : [];
    const hasStoreEvidence = Boolean(chat)
      || Boolean(storeIdFromUrl(props.url))
      || Object.prototype.hasOwnProperty.call(props, 'positiveReviews')
      || Object.prototype.hasOwnProperty.call(props, 'subscribersCount')
      || subtitles.some((subtitle) => subtitle?.type === 0 || subtitle?.type === 1);
    if (!hasStoreEvidence) return { store: null, diagnostic: null };
    const propsSellerId = decimalId(props.id);
    const sellerId = propsSellerId && chat?.sellerId && propsSellerId !== chat.sellerId
      ? null
      : propsSellerId || chat?.sellerId || null;
    const sellerDisplay = subtitleValue(props, 0);
    const subscriberDisplay = subtitleValue(props, 1);
    const store = normalizeStore({
      name: props.name,
      url: props.url,
      sellerId,
      sellerRating: {
        value: parseLocalizedPercentage(props.positiveReviews?.percentages),
        display: /seller's rating/i.test(sellerDisplay || '') ? sellerDisplay : null,
      },
      subscribers: {
        value: parseLocalizedCount(props.subscribersCount),
        display: /subscribers/i.test(subscriberDisplay || '') ? subscriberDisplay : null,
      },
    });
    if (!store) {
      if (chat) return { store: null, diagnostic: 'schema-mismatch' };
      const bindingInspection = inspectExpectedStoreItem(props.analytics, expectedItemId, limits);
      return {
        store: null,
        diagnostic: bindingInspection.matched ? 'schema-mismatch' : null,
      };
    }
    if (!chat) {
      const analyticsInspection = inspectExpectedStoreItem(props.analytics, expectedItemId, limits);
      if (analyticsInspection.diagnostic) return { store: null, diagnostic: analyticsInspection.diagnostic };
      if (!analyticsInspection.matched) return { store: null, diagnostic: null };
    }
    return { store, diagnostic: null };
  }

  function storeFromSsrProps(props, expectedItemId, limits = {}) {
    return inspectStoreFromSsrProps(props, expectedItemId, limits).store;
  }

  function storesEqual(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    return left.name === right.name && left.url === right.url && left.storeId === right.storeId
      && left.sellerId === right.sellerId
      && left.sellerRating?.kind === right.sellerRating?.kind
      && left.sellerRating?.value === right.sellerRating?.value
      && left.sellerRating?.display === right.sellerRating?.display
      && left.subscribers?.value === right.subscribers?.value
      && left.subscribers?.display === right.subscribers?.display;
  }

  function inspectStoreFromSsrData(rootValue, expectedItemId, limits = {}) {
    const itemId = asString(expectedItemId);
    if (!itemId) return { store: null, diagnostic: null };
    const maxDepth = limits.maxDepth || AGGREGATE_SSR_MAX_DEPTH;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const depthCutoffs = new Set();
    const stack = [{ value: rootValue, depth: 0 }];
    const candidates = [];
    let candidateTraversalLimited = false;
    let candidateSchemaMismatch = false;
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      if (current.depth > maxDepth) {
        depthCutoffs.add(value);
        continue;
      }
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value) && value.props && typeof value.props === 'object') {
        const inspection = inspectStoreFromSsrProps(value.props, itemId, limits.analytics || {});
        if (inspection.diagnostic === 'traversal-limit') candidateTraversalLimited = true;
        else if (inspection.diagnostic === 'schema-mismatch') candidateSchemaMismatch = true;
        else if (inspection.store) candidates.push(inspection.store);
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    if (candidateTraversalLimited
      || boundedTraversalReachedLimit(stack, seen, visited, maxVisited, depthCutoffs)) {
      return { store: null, diagnostic: 'traversal-limit' };
    }
    const first = candidates[0] || null;
    const conflict = first && !candidates.every((candidate) => storesEqual(first, candidate));
    return {
      store: conflict || candidateSchemaMismatch ? null : first,
      diagnostic: conflict ? 'conflict' : (candidateSchemaMismatch ? 'schema-mismatch' : null),
    };
  }

  function extractStoreFromSsrData(rootValue, expectedItemId, limits = {}) {
    return inspectStoreFromSsrData(rootValue, expectedItemId, limits).store;
  }

  function findStoreBoundary(rootNode) {
    if (!rootNode) return null;
    if (typeof rootNode.matches === 'function' && rootNode.matches(STORE_BOUNDARY_SELECTOR)) return rootNode;
    return typeof rootNode.querySelector === 'function' ? rootNode.querySelector(STORE_BOUNDARY_SELECTOR) : null;
  }

  function inspectStoreFromDom(rootNode, expectedItemId, pageUrl) {
    const boundary = findStoreBoundary(rootNode);
    if (!boundary) return { store: null, boundary: null, diagnostic: null, itemMismatch: false };
    const header = boundary.querySelector?.(STORE_HEADER_SELECTOR);
    const chatButton = boundary.querySelector?.(STORE_CHAT_BUTTON_SELECTOR);
    const chatAnchor = chatButton?.closest?.('a[href]');
    const chatHref = chatAnchor?.getAttribute?.('href') || chatAnchor?.href || null;
    if (chatHref && hasMismatchedStoreChatItem(chatHref, expectedItemId, pageUrl)) {
      return { store: null, boundary, diagnostic: null, itemMismatch: true };
    }
    const chat = parseStoreChatLink(chatHref, expectedItemId, pageUrl);
    if (chatHref && !chat) {
      return { store: null, boundary, diagnostic: 'schema-mismatch', itemMismatch: false };
    }
    const title = header?.querySelector?.(STORE_TITLE_SELECTOR);
    const storeAnchor = title?.closest?.('a[href]') || header?.querySelector?.(STORE_HEADER_LINK_SELECTOR);
    const statTexts = Array.from(header?.querySelectorAll?.(STORE_STAT_SELECTOR) || [])
      .map((element) => normalizeHumanText(element?.innerText ?? element?.textContent))
      .filter(Boolean);
    const sellerRatingDisplay = statTexts.find((text) => /^\d+(?:[.,]\d+)?\s*%\s*seller's rating$/i.test(text)) || null;
    const subscribersDisplay = statTexts.find((text) => /^\d+(?:[.,]\d+)?\s*[Kk]?\+?\s+subscribers$/i.test(text)) || null;
    const store = normalizeStore({
      name: title?.innerText ?? title?.textContent,
      url: storeAnchor?.getAttribute?.('href') || storeAnchor?.href || null,
      sellerId: chat?.sellerId,
      sellerRating: {
        value: sellerRatingDisplay ? parseLocalizedPercentage(sellerRatingDisplay.match(/^\d+(?:[.,]\d+)?\s*%/)?.[0]) : null,
        display: sellerRatingDisplay,
      },
      subscribers: {
        value: parseLocalizedCount(subscribersDisplay),
        display: subscribersDisplay,
      },
    });
    return {
      store,
      boundary,
      diagnostic: !store && (header || chatButton) ? 'schema-mismatch' : null,
      itemMismatch: false,
    };
  }

  function extractStoreFromDom(rootNode, expectedItemId, pageUrl) {
    return inspectStoreFromDom(rootNode, expectedItemId, pageUrl).store;
  }

  function mergeStore(structured, dom) {
    if (!structured && !dom) return null;
    const structuredRating = structured?.sellerRating;
    const domRating = dom?.sellerRating;
    const ratingValue = structuredRating?.value ?? domRating?.value ?? null;
    const ratingConflict = structuredRating?.value !== null && structuredRating?.value !== undefined
      && domRating?.value !== null && domRating?.value !== undefined
      && structuredRating.value !== domRating.value;
    const sellerRating = {
      value: ratingValue,
      display: structuredRating?.display ?? (ratingConflict ? null : domRating?.display) ?? null,
    };
    const subscribers = {
      value: structured?.subscribers?.value ?? dom?.subscribers?.value ?? null,
      display: structured?.subscribers?.display ?? dom?.subscribers?.display ?? null,
    };
    return normalizeStore({
      name: structured?.name ?? dom?.name,
      url: structured?.url ?? dom?.url,
      sellerId: structured?.sellerId ?? dom?.sellerId,
      sellerRating,
      subscribers,
    });
  }

  function storeContributionSources(structured, dom) {
    const sources = [];
    const missing = (value) => value === null || value === undefined;
    const supports = (primary, secondary) => !missing(secondary)
      && (missing(primary) || primary === secondary);
    if (structured) sources.push('ssr:__AER_DATA__');
    if (dom && (!structured
      || supports(structured.name, dom.name)
      || supports(structured.url, dom.url)
      || supports(structured.sellerId, dom.sellerId)
      || supports(structured.sellerRating?.value, dom.sellerRating?.value)
      || (supports(structured.sellerRating?.display, dom.sellerRating?.display)
        && !(!missing(structured.sellerRating?.value) && !missing(dom.sellerRating?.value)
          && structured.sellerRating.value !== dom.sellerRating.value))
      || supports(structured.subscribers?.value, dom.subscribers?.value)
      || supports(structured.subscribers?.display, dom.subscribers?.display))) {
      sources.push('dom:store');
    }
    return sources;
  }

  function updateStore(product, patch, sources = [], replace = false) {
    if (!product || !patch) return product;
    const next = replace ? patch : mergeStore(patch, product.store);
    return withSectionValueAndDiagnostic(
      product,
      'store',
      next,
      presentSectionDiagnostic(product, 'store', sources, !replace),
      storesEqual,
    );
  }

  function isStaleStore(boundary, store, staleBoundary, staleStore, diagnostic = null, staleDiagnostic = null) {
    return Boolean(boundary && boundary === staleBoundary && storesEqual(store, staleStore)
      && diagnostic === staleDiagnostic);
  }

  function emptyRatingSummary() {
    return {
      rating: null,
      reviewCount: null,
      contentFeedbackCount: null,
      boughtCount: null,
      starDistribution: null,
      buyerPhotosCount: null,
      reviewTopics: null,
      diagnostics: {
        starDistributionTotal: null,
        starDistributionMatchesReviewCount: null,
      },
      display: { rating: null, reviewCount: null, boughtCount: null, buyerPhotosCount: null },
    };
  }

  function widgetFamily(value, prefix) {
    return typeof value?.widgetId === 'string' && value.widgetId.startsWith(prefix);
  }

  function collectObjectDescendants(rootValue, predicate, limits = {}) {
    const maxDepth = limits.maxDepth || AGGREGATE_SSR_MAX_DEPTH;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const depthCutoffs = new Set();
    const stack = [{ value: rootValue, depth: 0 }];
    const results = [];
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      if (current.depth > maxDepth) {
        depthCutoffs.add(value);
        continue;
      }
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value) && predicate(value)) results.push(value);
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    return boundedTraversalReachedLimit(stack, seen, visited, maxVisited, depthCutoffs)
      ? { values: null, diagnostic: 'traversal-limit' }
      : { values: results, diagnostic: null };
  }

  function inspectObjectDescendants(rootValue, predicate, limits = {}) {
    return collectObjectDescendants(rootValue, predicate, limits);
  }

  function inspectBoundReviewTabsCandidate(widget, expectedItemId) {
    if (!widgetFamily(widget, 'bx/RedReviewsTabs/')) return { binding: null, diagnostic: null };
    const expected = asString(expectedItemId);
    if (!expected) return { binding: null, diagnostic: null };
    const events = widget.props?.analyticEvents;
    const trackingSignals = [
      events?.clickAllReviews?.trackingInfo,
      events?.viewWidgetReview?.trackingInfo,
    ].filter((signal) => signal && typeof signal === 'object');
    const itemIds = trackingSignals.map((signal) => asString(signal.itemId)).filter(Boolean);
    if (!itemIds.length || !itemIds.includes(expected)) return { binding: null, diagnostic: null };
    if (itemIds.some((itemId) => itemId !== expected)) return { binding: null, diagnostic: 'conflict' };

    const ratingInputs = trackingSignals
      .map((signal) => signal.overallRating)
      .filter((value) => value !== null && value !== undefined && value !== '');
    const ratings = ratingInputs.map(parseLocalizedRating);
    const uniqueRatings = [...new Set(ratings.filter((value) => value !== null))];
    if (ratings.some((value) => value === null)) return { binding: null, diagnostic: 'schema-mismatch' };
    if (uniqueRatings.length > 1) return { binding: null, diagnostic: 'conflict' };
    return { binding: { rating: uniqueRatings[0] ?? null }, diagnostic: null };
  }

  function resolveConsistentField(candidates, field) {
    const values = [...new Set(candidates.map((candidate) => candidate[field]).filter((value) => value !== null))];
    return values.length === 1 ? values[0] : null;
  }

  function fieldHasConflict(candidates, field) {
    return new Set(candidates.map((candidate) => candidate[field]).filter((value) => value !== null)).size > 1;
  }

  function inspectReviewSummaryFromSsrData(rootValue, expectedItemId, limits = {}) {
    const itemId = asString(expectedItemId);
    if (!itemId) return { summary: null, diagnostic: null };
    const contextInspection = inspectObjectDescendants(
      rootValue,
      (value) => widgetFamily(value, 'bx/RedReviewsContextWidget/'),
      limits.contexts || limits,
    );
    if (contextInspection.diagnostic) return { summary: null, diagnostic: 'traversal-limit' };
    const candidates = [];
    const candidateDiagnostics = [];
    let sawBoundCandidate = false;
    let sawInvalidValue = false;
    let sawFieldConflict = false;
    for (const context of contextInspection.values) {
      const tabsInspection = inspectObjectDescendants(
        context,
        (value) => widgetFamily(value, 'bx/RedReviewsTabs/'),
        limits.tabs || limits,
      );
      if (tabsInspection.diagnostic) return { summary: null, diagnostic: 'traversal-limit' };
      for (const tabs of tabsInspection.values) {
        const bindingInspection = inspectBoundReviewTabsCandidate(tabs, itemId);
        if (bindingInspection.diagnostic) candidateDiagnostics.push(bindingInspection.diagnostic);
        const binding = bindingInspection.binding;
        if (!binding) continue;
        sawBoundCandidate = true;
        const feedbackInspection = inspectObjectDescendants(
          tabs,
          (value) => widgetFamily(value, 'bx/RedReviewsProductFeedbackList/')
            && value.props?.placement === 'PDP',
          limits.feedback || limits,
        );
        if (feedbackInspection.diagnostic) return { summary: null, diagnostic: 'traversal-limit' };
        const totals = feedbackInspection.values.map((widget) => {
          const params = widget.props?.resolveParams;
          const hasReviews = params && Object.prototype.hasOwnProperty.call(params, 'review.productReviewsCount');
          const hasFeedbacks = params && Object.prototype.hasOwnProperty.call(params, 'review.productFeedbacksCount');
          const reviewCount = hasReviews ? parseLocalizedCount(params['review.productReviewsCount']) : null;
          const contentFeedbackCount = hasFeedbacks ? parseLocalizedCount(params['review.productFeedbacksCount']) : null;
          if ((hasReviews && reviewCount === null) || (hasFeedbacks && contentFeedbackCount === null)) {
            sawInvalidValue = true;
          }
          return {
            reviewCount,
            contentFeedbackCount,
          };
        });
        if (['reviewCount', 'contentFeedbackCount'].some((field) => fieldHasConflict(totals, field))) {
          sawFieldConflict = true;
        }
        candidates.push({
          rating: binding.rating,
          reviewCount: resolveConsistentField(totals, 'reviewCount'),
          contentFeedbackCount: resolveConsistentField(totals, 'contentFeedbackCount'),
        });
      }
    }
    const candidateDiagnostic = firstSectionDiagnostic(candidateDiagnostics
      .map((diagnostic) => ({ diagnostic })));
    if (candidateDiagnostic) return { summary: null, diagnostic: candidateDiagnostic };
    if (!candidates.length) return { summary: null, diagnostic: null };
    const result = emptyRatingSummary();
    result.rating = resolveConsistentField(candidates, 'rating');
    result.reviewCount = resolveConsistentField(candidates, 'reviewCount');
    result.contentFeedbackCount = resolveConsistentField(candidates, 'contentFeedbackCount');
    const summary = result.rating === null && result.reviewCount === null && result.contentFeedbackCount === null
      ? null
      : withRatingDiagnostics(result);
    const conflict = ['rating', 'reviewCount', 'contentFeedbackCount']
      .some((field) => fieldHasConflict(candidates, field));
    return {
      summary,
      diagnostic: summary
        ? null
        : (conflict || sawFieldConflict ? 'conflict' : (sawInvalidValue || sawBoundCandidate ? 'schema-mismatch' : null)),
    };
  }

  function extractReviewSummaryFromSsrData(rootValue, expectedItemId, limits = {}) {
    return inspectReviewSummaryFromSsrData(rootValue, expectedItemId, limits).summary;
  }

  function inspectPrimitiveRatingCandidate(props, expectedItemId) {
    if (!props || typeof props !== 'object') return { candidate: null, diagnostic: null };
    const clickInfo = props.analyticEvents?.clickAllReviews?.trackingInfo;
    const viewInfo = props.analyticEvents?.viewWidgetReview?.trackingInfo;
    const itemIds = [clickInfo?.itemId, viewInfo?.itemId].map(asString).filter(Boolean);
    const expected = asString(expectedItemId);
    if (expected) {
      if (!itemIds.length || !itemIds.includes(expected)) return { candidate: null, diagnostic: null };
      if (itemIds.some((itemId) => itemId !== expected)) {
        return { candidate: null, diagnostic: 'conflict' };
      }
    }

    const ratingInputs = [clickInfo?.overallRating, viewInfo?.overallRating]
      .filter((value) => value !== null && value !== undefined && value !== '');
    const ratingValues = ratingInputs.map(parseLocalizedRating);
    const uniqueRatings = [...new Set(ratingValues.filter((value) => value !== null))];
    const rating = ratingValues.every((value) => value !== null) && uniqueRatings.length === 1
      ? uniqueRatings[0]
      : null;
    const resolveParams = props.resolveParams;
    const hasReviewCount = resolveParams && typeof resolveParams === 'object'
      && Object.prototype.hasOwnProperty.call(resolveParams, 'review.productReviewsCount');
    const reviewCount = hasReviewCount ? parseLocalizedCount(resolveParams['review.productReviewsCount']) : null;
    const candidate = {
      rating,
      reviewCount,
    };
    if (candidate.rating !== null || candidate.reviewCount !== null) return { candidate, diagnostic: null };
    const hasRelevantFields = ratingInputs.length || hasReviewCount;
    const conflict = uniqueRatings.length > 1;
    return {
      candidate: null,
      diagnostic: hasRelevantFields ? (conflict ? 'conflict' : 'schema-mismatch') : null,
    };
  }

  function inspectBasicRatingFromSsrData(rootValue, expectedItemId, limits = {}) {
    const maxDepth = limits.maxDepth || AGGREGATE_SSR_MAX_DEPTH;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const depthCutoffs = new Set();
    const stack = [{ value: rootValue, depth: 0 }];
    const candidates = [];
    const candidateDiagnostics = [];
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      if (current.depth > maxDepth) {
        depthCutoffs.add(value);
        continue;
      }
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value) && value.props && typeof value.props === 'object') {
        const inspection = inspectPrimitiveRatingCandidate(value.props, expectedItemId);
        const candidate = inspection.candidate;
        if (inspection.diagnostic) candidateDiagnostics.push(inspection.diagnostic);
        if (candidate && (candidate.rating !== null || candidate.reviewCount !== null)) candidates.push(candidate);
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    if (boundedTraversalReachedLimit(stack, seen, visited, maxVisited, depthCutoffs)) {
      return { summary: null, diagnostic: 'traversal-limit' };
    }
    const candidateDiagnostic = firstSectionDiagnostic(candidateDiagnostics
      .map((diagnostic) => ({ diagnostic })));
    if (candidateDiagnostic) return { summary: null, diagnostic: candidateDiagnostic };
    if (!candidates.length) return { summary: null, diagnostic: null };
    const coherent = candidates.filter((candidate) => candidate.rating !== null && candidate.reviewCount !== null);
    const pool = coherent.length ? coherent : candidates;
    const resolveField = (field) => {
      const values = [...new Set(pool.map((candidate) => candidate[field]).filter((value) => value !== null))];
      return values.length === 1 ? values[0] : null;
    };
    const result = emptyRatingSummary();
    result.rating = resolveField('rating');
    result.reviewCount = resolveField('reviewCount');
    const summary = result.rating === null && result.reviewCount === null ? null : result;
    const conflict = ['rating', 'reviewCount'].some((field) => fieldHasConflict(pool, field));
    return {
      summary,
      diagnostic: summary ? null : (conflict ? 'conflict' : null),
    };
  }

  function extractBasicRatingFromSsrData(rootValue, expectedItemId, limits = {}) {
    return inspectBasicRatingFromSsrData(rootValue, expectedItemId, limits).summary;
  }

  function findProductHeaderBoundary(rootNode) {
    if (!rootNode) return null;
    const candidates = [];
    if (typeof rootNode.matches === 'function' && rootNode.matches(PRODUCT_HEADER_SELECTOR)) candidates.push(rootNode);
    if (typeof rootNode.querySelectorAll === 'function') candidates.push(...rootNode.querySelectorAll(PRODUCT_HEADER_SELECTOR));
    return candidates.find((candidate) => typeof candidate.querySelector === 'function' && candidate.querySelector('h1')) || null;
  }

  function inspectBasicRatingFromDom(rootNode) {
    const boundary = findProductHeaderBoundary(rootNode);
    const extraInfo = boundary?.querySelector?.(PRODUCT_HEADER_INFO_SELECTOR);
    if (!extraInfo) return { summary: null, boundary, diagnostic: null };
    const readText = (selector) => {
      const element = extraInfo.querySelector?.(selector);
      return normalizeHumanText(element?.innerText ?? element?.textContent) || null;
    };
    const result = emptyRatingSummary();
    result.display.rating = readText(PRODUCT_RATING_SELECTOR);
    result.display.reviewCount = readText(PRODUCT_REVIEW_COUNT_SELECTOR);
    result.display.boughtCount = readText(PRODUCT_BOUGHT_COUNT_SELECTOR);
    result.rating = parseLocalizedRating(result.display.rating);
    result.reviewCount = parseLocalizedCount(result.display.reviewCount);
    result.boughtCount = parseLocalizedCount(result.display.boughtCount);
    const summary = result.rating === null && result.reviewCount === null && result.boughtCount === null ? null : result;
    const hasUnparsedText = !summary && Object.values(result.display).some(Boolean);
    return { summary, boundary, diagnostic: hasUnparsedText ? 'schema-mismatch' : null };
  }

  function extractBasicRatingFromDom(rootNode) {
    return inspectBasicRatingFromDom(rootNode).summary;
  }

  function findReviewSummaryBoundary(rootNode) {
    if (!rootNode || typeof rootNode.querySelector !== 'function') return null;
    const anchor = rootNode.matches?.(REVIEW_ANCHOR_SELECTOR)
      ? rootNode
      : rootNode.querySelector(REVIEW_ANCHOR_SELECTOR);
    const candidate = anchor?.parentElement;
    if (!candidate || typeof candidate.querySelector !== 'function') return null;
    if (!candidate.querySelector(REVIEW_TABS_SELECTOR)) return null;
    if (!candidate.querySelector(REVIEW_RATING_ROOT_SELECTOR)) return null;
    return candidate;
  }

  function elementText(element) {
    return normalizeHumanText(element?.innerText ?? element?.textContent) || null;
  }

  function parseStarDistribution(boundary) {
    const ratingRoot = boundary?.querySelector?.(REVIEW_RATING_ROOT_SELECTOR);
    const gradeGroup = ratingRoot?.querySelector?.(REVIEW_GRADE_GROUP_SELECTOR);
    const countGroup = ratingRoot?.querySelector?.(REVIEW_COUNT_GROUP_SELECTOR);
    const gradeRows = gradeGroup?.querySelectorAll?.(REVIEW_GRADE_ROW_SELECTOR) || [];
    const countRows = countGroup?.children || [];
    if (gradeRows.length !== 5 || countRows.length !== 5) return null;
    const distribution = {};
    for (let index = 0; index < 5; index += 1) {
      const row = gradeRows[index];
      const totalStars = row.querySelectorAll?.(REVIEW_STAR_SELECTOR)?.length;
      const grade = row.querySelectorAll?.(REVIEW_ACTIVE_STAR_SELECTOR)?.length;
      const count = parseLocalizedCount(elementText(countRows[index]));
      if (totalStars !== 5 || !Number.isInteger(grade) || grade < 1 || grade > 5 || count === null) return null;
      if (Object.prototype.hasOwnProperty.call(distribution, grade)) return null;
      distribution[grade] = count;
    }
    return [1, 2, 3, 4, 5].every((grade) => Object.prototype.hasOwnProperty.call(distribution, grade))
      ? distribution
      : null;
  }

  function findExactDescendantText(rootNode, pattern) {
    if (!rootNode?.querySelectorAll) return null;
    return [...rootNode.querySelectorAll('*')].find((element) => {
      const text = elementText(element);
      if (!text || !pattern.test(text)) return false;
      return ![...(element.children || [])].some((child) => pattern.test(elementText(child) || ''));
    }) || null;
  }

  function extractBuyerPhotos(boundary) {
    const wrapper = boundary?.querySelector?.(REVIEW_PHOTOS_SELECTOR);
    if (!wrapper) return { value: null, display: null };
    if (!findExactDescendantText(wrapper, /^All photos from buyers$/i)) return { value: null, display: null };
    const displayElement = findExactDescendantText(wrapper, /^View all \([\d\s,]+\)$/i);
    const display = elementText(displayElement);
    const countMatch = display?.match(/^View all \(([\d\s,]+)\)$/i);
    return { value: parseLocalizedCount(countMatch?.[1]), display: countMatch ? display : null };
  }

  function extractReviewTopics(boundary) {
    const wrappers = boundary?.querySelectorAll?.(REVIEW_TOPICS_SELECTOR) || [];
    const wrapper = [...wrappers].find((candidate) => findExactDescendantText(
      candidate,
      /^Most mentioned in reviews$/i,
    ));
    if (!wrapper) return null;
    const topics = [];
    for (const topicNode of wrapper.querySelectorAll?.(REVIEW_TOPIC_SELECTOR) || []) {
      const text = elementText(topicNode.querySelector?.(REVIEW_TOPIC_TEXT_SELECTOR));
      const count = parseLocalizedCount(elementText(topicNode.querySelector?.(REVIEW_TOPIC_COUNT_SELECTOR)));
      if (!text || count === null) continue;
      const className = typeof topicNode.className === 'string' ? topicNode.className : '';
      const positive = className.includes('positiveTagMood__');
      const negative = className.includes('negativeTagMood__');
      topics.push({ text, count, mood: positive === negative ? null : (positive ? 'positive' : 'negative') });
    }
    return topics.length ? topics : null;
  }

  function inspectReviewSummaryFromDom(rootNode) {
    const boundary = findReviewSummaryBoundary(rootNode);
    if (!boundary) {
      const anchor = rootNode?.matches?.(REVIEW_ANCHOR_SELECTOR)
        ? rootNode
        : rootNode?.querySelector?.(REVIEW_ANCHOR_SELECTOR);
      const candidate = anchor?.parentElement;
      const hasRelevantStructure = Boolean(candidate?.querySelector?.(REVIEW_TABS_SELECTOR)
        || candidate?.querySelector?.(REVIEW_RATING_ROOT_SELECTOR));
      return { summary: null, boundary: candidate || null, diagnostic: hasRelevantStructure ? 'schema-mismatch' : null };
    }
    const result = emptyRatingSummary();
    result.starDistribution = parseStarDistribution(boundary);
    const photos = extractBuyerPhotos(boundary);
    result.buyerPhotosCount = photos.value;
    result.display.buyerPhotosCount = photos.display;
    result.reviewTopics = extractReviewTopics(boundary);
    const summary = result.starDistribution || result.buyerPhotosCount !== null || result.reviewTopics
      ? withRatingDiagnostics(result)
      : null;
    return { summary, boundary, diagnostic: summary ? null : 'schema-mismatch' };
  }

  function extractReviewSummaryFromDom(rootNode) {
    return inspectReviewSummaryFromDom(rootNode).summary;
  }

  function withRatingDiagnostics(summary) {
    if (!summary) return summary;
    const next = { ...summary, diagnostics: {
      starDistributionTotal: null,
      starDistributionMatchesReviewCount: null,
    } };
    if (summary.starDistribution) {
      next.diagnostics.starDistributionTotal = [5, 4, 3, 2, 1]
        .reduce((total, grade) => total + summary.starDistribution[grade], 0);
      next.diagnostics.starDistributionMatchesReviewCount = summary.reviewCount === null
        || summary.reviewCount === undefined
        ? null
        : next.diagnostics.starDistributionTotal === summary.reviewCount;
    }
    return next;
  }

  function mergeRatingSummary(structured, dom, reviewDom) {
    if (!structured && !dom && !reviewDom) return null;
    const result = emptyRatingSummary();
    result.rating = structured?.rating ?? dom?.rating ?? null;
    result.reviewCount = structured?.reviewCount ?? dom?.reviewCount ?? null;
    result.contentFeedbackCount = structured?.contentFeedbackCount ?? null;
    result.boughtCount = dom?.boughtCount ?? structured?.boughtCount ?? null;
    result.starDistribution = reviewDom?.starDistribution ?? null;
    result.buyerPhotosCount = reviewDom?.buyerPhotosCount ?? null;
    result.reviewTopics = reviewDom?.reviewTopics ?? null;
    for (const field of ['rating', 'reviewCount', 'boughtCount']) {
      result.display[field] = dom?.display?.[field] ?? structured?.display?.[field] ?? null;
    }
    result.display.buyerPhotosCount = reviewDom?.display?.buyerPhotosCount ?? null;
    return withRatingDiagnostics(result);
  }

  function ratingContributionSources(structured, dom, reviewDom) {
    const sources = [];
    const has = (value) => value !== null && value !== undefined;
    const supports = (primary, secondary) => has(secondary)
      && (!has(primary) || primary === secondary);
    if (structured && (
      has(structured.rating)
      || has(structured.reviewCount)
      || has(structured.contentFeedbackCount)
      || supports(dom?.boughtCount, structured.boughtCount)
      || supports(dom?.display?.rating, structured.display?.rating)
      || supports(dom?.display?.reviewCount, structured.display?.reviewCount)
      || supports(dom?.display?.boughtCount, structured.display?.boughtCount)
    )) sources.push('ssr:__AER_DATA__');
    if (dom && (
      supports(structured?.rating, dom.rating)
      || supports(structured?.reviewCount, dom.reviewCount)
      || has(dom.boughtCount)
      || has(dom.display?.rating)
      || has(dom.display?.reviewCount)
      || has(dom.display?.boughtCount)
    )) sources.push('dom:product-header');
    if (reviewDom && (
      has(reviewDom.starDistribution)
      || has(reviewDom.buyerPhotosCount)
      || has(reviewDom.reviewTopics)
      || has(reviewDom.display?.buyerPhotosCount)
    )) sources.push('dom:review-section');
    return sources;
  }

  function inspectRatingFromSsrData(rootValue, expectedItemId, limits = {}) {
    const review = inspectReviewSummaryFromSsrData(rootValue, expectedItemId, limits.review || limits);
    const basic = inspectBasicRatingFromSsrData(rootValue, expectedItemId, limits.basic || limits);
    if (review.diagnostic === 'traversal-limit' || basic.diagnostic === 'traversal-limit') {
      return { summary: null, diagnostic: 'traversal-limit' };
    }
    if (review.diagnostic === 'conflict' || basic.diagnostic === 'conflict') {
      return { summary: null, diagnostic: 'conflict' };
    }
    const overlappingConflict = review.summary && basic.summary
      && ['rating', 'reviewCount'].some((field) => review.summary[field] !== null
        && review.summary[field] !== undefined
        && basic.summary[field] !== null
        && basic.summary[field] !== undefined
        && review.summary[field] !== basic.summary[field]);
    if (overlappingConflict) return { summary: null, diagnostic: 'conflict' };
    const summary = mergeRatingSummary(review.summary, basic.summary, null);
    return {
      summary,
      diagnostic: summary ? null : firstSectionDiagnostic([
        { diagnostic: review.diagnostic },
        { diagnostic: basic.diagnostic },
      ]),
    };
  }

  function starDistributionsEqual(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    return [5, 4, 3, 2, 1].every((grade) => left[grade] === right[grade]);
  }

  function reviewTopicsEqual(left, right) {
    if (left === right) return true;
    if (!left || !right || left.length !== right.length) return false;
    return left.every((topic, index) => topic.text === right[index].text
      && topic.count === right[index].count
      && topic.mood === right[index].mood);
  }

  function ratingSummariesEqual(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    return ['rating', 'reviewCount', 'contentFeedbackCount', 'boughtCount', 'buyerPhotosCount']
      .every((field) => left[field] === right[field])
      && ['rating', 'reviewCount', 'boughtCount', 'buyerPhotosCount']
        .every((field) => left.display?.[field] === right.display?.[field])
      && starDistributionsEqual(left.starDistribution, right.starDistribution)
      && reviewTopicsEqual(left.reviewTopics, right.reviewTopics)
      && left.diagnostics?.starDistributionTotal === right.diagnostics?.starDistributionTotal
      && left.diagnostics?.starDistributionMatchesReviewCount === right.diagnostics?.starDistributionMatchesReviewCount;
  }

  function updateRatingSummary(product, patch, sources = [], replace = false) {
    if (!product || !patch) return product;
    const previous = product.ratingSummary;
    if (replace) {
      const diagnosed = withRatingDiagnostics(patch);
      return withSectionValueAndDiagnostic(
        product,
        'ratingSummary',
        diagnosed,
        presentSectionDiagnostic(product, 'ratingSummary', sources),
        ratingSummariesEqual,
      );
    }
    const next = emptyRatingSummary();
    for (const field of ['rating', 'reviewCount', 'contentFeedbackCount', 'boughtCount', 'buyerPhotosCount']) {
      next[field] = patch[field] ?? previous?.[field] ?? null;
    }
    for (const field of ['rating', 'reviewCount', 'boughtCount', 'buyerPhotosCount']) {
      next.display[field] = patch.display?.[field] ?? previous?.display?.[field] ?? null;
    }
    next.starDistribution = patch.starDistribution ?? previous?.starDistribution ?? null;
    next.reviewTopics = patch.reviewTopics ?? previous?.reviewTopics ?? null;
    const diagnosed = withRatingDiagnostics(next);
    return withSectionValueAndDiagnostic(
      product,
      'ratingSummary',
      diagnosed,
      presentSectionDiagnostic(product, 'ratingSummary', sources, true),
      ratingSummariesEqual,
    );
  }

  function isStaleRatingSummary(boundary, summary, staleBoundary, staleSummary, diagnostic = null, staleDiagnostic = null) {
    return Boolean(boundary && boundary === staleBoundary && ratingSummariesEqual(summary, staleSummary)
      && diagnostic === staleDiagnostic);
  }

  function enrichProductFallbacks(product, sources = {}) {
    let updatedProduct = product;

    const gallery = observationFromInput(
      sources,
      'galleryInspection',
      'structuredGallery',
      'ssr:__AER_DATA__',
    );
    if (gallery?.value) updatedProduct = updateGallery(updatedProduct, gallery.value, [gallery.source]);
    else if (gallery) updatedProduct = applyMissingSectionDiagnostic(updatedProduct, 'gallery', [gallery]);

    const structuredRating = observationFromInput(
      sources,
      'structuredRatingInspection',
      'structuredRating',
      'ssr:__AER_DATA__',
    );
    const domRating = observationFromInput(
      sources,
      'domRatingInspection',
      'domRating',
      'dom:product-header',
    );
    const reviewDomSummary = observationFromInput(
      sources,
      'reviewDomSummaryInspection',
      'reviewDomSummary',
      'dom:review-section',
    );
    const ratingObservations = [structuredRating, domRating, reviewDomSummary].filter(Boolean);
    if (ratingObservations.length) {
      const ratingSummary = mergeRatingSummary(
        structuredRating?.value,
        domRating?.value,
        reviewDomSummary?.value,
      );
      if (ratingSummary) {
        updatedProduct = updateRatingSummary(
          updatedProduct,
          ratingSummary,
          ratingContributionSources(
            structuredRating?.value,
            domRating?.value,
            reviewDomSummary?.value,
          ),
          true,
        );
      } else {
        updatedProduct = applyMissingSectionDiagnostic(updatedProduct, 'ratingSummary', ratingObservations);
      }
    }

    const structuredStore = observationFromInput(
      sources,
      'structuredStoreInspection',
      'structuredStore',
      'ssr:__AER_DATA__',
    );
    const domStore = observationFromInput(sources, 'domStoreInspection', 'domStore', 'dom:store');
    const storeObservations = [structuredStore, domStore].filter(Boolean);
    if (storeObservations.length) {
      const store = mergeStore(structuredStore?.value, domStore?.value);
      if (store) {
        updatedProduct = updateStore(
          updatedProduct,
          store,
          storeContributionSources(structuredStore?.value, domStore?.value),
          true,
        );
      } else {
        updatedProduct = applyMissingSectionDiagnostic(updatedProduct, 'store', storeObservations);
      }
    }

    const characteristics = observationFromInput(
      sources,
      'characteristicsInspection',
      'characteristics',
      'dom:characteristics',
    );
    if (characteristics) {
      if (Array.isArray(characteristics.value) && characteristics.value.length) {
        updatedProduct = updateCharacteristics(updatedProduct, characteristics.value, [characteristics.source]);
      } else {
        updatedProduct = applyMissingSectionDiagnostic(updatedProduct, 'characteristics', [characteristics]);
      }
    }

    const description = observationFromInput(
      sources,
      'descriptionInspection',
      'description',
      'dom:description',
    );
    if (description?.value) updatedProduct = updateDescription(updatedProduct, description.value, [description.source]);
    else if (description) updatedProduct = applyMissingSectionDiagnostic(updatedProduct, 'description', [description]);
    return updatedProduct;
  }

  function normalizeDescriptionUrl(value, pageUrl) {
    const input = asString(value)?.trim();
    if (!input) return null;
    try {
      const url = new URL(input, pageUrl);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function findDescriptionBoundary(rootNode) {
    if (!rootNode) return null;
    if (typeof rootNode.matches === 'function' && rootNode.matches(DESCRIPTION_BOUNDARY_SELECTOR)) return rootNode;
    return typeof rootNode.querySelector === 'function' ? rootNode.querySelector(DESCRIPTION_BOUNDARY_SELECTOR) : null;
  }

  function parseDescriptionBlocks(boundary, pageUrl) {
    const blocks = [];
    let textBuffer = '';
    let textContext = null;

    const contextKey = (context) => `${context.headingLevel || 0}\u0000${context.linkUrl || ''}`;
    const flushText = () => {
      const text = normalizeHumanText(textBuffer);
      if (text) {
        if (textContext?.linkUrl) blocks.push({ type: 'link', text, url: textContext.linkUrl });
        else if (textContext?.headingLevel) blocks.push({ type: 'heading', level: textContext.headingLevel, text });
        else blocks.push({ type: 'text', text });
      }
      textBuffer = '';
      textContext = null;
    };
    const appendText = (value, context) => {
      if (!value) return;
      if (textContext && contextKey(textContext) !== contextKey(context)) flushText();
      textContext = context;
      textBuffer += value;
    };

    const walk = (node, context = {}) => {
      if (!node) return;
      if (node.nodeType === 3) {
        appendText(node.nodeValue ?? node.textContent ?? '', context);
        return;
      }
      if (node.nodeType !== 1) return;

      const tag = String(node.tagName || '').toLowerCase();
      if (DESCRIPTION_IGNORED_TAGS.has(tag)) return;
      if (tag === 'br') {
        flushText();
        return;
      }
      if (tag === 'img') {
        flushText();
        const url = normalizeDescriptionUrl(node.getAttribute?.('src'), pageUrl);
        if (!url) return;
        const image = {
          type: 'image',
          url,
          alt: normalizeHumanText(node.getAttribute?.('alt')) || null,
        };
        if (context.linkUrl) image.linkUrl = context.linkUrl;
        blocks.push(image);
        return;
      }

      const headingMatch = tag.match(/^h([1-6])$/);
      const isBoundary = Boolean(headingMatch) || DESCRIPTION_BLOCK_TAGS.has(tag);
      if (isBoundary) flushText();

      let childContext = context;
      if (headingMatch) childContext = { ...context, headingLevel: Number(headingMatch[1]) };
      if (tag === 'a') {
        flushText();
        childContext = { ...childContext, linkUrl: normalizeDescriptionUrl(node.getAttribute?.('href'), pageUrl) };
      }

      for (const child of Array.from(node.childNodes || [])) walk(child, childContext);

      if (tag === 'a' || isBoundary) flushText();
    };

    for (const child of Array.from(boundary.childNodes || [])) walk(child);
    flushText();
    return blocks;
  }

  function buildDescription(source, rawHtml, blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return null;
    const text = blocks
      .filter((block) => block.type === 'text' || block.type === 'heading' || block.type === 'link')
      .map((block) => block.text)
      .join('\n');
    const images = blocks.filter((block) => block.type === 'image').map((block) => {
      const image = { url: block.url, alt: block.alt };
      if (block.linkUrl) image.linkUrl = block.linkUrl;
      return image;
    });
    return { source, rawHtml, blocks, text, images };
  }

  function descriptionBoundaryHasRelevantContent(boundary) {
    const visit = (node) => {
      if (!node) return false;
      if (node.nodeType === 3) return Boolean(normalizeHumanText(node.nodeValue ?? node.textContent));
      if (node.nodeType !== 1) return false;
      const tag = String(node.tagName || '').toLowerCase();
      if (DESCRIPTION_IGNORED_TAGS.has(tag)) return false;
      if (DESCRIPTION_RELEVANT_MEDIA_TAGS.has(tag) && normalizeHumanText(node.getAttribute?.('src'))) return true;
      return Array.from(node.childNodes || []).some(visit);
    };
    return Array.from(boundary?.childNodes || []).some(visit);
  }

  function inspectDescriptionFromDom(rootNode, pageUrl) {
    const boundary = findDescriptionBoundary(rootNode);
    if (!boundary) return { description: null, boundary: null, diagnostic: null };
    const rawHtml = typeof boundary.innerHTML === 'string' ? boundary.innerHTML : '';
    const description = buildDescription('dom', rawHtml, parseDescriptionBlocks(boundary, pageUrl));
    return {
      description,
      boundary,
      diagnostic: !description && descriptionBoundaryHasRelevantContent(boundary) ? 'schema-mismatch' : null,
    };
  }

  function extractDescriptionFromDom(rootNode, pageUrl) {
    return inspectDescriptionFromDom(rootNode, pageUrl).description;
  }

  function descriptionsEqual(left, right) {
    if (left === right) return true;
    return Boolean(left && right && left.source === right.source && left.rawHtml === right.rawHtml);
  }

  function updateDescription(product, description, sources = ['dom:description']) {
    if (!product || !description) return product;
    return withSectionValueAndDiagnostic(
      product,
      'description',
      description,
      presentSectionDiagnostic(product, 'description', sources),
      descriptionsEqual,
    );
  }

  function isStaleDescription(
    boundary,
    description,
    staleBoundary,
    staleDescription,
    diagnostic = null,
    staleDiagnostic = null,
  ) {
    return Boolean(boundary && boundary === staleBoundary && descriptionsEqual(description, staleDescription)
      && diagnostic === staleDiagnostic);
  }

  function inspectProductDataCandidate(rootValue, limits = {}) {
    const maxDepth = limits.maxDepth || 30;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const depthCutoffs = new Set();
    const stack = [{ value: rootValue, depth: 0, path: '$' }];
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      if (current.depth > maxDepth) {
        depthCutoffs.add(value);
        continue;
      }
      seen.add(value);
      visited += 1;
      const skuInfo = value.skuInfo;
      if (skuInfo && Array.isArray(skuInfo.propertyList) && Array.isArray(skuInfo.priceList)) {
        return hasUnvisitedDepthCutoff(depthCutoffs, seen)
          ? { candidate: null, diagnostic: 'traversal-limit' }
          : { candidate: { data: value, path: current.path }, diagnostic: null };
      }
      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1, path: `${current.path}.${key}` });
      }
    }
    return boundedTraversalReachedLimit(stack, seen, visited, maxVisited, depthCutoffs)
      ? { candidate: null, diagnostic: 'traversal-limit' }
      : { candidate: null, diagnostic: null };
  }

  function findProductDataCandidate(rootValue, limits = {}) {
    return inspectProductDataCandidate(rootValue, limits).candidate;
  }

  function normalizeProduct(productData, pageUrl, fallbacks = {}) {
    if (!productData?.skuInfo) throw new Error('productData.skuInfo is missing');
    const url = normalizeItemUrl(pageUrl);
    const itemId = getItemId(url) || asString(firstDefined(productData.productId, productData.itemId, productData.id));
    const variantGroups = normalizeVariantGroups(productData.skuInfo.propertyList);
    const skus = normalizeSkus(productData.skuInfo.priceList, variantGroups);
    const urlSkuId = asString(new URL(pageUrl).searchParams.get('sku_id'));
    const activeSkuId = asString(productData.activeSkuId);
    const requestedSkuId = asString(firstDefined(urlSkuId, activeSkuId));
    const selectedSku = skus.find((sku) => sku.skuId === requestedSkuId)
      || skus.find((sku) => sku.skuId === activeSkuId)
      || null;
    const selectedSkuId = selectedSku?.skuId || requestedSkuId;
    const sizeGuideInspection = inspectSizeGuide(productData.skuInfo.sizeData);
    const sizeGuidePresent = Boolean(sizeGuideInspection.sizeGuide?.tables?.length);
    const characteristics = normalizeCharacteristics(fallbacks.characteristics);
    const characteristicsObserved = Object.prototype.hasOwnProperty.call(fallbacks, 'characteristics');
    const characteristicsDiagnostic = characteristicsObserved && Array.isArray(fallbacks.characteristics)
      && fallbacks.characteristics.length && !characteristics.length
      ? 'schema-mismatch'
      : null;
    const product = {
      itemId,
      title: asString(firstDefined(productData.title, productData.name, productData.productInfo?.title, fallbacks.title)),
      url: url.href,
      selectedSkuId,
      gallery: null,
      price: selectedSku?.price || null,
      ratingSummary: null,
      variantGroups,
      skus,
      selectedSku,
      sizeGuide: sizeGuideInspection.sizeGuide,
      characteristics,
      description: null,
      delivery: null,
      store: null,
      reviews: [],
      _meta: {
        source: fallbacks.source || 'productData',
        activeSkuId,
        selectedSkuResolved: Boolean(selectedSku),
        sections: {
          sizeGuide: sectionDiagnosticFromObservations([createSectionObservation(
            'productData',
            sizeGuidePresent ? sizeGuideInspection.sizeGuide : null,
            sizeGuideInspection.diagnostic,
          )], sizeGuidePresent),
          gallery: createSectionDiagnostic('not-observed'),
          ratingSummary: createSectionDiagnostic('not-observed'),
          store: createSectionDiagnostic('not-observed'),
          characteristics: characteristicsObserved
            ? sectionDiagnosticFromObservations([createSectionObservation(
              'dom:characteristics',
              characteristics.length ? characteristics : null,
              characteristicsDiagnostic,
            )], Boolean(characteristics.length))
            : createSectionDiagnostic('not-observed'),
          description: createSectionDiagnostic('not-observed'),
          delivery: createSectionDiagnostic('not-observed'),
        },
      },
    };
    return withProductCompleteness(product);
  }

  function carryProductSections(product, previousProduct) {
    if (!product || !previousProduct || product.itemId !== previousProduct.itemId) return product;
    const sectionNames = ['gallery', 'ratingSummary', 'store', 'characteristics', 'description'];
    const nextSections = { ...(product._meta?.sections || {}) };
    let changed = false;
    const next = { ...product };
    for (const section of sectionNames) {
      const previousValue = previousProduct[section];
      const hasValue = section === 'characteristics'
        ? Array.isArray(previousValue) && previousValue.length > 0
        : Boolean(previousValue);
      if (hasValue && product[section] !== previousValue) {
        next[section] = previousValue;
        changed = true;
      }
      const previousDiagnostic = previousProduct._meta?.sections?.[section];
      if (previousDiagnostic && !sectionDiagnosticsEqual(nextSections[section], previousDiagnostic)) {
        nextSections[section] = previousDiagnostic;
        changed = true;
      }
    }
    if (!changed) return withProductCompleteness(product);
    next._meta = { ...(product._meta || {}), sections: nextSections };
    return withProductCompleteness(next);
  }

  // Once a product is normalized, an absent or unknown URL sku_id keeps the
  // last valid selection. activeSkuId is only an initial normalization fallback.
  function updateSelectedSku(product, pageUrl) {
    if (!product || !Array.isArray(product.skus)) return product;
    let requestedSkuId;
    try {
      requestedSkuId = asString(new URL(pageUrl).searchParams.get('sku_id'));
    } catch (_) {
      return product;
    }
    if (!requestedSkuId || requestedSkuId === product.selectedSkuId) return withProductCompleteness(product);
    const selectedSku = product.skus.find((sku) => sku.skuId === requestedSkuId);
    if (!selectedSku) return withProductCompleteness(product);
    // Delivery is SKU-specific; runtime may reapply only the new SKU's cache entry.
    return withProductCompleteness({
      ...product,
      url: normalizeItemUrl(pageUrl).href,
      selectedSkuId: requestedSkuId,
      selectedSku,
      price: selectedSku.price,
      delivery: null,
      _meta: {
        ...product._meta,
        selectedSkuResolved: true,
        sections: {
          ...(product._meta?.sections || {}),
          delivery: createSectionDiagnostic('not-observed'),
        },
      },
    });
  }

  function synchronizeProductPageContext(product, pageUrl, deliveryCache, shippingEnvironment) {
    if (!product || getItemId(pageUrl) !== product.itemId) return null;
    const selected = updateSelectedSku(product, pageUrl);
    return selected === product
      ? product
      : applyCachedDelivery(selected, deliveryCache, shippingEnvironment);
  }

  function refreshSsrInspectionCache(previous, itemId, script, inspectors) {
    const text = typeof script?.textContent === 'string' ? script.textContent : '';
    if (previous && previous.itemId === itemId && previous.script === script && previous.text === text) {
      return previous;
    }
    const inspections = {};
    for (const [name, inspect] of Object.entries(inspectors || {})) {
      inspections[name] = inspect(itemId, script);
    }
    return { itemId, script, text, inspections };
  }

  function preserveStaleSectionObservation(previous, boundary, value, diagnostic = null) {
    return boundary ? { boundary, value, diagnostic } : previous;
  }

  const STALE_SECTION_HISTORY_LIMIT = 24;

  function appendStaleSectionObservation(history, boundary, value, diagnostic = null, equal = Object.is) {
    const previous = (Array.isArray(history) ? history : [])
      .filter((observation) => observation?.boundary);
    if (!boundary) return previous.slice(-STALE_SECTION_HISTORY_LIMIT);
    const withoutDuplicate = previous.filter((observation) => !(
      observation.boundary === boundary
      && equal(observation.value, value)
      && observation.diagnostic === diagnostic
    ));
    return [...withoutDuplicate, { boundary, value, diagnostic }].slice(-STALE_SECTION_HISTORY_LIMIT);
  }

  function matchesStaleSectionObservation(
    history,
    boundary,
    value,
    diagnostic = null,
    equal = Object.is,
  ) {
    if (!boundary || !Array.isArray(history)) return false;
    return history.some((observation) => observation?.boundary === boundary
      && equal(observation.value, value)
      && observation.diagnostic === diagnostic);
  }

  function staleSectionObservationHistory(state, historyKey, boundaryKey, valueKey, diagnosticKey) {
    const history = (Array.isArray(state?.[historyKey]) ? state[historyKey] : [])
      .filter((observation) => observation?.boundary);
    if (history.length) return history.slice(-STALE_SECTION_HISTORY_LIMIT);
    return state?.[boundaryKey]
      ? [{
        boundary: state[boundaryKey],
        value: state[valueKey],
        diagnostic: state[diagnosticKey] ?? null,
      }]
      : [];
  }

  function snapshotSectionObservation(history, recorded, live, equal) {
    let nextHistory = appendStaleSectionObservation(
      history,
      recorded?.boundary,
      recorded?.value,
      recorded?.diagnostic,
      equal,
    );
    for (const observation of (Array.isArray(live) ? live : [live])) {
      nextHistory = appendStaleSectionObservation(
        nextHistory,
        observation?.boundary,
        observation?.value,
        observation?.diagnostic,
        equal,
      );
    }
    const latest = nextHistory[nextHistory.length - 1] || {
      boundary: null,
      value: null,
      diagnostic: null,
    };
    return { ...latest, history: nextHistory };
  }

  function snapshotStaleDomObservations(state, rootNode, itemId, pageUrl) {
    // Every currently mounted unbound DOM observation is phase-ambiguous at an
    // item transition, so retain it alongside prior observations. A later item
    // may accept only a boundary/value fingerprint that is not quarantined.
    const ratingInspection = inspectBasicRatingFromDom(rootNode);
    const reviewInspection = inspectReviewSummaryFromDom(rootNode);
    const storeInspection = inspectStoreFromDom(rootNode, itemId, pageUrl);
    const characteristicsInspection = inspectCharacteristicsFromDom(rootNode);
    const descriptionInspection = inspectDescriptionFromDom(rootNode, pageUrl);
    const characteristicsSnapshots = [
      ...(Array.isArray(characteristicsInspection.observations)
        ? characteristicsInspection.observations.map((observation) => ({
          boundary: observation.boundary,
          value: observation.characteristics,
          diagnostic: observation.diagnostic,
        }))
        : []),
      characteristicsInspection.boundary
        ? {
          boundary: characteristicsInspection.boundary,
          value: characteristicsInspection.characteristics,
          diagnostic: characteristicsInspection.diagnostic,
        }
        : null,
    ].filter(Boolean);
    return {
      rating: snapshotSectionObservation(
        staleSectionObservationHistory(
          state,
          'staleRatingObservations',
          'staleRatingBoundary',
          'staleRatingDomSummary',
          'staleRatingDomDiagnostic',
        ),
        { boundary: state.ratingBoundary, value: state.ratingDomSummary, diagnostic: state.ratingDomDiagnostic },
        ratingInspection.boundary
          ? { boundary: ratingInspection.boundary, value: ratingInspection.summary, diagnostic: ratingInspection.diagnostic }
          : null,
        ratingSummariesEqual,
      ),
      review: snapshotSectionObservation(
        staleSectionObservationHistory(
          state,
          'staleReviewSummaryObservations',
          'staleReviewSummaryBoundary',
          'staleReviewDomSummary',
          'staleReviewDomDiagnostic',
        ),
        {
          boundary: state.reviewSummaryBoundary,
          value: state.reviewDomSummary,
          diagnostic: state.reviewDomDiagnostic,
        },
        reviewInspection.boundary
          ? { boundary: reviewInspection.boundary, value: reviewInspection.summary, diagnostic: reviewInspection.diagnostic }
          : null,
        ratingSummariesEqual,
      ),
      store: snapshotSectionObservation(
        staleSectionObservationHistory(
          state,
          'staleStoreObservations',
          'staleStoreBoundary',
          'staleStoreDom',
          'staleStoreDomDiagnostic',
        ),
        { boundary: state.storeBoundary, value: state.storeDom, diagnostic: state.storeDomDiagnostic },
        storeInspection.boundary && !storeInspection.itemMismatch
          ? { boundary: storeInspection.boundary, value: storeInspection.store, diagnostic: storeInspection.diagnostic }
          : null,
        storesEqual,
      ),
      characteristics: snapshotSectionObservation(
        staleSectionObservationHistory(
          state,
          'staleCharacteristicsObservations',
          'staleCharacteristicsBoundary',
          'staleCharacteristics',
          'staleCharacteristicsDiagnostic',
        ),
        {
          boundary: state.characteristicsBoundary,
          value: state.characteristics,
          diagnostic: state.characteristicsDiagnostic,
        },
        characteristicsSnapshots,
        characteristicsEqual,
      ),
      description: snapshotSectionObservation(
        staleSectionObservationHistory(
          state,
          'staleDescriptionObservations',
          'staleDescriptionBoundary',
          'staleDescription',
          'staleDescriptionDiagnostic',
        ),
        { boundary: state.descriptionBoundary, value: state.description, diagnostic: state.descriptionDiagnostic },
        descriptionInspection.boundary
          ? {
            boundary: descriptionInspection.boundary,
            value: descriptionInspection.description,
            diagnostic: descriptionInspection.diagnostic,
          }
          : null,
        descriptionsEqual,
      ),
    };
  }

  function formatMoney(money) {
    if (!money) return '—';
    return money.formatted || [money.value, money.currency].filter(Boolean).join(' ') || '—';
  }

  function formatUnresolvedSkuPriceSummary(skus, options = {}) {
    const sampleLimit = Number.isInteger(options.sampleLimit) && options.sampleLimit > 0 ? options.sampleLimit : 5;
    const uniquePrices = [];
    const seen = new Set();
    for (const sku of skus || []) {
      const price = formatMoney(sku?.price?.current);
      if (price === '—' || seen.has(price)) continue;
      seen.add(price);
      uniquePrices.push(price);
    }
    if (!uniquePrices.length) return 'Selected SKU unresolved; no current SKU prices available';

    const count = uniquePrices.length;
    const shown = uniquePrices.slice(0, sampleLimit).join(' | ');
    const omitted = count - Math.min(count, sampleLimit);
    return `Selected SKU unresolved; ${count} unique SKU price${count === 1 ? '' : 's'}: ${shown}${omitted ? ` (+${omitted} more)` : ''}`;
  }

  function formatSelections(sku) {
    return sku?.selections?.map((selection) => `${selection.groupName}: ${selection.name}`).join('; ') || '—';
  }

  function formatSourceLabel(source) {
    const value = asString(source) || 'unknown';
    if (/^(?:network:)?productData$/i.test(value)) return 'API';
    if (/^ssr(?::|$)/i.test(value)) return 'SSR';
    if (/^react(?::|$)/i.test(value)) return 'React';
    return value;
  }

  function formatProductSectionLabel(section) {
    return ({
      sizeGuide: 'Size Guide',
      gallery: 'Gallery',
      ratingSummary: 'Rating Summary',
      store: 'Store',
      characteristics: 'Characteristics',
      description: 'Description',
      delivery: 'Delivery',
    })[section] || section;
  }

  function formatProductCoreIssue(issue) {
    return ({
      'selected-sku-unresolved': 'selected SKU unresolved',
    })[issue] || issue;
  }

  function formatProductQualityLines(product) {
    const completeness = assessProductCompleteness(product);
    const lines = [`Data status: ${completeness.state.toUpperCase()}`];
    if (completeness.invalidSections.length) {
      lines.push(`Invalid sections: ${completeness.invalidSections
        .map(({ section, diagnostic }) => `${formatProductSectionLabel(section)} (${diagnostic})`)
        .join(', ')}`);
    }
    if (completeness.notObservedSections.length) {
      lines.push(`Not observed: ${completeness.notObservedSections.map(formatProductSectionLabel).join(', ')}`);
    }
    if (completeness.coreIssues.length) {
      lines.push(`Core issues: ${completeness.coreIssues.map(formatProductCoreIssue).join(', ')}`);
    }
    return lines;
  }

  function formatProductStatus(product) {
    const combinationCount = product.skus.length;
    const combinationLabel = combinationCount === 1 ? 'combination' : 'combinations';
    const groups = product.variantGroups.map((group) => `${group.name}: ${group.values.length}`).join(', ');
    const completeness = assessProductCompleteness(product);
    const stateLabel = `${completeness.state[0].toUpperCase()}${completeness.state.slice(1)}`;
    const issues = [];
    if (completeness.invalidSections.length) {
      issues.push(completeness.invalidSections
        .map(({ section, diagnostic }) => `${formatProductSectionLabel(section)}: ${diagnostic}`)
        .join(', '));
    }
    if (completeness.notObservedSections.length) {
      issues.push(`not observed: ${completeness.notObservedSections.map(formatProductSectionLabel).join(', ')}`);
    }
    if (completeness.coreIssues.length) {
      issues.push(`core issues: ${completeness.coreIssues.map(formatProductCoreIssue).join(', ')}`);
    }
    return [
      stateLabel,
      `${combinationCount} ${combinationLabel}`,
      groups || 'no variant groups',
      ...issues,
      `source: ${formatSourceLabel(product._meta.source)}`,
    ].join(' · ');
  }

  function formatDeliveryDestination(destination) {
    if (!destination) return '—';
    const places = [destination.cityName, destination.regionName, destination.countryName].filter(Boolean);
    const location = places.join(', ');
    if (location && destination.countryCode) return `${location} (${destination.countryCode})`;
    return location || destination.countryCode || '—';
  }

  function formatDeliveryEta(method) {
    const range = method.etaStartDate && method.etaEndDate
      ? `${method.etaStartDate} — ${method.etaEndDate}`
      : method.etaStartDate || method.etaEndDate || null;
    const display = method.dateFormat || method.dateDisplay;
    return range && display ? `${range} (${display})` : range || display || '—';
  }

  function formatDelivery(delivery) {
    if (!delivery) return '—';
    const lines = [`Destination: ${formatDeliveryDestination(delivery.destination)}`];
    if (!delivery.methods.length) return [...lines, 'Methods: —'].join('\n');
    delivery.methods.forEach((method, index) => {
      if (index) lines.push('');
      const suffix = delivery.methods.length > 1 ? ` ${index + 1}` : '';
      const services = [...new Set([method.serviceName, method.service].filter(Boolean))];
      lines.push(
        `Method${suffix}: ${method.groupName || '—'}`,
        `Service: ${services.join(' / ') || '—'}`,
        `Price: ${formatMoney(method.cost)}`,
        `Estimated delivery: ${formatDeliveryEta(method)}`,
      );
    });
    return lines.join('\n');
  }

  function formatVariantGroups(product) {
    return product.variantGroups.map((group) => `${group.name}:\n${group.values.map((value) => `- ${value.name} [${value.id}]`).join('\n')}`).join('\n\n');
  }

  function formatSizeGuide(sizeGuide) {
    if (!sizeGuide) return '—';
    if (!sizeGuide.tables.length) return '[sizeData captured; unknown table shape]';
    return sizeGuide.tables.map((table) => {
      const unit = table.unit ? ` (${table.unit})` : '';
      return [`Table${unit}`, table.columns.join(' | '), ...table.rows.map((row) => row.join(' | '))].join('\n');
    }).join('\n\n');
  }

  function formatCharacteristics(characteristics) {
    return Array.isArray(characteristics) && characteristics.length
      ? characteristics.map(({ name, value }) => `${name}: ${value}`).join('\n')
      : '—';
  }

  function formatDescription(description) {
    if (!description?.blocks?.length) return '—';
    let imageNumber = 0;
    return description.blocks.map((block) => {
      if (block.type === 'image') return `Image ${++imageNumber}: ${block.url}${block.linkUrl ? ` → ${block.linkUrl}` : ''}`;
      if (block.type === 'link') return `${block.text} — ${block.url}`;
      if (block.type === 'heading' || block.type === 'text') return block.text;
      return null;
    }).filter(Boolean).join('\n');
  }

  function getDescriptionStats(description) {
    const blocks = description?.blocks || [];
    const textualBlocks = blocks.filter((block) => block.type === 'text' || block.type === 'heading' || block.type === 'link');
    return {
      blockCount: blocks.length,
      textualBlockCount: textualBlocks.length,
      imageCount: blocks.filter((block) => block.type === 'image').length,
      linkCount: blocks.filter((block) => (block.type === 'link' && block.url) || (block.type === 'image' && block.linkUrl)).length,
      textCharacterCount: textualBlocks.reduce((total, block) => total + String(block.text || '').length, 0),
    };
  }

  function formatDescriptionForChatGPT(description, options = {}) {
    if (!description?.blocks?.length) return '—';
    const budget = Number.isFinite(options.textBudget) && options.textBudget >= 0
      ? Math.floor(options.textBudget)
      : 2500;
    const stats = getDescriptionStats(description);
    const content = [];
    let emittedCharacters = 0;

    for (const block of description.blocks) {
      if (block.type !== 'text' && block.type !== 'heading' && block.type !== 'link') continue;
      const text = String(block.text || '');
      const remaining = budget - emittedCharacters;
      if (remaining <= 0) break;
      if (text.length <= remaining) {
        content.push(text);
        emittedCharacters += text.length;
      } else {
        content.push(text.slice(0, remaining));
        emittedCharacters += remaining;
        break;
      }
    }

    const omittedTextCharacters = stats.textCharacterCount - emittedCharacters;
    const omissions = [];
    if (omittedTextCharacters) omissions.push(`${omittedTextCharacters} text characters`);
    if (stats.imageCount) omissions.push(`${stats.imageCount} image URLs`);
    if (stats.linkCount) omissions.push(`${stats.linkCount} link URLs`);
    const lines = [
      `Blocks: ${stats.blockCount}`,
      `Text/heading/link blocks: ${stats.textualBlockCount}`,
      `Images: ${stats.imageCount}`,
      `Links: ${stats.linkCount}`,
      `Text characters: ${stats.textCharacterCount}`,
    ];
    if (content.length) lines.push('', ...content);
    if (omissions.length) {
      lines.push('', `[Description limited: ${omissions.join(', ')} omitted. Use Copy description for the full ordered normalized description.]`);
    }
    return lines.join('\n');
  }

  function formatGallery(gallery) {
    if (!gallery?.items?.length) return '—';
    return gallery.items.map((item, index) => item.type === 'video'
      ? [`Item ${index + 1} (video)`, `Video: ${item.videoUrl}`, `Image/poster: ${item.imageUrl}`, `Preview: ${item.previewUrl}`].join('\n')
      : [`Item ${index + 1} (image)`, `Image: ${item.imageUrl}`, `Preview: ${item.previewUrl}`].join('\n')).join('\n\n');
  }

  function formatRatingSummary(summary) {
    const display = (field) => summary?.display?.[field] ?? summary?.[field] ?? '—';
    const distribution = summary?.starDistribution;
    const topics = summary?.reviewTopics;
    const matches = summary?.diagnostics?.starDistributionMatchesReviewCount;
    return [
      `Rating: ${display('rating')}`,
      `Reviews: ${display('reviewCount')}`,
      `Content feedbacks: ${summary?.contentFeedbackCount ?? '—'}`,
      `Bought: ${display('boughtCount')}`,
      `Stars: ${distribution ? [5, 4, 3, 2, 1].map((grade) => `${grade}★ ${distribution[grade]}`).join(' | ') : '—'}`,
      `Star total: ${summary?.diagnostics?.starDistributionTotal ?? '—'}`,
      `Star total matches reviews: ${matches === null || matches === undefined ? '—' : (matches ? 'yes' : 'no')}`,
      `Buyer photos: ${summary?.buyerPhotosCount ?? '—'}`,
      'Review topics:',
      topics?.length
        ? topics.map((topic) => `- ${topic.text} — ${topic.count} — ${topic.mood || '—'}`).join('\n')
        : '—',
    ].join('\n');
  }

  function formatStore(store) {
    if (!store) return '—';
    const ratingValue = store.sellerRating?.value;
    const subscriberValue = store.subscribers?.value;
    return [
      `Store: ${store.name || '—'}`,
      `Store URL: ${store.url || '—'}`,
      `Store ID: ${store.storeId || '—'}`,
      `Seller ID: ${store.sellerId || '—'}`,
      `Seller rating: ${store.sellerRating?.display || '—'}`,
      `Seller rating value: ${ratingValue === null || ratingValue === undefined ? '—' : `${ratingValue}%`}`,
      `Subscribers: ${store.subscribers?.display || '—'}`,
      `Subscribers value: ${subscriberValue ?? '—'}`,
    ].join('\n');
  }

  function exportVariants(product) {
    const combinations = product.skus.map((sku) => [
      `SKU ${sku.skuId}`,
      formatSelections(sku),
      `Price: ${formatMoney(sku.price.current)}`,
      `Regular: ${formatMoney(sku.price.regular)}`,
      `Stock: ${sku.stock ?? '—'}`,
    ].join(' | '));
    return [
      'ALIEXPRESS VARIANTS',
      '',
      `Title: ${product.title || '—'}`,
      `URL: ${product.url}`,
      `Item ID: ${product.itemId}`,
      '',
      'VARIANT GROUPS:',
      formatVariantGroups(product) || '—',
      '',
      `SKU COMBINATIONS (${product.skus.length}):`,
      combinations.join('\n') || '—',
    ].join('\n');
  }

  function exportProduct(product) {
    return JSON.stringify(withProductCompleteness(product), null, 2);
  }

  function exportDescription(product) {
    const description = product?.description;
    const stats = getDescriptionStats(description);
    return [
      'ALIEXPRESS DESCRIPTION',
      '',
      `Title: ${product?.title || '—'}`,
      `URL: ${product?.url || '—'}`,
      `Item ID: ${product?.itemId || '—'}`,
      `Source: ${description?.source || '—'}`,
      '',
      `Blocks: ${stats.blockCount}`,
      `Images: ${stats.imageCount}`,
      `Links: ${stats.linkCount}`,
      '',
      'DESCRIPTION:',
      formatDescription(description),
    ].join('\n');
  }

  function exportForChatGPT(product) {
    const selected = product.selectedSku;
    const priceSummary = selected ? formatMoney(selected.price.current) : formatUnresolvedSkuPriceSummary(product.skus);
    return [
      'ALIEXPRESS PRODUCT',
      '',
      `Title: ${product.title || '—'}`,
      `URL: ${product.url}`,
      `Item ID: ${product.itemId}`,
      '',
      ...formatProductQualityLines(product),
      '',
      `Selected SKU: ${product.selectedSkuId || '—'}${selected ? '' : ' (not resolved)'}`,
      `Selected variants: ${formatSelections(selected)}`,
      '',
      `Price: ${priceSummary}`,
      `Regular price: ${formatMoney(selected?.price.regular)}`,
      `Stock: ${selected?.stock ?? '—'}`,
      '',
      'RATING & TRADE:',
      formatRatingSummary(product.ratingSummary),
      '',
      'STORE / SELLER:',
      formatStore(product.store),
      '',
      'DELIVERY:',
      formatDelivery(product.delivery),
      '',
      'VARIANT GROUPS:',
      formatVariantGroups(product) || '—',
      '',
      'SKU COMBINATIONS:',
      `${product.skus.length} real combinations from priceList (full list is available via Copy variants).`,
      '',
      'SIZE GUIDE:',
      formatSizeGuide(product.sizeGuide),
      '',
      'CHARACTERISTICS:',
      formatCharacteristics(product.characteristics),
      '',
      'GALLERY:',
      formatGallery(product.gallery),
      '',
      'DESCRIPTION:',
      formatDescriptionForChatGPT(product.description),
    ].join('\n');
  }

  const AliHelperCore = {
    VERSION,
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    PASSIVE_REVIEW_RETENTION_CAP_OPTIONS,
    isPassiveReviewRetentionCap,
    normalizePassiveReviewRetentionCap,
    parsePassiveReviewRetentionCapSelection,
    normalizeSettings,
    loadSettings,
    PANEL_SHELL_CONTRACT,
    TOOLTIP_DELAY_MS,
    PRODUCT_PANEL_CONTRACT,
    PRODUCT_PANEL_GROUPS,
    renderProductActionGroups,
    REVIEWS_PANEL_CONTRACT,
    panelModeForWidth,
    createPanelLayoutState,
    setPanelLayoutMode,
    setPanelLayoutViewport,
    togglePanelLayoutState,
    isPanelLayoutCollapsed,
    panelCollapsedPreferenceToPersist,
    panelToggleView,
    createResponsivePanelController,
    SECTION_SOURCE_ORDER,
    PRODUCT_SECTION_ORDER,
    PRODUCT_CONFIRMED_MISSING_SECTIONS,
    SECTION_DISCLOSURE_CONTRACT,
    normalizeSectionSources,
    createSectionDisclosureModel,
    renderSectionDisclosure,
    renderProductSectionDisclosure,
    createProductStatusController,
    createPanelBodyWheelHandler,
    createTooltipController,
    createSectionDiagnostic,
    createSectionObservation,
    sectionDiagnosticFromObservations,
    assessProductCompleteness,
    isItemPage,
    getItemId,
    isReviewsPage,
    getReviewsItemId,
    isTrackingParam,
    normalizeItemUrl,
    toggleMarketUrl,
    splitSkuPropIds,
    normalizeMoney,
    normalizeDelivery,
    inspectDeliveryCapture,
    createShippingContextKey,
    createShippingEnvironment,
    createDeliveryCache,
    cacheDelivery,
    cacheDeliveryCapture,
    shippingCaptureMatchesProduct,
    getCachedDelivery,
    applyCachedDelivery,
    normalizeVariantGroups,
    normalizeSkus,
    inspectSizeGuide,
    normalizeSizeGuide,
    normalizeCharacteristics,
    inspectCharacteristicsFromDom,
    extractCharacteristicsFromDom,
    updateCharacteristics,
    normalizeGallery,
    galleriesEqual,
    inspectGalleryFromSsrData,
    extractGalleryFromSsrData,
    updateGallery,
    normalizeReviewRecord,
    normalizeReviewCandidate,
    isNativeReviewEndpoint,
    normalizeNativeReviewRequest,
    canonicalizeReviewContext,
    createReviewContextKey,
    normalizeNativeReviewResponse,
    normalizeNativeReviewBatch,
    createReviewCache,
    setReviewCacheDefaultCap,
    applyPassiveReviewRetentionCapSelection,
    isReviewPageWithinCaptureCap,
    seedReviewCacheFromSsr,
    applyNativeReviewBatch,
    mergeReviewContext,
    getActiveReviewPage,
    formatReviewContext,
    formatReviewsPageStatus,
    inspectReviewsPageFromSsrData,
    extractReviewsPageFromSsrData,
    exportReviewsPage,
    formatReviewsForChatGPT,
    parseLocalizedRating,
    parseLocalizedCount,
    parseLocalizedPercentage,
    storeIdFromUrl,
    normalizeStore,
    parseStoreChatLink,
    inspectExpectedStoreItem,
    containsExpectedStoreItem,
    inspectStoreFromSsrProps,
    storeFromSsrProps,
    inspectStoreFromSsrData,
    extractStoreFromSsrData,
    findStoreBoundary,
    inspectStoreFromDom,
    extractStoreFromDom,
    mergeStore,
    storesEqual,
    updateStore,
    isStaleStore,
    inspectObjectDescendants,
    inspectReviewSummaryFromSsrData,
    extractReviewSummaryFromSsrData,
    inspectBasicRatingFromSsrData,
    extractBasicRatingFromSsrData,
    inspectRatingFromSsrData,
    findProductHeaderBoundary,
    inspectBasicRatingFromDom,
    extractBasicRatingFromDom,
    findReviewSummaryBoundary,
    parseStarDistribution,
    extractBuyerPhotos,
    extractReviewTopics,
    inspectReviewSummaryFromDom,
    extractReviewSummaryFromDom,
    withRatingDiagnostics,
    mergeRatingSummary,
    ratingSummariesEqual,
    updateRatingSummary,
    isStaleRatingSummary,
    enrichProductFallbacks,
    normalizeDescriptionUrl,
    findDescriptionBoundary,
    parseDescriptionBlocks,
    buildDescription,
    inspectDescriptionFromDom,
    extractDescriptionFromDom,
    descriptionsEqual,
    updateDescription,
    isStaleDescription,
    inspectProductDataCandidate,
    findProductDataCandidate,
    isProductDataBoundToItem,
    productDataRequestItemId,
    normalizeProduct,
    carryProductSections,
    updateSelectedSku,
    synchronizeProductPageContext,
    refreshSsrInspectionCache,
    preserveStaleSectionObservation,
    appendStaleSectionObservation,
    matchesStaleSectionObservation,
    snapshotStaleDomObservations,
    exportProduct,
    exportVariants,
    exportDescription,
    exportForChatGPT,
    formatUnresolvedSkuPriceSummary,
    formatSelections,
    formatSourceLabel,
    formatProductQualityLines,
    formatProductStatus,
    formatDelivery,
    formatRatingSummary,
    formatStore,
    formatGallery,
    formatDescription,
    formatDescriptionForChatGPT,
    isShippingCalculateUrl,
    redactSensitiveJson,
    createShippingDebugCapture,
    installProductDataInterceptor,
    installShippingCalculateInterceptor,
    installNativeReviewInterceptor,
    RUNTIME_REGISTRY_KEY,
    createProductPollingLifecycle,
    createReviewsSsrRetryLifecycle,
    startPageRuntimeSingleton,
    startProductPage,
  };

  if (typeof module === 'object' && module.exports) module.exports = AliHelperCore;
  if (root) root.AliHelperCore = AliHelperCore;

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function loadSettings(readSetting) {
    try {
      const stored = typeof readSetting === 'function'
        ? readSetting(SETTINGS_KEY, {})
        : GM_getValue(SETTINGS_KEY, {});
      return normalizeSettings(stored);
    } catch (_) {
      return normalizeSettings({});
    }
  }

  function saveSettings(settings) {
    try { GM_setValue(SETTINGS_KEY, settings); } catch (_) { /* storage is optional */ }
  }

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(text);
  }

  function installProductDataInterceptor(
    pageWindow,
    onData,
    getRequestItemId = (input) => {
      const explicitItemId = productDataRequestItemId(
        input,
        pageWindow?.location?.href || location.href,
      );
      return explicitItemId === undefined
        ? getItemId(pageWindow?.location?.href || location.href)
        : explicitItemId;
    },
  ) {
    const flag = '__aliHelperProductDataInterceptorV1__';
    if (!pageWindow || pageWindow[flag]) return;
    pageWindow[flag] = true;
    const matches = (input) => {
      try {
        const value = typeof input === 'string' ? input : input?.url;
        return /\/productData(?:[/?]|$)/i.test(new URL(value, pageWindow?.location?.href || location.href).pathname);
      } catch (_) { return false; }
    };
    const accept = (payload, sourceUrl, requestItemId) => {
      const found = findProductDataCandidate(payload);
      if (found) onData(found.data, {
        source: 'network:productData', sourceUrl, path: found.path, requestItemId,
      });
    };

    if (typeof pageWindow.fetch === 'function') {
      const originalFetch = pageWindow.fetch;
      pageWindow.fetch = function aliHelperFetch(...args) {
        const matched = matches(args[0]);
        const requestItemId = matched ? getRequestItemId(args[0]) : null;
        const result = originalFetch.apply(this, args);
        if (matched) {
          result.then((response) => response.clone().json())
            .then((json) => accept(json, typeof args[0] === 'string' ? args[0] : args[0]?.url, requestItemId))
            .catch(() => {});
        }
        return result;
      };
    }

    const XHR = pageWindow.XMLHttpRequest;
    if (XHR?.prototype) {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      XHR.prototype.open = function aliHelperOpen(method, url, ...rest) {
        this.__aliHelperProductDataUrl = matches(url) ? String(url) : null;
        this.__aliHelperProductDataItemId = this.__aliHelperProductDataUrl ? getRequestItemId(url) : null;
        return originalOpen.call(this, method, url, ...rest);
      };
      XHR.prototype.send = function aliHelperSend(...args) {
        if (this.__aliHelperProductDataUrl) {
          this.addEventListener('loadend', () => {
            try {
              const json = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
              accept(json, this.__aliHelperProductDataUrl, this.__aliHelperProductDataItemId);
            } catch (_) { /* non-JSON/blocked response */ }
          }, { once: true });
        }
        return originalSend.apply(this, args);
      };
    }
  }

  function parseJsonBody(body) {
    if (typeof body !== 'string' || !body.trim()) return null;
    try { return JSON.parse(body); } catch (_) { return null; }
  }

  async function readFetchRequestJson(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, 'body')) return parseJsonBody(init.body);
    if (input?.clone && typeof input.clone === 'function') {
      try { return parseJsonBody(await input.clone().text()); } catch (_) { return null; }
    }
    return null;
  }

  function installNativeReviewInterceptor(pageWindow, expectedItemId, onBatch) {
    const flag = '__aliHelperNativeReviewInterceptorV1__';
    if (!pageWindow || pageWindow[flag]) return;
    pageWindow[flag] = true;
    if (typeof pageWindow.fetch !== 'function') return;
    const originalFetch = pageWindow.fetch;
    const baseUrl = pageWindow.location?.href || location.href;
    let requestSequence = 0;
    pageWindow.fetch = function aliHelperNativeReviewFetch(...args) {
      const matched = isNativeReviewEndpoint(args[0], baseUrl);
      const sequence = matched ? ++requestSequence : null;
      const requestJson = matched ? readFetchRequestJson(args[0], args[1]) : null;
      const result = originalFetch.apply(this, args);
      if (matched) {
        Promise.all([requestJson, result.then((response) => response.clone().json())])
          .then(([request, response]) => normalizeNativeReviewBatch(request, response, expectedItemId))
          .then((batch) => { if (batch) onBatch(batch, sequence); })
          .catch(() => {});
      }
      return result;
    };
  }

  function installShippingCalculateInterceptor(pageWindow, onCapture) {
    const flag = '__aliHelperShippingCalculateInterceptorV1__';
    if (!pageWindow || pageWindow[flag]) return;
    pageWindow[flag] = true;
    const matches = (input) => isShippingCalculateUrl(input, location.href);
    const accept = (sourceUrl, transport, request, response) => {
      onCapture(createShippingDebugCapture(sourceUrl, transport, request, response, location.href));
    };

    if (typeof pageWindow.fetch === 'function') {
      const originalFetch = pageWindow.fetch;
      pageWindow.fetch = function aliHelperShippingFetch(...args) {
        const matched = matches(args[0]);
        const requestJson = matched ? readFetchRequestJson(args[0], args[1]) : null;
        const result = originalFetch.apply(this, args);
        if (matched) {
          Promise.all([requestJson, result.then((response) => response.clone().json())])
            .then(([request, response]) => accept(args[0], 'fetch', request, response))
            .catch(() => {});
        }
        return result;
      };
    }

    const XHR = pageWindow.XMLHttpRequest;
    if (XHR?.prototype) {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      XHR.prototype.open = function aliHelperShippingOpen(method, url, ...rest) {
        this.__aliHelperShippingCalculateUrl = matches(url) ? String(url) : null;
        return originalOpen.call(this, method, url, ...rest);
      };
      XHR.prototype.send = function aliHelperShippingSend(...args) {
        if (this.__aliHelperShippingCalculateUrl) {
          const request = parseJsonBody(args[0]);
          this.addEventListener('loadend', () => {
            try {
              const response = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
              accept(this.__aliHelperShippingCalculateUrl, 'xhr', request, response);
            } catch (_) { /* non-JSON/blocked response */ }
          }, { once: true });
        }
        return originalSend.apply(this, args);
      };
    }
  }

  function findInSsrScripts() {
    const preferred = ['#__AER_DATA__', '#__NEXT_DATA__'];
    const scripts = [...preferred.map((selector) => document.querySelector(selector)), ...document.querySelectorAll('script[type="application/json"]')].filter(Boolean);
    for (const script of new Set(scripts)) {
      try {
        const found = findProductDataCandidate(JSON.parse(script.textContent || ''));
        if (found) return { ...found, source: `ssr:${script.id || 'json-script'}` };
      } catch (_) { /* malformed/unrelated JSON */ }
    }
    return null;
  }

  function inspectRatingInSsr(expectedItemId, script = document.querySelector('#__AER_DATA__')) {
    if (!script) return { value: null, diagnostic: null, observed: true };
    try {
      const inspection = inspectRatingFromSsrData(JSON.parse(script.textContent || ''), expectedItemId);
      return { value: inspection.summary, diagnostic: inspection.diagnostic, observed: true };
    } catch (_) {
      return { value: null, diagnostic: 'schema-mismatch', observed: true };
    }
  }

  function inspectGalleryInSsr(expectedItemId, script = document.querySelector('#__AER_DATA__')) {
    if (!script) return { value: null, diagnostic: null, observed: true };
    try {
      const inspection = inspectGalleryFromSsrData(JSON.parse(script.textContent || ''), expectedItemId);
      return { value: inspection.gallery, diagnostic: inspection.diagnostic, observed: true };
    } catch (_) {
      return { value: null, diagnostic: 'schema-mismatch', observed: true };
    }
  }

  function inspectStoreInSsr(expectedItemId, script = document.querySelector('#__AER_DATA__')) {
    if (!script) return { value: null, diagnostic: null, observed: true };
    try {
      const inspection = inspectStoreFromSsrData(JSON.parse(script.textContent || ''), expectedItemId);
      return { value: inspection.store, diagnostic: inspection.diagnostic, observed: true };
    } catch (_) {
      return { value: null, diagnostic: 'schema-mismatch', observed: true };
    }
  }

  function findReviewsPageInSsr(expectedItemId, script = document.querySelector('#__AER_DATA__')) {
    if (!script) return { reviewPage: null, diagnostic: 'no-candidate' };
    try {
      return inspectReviewsPageFromSsrData(JSON.parse(script.textContent || ''), expectedItemId);
    } catch (_) {
      return { reviewPage: null, diagnostic: 'no-candidate' };
    }
  }

  function reviewsDiagnosticMessage(diagnostic) {
    const messages = {
      'invalid-item-id': 'Reviews page item ID could not be resolved.',
      'no-candidate': 'First-page SSR review list was not found.',
      'invalid-candidate': 'First-page SSR review schema was not recognized safely.',
      'conflicting-candidates': 'Conflicting first-page SSR review lists were found.',
      'traversal-limit': 'SSR review scan reached its safety limit.',
    };
    return messages[diagnostic] || 'First-page SSR reviews were not found or were not trustworthy.';
  }

  function findInReact() {
    const roots = document.querySelectorAll('[class*="HazeProduct"], [class*="SnowProduct"], [class*="SnowSku"], #root, #__next');
    for (const element of roots) {
      for (const key of Object.keys(element)) {
        if (!/^__(reactProps|reactFiber)\$/.test(key)) continue;
        const found = findProductDataCandidate(element[key], { maxDepth: 40, maxVisited: 20000 });
        if (found) return { ...found, source: `react:${key.split('$')[0]}` };
      }
    }
    return null;
  }

  const SHARED_PANEL_STYLES = `
    :host { all:initial; position:fixed; right:16px; bottom:16px; z-index:2147483000; display:block; }
    .panel { width:320px; max-width:calc(100vw - 24px); color:#202938; background:#fbfcfd; border:1px solid #cfd7e2; border-radius:10px; box-shadow:0 6px 18px rgba(31,41,55,.14); font:13px/1.35 Arial,sans-serif; overflow:hidden; }
    header { display:flex; align-items:center; gap:8px; padding:8px 9px 8px 12px; background:#e9eef3; border-bottom:1px solid #d7dfe8; }
    strong { flex:1; min-width:0; font-size:14px; font-weight:600; letter-spacing:.01em; }
    .body { padding:11px; max-height:min(65vh,560px); overflow:auto; }
    .panel.collapsed .body { display:none; }
    button { min-width:0; min-height:36px; border:1px solid #cbd4df; border-radius:7px; background:#fff; color:#273244; padding:8px 10px; cursor:pointer; font:inherit; font-weight:600; line-height:1.25; white-space:normal; overflow-wrap:anywhere; }
    button:hover { background:#f3f6f9; border-color:#b8c4d1; }
    button:active { background:#e9eef4; }
    button:disabled { opacity:.48; cursor:not-allowed; }
    button.primary { color:#fff; background:#365f8c; border-color:#365f8c; }
    button.primary:hover { background:#2f557e; border-color:#2f557e; }
    button.primary:active { background:#294b70; border-color:#294b70; }
    .icon { display:inline-grid; place-items:center; flex:none; min-width:30px; min-height:28px; padding:3px 8px; font-weight:700; }
    .status { min-height:18px; margin:0 0 12px; padding:0 1px 9px; color:#536173; border-bottom:1px solid #e4e9ef; overflow-wrap:anywhere; }
    .status.error { color:#9b2c2c; border-bottom-color:#efcaca; }
    .meta { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 10px; color:#737f8e; margin-top:12px; padding-top:9px; border-top:1px solid #e4e9ef; font-size:11px; }
    .meta a { color:#63758a; text-decoration:none; }
    .meta a:hover { color:#365f8c; text-decoration:underline; }
    .tooltip { position:fixed; z-index:2147483001; box-sizing:border-box; max-width:min(260px,calc(100vw - 16px)); padding:6px 8px; border:1px solid #27364a; border-radius:6px; background:#27364a; color:#fff; box-shadow:0 3px 10px rgba(31,41,55,.18); font:12px/1.35 Arial,sans-serif; overflow-wrap:anywhere; pointer-events:none; }
    .tooltip[hidden] { display:none; }
    button:focus-visible, summary:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible { outline:2px solid #3f78b5; outline-offset:2px; }
    @media (max-width:${PANEL_SHELL_CONTRACT.narrowMaxWidth}px) {
      :host { right:12px; bottom:calc(${PANEL_SHELL_CONTRACT.narrowLowerClearance}px + env(safe-area-inset-bottom, 0px)); }
      .panel { box-sizing:border-box; width:min(320px, calc(100vw - 24px)); max-width:calc(100vw - 24px); max-height:min(${PANEL_SHELL_CONTRACT.narrowExpandedMaxViewportHeight}vh, calc(100vh - 96px - env(safe-area-inset-bottom, 0px))); display:flex; flex-direction:column; }
      .panel.collapsed { width:${PANEL_SHELL_CONTRACT.narrowCollapsedMaxWidth}px; max-height:${PANEL_SHELL_CONTRACT.narrowCollapsedMaxHeight}px; }
      header { flex:none; }
      .body { flex:1 1 auto; min-height:0; max-height:none; overflow-x:hidden; overflow-y:auto; overscroll-behavior:contain; }
    }
    @supports (height:100dvh) {
      @media (max-width:${PANEL_SHELL_CONTRACT.narrowMaxWidth}px) {
        .panel { max-height:min(${PANEL_SHELL_CONTRACT.narrowExpandedMaxViewportHeight}dvh, calc(100dvh - 96px - env(safe-area-inset-bottom, 0px))); }
      }
    }
  `;

  function createPanelHost() {
    const host = document.createElement('div');
    host.id = 'ali-helper-host';
    return { host, shadow: host.attachShadow({ mode: 'open' }) };
  }

  function renderPanelActionButtons(actions, className = '') {
    return actions.map((action) => {
      const classes = [
        className,
        action.desktopWide ? 'wide' : '',
        action.primary ? 'primary' : '',
      ].filter(Boolean).join(' ');
      const classAttribute = classes ? ` class="${classes}"` : '';
      const disabled = action.requiresProduct || action.requiresReviews ? ' disabled' : '';
      return `<button type="button"${classAttribute} data-action="${action.id}"${disabled}>${action.label}</button>`;
    }).join('');
  }

  function renderProductActionGroups() {
    return PRODUCT_PANEL_GROUPS.map((group) => {
      const actions = group.actionIds
        .map((actionId) => PRODUCT_PANEL_ACTIONS.find((action) => action.id === actionId))
        .filter(Boolean);
      return `
        <section class="action-group action-group-${group.id}" role="group" aria-label="${group.ariaLabel}">
          <div class="grid">${renderPanelActionButtons(actions)}</div>
        </section>`;
    }).join('');
  }

  function applyPanelActionTooltips(root, actions) {
    actions.forEach((action) => {
      if (!action.tooltip) return;
      const button = root.querySelector(`[data-action="${action.id}"]`);
      if (button) button.dataset.tooltip = action.tooltip;
    });
  }

  function bindResponsivePanel(runtime, host, panel, toggle) {
    const mediaQuery = window.matchMedia(`(max-width: ${PANEL_SHELL_CONTRACT.narrowMaxWidth}px)`);
    return createResponsivePanelController(mediaQuery, runtime.settings.panelCollapsed, (layoutState, toggleView) => {
      const collapsed = isPanelLayoutCollapsed(layoutState);
      panel.classList.toggle('collapsed', collapsed);
      panel.dataset.layoutMode = layoutState.mode;
      host.dataset.aliHelperPanelMode = layoutState.mode;
      toggle.textContent = toggleView.symbol;
      toggle.setAttribute('aria-label', toggleView.ariaLabel);
      toggle.setAttribute('aria-expanded', toggleView.ariaExpanded);
      toggle.dataset.tooltip = toggleView.tooltip;
    }, (desktopPreference) => {
      runtime.settings.panelCollapsed = desktopPreference;
      saveSettings(runtime.settings);
    });
  }

  function createPanel(runtime) {
    const { host, shadow } = createPanelHost();
    shadow.innerHTML = `
      <style>
        ${SHARED_PANEL_STYLES}
        .action-groups { display:grid; gap:15px; }
        .action-group { min-width:0; }
        .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
        .wide { grid-column:1/-1; }
        .product-status { min-height:0; margin:0 0 9px; padding:0 1px; border-bottom:0; }
        .product-status[hidden] { display:none; }
        details { margin-top:10px; }
        summary { width:fit-content; max-width:100%; color:#536173; cursor:pointer; font-weight:600; overflow-wrap:anywhere; }
        details[open] summary { color:#273244; }
        .completeness-badge { display:inline-block; margin-left:6px; padding:1px 5px; border:1px solid #cbd4df; border-radius:999px; color:#536173; font-size:10px; font-weight:700; line-height:1.4; vertical-align:1px; }
        .completeness-badge[data-state="invalid"] { border-color:#efcaca; color:#9b2c2c; }
        .completeness-badge[hidden] { display:none; }
        label { display:flex; gap:7px; margin-top:8px; }
        .section-disclosure-content { display:grid; gap:5px; margin-top:7px; }
        .section-source-row, .confirmed-missing-row, .completeness-detail-row { overflow-wrap:anywhere; }
        .diagnostic { width:100%; margin-top:9px; }
        @media (max-width:${PANEL_SHELL_CONTRACT.narrowMaxWidth}px) {
          .diagnostic { box-sizing:border-box; }
        }
      </style>
      <section class="panel">
        <header><strong>Ali Helper</strong><button type="button" class="icon" data-action="toggle">—</button></header>
        <div class="body">
          <div class="status product-status" role="status" aria-live="polite" aria-atomic="true">Waiting for productData…</div>
          <div class="action-groups">
            ${renderProductActionGroups()}
          </div>
          <details class="section-disclosure" data-section-disclosure hidden>
            <summary>${SECTION_DISCLOSURE_CONTRACT.summary}<span class="completeness-badge" data-completeness-badge hidden></span></summary>
            <div class="section-disclosure-content" data-section-disclosure-content></div>
          </details>
          <details>
            <summary>Settings</summary>
            <label><input type="checkbox" data-setting="autoRedirectComToRu"> Auto redirect COM → RU</label>
            <button type="button" class="diagnostic" data-action="shipping-debug" disabled>Copy shipping debug</button>
          </details>
          <footer class="meta">
            <span>Read/copy/navigation only · v${VERSION}</span>
            <a href="https://bigbensoft.com/" target="_blank" rel="noopener noreferrer">bigbensoft.com</a>
          </footer>
        </div>
      </section>`;
    (document.body || document.documentElement).appendChild(host);

    const panel = shadow.querySelector('.panel');
    const panelBody = shadow.querySelector('.body');
    const status = shadow.querySelector('.status');
    const productButtons = PRODUCT_PANEL_CONTRACT.actions
      .filter((action) => action.requiresProduct)
      .map((action) => shadow.querySelector(`[data-action="${action.id}"]`));
    const sectionDisclosure = shadow.querySelector('[data-section-disclosure]');
    const autoRedirect = shadow.querySelector('[data-setting="autoRedirectComToRu"]');
    const shippingDebug = shadow.querySelector('[data-action="shipping-debug"]');
    applyPanelActionTooltips(shadow, PRODUCT_PANEL_CONTRACT.actions);
    sectionDisclosure.querySelector('summary').dataset.tooltip = SECTION_DISCLOSURE_CONTRACT.tooltip;
    const responsivePanel = bindResponsivePanel(
      runtime,
      host,
      panel,
      shadow.querySelector('[data-action="toggle"]'),
    );
    const tooltipController = createTooltipController(shadow);
    const disposeWheelScroll = bindPanelBodyWheelScroll(panelBody);
    const statusController = createProductStatusController(status);
    autoRedirect.checked = runtime.settings.autoRedirectComToRu;
    shippingDebug.disabled = !runtime.shippingCapture;

    function flash(message, isError = false) {
      statusController.showPersistent(message, isError);
    }
    async function copyWithFeedback(text, label) {
      try { await copyText(text); statusController.showTransient(`${label} copied.`); } catch (error) { flash(`Copy failed: ${error.message}`, true); }
    }
    shadow.addEventListener('click', (event) => {
      const action = event.target?.dataset?.action;
      if (!action) return;
      if (action === 'toggle') {
        responsivePanel.toggle();
      } else if (action === 'clean-url') {
        copyWithFeedback(normalizeItemUrl(location.href).href, 'Clean URL');
      } else if (action === 'market') {
        location.assign(toggleMarketUrl(location.href).href);
      } else if (action === 'product' && runtime.product) {
        const product = runtime.refreshProductEnrichment?.();
        if (product) copyWithFeedback(exportProduct(product), 'Product JSON');
      } else if (action === 'variants' && runtime.product) {
        const product = runtime.refreshProductEnrichment?.();
        if (product) copyWithFeedback(exportVariants(product), 'Variants');
      } else if (action === 'chatgpt' && runtime.product) {
        const product = runtime.refreshProductEnrichment?.();
        if (product) copyWithFeedback(exportForChatGPT(product), 'Product');
      } else if (action === 'description' && runtime.product) {
        const product = runtime.refreshProductEnrichment?.();
        if (product) copyWithFeedback(exportDescription(product), 'Description');
      } else if (action === 'shipping-debug' && runtime.shippingCapture) {
        const product = runtime.refreshProductEnrichment?.();
        if (shippingCaptureMatchesProduct(runtime.shippingCapture, product)) {
          copyWithFeedback(JSON.stringify(runtime.shippingCapture, null, 2), 'Shipping debug');
        } else {
          runtime.shippingCapture = null;
          runtime.ui?.setShippingCapture(null);
        }
      }
    });
    autoRedirect.addEventListener('change', () => {
      runtime.settings.autoRedirectComToRu = autoRedirect.checked;
      saveSettings(runtime.settings);
      statusController.showTransient('Settings saved.');
    });
    return {
      setProduct(product) {
        productButtons.forEach((button) => { button.disabled = false; });
        renderProductSectionDisclosure(sectionDisclosure, product);
        statusController.clear();
      },
      setShippingCapture(capture) {
        shippingDebug.disabled = !capture;
      },
      setStatus: flash,
      dispose() {
        statusController.dispose();
        tooltipController.dispose();
        disposeWheelScroll();
        responsivePanel.destroy();
      },
    };
  }

  function createReviewsPanel(runtime) {
    const { host, shadow } = createPanelHost();
    shadow.innerHTML = `
      <style>
        ${SHARED_PANEL_STYLES}
        .actions { display:flex; flex-direction:column; gap:7px; }
        .action { width:100%; }
        .review-settings { margin-top:9px; border-top:1px solid #eee; padding-top:8px; }
        .review-settings summary { cursor:pointer; }
        .review-setting-control { display:grid; gap:5px; margin-top:8px; }
        .review-setting-control select { box-sizing:border-box; width:100%; border:1px solid #cbd4df; border-radius:7px; background:#fff; color:#273244; padding:7px 9px; font:inherit; }
        .review-setting-help, .review-setting-feedback { margin:7px 0 0; color:#687586; font-size:11px; }
        .review-setting-feedback.error { color:#9b2c2c; }
        @media (max-width:${PANEL_SHELL_CONTRACT.narrowMaxWidth}px) { .action { box-sizing:border-box; } }
      </style>
      <section class="panel">
        <header><strong>Ali Helper</strong><button type="button" class="icon" data-action="toggle">—</button></header>
        <div class="body">
          <div class="status" role="status" aria-live="polite" aria-atomic="true">Waiting for first-page SSR reviews…</div>
          <div class="actions">
            ${renderPanelActionButtons(REVIEWS_PANEL_CONTRACT.actions, 'action')}
          </div>
          <details class="review-settings">
            <summary>Review settings</summary>
            <label class="review-setting-control">
              <span>Passive review retention per context</span>
              <select data-setting="passiveReviewRetentionCap">
                <option value="10">10 reviews</option>
                <option value="30" selected>30 reviews (default)</option>
                <option value="50">50 reviews</option>
                <option value="100">100 reviews</option>
              </select>
            </label>
            <p class="review-setting-help">Keeps only reviews AliExpress loads itself; Ali Helper never loads, repeats, or blocks review requests. Changes apply to new review contexts. Existing retained contexts stay unchanged.</p>
            <p class="review-setting-feedback" data-review-setting-feedback hidden aria-live="polite"></p>
          </details>
          <footer class="meta">
            <span>Read/copy/navigation only · v${VERSION}</span>
            <a href="https://bigbensoft.com/" target="_blank" rel="noopener noreferrer">bigbensoft.com</a>
          </footer>
        </div>
      </section>`;
    (document.body || document.documentElement).appendChild(host);
    const panel = shadow.querySelector('.panel');
    const status = shadow.querySelector('.status');
    const copyButtons = REVIEWS_PANEL_CONTRACT.actions
      .map((action) => shadow.querySelector(`[data-action="${action.id}"]`));
    const retentionSelect = shadow.querySelector('[data-setting="passiveReviewRetentionCap"]');
    const settingFeedback = shadow.querySelector('[data-review-setting-feedback]');
    const responsivePanel = bindResponsivePanel(
      runtime,
      host,
      panel,
      shadow.querySelector('[data-action="toggle"]'),
    );
    const tooltipController = createTooltipController(shadow);
    function flash(message, isError = false) {
      status.textContent = message;
      status.classList.toggle('error', isError);
    }
    function showSettingFeedback(message, isError = false) {
      settingFeedback.hidden = false;
      settingFeedback.textContent = message;
      settingFeedback.classList.toggle('error', isError);
    }
    retentionSelect.value = String(runtime.settings.passiveReviewRetentionCap);
    retentionSelect.addEventListener('change', () => {
      const result = applyPassiveReviewRetentionCapSelection(runtime, retentionSelect.value);
      if (!result.accepted) {
        retentionSelect.value = String(result.preference);
        showSettingFeedback('Not saved. Choose 10, 30, 50, or 100 reviews.', true);
        return;
      }
      showSettingFeedback(result.activeCaptureCap === null
        ? `Saved. New review contexts retain up to ${result.preference} reviews.`
        : `Saved. New contexts use ${result.preference}; current context remains ${result.activeCaptureCap}.`);
    });
    shadow.addEventListener('click', async (event) => {
      const action = event.target?.dataset?.action;
      if (action === 'toggle') {
        responsivePanel.toggle();
      } else if (action === 'reviews' && runtime.reviewPage) {
        try {
          await copyText(exportReviewsPage(runtime.reviewPage));
          flash('Reviews JSON copied.');
        } catch (error) {
          flash(`Copy failed: ${error.message}`, true);
        }
      } else if (action === 'reviews-chatgpt' && runtime.reviewPage) {
        try {
          await copyText(formatReviewsForChatGPT(runtime.reviewPage));
          flash('Reviews for ChatGPT copied.');
        } catch (error) {
          flash(`Copy failed: ${error.message}`, true);
        }
      }
    });
    return {
      setReviews(reviewPage) {
        copyButtons.forEach((button) => { button.disabled = false; });
        flash(formatReviewsPageStatus(reviewPage));
      },
      setStatus: flash,
      dispose() {
        tooltipController.dispose();
        responsivePanel.destroy();
      },
    };
  }

  function startReviewsPage(pageWindow) {
    const runtime = {
      active: true,
      settings: loadSettings(),
      itemId: getReviewsItemId(location.href),
      reviewCache: null,
      reviewPage: null,
      ssrSeeded: false,
      ui: null,
      domReadyHandler: null,
      ssrRetryLifecycle: null,
      dispose() {
        if (!runtime.active) return;
        runtime.active = false;
        if (runtime.domReadyHandler) document.removeEventListener('DOMContentLoaded', runtime.domReadyHandler);
        runtime.domReadyHandler = null;
        runtime.ui?.dispose?.();
        runtime.ssrRetryLifecycle?.dispose();
      },
    };
    runtime.reviewCache = createReviewCache(runtime.itemId, runtime.settings.passiveReviewRetentionCap);
    installNativeReviewInterceptor(pageWindow, runtime.itemId, (batch, sequence) => {
      if (!runtime.active) return;
      const nextCache = applyNativeReviewBatch(runtime.reviewCache, batch, sequence);
      if (nextCache === runtime.reviewCache) return;
      runtime.reviewCache = nextCache;
      runtime.reviewPage = getActiveReviewPage(nextCache);
      if (runtime.reviewPage) runtime.ui?.setReviews(runtime.reviewPage);
    });
    const mount = () => {
      if (!runtime.active || !document.body || document.getElementById('ali-helper-host')) return;
      runtime.domReadyHandler = null;
      runtime.ui = createReviewsPanel(runtime);
      if (runtime.reviewPage) runtime.ui.setReviews(runtime.reviewPage);
    };
    if (document.readyState === 'loading') {
      runtime.domReadyHandler = mount;
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    }
    else mount();

    runtime.ssrRetryLifecycle = createReviewsSsrRetryLifecycle(
      () => findReviewsPageInSsr(runtime.itemId),
      (reviewPage) => {
        if (!runtime.active) return;
        runtime.reviewCache = seedReviewCacheFromSsr(runtime.reviewCache, reviewPage);
        runtime.ssrSeeded = true;
        runtime.reviewPage = getActiveReviewPage(runtime.reviewCache);
        runtime.ui?.setReviews(runtime.reviewPage);
      },
      (diagnostic) => {
        if (runtime.active) runtime.ui?.setStatus(reviewsDiagnosticMessage(diagnostic), true);
      },
    );
    runtime.ssrRetryLifecycle.start();
    return runtime;
  }

  function startProductPage(pageWindow, settings) {
    const runtime = {
      active: true,
      settings,
      product: null,
      shippingCapture: null,
      shippingEnvironment: null,
      deliveryCache: createDeliveryCache(),
      itemId: getItemId(location.href),
      initialItemId: getItemId(location.href),
      ui: null,
      lastUrl: location.href,
      characteristicsBoundary: null,
      characteristics: [],
      characteristicsDiagnostic: null,
      staleCharacteristicsBoundary: null,
      staleCharacteristics: [],
      staleCharacteristicsDiagnostic: null,
      staleCharacteristicsObservations: [],
      descriptionBoundary: null,
      description: null,
      descriptionDiagnostic: null,
      staleDescriptionBoundary: null,
      staleDescription: null,
      staleDescriptionDiagnostic: null,
      staleDescriptionObservations: [],
      ssrInspectionCache: null,
      gallerySsrInspection: null,
      ratingSsrInspection: null,
      ratingBoundary: null,
      ratingDomSummary: null,
      ratingDomDiagnostic: null,
      staleRatingBoundary: null,
      staleRatingDomSummary: null,
      staleRatingDomDiagnostic: null,
      staleRatingObservations: [],
      reviewSummaryBoundary: null,
      reviewDomSummary: null,
      reviewDomDiagnostic: null,
      staleReviewSummaryBoundary: null,
      staleReviewDomSummary: null,
      staleReviewDomDiagnostic: null,
      staleReviewSummaryObservations: [],
      storeSsrInspection: null,
      storeBoundary: null,
      storeDom: null,
      storeDomDiagnostic: null,
      staleStoreBoundary: null,
      staleStoreDom: null,
      staleStoreDomDiagnostic: null,
      staleStoreObservations: [],
      refreshProductEnrichment: null,
      domReadyHandler: null,
      pollingLifecycle: null,
      dispose() {
        if (!runtime.active) return;
        runtime.active = false;
        if (runtime.domReadyHandler) document.removeEventListener('DOMContentLoaded', runtime.domReadyHandler);
        runtime.domReadyHandler = null;
        runtime.ui?.dispose?.();
        runtime.pollingLifecycle?.dispose();
      },
    };
    let synchronizeRuntimeLocation = () => runtime.product;
    const acceptProductData = (data, meta) => {
      if (!runtime.active) return;
      synchronizeRuntimeLocation();
      if (!isProductDataBoundToItem(data, runtime.itemId, meta)) return;
      try {
        const normalized = normalizeProduct(data, location.href, { title: document.title.replace(/\s*\|\s*AliExpress.*$/i, ''), source: meta.source });
        const previousProduct = runtime.product;
        runtime.product = carryProductSections(normalized, previousProduct);
        runtime.product = applyCachedDelivery(runtime.product, runtime.deliveryCache, runtime.shippingEnvironment);
        if (runtime.shippingCapture && !shippingCaptureMatchesProduct(runtime.shippingCapture, runtime.product)) {
          runtime.shippingCapture = null;
          runtime.ui?.setShippingCapture(null);
        }
        runtime.ui?.setProduct(runtime.product);
      } catch (error) {
        runtime.ui?.setStatus(`productData found but normalization failed: ${error.message}`, true);
      }
    };

    installProductDataInterceptor(pageWindow, acceptProductData);
    installShippingCalculateInterceptor(pageWindow, (capture) => {
      if (!runtime.active) return;
      synchronizeRuntimeLocation();
      const inspection = inspectDeliveryCapture(capture.request, capture.response, runtime.itemId);
      const delivery = inspection.normalized;
      if (delivery.productId !== runtime.itemId) return;
      if (inspection.matched) {
        cacheDeliveryEntry(runtime.deliveryCache, capture.request, delivery, inspection.diagnostic);
      }
      const matchesSelectedSku = inspection.matched
        && (!runtime.product || delivery.skuId === runtime.product.selectedSkuId);
      if (matchesSelectedSku) {
        runtime.shippingCapture = capture;
        runtime.ui?.setShippingCapture(capture);
        runtime.shippingEnvironment = createShippingEnvironment(capture.request, delivery);
      }
      if (runtime.product && matchesSelectedSku) {
        runtime.product = applyCachedDelivery(runtime.product, runtime.deliveryCache, runtime.shippingEnvironment);
        runtime.ui?.setProduct(runtime.product);
      }
    });

    const mount = () => {
      if (!runtime.active || !document.body || document.getElementById('ali-helper-host')) return;
      runtime.domReadyHandler = null;
      runtime.ui = createPanel(runtime);
      if (runtime.product) runtime.ui.setProduct(runtime.product);
    };
    if (document.readyState === 'loading') {
      runtime.domReadyHandler = mount;
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    }
    else mount();

    let attempts = 0;
    synchronizeRuntimeLocation = () => {
      if (location.href === runtime.lastUrl) return runtime.product;
      const previousUrl = runtime.lastUrl;
      runtime.lastUrl = location.href;
      const nextItemId = getItemId(location.href);
      if (nextItemId !== runtime.itemId) {
        const staleDom = snapshotStaleDomObservations(runtime, document, runtime.itemId, previousUrl);
        runtime.staleCharacteristicsBoundary = staleDom.characteristics.boundary;
        runtime.staleCharacteristics = staleDom.characteristics.value;
        runtime.staleCharacteristicsDiagnostic = staleDom.characteristics.diagnostic;
        runtime.staleCharacteristicsObservations = staleDom.characteristics.history;
        runtime.characteristicsBoundary = null;
        runtime.characteristics = [];
        runtime.characteristicsDiagnostic = null;
        runtime.staleDescriptionBoundary = staleDom.description.boundary;
        runtime.staleDescription = staleDom.description.value;
        runtime.staleDescriptionDiagnostic = staleDom.description.diagnostic;
        runtime.staleDescriptionObservations = staleDom.description.history;
        runtime.descriptionBoundary = null;
        runtime.description = null;
        runtime.descriptionDiagnostic = null;
        runtime.ssrInspectionCache = null;
        runtime.gallerySsrInspection = null;
        runtime.staleRatingBoundary = staleDom.rating.boundary;
        runtime.staleRatingDomSummary = staleDom.rating.value;
        runtime.staleRatingDomDiagnostic = staleDom.rating.diagnostic;
        runtime.staleRatingObservations = staleDom.rating.history;
        runtime.ratingBoundary = null;
        runtime.ratingDomSummary = null;
        runtime.ratingDomDiagnostic = null;
        runtime.ratingSsrInspection = null;
        runtime.staleReviewSummaryBoundary = staleDom.review.boundary;
        runtime.staleReviewDomSummary = staleDom.review.value;
        runtime.staleReviewDomDiagnostic = staleDom.review.diagnostic;
        runtime.staleReviewSummaryObservations = staleDom.review.history;
        runtime.reviewSummaryBoundary = null;
        runtime.reviewDomSummary = null;
        runtime.reviewDomDiagnostic = null;
        runtime.storeSsrInspection = null;
        runtime.staleStoreBoundary = staleDom.store.boundary;
        runtime.staleStoreDom = staleDom.store.value;
        runtime.staleStoreDomDiagnostic = staleDom.store.diagnostic;
        runtime.staleStoreObservations = staleDom.store.history;
        runtime.storeBoundary = null;
        runtime.storeDom = null;
        runtime.storeDomDiagnostic = null;
        runtime.itemId = nextItemId;
        runtime.product = null;
        runtime.shippingCapture = null;
        runtime.ui?.setShippingCapture(null);
        runtime.ui?.setStatus('Product changed; waiting for productData…');
        return runtime.product;
      }
      if (runtime.product) {
        const updatedProduct = synchronizeProductPageContext(
          runtime.product,
          location.href,
          runtime.deliveryCache,
          runtime.shippingEnvironment,
        );
        if (updatedProduct !== runtime.product) {
          runtime.product = updatedProduct;
          if (runtime.shippingCapture && !shippingCaptureMatchesProduct(runtime.shippingCapture, runtime.product)) {
            runtime.shippingCapture = null;
            runtime.ui?.setShippingCapture(null);
          }
          runtime.ui?.setProduct(runtime.product);
        }
      }
      return runtime.product;
    };

    const refreshProductEnrichment = () => {
      if (!runtime.active) return runtime.product;
      synchronizeRuntimeLocation();
      if (!runtime.product) return runtime.product;
      const ssrScript = runtime.itemId === runtime.initialItemId
        ? document.querySelector('#__AER_DATA__')
        : null;
      if (runtime.itemId === runtime.initialItemId) {
        runtime.ssrInspectionCache = refreshSsrInspectionCache(
          runtime.ssrInspectionCache,
          runtime.itemId,
          ssrScript,
          {
            rating: inspectRatingInSsr,
            gallery: inspectGalleryInSsr,
            store: inspectStoreInSsr,
          },
        );
        runtime.ratingSsrInspection = runtime.ssrInspectionCache.inspections.rating;
        runtime.gallerySsrInspection = runtime.ssrInspectionCache.inspections.gallery;
        runtime.storeSsrInspection = runtime.ssrInspectionCache.inspections.store;
      }

      const domRatingInspection = inspectBasicRatingFromDom(document);
      const ratingBoundary = domRatingInspection.boundary;
      const domRating = domRatingInspection.summary;
      const staleRating = matchesStaleSectionObservation(
        staleSectionObservationHistory(
          runtime,
          'staleRatingObservations',
          'staleRatingBoundary',
          'staleRatingDomSummary',
          'staleRatingDomDiagnostic',
        ),
        ratingBoundary,
        domRating,
        domRatingInspection.diagnostic,
        ratingSummariesEqual,
      );
      const currentDomRating = staleRating ? null : domRating;
      if (!staleRating && ratingBoundary) {
        runtime.ratingBoundary = ratingBoundary;
        runtime.ratingDomSummary = currentDomRating;
        runtime.ratingDomDiagnostic = domRatingInspection.diagnostic;
        runtime.staleRatingBoundary = null;
        runtime.staleRatingDomSummary = null;
        runtime.staleRatingDomDiagnostic = null;
      }

      const reviewDomInspection = inspectReviewSummaryFromDom(document);
      const reviewSummaryBoundary = reviewDomInspection.boundary;
      const reviewDomSummary = reviewDomInspection.summary;
      const staleReviewSummary = matchesStaleSectionObservation(
        staleSectionObservationHistory(
          runtime,
          'staleReviewSummaryObservations',
          'staleReviewSummaryBoundary',
          'staleReviewDomSummary',
          'staleReviewDomDiagnostic',
        ),
        reviewSummaryBoundary,
        reviewDomSummary,
        reviewDomInspection.diagnostic,
        ratingSummariesEqual,
      );
      const currentReviewDomSummary = staleReviewSummary ? null : reviewDomSummary;
      if (!staleReviewSummary && reviewSummaryBoundary) {
        runtime.reviewSummaryBoundary = reviewSummaryBoundary;
        runtime.reviewDomSummary = currentReviewDomSummary;
        runtime.reviewDomDiagnostic = reviewDomInspection.diagnostic;
        runtime.staleReviewSummaryBoundary = null;
        runtime.staleReviewDomSummary = null;
        runtime.staleReviewDomDiagnostic = null;
      }

      const domStoreInspection = inspectStoreFromDom(document, runtime.itemId, location.href);
      const storeBoundary = domStoreInspection.boundary;
      const domStore = domStoreInspection.store;
      const staleStore = matchesStaleSectionObservation(
        staleSectionObservationHistory(
          runtime,
          'staleStoreObservations',
          'staleStoreBoundary',
          'staleStoreDom',
          'staleStoreDomDiagnostic',
        ),
        storeBoundary,
        domStore,
        domStoreInspection.diagnostic,
        storesEqual,
      );
      const currentDomStore = staleStore || domStoreInspection.itemMismatch ? null : domStore;
      if (!staleStore && !domStoreInspection.itemMismatch && storeBoundary) {
        runtime.storeBoundary = storeBoundary;
        runtime.storeDom = currentDomStore;
        runtime.storeDomDiagnostic = domStoreInspection.diagnostic;
        runtime.staleStoreBoundary = null;
        runtime.staleStoreDom = null;
        runtime.staleStoreDomDiagnostic = null;
      }

      const characteristicsInspection = inspectCharacteristicsFromDom(document);
      const characteristicsBoundary = characteristicsInspection.boundary;
      const characteristics = characteristicsInspection.characteristics;
      const staleCharacteristics = matchesStaleSectionObservation(
        staleSectionObservationHistory(
          runtime,
          'staleCharacteristicsObservations',
          'staleCharacteristicsBoundary',
          'staleCharacteristics',
          'staleCharacteristicsDiagnostic',
        ),
        characteristicsBoundary,
        characteristics,
        characteristicsInspection.diagnostic,
        characteristicsEqual,
      );
      const currentCharacteristics = staleCharacteristics ? [] : characteristics;
      if (!staleCharacteristics && characteristicsBoundary) {
        runtime.characteristicsBoundary = characteristicsBoundary;
        runtime.characteristics = currentCharacteristics;
        runtime.characteristicsDiagnostic = characteristicsInspection.diagnostic;
        runtime.staleCharacteristicsBoundary = null;
        runtime.staleCharacteristics = [];
        runtime.staleCharacteristicsDiagnostic = null;
      }

      const descriptionInspection = inspectDescriptionFromDom(document, location.href);
      const descriptionBoundary = descriptionInspection.boundary;
      const description = descriptionInspection.description;
      const staleDescription = matchesStaleSectionObservation(
        staleSectionObservationHistory(
          runtime,
          'staleDescriptionObservations',
          'staleDescriptionBoundary',
          'staleDescription',
          'staleDescriptionDiagnostic',
        ),
        descriptionBoundary,
        description,
        descriptionInspection.diagnostic,
        descriptionsEqual,
      );
      const currentDescription = staleDescription ? null : description;
      if (!staleDescription && descriptionBoundary) {
        runtime.descriptionBoundary = descriptionBoundary;
        runtime.description = currentDescription;
        runtime.descriptionDiagnostic = descriptionInspection.diagnostic;
        runtime.staleDescriptionBoundary = null;
        runtime.staleDescription = null;
        runtime.staleDescriptionDiagnostic = null;
      }

      const updatedProduct = enrichProductFallbacks(runtime.product, {
        galleryInspection: runtime.itemId === runtime.initialItemId
          ? runtime.gallerySsrInspection
          : { value: null, diagnostic: null, observed: false },
        structuredRatingInspection: runtime.itemId === runtime.initialItemId
          ? runtime.ratingSsrInspection
          : { value: null, diagnostic: null, observed: false },
        domRatingInspection: staleRating
          ? { value: null, diagnostic: null, observed: false }
          : { value: runtime.ratingDomSummary, diagnostic: runtime.ratingDomDiagnostic, observed: true },
        reviewDomSummaryInspection: staleReviewSummary
          ? { value: null, diagnostic: null, observed: false }
          : { value: runtime.reviewDomSummary, diagnostic: runtime.reviewDomDiagnostic, observed: true },
        structuredStoreInspection: runtime.itemId === runtime.initialItemId
          ? runtime.storeSsrInspection
          : { value: null, diagnostic: null, observed: false },
        domStoreInspection: staleStore || domStoreInspection.itemMismatch
          ? { value: null, diagnostic: null, observed: false }
          : { value: runtime.storeDom, diagnostic: runtime.storeDomDiagnostic, observed: true },
        characteristicsInspection: staleCharacteristics
          ? { value: null, diagnostic: null, observed: false }
          : { value: runtime.characteristics, diagnostic: runtime.characteristicsDiagnostic, observed: true },
        descriptionInspection: staleDescription
          ? { value: null, diagnostic: null, observed: false }
          : { value: runtime.description, diagnostic: runtime.descriptionDiagnostic, observed: true },
      });
      if (updatedProduct !== runtime.product) {
        runtime.product = updatedProduct;
        runtime.ui?.setProduct(runtime.product);
      }
      return runtime.product;
    };
    runtime.refreshProductEnrichment = refreshProductEnrichment;

    const scanFallbacks = () => {
      if (!runtime.active) return;
      synchronizeRuntimeLocation();
      if (!runtime.product) {
        const found = findInSsrScripts() || findInReact();
        if (found) acceptProductData(found.data, found);
        else if (++attempts === 8) {
          runtime.ui?.setStatus('productData not found yet. Reload the page with Ali Helper enabled; SSR contains no SKU data.', true);
        }
      }
      refreshProductEnrichment();
    };
    runtime.pollingLifecycle = createProductPollingLifecycle(scanFallbacks);
    runtime.pollingLifecycle.start();
    return runtime;
  }

  function start() {
    const pageWindow = typeof unsafeWindow === 'object' && unsafeWindow ? unsafeWindow : window;
    if (isReviewsPage(location.href)) {
      return startPageRuntimeSingleton(pageWindow, 'reviews', () => startReviewsPage(pageWindow));
    }
    if (!isItemPage(location.href)) return null;
    const settings = loadSettings();
    if (settings.autoRedirectComToRu && /(^|\.)aliexpress\.com$/i.test(location.hostname)) {
      location.replace(normalizeItemUrl(location.href, 'ru').href);
      return null;
    }
    return startPageRuntimeSingleton(pageWindow, 'product', () => startProductPage(pageWindow, settings));
  }

  start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
