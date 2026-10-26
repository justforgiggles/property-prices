# Website SEO and sharing

Research checked on 26 October 2026. This guide separates implementation readiness
from search-engine indexing, rankings, and AI citations, which are not guaranteed.

## Search intent and metadata

The homepage is about recorded advertisement counts by South African city, for
buyers and sellers. Its title is **South African Property Listing Data by City |
Prop Radar**. Its description is **Buying or selling? Explore recorded listing
counts by South African city, based on property advertisements published in the
past 90 days.**

This is an editorial recommendation based on page relevance, not a measured
highest-volume keyword combination. Geography, subject, granularity, and brand
are clear; “counts” in the description narrows what “data” means. Claims about
prices, valuations, trends, or individual homes would overpromise this page.
[Property24's trends](https://www.property24.com/property-trends) and
[reports](https://www.property24.com/purchase-property-report) illustrate the
different information those terms imply; they do not establish keyword demand.

Google recommends concise, descriptive, page-specific
[titles](https://developers.google.com/search/docs/appearance/title-link) and
[descriptions](https://developers.google.com/search/docs/appearance/snippet).
It can rewrite titles and choose query-dependent snippets from visible content.
Use future Search Console results to refine wording rather than treating a
character limit as a ranking rule. The approved visible headline remains unchanged.

## Implementation contract

- `site.config.mjs` is the source for production URL, identity, SEO copy, and
  absolute asset URLs. The current canonical is the GitHub Pages project URL.
- The layout owns shared branding, language, viewport/theme, icons, and manifest.
  Each page owns its title, description, canonical, robots, OG, and Twitter data.
  A new page must not inherit the homepage canonical.
- Open Graph uses `website`, `en_ZA`, site name, canonical URL, full image metadata,
  and the researched copy. Twitter uses `summary_large_image` with explicit title,
  description, image, and alt. There are no supplied official social handles.
- `WebSite` and `WebPage` JSON-LD describe only the real website and page. Do not
  fabricate offers, reviews, organization details, or a `SearchAction` for the
  client-only city filter. All factual markup must agree with visible content.
- The sitemap contains actual canonical routes only. No fabricated city pages,
  query states, priority/change-frequency hints, or build-time `lastmod` guesses.
- Keep the default missing-page `noindex` and real 404 response. Do not add a
  blanket site-wide index directive that overrides error-page handling.
- No keyword meta tag, invented verification token, alternate-language URLs, or
  social account identifiers are needed. Add verified values when they exist.

Next.js documents [metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
and [static export](https://nextjs.org/docs/app/guides/static-exports). Use absolute
URLs to avoid its metadata URL composition accidentally duplicating the base path.

## Assets

`npm run assets -w @prop-radar/website` regenerates the committed icon family and
social artwork from the radar SVG and licensed local font in `assets/`. Ordinary
builds use committed assets and require no network or font download.

The bundled Geist font comes from the
[Google Fonts repository](https://github.com/google/fonts/tree/main/ofl/geist);
its SIL Open Font License is included alongside the font. SVG, ICO, and PNG
favicons use transparent backgrounds so the radar sits directly on browser tabs.
This replaces the cream backing, which appeared as a white tile in Chrome.
Apple and application icons retain their cream backgrounds.

The evergreen 1200×630 sharing PNG uses the brand and approved headline, without
dates, counts, or a future domain. Social services cache previews; a daily number
would become stale independently of the page. The same image serves OG and Twitter.
Inspect it at thumbnail size after regeneration, alongside the SVG/ICO/PNG icons
at actual display sizes. The manifest uses browser display mode; it does not add
an offline app or service worker.

## Search and AI discovery

All city text is present in exported HTML before JavaScript. Preserve semantic
headings, readable facts, consistent naming, crawlable public assets, and canonical
URLs. These support conventional search and AI grounding according to
[Bing's webmaster guidance](https://www.bing.com/webmasters/help/bing-webmaster-guidelines-30fba23a).
Metadata alone cannot make a thin or irrelevant page authoritative.

[Google's AI guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
requires no special AI schema or rewritten hidden copy and says Google Search
does not use `llms.txt`. We do not add speculative discovery files.
[OpenAI](https://developers.openai.com/api/docs/bots) identifies OAI-SearchBot as
its search crawler, GPTBot as a separate potential training crawler, and
ChatGPT-User as a user-initiated fetcher. Search eligibility and training policy
are separate decisions. No new training opt-in/out policy is introduced here.

## Current hosting limitations

The project lives at `https://justforgiggles.github.io/property-prices/`.
Its exported `/property-prices/robots.txt` is a prepared artifact, not an effective
host crawler policy: [robots rules must live at the hostname root](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt).
The current root robots URL returns 404, so it imposes no restrictions. Submit
the project sitemap directly to search consoles. Recheck the root policy if the
organization's other hosting changes.

Browser icons and sharing images work under the project path. Google's
[search favicon](https://developers.google.com/search/docs/appearance/favicon-in-search)
and [site name](https://developers.google.com/search/docs/appearance/site-names)
are hostname-level features; this project cannot claim independent Google
search branding merely by adding subdirectory assets or WebSite markup.

## Account-side setup

1. Verify the exact current URL-prefix property in Google Search Console using
   an available ownership method. Add a supplied HTML verification file/tag if
   needed; DNS ownership of `github.io` is not available to this project.
2. Submit the project `sitemap.xml`, inspect the canonical homepage, request
   indexing, and monitor indexing/canonical selection and search performance.
3. Check Settings → Search generative AI. Select inclusion if desired; parent
   properties can affect the setting. This control is separate from crawler or
   training policy. [Google's control documentation](https://support.google.com/webmasters/answer/16908024?hl=en).
4. Verify the site in Bing Webmaster Tools (or import a verified Google property),
   submit its sitemap, and review crawl/index reports.
5. Inspect a shared link preview after deployment. A crawler fetch returning 200
   establishes access, not an actual platform crawl, index entry, or citation.

These account steps require the owner's access and are not performed by the
website deployment. Never claim verification or submission without confirmation.

## Future move to propradar.co.za

Do not switch canonical metadata until the new domain serves this site over HTTPS.

1. Verify domain ownership and configure DNS, GitHub Pages custom-domain settings,
   and HTTPS. Check both apex/www behaviour and choose the apex as canonical.
2. Change the production URL in `site.config.mjs` to `https://propradar.co.za/`.
   The Next base path, canonical URLs, sitemap, robots sitemap reference, manifest
   scope/start URL, icons, and structured data derive from this configuration.
3. Rebuild and verify assets at the domain root. Confirm `/robots.txt` now serves
   the intended rules and references the new sitemap.
4. Verify that old project URLs permanently redirect to the matching new URLs.
   Do not assume GitHub's redirect behaviour; check actual status and Location
   headers, and arrange redirects if necessary. Avoid leaving duplicate sites.
5. Verify the new Google/Bing properties, submit the new sitemap, and use their
   applicable migration tools. Update the README and external links.
6. Recheck Google favicon/site-name eligibility at the new root homepage and
   inspect canonical selection, errors, and traffic after launch.

## Validation

Run the website tests and typecheck, then `npm run build:website`; the postbuild
SEO check inspects exported HTML, metadata, JSON-LD, discovery files, and assets.
Check the deployed homepage and every metadata asset without JavaScript, including
requests with Googlebot and OAI-SearchBot user agents. Confirm no localhost URLs,
duplicate base paths, future-domain canonicals, missing icons, or broken 404s.
Use public schema validators to inspect applicable structured data when available;
absence of a rich-result type is not a markup failure. Review mobile layout,
keyboard focus, and city filtering after metadata or brand changes.
