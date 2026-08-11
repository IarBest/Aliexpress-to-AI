# AliExpress product fixtures

These files are automatically minimized, account-free fragments of two captured
AliExpress `productData` responses used as project regression references. Their
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
