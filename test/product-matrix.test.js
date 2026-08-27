'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

test('captured no-variant product preserves its sole real SKU and selected binding', () => {
  const fixture = loadFixture('product-1005004235856766.json');
  const soleCapturedSku = fixture.data.skuInfo.priceList[0];
  const pageUrl = `https://aliexpress.ru/item/${fixture.data.id}.html?sku_id=${soleCapturedSku.skuId}`;
  const product = core.normalizeProduct(fixture.data, pageUrl);

  assert.equal(fixture.data.skuInfo.propertyList.length, 0);
  assert.equal(fixture.data.skuInfo.priceList.length, 1);
  assert.equal(fixture.data.activeSkuId, soleCapturedSku.skuId);
  assert.equal(product.itemId, fixture.data.id);
  assert.deepEqual(product.variantGroups, []);
  assert.equal(product.skus.length, 1);
  assert.equal(product.skus.length, fixture.data.skuInfo.priceList.length);
  assert.deepEqual(product.skus[0].skuPropIds, []);
  assert.deepEqual(product.skus[0].selections, []);
  assert.equal(product.selectedSkuId, soleCapturedSku.skuId);
  assert.equal(product.selectedSku, product.skus[0]);
  assert.equal(product._meta.selectedSkuResolved, true);
  assert.equal(product.price.current.value, '23.94');
  assert.equal(product.price.regular.value, '23.94');
  assert.equal(product.selectedSku.stock, 11566);
});

test('captured no-variant product uses singular and neutral UI/export representations', () => {
  const fixture = loadFixture('product-1005004235856766.json');
  const soleSkuId = fixture.data.skuInfo.priceList[0].skuId;
  const product = core.normalizeProduct(
    fixture.data,
    `https://aliexpress.ru/item/${fixture.data.id}.html?sku_id=${soleSkuId}`,
  );
  const variants = core.exportVariants(product);
  const chatgpt = core.exportForChatGPT(product);
  const copiedProduct = JSON.parse(core.exportProduct(product));

  assert.match(core.formatProductStatus(product), /^Partial · 1 combination · no variant groups ·/);
  assert.deepEqual(copiedProduct.variantGroups, []);
  assert.equal(copiedProduct.skus.length, 1);
  assert.deepEqual(copiedProduct.skus[0].selections, []);
  assert.deepEqual(
    Object.fromEntries(Object.entries(copiedProduct._meta.sections).map(([section, value]) => [section, value.state])),
    {
      sizeGuide: 'missing',
      gallery: 'not-observed',
      ratingSummary: 'not-observed',
      store: 'not-observed',
      characteristics: 'not-observed',
      description: 'not-observed',
      delivery: 'not-observed',
    },
  );
  assert.equal(copiedProduct._meta.completeness.state, 'partial');
  assert.match(variants, /SKU COMBINATIONS \(1\):/);
  assert.match(variants, new RegExp(`SKU ${soleSkuId} \\| — \\| Price: \\$ 23\\.94`));
  assert.doesNotMatch(variants, /Default|Single|Standard/);
  assert.match(chatgpt, /Data status: PARTIAL/);
  assert.match(chatgpt, new RegExp(`Selected SKU: ${soleSkuId}`));
  assert.match(chatgpt, /Selected variants: —/);
  assert.match(chatgpt, /1 real combinations from priceList/);
  assert.doesNotMatch(chatgpt, /Selected variants: (?:Default|Single|Standard)/);
});
