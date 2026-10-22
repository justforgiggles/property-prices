import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assignGroups,
  cleanRows,
  extract,
  normalize,
  numeric,
  variants,
  type Row,
} from "../scripts/data";
import { distribution, quantile } from "../src/lib/insights/statistics";
import {
  findCohort,
  getBudgetFit,
  selectSuburbs,
} from "../src/lib/insights/client";
import type { Area, Cohort, CityData } from "../src/lib/insights/types";
const website = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "1",
    price: 1_000_000,
    province: "gauteng",
    city: "pretoria",
    suburb: "test",
    bedrooms: 3,
    bathrooms: 2,
    floor_size: 100,
    rates: 500,
    date: "2026-10-01",
    snapshot: "2026-10-01",
    kind: "House",
    property_type: "House",
    street: "__unknown__",
    image: "",
    description: "A home",
    group: 0,
    ...overrides,
  };
}
function cohort(prices: number[], image = prices, group = prices): Cohort {
  return {
    ...distribution(prices),
    type: "house",
    bedrooms: 3,
    evidence: "supported",
    reasons: [],
    variants: { image: distribution(image), group: distribution(group) },
  };
}
function area(name: string, c: Cohort): Area {
  return {
    name,
    slug: name,
    href: null,
    listingCount: c.count,
    defaultBrief: { type: "house", bedrooms: 3 },
    cohorts: [c],
    space: null,
  };
}
function rawRecord(
  id: number,
  city: string,
  bedrooms: number,
  size: number | null = 100,
  kind = "House",
  price = 1_250_000,
  duplicateImage?: string,
  date = "2026-10-01",
): object {
  return {
    id,
    ratesAndTaxes: 0,
    jsonld: [
      {
        "@graph": [
          {
            datePosted: date,
            breadcrumb: {
              itemListElement: [
                { position: 2, name: "Gauteng" },
                { position: 3, name: city },
                { position: 4, name: "Test Suburb" },
              ],
            },
            about: {
              "@type": kind === "House" ? "House" : "Apartment",
              description: kind,
              numberOfBedrooms: bedrooms,
              numberOfBathroomsTotal: 2,
              floorSize: { value: size },
              address: { streetAddress: `${id} PRIVATE_STREET` },
            },
            offers: {
              priceSpecification: { price: String(price) },
              offeredBy: { name: "PRIVATE_CONTACT" },
            },
            image: duplicateImage ?? `PRIVATE_IMAGE_${id}`,
            description: "PRIVATE_DESCRIPTION",
          },
        ],
      },
    ],
  };
}
test("extraction preserves missing versus explicit null and separates townhouses", () => {
  const record = {
    id: 1,
    bedrooms: 8,
    size: 90,
    jsonld: [
      {
        "@graph": [
          {
            about: {
              "@type": "Apartment",
              description: "Townhouse",
              numberOfBedrooms: null,
              address: {},
            },
            breadcrumb: { itemListElement: [] },
            offers: { priceSpecification: { price: "900000" } },
            datePosted: "2026-10-01",
          },
        ],
      },
    ],
  };
  const result = extract(record, "2026-10-01");
  assert.equal(result.bedrooms, null);
  assert.equal(result.floor_size, 90);
  assert.equal(result.property_type, "Townhouse");
  assert.equal(result.province, "__unknown__");
  assert.equal(numeric(""), null);
  assert.equal(numeric(null), null);
  assert.equal(numeric("POA"), null);
  assert.equal(numeric("0"), 0);
  assert.equal(normalize("  KwaZulu-Natal  "), "kwazulu natal");
  assert.equal(normalize("Straße ﬃ ς"), "strasse ffi σ");
});
test("cleaner excludes rentals and nonresidential records, nulls feature errors, keeps last ID without mutating input", () => {
  const input = [
    row({ id: "a", bedrooms: 101 }),
    row({ id: "b", price: 9999 }),
    row({ id: "c", description: "Home available for rental" }),
    row({ id: "d", kind: "Place", property_type: "Land" }),
    row({ id: "e", bedrooms: 0, rates: 0 }),
    row({
      id: "e",
      date: "2026-10-02",
      price: 2_000_000,
      bedrooms: 0,
      rates: 0,
    }),
  ];
  const before = structuredClone(input);
  const result = cleanRows(input);
  assert.deepEqual(input, before);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].bedrooms, null);
  assert.equal(result.rows[1].price, 2_000_000);
  assert.equal(result.rows[1].bedrooms, 0);
  assert.equal(result.audit.excluded_rows, 3);
  assert.equal(result.audit.repeated_ids_removed, 1);
  assert.equal(result.audit.invalid_features_set_missing.bedrooms, 1);
});
test("duplicate grouping is transitive and conservative images retain differing units", () => {
  const original = [
    row({ id: "1", image: "same", street: "1 a" }),
    row({ id: "2", image: "same", street: "2 b" }),
    row({ id: "3", image: "different", street: "2 b" }),
    row({ id: "4", image: "same", bedrooms: 2 }),
  ];
  const grouped = assignGroups(original);
  assert.equal(new Set(grouped.map((r) => r.group)).size, 1);
  assert.notEqual(grouped[0], original[0]);
  const result = variants(grouped);
  assert.equal(result.image.length, 3);
  assert.equal(result.group.length, 1);
  assert.equal(result.group[0].id, "1");
});
test("quantiles match linear interpolation and inclusive budget ties remain exact", () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([10], 0.25), 10);
  assert.equal(quantile([10, 20, 30, 40], 0.25), 17.5);
  const c = cohort([100, 200, 200, 300]);
  assert.deepEqual(c.prices, [
    [100, 1],
    [200, 2],
    [300, 1],
  ]);
  assert.equal(getBudgetFit(c, 200).within, 3);
  assert.equal(getBudgetFit(c, 199).within, 1);
  for (const budget of [
    0,
    -1,
    1.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(getBudgetFit(c, budget).evidence, "insufficient");
  }
});
test("budget instability catches majority changes even under ten percentage points", () => {
  const baseline = [...Array(51).fill(100), ...Array(49).fill(200)];
  const changed = [...Array(50).fill(100), ...Array(50).fill(200)];
  assert.equal(
    getBudgetFit(cohort(baseline, changed), 100).evidence,
    "unstable",
  );
  const bigShift = [...Array(35).fill(100), ...Array(65).fill(200)];
  assert.equal(
    getBudgetFit(cohort(changed, bigShift), 100).evidence,
    "unstable",
  );
});
test("suburb selection uses ten deepest supported cohorts then median, and missing briefs stay missing", () => {
  const areas = Array.from({ length: 12 }, (_, i) =>
    area(String(i), cohort(Array(30 + i).fill(200 - i))),
  );
  const result = selectSuburbs(areas, { type: "house", bedrooms: 3 }, null);
  assert.equal(result.length, 10);
  assert.deepEqual(
    result.map((a) => a.name),
    ["11", "10", "9", "8", "7", "6", "5", "4", "3", "2"],
  );
  assert.equal(findCohort(areas[0], { type: "flat", bedrooms: 2 }), null);
});
test("generator applies 19/20/29/30 evidence and 70% space boundaries without exporting private fields", async () => {
  const temp = await mkdtemp(join(tmpdir(), "insights-fixture-"));
  try {
    let id = 0;
    const records: object[] = [];
    for (const [bedrooms, count] of [
      [0, 19],
      [1, 20],
      [2, 29],
      [3, 32],
    ]) {
      records.push(
        ...Array.from({ length: count }, () =>
          rawRecord(++id, "Threshold City", bedrooms),
        ),
      );
    }
    for (const [city, measured] of [
      ["Space Pass", 70],
      ["Space Fail", 69],
    ] as const) {
      records.push(
        ...Array.from({ length: 100 }, (_, i) =>
          rawRecord(
            ++id,
            city,
            2,
            i < measured ? 80 : null,
            "Apartment / Flat",
          ),
        ),
      );
    }
    records.push(
      ...Array.from({ length: 100 }, (_, i) =>
        rawRecord(
          ++id,
          "Duplicate Shift",
          3,
          100,
          "House",
          i < 60 ? 1_000_000 : 2_000_000,
          i < 60 ? "PRIVATE_DUPLICATE" : undefined,
        ),
      ),
    );
    records.push(
      ...Array.from({ length: 100 }, () =>
        rawRecord(++id, "Duplicate Shift", 2, 80, "Apartment / Flat"),
      ),
    );
    records.push(
      ...Array.from({ length: 100 }, (_, i) =>
        rawRecord(
          ++id,
          "Window City",
          3,
          100,
          "House",
          i < 60 ? 1_000_000 : 2_000_000,
          undefined,
          i < 60 ? "2026-08-01" : "2026-10-01",
        ),
      ),
    );
    records.push(
      ...Array.from({ length: 100 }, () =>
        rawRecord(
          ++id,
          "Short Window City",
          3,
          100,
          "House",
          1_000_000,
          undefined,
          "2026-08-01",
        ),
      ),
    );
    for (const [city, guarded] of [
      ["Guard Shift", 40],
      ["Guard Sparse", 20],
    ] as const) {
      records.push(
        ...Array.from({ length: 100 }, (_, i) =>
          rawRecord(
            ++id,
            city,
            3,
            100,
            "House",
            i < guarded ? 200_000 : 50_000,
          ),
        ),
      );
      records.push(
        ...Array.from({ length: 100 }, () =>
          rawRecord(++id, city, 2, 80, "Apartment / Flat"),
        ),
      );
    }
    records.push(
      ...Array.from({ length: 100 }, () =>
        rawRecord(++id, "Space Tight Fail", 2, 200, "Apartment / Flat"),
      ),
    );
    await writeFile(
      join(temp, "2026-10-01.jsonl"),
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    const output = join(temp, "output");
    function generateFixture(): void {
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          join(website, "scripts/generate-insights.ts"),
          "--data-dir",
          temp,
          "--output-dir",
          output,
          "--as-of",
          "2026-10-21",
          "--generated-at",
          "2026-10-21T12:00:00.000Z",
        ],
        { cwd: website, stdio: "pipe" },
      );
    }
    generateFixture();
    const city: CityData = JSON.parse(
      await readFile(
        join(output, "cities/gauteng/threshold-city.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      city.cohorts.map((c) => c.evidence),
      ["insufficient", "limited", "limited", "supported"],
    );
    const pass: CityData = JSON.parse(
      await readFile(join(output, "cities/gauteng/space-pass.json"), "utf8"),
    );
    const fail: CityData = JSON.parse(
      await readFile(join(output, "cities/gauteng/space-fail.json"), "utf8"),
    );
    const shifted: CityData = JSON.parse(
      await readFile(
        join(output, "cities/gauteng/duplicate-shift.json"),
        "utf8",
      ),
    );
    const unstable = findCohort(shifted, { type: "house", bedrooms: 3 });
    assert.equal(unstable?.evidence, "unstable");
    assert.equal(unstable?.variants.group.count, 41);
    assert.equal(unstable?.variants.group.median, 2_000_000);
    assert.deepEqual(shifted.defaultBrief, { type: "flat", bedrooms: 2 });
    async function readCity(slug: string): Promise<CityData> {
      return JSON.parse(
        await readFile(join(output, `cities/gauteng/${slug}.json`), "utf8"),
      ) as CityData;
    }
    const window = findCohort(await readCity("window-city"), {
      type: "house",
      bedrooms: 3,
    })!;
    assert.equal(window.evidence, "supported");
    assert.equal(
      window.checks?.windows.find((check) => check.days === 30)?.count,
      40,
    );
    assert.equal(
      window.checks?.windows.find((check) => check.days === 30)?.median,
      2_000_000,
    );
    assert.ok(
      window.reasons.some(
        (reason) =>
          reason.includes("30-day") && reason.includes("window-sensitive"),
      ),
    );
    const shortWindow = findCohort(await readCity("short-window-city"), {
      type: "house",
      bedrooms: 3,
    })!;
    assert.ok(
      shortWindow.reasons.some(
        (reason) =>
          reason.includes("30-day") && reason.includes("only 0 records"),
      ),
    );
    for (const slug of ["guard-shift", "guard-sparse"]) {
      const guarded = findCohort(await readCity(slug), {
        type: "house",
        bedrooms: 3,
      })!;
      assert.equal(guarded.evidence, "unstable");
      assert.ok(
        guarded.reasons.some((reason) => reason.includes("price guardrail")),
      );
    }
    assert.equal((await readCity("space-tight-fail")).space, null);
    assert.equal(pass.space?.coverage, 70);
    assert.equal(fail.space, null);
    assert.doesNotMatch(
      JSON.stringify([city, pass, fail]),
      /PRIVATE_|"id"|"street"|"description"|"image"\s*:\s*"/,
    );
    const first = await readFile(join(output, "catalog.json"), "utf8");
    generateFixture();
    assert.equal(await readFile(join(output, "catalog.json"), "utf8"), first);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
