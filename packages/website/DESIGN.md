# Prop Radar website design reference

Baseline agreed on 26 October 2026. Use this reference for new pages and design
changes; record intentional departures and their reasons here.

## Audience and promise

The primary readers are South African property buyers and sellers. The landing
page helps them understand the recorded listing coverage for their city. It does
not provide active inventory, transactions, unique-property counts, valuations,
or live city analytics. City overview pages currently demonstrate the layout with
clearly labelled illustrative figures. Match claims and controls to capabilities that exist.

Use the definitions of listing, city, reporting window, and data refresh in the
[project glossary](../../GLOSSARY.md). Operational data rules and deployment
commands live in the [README](../../README.md#website).

## Reusable visual principles

- A restrained editorial feel: warm cream surfaces, forest-green text, muted sage
  secondary text, and fine rules. The report inspired the palette, but the website
  deliberately uses a looser, conventional UI treatment.
- Light-only, system sans-serif typography. Use weight, scale, and spacing to
  establish hierarchy; avoid decoration that implies data we do not have.
- Keep the radar mark's geometry and tracked uppercase PROP RADAR wordmark.
  Small icons use the radar alone. Agent branding in `forms/` is unrelated.
- Official shadcn components supply the UI primitives. Tailwind classes provide
  layout and refinement. `app/globals.css` is the colour/token source of truth
  and contains only framework imports and theme definitions.
- Keep components and dependencies small. Repeated Tailwind classes are fine;
  introduce abstractions only when an actual shared behaviour needs them.

## Landing-page decisions

The page contains only the thin update/total banner, left-aligned masthead,
centered hero and search, city-card grid, and copyright footer. The banner date
and total form separate lines on small screens. The grid uses one, two, and three
columns across mobile, tablet, and desktop.

City cards have two areas separated by a fine rule: city/province identity above,
then a standalone count with its meaning below. The city is 22px semibold and
the count is 36px medium-weight with tabular figures. This replaced an inline
statistic whose hierarchy was too weak. Quiet cream surfaces, subtle borders,
modest corners, and no shadows keep a long grid readable.

Cards link to city overview previews. The whole card is a single accessible link,
with subtle border/background hover treatment and a visible keyboard focus ring;
avoid hover lift or shadows. The city remains prominent so readers can locate their place;
the metric is not a claim about demand, popularity, or market strength.

Only cities with more than 20 listings appear, ordered by count descending with
alphabetical ties. Search matches city names only. The banner total covers all
recorded listings and stays unchanged during filtering. These are presentation
choices, not changes to the underlying dataset.

## Copy and content

Use direct, factual language for buyers and sellers. The approved headline is
“A local view of property listings.” Counts are labelled “Recorded listings” and
“Published in the past 90 days.” Keep the distinction between publication and
collection dates intact. SEO wording and sharing requirements live in [SEO.md](SEO.md).

The user explicitly chose a minimal page without additional coverage explanations,
disclaimers, navigation, or sections. Adding those is a product/design change,
not a routine copy improvement. Retain the small copyright footer.

## City overview preview

The city page shares the banner, linked radar masthead, container, and footer with
the landing page. The banner retains its real site-wide 90-day count; city analytics
are separate illustrative fixtures. A centred city heading and province label lead
into a short subtext and “Illustrative data · July–September 2026” label.

The introduction is two columns on desktop: buyer/seller-oriented summary copy,
then a quiet card with typical asking price, the middle-half range, typical price
per m², and listing count. It remains city-wide when bedroom selection changes.

Below, shadcn tabs select All bedrooms, 1, 2, 3, 4, or 5+ bedrooms. All is the default
and may include listings without a bedroom classification. Every section below the
tabs follows the selection. In order: two matching price/range cards; listing-count
bars beside a median asking-price line and shaded 25th–75th percentile band; then
reported rates and taxes beside horizontal price-distribution bars. Percentiles
are not stacked as additive quantities. Charts use the official shadcn/Recharts
components and forest/sage theme tokens, with explicit labels and hover details.

Price bands are Under R1m, R1m–R2m, R2m–R3m, R3m–R5m, and R5m+, labelled with both
percentage and count. Rates and taxes show the median and middle half without
asserting a monthly billing period. All city metrics use the three completed
calendar months July–September 2026; the same deterministic sample appears across
cities. These are design fixtures, not calculations from the directory or report.

On mobile the sections stack in reading order and the tabs scroll within their
own strip. Keep figures readable, charts keyboard-accessible, and range values
available as text. The PDF is a reference for interpreting metrics, while the
landing page remains the visual anchor. These reversible choices belong here,
rather than in a separate ADR. Data integration is deferred.

## Review changes

Inspect mobile and desktop layouts, long city names, large/small counts, empty
results, wrapping, focus, contrast, and heading structure. Preserve search and
count semantics. Verify exported assets under the production base path and update
the SEO reference when page purpose or public URLs change.

Visual decisions are reversible, so this living reference is preferable to a
separate ADR for every styling choice. Add rationale when replacing a decision;
keep the glossary for domain vocabulary, not implementation notes.
