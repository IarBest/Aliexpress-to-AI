# Ali Helper development contract

## Project purpose

Ali Helper is a Tampermonkey userscript for AliExpress, primarily `aliexpress.ru`.
Its responsibilities are:

- normalize `.com` / `.ru` item URLs;
- extract structured product data;
- convert source data into one normalized product model;
- export product data in human- and ChatGPT/AI-friendly forms;
- later add characteristics, seller description, shipping, and reviews.

This project is a read/copy/navigation helper. Keep implementation modular and
incremental; do not turn one change into a monolithic scraper.

## Safety boundary

The userscript must never automatically:

- add an item to cart or invoke Buy now;
- place or prepare an order;
- subscribe to a seller;
- send seller messages;
- modify a profile or other account data;
- perform any other account mutation.

Do not log, export, or inspect cookies, authentication tokens, secrets, or
account-sensitive data. Page reads, copying, and explicit navigation are the
allowed behaviors.

## Data-source priority

Use sources in this order:

1. structured API data already obtained by the page (`productData` or similar);
2. SSR data, `#__AER_DATA__`, and relevant page globals;
3. React props when they contain original data;
4. semantic DOM attributes and text;
5. ordinary rendered DOM;
6. artificial hover/click only as a last resort.

Do not simulate user actions when the same information already exists in a
structured source.

## SKU rules

- `skuInfo.priceList` is the source of truth for real SKU combinations.
- Never generate combinations using a Cartesian product of variant values.
- Join variants primarily through `propertyList[].values[].id` ↔
  `priceList[].skuPropIds`.
- Prefer `displayName` in human-facing output, but retain raw `name`.
- `skuAttr` may be retained as raw diagnostics, but must not drive the primary
  variant model.
- Resolve the selected SKU primarily from the current page/URL `sku_id`.
- Treat `productData.activeSkuId` only as a default/fallback: it may become
  stale after SPA variant changes.

## Regression references

### Single-dimension SKU

- Item: `1005008195850531`
- Expected group: `Bundle`
- Expected values: 7
- Expected real SKUs: 7

### Multi-dimension SKU

- Item: `1005009452926938`
- Investigated shape: `Color` has 9 values, `Size` has 5 values, and
  `priceList` contains 45 real combinations.
- SKU `12000049151727540` maps to `Color = Lining B Navy Blue` and `Size = L`.
- The raw Color `name` may be `Clear`; this is why `displayName` is required for
  human output.
- This product has genuine AliExpress `sizeData` with CM and IN tables.

Live availability can vary by region/session. Preserve these as parser
regressions and report current-site differences instead of silently changing
the expected relationships.

## Fixtures and tests

Prefer minimized, anonymized fixtures based on actual AliExpress responses over
invented or artificially improved shapes when testing AliExpress compatibility.
Do not alter a fixture merely to make broken parser code pass.

When changing a parser or normalized model:

1. add or update a regression test;
2. run the complete test suite;
3. verify expected counts and ID-to-variant relationships;
4. document any observed AliExpress schema difference.

Current verification commands:

```powershell
npm test
node --check src/ali-helper.user.js
```

If the local npm installation is unavailable, run the package's underlying
test command directly (`node --test`) and report the environment issue.

## SPA and runtime behavior

AliExpress is a dynamic React/SPA site. Account for:

- asynchronous `productData` requests;
- `sku_id` changes without a full reload;
- incomplete or null SKU data in SSR;
- CSS-module hashes changing between deployments.

DOM selectors must use stable semantic IDs, attributes, or class-name fragments,
never a complete generated CSS-module hash.

## Third-party DOM

Browser extensions can inject unrelated page elements. Megabonus, for example,
may inject store names. Scope seller/store extraction to known semantic
AliExpress containers; do not globally search for words such as `Store` or
`Seller` when a reliable boundary exists.

## Architecture

Preserve this dependency direction:

```text
URL/navigation
    ↓
data sources
    ↓
normalized product model
    ↓
exporters
    ↓
UI
```

Use one normalized product model for every exporter. Do not scrape DOM directly
inside a ChatGPT formatter. Prefer small, pure functions and keep source-specific
logic out of presentation code.

## Future shipping constraints

- Shipping comes from a separate `calculate` API whose payload is SKU-specific.
- Store shipping logically at SKU level and cache page-session results.
- `logisticAmount` in `productData.priceList` is not a shipping charge.
- Never automatically calculate shipping for hundreds of SKUs; default to the
  selected SKU and require an explicit, capped bulk action if one is added.

## Description constraints

- Short `productData.description` is not the full seller description.
- The confirmed current source is the scoped `#content_anchor`; its
  `innerHTML` is the working DOM source.
- Original React `dangerouslySetInnerHTML.__html` remains preferred only when it
  is actually discovered and captured. Do not write a speculative React/Fiber
  crawler or invent a React path.
- Preserve ordered text/image/heading/link blocks instead of flattening them
  into unrelated text and image lists.
- Automatic image downloading is not currently required.

## Future reviews constraints

Reviews are a separate future stage; do not implement them incidentally.

- The first review page may be present in SSR under `#__AER_DATA__`.
- Later pages use `product-reviews`.
- Initial and `additional` follow-up reviews must remain separate.
- A follow-up may have its own rating, including a null rating.

These facts are architecture constraints, not current implementation work.

## Local Tampermonkey live-test workflow

In the current maintainer Windows environment, Tampermonkey is configured to
pick up saved changes to `src/ali-helper.user.js` directly from the local
working tree.

For local/dirty live smoke tests:

- do not ask the maintainer to copy/paste the userscript into the Tampermonkey
  editor by default;
- after saving `src/ali-helper.user.js`, ask for a fresh reload of the target
  AliExpress page and verify the changed behavior;
- inability of browser automation to open `chrome-extension://...` Tampermonkey
  pages is not by itself a blocker for live testing in this environment;
- if the new behavior does not appear, first verify whether Tampermonkey picked
  up the saved local file before asking for manual installation or copy/paste.

This workflow is maintainer-environment-specific and must not be assumed for
other machines or contributors.

## Git workflow

Before editing:

- inspect `git status`, the current branch, and relevant diffs;
- preserve user changes and keep unrelated work separate;
- never use a destructive reset or force push.

After each complete logical change:

- run tests and syntax checks;
- inspect staged and unstaged diffs;
- stage only intended paths;
- use a clear commit message;
- push only a finished, verified state.

If the worktree was already dirty, do not mix pre-existing changes into the
current task without explicit reason and authorization.
