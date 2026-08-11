// ==UserScript==
// @name         Ali Helper
// @namespace    https://github.com/local/ali-helper
// @version      0.1.5
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

  const VERSION = '0.1.5';
  const SETTINGS_KEY = 'ali-helper:settings:v1';
  const CHARACTERISTICS_BOUNDARY_SELECTOR = '[class*="HazeProductCharacteristics__groupsContainerForSku"]';
  const CHARACTERISTICS_ITEM_SELECTOR = '[class*="HazeProductCharacteristics__itemForSku"]';
  const CHARACTERISTICS_NAME_SELECTOR = '[class*="ProductCharacteristicsItem__name__"]';
  const CHARACTERISTICS_VALUE_SELECTOR = '[class*="ProductCharacteristicsItem__value__"]';
  const DESCRIPTION_BOUNDARY_SELECTOR = '#content_anchor';
  const DESCRIPTION_IGNORED_TAGS = new Set(['script', 'style', 'noscript', 'template']);
  const DESCRIPTION_BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'dt', 'dd',
    'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hr', 'li', 'main', 'nav',
    'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
    'thead', 'tr', 'ul',
  ]);
  const DEFAULT_SETTINGS = Object.freeze({
    autoRedirectComToRu: true,
    panelCollapsed: false,
  });

  const TRACKING_PARAM_NAMES = new Set([
    'spm', 'scm', 'pvid', 'algo_exp_id', 'pdp_npi', 'gps-id', 'ws_ab_test',
    'aff_fcid', 'aff_fsk', 'aff_platform', 'aff_trace_key', 'aff_short_key',
    'affiliate_id', 'affiliate_key', 'terminal_id', 'af', 'afsmartredirect',
    'srcsns', 'spreadtype', 'biztype', 'social_params', 'gatewayadapt',
  ]);

  function asString(value) {
    return value === null || value === undefined ? null : String(value);
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
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

  function isTrackingParam(name) {
    const normalized = name.toLowerCase();
    return normalized.startsWith('utm_') || TRACKING_PARAM_NAMES.has(normalized);
  }

  function normalizeItemUrl(input, targetMarket) {
    const url = input instanceof URL ? new URL(input.href) : new URL(input);
    const itemId = getItemId(url);
    if (!itemId) throw new Error('URL is not an AliExpress item page');

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

  function normalizeDelivery(request, response) {
    const shippingRequest = request && typeof request === 'object' ? request : {};
    const shippingResponse = response && typeof response === 'object' ? response : {};
    const destination = shippingResponse.to && typeof shippingResponse.to === 'object' ? shippingResponse.to : {};
    return {
      productId: asString(firstDefined(shippingRequest.productIdV2, shippingRequest.productId)),
      skuId: asString(shippingRequest.skuId),
      destination: {
        countryCode: asString(firstDefined(destination.country, destination.countryCode, shippingRequest.country)),
        countryName: asString(destination.countryName),
        regionCode: asString(firstDefined(destination.region, destination.regionCode, shippingRequest.provinceCode)),
        regionName: asString(destination.regionName),
        cityCode: asString(firstDefined(destination.city, destination.cityCode, shippingRequest.cityCode)),
        cityName: asString(destination.cityName),
      },
      displayMultipleMethods: optionalBoolean(shippingResponse.displayMultipleMethods),
      methods: (Array.isArray(shippingResponse.methods) ? shippingResponse.methods : []).map((method) => ({
        groupName: asString(method?.groupName),
        serviceName: asString(method?.serviceName),
        service: asString(method?.service),
        cost: normalizeMoney(method?.amount),
        etaStartDate: asString(method?.etaStartDeliveryDate),
        etaEndDate: asString(method?.etaEndDeliveryDate),
        dateDisplay: asString(method?.dateDisplay),
        dateFormat: asString(method?.dateFormat),
        tracking: optionalBoolean(method?.tracking),
        serviceGroupType: asString(method?.serviceGroupType),
        passportRequired: optionalBoolean(method?.passportRequired),
      })),
    };
  }

  function shippingRequestContext(request = {}) {
    return {
      productId: asString(firstDefined(request.productIdV2, request.productId)),
      skuId: asString(request.skuId),
      tradeCurrency: asString(request.tradeCurrency),
      count: asString(request.count),
      buyerPrice: asString(request.buyerPrice),
      minPrice: asString(request.minPrice),
      maxPrice: asString(request.maxPrice),
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

  function cacheDelivery(cache, request, delivery) {
    if (!cache || !delivery?.productId || !delivery?.skuId) return null;
    const contextKey = createShippingContextKey(request, delivery);
    const skuKey = productSkuKey(delivery.productId, delivery.skuId);
    const contextKeys = cache.contextKeysBySku.get(skuKey) || [];
    const previousIndex = contextKeys.indexOf(contextKey);
    if (previousIndex !== -1) contextKeys.splice(previousIndex, 1);
    contextKeys.push(contextKey);
    cache.contextKeysBySku.set(skuKey, contextKeys);
    cache.byContext.set(contextKey, {
      delivery,
      environment: createShippingEnvironment(request, delivery),
      price: shippingPriceContext(request),
    });
    return contextKey;
  }

  function contextsEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function getCachedDelivery(cache, productId, skuId, environment, price) {
    if (!cache || !productId || !skuId || !environment) return null;
    const contextKeys = cache.contextKeysBySku.get(productSkuKey(productId, skuId)) || [];
    for (let index = contextKeys.length - 1; index >= 0; index -= 1) {
      const entry = cache.byContext.get(contextKeys[index]);
      if (entry
        && contextsEqual(entry.environment, environment)
        && contextsEqual(entry.price, price)) return entry.delivery;
    }
    return null;
  }

  function selectedSkuShippingPriceContext(product) {
    const currentPrice = asString(product?.selectedSku?.price?.current?.value);
    return {
      buyerPrice: asString(product?.selectedSku?.buyerPriceForLogistic),
      minPrice: currentPrice,
      maxPrice: currentPrice,
    };
  }

  function applyCachedDelivery(product, cache, environment) {
    if (!product) return product;
    const delivery = getCachedDelivery(
      cache,
      product.itemId,
      product.selectedSkuId,
      environment,
      selectedSkuShippingPriceContext(product),
    );
    return product.delivery === delivery ? product : { ...product, delivery };
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

  function normalizeSizeGuide(sizeData) {
    if (!sizeData) return null;
    const tables = [];
    const seen = new WeakSet();
    function walk(value, unit, depth) {
      if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) return;
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
    return { tables, raw: sizeData };
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

  function extractCharacteristicsFromDom(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return [];
    const boundaries = Array.from(rootNode.querySelectorAll(CHARACTERISTICS_BOUNDARY_SELECTOR));
    if (typeof rootNode.matches === 'function' && rootNode.matches(CHARACTERISTICS_BOUNDARY_SELECTOR)) boundaries.unshift(rootNode);
    const rows = boundaries.flatMap((boundary) => Array.from(boundary.querySelectorAll(CHARACTERISTICS_ITEM_SELECTOR)).map((item) => {
      const nameElement = item.querySelector(CHARACTERISTICS_NAME_SELECTOR);
      const valueElement = item.querySelector(CHARACTERISTICS_VALUE_SELECTOR);
      return {
        name: nameElement?.innerText ?? nameElement?.textContent,
        value: valueElement?.innerText ?? valueElement?.textContent,
      };
    }));
    return normalizeCharacteristics(rows);
  }

  function characteristicsEqual(left, right) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((row, index) => row.name === right[index]?.name && row.value === right[index]?.value);
  }

  function updateCharacteristics(product, rows) {
    if (!product) return product;
    const characteristics = normalizeCharacteristics(rows);
    if (!characteristics.length || characteristicsEqual(product.characteristics, characteristics)) return product;
    return { ...product, characteristics };
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

  function extractDescriptionFromDom(rootNode, pageUrl) {
    const boundary = findDescriptionBoundary(rootNode);
    if (!boundary) return null;
    const rawHtml = typeof boundary.innerHTML === 'string' ? boundary.innerHTML : '';
    return buildDescription('dom', rawHtml, parseDescriptionBlocks(boundary, pageUrl));
  }

  function descriptionsEqual(left, right) {
    return Boolean(left && right && left.source === right.source && left.rawHtml === right.rawHtml);
  }

  function updateDescription(product, description) {
    if (!product || !description || descriptionsEqual(product.description, description)) return product;
    return { ...product, description };
  }

  function isStaleDescription(boundary, description, staleBoundary, staleDescription) {
    return Boolean(boundary && boundary === staleBoundary && descriptionsEqual(description, staleDescription));
  }

  function findProductDataCandidate(rootValue, limits = {}) {
    const maxDepth = limits.maxDepth || 30;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const stack = [{ value: rootValue, depth: 0, path: '$' }];
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value) || current.depth > maxDepth) continue;
      seen.add(value);
      visited += 1;
      const skuInfo = value.skuInfo;
      if (skuInfo && Array.isArray(skuInfo.propertyList) && Array.isArray(skuInfo.priceList)) {
        return { data: value, path: current.path };
      }
      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1, path: `${current.path}.${key}` });
      }
    }
    return null;
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
    return {
      itemId,
      title: asString(firstDefined(productData.title, productData.name, productData.productInfo?.title, fallbacks.title)),
      url: url.href,
      selectedSkuId,
      gallery: [],
      price: selectedSku?.price || null,
      ratingSummary: null,
      variantGroups,
      skus,
      selectedSku,
      sizeGuide: normalizeSizeGuide(productData.skuInfo.sizeData),
      characteristics: normalizeCharacteristics(fallbacks.characteristics),
      description: null,
      delivery: null,
      store: null,
      reviews: [],
      _meta: {
        source: fallbacks.source || 'productData',
        activeSkuId,
        selectedSkuResolved: Boolean(selectedSku),
      },
    };
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
    if (!requestedSkuId || requestedSkuId === product.selectedSkuId) return product;
    const selectedSku = product.skus.find((sku) => sku.skuId === requestedSkuId);
    if (!selectedSku) return product;
    // Delivery is SKU-specific; runtime may reapply only the new SKU's cache entry.
    return {
      ...product,
      url: normalizeItemUrl(pageUrl).href,
      selectedSkuId: requestedSkuId,
      selectedSku,
      price: selectedSku.price,
      delivery: null,
      _meta: {
        ...product._meta,
        selectedSkuResolved: true,
      },
    };
  }

  function formatMoney(money) {
    if (!money) return '—';
    return money.formatted || [money.value, money.currency].filter(Boolean).join(' ') || '—';
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

  function formatProductStatus(product) {
    const combinationCount = product.skus.length;
    const combinationLabel = combinationCount === 1 ? 'combination' : 'combinations';
    const groups = product.variantGroups.map((group) => `${group.name}: ${group.values.length}`).join(', ');
    return `Ready · ${combinationCount} ${combinationLabel} · ${groups || 'no variant groups'} · source: ${formatSourceLabel(product._meta.source)}`;
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
    return JSON.stringify(product, null, 2);
  }

  function exportForChatGPT(product) {
    const selected = product.selectedSku;
    const prices = product.skus.map((sku) => sku.price.current?.value).filter(Boolean);
    const priceSummary = selected ? formatMoney(selected.price.current) : [...new Set(prices)].slice(0, 5).join(' – ') || '—';
    return [
      'ALIEXPRESS PRODUCT',
      '',
      `Title: ${product.title || '—'}`,
      `URL: ${product.url}`,
      `Item ID: ${product.itemId}`,
      '',
      `Selected SKU: ${product.selectedSkuId || '—'}${selected ? '' : ' (not resolved)'}`,
      `Selected variants: ${formatSelections(selected)}`,
      '',
      `Price: ${priceSummary}`,
      `Regular price: ${formatMoney(selected?.price.regular)}`,
      `Stock: ${selected?.stock ?? '—'}`,
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
      'DESCRIPTION:',
      formatDescription(product.description),
    ].join('\n');
  }

  const AliHelperCore = {
    VERSION,
    DEFAULT_SETTINGS,
    isItemPage,
    getItemId,
    isTrackingParam,
    normalizeItemUrl,
    toggleMarketUrl,
    splitSkuPropIds,
    normalizeMoney,
    normalizeDelivery,
    createShippingContextKey,
    createShippingEnvironment,
    createDeliveryCache,
    cacheDelivery,
    getCachedDelivery,
    applyCachedDelivery,
    normalizeVariantGroups,
    normalizeSkus,
    normalizeSizeGuide,
    normalizeCharacteristics,
    extractCharacteristicsFromDom,
    updateCharacteristics,
    normalizeDescriptionUrl,
    findDescriptionBoundary,
    parseDescriptionBlocks,
    buildDescription,
    extractDescriptionFromDom,
    descriptionsEqual,
    updateDescription,
    isStaleDescription,
    findProductDataCandidate,
    normalizeProduct,
    updateSelectedSku,
    exportProduct,
    exportVariants,
    exportForChatGPT,
    formatSelections,
    formatSourceLabel,
    formatProductStatus,
    formatDelivery,
    formatDescription,
    isShippingCalculateUrl,
    redactSensitiveJson,
    createShippingDebugCapture,
  };

  if (typeof module === 'object' && module.exports) module.exports = AliHelperCore;
  if (root) root.AliHelperCore = AliHelperCore;

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...(GM_getValue(SETTINGS_KEY, {}) || {}) };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
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

  function installProductDataInterceptor(pageWindow, onData) {
    const flag = '__aliHelperProductDataInterceptorV1__';
    if (!pageWindow || pageWindow[flag]) return;
    pageWindow[flag] = true;
    const matches = (input) => {
      try {
        const value = typeof input === 'string' ? input : input?.url;
        return /\/productData(?:[/?]|$)/i.test(new URL(value, location.href).pathname);
      } catch (_) { return false; }
    };
    const accept = (payload, sourceUrl) => {
      const found = findProductDataCandidate(payload);
      if (found) onData(found.data, { source: 'network:productData', sourceUrl, path: found.path });
    };

    if (typeof pageWindow.fetch === 'function') {
      const originalFetch = pageWindow.fetch;
      pageWindow.fetch = function aliHelperFetch(...args) {
        const result = originalFetch.apply(this, args);
        if (matches(args[0])) {
          result.then((response) => response.clone().json())
            .then((json) => accept(json, typeof args[0] === 'string' ? args[0] : args[0]?.url))
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
        return originalOpen.call(this, method, url, ...rest);
      };
      XHR.prototype.send = function aliHelperSend(...args) {
        if (this.__aliHelperProductDataUrl) {
          this.addEventListener('loadend', () => {
            try {
              const json = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
              accept(json, this.__aliHelperProductDataUrl);
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

  function createPanel(runtime) {
    const host = document.createElement('div');
    host.id = 'ali-helper-host';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { width: 320px; max-width: calc(100vw - 24px); color: #191919; background: #fff; border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.22); font: 13px/1.35 Arial,sans-serif; overflow: hidden; }
        header { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#ffefe8; }
        strong { flex:1; font-size:14px; }
        .body { padding:10px; max-height:min(65vh,560px); overflow:auto; }
        .panel.collapsed .body { display:none; }
        button { border:1px solid #d7d7d7; border-radius:8px; background:#fff; color:#222; padding:7px 9px; cursor:pointer; font:inherit; }
        button:hover { background:#f7f7f7; } button:disabled { opacity:.45; cursor:not-allowed; }
        .icon { padding:4px 8px; }
        .grid { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
        .wide { grid-column:1/-1; }
        .status { margin:0 0 9px; padding:7px 8px; border-radius:7px; background:#f5f5f5; overflow-wrap:anywhere; }
        .status.error { color:#8a1f11; background:#fff0ed; }
        details { margin-top:9px; border-top:1px solid #eee; padding-top:8px; }
        summary { cursor:pointer; } label { display:flex; gap:7px; margin-top:8px; }
        .diagnostic { width:100%; margin-top:9px; }
        .meta { color:#666; margin-top:8px; font-size:11px; }
      </style>
      <section class="panel">
        <header><strong>Ali Helper</strong><button class="icon" data-action="toggle" title="Collapse/expand">—</button></header>
        <div class="body">
          <div class="status">Waiting for productData…</div>
          <div class="grid">
            <button data-action="clean-url">Copy clean URL</button>
            <button data-action="market">RU / COM</button>
            <button data-action="product" disabled>Copy product</button>
            <button data-action="variants" disabled>Copy variants</button>
            <button class="wide" data-action="chatgpt" disabled>Copy for ChatGPT</button>
          </div>
          <details>
            <summary>Settings</summary>
            <label><input type="checkbox" data-setting="autoRedirectComToRu"> Auto redirect COM → RU</label>
            <button class="diagnostic" data-action="shipping-debug" disabled>Copy shipping debug</button>
          </details>
          <div class="meta">Read/copy/navigation only · v${VERSION}</div>
        </div>
      </section>`;
    (document.body || document.documentElement).appendChild(host);

    const panel = shadow.querySelector('.panel');
    const status = shadow.querySelector('.status');
    const productButtons = ['product', 'variants', 'chatgpt'].map((name) => shadow.querySelector(`[data-action="${name}"]`));
    const autoRedirect = shadow.querySelector('[data-setting="autoRedirectComToRu"]');
    const shippingDebug = shadow.querySelector('[data-action="shipping-debug"]');
    autoRedirect.checked = runtime.settings.autoRedirectComToRu;
    shippingDebug.disabled = !runtime.shippingCapture;
    panel.classList.toggle('collapsed', runtime.settings.panelCollapsed);
    shadow.querySelector('[data-action="toggle"]').textContent = runtime.settings.panelCollapsed ? '+' : '—';

    function flash(message, isError = false) {
      status.textContent = message;
      status.classList.toggle('error', isError);
    }
    async function copyWithFeedback(text, label) {
      try { await copyText(text); flash(`${label} copied.`); } catch (error) { flash(`Copy failed: ${error.message}`, true); }
    }
    shadow.addEventListener('click', (event) => {
      const action = event.target?.dataset?.action;
      if (!action) return;
      if (action === 'toggle') {
        runtime.settings.panelCollapsed = !runtime.settings.panelCollapsed;
        panel.classList.toggle('collapsed', runtime.settings.panelCollapsed);
        event.target.textContent = runtime.settings.panelCollapsed ? '+' : '—';
        saveSettings(runtime.settings);
      } else if (action === 'clean-url') {
        copyWithFeedback(normalizeItemUrl(location.href).href, 'Clean URL');
      } else if (action === 'market') {
        location.assign(toggleMarketUrl(location.href).href);
      } else if (action === 'product' && runtime.product) {
        copyWithFeedback(exportProduct(runtime.product), 'Product JSON');
      } else if (action === 'variants' && runtime.product) {
        copyWithFeedback(exportVariants(runtime.product), 'Variants');
      } else if (action === 'chatgpt' && runtime.product) {
        copyWithFeedback(exportForChatGPT(runtime.product), 'Product');
      } else if (action === 'shipping-debug' && runtime.shippingCapture) {
        copyWithFeedback(JSON.stringify(runtime.shippingCapture, null, 2), 'Shipping debug');
      }
    });
    autoRedirect.addEventListener('change', () => {
      runtime.settings.autoRedirectComToRu = autoRedirect.checked;
      saveSettings(runtime.settings);
      flash('Settings saved.');
    });
    return {
      setProduct(product) {
        productButtons.forEach((button) => { button.disabled = false; });
        flash(formatProductStatus(product));
      },
      setShippingCapture(capture) {
        shippingDebug.disabled = !capture;
      },
      setStatus: flash,
    };
  }

  function start() {
    if (!isItemPage(location.href)) return;
    const settings = loadSettings();
    if (settings.autoRedirectComToRu && /(^|\.)aliexpress\.com$/i.test(location.hostname)) {
      location.replace(normalizeItemUrl(location.href, 'ru').href);
      return;
    }

    const runtime = {
      settings,
      product: null,
      shippingCapture: null,
      shippingEnvironment: null,
      deliveryCache: createDeliveryCache(),
      itemId: getItemId(location.href),
      ui: null,
      lastUrl: location.href,
      characteristicsBoundary: null,
      staleCharacteristicsBoundary: null,
      staleCharacteristics: [],
      descriptionBoundary: null,
      staleDescriptionBoundary: null,
      staleDescription: null,
    };
    const acceptProductData = (data, meta) => {
      const dataItemId = asString(firstDefined(data.productId, data.itemId, data.id, runtime.itemId));
      if (dataItemId !== runtime.itemId) return;
      try {
        const normalized = normalizeProduct(data, location.href, { title: document.title.replace(/\s*\|\s*AliExpress.*$/i, ''), source: meta.source });
        const previousProduct = runtime.product;
        runtime.product = updateCharacteristics(normalized, previousProduct?.characteristics);
        runtime.product = updateDescription(runtime.product, previousProduct?.description);
        runtime.product = applyCachedDelivery(runtime.product, runtime.deliveryCache, runtime.shippingEnvironment);
        runtime.ui?.setProduct(runtime.product);
      } catch (error) {
        runtime.ui?.setStatus(`productData found but normalization failed: ${error.message}`, true);
      }
    };

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    installProductDataInterceptor(pageWindow, acceptProductData);
    installShippingCalculateInterceptor(pageWindow, (capture) => {
      const delivery = normalizeDelivery(capture.request, capture.response);
      if (delivery.productId !== runtime.itemId) return;
      runtime.shippingCapture = capture;
      runtime.ui?.setShippingCapture(capture);
      runtime.shippingEnvironment = createShippingEnvironment(capture.request, delivery);
      cacheDelivery(runtime.deliveryCache, capture.request, delivery);
      if (runtime.product
        && delivery.productId === runtime.product.itemId
        && delivery.skuId === runtime.product.selectedSkuId) {
        runtime.product = applyCachedDelivery(runtime.product, runtime.deliveryCache, runtime.shippingEnvironment);
        runtime.ui?.setProduct(runtime.product);
      }
    });

    const mount = () => {
      if (!document.body || document.getElementById('ali-helper-host')) return;
      runtime.ui = createPanel(runtime);
      if (runtime.product) runtime.ui.setProduct(runtime.product);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();

    let attempts = 0;
    const scanFallbacks = () => {
      if (location.href !== runtime.lastUrl) {
        runtime.lastUrl = location.href;
        const nextItemId = getItemId(location.href);
        if (nextItemId !== runtime.itemId) {
          runtime.staleCharacteristicsBoundary = runtime.characteristicsBoundary;
          runtime.staleCharacteristics = runtime.product?.characteristics || [];
          runtime.characteristicsBoundary = null;
          runtime.staleDescriptionBoundary = runtime.descriptionBoundary;
          runtime.staleDescription = runtime.product?.description || null;
          runtime.descriptionBoundary = null;
          runtime.itemId = nextItemId;
          runtime.product = null;
          runtime.shippingCapture = null;
          runtime.ui?.setShippingCapture(null);
          runtime.ui?.setStatus('Product changed; waiting for productData…');
        } else if (runtime.product) {
          const updatedProduct = updateSelectedSku(runtime.product, location.href);
          if (updatedProduct !== runtime.product) {
            runtime.product = applyCachedDelivery(updatedProduct, runtime.deliveryCache, runtime.shippingEnvironment);
            runtime.ui?.setProduct(runtime.product);
          }
        }
      }
      if (!runtime.product) {
        const found = findInSsrScripts() || findInReact();
        if (found) acceptProductData(found.data, found);
        else if (++attempts === 8) runtime.ui?.setStatus('productData not found yet. Reload the page with Ali Helper enabled; SSR contains no SKU data.', true);
      }
      if (runtime.product) {
        let updatedProduct = runtime.product;
        const boundary = findCharacteristicsBoundary(document);
        const characteristics = extractCharacteristicsFromDom(document);
        const stillShowsPreviousItem = boundary
          && boundary === runtime.staleCharacteristicsBoundary
          && characteristicsEqual(characteristics, runtime.staleCharacteristics);
        if (!stillShowsPreviousItem) {
          updatedProduct = updateCharacteristics(updatedProduct, characteristics);
          if (characteristics.length) {
            runtime.characteristicsBoundary = boundary;
            runtime.staleCharacteristicsBoundary = null;
            runtime.staleCharacteristics = [];
          }
        }

        const descriptionBoundary = findDescriptionBoundary(document);
        const description = extractDescriptionFromDom(document, location.href);
        if (!isStaleDescription(
          descriptionBoundary,
          description,
          runtime.staleDescriptionBoundary,
          runtime.staleDescription,
        )) {
          updatedProduct = updateDescription(updatedProduct, description);
          if (description) {
            runtime.descriptionBoundary = descriptionBoundary;
            runtime.staleDescriptionBoundary = null;
            runtime.staleDescription = null;
          }
        }

        if (updatedProduct !== runtime.product) {
          runtime.product = updatedProduct;
          runtime.ui?.setProduct(runtime.product);
        }
      }
    };
    setInterval(scanFallbacks, 1000);
    scanFallbacks();
  }

  start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
