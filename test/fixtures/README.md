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
