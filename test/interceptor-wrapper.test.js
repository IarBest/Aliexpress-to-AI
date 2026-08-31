'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/ali-helper.user.js');

const PAGE_URL = 'https://aliexpress.ru/item/100/reviews';
const PRODUCT_URL = 'https://aliexpress.ru/api/productData?item=100';
const SHIPPING_URL = 'https://aliexpress.ru/aer-api/v1/pdp/web/freight/calculate';
const REVIEW_URL = 'https://aliexpress.ru/aer-jsonapi/review/v5/desktop/product-reviews';
const UNRELATED_URL = 'https://aliexpress.ru/api/unrelated';

const productPayload = () => ({
  data: { id: '100', skuInfo: { propertyList: [], priceList: [] } },
});

const shippingRequest = () => ({ productId: 100, skuId: 'sku-100', count: 1 });
const shippingResponse = () => ({ data: { methods: [] } });
const reviewRequest = () => ({
  productKey: { id: '100', sourceId: 0 },
  pagination: { pageNum: 2, pageSize: 10 },
  sort: 1,
  filters: [],
  skuFilter: [],
});
const reviewResponse = () => ({ data: { reviews: [] } });

function flushHelperWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function withPageLocation(callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: PAGE_URL },
  });
  try {
    return await callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else delete globalThis.location;
  }
}

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) => permutations(values.filter((_, current) => current !== index))
    .map((rest) => [value, ...rest]));
}

function responseFor(input) {
  const url = typeof input === 'string' ? input : input.url;
  let json;
  if (url.includes('/productData')) json = productPayload();
  else if (url.includes('/freight/calculate')) json = shippingResponse();
  else if (url.includes('/product-reviews')) json = reviewResponse();
  else json = { unrelated: true };

  const cloneReads = [];
  const response = {
    marker: url,
    clone() {
      const clone = { json: async () => { cloneReads.push(clone); return json; } };
      return clone;
    },
  };
  return { response, cloneReads };
}

function createFetchHarness() {
  const calls = [];
  const nativeFetch = function (...args) {
    const transport = responseFor(args[0]);
    const promise = Promise.resolve(transport.response);
    calls.push({ thisValue: this, args, promise, ...transport });
    return promise;
  };
  const pageWindow = {
    fetch: nativeFetch,
    location: { href: PAGE_URL },
  };
  return { pageWindow, nativeFetch, calls };
}

function installers(captures, callbacks = {}) {
  return {
    product(pageWindow) {
      core.installProductDataInterceptor(pageWindow, callbacks.product || ((data, meta) => captures.product.push({ data, meta })), () => '100');
    },
    shipping(pageWindow) {
      core.installShippingCalculateInterceptor(pageWindow, callbacks.shipping || ((capture) => captures.shipping.push(capture)));
    },
    reviews(pageWindow) {
      core.installNativeReviewInterceptor(pageWindow, '100', callbacks.reviews || ((batch, sequence) => captures.reviews.push({ batch, sequence })));
    },
  };
}

test('installing all passive observers originates no product, shipping, or review request', async () => withPageLocation(async () => {
  const { pageWindow, calls } = createFetchHarness();
  const captures = { product: [], shipping: [], reviews: [] };
  const install = installers(captures);
  install.product(pageWindow);
  install.shipping(pageWindow);
  install.reviews(pageWindow);
  await flushHelperWork();

  assert.equal(calls.length, 0);
  assert.deepEqual(captures, { product: [], shipping: [], reviews: [] });
}));

function makeFetchCases() {
  const controller = new AbortController();
  const productInput = new Request(PRODUCT_URL, { method: 'POST' });
  const productInit = {
    method: 'POST',
    body: '{"caller":"product"}',
    headers: { 'X-Synthetic': 'product' },
    credentials: 'include',
    signal: controller.signal,
  };
  const shippingInit = {
    method: 'POST',
    body: JSON.stringify(shippingRequest()),
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    signal: controller.signal,
  };
  const reviewInit = {
    method: 'POST',
    body: JSON.stringify(reviewRequest()),
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    signal: controller.signal,
  };
  const unrelatedInit = {
    method: 'PUT',
    body: 'caller-body',
    headers: { 'X-Synthetic': 'unrelated' },
    credentials: 'omit',
    signal: controller.signal,
  };
  return [
    { name: 'product', args: [productInput, productInit], expected: { product: 1, shipping: 0, reviews: 0 } },
    { name: 'shipping', args: [SHIPPING_URL, shippingInit], expected: { product: 0, shipping: 1, reviews: 0 } },
    { name: 'reviews', args: [REVIEW_URL, reviewInit], expected: { product: 0, shipping: 0, reviews: 1 } },
    { name: 'unrelated', args: [UNRELATED_URL, unrelatedInit], expected: { product: 0, shipping: 0, reviews: 0 } },
  ];
}

for (const name of ['product', 'shipping']) {
  test(`${name} repeated installation is a fetch no-op and keeps the first callback`, async () => withPageLocation(async () => {
    const { pageWindow, calls } = createFetchHarness();
    const first = [];
    const second = [];
    const install = name === 'product'
      ? (callback) => core.installProductDataInterceptor(pageWindow, callback, () => '100')
      : (callback) => core.installShippingCalculateInterceptor(pageWindow, callback);
    install((...args) => first.push(args));
    const wrapper = pageWindow.fetch;
    install((...args) => second.push(args));
    assert.equal(pageWindow.fetch, wrapper);

    const url = name === 'product' ? PRODUCT_URL : SHIPPING_URL;
    const init = name === 'product'
      ? { method: 'POST', body: '{}' }
      : { method: 'POST', body: JSON.stringify(shippingRequest()) };
    const returned = pageWindow.fetch(url, init);
    assert.equal(returned, calls[0].promise);
    assert.equal(await returned, calls[0].response);
    assert.equal(await pageWindow.fetch(UNRELATED_URL), calls[1].response);
    await flushHelperWork();
    await flushHelperWork();

    assert.equal(calls.length, 2);
    assert.equal(first.length, 1);
    assert.equal(second.length, 0);
  }));
}

for (const order of permutations(['product', 'shipping', 'reviews'])) {
  test(`fetch wrappers layer safely in order ${order.join(' -> ')}`, async () => withPageLocation(async () => {
    const { pageWindow, calls } = createFetchHarness();
    const captures = { product: [], shipping: [], reviews: [] };
    const install = installers(captures);
    order.forEach((name) => install[name](pageWindow));
    const customThis = { marker: `this:${order.join('-')}` };
    const cases = makeFetchCases();

    for (const request of cases) {
      const before = Object.fromEntries(Object.entries(captures).map(([name, values]) => [name, values.length]));
      const returned = pageWindow.fetch.call(customThis, ...request.args);
      const call = calls.at(-1);
      assert.equal(returned, call.promise, `${request.name}: original Promise`);
      assert.equal(call.thisValue, customThis, `${request.name}: this`);
      assert.equal(call.args.length, request.args.length, `${request.name}: argument count`);
      request.args.forEach((arg, index) => assert.equal(call.args[index], arg, `${request.name}: argument ${index} identity`));
      if (request.args[1]) {
        assert.equal(call.args[1].method, request.args[1].method);
        assert.equal(call.args[1].body, request.args[1].body);
        assert.equal(call.args[1].headers, request.args[1].headers);
        assert.equal(call.args[1].credentials, request.args[1].credentials);
        assert.equal(call.args[1].signal, request.args[1].signal);
      }
      assert.equal(await returned, call.response, `${request.name}: original Response`);
      await flushHelperWork();
      await flushHelperWork();
      for (const name of Object.keys(captures)) {
        assert.equal(captures[name].length - before[name], request.expected[name], `${request.name}: ${name} isolation`);
      }
      const expectedCloneReads = request.name === 'unrelated' ? 0 : 1;
      assert.equal(call.cloneReads.length, expectedCloneReads, `${request.name}: helper reads one clone only`);
    }

    assert.equal(calls.length, cases.length, 'one native fetch per explicit caller fetch');
  }));
}

for (const reinstalled of ['product', 'shipping', 'reviews']) {
  test(`reinstalling ${reinstalled} inside a layered fetch stack preserves the current outer wrapper`, async () => withPageLocation(async () => {
    const { pageWindow, calls } = createFetchHarness();
    const captures = { product: [], shipping: [], reviews: [] };
    const install = installers(captures);
    install[reinstalled](pageWindow);
    ['product', 'shipping', 'reviews'].filter((name) => name !== reinstalled).forEach((name) => install[name](pageWindow));
    const outerWrapper = pageWindow.fetch;
    const duplicate = installers(captures, { [reinstalled]: () => assert.fail(`${reinstalled} installed twice`) });
    duplicate[reinstalled](pageWindow);
    assert.equal(pageWindow.fetch, outerWrapper);

    const request = makeFetchCases().find(({ name }) => name === reinstalled);
    const returned = pageWindow.fetch(...request.args);
    assert.equal(returned, calls[0].promise);
    assert.equal(await returned, calls[0].response);
    await flushHelperWork();
    await flushHelperWork();
    assert.equal(calls.length, 1);
    assert.equal(captures[reinstalled].length, 1);
  }));
}

test('helper parse and callback failures preserve fetch resolution and rejection semantics', async () => withPageLocation(async () => {
  const cases = [
    { name: 'product', url: PRODUCT_URL, init: { method: 'POST', body: '{}' }, valid: productPayload() },
    { name: 'shipping', url: SHIPPING_URL, init: { method: 'POST', body: JSON.stringify(shippingRequest()) }, valid: shippingResponse() },
    { name: 'reviews', url: REVIEW_URL, init: { method: 'POST', body: JSON.stringify(reviewRequest()) }, valid: reviewResponse() },
  ];

  for (const current of cases) {
    for (const mode of ['parse failure', 'callback failure', 'native rejection']) {
      const nativeError = new Error(`${current.name}:${mode}`);
      const originalResponse = {
        clone: () => ({ json: mode === 'parse failure' ? async () => { throw nativeError; } : async () => current.valid }),
      };
      const nativePromise = mode === 'native rejection' ? Promise.reject(nativeError) : Promise.resolve(originalResponse);
      let nativeCalls = 0;
      const pageWindow = {
        location: { href: PAGE_URL },
        fetch() { nativeCalls += 1; return nativePromise; },
      };
      const captures = { product: [], shipping: [], reviews: [] };
      const install = installers(captures, { [current.name]: () => { throw nativeError; } });
      install[current.name](pageWindow);
      const returned = pageWindow.fetch(current.url, current.init);
      assert.equal(returned, nativePromise, `${current.name}/${mode}: original Promise`);
      if (mode === 'native rejection') await assert.rejects(returned, (error) => error === nativeError);
      else assert.equal(await returned, originalResponse, `${current.name}/${mode}: original Response`);
      await flushHelperWork();
      await flushHelperWork();
      assert.equal(nativeCalls, 1, `${current.name}/${mode}: one native request`);
    }
  }
}));

function createXhrHarness() {
  const openReturn = { marker: 'native-open-return' };
  const sendReturn = { marker: 'native-send-return' };
  const openCalls = [];
  const sendCalls = [];

  class FakeXMLHttpRequest {
    constructor() {
      this.listeners = new Map();
      this.responseType = '';
      this.response = null;
      this.responseText = '';
    }

    open(...args) {
      openCalls.push({ thisValue: this, args });
      return openReturn;
    }

    send(...args) {
      sendCalls.push({ thisValue: this, args });
      return sendReturn;
    }

    addEventListener(type, listener, options) {
      const listeners = this.listeners.get(type) || [];
      listeners.push({ listener, options });
      this.listeners.set(type, listeners);
    }

    listenerCount(type) {
      return (this.listeners.get(type) || []).length;
    }

    finish(payload) {
      if (this.responseType === 'json') this.response = payload;
      else this.responseText = JSON.stringify(payload);
      const listeners = [...(this.listeners.get('loadend') || [])];
      this.listeners.set('loadend', (this.listeners.get('loadend') || []).filter((entry) => !entry.options?.once));
      listeners.forEach(({ listener }) => listener.call(this, { type: 'loadend', target: this }));
    }
  }

  const pageWindow = {
    location: { href: PAGE_URL },
    XMLHttpRequest: FakeXMLHttpRequest,
  };
  return { pageWindow, FakeXMLHttpRequest, openCalls, sendCalls, openReturn, sendReturn };
}

for (const name of ['product', 'shipping']) {
  test(`${name} repeated installation is an XHR open/send no-op`, async () => withPageLocation(async () => {
    const harness = createXhrHarness();
    const first = [];
    const install = name === 'product'
      ? (callback) => core.installProductDataInterceptor(harness.pageWindow, callback, () => '100')
      : (callback) => core.installShippingCalculateInterceptor(harness.pageWindow, callback);
    install((...args) => first.push(args));
    const openWrapper = harness.FakeXMLHttpRequest.prototype.open;
    const sendWrapper = harness.FakeXMLHttpRequest.prototype.send;
    install(() => assert.fail(`${name} XHR installed twice`));
    assert.equal(harness.FakeXMLHttpRequest.prototype.open, openWrapper);
    assert.equal(harness.FakeXMLHttpRequest.prototype.send, sendWrapper);

    const xhr = new harness.FakeXMLHttpRequest();
    const url = name === 'product' ? PRODUCT_URL : SHIPPING_URL;
    const body = name === 'product' ? '{}' : JSON.stringify(shippingRequest());
    assert.equal(xhr.open('POST', url, true, 'synthetic-user', 'synthetic-password'), harness.openReturn);
    assert.equal(xhr.send(body), harness.sendReturn);
    assert.equal(xhr.listenerCount('loadend'), 1);
    xhr.finish(name === 'product' ? productPayload() : shippingResponse());

    assert.equal(harness.openCalls.length, 1);
    assert.equal(harness.sendCalls.length, 1);
    assert.equal(first.length, 1);
    assert.equal(xhr.listenerCount('loadend'), 0);
  }));
}

for (const order of [['product', 'shipping'], ['shipping', 'product']]) {
  test(`XHR wrappers layer safely in order ${order.join(' -> ')}`, async () => withPageLocation(async () => {
    const harness = createXhrHarness();
    const captures = { product: [], shipping: [], reviews: [] };
    const install = installers(captures);
    order.forEach((name) => install[name](harness.pageWindow));
    const cases = [
      { name: 'product', url: PRODUCT_URL, body: { caller: 'product' }, response: productPayload(), expected: { product: 1, shipping: 0 } },
      { name: 'shipping', url: SHIPPING_URL, body: JSON.stringify(shippingRequest()), response: shippingResponse(), expected: { product: 0, shipping: 1 } },
      { name: 'unrelated', url: UNRELATED_URL, body: new Uint8Array([1, 2, 3]), response: { unrelated: true }, expected: { product: 0, shipping: 0 } },
    ];

    for (const current of cases) {
      const xhr = new harness.FakeXMLHttpRequest();
      const openArgs = ['POST', current.url, false, 'synthetic-user', 'synthetic-password'];
      const before = { product: captures.product.length, shipping: captures.shipping.length };
      assert.equal(xhr.open(...openArgs), harness.openReturn);
      assert.equal(xhr.send(current.body), harness.sendReturn);
      const openCall = harness.openCalls.at(-1);
      const sendCall = harness.sendCalls.at(-1);
      assert.equal(openCall.thisValue, xhr, `${current.name}: open this`);
      assert.deepEqual(openCall.args, openArgs, `${current.name}: open args`);
      assert.equal(sendCall.thisValue, xhr, `${current.name}: send this`);
      assert.equal(sendCall.args.length, 1, `${current.name}: send arg count`);
      assert.equal(sendCall.args[0], current.body, `${current.name}: body identity`);
      assert.equal(xhr.listenerCount('loadend'), current.name === 'unrelated' ? 0 : 1, `${current.name}: one matching listener`);
      xhr.finish(current.response);
      assert.equal(captures.product.length - before.product, current.expected.product, `${current.name}: product isolation`);
      assert.equal(captures.shipping.length - before.shipping, current.expected.shipping, `${current.name}: shipping isolation`);
      assert.equal(xhr.listenerCount('loadend'), 0, `${current.name}: once listener removed`);
    }

    assert.equal(harness.openCalls.length, cases.length, 'one native open per explicit caller open');
    assert.equal(harness.sendCalls.length, cases.length, 'one native send per explicit caller send');

    const reused = new harness.FakeXMLHttpRequest();
    reused.open('POST', PRODUCT_URL);
    reused.send('{}');
    reused.finish(productPayload());
    const productCount = captures.product.length;
    reused.open('GET', UNRELATED_URL);
    reused.send(null);
    assert.equal(reused.listenerCount('loadend'), 0, 'reused XHR does not retain old endpoint state');
    reused.finish({ unrelated: true });
    assert.equal(captures.product.length, productCount);
    assert.equal(harness.openCalls.length, cases.length + 2);
    assert.equal(harness.sendCalls.length, cases.length + 2);
  }));
}
