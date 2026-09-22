# Raw data

The data package writes Property24 `{ "id": number, "jsonld": [...], "ratesAndTaxes": number | null }` records to `raw/YYYY-MM-DD.jsonl`, one file per publication day. The historical records are backfilled from their listing pages; unavailable pages have `null` and are recorded in `rates-and-taxes-backfill-failures.jsonl`. New listings are captured once by `npm run scrape`. Unparseable values and their listing URLs are recorded in the corresponding parse-error log. Review and commit new dated files after each crawl.
