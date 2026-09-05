'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

const ITEM_ID = '1005009452926938';
const ORIGIN_SKU_ID = '12000049151727540';
const UNKNOWN_SKU_ID = '99999999999999999';
const PRODUCT_URL = `https://aliexpress.ru/item/${ITEM_ID}.html?sku_id=${ORIGIN_SKU_ID}`;
const NAVY_IDS = Object.freeze([
  '12000049151727537', '12000049151727538', '12000049151727539',
  '12000049151727540', '12000049151727541',
]);
const WHITE_IDS = Object.freeze([
  '12000049151727487', '12000049151727488', '12000049151727489',
  '12000049151727490', '12000049151727491',
]);
const NAVY_LINE = 'Review selection: Top reviews · filters: all · variants: Color: Lining B Navy Blue; Size: XS, S, M, L, XL (5 SKUs)';
const WHITE_LINE = 'Review selection: Top reviews · filters: all · variants: Color: Lining B White; Size: XS, S, M, L, XL (5 SKUs)';

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function product() {
  return core.normalizeProduct(fixture(`product-${ITEM_ID}.json`).data, PRODUCT_URL);
}

function catalog() {
  return core.buildReviewSkuCatalog(product(), ORIGIN_SKU_ID);
}

function context(skuFilter, extra = {}) {
  return { sort: 1, filters: [], skuFilter: [...skuFilter], pageSize: 10, ...extra };
}

function cacheWithContext(skuFilter, cache = core.createReviewCache(ITEM_ID), sequence = 1, extra = {}) {
  const captured = fixture(`reviews-ssr-${ITEM_ID}.json`);
  const reviewPage = core.extractReviewsPageFromSsrData(captured, ITEM_ID);
  return core.applyNativeReviewBatch(cache, {
    itemId: ITEM_ID,
    source: 'native:product-reviews',
    context: context(skuFilter, extra),
    pageNum: 1,
    reviews: reviewPage.reviews,
  }, sequence);
}

function selectionLine(reviewPage) {
  return core.formatReviewsForChatGPT(reviewPage).split('\n').find((line) => line.startsWith('Review selection:'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function assertAcceptedCatalog(result, expected, originSelectedSkuId = ORIGIN_SKU_ID) {
  assert.notEqual(result, null);
  assert.ok(result.skus.length > 0);
  assert.deepEqual(result, expected);
  assert.ok(serializedBytes(result) <= core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
  assert.deepEqual(core.validateReviewSkuCatalog(result, originSelectedSkuId), result);
}

function catalogWithSerializedBytes(byteCount, paddingCharacter = 'x') {
  const value = { skus: Array.from({ length: 400 }, (_, index) => ({
    skuId: String(80000000000000000n + BigInt(index)),
    selections: [{ groupId: 'g', groupName: 'Group', valueId: String(index), name: 'x' }],
  })) };
  let remaining = byteCount - serializedBytes(value);
  assert.ok(remaining >= 0);
  const characterBytes = Buffer.byteLength(paddingCharacter, 'utf8');
  for (const row of value.skus) {
    const selection = row.selections[0];
    const count = Math.min(255, Math.floor(remaining / characterBytes));
    selection.name += paddingCharacter.repeat(count);
    remaining -= count * characterBytes;
    if (remaining < characterBytes && selection.name.length + remaining <= 256) {
      selection.name += 'x'.repeat(remaining);
      remaining = 0;
    }
  }
  assert.equal(remaining, 0, 'generated names must fit the existing 256-character limit');
  assert.equal(serializedBytes(value), byteCount);
  return value;
}

function withNonEnumerableSelections(value, accessors = false) {
  return { skus: value.skus.map(({ skuId, selections }) => Object.defineProperty(
    { skuId }, 'selections', accessors ? { get: () => selections } : { value: selections },
  )) };
}

test('Review SKU catalog contains exactly the 45 captured normalized real Product rows and minimal display fields', () => {
  const source = product();
  const captured = fixture(`product-${ITEM_ID}.json`).data;
  const result = core.buildReviewSkuCatalog(source, ORIGIN_SKU_ID);
  assert.deepEqual(Object.keys(result), ['skus']);
  assert.equal(result.skus.length, 45);
  assert.deepEqual(result.skus.map((sku) => sku.skuId), source.skus.map((sku) => sku.skuId));
  assert.deepEqual(new Set(result.skus.map((sku) => sku.skuId)), new Set(captured.skuInfo.priceList.map((sku) => sku.skuId)));
  for (const [index, sku] of result.skus.entries()) {
    assert.deepEqual(Object.keys(sku).sort(), ['selections', 'skuId']);
    assert.deepEqual(sku.selections, source.skus[index].selections.map(({ groupId, groupName, valueId, name }) => ({ groupId, groupName, valueId, name })));
    for (const selection of sku.selections) {
      assert.deepEqual(Object.keys(selection).sort(), ['groupId', 'groupName', 'name', 'valueId']);
    }
  }
  assert.doesNotMatch(JSON.stringify(result), /rawName|Clear|Burgundy|price|stock|image|skuAttr|skuPropIds/);
  assert.deepEqual(core.validateReviewSkuCatalog(result, ORIGIN_SKU_ID), result);
  assert.ok(serializedBytes(result) <= core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
  assert.notEqual(result.skus[0], source.skus[0]);
});

for (const [label, ids, colorName, rawName] of [
  ['Navy', NAVY_IDS, 'Lining B Navy Blue', 'Clear'],
  ['White', WHITE_IDS, 'Lining B White', 'Burgundy'],
]) {
  test(`${label} Review SKU catalog labels preserve the captured normalized display name`, () => {
    const result = catalog();
    const rows = ids.map((skuId) => result.skus.find((sku) => sku.skuId === skuId));
    assert.equal(rows.length, 5);
    assert.ok(rows.every((sku) => sku.selections[0].groupId === '4' && sku.selections[0].name === colorName));
    assert.deepEqual(rows.map((sku) => sku.selections[1].name), ['XS', 'S', 'M', 'L', 'XL']);
    assert.doesNotMatch(JSON.stringify(rows), new RegExp(rawName));
  });
}

test('catalog builder uses only supplied real product.skus and does not reconstruct missing combinations from groups', () => {
  const source = product();
  source.skus = source.skus.filter((sku) => [NAVY_IDS[0], WHITE_IDS[3]].includes(sku.skuId));
  const result = core.buildReviewSkuCatalog(source);
  assert.equal(source.variantGroups[0].values.length, 9);
  assert.equal(source.variantGroups[1].values.length, 5);
  assert.deepEqual(result.skus.map((sku) => sku.skuId), source.skus.map((sku) => sku.skuId));
  assert.equal(result.skus.length, 2);
});

test('catalog builder normalizes human whitespace without falling back to raw names', () => {
  const source = product();
  source.skus = source.skus.filter((sku) => sku.skuId === ORIGIN_SKU_ID);
  source.skus[0].selections[0].name = '  Lining  B Navy Blue  ';
  const result = core.buildReviewSkuCatalog(source, ORIGIN_SKU_ID);
  assert.equal(result.skus[0].selections[0].name, 'Lining B Navy Blue');
  source.skus[0].selections[0].name = null;
  assert.equal(source.skus[0].selections[0].rawName, 'Clear');
  assert.equal(core.buildReviewSkuCatalog(source, ORIGIN_SKU_ID), null);
});

test('catalog creation rejects conflicting real normalized rows as a whole', () => {
  const source = product();
  source.skus.push(clone(source.skus[0]));
  assert.equal(core.buildReviewSkuCatalog(source), null);
  source.skus.pop();
  source.skus[1].selections[0].groupName = 'Conflicting color group';
  assert.equal(core.buildReviewSkuCatalog(source), null);
});

const invalidCatalogMutations = [
  ['extra root field', (value) => { value.extra = true; }],
  ['extra SKU field', (value) => { value.skus[0].price = 1; }],
  ['extra selection field', (value) => { value.skus[0].selections[0].rawName = 'Burgundy'; }],
  ['duplicate SKU ID', (value) => { value.skus.push(clone(value.skus[0])); }],
  ['nonnumeric SKU ID', (value) => { value.skus[0].skuId = 'sku-123'; }],
  ['numeric instead of string SKU ID', (value) => { value.skus[0].skuId = 123; }],
  ['unbounded SKU ID', (value) => { value.skus[0].skuId = '1'.repeat(1000); }],
  ['non-array SKU rows', (value) => { value.skus = {}; }],
  ['non-array selections', (value) => { value.skus[0].selections = {}; }],
  ['duplicate group within a SKU', (value) => { value.skus[0].selections.push(clone(value.skus[0].selections[0])); }],
  ['conflicting group name', (value) => { value.skus[1].selections[0].groupName = 'Other color'; }],
  ['conflicting value name', (value) => {
    const first = value.skus[0].selections[0];
    const sameValue = value.skus.slice(1).find((sku) => sku.selections.some((selection) => selection.groupId === first.groupId && selection.valueId === first.valueId));
    sameValue.selections.find((selection) => selection.groupId === first.groupId).name = 'Conflicting color';
  }],
  ['unsafe group ID', (value) => { value.skus[0].selections[0].groupId = '<group>'; }],
  ['object value ID', (value) => { value.skus[0].selections[0].valueId = {}; }],
  ['unbounded group ID', (value) => { value.skus[0].selections[0].groupId = 'a'.repeat(65); }],
  ['unbounded value ID', (value) => { value.skus[0].selections[0].valueId = '1'.repeat(65); }],
  ['empty group name', (value) => { value.skus[0].selections[0].groupName = ''; }],
  ['empty value name', (value) => { value.skus[0].selections[0].name = ''; }],
  ['unnormalized name', (value) => { value.skus[0].selections[0].name = ' Lining  B White '; }],
  ['control character name', (value) => { value.skus[0].selections[0].name = 'Lining\u0000B White'; }],
  ['unbounded name', (value) => { value.skus[0].selections[0].name = 'x'.repeat(257); }],
];

for (const [label, mutate] of invalidCatalogMutations) {
  test(`persisted Review SKU catalog rejects ${label} without a partial catalog`, () => {
    const value = catalog();
    mutate(value);
    assert.equal(core.validateReviewSkuCatalog(value), null);
  });
}

test('persisted Review SKU catalog accepts only plain objects and clones accepted data', () => {
  const value = catalog();
  assert.equal(core.validateReviewSkuCatalog(Object.assign(Object.create({ inherited: true }), value)), null);
  const copied = core.validateReviewSkuCatalog(value);
  assert.deepEqual(copied, value);
  copied.skus[0].selections[0].name = 'Changed clone';
  assert.notEqual(value.skus[0].selections[0].name, 'Changed clone');
});

test('catalog originSelectedSkuId binding requires an exact stored real SKU', () => {
  const value = catalog();
  assert.deepEqual(core.validateReviewSkuCatalog(value, ORIGIN_SKU_ID), value);
  assert.equal(core.validateReviewSkuCatalog(value, UNKNOWN_SKU_ID), null);
  assert.equal(core.buildReviewSkuCatalog(product(), UNKNOWN_SKU_ID), null);
  assert.equal(core.validateReviewSkuCatalog(null, UNKNOWN_SKU_ID), null);
});

test('catalog byte bound is 128 KiB and oversized valid-shaped stress input is all-or-null', () => {
  assert.equal(core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES, 128 * 1024);
  const source = product();
  // Synthetic capacity stress only: names/selections remain captured real data.
  source.skus = Array.from({ length: 700 }, (_, index) => ({ ...clone(source.skus[index % source.skus.length]), skuId: String(80000000000000000n + BigInt(index)) }));
  const projected = { skus: source.skus.map((sku) => ({
    skuId: sku.skuId,
    selections: sku.selections.map(({ groupId, groupName, valueId, name }) => ({ groupId, groupName, valueId, name })),
  })) };
  assert.ok(Buffer.byteLength(JSON.stringify(projected), 'utf8') > core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
  assert.equal(core.validateReviewSkuCatalog(projected), null);
  assert.equal(core.buildReviewSkuCatalog(source), null);
});

test('catalog byte bound uses UTF-8 bytes rather than JavaScript string length', () => {
  const value = catalog();
  const stress = { skus: Array.from({ length: 90 }, (_, index) => ({
    skuId: String(80000000000000000n + BigInt(index)),
    selections: value.skus[index % value.skus.length].selections.map((selection) => ({ ...selection, name: '界'.repeat(256) })),
  })) };
  const serialized = JSON.stringify(stress);
  assert.ok(serialized.length < core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
  assert.ok(Buffer.byteLength(serialized, 'utf8') > core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
  assert.equal(core.validateReviewSkuCatalog(stress), null);
});

test('catalog accepts a normalized returned payload of exactly 131072 bytes', () => {
  assert.equal(core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES, 131072);
  const normalized = catalogWithSerializedBytes(131072);
  const input = withNonEnumerableSelections(normalized);
  assert.ok(serializedBytes(input) < core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
  const result = core.validateReviewSkuCatalog(input);
  assertAcceptedCatalog(result, normalized, null);
  assert.equal(serializedBytes(result), 131072);
  assert.notEqual(result.skus[0].selections, input.skus[0].selections);
});

test('catalog rejects a normalized returned payload of exactly 131073 bytes', () => {
  const normalized = catalogWithSerializedBytes(131073);
  const input = withNonEnumerableSelections(normalized);
  assert.ok(serializedBytes(input) < core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
  assert.equal(serializedBytes(normalized), 131073);
  assert.equal(core.validateReviewSkuCatalog(input), null);
});

test('normalized catalog byte bound counts multibyte UTF-8 from non-enumerable accessor selections', () => {
  for (const byteCount of [131072, 131073]) {
    const normalized = catalogWithSerializedBytes(byteCount, '界');
    const input = withNonEnumerableSelections(normalized, true);
    assert.ok(serializedBytes(input) < core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
    assert.ok(JSON.stringify(normalized).length < core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
    assert.equal(serializedBytes(normalized), byteCount);
    const result = core.validateReviewSkuCatalog(input);
    if (byteCount === 131072) {
      assertAcceptedCatalog(result, normalized, null);
      assert.equal(serializedBytes(result), byteCount);
    } else {
      assert.equal(result, null);
    }
  }
});

test('catalog rejects many strict rows whose hidden selections expand beyond the normalized byte bound', () => {
  const realRows = catalog().skus;
  const normalizedEquivalent = { skus: Array.from({ length: 700 }, (_, index) => ({
    skuId: String(80000000000000000n + BigInt(index)),
    selections: clone(realRows[index % realRows.length].selections),
  })) };
  const input = withNonEnumerableSelections(normalizedEquivalent);
  const inputSerializedBytes = serializedBytes(input);
  const normalizedEquivalentBytes = serializedBytes(normalizedEquivalent);
  assert.ok(inputSerializedBytes < core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
  assert.ok(normalizedEquivalentBytes > core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
  assert.ok(input.skus.every((row) => Object.getPrototypeOf(row) === Object.prototype
    && Object.hasOwn(row, 'selections') && !Object.propertyIsEnumerable.call(row, 'selections')));
  assert.equal(core.validateReviewSkuCatalog(input), null);
});

for (const enumerable of [false, true]) {
  const visibility = enumerable ? 'enumerable' : 'non-enumerable';
  test(`catalog reads a stateful ${visibility} top-level skus getter exactly once before it becomes empty`, () => {
    const sourceRow = catalog().skus.find((row) => row.skuId === ORIGIN_SKU_ID);
    const sourceSkus = [sourceRow];
    const expected = clone({ skus: sourceSkus });
    let reads = 0;
    const input = Object.defineProperty({}, 'skus', { enumerable, get() {
      reads += 1;
      return reads === 1 ? sourceSkus : [];
    } });
    assert.deepEqual(Reflect.ownKeys(input), ['skus']);
    assert.equal(Object.propertyIsEnumerable.call(input, 'skus'), enumerable);
    const result = core.validateReviewSkuCatalog(input, ORIGIN_SKU_ID);
    assert.equal(reads, 1);
    assertAcceptedCatalog(result, expected);
    assert.equal(result.skus.length, 1);
    assert.notEqual(result, input);
    assert.notEqual(result.skus, sourceSkus);
    assert.notEqual(result.skus[0], sourceRow);
    assert.notEqual(result.skus[0].selections, sourceRow.selections);
    for (const [index, selection] of sourceRow.selections.entries()) {
      assert.notEqual(result.skus[0].selections[index], selection);
    }
    assert.equal(reads, 1, 'serialization and revalidation must not reread the source getter');
    assert.deepEqual(input.skus, []);
    assert.equal(reads, 2, 'only this later external read observes the empty array');
    assertAcceptedCatalog(result, expected);
    assert.equal(reads, 2);
  });
}

test('catalog rejects the first invalid top-level skus getter value without recovering from a later valid array', () => {
  const validSkus = [catalog().skus.find((row) => row.skuId === ORIGIN_SKU_ID)];
  let reads = 0;
  const input = Object.defineProperty({}, 'skus', { enumerable: true, get() {
    reads += 1;
    return reads === 1 ? {} : validSkus;
  } });
  assert.equal(core.validateReviewSkuCatalog(input, ORIGIN_SKU_ID), null);
  assert.equal(reads, 1);
});

test('catalog catches a throwing top-level skus getter after exactly one attempted read', () => {
  let reads = 0;
  const input = Object.defineProperty({}, 'skus', { enumerable: true, get() {
    reads += 1;
    throw new Error('unreadable catalog');
  } });
  let result;
  assert.doesNotThrow(() => { result = core.validateReviewSkuCatalog(input, ORIGIN_SKU_ID); });
  assert.equal(result, null);
  assert.equal(reads, 1);
});

for (const enumerable of [false, true]) {
  const visibility = enumerable ? 'enumerable' : 'non-enumerable';
  test(`catalog snapshots every ${visibility} row and selection accessor exactly once`, () => {
    const expectedRow = catalog().skus.find((row) => row.skuId === ORIGIN_SKU_ID);
    const expected = { skus: [expectedRow] };
    const selectionReads = expectedRow.selections.map(() => ({ groupId: 0, groupName: 0, valueId: 0, name: 0 }));
    const sourceSelections = expectedRow.selections.map((selection, index) => {
      const source = {};
      for (const key of ['groupId', 'groupName', 'valueId', 'name']) {
        const captured = selection[key];
        Object.defineProperty(source, key, { enumerable, get() {
          selectionReads[index][key] += 1;
          return selectionReads[index][key] === 1 ? captured : {};
        } });
      }
      return source;
    });
    const rowReads = { skuId: 0, selections: 0 };
    const sourceRow = {};
    for (const [key, captured, later] of [
      ['skuId', expectedRow.skuId, UNKNOWN_SKU_ID],
      ['selections', sourceSelections, []],
    ]) {
      Object.defineProperty(sourceRow, key, { enumerable, get() {
        rowReads[key] += 1;
        return rowReads[key] === 1 ? captured : later;
      } });
    }
    const sourceSkus = [sourceRow];
    const result = core.validateReviewSkuCatalog({ skus: sourceSkus }, ORIGIN_SKU_ID);
    assertAcceptedCatalog(result, expected);
    assert.notEqual(result.skus, sourceSkus);
    assert.notEqual(result.skus[0], sourceRow);
    assert.notEqual(result.skus[0].selections, sourceSelections);
    for (const [index, selection] of sourceSelections.entries()) {
      assert.notEqual(result.skus[0].selections[index], selection);
    }
    assert.deepEqual(rowReads, { skuId: 1, selections: 1 });
    assert.deepEqual(selectionReads, expectedRow.selections.map(() => ({ groupId: 1, groupName: 1, valueId: 1, name: 1 })));
  });
}

test('catalog snapshots SKU array membership before row getters mutate it and detaches all returned data', () => {
  const rows = catalog().skus;
  const sourceRows = [rows.find((row) => row.skuId === ORIGIN_SKU_ID), rows.find((row) => row.skuId === WHITE_IDS[0])];
  const sourceSkus = [...sourceRows];
  const expected = clone({ skus: sourceSkus });
  let reads = 0;
  Object.defineProperty(sourceRows[0], 'skuId', { enumerable: true, get() {
    reads += 1;
    sourceSkus.length = 0;
    return ORIGIN_SKU_ID;
  } });
  const result = core.validateReviewSkuCatalog({ skus: sourceSkus }, ORIGIN_SKU_ID);
  assert.equal(reads, 1);
  assert.deepEqual(sourceSkus, []);
  assertAcceptedCatalog(result, expected);
  assert.equal(result.skus.length, 2, 'both captured rows survive mutation during the first row validation');
  assert.notEqual(result.skus, sourceSkus);
  for (const [index, row] of sourceRows.entries()) {
    assert.notEqual(result.skus[index], row);
    assert.notEqual(result.skus[index].selections, row.selections);
    for (const [selectionIndex, selection] of row.selections.entries()) {
      assert.notEqual(result.skus[index].selections[selectionIndex], selection);
      selection.name = 'Changed source name';
    }
    row.selections.length = 0;
  }
  sourceRows[1].skuId = UNKNOWN_SKU_ID;
  sourceSkus.push({ skuId: UNKNOWN_SKU_ID, selections: [] });
  assertAcceptedCatalog(result, expected);
  assert.equal(reads, 1);
});

test('catalog snapshots a non-enumerable name accessor once and returns stable detached primitive data', () => {
  let reads = 0;
  const selection = { groupId: 'g', groupName: 'Group', valueId: 'v' };
  Object.defineProperty(selection, 'name', { get() {
    reads += 1;
    return reads === 1 ? 'First name' : { toJSON: () => 'x'.repeat(131073) };
  } });
  const input = { skus: [{ skuId: ORIGIN_SKU_ID, selections: [selection] }] };
  const result = core.validateReviewSkuCatalog(input);
  assertAcceptedCatalog(result, { skus: [{
    skuId: ORIGIN_SKU_ID,
    selections: [{ groupId: 'g', groupName: 'Group', valueId: 'v', name: 'First name' }],
  }] });
  assert.equal(reads, 1);
  const serialized = JSON.stringify(result);
  assert.equal(JSON.stringify(result), serialized);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= core.REVIEW_WORKFLOW_SKU_CATALOG_MAX_BYTES);
  assert.equal(reads, 1);
});

test('empty Review skuFilter explicitly resolves to all and has no previous dimensions or combinations', () => {
  assert.deepEqual(core.resolveReviewSkuSelection(context([]), catalog()), {
    status: 'all', selectedSkuCount: 0, resolvedSkuCount: 0,
    unresolvedSkuIds: [], mode: 'count', groups: [], combinations: [],
  });
});

for (const [label, ids, colorName, expectedLine] of [
  ['Navy', NAVY_IDS, 'Lining B Navy Blue', NAVY_LINE],
  ['White', WHITE_IDS, 'Lining B White', WHITE_LINE],
]) {
  test(`${label} five native Review SKU IDs resolve to exact one-color five-size dimensions`, () => {
    const rawContext = context(ids);
    const result = core.resolveReviewSkuSelection(rawContext, catalog());
    assert.equal(result.status, 'resolved');
    assert.equal(result.mode, 'dimensions');
    assert.equal(result.selectedSkuCount, 5);
    assert.equal(result.resolvedSkuCount, 5);
    assert.deepEqual(result.unresolvedSkuIds, []);
    assert.deepEqual(result.groups.map((group) => [group.groupId, group.groupName, group.values.map((value) => value.name)]), [
      ['4', 'Color', [colorName]], ['30', 'Size', ['XS', 'S', 'M', 'L', 'XL']],
    ]);
    assert.equal(core.formatReviewSelection(rawContext, result), expectedLine);
  });
}

test('single real Review SKU resolves its own normalized dimensions independent of Product URL SKU', () => {
  const rawContext = context([WHITE_IDS[0]]);
  const result = core.resolveReviewSkuSelection(rawContext, catalog());
  assert.equal(result.status, 'resolved');
  assert.equal(result.mode, 'dimensions');
  assert.equal(result.selectedSkuCount, 1);
  assert.deepEqual(result.groups.map((group) => group.values.map((value) => value.name)), [['Lining B White'], ['XS']]);
  const line = core.formatReviewSelection(rawContext, result);
  assert.match(line, /Color: Lining B White; Size: XS \(1 SKU\)/);
  assert.doesNotMatch(line, /Navy|Size: L(?:\W|$)|120000/);
});

test('non-factorizable selected real pairs use combinations instead of false dimension cross-product', () => {
  const rawContext = context([NAVY_IDS[0], WHITE_IDS[3]]);
  const result = core.resolveReviewSkuSelection(rawContext, catalog());
  assert.equal(result.status, 'resolved');
  assert.equal(result.mode, 'combinations');
  assert.deepEqual(new Set(result.combinations.map((sku) => sku.skuId)), new Set(rawContext.skuFilter));
  const line = core.formatReviewSelection(rawContext, result);
  assert.match(line, /Color=Lining B Navy Blue \+ Size=XS/);
  assert.match(line, /Color=Lining B White \+ Size=L/);
  assert.match(line, /\(2 SKUs\)/);
  assert.equal(line, 'Review selection: Top reviews · filters: all · variants: Color=Lining B Navy Blue + Size=XS; Color=Lining B White + Size=L (2 SKUs)');
  assert.doesNotMatch(line, /showing first|120000/);
  assert.doesNotMatch(line, /Color:|Size: XS, L/);
});

test('sparse captured real SKU subset factorizes by actual catalog membership, without demanding invented combinations', () => {
  const source = product();
  const ids = [NAVY_IDS[0], WHITE_IDS[3]];
  source.skus = source.skus.filter((sku) => ids.includes(sku.skuId));
  const sparse = core.buildReviewSkuCatalog(source);
  const result = core.resolveReviewSkuSelection(context(ids), sparse);
  assert.equal(sparse.skus.length, 2);
  assert.equal(result.status, 'resolved');
  assert.equal(result.mode, 'dimensions');
  assert.equal(result.selectedSkuCount, 2);
  assert.deepEqual(new Set(result.groups.find((group) => group.groupId === '4').values.map((value) => value.name)), new Set(['Lining B Navy Blue', 'Lining B White']));
  assert.deepEqual(new Set(result.groups.find((group) => group.groupId === '30').values.map((value) => value.name)), new Set(['XS', 'L']));
});

test('partial Review mapping retains real combinations and reports every unknown ID honestly', () => {
  const rawContext = context([...NAVY_IDS.slice(0, 4), UNKNOWN_SKU_ID]);
  const result = core.resolveReviewSkuSelection(rawContext, catalog());
  assert.equal(result.status, 'partial');
  assert.equal(result.mode, 'combinations');
  assert.equal(result.selectedSkuCount, 5);
  assert.equal(result.resolvedSkuCount, 4);
  assert.deepEqual(result.unresolvedSkuIds, [UNKNOWN_SKU_ID]);
  assert.deepEqual(new Set(result.combinations.map((sku) => sku.skuId)), new Set(NAVY_IDS.slice(0, 4)));
  const line = core.formatReviewSelection(rawContext, result);
  assert.match(line, /4 resolved SKUs:/);
  assert.match(line, /Lining B Navy Blue/);
  assert.match(line, /1 unresolved SKU/);
  assert.doesNotMatch(line, /999999|120000|Size: XS, S, M, L/);
});

test('unknown IDs never resolve by numeric similarity or a property/value ID', () => {
  const rawContext = context(['337970', '30', `${ORIGIN_SKU_ID}0`]);
  const result = core.resolveReviewSkuSelection(rawContext, catalog());
  assert.equal(result.status, 'unresolved');
  assert.equal(result.resolvedSkuCount, 0);
  assert.deepEqual(new Set(result.unresolvedSkuIds), new Set(rawContext.skuFilter));
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.combinations, []);
  assert.match(core.formatReviewSelection(rawContext, result), /3 selected \(labels unavailable\)/);
});

test('nonempty Review selection without a catalog reports count and unavailable labels without opaque IDs', () => {
  const rawContext = context(NAVY_IDS);
  const result = core.resolveReviewSkuSelection(rawContext, null);
  assert.equal(result.status, 'unresolved');
  assert.equal(result.selectedSkuCount, 5);
  assert.equal(result.resolvedSkuCount, 0);
  assert.deepEqual(result.unresolvedSkuIds, NAVY_IDS);
  assert.equal(result.mode, 'count');
  assert.equal(core.formatReviewSelection(rawContext, result), 'Review selection: Top reviews · filters: all · variants: 5 selected (labels unavailable)');
  assert.equal(core.formatReviewSelection(rawContext), core.formatReviewSelection(rawContext, result));
});

test('resolver and formatter preserve normalized Product ordering across shuffled canonical input IDs', () => {
  const value = catalog();
  const ids = [WHITE_IDS[3], NAVY_IDS[0], NAVY_IDS[4]];
  const first = core.resolveReviewSkuSelection(context(ids), value);
  const second = core.resolveReviewSkuSelection(context(ids.slice().reverse()), value);
  assert.deepEqual(first, second);
  assert.deepEqual(first.combinations.map((sku) => sku.skuId), value.skus.filter((sku) => ids.includes(sku.skuId)).map((sku) => sku.skuId));
  assert.equal(core.formatReviewSelection(context(ids), first), core.formatReviewSelection(context(ids.slice().reverse()), second));
  assert.deepEqual(core.resolveReviewSkuSelection(context(NAVY_IDS.slice().reverse()), value), core.resolveReviewSkuSelection(context(NAVY_IDS), value));
});

test('large non-factorizable selection keeps complete JSON combinations and any AI preview states the actual shown count', () => {
  const value = catalog();
  const ids = value.skus.slice(0, -1).map((sku) => sku.skuId);
  const result = core.resolveReviewSkuSelection(context(ids), value);
  assert.equal(result.mode, 'combinations');
  assert.equal(result.combinations.length, 44);
  const line = core.formatReviewSelection(context(ids), result);
  const shownCount = (line.match(/Color=/g) || []).length;
  assert.equal(shownCount, 8);
  const expectedPreview = result.combinations.slice(0, 8).map((sku) => sku.selections
    .map(({ groupName, name }) => `${groupName}=${name}`).join(' + ')).join('; ');
  assert.equal(line, `Review selection: Top reviews · filters: all · variants: ${expectedPreview} (showing first 8 of 44 resolved combinations) (44 SKUs)`);
  assert.ok(expectedPreview.length <= 2000);
  assert.ok(ids.every((skuId) => !line.includes(skuId)));
  assert.equal(line.split('\n').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('combination text budget preserves a nonempty preview with an honest first N of M suffix', () => {
  const value = catalog();
  for (const sku of value.skus) for (const selection of sku.selections) {
    selection.name = selection.name.padEnd(256, 'x');
  }
  assert.deepEqual(core.validateReviewSkuCatalog(value), value);
  const ids = value.skus.slice(0, -1).map((sku) => sku.skuId);
  const rawContext = context(ids);
  const result = core.resolveReviewSkuSelection(rawContext, value);
  assert.equal(result.mode, 'combinations');
  assert.equal(result.combinations.length, 44);
  const labels = result.combinations.map((sku) => sku.selections
    .map(({ groupName, name }) => `${groupName}=${name}`).join(' + '));
  assert.ok(labels.slice(0, 3).join('; ').length <= 2000);
  assert.ok(labels.slice(0, 4).join('; ').length > 2000);
  const line = core.formatReviewSelection(rawContext, result);
  assert.equal(line, `Review selection: Top reviews · filters: all · variants: ${labels.slice(0, 3).join('; ')} (showing first 3 of 44 resolved combinations) (44 SKUs)`);
  assert.equal((line.match(/Color=/g) || []).length, 3);
  assert.ok(ids.every((skuId) => !line.includes(skuId)));
});

function catalogWithOversizedCombinationLabels() {
  const selections = (variant) => Array.from({ length: 4 }, (_, index) => ({
    groupId: `group-${index}`,
    groupName: `Group ${index} `.padEnd(256, 'g'),
    valueId: `value-${variant}`,
    name: `Value ${variant} `.padEnd(256, 'v'),
  }));
  const first = { skuId: NAVY_IDS[0], selections: selections('a') };
  const second = { skuId: WHITE_IDS[0], selections: selections('b') };
  // The unselected mixed real row prevents exact dimension factorization.
  const mixed = { skuId: ORIGIN_SKU_ID, selections: [first.selections[0], ...second.selections.slice(1)] };
  const value = { skus: [first, second, mixed] };
  assert.deepEqual(core.validateReviewSkuCatalog(value), value);
  assert.ok(first.selections.map(({ groupName, name }) => `${groupName}=${name}`).join(' + ').length > 2000);
  return value;
}

test('fully resolved zero-combination preview uses exact plural counts without labels or opaque IDs', () => {
  const value = catalogWithOversizedCombinationLabels();
  const ids = value.skus.slice(0, 2).map((sku) => sku.skuId);
  const rawContext = context(ids);
  const result = core.resolveReviewSkuSelection(rawContext, value);
  assert.equal(result.status, 'resolved');
  assert.equal(result.mode, 'combinations');
  assert.equal(result.resolvedSkuCount, 2);
  const line = core.formatReviewSelection(rawContext, result);
  assert.equal(line, 'Review selection: Top reviews · filters: all · variants: 2 resolved SKUs (combination labels too long to display)');
  assert.ok(line.length <= 2000);
  assert.doesNotMatch(line, /showing first 0|Group|Value/);
  assert.ok(value.skus.every(({ skuId }) => !line.includes(skuId)));
});

test('partial zero-combination preview keeps exact resolved and unresolved counts without opaque IDs', () => {
  const value = catalogWithOversizedCombinationLabels();
  const rawContext = context([value.skus[0].skuId, UNKNOWN_SKU_ID]);
  const result = core.resolveReviewSkuSelection(rawContext, value);
  assert.equal(result.status, 'partial');
  assert.equal(result.mode, 'combinations');
  assert.equal(result.selectedSkuCount, 2);
  assert.equal(result.resolvedSkuCount, 1);
  assert.deepEqual(result.unresolvedSkuIds, [UNKNOWN_SKU_ID]);
  const line = core.formatReviewSelection(rawContext, result);
  assert.equal(line, 'Review selection: Top reviews · filters: all · variants: 1 resolved SKU (combination labels too long to display); 1 unresolved SKU');
  assert.ok(line.length <= 2000);
  assert.doesNotMatch(line, /showing first 0|Group|Value/);
  assert.ok([...value.skus.map((sku) => sku.skuId), UNKNOWN_SKU_ID].every((skuId) => !line.includes(skuId)));
});

test('active Review enrichment preserves exact raw context IDs and adds complete JSON selection metadata without mutating cache', () => {
  const rawContext = context([...NAVY_IDS, UNKNOWN_SKU_ID]);
  const cache = cacheWithContext(rawContext.skuFilter);
  const entry = cache.contexts.get(cache.activeContextKey);
  const before = JSON.stringify(entry.context);
  const active = core.getActiveReviewPage(cache, catalog());
  const exported = JSON.parse(core.exportReviewsPage(active));
  assert.deepEqual(exported.context.skuFilter, core.canonicalizeReviewContext(rawContext).skuFilter);
  assert.deepEqual(exported.selection.variants, active.selection.variants);
  assert.equal(exported.selection.variants.status, 'partial');
  assert.deepEqual(exported.selection.variants.unresolvedSkuIds, [UNKNOWN_SKU_ID]);
  assert.equal(exported.selection.variants.combinations.length, 5);
  assert.equal(JSON.stringify(entry.context), before);
  assert.equal(Object.hasOwn(entry, 'selection'), false);
  assert.equal(Object.hasOwn(entry.context, 'selection'), false);
  assert.deepEqual(exported.reviews, active.reviews);
});

test('standalone Reviews and combined v2 use the exact same resolved Review selection line', () => {
  const active = core.getActiveReviewPage(cacheWithContext(NAVY_IDS), catalog());
  const standalone = core.formatReviewsForChatGPT(active);
  const combined = core.formatCombinedProductReviews({
    itemId: ITEM_ID,
    productChatgptText: core.exportForChatGPT(product()),
    reviewPage: active,
    coverage: 'partial-cancelled',
    stopReason: 'user-cancelled',
    scrollActivations: 0,
  });
  assert.equal(selectionLine(active), NAVY_LINE);
  assert.match(combined, /^ALIEXPRESS PRODUCT \+ REVIEWS\nFormat: ali-helper-combined-text\/v2/);
  assert.equal(combined.split('===== REVIEWS =====\n')[1], `${standalone}\n`);
  assert.equal(combined.split('\n').find((line) => line.startsWith('Review selection:')), NAVY_LINE);
});

test('normal filters and sort stay on the shared compact human-readable Review selection line', () => {
  const rawContext = context(WHITE_IDS, { sort: 2, filters: [1, 2] });
  const line = core.formatReviewSelection(rawContext, core.resolveReviewSkuSelection(rawContext, catalog()));
  assert.equal(line, WHITE_LINE.replace('Top reviews · filters: all', 'New reviews first · filters: With photos + Additional'));
  assert.equal(line.split('\n').length, 1);
});

test('native context changes Navy to White to all clear prior labels in active page and JSON', () => {
  let cache = core.createReviewCache(ITEM_ID);
  const value = catalog();
  for (const [sequence, ids, line] of [[1, NAVY_IDS, NAVY_LINE], [2, WHITE_IDS, WHITE_LINE], [3, [], 'Review selection: Top reviews · filters: all · variants: all']]) {
    cache = cacheWithContext(ids, cache, sequence);
    const active = core.getActiveReviewPage(cache, value);
    assert.equal(selectionLine(active), line);
    assert.deepEqual(active.context.skuFilter, [...ids]);
    const exported = JSON.parse(core.exportReviewsPage(active));
    assert.deepEqual(exported.context.skuFilter, [...ids]);
    if (!ids.length) {
      assert.equal(exported.selection.variants.status, 'all');
      assert.deepEqual(exported.selection.variants.groups, []);
      assert.deepEqual(exported.selection.variants.combinations, []);
      assert.doesNotMatch(JSON.stringify(exported.selection), /Navy|White|120000/);
    }
  }
});

test('Review context identity depends only on raw canonical IDs while catalog labels can vary independently', () => {
  const cache = cacheWithContext(NAVY_IDS);
  const originalKey = cache.activeContextKey;
  const value = catalog();
  const first = core.getActiveReviewPage(cache, value);
  for (const sku of value.skus) for (const selection of sku.selections) {
    if (selection.groupId === '4' && selection.valueId === '337970') selection.name = 'Marketplace renamed this color';
  }
  const second = core.getActiveReviewPage(cache, value);
  assert.notEqual(selectionLine(first), selectionLine(second));
  assert.equal(core.createReviewContextKey(ITEM_ID, first.context), originalKey);
  assert.equal(core.createReviewContextKey(ITEM_ID, second.context), originalKey);
  assert.deepEqual(second.context, first.context);
  assert.equal(cache.activeContextKey, originalKey);
  assert.equal(cache.contexts.size, 1);
});
