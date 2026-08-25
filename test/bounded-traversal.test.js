'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/ali-helper.user.js');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nested(value, wrapperCount) {
  let result = value;
  for (let index = 0; index < wrapperCount; index += 1) result = { next: result };
  return result;
}

function sizeTable(unit, value = 'S') {
  return { unit, columns: ['Size'], rows: [[value]] };
}

function galleryCandidate(label, itemId = 'item') {
  const url = `https://example.com/${label}.jpg`;
  return { props: { id: itemId, gallery: [{ imageUrl: url, previewUrl: url, videoUrl: null }] } };
}

function storeProps(name, itemId, options = {}) {
  const sellerId = options.sellerId || (name === 'First Store' ? '701' : '702');
  const props = {
    id: sellerId,
    name,
    url: `https://aliexpress.ru/store/${sellerId}`,
  };
  if (options.chat !== false) props.chatLink = { item_id: itemId, seller_id: sellerId };
  if (options.analytics !== undefined) props.analytics = options.analytics;
  return props;
}

function storeCandidate(name, itemId, options) {
  return { props: storeProps(name, itemId, options) };
}

function ratingCandidate(itemId, rating, reviewCount) {
  return {
    props: {
      analyticEvents: {
        clickAllReviews: { trackingInfo: { itemId, overallRating: rating } },
        viewWidgetReview: { trackingInfo: { itemId, overallRating: rating } },
      },
      resolveParams: { 'review.productReviewsCount': reviewCount },
    },
  };
}

function feedbackWidget(reviewCount, feedbackCount) {
  return {
    widgetId: 'bx/RedReviewsProductFeedbackList/test',
    props: {
      placement: 'PDP',
      resolveParams: {
        'review.productReviewsCount': reviewCount,
        'review.productFeedbacksCount': feedbackCount,
      },
    },
  };
}

function tabsWidget(itemId, rating, children = {}) {
  return {
    widgetId: 'bx/RedReviewsTabs/test',
    props: {
      analyticEvents: {
        clickAllReviews: { trackingInfo: { itemId, overallRating: rating } },
        viewWidgetReview: { trackingInfo: { itemId, overallRating: rating } },
      },
    },
    ...children,
  };
}

function contextWidget(children = {}) {
  return { widgetId: 'bx/RedReviewsContextWidget/test', ...children };
}

function productDataCandidate(id) {
  return { id, skuInfo: { propertyList: [], priceList: [] } };
}

test('Size Guide keeps the captured Dress CM/IN result on a complete scan', () => {
  const fixture = loadFixture('product-1005009452926938.json');
  const sizeData = fixture.data.skuInfo.sizeData;
  const snapshot = clone(sizeData);

  const inspection = core.inspectSizeGuide(sizeData);

  assert.equal(inspection.diagnostic, null);
  assert.deepEqual(inspection.sizeGuide.tables.map((table) => table.unit), ['CM', 'IN']);
  assert.deepEqual(core.normalizeSizeGuide(sizeData), inspection.sizeGuide);
  assert.equal(inspection.sizeGuide.raw, sizeData);
  assert.deepEqual(sizeData, snapshot);
});

test('Size Guide fails closed when depth hides a table after a plausible table', () => {
  const input = {
    ...sizeTable('CM'),
    hidden: nested(sizeTable('IN'), 2),
  };
  const snapshot = clone(input);

  assert.deepEqual(core.inspectSizeGuide(input, { maxDepth: 2 }), {
    sizeGuide: null,
    diagnostic: 'traversal-limit',
  });
  assert.equal(core.normalizeSizeGuide(input, { maxDepth: 2 }), null);

  const beforeOnlyCandidate = nested(sizeTable('CM'), 3);
  assert.equal(core.inspectSizeGuide(beforeOnlyCandidate, { maxDepth: 2 }).diagnostic, 'traversal-limit');

  const exactDepthMiss = core.inspectSizeGuide(nested({}, 2), { maxDepth: 2 });
  assert.equal(exactDepthMiss.diagnostic, null);
  assert.deepEqual(exactDepthMiss.sizeGuide.tables, []);
  assert.deepEqual(input, snapshot);
});

test('Size Guide does not report a cutoff when a deep alias is later scanned in range', () => {
  const shared = sizeTable('CM');
  const input = { deep: nested(shared, 3), shallow: shared };

  const inspection = core.inspectSizeGuide(input, { maxDepth: 3 });

  assert.equal(inspection.diagnostic, null);
  assert.deepEqual(inspection.sizeGuide.tables.map((table) => table.unit), ['CM']);
  assert.equal(input.shallow, shared);
});

test('Gallery complete success, miss, and conflict keep their existing semantics', () => {
  const first = galleryCandidate('first');
  const duplicate = clone(first);
  const conflict = galleryCandidate('conflict');
  const input = { first, duplicate };
  const snapshot = clone(input);

  const complete = core.inspectGalleryFromSsrData(input, 'item');
  assert.equal(complete.diagnostic, null);
  assert.equal(complete.gallery.items[0].imageUrl, 'https://example.com/first.jpg');
  assert.deepEqual(core.inspectGalleryFromSsrData({ unrelated: true }, 'item'), {
    gallery: null,
    diagnostic: null,
  });
  assert.deepEqual(core.inspectGalleryFromSsrData({ first, conflict }, 'item'), {
    gallery: null,
    diagnostic: null,
  });
  assert.deepEqual(input, snapshot);
});

test('Gallery maxVisited fails closed before and after a plausible candidate', () => {
  const before = { candidate: galleryCandidate('only') };
  const after = {
    ...galleryCandidate('plausible'),
    hiddenConflict: galleryCandidate('conflict'),
  };
  const snapshot = clone(after);

  for (const input of [before, after]) {
    assert.deepEqual(core.inspectGalleryFromSsrData(input, 'item', { maxVisited: 1 }), {
      gallery: null,
      diagnostic: 'traversal-limit',
    });
    assert.equal(core.extractGalleryFromSsrData(input, 'item', { maxVisited: 1 }), null);
  }
  assert.deepEqual(after, snapshot);
});

test('Gallery maxDepth fails closed only when an object subtree is actually cut', () => {
  const input = {
    ...galleryCandidate('plausible'),
    hiddenConflict: nested(galleryCandidate('conflict'), 3),
  };
  const snapshot = clone(input);

  assert.deepEqual(core.inspectGalleryFromSsrData(input, 'item', { maxDepth: 3 }), {
    gallery: null,
    diagnostic: 'traversal-limit',
  });
  assert.equal(core.extractGalleryFromSsrData(input, 'item', { maxDepth: 3 }), null);
  assert.deepEqual(core.inspectGalleryFromSsrData(nested({}, 3), 'item', { maxDepth: 3 }), {
    gallery: null,
    diagnostic: null,
  });
  assert.deepEqual(input, snapshot);
});

test('Generic descendant inspection discards partial values at visited and depth limits', () => {
  const predicate = (value) => value.hit === true;
  const first = { hit: true, id: 'first' };
  const second = { hit: true, id: 'second' };
  const completeInput = { first, second };
  const snapshot = clone(completeInput);

  assert.deepEqual(core.inspectObjectDescendants(completeInput, predicate), {
    values: [second, first],
    diagnostic: null,
  });
  assert.deepEqual(core.inspectObjectDescendants({ candidate: first }, predicate, { maxVisited: 1 }), {
    values: null,
    diagnostic: 'traversal-limit',
  });
  const afterCandidate = { hit: true, hidden: second };
  assert.deepEqual(core.inspectObjectDescendants(afterCandidate, predicate, { maxVisited: 1 }), {
    values: null,
    diagnostic: 'traversal-limit',
  });
  assert.deepEqual(core.inspectObjectDescendants({ hit: true, hidden: nested(second, 2) }, predicate, { maxDepth: 2 }), {
    values: null,
    diagnostic: 'traversal-limit',
  });
  assert.deepEqual(core.inspectObjectDescendants(nested({}, 2), predicate, { maxDepth: 2 }), {
    values: [],
    diagnostic: null,
  });
  assert.deepEqual(completeInput, snapshot);
});

test('Generic descendant limits ignore exhausted duplicate aliases, including a later shallow path', () => {
  const predicate = (value) => value.hit === true;
  const shared = { hit: true };

  assert.deepEqual(core.inspectObjectDescendants({ one: shared, two: shared }, predicate, { maxVisited: 2 }), {
    values: [shared],
    diagnostic: null,
  });
  assert.deepEqual(core.inspectObjectDescendants({ shallow: shared, deep: nested(shared, 2) }, predicate, { maxDepth: 2 }), {
    values: [shared],
    diagnostic: null,
  });
});

test('Aggregate SSR defaults completely scan the observed live depth-66 shape', () => {
  const itemId = '100';
  const observedDepthBranch = nested({}, 65);
  const galleryRoot = { ...galleryCandidate('observed'), observedDepthBranch };
  const storeRoot = { ...storeCandidate('First Store', itemId), observedDepthBranch };
  const ratingRoot = { ...ratingCandidate(itemId, '5.0', 5), observedDepthBranch };
  const reviewRoot = contextWidget({
    tabs: tabsWidget(itemId, '5.0', { feedback: feedbackWidget(5, 2) }),
    observedDepthBranch,
  });

  assert.equal(core.inspectGalleryFromSsrData(galleryRoot, 'item').diagnostic, null);
  assert.equal(core.inspectStoreFromSsrData(storeRoot, itemId).diagnostic, null);
  assert.equal(core.inspectBasicRatingFromSsrData(ratingRoot, itemId).diagnostic, null);
  assert.equal(core.inspectReviewSummaryFromSsrData(reviewRoot, itemId).diagnostic, null);
  assert.equal(core.inspectObjectDescendants(
    { hit: true, observedDepthBranch },
    (value) => value.hit === true,
  ).diagnostic, null);
});

test('Store item existence preserves early success and diagnoses only an incomplete miss', () => {
  const itemId = '100';
  const early = { itemId, unvisited: nested({ itemId: 'other' }, 2) };
  const snapshot = clone(early);

  assert.deepEqual(core.inspectExpectedStoreItem(early, itemId, { maxVisited: 1 }), {
    matched: true,
    diagnostic: null,
  });
  assert.equal(core.containsExpectedStoreItem(early, itemId, { maxVisited: 1 }), true);
  assert.deepEqual(core.inspectExpectedStoreItem({ candidate: { itemId } }, itemId, { maxVisited: 1 }), {
    matched: false,
    diagnostic: 'traversal-limit',
  });
  assert.deepEqual(core.inspectExpectedStoreItem(nested({ itemId }, 3), itemId, { maxDepth: 2 }), {
    matched: false,
    diagnostic: 'traversal-limit',
  });
  assert.deepEqual(core.inspectExpectedStoreItem(nested({ itemId }, 2), itemId, { maxDepth: 2 }), {
    matched: true,
    diagnostic: null,
  });
  assert.deepEqual(core.inspectExpectedStoreItem(nested({}, 2), itemId, { maxDepth: 2 }), {
    matched: false,
    diagnostic: null,
  });
  assert.deepEqual(early, snapshot);
});

test('Store props distinguish analytics UNKNOWN from independently sufficient chat evidence', () => {
  const itemId = '100';
  const analytics = { nested: { itemId } };
  const analyticsOnly = storeProps('First Store', itemId, { chat: false, analytics });
  const chatBound = storeProps('First Store', itemId, { analytics: clone(analytics) });
  const snapshot = clone({ analyticsOnly, chatBound });

  assert.deepEqual(core.inspectStoreFromSsrProps(analyticsOnly, itemId, { maxVisited: 1 }), {
    store: null,
    diagnostic: 'traversal-limit',
  });
  assert.equal(core.storeFromSsrProps(analyticsOnly, itemId, { maxVisited: 1 }), null);

  const chatInspection = core.inspectStoreFromSsrProps(chatBound, itemId, { maxVisited: 1 });
  assert.equal(chatInspection.diagnostic, null);
  assert.equal(chatInspection.store.name, 'First Store');

  const analyticsSuccess = core.inspectStoreFromSsrProps(
    storeProps('First Store', itemId, { chat: false, analytics: { itemId } }),
    itemId,
    { maxVisited: 1 },
  );
  assert.equal(analyticsSuccess.diagnostic, null);
  assert.equal(analyticsSuccess.store.name, 'First Store');
  assert.deepEqual({ analyticsOnly, chatBound }, snapshot);
});

test('Outer Store scan fails closed at its own limits and keeps complete conflict semantics', () => {
  const itemId = '100';
  const first = storeCandidate('First Store', itemId);
  const second = storeCandidate('Second Store', itemId);
  const before = { candidate: first };
  const after = { ...first, hiddenConflict: second };
  const depthInput = { ...first, hiddenConflict: nested(second, 4) };
  const snapshot = clone(depthInput);

  for (const input of [before, after]) {
    assert.deepEqual(core.inspectStoreFromSsrData(input, itemId, { maxVisited: 1 }), {
      store: null,
      diagnostic: 'traversal-limit',
    });
    assert.equal(core.extractStoreFromSsrData(input, itemId, { maxVisited: 1 }), null);
  }
  assert.deepEqual(core.inspectStoreFromSsrData(depthInput, itemId, { maxDepth: 4 }), {
    store: null,
    diagnostic: 'traversal-limit',
  });
  assert.deepEqual(core.inspectStoreFromSsrData(nested({}, 4), itemId, { maxDepth: 4 }), {
    store: null,
    diagnostic: null,
  });
  assert.deepEqual(core.inspectStoreFromSsrData({ first, second }, itemId), {
    store: null,
    diagnostic: null,
  });
  assert.deepEqual(depthInput, snapshot);
});

test('Outer Store scan propagates necessary analytics limits but skips them for trusted chat', () => {
  const itemId = '100';
  const analytics = { nested: { itemId } };
  const analyticsOnly = storeCandidate('First Store', itemId, { chat: false, analytics });
  const chatBound = storeCandidate('First Store', itemId, { analytics: clone(analytics) });

  assert.deepEqual(core.inspectStoreFromSsrData(analyticsOnly, itemId, {
    analytics: { maxVisited: 1 },
  }), {
    store: null,
    diagnostic: 'traversal-limit',
  });
  const trusted = core.inspectStoreFromSsrData(chatBound, itemId, {
    analytics: { maxVisited: 1 },
  });
  assert.equal(trusted.diagnostic, null);
  assert.equal(trusted.store.name, 'First Store');

  const fixture = loadFixture('store-ssr-1005009452926938.json');
  const captured = core.inspectStoreFromSsrData(fixture.fragment, fixture.itemId);
  assert.equal(captured.diagnostic, null);
  assert.equal(captured.store.name, 'WLIN OOTD Store');
});

test('Outer Store scan ignores analytics limits for props that cannot normalize to a candidate', () => {
  const itemId = '100';
  const nonCandidate = {
    props: {
      positiveReviews: null,
      analytics: nested({ itemId }, 2),
    },
  };
  const trusted = storeCandidate('First Store', itemId);

  const inspection = core.inspectStoreFromSsrData({ nonCandidate, trusted }, itemId, {
    analytics: { maxVisited: 1 },
  });

  assert.equal(inspection.diagnostic, null);
  assert.equal(inspection.store.name, 'First Store');
});

test('Review summary complete success and ordinary field conflict remain non-limit results', () => {
  const itemId = '100';
  const complete = contextWidget({
    tabs: tabsWidget(itemId, '5.0', { feedback: feedbackWidget(5, 2) }),
  });
  const conflict = contextWidget({
    tabs: tabsWidget(itemId, '5.0', {
      first: feedbackWidget(5, 2),
      second: feedbackWidget(6, 2),
    }),
  });
  const snapshot = clone({ complete, conflict });

  const success = core.inspectReviewSummaryFromSsrData(complete, itemId);
  assert.equal(success.diagnostic, null);
  assert.equal(success.summary.rating, 5);
  assert.equal(success.summary.reviewCount, 5);
  assert.equal(success.summary.contentFeedbackCount, 2);
  assert.deepEqual(core.extractReviewSummaryFromSsrData(complete, itemId), success.summary);

  const conflicted = core.inspectReviewSummaryFromSsrData(conflict, itemId);
  assert.equal(conflicted.diagnostic, null);
  assert.equal(conflicted.summary.rating, 5);
  assert.equal(conflicted.summary.reviewCount, null);
  assert.equal(conflicted.summary.contentFeedbackCount, 2);
  assert.deepEqual(core.inspectReviewSummaryFromSsrData(complete, null, {
    contexts: { maxVisited: 1 },
  }), {
    summary: null,
    diagnostic: null,
  });
  assert.deepEqual({ complete, conflict }, snapshot);
});

test('Review summary propagates maxVisited from context, tabs, and feedback collection', () => {
  const itemId = '100';
  const validTabs = tabsWidget(itemId, '5.0', { feedback: feedbackWidget(5, 2) });
  const otherTabs = tabsWidget(itemId, '4.0', { feedback: feedbackWidget(6, 3) });
  const scenarios = [
    {
      root: contextWidget({ visibleTabs: validTabs, hiddenContext: contextWidget({ tabs: otherTabs }) }),
      limits: { contexts: { maxVisited: 1 } },
    },
    {
      root: contextWidget({ hiddenTabs: otherTabs, visibleTabs: validTabs }),
      limits: { tabs: { maxVisited: 2 } },
    },
    {
      root: contextWidget({
        tabs: tabsWidget(itemId, '5.0', {
          hiddenFeedback: feedbackWidget(6, 3),
          visibleFeedback: feedbackWidget(5, 2),
        }),
      }),
      limits: { feedback: { maxVisited: 2 } },
    },
  ];

  for (const { root, limits } of scenarios) {
    const snapshot = clone(root);
    assert.deepEqual(core.inspectReviewSummaryFromSsrData(root, itemId, limits), {
      summary: null,
      diagnostic: 'traversal-limit',
    });
    assert.equal(core.extractReviewSummaryFromSsrData(root, itemId, limits), null);
    assert.deepEqual(root, snapshot);
  }
});

test('Review summary propagates real depth cutoffs from every collection stage', () => {
  const itemId = '100';
  const tabs = tabsWidget(itemId, '5.0', { feedback: feedbackWidget(5, 2) });
  const scenarios = [
    {
      root: nested(contextWidget({ tabs }), 2),
      limits: { contexts: { maxDepth: 1 } },
    },
    {
      root: contextWidget({ nestedTabs: { tabs } }),
      limits: { tabs: { maxDepth: 1 } },
    },
    {
      root: contextWidget({ tabs: tabsWidget(itemId, '5.0', { nestedFeedback: { feedback: feedbackWidget(5, 2) } }) }),
      limits: { feedback: { maxDepth: 1 } },
    },
  ];

  for (const { root, limits } of scenarios) {
    assert.deepEqual(core.inspectReviewSummaryFromSsrData(root, itemId, limits), {
      summary: null,
      diagnostic: 'traversal-limit',
    });
  }
});

test('Basic rating keeps complete success/conflict semantics and rejects visited partials', () => {
  const itemId = '100';
  const first = ratingCandidate(itemId, '5.0', 5);
  const conflict = ratingCandidate(itemId, '4.0', 6);
  const complete = core.inspectBasicRatingFromSsrData({ candidate: first }, itemId);
  assert.equal(complete.diagnostic, null);
  assert.equal(complete.summary.rating, 5);
  assert.equal(complete.summary.reviewCount, 5);
  assert.deepEqual(core.inspectBasicRatingFromSsrData({ first, conflict }, itemId), {
    summary: null,
    diagnostic: null,
  });

  const before = { candidate: first };
  const after = { ...first, hiddenConflict: conflict };
  const snapshot = clone(after);
  for (const input of [before, after]) {
    assert.deepEqual(core.inspectBasicRatingFromSsrData(input, itemId, { maxVisited: 1 }), {
      summary: null,
      diagnostic: 'traversal-limit',
    });
    assert.equal(core.extractBasicRatingFromSsrData(input, itemId, { maxVisited: 1 }), null);
  }
  assert.deepEqual(after, snapshot);
});

test('Basic rating maxDepth fails closed without flagging a fully scanned boundary leaf', () => {
  const itemId = '100';
  const first = ratingCandidate(itemId, '5.0', 5);
  const conflict = ratingCandidate(itemId, '4.0', 6);
  const input = { ...first, hiddenConflict: nested(conflict, 4) };

  assert.deepEqual(core.inspectBasicRatingFromSsrData(input, itemId, { maxDepth: 4 }), {
    summary: null,
    diagnostic: 'traversal-limit',
  });
  assert.deepEqual(core.inspectBasicRatingFromSsrData(nested({}, 4), itemId, { maxDepth: 4 }), {
    summary: null,
    diagnostic: null,
  });
});

test('ProductData first-match inspection distinguishes complete miss from truncated miss', () => {
  const candidate = productDataCandidate('candidate');
  const completeMiss = { unrelated: {} };

  assert.deepEqual(core.inspectProductDataCandidate(completeMiss), {
    candidate: null,
    diagnostic: null,
  });
  assert.deepEqual(core.inspectProductDataCandidate({ candidate }, { maxVisited: 1 }), {
    candidate: null,
    diagnostic: 'traversal-limit',
  });
  assert.equal(core.findProductDataCandidate({ candidate }, { maxVisited: 1 }), null);
  assert.deepEqual(core.inspectProductDataCandidate(nested(candidate, 2), { maxDepth: 1 }), {
    candidate: null,
    diagnostic: 'traversal-limit',
  });
  assert.deepEqual(core.inspectProductDataCandidate(nested({}, 2), { maxDepth: 2 }), {
    candidate: null,
    diagnostic: null,
  });

  const cutoffBeforeLaterCandidate = {
    laterCandidate: candidate,
    higherPriorityCutoff: nested({}, 2),
  };
  assert.deepEqual(core.inspectProductDataCandidate(cutoffBeforeLaterCandidate, { maxDepth: 1 }), {
    candidate: null,
    diagnostic: 'traversal-limit',
  });
});

test('ProductData first match remains successful before a limit and exactly at maxDepth', () => {
  const first = productDataCandidate('first');
  const second = productDataCandidate('second');
  const rootCandidate = { ...second, hidden: nested(first, 4) };
  const snapshot = clone(rootCandidate);

  const early = core.inspectProductDataCandidate(rootCandidate, { maxVisited: 1, maxDepth: 1 });
  assert.equal(early.diagnostic, null);
  assert.equal(early.candidate.data, rootCandidate);
  assert.equal(early.candidate.path, '$');
  assert.equal(core.findProductDataCandidate(rootCandidate, { maxVisited: 1, maxDepth: 1 }).data, rootCandidate);

  const orderedRoot = { first, second };
  const ordered = core.inspectProductDataCandidate(orderedRoot, { maxVisited: 2 });
  assert.equal(ordered.diagnostic, null);
  assert.equal(ordered.candidate.data, second);
  assert.equal(ordered.candidate.path, '$.second');

  const exactRoot = nested(first, 2);
  const exact = core.inspectProductDataCandidate(exactRoot, { maxDepth: 2 });
  assert.equal(exact.diagnostic, null);
  assert.equal(exact.candidate.data, first);
  assert.deepEqual(rootCandidate, snapshot);
});
