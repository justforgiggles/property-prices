# Home Atlas: visual city reports

This framework records the approved visual polish of Home Atlas. It supersedes the original province-led discovery brief and the subsequent twelve-visible-row tables. The underlying [property intelligence research](property-intelligence-research.md) still defines the analytical evidence and its limitations.

## Product manager: audience and promise

Home Atlas helps homebuyers and relocating households understand recorded asking prices by city. A visitor chooses a city, reads a fixed report, and can open a separate city comparison. There are no budget, bedroom or property-type filters to configure.

Every city uses the same layout, copy and evidence rules. Show supported home categories; omit unsupported bedroom rows, empty property sections and their jump links. Never replace missing evidence with another bedroom count, a pooled city median or an expanded publication window. Comparisons show matching categories supported in both cities.

The product includes a city directory, city reports, canonical city comparisons and an About the data page. There are no province overview pages, suburb pages, rankings or personalised comparison states. Province names remain geographic labels and URL identifiers.

## Product marketer and copywriter: positioning

Landing promise: **“Understand home asking prices, city by city.”**

Supporting copy: “Explore what houses, flats and townhouses are advertised for. Choose a city to see how asking prices vary by home type and bedroom count.”

City headline: **“Home asking prices in [City].”** Introduction: “Explore asking-price ranges by home type and bedroom count.”

Pair headline: **“[City A] vs [City B].”** Introduction: “Compare asking-price ranges for matching home types and bedroom counts.” The eyebrow and metadata identify the subject as home asking prices.

Use plain editorial language. Say **middle half**, **listing records**, **About these figures** for row disclosures, **About the data** for methodology links and **Choose a city to compare** for the chooser. Describe asking-price differences neutrally. Do not infer sale values, availability, quality, demand, growth or an overall winner.

Home Atlas remains a working brand; name and domain availability have not been checked.

## UI/UX designer: top-down page structure

The landing page puts the city search in the opening section beside the retained headline. Six editorial shortcuts appear in this fixed order: Cape Town, Johannesburg, Pretoria, Durban, Blouberg and Sandton. Omit a shortcut if its city is unpublished. The order makes no popularity or quality claim. Follow with **All city reports**, an alphabetical directory filtered by the opening search, then a short explanation and About the data link. Search has a clear count, empty state and reset action.

City pages contain the title, short introduction, publication dates, links to the supported sections, one omission note and a compact chart legend. Each supported home type contains bedroom cards showing a median, middle-half range, listing-record count and percentile plot. Qualifications remain visible; full reasons and all five values are in native disclosures. Finish with the eligible-city chooser and a concise data note.

Pair pages use the same structure, with links to both city reports. Each shared bedroom card stacks the two city distributions on the same scale. Green identifies the first city; muted terracotta identifies the second. City names remain visible, so colour is never the sole identifier. The rand and percentage median difference is secondary and names both the comparison city and its reference.

Empty sections and their navigation anchors are omitted. The single-city omission note is **“Only home categories with enough consistent evidence are shown.”** A pair explains that support is required in both cities. Comparison search only includes eligible partners and its empty state describes that scope.

## Design system and plotting rules

Retain the existing ivory, green and editorial typography. Fraunces Variable supplies headings; Manrope Variable supplies body text, controls and data. Fonts are bundled locally. Existing customised shadcn/ui controls remain the foundation.

| Token   | Value     |
| ------- | --------- |
| Canvas  | `#F7F5EF` |
| Surface | `#FFFFFF` |
| Ink     | `#172C28` |
| Muted   | `#52645D` |
| Primary | `#195C46` |
| Accent  | `#B75C3B` |
| Border  | `#D9E0D9` |

The plot uses **P5, P25, median, P75 and P95**. The whisker is the middle 90%; the box is the middle half; the median is a distinct marker. Raw minimum/maximum values are deliberately not chart endpoints because extreme listings can overwhelm otherwise useful distributions.

Use one labelled, rounded, outward-padded **linear** scale per property-type section. It includes every visible bedroom count and both cities in a pair. Do not clamp prices or scale each row independently. Scales can differ between property types. Coincident values share one position; all-five-equal data renders a single marker rather than invented spread.

Median, middle-half range and listing count are always visible. Native disclosures reveal all five currency values and full qualification reasons without hover or JavaScript. SVG accessible names describe the city, category and five values. The plots are server-rendered and require no chart library.

The noindex `/design-system/` showcase is the component reference. It includes real city/pair reports, sparse evidence and explicit tied/all-equal percentile fixtures. Components were defined and visually checked there before public page assembly.

## Data engineering: evidence and presentation

The TypeScript generator and Python reference checks remain authoritative. The compact public artifact contains provenance, internal twelve-row city matrices and canonical eligible pairs. The internal matrix covers houses, flats and townhouses with bedrooms 1–4; it is not a requirement to display twelve rows.

`PriceRow` includes nullable `p5`, `p25`, `median`, `p75`, `p95`, listing count, evidence status, full reasons and `qualificationLabels`. Compute percentiles from sorted price-frequency pairs using linear interpolation at rank `(count - 1) × p`, equivalent to expanding every recorded price. Unsupported rows retain five null prices. Existing eligibility and cleaning rules are unchanged.

A city needs at least 100 cleaned records in the primary window and one supported category. A pair needs at least one identical supported category on both sides. `getSupportedRows` and `getSharedRows` select the rendered rows. Only eligible destinations are linked or exported.

Supported summaries require at least 30 records and stable support under both duplicate variants and the R100k–R50m price guard. The main-window figures are not trimmed by that sensitivity guard. Existing 30/60/180-day window checks produce structured visible notes: **“Prices vary with the listing window.”** and **“Shorter-window samples are small.”** Full explanatory reasons remain in the disclosure.

Rand difference = second-city median minus first-city median. Percentage difference = the signed difference divided by first-city median, multiplied by 100. Display whole-rand headline differences and one decimal percentage; equal medians receive an explicit label. These are descriptive sample gaps, not estimates of a location premium.

The source window ending 21 October 2026 yields **71 city reports and 2,289 canonical pairs**. These are generated results, never hardcoded eligibility targets. Current published rows have all P5 values at or above R100k and all P95 values at or below R50m; the plot code does not impose those limits.

## Engineering: static delivery

Keep Next.js App Router static export and customised shadcn/ui foundations:

- `/`: opening search, shortcuts and city directory.
- `/<province>/<city>/`: fixed city report.
- `/compare/<province-a>/<city-a>/vs/<province-b>/<city-b>/`: fixed comparison.
- `/methodology/`: definitions, checks and limitations.
- `/design-system/`: noindex component reference.

City keys are `province/city`. Pair order follows ASCII key order, independent of which city the visitor started from. Generate one page per eligible unordered pair. Reversed, self, unknown and ineligible pairs have no page. Removed province and suburb paths return the static not-found page. Obsolete query parameters do not alter report content.

Build scripts generate `.generated/reports.json`. Server components cache the catalog per process and render every report into exported HTML. Only city keys, names, province labels and destination URLs reach interactive directory/chooser components. No raw records, price-frequency arrays or duplicate distributions are sent to those client components. No database, runtime API or server is required.

Search requires JavaScript; the complete directory, reports, links, chooser and disclosures remain usable without it. Set `SITE_URL` at build time for real canonical URLs and a sitemap. No hosting changes are included.

## Validation

Verify weighted quantiles against expanded interpolation and published tails against pandas. Unit tests cover supported/shared filtering, qualifications, suppressed prices, canonical eligibility, signed differences, shared scale geometry, tied values and all-five-equal distributions.

Inspect every exported city and pair for its expected supported categories, plot count, section anchors and jump links. Confirm no province or reverse-pair pages exist. Browser checks cover shortcuts, search and empty states, keyboard disclosure/chooser operation, canonical same- and cross-province navigation, shared scales, sparse reports, no-JavaScript content, ignored query parameters and 320/390/1440px layouts. Visually review the landing, city, pair and component pages on desktop and mobile, then perform a holistic copy audit.

See the [package README](../packages/website/README.md) for commands.
