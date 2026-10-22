import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import {
  getSharedRows,
  getSupportedRows,
  type ReportCatalog,
} from "../src/lib/reports";

const output = new URL("../out/", import.meta.url);
const catalog: ReportCatalog = JSON.parse(
  await readFile(
    new URL("../.generated/reports.json", import.meta.url),
    "utf8",
  ),
);
const byKey = new Map(catalog.cities.map((city) => [city.key, city]));
const routes = [
  ...catalog.cities.map((city) => ({
    href: city.href,
    row: "price-row",
    plotsPerRow: 1,
    rows: getSupportedRows(city),
  })),
  ...catalog.pairs.map((pair) => ({
    href: pair.href,
    row: "comparison-row",
    plotsPerRow: 2,
    rows: getSharedRows(byKey.get(pair.left)!, byKey.get(pair.right)!).map(
      (row) => row.left,
    ),
  })),
];
const sections = { house: "houses", flat: "flats", townhouse: "townhouses" };

for (const route of routes) {
  const html = await readFile(
    new URL(`${route.href.slice(1)}index.html`, output),
    "utf8",
  );
  assert.ok(
    route.rows.length > 0,
    `${route.href} must have supported evidence`,
  );
  assert.equal(
    (html.match(new RegExp(`data-testid="${route.row}"`, "g")) ?? []).length,
    route.rows.length,
    `${route.href} must contain only supported rows`,
  );
  assert.deepEqual(
    [...html.matchAll(/data-category="([a-z]+-[1-4])"/g)].map(
      (match) => match[1],
    ),
    route.rows.map((row) => `${row.type}-${row.bedrooms}`),
    `${route.href} must render the expected categories in order`,
  );
  assert.equal(
    (html.match(/data-testid="price-plot"/g) ?? []).length,
    route.rows.length * route.plotsPerRow,
    `${route.href} must have a plot for every displayed city distribution`,
  );
  for (const [type, id] of Object.entries(sections)) {
    const visible = route.rows.some((row) => row.type === type);
    assert.equal(
      html.includes(`id="${id}"`),
      visible,
      `${route.href} section ${id}`,
    );
    assert.equal(
      html.includes(`href="#${id}"`),
      visible,
      `${route.href} jump link ${id}`,
    );
  }
  assert.equal(
    (html.match(/<h1[ >]/g) ?? []).length,
    1,
    `${route.href} must have one page heading`,
  );
  assert.doesNotMatch(
    html,
    /data-testid="explorer"|Asking-price ceiling|Suburbs to explore|href="\/#provinces"|Difference unavailable|Not enough comparable evidence/,
    route.href,
  );
}

for (const province of new Set(
  catalog.cities.map((city) => city.provinceSlug),
)) {
  await assert.rejects(access(new URL(`${province}/index.html`, output)), {
    code: "ENOENT",
  });
}
for (const pair of catalog.pairs) {
  await assert.rejects(
    access(new URL(`compare/${pair.right}/vs/${pair.left}/index.html`, output)),
    { code: "ENOENT" },
  );
}
for (const path of [
  "index.html",
  "methodology/index.html",
  "design-system/index.html",
  "404.html",
]) {
  await access(new URL(path, output));
}
console.log(
  `Verified ${catalog.cities.length} city reports and ${catalog.pairs.length} canonical comparisons: supported rows, plot counts and matching section links; no province or reverse-pair pages.`,
);
