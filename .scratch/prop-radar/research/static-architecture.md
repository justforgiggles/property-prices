# Prop Radar: static implementation research

Research date and external-source retrieval date: 23 October 2026. Question: **Verify static implementation choices**. This note supplies evidence and a recommended implementation approach; it does not approve the analytics or visual design, and no website was scaffolded or built. Version numbers and CLI defaults are a dated snapshot and must be checked when implementation begins.

## Repository and version evidence

The checkout at `1039fc71f38b2277da6075a55ce905720c5de0ca` has an explicit npm workspace list containing `packages/data` and `packages/model`, a root lockfile, and a root `build` script that checks the data package. The README and shared CI setup specify Node.js 22; this research shell reports Node `22.23.0` and npm `10.9.8`. `packages/website` is absent. Preserve the other packages and their existing commands. [Repository manifest](https://github.com/justforgiggles/property-prices/blob/1039fc71f38b2277da6075a55ce905720c5de0ca/package.json), [README](https://github.com/justforgiggles/property-prices/blob/1039fc71f38b2277da6075a55ce905720c5de0ca/README.md), [CI runtime](https://github.com/justforgiggles/property-prices/blob/1039fc71f38b2277da6075a55ce905720c5de0ca/.github/actions/setup/action.yml).

| Dependency | Verified compatibility evidence | Recommendation |
| --- | --- | --- |
| Next.js | Registry currently reports `16.4.2`, Node `>=20.9.0`, and React/React DOM peer ranges including 19.x. | Start with this stable release; Node 22 meets its engine requirement. |
| Tailwind CSS | Registry currently reports `4.3.3`; the Next.js guide uses `@tailwindcss/postcss`. | Use the v4 PostCSS setup produced by the CLI. |
| Highcharts React | Official guide tests Highcharts `>=12.0.0` and React/React DOM `>=18.3.1`; its package is `@highcharts/react`. | Use this maintained integration with an explicitly declared `highcharts` dependency. |
| Highcharts Core | Current API documentation identifies `13.1.0`. | Verify the package's actual stable release and wrapper peer constraints when installing. |
| shadcn/ui | Current CLI supports existing projects, workspace directory targeting, and utility-color generation. | Run the CLI in the website workspace; do not generate a second monorepo. |

Sources: [Next package metadata](https://registry.npmjs.org/next/latest), [Tailwind package metadata](https://registry.npmjs.org/tailwindcss/latest), [Highcharts React requirements](https://www.highcharts.com/docs/react/getting-started), [Highcharts API version](https://api.highcharts.com/highcharts/chart.styledMode), [shadcn CLI](https://ui.shadcn.com/docs/cli). These are compatibility bounds, **not a tested dependency matrix**. The terminal registry query did not return and was stopped; exact Highcharts/wrapper/shadcn package versions remain an installation check. Record resolved versions in the root lockfile rather than preserving floating `latest` dependencies.

## Recommended CLI and build integration

The following is an implementation recipe, not executed commands. `create-next-app` documents the explicit TypeScript, Tailwind, App Router, npm, skip-install, disable-git, and negated-default flags. Its current App Router default enables Cache Components; explicitly disable that optional feature for this basic static architecture. [Next CLI reference](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

```sh
npx create-next-app@16.4.2 packages/website --ts --tailwind --eslint --app --src-dir --use-npm --skip-install --disable-git --no-react-compiler --no-cache-components --import-alias '@/*' --yes
```

Then add `packages/website` to the root workspace array, name its package `@property-prices/website`, and retain one root lockfile. Run installation from the repository root. npm documents workspace-targeted installs and scripts; dependencies used by this package belong in its own manifest. [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces/).

```sh
npm install
npx shadcn@latest init -c packages/website --no-monorepo --no-css-variables
npx shadcn@latest add button input label table separator -c packages/website
npm install highcharts @highcharts/react -w @property-prices/website
npm install --save-dev tsx -w @property-prices/website
```

Select the component base/style and any additional components when the design ticket resolves them. The component list above is a minimal starting set, not a mandatory page composition. Inspect generated files against repository return-type and formatting standards. CLI initialization can add theme/base CSS even with utility-oriented settings: review and remove handwritten page/component rules, and retain only required framework/library imports or configuration. `components.json` documents `tailwind.cssVariables: false` for inline Tailwind color utilities, a blank `tailwind.config` with v4, and `rsc: true` for client directives. [shadcn configuration](https://ui.shadcn.com/docs/components-json).

Recommended website scripts: `data:generate` runs `node --import tsx scripts/generate-data.ts`; `prebuild` and `predev` run `data:generate`; `build` runs `next build`; `dev` runs `next dev`; `typecheck` runs `tsc --noEmit`; `lint` runs `eslint`; `test` runs the focused analytics tests using Node's test runner and tsx. Add root convenience commands such as `website:build` without replacing existing checks. This lifecycle wiring is a project recommendation; verify it in the new workspace.

Generate the city manifest and per-city aggregates before Next executes. Resolve `data/raw` relative to the generator module/repository, not the caller's working directory. Keep generated artifacts reproducible, replace stale generated outputs, and fail the build on fatal validation errors. Import aggregates only in build-time page/data modules; pass compact, serializable per-city series to charts and a small city index to discovery search. Do not ship raw listing records or fetch data from an API at runtime. Analytics contracts and exact output paths remain the data-contract ticket's responsibility.

## Static routes and browser boundaries

Use `output: "export"`; `next build` writes `out/`. App Router Server Components execute at build time and therefore do not require a production Node server. Dynamic routes need `generateStaticParams`; `dynamicParams: true`, ISR, Server Actions, request-dependent APIs and default image optimization are unsupported. [Next static exports](https://nextjs.org/docs/app/guides/static-exports).

Recommended configuration:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
```

Use `src/app/[province]/[city]/page.tsx` with `generateStaticParams()` returning both slugs from the generated manifest and `dynamicParams = false`. Current page `params` is a promise; await it. Enumeration can happen in the leaf page, so province landing pages are unnecessary. [Static parameter API](https://nextjs.org/docs/app/api-reference/functions/generate-static-params). Trailing slashes produce directory `index.html` files and simplify static serving; test direct deep links on the eventual host. This convention still has exactly the requested province/city segments. No host, base path, redirects, or deployment platform is assumed.

Highcharts' Next.js guide requires client components for interactive charts. However, Next also prerenders Client Components during export. Put a `next/dynamic` import with `{ ssr: false }` **inside a small Client Component**, and import Highcharts/wrapper/modules only in the dynamically loaded implementation. Keep summaries, captions and tables in the statically rendered page. This two-layer boundary is a conservative recommendation derived from both documents; verify it in an actual export. [Highcharts Next.js guide](https://www.highcharts.com/docs/react/nextjs), [Next lazy loading](https://nextjs.org/docs/app/guides/lazy-loading).

Create formatters and chart option callbacks inside the client chart module; do not pass functions across the Server/Client boundary. A stable-height Tailwind wrapper should reserve chart space during loading. Search can filter the supplied city index entirely in the browser while ordinary city links remain available in HTML. No route handlers or runtime fetches are needed for either interaction.

## Styling and chart accessibility

Tailwind's Next.js setup requires the PostCSS plugin and an entry stylesheet importing `tailwindcss`; that compiler entry is distinct from custom page styling. Express layout, typography, spacing and responsive states in utility classes. The v4 browser baseline is Chrome 111, Safari 16.4 and Firefox 128; avoid assuming support for earlier browsers. [Tailwind Next.js setup](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [Tailwind compatibility](https://tailwindcss.com/docs/compatibility).

Use Highcharts' default `styledMode: false` and its chart/series options for generated SVG presentation, with a shared chart configuration aligned to the UI palette. Styled mode requires CSS rules and would introduce unnecessary stylesheet work. This interprets the no-custom-CSS requirement as forbidding authored page/component CSS, while allowing Highcharts to render its own SVG attributes/styles. No custom chart stylesheet is necessary. [Styled-mode API](https://api.highcharts.com/highcharts/chart.styledMode).

The React integration has dedicated series components that load their required modules; generic series may need additional ESM module imports. Core includes line, bar/column, scatter, range and error-bar families, so the required comparisons and distributions do not imply a Stock, Maps or Dashboards dependency. Verify actual component export names in the installed version before use. [Highcharts series components](https://www.highcharts.com/docs/react/components/series-types).

Include the `Accessibility` component from `@highcharts/react/modules/Accessibility`, with meaningful chart/axis names, units and value descriptions. Highcharts supplies keyboard navigation and assistive-technology support, but that is not a substitute for testing. [React Accessibility component](https://www.highcharts.com/docs/react/components/modules/accessibility), [Accessibility module](https://www.highcharts.com/docs/accessibility/accessibility-module).

Recommended presentation contract: every chart also has a concise visible explanation and a semantic HTML data table, generated from the same aggregate payload and available without chart JavaScript. Link a unique description element via `accessibility.linkedDescription`. Use a disclosure if space requires it; table values must preserve missing values and sample counts. Highcharts recommends visible descriptive text. Its optional exporting/export-data modules can create tables, but a static table better serves this export's no-JavaScript experience without adding download controls or an export service. [Linked description API](https://api.highcharts.com/highcharts/accessibility.linkedDescription).

## Metadata, assets and licensing

Keep pages/layouts as Server Components and produce titles/descriptions through `metadata` or `generateMetadata` from generated city data. For a prerenderable page without dynamic behavior, Next includes the result in initial HTML. `metadataBase` supplies an absolute origin for canonical/Open Graph URLs. Do not invent a Prop Radar domain: establish the real origin before emitting production canonical URLs or absolute social metadata. [Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata).

A sitemap may be a static XML file or generated through Next's sitemap convention. Recommendation: generate XML alongside the data when the real origin is supplied, using the same route manifest. A publication date is not automatically a page's last-modified date; omit `lastmod` unless its meaning is defensible. The content/SEO ticket must settle origin-absent preview behavior and final copy. [Next sitemap convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap).

For images, `unoptimized: true` serves source files unchanged, avoiding the image optimizer endpoint; optimize any local raster assets before export. No external image service is required. [Image API](https://nextjs.org/docs/app/api-reference/components/image#unoptimized). For fonts, `next/font/local` supports bundled font files and `next/font/google` self-hosts resulting assets. Prefer licensed local font files or a system stack for repeatable offline builds; a Google-font download would introduce build-time network reliance. Exact typography remains the design ticket's decision. [Next fonts](https://nextjs.org/docs/app/getting-started/fonts).

Highcharts is proprietary: its EULA limits free personal/educational use and expressly includes business prototyping/R&D under commercial use. The current commercial FAQ says public websites are external applications requiring SaaS coverage, whereas an Internal license does not cover them. Existing/custom agreement terms may differ. This research did not establish the owner's entitlement; record the applicable license before commercial implementation/publication rather than assuming free commercial use or purchasing anything. Prefer npm bundling, not a production CDN dependency. [Highcharts EULA](https://shop.highcharts.com/license-eula), [Commercial license FAQ](https://shop.highcharts.com/faq). This is a report of vendor terms, not a determination of the owner's legal status.

## Required implementation proof

No install, export, browser, accessibility or dependency-integration test was performed in this research. Acceptance requires:

1. Install from the root lockfile on Node 22; verify dependency peers and generated shadcn files. Run package lint, typecheck, analytics tests and `npm run build -w @property-prices/website`.
2. Run data generation twice against identical inputs and compare outputs; check that deleted cities cannot leave stale generated pages/data. Confirm the expected city manifest matches exported route files.
3. Serve only `packages/website/out`; verify the homepage, direct deep links, navigation, unknown-route handling and text search. Confirm no API, `/_next/image`, export-server or raw-data requests occur.
4. Inspect emitted HTML with JavaScript disabled: titles, descriptions, headings, explanatory copy, metrics and table data must remain usable. Inspect browser console for hydration/module errors after enabling charts.
5. Test every selected chart type at desktop/mobile widths, keyboard navigation and a screen reader; compare each chart/table value with its aggregate source, including sparse and unavailable metrics. Confirm focus/contrast and no clipped axis labels.
6. Check metadata with the real origin, local asset/font availability, dependency versions and Highcharts entitlement before publication. Domain and entitlement are operational inputs; this research creates no deployment infrastructure.
