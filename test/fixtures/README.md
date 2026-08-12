# AliExpress captured fixtures

The `product-*.json` files are automatically minimized, account-free fragments
of two captured AliExpress `productData` responses used as project regression
references. Their
captured structural values are unchanged: the `{ "data": ... }` API wrapper,
variant IDs/names, every retained SKU ID and `priceList` combination, prices,
stocks, and the real `byCountryTables -> byUnitTables` size-table shape.

Unrelated gallery, description, analytics, tracking, authentication, and account
data were omitted during automatic minimization. Captured price and stock values
are historical regression data, not assertions about current live offers;
AliExpress can change them by region, session, and time.

Tests pass `fixture.data` to `normalizeProduct()` and must not reshape fixtures
to suit parser code. Synthetic objects remain acceptable only for isolated
generic unit tests and must not be described as captured data. When AliExpress
changes its schema, capture and minimize a new response, document the difference,
and update the regression expectations deliberately.

`shipping-calculate-1005008195850531.json` is a minimized capture of the real
AliExpress `freight/calculate` request and response observed through the passive
Tampermonkey probe. Its retained request, destination, method, price, and ETA
values are unchanged captured values, not a synthetic reconstruction. The
destination at capture time was Moldova / Kishinev. Analytics (`aerEvent`),
unrelated tracking noise, irrelevant null fields, and account-sensitive data
were omitted.
Shipping price, dates, ETA, availability, and destination-dependent results are
historical and can vary by region, session, and time.

`characteristics-1005009452926938.json` records a minimal live DOM observation
from the AliExpress product page on 2026-08-11. The retained class fragments,
five name/value pairs, their order, text-only value markup, and absence of
partial rows were observed directly. The same ordered pairs were present for
the two recorded SKU IDs, so this fixture documents product-level behavior for
that observation rather than asserting that every AliExpress product behaves
the same way. SSR `#__AER_DATA__` exposed only widget configuration on that
page, not the characteristic pairs. Values are historical and may change by
locale, region, session, or time.

The `description-*.json` files contain minimized, exact, contiguous HTML
fragments recaptured from each product's scoped `#content_anchor` on
2026-08-11. The relay fixture retains one text fragment with real `<br>`
boundaries and one separate fragment where seller text is followed by two
images. The dress fixture retains the observed single `<h1>` whose four images
precede its `A/B` text. Observation metadata records full-boundary lengths and
counts without storing the complete 9 KB / 4.7 KB seller descriptions. These
fixtures contain no account, authentication, cookie, analytics, or tracking
data. Synthetic parser cases remain explicitly synthetic in the test names.

The `rating-trade-*.json` files are minimized records of live observations made
on 2026-08-12 after fresh product-page reloads. They combine primitive values
observed in the existing `#__AER_DATA__` review widget with text from the scoped
`HazeProductDescription` product header. They are deliberately not represented
as original AliExpress response wrappers: analytics/tracking objects were not
retained, only the raw rating primitive, trusted field paths, review count,
separately observed (unused) feedback count, DOM display strings, stable class
fragments, and expected P1 normalization. Bought counts were confirmed only in
the scoped hydrated DOM. The current dress rating of 4.6 is a dated live value
and does not replace older historical roadmap observations such as 4.8.

A follow-up Tampermonkey smoke on 2026-08-12 confirmed the normalized rating
and review values for both reference items. The relay still displayed 13
bought. The dress displayed 414 bought on the later reload, one more than the
413 captured in its fixture; this is expected live counter drift and the
historical fixture remains unchanged. Additional item `1005005933779962`
confirmed rating 4.8, 66 reviews, and 337 bought, and was used to verify that
explicit pre-export hydration preserves rating/trade, seven characteristics,
and seller description together.
