// ==UserScript==
// @name         Ali Helper
// @namespace    https://github.com/local/ali-helper
// @version      0.1.13
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

  const VERSION = '0.1.13';
  const SETTINGS_KEY = 'ali-helper:settings:v1';
  const NATIVE_REVIEW_PATHNAME = '/aer-jsonapi/review/v5/desktop/product-reviews';
  const REVIEW_CAPTURE_CAP = 30;
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

  function extractGalleryFromSsrData(rootValue, expectedItemId, limits = {}) {
    const itemId = asString(expectedItemId);
    if (!itemId) return null;
    const maxDepth = limits.maxDepth || 40;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const stack = [{ value: rootValue, depth: 0 }];
    const candidates = [];
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value) || current.depth > maxDepth) continue;
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value) && value.props && typeof value.props === 'object') {
        const props = value.props;
        if (asString(props.id) === itemId && Array.isArray(props.gallery)) {
          candidates.push(normalizeGallery(props.gallery, 'ssr:__AER_DATA__'));
        }
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    if (!candidates.length) return null;
    const first = candidates[0];
    return candidates.every((candidate) => galleriesEqual(first, candidate)) ? first : null;
  }

  function updateGallery(product, gallery) {
    if (!product || !gallery || galleriesEqual(product.gallery, gallery)) return product;
    return { ...product, gallery };
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
      cap,
      activeContextKey: null,
      activeSequence: 0,
      nextSequence: 0,
      contexts: new Map(),
    };
  }

  function reviewEntry(context) {
    return {
      context,
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
    const entry = currentEntry ? { ...currentEntry, pages: new Map(currentEntry.pages) } : reviewEntry(canonical);
    if (hasExisting) {
      entry.diagnostic = 'page-conflict';
    } else if (isReviewPageWithinCaptureCap(pageNum, canonical.pageSize, cache.cap)) entry.pages.set(pageNum, reviews);
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
      captureCap: cache.cap,
      captureCapReached: entry.ignoredBeyondCap || retainedCount >= cache.cap,
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
      return `Reviews ready · ${reviewPage.loadedCount} first-page reviews · source: SSR`;
    }
    const labels = formatReviewContext(reviewPage.context);
    const pages = reviewPage.pagesLoaded;
    const contiguous = pages.length > 1 && pages.every((page, index) => page === index + 1);
    if (contiguous) labels.unshift(`pages 1–${pages.at(-1)}`);
    else if (pages.length) labels.unshift(`pages ${pages.join(', ')}`);
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

  function containsExpectedStoreItem(rootValue, expectedItemId, limits = {}) {
    const itemId = asString(expectedItemId);
    if (!rootValue || !itemId) return false;
    const maxDepth = limits.maxDepth || 12;
    const maxVisited = limits.maxVisited || 3000;
    const seen = new WeakSet();
    const stack = [{ value: rootValue, depth: 0 }];
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value) || current.depth > maxDepth) continue;
      seen.add(value);
      visited += 1;
      for (const [key, child] of Object.entries(value)) {
        if (/^item_?id$/i.test(key) && asString(child) === itemId) return true;
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    return false;
  }

  function subtitleValue(props, type) {
    const matches = (Array.isArray(props?.subtitles) ? props.subtitles : [])
      .filter((subtitle) => subtitle?.type === type)
      .map((subtitle) => normalizeHumanText(subtitle.value))
      .filter(Boolean);
    return matches.length === 1 ? matches[0] : null;
  }

  function storeFromSsrProps(props, expectedItemId) {
    if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
    if (hasMismatchedStoreChatItem(props.chatLink, expectedItemId)) return null;
    const chat = parseStoreChatLink(props.chatLink, expectedItemId);
    const analyticsMatched = containsExpectedStoreItem(props.analytics, expectedItemId);
    if (!chat && !analyticsMatched) return null;
    const subtitles = Array.isArray(props.subtitles) ? props.subtitles : [];
    const hasStoreEvidence = Boolean(chat)
      || Boolean(storeIdFromUrl(props.url))
      || Object.prototype.hasOwnProperty.call(props, 'positiveReviews')
      || Object.prototype.hasOwnProperty.call(props, 'subscribersCount')
      || subtitles.some((subtitle) => subtitle?.type === 0 || subtitle?.type === 1);
    if (!hasStoreEvidence) return null;
    const propsSellerId = decimalId(props.id);
    const sellerId = propsSellerId && chat?.sellerId && propsSellerId !== chat.sellerId
      ? null
      : propsSellerId || chat?.sellerId || null;
    const sellerDisplay = subtitleValue(props, 0);
    const subscriberDisplay = subtitleValue(props, 1);
    return normalizeStore({
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

  function extractStoreFromSsrData(rootValue, expectedItemId, limits = {}) {
    const itemId = asString(expectedItemId);
    if (!itemId) return null;
    const maxDepth = limits.maxDepth || 40;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const stack = [{ value: rootValue, depth: 0 }];
    const candidates = [];
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value) || current.depth > maxDepth) continue;
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value) && value.props && typeof value.props === 'object') {
        const candidate = storeFromSsrProps(value.props, itemId);
        if (candidate) candidates.push(candidate);
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    if (!candidates.length) return null;
    const first = candidates[0];
    return candidates.every((candidate) => storesEqual(first, candidate)) ? first : null;
  }

  function findStoreBoundary(rootNode) {
    if (!rootNode) return null;
    if (typeof rootNode.matches === 'function' && rootNode.matches(STORE_BOUNDARY_SELECTOR)) return rootNode;
    return typeof rootNode.querySelector === 'function' ? rootNode.querySelector(STORE_BOUNDARY_SELECTOR) : null;
  }

  function extractStoreFromDom(rootNode, expectedItemId, pageUrl) {
    const boundary = findStoreBoundary(rootNode);
    if (!boundary) return null;
    const header = boundary.querySelector?.(STORE_HEADER_SELECTOR);
    const chatButton = boundary.querySelector?.(STORE_CHAT_BUTTON_SELECTOR);
    const chatAnchor = chatButton?.closest?.('a[href]');
    const chatHref = chatAnchor?.getAttribute?.('href') || chatAnchor?.href || null;
    if (chatHref && !parseStoreChatLink(chatHref, expectedItemId, pageUrl)) return null;
    const chat = parseStoreChatLink(chatHref, expectedItemId, pageUrl);
    const title = header?.querySelector?.(STORE_TITLE_SELECTOR);
    const storeAnchor = title?.closest?.('a[href]') || header?.querySelector?.(STORE_HEADER_LINK_SELECTOR);
    const statTexts = Array.from(header?.querySelectorAll?.(STORE_STAT_SELECTOR) || [])
      .map((element) => normalizeHumanText(element?.innerText ?? element?.textContent))
      .filter(Boolean);
    const sellerRatingDisplay = statTexts.find((text) => /^\d+(?:[.,]\d+)?\s*%\s*seller's rating$/i.test(text)) || null;
    const subscribersDisplay = statTexts.find((text) => /^\d+(?:[.,]\d+)?\s*[Kk]?\+?\s+subscribers$/i.test(text)) || null;
    return normalizeStore({
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

  function updateStore(product, patch) {
    if (!product || !patch) return product;
    const next = mergeStore(patch, product.store);
    if (storesEqual(product.store, next)) return product;
    return { ...product, store: next };
  }

  function isStaleStore(boundary, store, staleBoundary, staleStore) {
    return Boolean(boundary && boundary === staleBoundary && storesEqual(store, staleStore));
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
    const maxDepth = limits.maxDepth || 50;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const stack = [{ value: rootValue, depth: 0 }];
    const results = [];
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value) || current.depth > maxDepth) continue;
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value) && predicate(value)) results.push(value);
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    return results;
  }

  function boundReviewTabsCandidate(widget, expectedItemId) {
    if (!widgetFamily(widget, 'bx/RedReviewsTabs/')) return null;
    const expected = asString(expectedItemId);
    if (!expected) return null;
    const events = widget.props?.analyticEvents;
    const trackingSignals = [
      events?.clickAllReviews?.trackingInfo,
      events?.viewWidgetReview?.trackingInfo,
    ].filter((signal) => signal && typeof signal === 'object');
    const itemIds = trackingSignals.map((signal) => asString(signal.itemId)).filter(Boolean);
    if (!itemIds.length || !itemIds.includes(expected) || itemIds.some((itemId) => itemId !== expected)) return null;

    const ratingInputs = trackingSignals
      .map((signal) => signal.overallRating)
      .filter((value) => value !== null && value !== undefined && value !== '');
    const ratings = ratingInputs.map(parseLocalizedRating);
    const uniqueRatings = [...new Set(ratings.filter((value) => value !== null))];
    if (ratings.some((value) => value === null) || uniqueRatings.length > 1) return null;
    return { rating: uniqueRatings[0] ?? null };
  }

  function resolveConsistentField(candidates, field) {
    const values = [...new Set(candidates.map((candidate) => candidate[field]).filter((value) => value !== null))];
    return values.length === 1 ? values[0] : null;
  }

  function extractReviewSummaryFromSsrData(rootValue, expectedItemId, limits = {}) {
    const contexts = collectObjectDescendants(
      rootValue,
      (value) => widgetFamily(value, 'bx/RedReviewsContextWidget/'),
      limits,
    );
    const candidates = [];
    for (const context of contexts) {
      const tabsWidgets = collectObjectDescendants(
        context,
        (value) => widgetFamily(value, 'bx/RedReviewsTabs/'),
        limits,
      );
      for (const tabs of tabsWidgets) {
        const binding = boundReviewTabsCandidate(tabs, expectedItemId);
        if (!binding) continue;
        const feedbackWidgets = collectObjectDescendants(
          tabs,
          (value) => widgetFamily(value, 'bx/RedReviewsProductFeedbackList/')
            && value.props?.placement === 'PDP',
          limits,
        );
        const totals = feedbackWidgets.map((widget) => {
          const params = widget.props?.resolveParams;
          const hasReviews = params && Object.prototype.hasOwnProperty.call(params, 'review.productReviewsCount');
          const hasFeedbacks = params && Object.prototype.hasOwnProperty.call(params, 'review.productFeedbacksCount');
          return {
            reviewCount: hasReviews ? parseLocalizedCount(params['review.productReviewsCount']) : null,
            contentFeedbackCount: hasFeedbacks ? parseLocalizedCount(params['review.productFeedbacksCount']) : null,
          };
        });
        candidates.push({
          rating: binding.rating,
          reviewCount: resolveConsistentField(totals, 'reviewCount'),
          contentFeedbackCount: resolveConsistentField(totals, 'contentFeedbackCount'),
        });
      }
    }
    if (!candidates.length) return null;
    const result = emptyRatingSummary();
    result.rating = resolveConsistentField(candidates, 'rating');
    result.reviewCount = resolveConsistentField(candidates, 'reviewCount');
    result.contentFeedbackCount = resolveConsistentField(candidates, 'contentFeedbackCount');
    return result.rating === null && result.reviewCount === null && result.contentFeedbackCount === null
      ? null
      : withRatingDiagnostics(result);
  }

  function primitiveRatingCandidate(props, expectedItemId) {
    if (!props || typeof props !== 'object') return null;
    const clickInfo = props.analyticEvents?.clickAllReviews?.trackingInfo;
    const viewInfo = props.analyticEvents?.viewWidgetReview?.trackingInfo;
    const itemIds = [clickInfo?.itemId, viewInfo?.itemId].map(asString).filter(Boolean);
    if (expectedItemId && itemIds.length && !itemIds.includes(asString(expectedItemId))) return null;

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
    return {
      rating,
      reviewCount: hasReviewCount ? parseLocalizedCount(resolveParams['review.productReviewsCount']) : null,
    };
  }

  function extractBasicRatingFromSsrData(rootValue, expectedItemId, limits = {}) {
    const maxDepth = limits.maxDepth || 40;
    const maxVisited = limits.maxVisited || 30000;
    const seen = new WeakSet();
    const stack = [{ value: rootValue, depth: 0 }];
    const candidates = [];
    let visited = 0;
    while (stack.length && visited < maxVisited) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== 'object' || seen.has(value) || current.depth > maxDepth) continue;
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value) && value.props && typeof value.props === 'object') {
        const candidate = primitiveRatingCandidate(value.props, expectedItemId);
        if (candidate && (candidate.rating !== null || candidate.reviewCount !== null)) candidates.push(candidate);
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    if (!candidates.length) return null;
    const coherent = candidates.filter((candidate) => candidate.rating !== null && candidate.reviewCount !== null);
    const pool = coherent.length ? coherent : candidates;
    const resolveField = (field) => {
      const values = [...new Set(pool.map((candidate) => candidate[field]).filter((value) => value !== null))];
      return values.length === 1 ? values[0] : null;
    };
    const result = emptyRatingSummary();
    result.rating = resolveField('rating');
    result.reviewCount = resolveField('reviewCount');
    return result.rating === null && result.reviewCount === null ? null : result;
  }

  function findProductHeaderBoundary(rootNode) {
    if (!rootNode) return null;
    const candidates = [];
    if (typeof rootNode.matches === 'function' && rootNode.matches(PRODUCT_HEADER_SELECTOR)) candidates.push(rootNode);
    if (typeof rootNode.querySelectorAll === 'function') candidates.push(...rootNode.querySelectorAll(PRODUCT_HEADER_SELECTOR));
    return candidates.find((candidate) => typeof candidate.querySelector === 'function' && candidate.querySelector('h1')) || null;
  }

  function extractBasicRatingFromDom(rootNode) {
    const boundary = findProductHeaderBoundary(rootNode);
    const extraInfo = boundary?.querySelector?.(PRODUCT_HEADER_INFO_SELECTOR);
    if (!extraInfo) return null;
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
    return result.rating === null && result.reviewCount === null && result.boughtCount === null ? null : result;
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

  function extractReviewSummaryFromDom(rootNode) {
    const boundary = findReviewSummaryBoundary(rootNode);
    if (!boundary) return null;
    const result = emptyRatingSummary();
    result.starDistribution = parseStarDistribution(boundary);
    const photos = extractBuyerPhotos(boundary);
    result.buyerPhotosCount = photos.value;
    result.display.buyerPhotosCount = photos.display;
    result.reviewTopics = extractReviewTopics(boundary);
    return result.starDistribution || result.buyerPhotosCount !== null || result.reviewTopics
      ? withRatingDiagnostics(result)
      : null;
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

  function updateRatingSummary(product, patch) {
    if (!product || !patch) return product;
    const previous = product.ratingSummary;
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
    if (ratingSummariesEqual(previous, diagnosed)) return product;
    return { ...product, ratingSummary: diagnosed };
  }

  function isStaleRatingSummary(boundary, summary, staleBoundary, staleSummary) {
    return Boolean(boundary && boundary === staleBoundary && ratingSummariesEqual(summary, staleSummary));
  }

  function enrichProductFallbacks(product, sources = {}) {
    let updatedProduct = product;
    updatedProduct = updateGallery(updatedProduct, sources.structuredGallery);
    updatedProduct = updateRatingSummary(
      updatedProduct,
      mergeRatingSummary(sources.structuredRating, sources.domRating, sources.reviewDomSummary),
    );
    updatedProduct = updateStore(updatedProduct, mergeStore(sources.structuredStore, sources.domStore));
    updatedProduct = updateCharacteristics(updatedProduct, sources.characteristics);
    updatedProduct = updateDescription(updatedProduct, sources.description);
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
      gallery: null,
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
    return JSON.stringify(product, null, 2);
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
    DEFAULT_SETTINGS,
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
    normalizeGallery,
    galleriesEqual,
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
    containsExpectedStoreItem,
    storeFromSsrProps,
    extractStoreFromSsrData,
    findStoreBoundary,
    extractStoreFromDom,
    mergeStore,
    storesEqual,
    updateStore,
    isStaleStore,
    extractReviewSummaryFromSsrData,
    extractBasicRatingFromSsrData,
    findProductHeaderBoundary,
    extractBasicRatingFromDom,
    findReviewSummaryBoundary,
    parseStarDistribution,
    extractBuyerPhotos,
    extractReviewTopics,
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
    extractDescriptionFromDom,
    descriptionsEqual,
    updateDescription,
    isStaleDescription,
    findProductDataCandidate,
    normalizeProduct,
    updateSelectedSku,
    exportProduct,
    exportVariants,
    exportDescription,
    exportForChatGPT,
    formatSelections,
    formatSourceLabel,
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
    installNativeReviewInterceptor,
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

  function findReviewSummaryInSsr(expectedItemId, script = document.querySelector('#__AER_DATA__')) {
    if (!script) return null;
    try {
      return extractReviewSummaryFromSsrData(JSON.parse(script.textContent || ''), expectedItemId);
    } catch (_) {
      return null;
    }
  }

  function findGalleryInSsr(expectedItemId, script = document.querySelector('#__AER_DATA__')) {
    if (!script) return null;
    try {
      return extractGalleryFromSsrData(JSON.parse(script.textContent || ''), expectedItemId);
    } catch (_) {
      return null;
    }
  }

  function findStoreInSsr(expectedItemId, script = document.querySelector('#__AER_DATA__')) {
    if (!script) return null;
    try {
      return extractStoreFromSsrData(JSON.parse(script.textContent || ''), expectedItemId);
    } catch (_) {
      return null;
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
            <button class="wide" data-action="description" disabled>Copy description</button>
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
    const productButtons = ['product', 'variants', 'chatgpt', 'description'].map((name) => shadow.querySelector(`[data-action="${name}"]`));
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
        runtime.refreshProductEnrichment?.();
        copyWithFeedback(exportProduct(runtime.product), 'Product JSON');
      } else if (action === 'variants' && runtime.product) {
        copyWithFeedback(exportVariants(runtime.product), 'Variants');
      } else if (action === 'chatgpt' && runtime.product) {
        runtime.refreshProductEnrichment?.();
        copyWithFeedback(exportForChatGPT(runtime.product), 'Product');
      } else if (action === 'description' && runtime.product) {
        runtime.refreshProductEnrichment?.();
        copyWithFeedback(exportDescription(runtime.product), 'Description');
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

  function createReviewsPanel(runtime) {
    const host = document.createElement('div');
    host.id = 'ali-helper-host';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { width:320px; max-width:calc(100vw - 24px); color:#191919; background:#fff; border:1px solid #ddd; border-radius:12px; box-shadow:0 8px 28px rgba(0,0,0,.22); font:13px/1.35 Arial,sans-serif; overflow:hidden; }
        header { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#ffefe8; }
        strong { flex:1; font-size:14px; }
        .body { padding:10px; }
        .panel.collapsed .body { display:none; }
        button { border:1px solid #d7d7d7; border-radius:8px; background:#fff; color:#222; padding:7px 9px; cursor:pointer; font:inherit; }
        button:disabled { opacity:.45; cursor:not-allowed; }
        .icon { padding:4px 8px; }
        .actions { display:flex; flex-direction:column; gap:7px; }
        .action { width:100%; }
        .status { margin:0 0 9px; padding:7px 8px; border-radius:7px; background:#f5f5f5; overflow-wrap:anywhere; }
        .status.error { color:#8a1f11; background:#fff0ed; }
        .meta { color:#666; margin-top:8px; font-size:11px; }
      </style>
      <section class="panel">
        <header><strong>Ali Helper</strong><button class="icon" data-action="toggle" title="Collapse/expand">—</button></header>
        <div class="body">
          <div class="status">Waiting for first-page SSR reviews…</div>
          <div class="actions">
            <button class="action" data-action="reviews" disabled>Copy reviews JSON</button>
            <button class="action" data-action="reviews-chatgpt" disabled>Copy reviews for ChatGPT</button>
          </div>
          <div class="meta">Read/copy/navigation only · v${VERSION}</div>
        </div>
      </section>`;
    (document.body || document.documentElement).appendChild(host);
    const panel = shadow.querySelector('.panel');
    const status = shadow.querySelector('.status');
    const copyButtons = shadow.querySelectorAll('[data-action="reviews"], [data-action="reviews-chatgpt"]');
    panel.classList.toggle('collapsed', runtime.settings.panelCollapsed);
    shadow.querySelector('[data-action="toggle"]').textContent = runtime.settings.panelCollapsed ? '+' : '—';
    function flash(message, isError = false) {
      status.textContent = message;
      status.classList.toggle('error', isError);
    }
    shadow.addEventListener('click', async (event) => {
      const action = event.target?.dataset?.action;
      if (action === 'toggle') {
        runtime.settings.panelCollapsed = !runtime.settings.panelCollapsed;
        panel.classList.toggle('collapsed', runtime.settings.panelCollapsed);
        event.target.textContent = runtime.settings.panelCollapsed ? '+' : '—';
        saveSettings(runtime.settings);
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
    };
  }

  function startReviewsPage() {
    const runtime = {
      settings: loadSettings(),
      itemId: getReviewsItemId(location.href),
      reviewCache: null,
      reviewPage: null,
      ssrSeeded: false,
      ui: null,
    };
    runtime.reviewCache = createReviewCache(runtime.itemId);
    const pageWindow = typeof unsafeWindow === 'object' && unsafeWindow ? unsafeWindow : window;
    installNativeReviewInterceptor(pageWindow, runtime.itemId, (batch, sequence) => {
      const nextCache = applyNativeReviewBatch(runtime.reviewCache, batch, sequence);
      if (nextCache === runtime.reviewCache) return;
      runtime.reviewCache = nextCache;
      runtime.reviewPage = getActiveReviewPage(nextCache);
      if (runtime.reviewPage) runtime.ui?.setReviews(runtime.reviewPage);
    });
    const mount = () => {
      if (!document.body || document.getElementById('ali-helper-host')) return;
      runtime.ui = createReviewsPanel(runtime);
      if (runtime.reviewPage) runtime.ui.setReviews(runtime.reviewPage);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();

    let attempts = 0;
    const readSsr = () => {
      if (runtime.ssrSeeded) return;
      const inspection = findReviewsPageInSsr(runtime.itemId);
      if (inspection.reviewPage) {
        runtime.reviewCache = seedReviewCacheFromSsr(runtime.reviewCache, inspection.reviewPage);
        runtime.ssrSeeded = true;
        runtime.reviewPage = getActiveReviewPage(runtime.reviewCache);
        runtime.ui?.setReviews(runtime.reviewPage);
        return;
      }
      attempts += 1;
      if (attempts < 8) setTimeout(readSsr, 500);
      else runtime.ui?.setStatus(reviewsDiagnosticMessage(inspection.diagnostic), true);
    };
    readSsr();
  }

  function start() {
    if (isReviewsPage(location.href)) {
      startReviewsPage();
      return;
    }
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
      initialItemId: getItemId(location.href),
      ui: null,
      lastUrl: location.href,
      characteristicsBoundary: null,
      staleCharacteristicsBoundary: null,
      staleCharacteristics: [],
      descriptionBoundary: null,
      staleDescriptionBoundary: null,
      staleDescription: null,
      gallerySsrScript: null,
      gallerySsrItemId: null,
      gallerySsr: null,
      ratingSsrScript: null,
      ratingSsrItemId: null,
      ratingSsrSummary: null,
      ratingBoundary: null,
      ratingDomSummary: null,
      staleRatingBoundary: null,
      staleRatingDomSummary: null,
      reviewSummaryBoundary: null,
      reviewDomSummary: null,
      staleReviewSummaryBoundary: null,
      staleReviewDomSummary: null,
      storeSsrScript: null,
      storeSsrItemId: null,
      storeSsr: null,
      storeBoundary: null,
      storeDom: null,
      staleStoreBoundary: null,
      staleStoreDom: null,
      refreshProductEnrichment: null,
    };
    const acceptProductData = (data, meta) => {
      const dataItemId = asString(firstDefined(data.productId, data.itemId, data.id, runtime.itemId));
      if (dataItemId !== runtime.itemId) return;
      try {
        const normalized = normalizeProduct(data, location.href, { title: document.title.replace(/\s*\|\s*AliExpress.*$/i, ''), source: meta.source });
        const previousProduct = runtime.product;
        runtime.product = updateGallery(normalized, previousProduct?.gallery);
        runtime.product = updateCharacteristics(runtime.product, previousProduct?.characteristics);
        runtime.product = updateDescription(runtime.product, previousProduct?.description);
        runtime.product = updateRatingSummary(runtime.product, previousProduct?.ratingSummary);
        runtime.product = updateStore(runtime.product, previousProduct?.store);
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
    const refreshProductEnrichment = () => {
      if (!runtime.product) return runtime.product;
      const ssrScript = runtime.itemId === runtime.initialItemId
        ? document.querySelector('#__AER_DATA__')
        : null;
      if (runtime.itemId === runtime.initialItemId
        && (runtime.ratingSsrItemId !== runtime.itemId || runtime.ratingSsrScript !== ssrScript)) {
        runtime.ratingSsrScript = ssrScript;
        runtime.ratingSsrItemId = runtime.itemId;
        runtime.ratingSsrSummary = findReviewSummaryInSsr(runtime.itemId, ssrScript);
      }
      if (runtime.itemId === runtime.initialItemId
        && (runtime.gallerySsrItemId !== runtime.itemId || runtime.gallerySsrScript !== ssrScript)) {
        runtime.gallerySsrScript = ssrScript;
        runtime.gallerySsrItemId = runtime.itemId;
        runtime.gallerySsr = findGalleryInSsr(runtime.itemId, ssrScript);
      }
      if (runtime.itemId === runtime.initialItemId
        && (runtime.storeSsrItemId !== runtime.itemId || runtime.storeSsrScript !== ssrScript)) {
        runtime.storeSsrScript = ssrScript;
        runtime.storeSsrItemId = runtime.itemId;
        runtime.storeSsr = findStoreInSsr(runtime.itemId, ssrScript);
      }

      const ratingBoundary = findProductHeaderBoundary(document);
      const domRating = extractBasicRatingFromDom(document);
      const staleRating = isStaleRatingSummary(
        ratingBoundary,
        domRating,
        runtime.staleRatingBoundary,
        runtime.staleRatingDomSummary,
      );
      const currentDomRating = staleRating ? null : domRating;
      if (currentDomRating) {
        runtime.ratingBoundary = ratingBoundary;
        runtime.ratingDomSummary = currentDomRating;
        runtime.staleRatingBoundary = null;
        runtime.staleRatingDomSummary = null;
      }

      const reviewSummaryBoundary = findReviewSummaryBoundary(document);
      const reviewDomSummary = extractReviewSummaryFromDom(document);
      const staleReviewSummary = isStaleRatingSummary(
        reviewSummaryBoundary,
        reviewDomSummary,
        runtime.staleReviewSummaryBoundary,
        runtime.staleReviewDomSummary,
      );
      const currentReviewDomSummary = staleReviewSummary ? null : reviewDomSummary;
      if (currentReviewDomSummary) {
        runtime.reviewSummaryBoundary = reviewSummaryBoundary;
        runtime.reviewDomSummary = currentReviewDomSummary;
        runtime.staleReviewSummaryBoundary = null;
        runtime.staleReviewDomSummary = null;
      }

      const storeBoundary = findStoreBoundary(document);
      const domStore = extractStoreFromDom(document, runtime.itemId, location.href);
      const staleStore = isStaleStore(
        storeBoundary,
        domStore,
        runtime.staleStoreBoundary,
        runtime.staleStoreDom,
      );
      const currentDomStore = staleStore ? null : domStore;
      if (currentDomStore) {
        runtime.storeBoundary = storeBoundary;
        runtime.storeDom = currentDomStore;
        runtime.staleStoreBoundary = null;
        runtime.staleStoreDom = null;
      }

      const characteristicsBoundary = findCharacteristicsBoundary(document);
      const characteristics = extractCharacteristicsFromDom(document);
      const staleCharacteristics = characteristicsBoundary
        && characteristicsBoundary === runtime.staleCharacteristicsBoundary
        && characteristicsEqual(characteristics, runtime.staleCharacteristics);
      const currentCharacteristics = staleCharacteristics ? [] : characteristics;
      if (currentCharacteristics.length) {
        runtime.characteristicsBoundary = characteristicsBoundary;
        runtime.staleCharacteristicsBoundary = null;
        runtime.staleCharacteristics = [];
      }

      const descriptionBoundary = findDescriptionBoundary(document);
      const description = extractDescriptionFromDom(document, location.href);
      const staleDescription = isStaleDescription(
        descriptionBoundary,
        description,
        runtime.staleDescriptionBoundary,
        runtime.staleDescription,
      );
      const currentDescription = staleDescription ? null : description;
      if (currentDescription) {
        runtime.descriptionBoundary = descriptionBoundary;
        runtime.staleDescriptionBoundary = null;
        runtime.staleDescription = null;
      }

      const updatedProduct = enrichProductFallbacks(runtime.product, {
        structuredGallery: runtime.gallerySsr,
        structuredRating: runtime.ratingSsrSummary,
        domRating: currentDomRating,
        reviewDomSummary: currentReviewDomSummary,
        structuredStore: runtime.storeSsr,
        domStore: currentDomStore,
        characteristics: currentCharacteristics,
        description: currentDescription,
      });
      if (updatedProduct !== runtime.product) {
        runtime.product = updatedProduct;
        runtime.ui?.setProduct(runtime.product);
      }
      return runtime.product;
    };
    runtime.refreshProductEnrichment = refreshProductEnrichment;

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
          runtime.gallerySsrScript = null;
          runtime.gallerySsrItemId = null;
          runtime.gallerySsr = null;
          runtime.staleRatingBoundary = runtime.ratingBoundary;
          runtime.staleRatingDomSummary = runtime.ratingDomSummary;
          runtime.ratingBoundary = null;
          runtime.ratingDomSummary = null;
          runtime.ratingSsrScript = null;
          runtime.ratingSsrItemId = null;
          runtime.ratingSsrSummary = null;
          runtime.staleReviewSummaryBoundary = runtime.reviewSummaryBoundary;
          runtime.staleReviewDomSummary = runtime.reviewDomSummary;
          runtime.reviewSummaryBoundary = null;
          runtime.reviewDomSummary = null;
          runtime.storeSsrScript = null;
          runtime.storeSsrItemId = null;
          runtime.storeSsr = null;
          runtime.staleStoreBoundary = runtime.storeBoundary;
          runtime.staleStoreDom = runtime.storeDom;
          runtime.storeBoundary = null;
          runtime.storeDom = null;
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
      refreshProductEnrichment();
    };
    setInterval(scanFallbacks, 1000);
    scanFallbacks();
  }

  start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
