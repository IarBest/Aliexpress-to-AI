'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

const SPARSE_FIXTURE = 'product-1005010146755036.json';
const SPARSE_PAGE_URL = 'https://aliexpress.ru/item/1005010146755036.html?sku_id=12000051314391886';
const SPARSE_MISSING_KEYS = [
  '4=338038|1071=380598',
  '4=338038|1071=380590',
  '4=337907|1071=380593',
  '4=337907|1071=380587',
  '4=337907|1071=380599',
];
const SPARSE_MISSING_NAMES = [
  ['Wine Red', '39'],
  ['Wine Red', '40'],
  ['Black', '36'],
  ['Black', '37'],
  ['Black', '38'],
];

function cartesianRows(groups) {
  return groups.reduce(
    (rows, group) => rows.flatMap((row) => group.values.map((value) => [
      ...row,
      { groupId: String(group.id), valueId: String(value.id), name: value.name },
    ])),
    [[]],
  );
}

function combinationKey(groups, selections, label = 'combination') {
  const byGroup = new Map();
  for (const selection of selections) {
    const groupId = String(selection.groupId);
    assert.equal(byGroup.has(groupId), false, `${label} repeats group ${groupId}`);
    byGroup.set(groupId, String(selection.valueId));
  }
  assert.equal(byGroup.size, groups.length, `${label} selection count`);
  return groups.map((group) => {
    const groupId = String(group.id);
    const valueId = byGroup.get(groupId);
    assert.ok(valueId, `${label} has group ${groupId}`);
    return `${groupId}=${valueId}`;
  }).join('|');
}

function rawSkuSelections(row, groups) {
  const ids = new Set(core.splitSkuPropIds(row.skuPropIds).map(String));
  assert.equal(ids.size, groups.length, `SKU ${row.skuId} property count`);
  return groups.map((group) => {
    const matches = group.values.filter((value) => ids.has(String(value.id)));
    assert.equal(matches.length, 1, `SKU ${row.skuId} has one ${group.name} value`);
    return { groupId: String(group.id), valueId: String(matches[0].id) };
  });
}

function rawSkuKey(row, groups) {
  return combinationKey(groups, rawSkuSelections(row, groups), `raw SKU ${row.skuId}`);
}

function normalizedSkuKey(sku, groups) {
  return combinationKey(groups, sku.selections, `normalized SKU ${sku.skuId}`);
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

test('captured sparse Cartesian product preserves raw groups, rows, and selected binding', () => {
  const fixture = loadFixture(SPARSE_FIXTURE);
  const groups = fixture.data.skuInfo.propertyList;
  const rows = fixture.data.skuInfo.priceList;
  const theoreticalCount = groups.reduce((count, group) => count * group.values.length, 1);

  assert.deepEqual(groups.map((group) => ({
    id: group.id,
    name: group.name,
    values: group.values.map((value) => ({
      id: value.id,
      name: value.name,
      displayName: value.displayName,
      disabled: value.disabled,
    })),
  })), [
    {
      id: '4',
      name: 'Color',
      values: [
        { id: '338038', name: 'Wine Red', displayName: 'Wine Red', disabled: false },
        { id: '337907', name: 'black', displayName: 'Black', disabled: false },
      ],
    },
    {
      id: '1071',
      name: 'Shoe Size',
      values: [
        { id: '380592', name: '35', displayName: '35', disabled: false },
        { id: '380593', name: '36', displayName: '36', disabled: false },
        { id: '380587', name: '37', displayName: '37', disabled: false },
        { id: '380599', name: '38', displayName: '38', disabled: false },
        { id: '380598', name: '39', displayName: '39', disabled: false },
        { id: '380590', name: '40', displayName: '40', disabled: false },
        { id: '380596', name: '42', displayName: '42', disabled: false },
      ],
    },
  ]);
  assert.deepEqual(groups.map((group) => group.values.length), [2, 7]);
  assert.equal(theoreticalCount, 14);
  assert.equal(rows.length, 9);
  assert.ok(theoreticalCount > rows.length);
  assert.equal(new Set(rows.map((row) => row.skuId)).size, rows.length);
  for (const row of rows) assert.equal(rawSkuSelections(row, groups).length, groups.length);

  const activeRows = rows.filter((row) => row.skuId === fixture.data.activeSkuId);
  assert.equal(activeRows.length, 1);
  assert.equal(new URL(SPARSE_PAGE_URL).searchParams.get('sku_id'), fixture.data.activeSkuId);
  assert.equal(activeRows[0].skuPropIds, '337907,380590');
  assert.equal(activeRows[0].availQuantity, 20);
  assert.equal(activeRows[0].activityAmount.value, 30.22);
  assert.equal(activeRows[0].amount.value, 60.45);
});

test('normalizes every captured sparse priceList row without synthesizing SKUs', () => {
  const fixture = loadFixture(SPARSE_FIXTURE);
  const rows = fixture.data.skuInfo.priceList;
  const product = core.normalizeProduct(fixture.data, SPARSE_PAGE_URL);

  assert.equal(product.itemId, fixture.data.id);
  assert.deepEqual(product.variantGroups.map((group) => [group.id, group.name, group.values.length]), [
    ['4', 'Color', 2],
    ['1071', 'Shoe Size', 7],
  ]);
  assert.equal(product.skus.length, rows.length);
  assert.equal(product.skus.length, 9);
  assert.equal(product._meta.activeSkuId, fixture.data.activeSkuId);
  assert.equal(product.selectedSkuId, fixture.data.activeSkuId);
  assert.equal(product.selectedSku.skuId, fixture.data.activeSkuId);
  assert.ok(product.skus.includes(product.selectedSku));
  assert.equal(product._meta.selectedSkuResolved, true);
  assert.deepEqual(product.selectedSku.selections.map(({ groupId, valueId, name }) => ({ groupId, valueId, name })), [
    { groupId: '4', valueId: '337907', name: 'Black' },
    { groupId: '1071', valueId: '380590', name: '40' },
  ]);

  for (const sku of product.skus) {
    const captured = rows.find((row) => row.skuId === sku.skuId);
    assert.ok(captured, `normalized SKU ${sku.skuId} is captured`);
    assert.equal(sku.selections.length, product.variantGroups.length);
    assert.deepEqual(
      sku.selections.map((selection) => selection.groupId),
      product.variantGroups.map((group) => group.id),
    );
    assert.deepEqual(new Set(sku.skuPropIds), new Set(core.splitSkuPropIds(captured.skuPropIds)));
    assert.equal(normalizedSkuKey(sku, product.variantGroups), rawSkuKey(captured, fixture.data.skuInfo.propertyList));
  }
});

test('captured sparse Cartesian matrix has exact cross-gaps and no orphan values', () => {
  const fixture = loadFixture(SPARSE_FIXTURE);
  const rawGroups = fixture.data.skuInfo.propertyList;
  const rows = fixture.data.skuInfo.priceList;
  const product = core.normalizeProduct(fixture.data, SPARSE_PAGE_URL);
  const theoreticalRows = cartesianRows(product.variantGroups);
  const theoreticalKeys = new Set(theoreticalRows.map((row) => combinationKey(product.variantGroups, row)));
  const rawActualKeys = rows.map((row) => rawSkuKey(row, rawGroups));
  const normalizedActualKeys = product.skus.map((sku) => normalizedSkuKey(sku, product.variantGroups));
  const actualKeySet = new Set(normalizedActualKeys);

  assert.equal(theoreticalKeys.size, 14);
  assert.equal(rawActualKeys.length, 9);
  assert.equal(new Set(rawActualKeys).size, rows.length);
  assert.equal(actualKeySet.size, rows.length);
  assert.deepEqual([...actualKeySet].sort(), [...new Set(rawActualKeys)].sort());
  for (const key of actualKeySet) assert.ok(theoreticalKeys.has(key), `actual key ${key} is theoretical`);

  const missingKeys = [...theoreticalKeys].filter((key) => !actualKeySet.has(key));
  assert.deepEqual(missingKeys, SPARSE_MISSING_KEYS);
  assert.equal(missingKeys.length, theoreticalKeys.size - actualKeySet.size);
  const theoreticalByKey = new Map(theoreticalRows.map((row) => [combinationKey(product.variantGroups, row), row]));
  assert.deepEqual(
    missingKeys.map((key) => theoreticalByKey.get(key).map((selection) => selection.name)),
    SPARSE_MISSING_NAMES,
  );

  const usedPairs = new Set(product.skus.flatMap((sku) => sku.selections.map(
    (selection) => `${selection.groupId}=${selection.valueId}`,
  )));
  for (const group of product.variantGroups) {
    for (const value of group.values) {
      assert.ok(usedPairs.has(`${group.id}=${value.id}`), `${group.name}=${value.name} occurs in an actual SKU`);
    }
  }
  for (const key of missingKeys) {
    for (const selection of theoreticalByKey.get(key)) {
      assert.ok(
        product.skus.some((sku) => sku.selections.some(
          (actual) => actual.groupId === selection.groupId && actual.valueId === selection.valueId,
        )),
        `${selection.name} from missing ${key} is individually used by another actual SKU`,
      );
    }
  }
});

test('UI and exports report only captured sparse priceList combinations', () => {
  const fixture = loadFixture(SPARSE_FIXTURE);
  const product = core.normalizeProduct(fixture.data, SPARSE_PAGE_URL);
  const status = core.formatProductStatus(product);
  const copiedProduct = JSON.parse(core.exportProduct(product));
  const variants = core.exportVariants(product);
  const chatgpt = core.exportForChatGPT(product);
  const actualKeys = new Set(product.skus.map((sku) => normalizedSkuKey(sku, product.variantGroups)));
  const copiedKeys = new Set(copiedProduct.skus.map((sku) => normalizedSkuKey(sku, copiedProduct.variantGroups)));

  assert.match(status, /^Partial · 9 combinations · Color: 2, Shoe Size: 7 ·/);
  assert.doesNotMatch(status, /14 combinations/);
  assert.deepEqual(copiedProduct.variantGroups.map((group) => group.values.length), [2, 7]);
  assert.equal(copiedProduct.skus.length, 9);
  assert.deepEqual([...copiedKeys].sort(), [...actualKeys].sort());
  for (const key of SPARSE_MISSING_KEYS) assert.equal(copiedKeys.has(key), false);
  assert.deepEqual(copiedProduct._meta.sections, product._meta.sections);
  assert.deepEqual(copiedProduct._meta.completeness, product._meta.completeness);

  assert.match(variants, /SKU COMBINATIONS \(9\):/);
  const skuLines = variants.split('\n').filter((line) => /^SKU \S+ \|/.test(line));
  assert.equal(skuLines.length, 9);
  assert.deepEqual(
    skuLines.map((line) => line.match(/^SKU (\S+) \|/)[1]).sort(),
    product.skus.map((sku) => sku.skuId).sort(),
  );
  for (const sku of product.skus) {
    const expectedPrefix = `SKU ${sku.skuId} | ${core.formatSelections(sku)} |`;
    assert.ok(skuLines.some((line) => line.startsWith(expectedPrefix)), expectedPrefix);
  }
  for (const [color, size] of SPARSE_MISSING_NAMES) {
    assert.equal(skuLines.some((line) => line.includes(`Color: ${color}; Shoe Size: ${size}`)), false);
  }

  assert.match(chatgpt, /SKU COMBINATIONS:\n9 real combinations from priceList/);
  assert.doesNotMatch(chatgpt, /14 (?:possible|real) combinations/);
  assert.doesNotMatch(chatgpt, /^SKU \S+ \|/m);
  assert.doesNotMatch(`${variants}\n${chatgpt}`, /Unavailable combination|Missing SKU/i);
});
