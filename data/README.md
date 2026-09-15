# Raw data

The data package writes immutable-by-ID Property24 `{ "id": number, "jsonld": [...] }` records to `raw/YYYY-MM-DD.jsonl`, one file per publication day. These small date files are versionable and contain the genuine migrated raw history. Use `npm run import:raw -- /path/to/raw.jsonl` for additional raw records, then `npm run scrape` for new listings. Review and commit new dated files after each crawl.
