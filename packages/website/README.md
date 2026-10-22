# Home Atlas

Fixed city reports and city-versus-city reports for captured residential asking prices in Gauteng, Western Cape and KwaZulu-Natal. Built with Next.js App Router static export, Tailwind CSS and customised shadcn/ui foundations. Fonts are bundled locally; the exported site needs no database, API, model service or credentials.

See the [approved product/design framework](../../docs/home-atlas-website-plan.md) and [data research](../../docs/property-intelligence-research.md).

## Run locally

From the repository root, using Node.js 22 and after `npm ci`:

```sh
npm run website:dev
```

Open `http://localhost:3000`. Development and production builds first generate summaries from `data/raw/*.jsonl`.

```sh
npm run website:build
npm run preview -w @property-prices/website
```

The preview serves the actual static files at `http://127.0.0.1:4173`. Publish the contents of `packages/website/out/` to a static host serving directory `index.html` files and `404.html` for missing paths. No hosting changes are included here.

Set `SITE_URL` to the real HTTP(S) origin at build time to include canonical links and a sitemap. Without it, the build omits those URLs rather than inventing a domain. The component showcase is noindex and excluded from the sitemap.

## Reports and navigation

- `/`: opening city search, six editorial shortcuts and an alphabetical city directory.
- `/<province>/<city>/`: a fixed city report and a searchable chooser of eligible comparison partners.
- `/compare/<province-a>/<city-a>/vs/<province-b>/<city-b>/`: a fixed pair report, including cross-province comparisons.
- `/methodology/`: source, definitions and evidence rules.
- `/design-system/`: working visual reference using real reports and sparse states.

Reports consider houses, flats and townhouses with one to four bedrooms. City pages show only supported categories; pair pages show only matching categories supported in both cities. Empty sections and their jump links are omitted. Every shown row includes a median, middle-half range, listing-record count and percentile plot. Paired plots share a scale and include a secondary rand/percentage median difference. No city-wide winner is inferred.

The plot shows P5–P95 as a thin line, P25–P75 as a box and the median as a distinct marker. These are the middle 90% and middle half, not raw extrema. A rounded, padded linear scale is shared across every visible bedroom count in each property-type section, including both cities in a pair. Equal values share a position without inventing spread. Native “About these figures” disclosures provide all five values and the full qualification reasons. SVG charts render at build time with accessible text; there is no charting runtime.

Pairs have one canonical order, sorted by `province/city` identifiers. Every internal link uses that order. Reversed, self and unsupported pairs have no page. There are no province overview or suburb routes. Previous filter query parameters are ignored; there are no budget, bedroom or property-type controls. The city chooser navigates to a separate report.

All report figures and navigation links are present in exported HTML. Only directory search requires JavaScript; the comparison chooser expands and its links work without it.

## Data generation

`npm run generate -w @property-prices/website` writes ignored build artifacts to `.generated/`. `reports.json` is the compact public report catalog: provenance, twelve-row city matrices and canonical eligible pairs. Each `PriceRow` includes nullable `p5`, `p25`, `median`, `p75`, `p95`, record count, evidence status, full reasons and structured `qualificationLabels`. Window labels derive from the existing 30/60/180-day checks, never from parsing prose. Unsupported rows keep all five price fields null. `getSupportedRows` and `getSharedRows` define presentation eligibility. Broader catalog/province/city/audit files remain internal analytical output, preserving the earlier research and verification workflow.

The default analysis date is the latest valid source publication date, not the build date. The main window is 90 inclusive days. The generator accepts `--data-dir`, `--output-dir`, `--as-of YYYY-MM-DD` and `--generated-at ISO_TIMESTAMP`. Fixed inputs, analysis date and generation timestamp produce deterministic JSON.

For a historical export, run the generator with those arguments from this package, then `npm exec -- next build` and `node scripts/export-metadata.mjs`. The normal build command deliberately regenerates current data. Regenerate and restart the development server after raw data changes; server readers cache each generated catalog for the process lifetime.

A city needs at least 100 cleaned records and one supported category in the matrix. A pair needs at least one identical supported category on both sides. The source window ending 21 October 2026 produces 71 city reports and 2,289 comparisons; these counts are calculated, not hardcoded eligibility targets.

Price summaries require at least 30 records, support under both duplicate variants and a stable median under the R100k–R50m guardrail. Publication-window checks at 30, 60 and 180 days produce visible qualifications. These checks are unchanged by the report simplification. Unsupported rows retain null prices and their original record counts internally but are omitted from the public report. Captured asking prices are not verified sale values, available inventory, growth, demand or neighbourhood-quality measures.

Reports are rendered on the server at build time. Browser-side directory/chooser props contain only city keys, names, province labels and destination URLs. Neither raw records nor price-frequency/duplicate distributions are sent to those interactive components.

## Validation

```sh
npm run website:test
npm run lint -w @property-prices/website
npm run typecheck -w @property-prices/website
npm run verify:data -w @property-prices/website
npm run website:build
npm run test:export -w @property-prices/website
npm exec -w @property-prices/website -- playwright install chromium
npm run test:browser -w @property-prices/website
```

`verify:data` uses the existing `packages/model/.venv/bin/python` environment to compare cleaning, numeric/geographic fields, duplicate groups and evidence-check variants against the Python reference across the full source. The parity check also compares every published P5/P95 with pandas linear interpolation. Unit tests cover evidence boundaries, weighted quantiles, report matrices, suppressed prices, canonical eligibility, shared-row filtering, signed differences and plot geometry.

`test:export` reads every generated city and pair HTML file, verifies the exact supported row set, plot count, section/jump-link visibility and a page heading, and checks that removed province pages and reversed pairs are absent. Browser tests cover search, keyboard operation, canonical navigation, same- and cross-province pairs, native percentile disclosures, shared scales, sparse reports, coincident values, obsolete query parameters, no-JavaScript content and 320/390/1440px layouts.

## Structure

- `scripts/`: generation, reference verification, export checks/metadata and local preview.
- `src/lib/insights/`: internal analytical types/statistics and retained reference calculations.
- `src/lib/reports.ts`: public report projection, fixed matrix, pair eligibility and median differences.
- `src/lib/reports-server.ts`: cached build-time catalog and report lookups.
- `src/components/ui/`: shadcn/ui primitives.
- `src/components/atlas/`: shared navigation, headings and evidence disclosure.
- `src/components/reports.tsx`: server-rendered city and pair distribution cards.
- `src/components/price-plot.tsx`, `src/lib/price-plot.ts`: accessible SVG plots, legend and shared linear-scale geometry.
- `src/components/city-directory.tsx`: searchable directory and partner navigation.
- `src/app/globals.css`: theme foundations; `pages.css`: directory/report layouts.
