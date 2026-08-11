# AliExpress product fixtures

These files are minimized, account-free fragments of the two captured
`productData` shapes used as project regression references. They retain the API
nesting, variant IDs/names, `priceList` combinations, selected-SKU relationship,
and real `byCountryTables -> byUnitTables` size-table shape needed by the tests.

Unrelated gallery, description, analytics, tracking, authentication, and account
data are omitted. Price and stock values are retained only as small parser/state
examples and are not assertions about current live offers; AliExpress can change
them by region, session, and time.

Do not reshape these JSON files to suit parser code. When AliExpress changes its
schema, capture and minimize a new response, document the difference, and update
the regression expectations deliberately.
