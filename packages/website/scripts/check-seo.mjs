import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import sharp from "sharp";
import { basePath, site, siteUrl, socialImage } from "../site.config.mjs";
import { cityPath, suburbPath } from "../lib/city-routes.mjs";

const website = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(website, "out");
const html = await readFile(join(output, "index.html"), "utf8");
const $ = load(html);

function meta(name, attribute = "name") {
  const elements = $(`head meta[${attribute}="${name}"]`);
  assert.equal(elements.length, 1, `Expected exactly one ${name}`);
  return elements.attr("content");
}

function exportedPath(url) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, new URL(site.url).origin, url);
  assert(parsed.pathname.startsWith(`${basePath}/`), url);
  const relative = parsed.pathname.slice(basePath.length + 1);
  assert(!relative.includes(".."), url);
  return join(output, relative || "index.html");
}

assert.equal($("head title").length, 1);
assert.equal($("head title").text(), site.title);
assert.equal(meta("description"), site.description);
assert.equal(meta("application-name"), site.name);
assert.equal($("html").attr("lang"), site.language);
assert.equal($("head link[rel='canonical']").length, 1);
assert.equal($("head link[rel='canonical']").attr("href"), site.url);
assert.match(meta("robots"), /\bindex\b/);
assert.match(meta("robots"), /\bfollow\b/);
assert.match(meta("robots"), /max-image-preview:large/);
assert(!/noindex|nofollow/.test(meta("robots")));
assert.match(meta("viewport"), /width=device-width/);
assert.equal(meta("theme-color"), site.background);
assert.equal(meta("color-scheme"), "light");

for (const [name, expected] of Object.entries({
  "og:type": "website",
  "og:title": site.title,
  "og:description": site.description,
  "og:url": site.url,
  "og:site_name": site.name,
  "og:locale": "en_ZA",
  "og:image": socialImage.url,
  "og:image:type": socialImage.type,
  "og:image:width": String(socialImage.width),
  "og:image:height": String(socialImage.height),
  "og:image:alt": socialImage.alt,
})) {
  assert.equal(meta(name, "property"), expected, name);
}

for (const [name, expected] of Object.entries({
  "twitter:card": "summary_large_image",
  "twitter:title": site.title,
  "twitter:description": site.description,
  "twitter:image": socialImage.url,
  "twitter:image:alt": socialImage.alt,
})) {
  assert.equal(meta(name), expected, name);
}

assert.equal(
  $("meta[name='twitter:site'], meta[name='twitter:creator']").length,
  0,
);
assert.equal($("script[type='application/ld+json']").length, 1);
const jsonld = JSON.parse($("script[type='application/ld+json']").text());
assert.equal(jsonld["@context"], "https://schema.org");
assert.deepEqual(
  jsonld["@graph"].map((entity) => entity["@type"]),
  ["WebSite", "WebPage"],
);
for (const entity of jsonld["@graph"]) {
  assert.equal(entity.url, site.url);
  assert.equal(entity.inLanguage, site.language);
  assert.equal(entity.description, site.description);
  assert(entity["@id"].startsWith(site.url));
}
assert.equal(jsonld["@graph"][1].isPartOf["@id"], jsonld["@graph"][0]["@id"]);
assert.equal(jsonld["@graph"][1].primaryImageOfPage.url, socialImage.url);
assert.equal($("h1").text(), "A local view of property listings.");
const data = JSON.parse(
  await readFile(join(website, "data/cities.json"), "utf8"),
);
const visibleCities = data.cities
  .filter((city) => city.listingCount > 20)
  .sort((left, right) => right.listingCount - left.listingCount);
assert.deepEqual(
  $("#city-grid h2")
    .map((_, element) => $(element).text())
    .get(),
  visibleCities.map((city) => city.name),
  "City content must be present without JavaScript",
);
assert(!$("head").html().includes("localhost"));

const cityLinks = $("#city-grid a")
  .map((_, element) => $(element).attr("href"))
  .get();
assert.deepEqual(
  cityLinks,
  visibleCities.map((city) => `${basePath}${cityPath(city)}`),
);
assert.equal(
  new Set(cityLinks).size,
  visibleCities.length,
  "Every city route must be unique",
);
const cityManifest = JSON.parse(
  await readFile(join(website, "data/city-manifest.json"), "utf8"),
);
assert.equal(
  new Set(cityManifest.cities.map(cityPath)).size,
  cityManifest.cities.length,
);
for (const city of cityManifest.cities) {
  const route = cityPath(city).slice(1);
  const cityHtml = load(
    await readFile(join(output, route, "index.html"), "utf8"),
  );
  assert.equal(cityHtml("h1").text(), city.name);
  assert.equal(cityHtml("link[rel='canonical']").attr("href"), siteUrl(route));
  assert.match(
    cityHtml("meta[name='robots']").attr("content"),
    city.indexable ? /\bindex\b/ : /\bnoindex\b/,
  );
  assert.equal(cityHtml("meta[name='robots']").length, 1);
  assert(cityHtml("title").text().includes(city.name));
  assert.match(cityHtml("title").text(), /Asking Prices & Property Listings/);
  assert(
    cityHtml("meta[name='description']")
      .attr("content")
      .includes(city.province),
  );
  assert.equal(
    cityHtml("meta[property='og:url']").attr("content"),
    siteUrl(route),
  );
  assert.equal(
    cityHtml("meta[property='og:title']").attr("content"),
    cityHtml("title").text(),
  );
  assert.equal(
    cityHtml("meta[name='twitter:title']").attr("content"),
    cityHtml("title").text(),
  );
  assert.equal(
    cityHtml("meta[property='og:image']").attr("content"),
    socialImage.url,
  );
  assert(
    !/Illustrative|layout preview|NaN|Infinity/.test(cityHtml("main").text()),
  );
  const analytics = JSON.parse(
    await readFile(
      join(website, "data/cities", city.provinceSlug, `${city.citySlug}.json`),
      "utf8",
    ),
  );
  assert.equal(
    city.indexable,
    analytics.bedroomGroups.all.askingPrice.count >= 5,
  );
  assert(
    cityHtml("main")
      .text()
      .includes(
        analytics.bedroomGroups.all.listingCount.toLocaleString("en-ZA"),
      ),
  );
  assert.equal(cityHtml("[role='tab']").length, 6);
  assert.equal(cityHtml("[role='tabpanel']").length, 1);
  const visibleSuburbs = analytics.suburbs
    .filter((s) => s.listingCount > 20)
    .sort(
      (a, b) =>
        b.listingCount - a.listingCount ||
        a.name.localeCompare(b.name, "en-ZA"),
    );
  assert.equal(
    cityHtml("#suburbs-heading").length,
    visibleSuburbs.length ? 1 : 0,
  );
  assert.deepEqual(
    cityHtml("#suburb-list a")
      .map((_, element) => cityHtml(element).attr("href"))
      .get(),
    visibleSuburbs.map((s) => `${basePath}/${route}${s.slug}/`),
  );
}

const suburbManifest = JSON.parse(
  await readFile(join(website, "data/suburb-manifest.json"), "utf8"),
);
assert.equal(
  new Set(suburbManifest.suburbs.map(suburbPath)).size,
  suburbManifest.suburbs.length,
);
for (const suburb of suburbManifest.suburbs) {
  const route = suburbPath(suburb).slice(1);
  const document = load(
    await readFile(join(output, route, "index.html"), "utf8"),
  );
  const analytics = JSON.parse(
    await readFile(
      join(
        website,
        "data/suburbs",
        suburb.provinceSlug,
        suburb.citySlug,
        `${suburb.suburbSlug}.json`,
      ),
      "utf8",
    ),
  );
  assert.equal(document("h1").text(), suburb.name);
  assert.equal(document("link[rel='canonical']").length, 1);
  assert.equal(document("link[rel='canonical']").attr("href"), siteUrl(route));
  assert.equal(
    suburb.indexable,
    analytics.bedroomGroups.all.askingPrice.count >= 5,
  );
  assert.equal(document("meta[name='robots']").length, 1);
  assert.match(
    document("meta[name='robots']").attr("content"),
    suburb.indexable ? /\bindex\b/ : /\bnoindex\b/,
  );
  assert(document("title").text().includes(`${suburb.name}, ${suburb.city}`));
  assert(
    document("meta[name='description']")
      .attr("content")
      .includes(suburb.province),
  );
  assert.equal(
    document("meta[property='og:url']").attr("content"),
    siteUrl(route),
  );
  assert.equal(
    document("meta[property='og:title']").attr("content"),
    document("title").text(),
  );
  assert.equal(
    document("meta[name='twitter:title']").attr("content"),
    document("title").text(),
  );
  assert.equal(
    document("meta[property='og:image']").attr("content"),
    socialImage.url,
  );
  assert.equal(document("[role='tab']").length, 6);
  assert.equal(document("[role='tabpanel']").length, 1);
  assert.equal(document("#suburbs-heading").length, 0);
  assert.equal(
    document("main nav a").attr("href"),
    `${basePath}/${suburb.provinceSlug}/${suburb.citySlug}/`,
  );
  assert(
    document("main")
      .text()
      .includes(
        analytics.bedroomGroups.all.listingCount.toLocaleString("en-ZA"),
      ),
  );
  assert(
    !/Illustrative|layout preview|NaN|Infinity/.test(document("main").text()),
  );
}

const missing = load(await readFile(join(output, "404.html"), "utf8"));
assert(
  missing("meta[name='robots']")
    .toArray()
    .some((element) => /noindex/.test(missing(element).attr("content"))),
);
assert.equal(
  missing("link[rel='canonical']").length,
  0,
  "404 must not inherit the homepage canonical",
);

const sitemap = load(await readFile(join(output, "sitemap.xml"), "utf8"), {
  xml: true,
});
assert.equal(
  sitemap("urlset").attr("xmlns"),
  "http://www.sitemaps.org/schemas/sitemap/0.9",
);
assert.deepEqual(
  sitemap("url > loc")
    .map((_, element) => sitemap(element).text())
    .get(),
  [
    site.url,
    ...cityManifest.cities
      .filter((city) => city.indexable)
      .map((city) => siteUrl(cityPath(city).slice(1))),
    ...suburbManifest.suburbs
      .filter((s) => s.indexable)
      .map((s) => siteUrl(suburbPath(s).slice(1))),
  ],
);
assert.equal(sitemap("lastmod, priority, changefreq").length, 0);
const robots = await readFile(join(output, "robots.txt"), "utf8");
assert.match(robots, /User-Agent: \*/i);
assert.match(robots, /Allow: \/\s/);
assert(robots.includes(`Sitemap: ${siteUrl("sitemap.xml")}`));
assert(!/Disallow:\s*\//i.test(robots));
assert.equal($("link[rel='manifest']").length, 1);
assert.equal(
  new URL($("link[rel='manifest']").attr("href"), site.url).href,
  siteUrl("manifest.webmanifest"),
);
const manifest = JSON.parse(
  await readFile(join(output, "manifest.webmanifest"), "utf8"),
);
assert.equal(manifest.id, site.url);
assert.equal(manifest.start_url, site.url);
assert.equal(manifest.scope, site.url);
assert.equal(manifest.name, site.name);
assert.equal(manifest.lang, site.language);
assert.equal(manifest.display, "browser");
assert.equal(manifest.theme_color, site.background);
assert.equal(manifest.background_color, site.background);

const icons = $("link[rel='icon'], link[rel='apple-touch-icon']")
  .toArray()
  .map((element) => $(element).attr("href"));
assert.deepEqual(
  new Set(icons),
  new Set([
    siteUrl("favicon.ico"),
    siteUrl("icons/favicon-96.png"),
    siteUrl("icons/icon.svg"),
    siteUrl("icons/apple-touch-icon.png"),
  ]),
);
assert.deepEqual(
  manifest.icons.map((icon) => icon.sizes),
  ["192x192", "512x512"],
);

for (const [url, width, height] of [
  [socialImage.url, 1200, 630],
  [siteUrl("icons/favicon-96.png"), 96, 96],
  [siteUrl("icons/apple-touch-icon.png"), 180, 180],
  ...manifest.icons.map((icon) => [
    icon.src,
    ...icon.sizes.split("x").map(Number),
  ]),
]) {
  const buffer = await readFile(exportedPath(url));
  const image = await sharp(buffer).metadata();
  assert.equal(image.format, "png", url);
  assert.equal(image.width, width, url);
  assert.equal(image.height, height, url);
  assert(buffer.length < 1_000_000, `Oversized image: ${url}`);
  if (url.endsWith("apple-touch-icon.png")) assert.equal(image.hasAlpha, false);
}

const iconSvg = load(
  await readFile(exportedPath(siteUrl("icons/icon.svg")), "utf8"),
  { xml: true },
);
assert.equal(iconSvg("svg").attr("viewBox"), "0 0 32 32");
const ico = await readFile(exportedPath(siteUrl("favicon.ico")));
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 3);
for (const [index, size] of [16, 32, 48].entries()) {
  const entry = 6 + index * 16;
  assert.equal(ico[entry], size);
  const offset = ico.readUInt32LE(entry + 12);
  const image = await sharp(
    ico.subarray(offset, offset + ico.readUInt32LE(entry + 8)),
  ).metadata();
  assert.equal(image.width, size);
  assert.equal(image.height, size);
}

if (process.argv.includes("--live")) {
  for (const suburb of [
    suburbManifest.suburbs.find((s) => s.indexable),
    suburbManifest.suburbs.find((s) => !s.indexable),
  ]) {
    assert(suburb);
    const url = siteUrl(suburbPath(suburb).slice(1));
    const response = await fetch(url);
    assert.equal(response.status, 200, url);
    const document = load(await response.text());
    assert.equal(document("h1").text(), suburb.name);
    assert.equal(document("link[rel='canonical']").attr("href"), url);
    assert.match(
      document("meta[name='robots']").attr("content"),
      suburb.indexable ? /\bindex\b/ : /\bnoindex\b/,
    );
  }
  const cityUrl = siteUrl("western-cape/cape-town/");
  const cityResponse = await fetch(cityUrl);
  assert.equal(cityResponse.status, 200);
  const cityDocument = load(await cityResponse.text());
  assert.equal(cityDocument("h1").text(), "Cape Town");
  assert.equal(cityDocument("link[rel='canonical']").attr("href"), cityUrl);
  assert.match(
    cityDocument("meta[name='robots']").attr("content"),
    /\bindex\b/,
  );
  assert(!/Illustrative|layout preview/.test(cityDocument("main").text()));
  const sparseCity = cityManifest.cities.find((city) => !city.indexable);
  if (sparseCity) {
    const response = await fetch(siteUrl(cityPath(sparseCity).slice(1)));
    assert.equal(response.status, 200);
    assert.match(
      load(await response.text())("meta[name='robots']").attr("content"),
      /\bnoindex\b/,
    );
  }
  for (const agent of ["Googlebot", "OAI-SearchBot"]) {
    const response = await fetch(site.url, {
      headers: { "User-Agent": agent },
    });
    assert.equal(response.status, 200, agent);
    const document = load(await response.text());
    assert.equal(document("head title").text(), site.title, agent);
    assert.equal(
      document("link[rel='canonical']").attr("href"),
      site.url,
      agent,
    );
    assert.equal(
      document("meta[property='og:image']").attr("content"),
      socialImage.url,
      agent,
    );
    assert.equal(
      document("#city-grid h2").length,
      $("#city-grid h2").length,
      agent,
    );
  }
  const urls = new Set([
    ...icons,
    socialImage.url,
    ...manifest.icons.map((icon) => icon.src),
    siteUrl("sitemap.xml"),
    siteUrl("robots.txt"),
    siteUrl("manifest.webmanifest"),
  ]);
  await Promise.all(
    [...urls].map(async (url) => {
      const response = await fetch(url);
      assert.equal(response.status, 200, url);
      const expectedType = url.endsWith(".png")
        ? /image\/png/
        : url.endsWith(".svg")
          ? /image\/svg\+xml/
          : url.endsWith(".ico")
            ? /image\/(x-icon|vnd.microsoft.icon)/
            : url.endsWith(".xml")
              ? /xml/
              : url.endsWith(".webmanifest")
                ? /json|manifest/
                : /text\/plain/;
      assert.match(response.headers.get("content-type"), expectedType, url);
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        await readFile(exportedPath(url)),
        url,
      );
    }),
  );
  const response = await fetch(siteUrl("missing-seo-check/"));
  assert.equal(response.status, 404);
  console.log(
    "Live crawler fetches, discovery files, asset types/bytes, and missing-page status verified.",
  );
}

console.log(
  `SEO export verified: ${cityManifest.cities.length} cities, ${suburbManifest.suburbs.length} suburbs, navigation, metadata, structured data, 404 noindex, discovery files, and all image formats/dimensions.`,
);
