'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/ali-helper.user.js');

function money(value) {
  return { value: String(value), currency: 'USD', formatted: `$${value}` };
}

function makeSingleDimensionFixture() {
  const values = Array.from({ length: 7 }, (_, index) => ({
    id: String(100 + index),
    name: `Internal ${index + 1}`,
    displayName: ['433 Remote', 'Wifi', 'Zigbee', 'RF Relay', 'Kit A', 'Kit B', 'Module'][index],
  }));
  return {
    productId: '1005008195850531',
    title: 'ZIGBEE Smart Switch',
    activeSkuId: '12000000000000001',
    skuInfo: {
      propertyList: [{ id: '14', name: 'Bundle', values }],
      priceList: values.map((value, index) => ({
        skuId: `1200000000000000${index + 1}`,
        skuPropIds: value.id,
        activityAmount: money(1.92 + index),
        amount: money(3.2 + index),
        availQuantity: 100 - index,
      })),
    },
  };
}

function makeMultiDimensionFixture() {
  const colors = [
    ['337970', 'Clear', 'Lining B Navy Blue'], ['337971', 'Pink', 'Lining B Pink'],
    ['337972', 'Green', 'Deep Green B'], ['337973', 'Red', 'Lining B Wine Red'],
    ['337974', 'Taupe', 'Lining B Taupe'], ['337975', 'Blue', 'Cup A Blue'],
    ['337976', 'White', 'Cup A White'], ['337977', 'Black', 'Cup A Black'],
    ['337978', 'Yellow', 'Cup A Yellow'],
  ].map(([id, name, displayName]) => ({ id, name, displayName }));
  const sizes = ['XS', 'S', 'M', 'L', 'XL'].map((name, index) => ({ id: String(343559 + index), name, displayName: name }));
  const priceList = [];
  let sequence = 0;
  for (const color of colors) {
    for (const size of sizes) {
      sequence += 1;
      priceList.push({
        skuId: String(12000049151727500n + BigInt(sequence)),
        skuPropIds: `${color.id},${size.id}`,
        activityAmount: money(24 + sequence / 10),
        amount: money(40),
        availQuantity: sequence,
      });
    }
  }
  priceList[3].skuId = '12000049151727540';
  return {
    productId: '1005009452926938',
    title: 'Vintage Blue Corset Midi Sundress',
    activeSkuId: priceList[0].skuId,
    skuInfo: {
      propertyList: [
        { id: '14', name: 'Color', values: colors },
        { id: '5', name: 'Size', values: sizes },
      ],
      priceList,
      sizeData: {
        tables: [{
          unit: 'CM',
          columns: ['Size', 'Bust', 'Length', 'Waist'],
          rows: [['XS', 80, 97, 65], ['S', 84, 98, 69], ['M', 88, 99, 73], ['L', 92, 100, 77], ['XL', 100, 101, 81]],
        }],
      },
    },
  };
}

test('normalizes COM URL with URL API, keeps sku_id and unknown params', () => {
  const input = 'https://www.aliexpress.com/item/1005008195850531.html?spm=a2g0o&utm_source=x&sku_id=123&mystery=keep#frag';
  const result = core.normalizeItemUrl(input, 'ru');
  assert.equal(result.href, 'https://aliexpress.ru/item/1005008195850531.html?sku_id=123&mystery=keep');
});

test('recognizes only AliExpress item pages', () => {
  assert.equal(core.isItemPage('https://aliexpress.ru/item/1005008195850531.html'), true);
  assert.equal(core.isItemPage('https://aliexpress.ru/item/1005008195850531/reviews'), false);
  assert.equal(core.isItemPage('https://example.com/item/1005008195850531.html'), false);
});

test('single dimension fixture has Bundle: 7 values and 7 real SKUs', () => {
  const product = core.normalizeProduct(makeSingleDimensionFixture(), 'https://aliexpress.ru/item/1005008195850531.html?sku_id=12000000000000004');
  assert.equal(product.variantGroups.length, 1);
  assert.equal(product.variantGroups[0].name, 'Bundle');
  assert.equal(product.variantGroups[0].values.length, 7);
  assert.equal(product.skus.length, 7);
  assert.equal(product.selectedSkuId, '12000000000000004');
  assert.equal(product.selectedSku.selections[0].name, 'RF Relay');
});

test('multi dimension fixture uses priceList, URL SKU and displayName', () => {
  const fixture = makeMultiDimensionFixture();
  const product = core.normalizeProduct(fixture, 'https://aliexpress.ru/item/1005009452926938.html?sku_id=12000049151727540');
  assert.deepEqual(product.variantGroups.map((group) => [group.name, group.values.length]), [['Color', 9], ['Size', 5]]);
  assert.equal(product.skus.length, 45);
  assert.equal(product.selectedSkuId, '12000049151727540');
  assert.deepEqual(product.selectedSku.selections.map((selection) => selection.name), ['Lining B Navy Blue', 'L']);
  assert.equal(product.selectedSku.selections[0].rawName, 'Clear');
  assert.equal(product.sizeGuide.tables[0].rows.length, 5);
  assert.equal(JSON.parse(core.exportProduct(product)).skus.length, 45);
  assert.match(core.exportForChatGPT(product), /Lining B Navy Blue/);
  assert.match(core.exportForChatGPT(product), /Size \| Bust \| Length \| Waist/);
});

test('does not invent missing Cartesian combinations', () => {
  const fixture = makeMultiDimensionFixture();
  fixture.skuInfo.priceList.splice(10, 1);
  const product = core.normalizeProduct(fixture, 'https://aliexpress.ru/item/1005009452926938.html');
  assert.equal(product.skus.length, 44);
});

test('recursively finds nested productData without a hardcoded path', () => {
  const fixture = makeSingleDimensionFixture();
  const found = core.findProductDataCandidate({ widgets: [{ children: [{ props: { response: { data: fixture } } }] }] });
  assert.equal(found.data, fixture);
  assert.match(found.path, /widgets/);
});
