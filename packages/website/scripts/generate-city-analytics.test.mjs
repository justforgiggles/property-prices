import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  completedMonths,
  statistics,
  generateWebsiteData,
  writeWebsiteData,
} from "./generate-city-analytics.mjs";

const now = new Date("2026-10-26T12:00:00Z");
function listing(
  id,
  {
    date = "2026-08-15",
    name = "Cape Town",
    suburb,
    province = "Western Cape",
    price = 1500000,
    currency = "ZAR",
    bedrooms = 2,
    area = 100,
    unit = "MTK",
    rates = 1000,
    type = "House",
    propertyType = "House",
    description = "A home for sale",
  } = {},
) {
  return {
    id,
    ratesAndTaxes: rates,
    jsonld: [
      {
        "@graph": [
          {
            datePosted: date,
            description,
            breadcrumb: {
              itemListElement: [
                { position: 2, name: province },
                { position: 3, name },
                ...(suburb === undefined
                  ? []
                  : [{ position: 4, name: suburb }]),
              ],
            },
            offers: { priceSpecification: { price, priceCurrency: currency } },
            about: {
              "@type": type,
              description: propertyType,
              numberOfBedrooms: bedrooms,
              floorSize: { value: area, unitCode: unit },
            },
          },
        ],
      },
    ],
  };
}
async function fixture(t, records) {
  const root = await mkdtemp(join(tmpdir(), "city-analytics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "raw");
  await mkdir(source);
  await snapshot(source, "2026-10-25", records);
  return { source, output: join(root, "output") };
}
async function snapshot(source, date, records) {
  await writeFile(
    join(source, `${date}.jsonl`),
    records.map(JSON.stringify).join("\n"),
  );
}
const all = (result) => result.reports[0].bedroomGroups.all;

test("completed months follow South African month rollover, leap days and year boundaries", () => {
  assert.deepEqual(completedMonths(new Date("2026-01-31T21:59:59Z")), {
    start: "2025-10-01",
    end: "2025-12-31",
    months: ["2025-10", "2025-11", "2025-12"],
  });
  assert.deepEqual(completedMonths(new Date("2026-01-31T22:00:00Z")), {
    start: "2025-11-01",
    end: "2026-01-31",
    months: ["2025-11", "2025-12", "2026-01"],
  });
  assert.equal(completedMonths(new Date("2024-03-10Z")).end, "2024-02-29");
});

test("percentiles interpolate at (n-1)q and suppress fewer than five valid observations", () => {
  assert.deepEqual(statistics([32, 16, null, 8, 4, 2, 1]), {
    count: 6,
    median: 6,
    p25: 2.5,
    p75: 14,
  });
  assert.deepEqual(statistics([0, 0, 0, 0, 0]), {
    count: 5,
    median: 0,
    p25: 0,
    p75: 0,
  });
  assert.deepEqual(statistics([1, 2, 3, 4, null]), {
    count: 4,
    median: null,
    p25: null,
    p75: null,
  });
  assert.deepEqual(statistics([]), {
    count: 0,
    median: null,
    p25: null,
    p75: null,
  });
});

test("city union retains recent-only and completed-period-only cities, including empty residential samples", async (t) => {
  const { source } = await fixture(t, [
    listing(1, { date: "2026-07-01", name: "Older City" }),
    listing(2, { date: "2026-10-20", name: "Current City" }),
    listing(3, { date: "2026-06-30", name: "Outside" }),
    listing(4, {
      name: "Commercial",
      type: "Place",
      propertyType: "Warehouse",
    }),
  ]);
  const result = await generateWebsiteData(source, now);
  assert.deepEqual(
    result.reports.map((r) => r.city.name),
    ["Commercial", "Current City", "Older City"],
  );
  assert.equal(result.directory.totalListings, 2);
  assert.deepEqual(
    result.reports.map((r) => r.bedroomGroups.all.listingCount),
    [0, 0, 1],
  );
  assert(result.reports.every((r) => r.generatedAt === now.toISOString()));
});

test("analytics deduplicate by latest snapshot and then source-line order, preserving directory counting", async (t) => {
  const { source } = await fixture(t, [
    listing(1, { price: 2000000 }),
    listing(1, { price: 6000000 }),
    listing(2, { date: "2026-10-01" }),
  ]);
  await snapshot(source, "2026-10-24", [
    listing(1, { price: 500000 }),
    listing(2),
  ]);
  const result = await generateWebsiteData(source, now);
  assert.equal(result.directory.totalListings, 2);
  assert.equal(all(result).listingCount, 1);
  assert.equal(all(result).priceDistribution.buckets[4].count, 1);
});

test("residential eligibility excludes rentals and nonresidential ads while retaining POA in counts", async (t) => {
  const { source } = await fixture(t, [
    listing(1),
    listing(2, { type: "Apartment" }),
    listing(3, { type: "Place", propertyType: "Townhouse" }),
    listing(4, { price: "POA", currency: null }),
    listing(5, { description: "Available FOR RENT" }),
    listing(6, { type: "Place", propertyType: "Warehouse" }),
  ]);
  const result = await generateWebsiteData(source, now);
  assert.equal(result.directory.totalListings, 6);
  assert.equal(all(result).listingCount, 4);
  assert.equal(all(result).askingPrice.count, 3);
  assert.equal(all(result).ratesAndTaxes.count, 4);
  assert.equal(all(result).priceDistribution.count, 3);
});

test("independent metrics use valid values and per-listing area ratios", async (t) => {
  const rows = Array.from({ length: 5 }, (_, i) =>
    listing(i + 1, {
      price: (i + 1) * 100000,
      area: 10 * (i + 1),
      rates: i * 100,
    }),
  );
  rows.push(
    listing(6, { price: "POA", rates: 0 }),
    listing(7, { area: null, rates: null }),
  );
  const { source } = await fixture(t, rows);
  const report = all(await generateWebsiteData(source, now));
  assert.equal(report.listingCount, 7);
  assert.equal(report.askingPrice.count, 6);
  assert.deepEqual(report.pricePerSquareMetre, {
    count: 5,
    median: 10000,
    p25: 10000,
    p75: 10000,
  });
  assert.equal(report.ratesAndTaxes.count, 6);
  assert.equal(report.ratesAndTaxes.median, 150);
});

test("validity limits and units are inclusive, and malformed optional values stay missing", async (t) => {
  const rows = [
    listing(1, { price: 10000, area: 5, rates: 0, bedrooms: 0 }),
    listing(2, {
      price: 1000000000,
      area: 100000,
      rates: 1000000,
      bedrooms: 100,
    }),
    listing(3, { price: 9999, area: 4.9, rates: -1, bedrooms: -1 }),
    listing(4, {
      price: "Infinity",
      area: 100001,
      rates: 1000001,
      bedrooms: 101,
    }),
    listing(5, { price: "", area: false, rates: false, bedrooms: false }),
    listing(6, { price: "1,500,000", area: "", rates: "0x10", bedrooms: "" }),
    listing(7, { price: null, area: null, rates: null, bedrooms: null }),
    listing(8, { currency: "USD", unit: "FTK" }),
    listing(9, { price: " 25000 ", area: "25", rates: "50", bedrooms: "2.5" }),
  ];
  const { source } = await fixture(t, rows);
  const report = all(await generateWebsiteData(source, now));
  assert.equal(report.listingCount, 9);
  assert.equal(report.askingPrice.count, 3);
  assert.equal(report.pricePerSquareMetre.count, 3);
  assert.equal(report.ratesAndTaxes.count, 4);
});

test("legacy bedrooms and square-metre size fields are supported", async (t) => {
  const record = listing(1);
  delete record.jsonld[0]["@graph"][0].about.floorSize;
  delete record.jsonld[0]["@graph"][0].about.numberOfBedrooms;
  record.size = 80;
  record.bedrooms = 2.5;
  const { source } = await fixture(t, [record]);
  const group = (await generateWebsiteData(source, now)).reports[0]
    .bedroomGroups["2"];
  assert.equal(group.listingCount, 1);
  assert.equal(group.pricePerSquareMetre.count, 1);
});

test("bedroom bands include fractional values without putting studios or missing values in numbered bands", async (t) => {
  const values = [0, 0.5, 1, 1.5, 2, 2.5, 3.9, 4, 4.5, 5, 5.5, null];
  const { source } = await fixture(
    t,
    values.map((bedrooms, i) => listing(i + 1, { bedrooms })),
  );
  const groups = (await generateWebsiteData(source, now)).reports[0]
    .bedroomGroups;
  assert.deepEqual(
    ["all", "1", "2", "3", "4", "5plus"].map((key) => groups[key].listingCount),
    [12, 2, 2, 1, 2, 2],
  );
});

test("monthly counts include empty months and suppressed prices do not become zero or changes", async (t) => {
  const { source } = await fixture(t, [
    listing(1, { date: "2026-07-01" }),
    listing(2, { date: "2026-09-30" }),
    listing(3, { date: "2026-10-01" }),
  ]);
  const report = all(await generateWebsiteData(source, now));
  assert.deepEqual(
    report.months.map((month) => [
      month.month,
      month.listingCount,
      month.askingPrice.median,
    ]),
    [
      ["2026-07", 1, null],
      ["2026-08", 0, null],
      ["2026-09", 1, null],
    ],
  );
  assert.equal(report.askingPriceChangePercent, null);
});

test("monthly change uses first and third medians and supports negative changes", async (t) => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    listing(i + 1, {
      date: i < 5 ? "2026-07-01" : "2026-09-30",
      price: i < 5 ? 1000000 : 900000,
    }),
  );
  const { source } = await fixture(t, rows);
  const result = await generateWebsiteData(source, now);
  assert.ok(Math.abs(all(result).askingPriceChangePercent + 10) < 1e-10);
  assert.equal(result.manifest.cities[0].indexable, true);
});

test("price bands include lower boundaries and use only valid prices as their denominator", async (t) => {
  const { source } = await fixture(
    t,
    [10000, 999999, 1000000, 2000000, 3000000, 5000000, "POA"].map((price, i) =>
      listing(i + 1, { price }),
    ),
  );
  const distribution = all(
    await generateWebsiteData(source, now),
  ).priceDistribution;
  assert.equal(distribution.count, 6);
  assert.deepEqual(
    distribution.buckets.map((b) => b.count),
    [2, 1, 1, 1, 1],
  );
  assert.ok(
    Math.abs(
      distribution.buckets.reduce((sum, b) => sum + b.percentage, 0) - 100,
    ) < 1e-10,
  );
});

test("empty priced samples have null percentages and are not indexable", async (t) => {
  const { source } = await fixture(t, [listing(1, { price: "POA" })]);
  const result = await generateWebsiteData(source, now);
  assert(
    all(result).priceDistribution.buckets.every(
      (b) => b.percentage === null && b.count === 0,
    ),
  );
  assert.equal(result.manifest.cities[0].indexable, false);
});

test("generated province/city files replace stale output without deleting other data", async (t) => {
  const { source, output } = await fixture(t, [listing(1)]);
  await writeWebsiteData(source, output, now);
  const first = JSON.parse(
    await readFile(join(output, "cities/western-cape/cape-town.json"), "utf8"),
  );
  assert.equal(first.schemaVersion, 1);
  await writeFile(join(output, "keep.txt"), "keep");
  await snapshot(source, "2026-10-25", [
    listing(2, { name: "Johannesburg", province: "Gauteng" }),
  ]);
  await writeWebsiteData(source, output, now);
  await assert.rejects(
    readFile(join(output, "cities/western-cape/cape-town.json")),
    { code: "ENOENT" },
  );
  assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "keep");
  assert.deepEqual(await readdir(join(output, "cities")), ["gauteng"]);
  assert(
    !(await readdir(output)).some((name) =>
      name.startsWith(".city-generation-"),
    ),
  );
});

test("malformed source and colliding city slugs fail before replacing generated files", async (t) => {
  const { source, output } = await fixture(t, [listing(1)]);
  await writeWebsiteData(source, output, now);
  const oldManifest = await readFile(
    join(output, "city-manifest.json"),
    "utf8",
  );
  await writeFile(join(source, "2026-10-25.jsonl"), "{broken");
  await assert.rejects(
    writeWebsiteData(source, output, now),
    /2026-10-25.jsonl:1:/,
  );
  assert.equal(
    await readFile(join(output, "city-manifest.json"), "utf8"),
    oldManifest,
  );
  await snapshot(source, "2026-10-25", [
    listing(1, { name: "A & B" }),
    listing(2, { name: "A-B" }),
  ]);
  await assert.rejects(writeWebsiteData(source, output, now), /Ambiguous/);
});

test("suburbs use breadcrumb identity scoped to province and city without locality fallback", async (t) => {
  const missing = listing(1);
  missing.jsonld[0]["@graph"][0].about.address = {
    addressLocality: "Fallback",
  };
  const canonical = listing(2, { suburb: "  Central  " });
  canonical.jsonld[0]["@graph"][0].about.address = { addressLocality: "Wrong" };
  const { source } = await fixture(t, [
    missing,
    canonical,
    listing(3, { suburb: "Central", name: "Other City" }),
    listing(4, { suburb: "Central", province: "Gauteng" }),
    listing(5, { suburb: "Cape Town" }),
    listing(6, { suburb: " " }),
  ]);
  const result = await generateWebsiteData(source, now);
  assert.equal(result.suburbReports.length, 4);
  assert.equal(
    new Set(
      result.suburbManifest.suburbs.map(
        (s) => `${s.provinceSlug}/${s.citySlug}/${s.suburbSlug}`,
      ),
    ).size,
    4,
  );
  const city = result.reports.find(
    (r) => r.city.name === "Cape Town" && r.province.name === "Western Cape",
  );
  assert.equal(city.bedroomGroups.all.listingCount, 4);
  assert.deepEqual(
    city.suburbs.map((s) => s.name),
    ["Cape Town", "Central"],
  );
});

test("suburb navigation retains broad 90-day counts, alphabetical ties and the 20/21 boundary", async (t) => {
  let id = 0;
  const rows = [
    ["Beta", 21],
    ["Alpha", 21],
    ["Small", 20],
  ].flatMap(([suburb, count]) =>
    Array.from({ length: count }, () =>
      listing(++id, {
        suburb,
        date: "2026-10-20",
        type: "Place",
        propertyType: "Warehouse",
      }),
    ),
  );
  rows.push(
    listing(++id, { suburb: "Historical", date: "2026-07-01" }),
    rows[0],
  );
  const { source } = await fixture(t, rows);
  const result = await generateWebsiteData(source, now);
  assert.deepEqual(result.reports[0].suburbs, [
    { name: "Alpha", slug: "alpha", listingCount: 21 },
    { name: "Beta", slug: "beta", listingCount: 21 },
    { name: "Small", slug: "small", listingCount: 20 },
    { name: "Historical", slug: "historical", listingCount: 0 },
  ]);
  assert.equal(result.directory.totalListings, 62);
  assert.equal(result.suburbReports.length, 4);
  assert.equal(
    result.suburbReports.find((s) => s.suburb.name === "Historical")
      .bedroomGroups.all.listingCount,
    1,
  );
  assert.equal(
    result.suburbReports.find((s) => s.suburb.name === "Alpha").bedroomGroups
      .all.listingCount,
    0,
  );
  assert(result.suburbManifest.suburbs.every((s) => !s.indexable));
});

test("suburb analytics share city metrics, bedroom bands and latest-snapshot deduplication", async (t) => {
  const rows = Array.from({ length: 15 }, (_, i) =>
    listing(i + 1, {
      suburb: "Central",
      date: `2026-0${7 + Math.floor(i / 5)}-15`,
      price: (i + 1) * 100000,
      area: 25 + i,
      rates: i * 100,
      bedrooms: [0, 1.5, 2, 4, 5, null][i % 6],
    }),
  );
  rows.push(
    listing(16, { suburb: "Central", price: "POA" }),
    listing(17, { suburb: "Central", description: "For rent" }),
  );
  const { source } = await fixture(t, rows);
  await snapshot(source, "2026-10-24", [
    listing(1, { suburb: "Former", price: 9999999 }),
  ]);
  const result = await generateWebsiteData(source, now);
  const central = result.suburbReports.find((s) => s.suburb.name === "Central");
  assert.deepEqual(central.bedroomGroups, result.reports[0].bedroomGroups);
  assert.equal(central.bedroomGroups.all.listingCount, 16);
  assert.deepEqual(central.bedroomGroups.all.askingPrice, {
    count: 15,
    median: 800000,
    p25: 450000,
    p75: 1150000,
  });
  assert.equal(
    result.suburbReports.find((s) => s.suburb.name === "Former").bedroomGroups
      .all.listingCount,
    0,
  );
  assert.deepEqual(
    result.reports[0].suburbs.map((s) => [s.name, s.listingCount]),
    [
      ["Central", 12],
      ["Former", 1],
    ],
  );
  assert.equal(
    result.suburbManifest.suburbs.find((s) => s.name === "Central").indexable,
    true,
  );
});

test("suburb generation removes stale files and rejects collisions before replacing output", async (t) => {
  const { source, output } = await fixture(t, [listing(1, { suburb: "Old" })]);
  await writeWebsiteData(source, output, now);
  await writeFile(join(output, "keep.txt"), "keep");
  await snapshot(source, "2026-10-25", [listing(2, { suburb: "New" })]);
  await writeWebsiteData(source, output, now);
  await assert.rejects(
    readFile(join(output, "suburbs/western-cape/cape-town/old.json")),
    { code: "ENOENT" },
  );
  const path = join(output, "suburbs/western-cape/cape-town/new.json");
  const previous = await readFile(path, "utf8");
  const manifest = await readFile(join(output, "suburb-manifest.json"), "utf8");
  assert.equal(JSON.parse(previous).suburb.name, "New");
  assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "keep");
  await snapshot(source, "2026-10-25", [
    listing(1, { suburb: "A & B" }),
    listing(2, { suburb: "A-B" }),
  ]);
  await assert.rejects(
    writeWebsiteData(source, output, now),
    /Ambiguous or empty suburb route/,
  );
  assert.equal(await readFile(path, "utf8"), previous);
  assert.equal(
    await readFile(join(output, "suburb-manifest.json"), "utf8"),
    manifest,
  );
});
