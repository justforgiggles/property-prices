# Prop Radar website design reference

Baseline agreed on 26 October 2026. Use this reference for new pages and design
changes; record intentional departures and their reasons here.

## Audience and promise

The primary readers are South African property buyers and sellers. The landing
page helps them understand the recorded listing coverage for their city. It does
not provide active inventory, transactions, unique-property counts, valuations,
or city reports. Match claims and controls to capabilities that exist.

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

Cards are informational: no arrows, pointer cursors, hover lift, or buttons without
a destination. The city remains prominent so readers can locate their place;
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

## Review changes

Inspect mobile and desktop layouts, long city names, large/small counts, empty
results, wrapping, focus, contrast, and heading structure. Preserve search and
count semantics. Verify exported assets under the production base path and update
the SEO reference when page purpose or public URLs change.

Visual decisions are reversible, so this living reference is preferable to a
separate ADR for every styling choice. Add rationale when replacing a decision;
keep the glossary for domain vocabulary, not implementation notes.
