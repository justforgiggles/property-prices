import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createReportCatalog,
  getSupportedRows,
  getSharedRows,
  isSupportedPriceRow,
  findPriceDifference,
  toReportCity,
  type PriceRow,
} from "../src/lib/reports";
import type {
  CityData,
  Cohort,
  Evidence,
  PropertyType,
  Provenance,
} from "../src/lib/insights/types";
import { distribution, quantile } from "../src/lib/insights/statistics";

const provenance: Provenance = {
  asOf: "2026-10-21",
  windowStart: "2026-07-24",
  windowDays: 90,
  rawSha256: "fixture",
  rawRows: 100,
  cleanRows: 100,
  cohortRows: 100,
  generatedAt: "2026-10-21T12:00:00.000Z",
};

function cohort(
  type: PropertyType,
  bedrooms: number,
  evidence: Evidence = "supported",
  price = 1_000_000,
): Cohort {
  const summary = distribution(Array(35).fill(price));
  return {
    ...summary,
    type,
    bedrooms,
    evidence,
    reasons:
      evidence === "supported"
        ? ["Window-sensitive evidence."]
        : ["Evidence does not support a headline."],
    variants: { image: summary, group: summary },
  };
}

function city(
  province: string,
  slug: string,
  name: string,
  cohorts: Cohort[],
): CityData {
  return {
    name,
    slug,
    href: `/${province}/${slug}/`,
    listingCount: 150,
    defaultBrief: { type: "house", bedrooms: 3 },
    cohorts,
    space: null,
    suburbs: [],
    province: { name: province, slug: province, href: `/${province}/` },
  };
}

function row(
  type: PropertyType = "house",
  bedrooms = 3,
  median = 1_000_000,
): PriceRow {
  return {
    type,
    bedrooms,
    count: 35,
    evidence: "supported",
    p5: median,
    p25: median,
    median,
    p75: median,
    p95: median,
    reasons: [],
    qualificationLabels: [],
  };
}

test("report matrix always contains twelve type/bedroom rows and suppresses every unsupported price", () => {
  const source = city("gauteng", "pretoria", "Pretoria", [
    cohort("house", 1),
    cohort("flat", 2, "limited"),
    cohort("house", 3, "unstable"),
    cohort("townhouse", 4, "insufficient"),
    cohort("house", 0),
    cohort("flat", 5),
  ]);
  const before = structuredClone(source);
  const report = toReportCity(source);
  assert.equal(report.rows.length, 12);
  assert.deepEqual(
    report.rows.map((item) => `${item.type}:${item.bedrooms}`),
    [
      "house:1",
      "house:2",
      "house:3",
      "house:4",
      "flat:1",
      "flat:2",
      "flat:3",
      "flat:4",
      "townhouse:1",
      "townhouse:2",
      "townhouse:3",
      "townhouse:4",
    ],
  );
  assert.equal(report.rows[0].median, 1_000_000);
  assert.deepEqual(report.rows[0].reasons, ["Window-sensitive evidence."]);
  for (const item of report.rows.slice(1)) {
    assert.equal(item.p5, null);
    assert.equal(item.p95, null);
    assert.deepEqual(item.qualificationLabels, []);
    assert.equal(item.p25, null);
    assert.equal(item.median, null);
    assert.equal(item.p75, null);
  }
  const missing = report.rows[1];
  assert.equal(missing.count, 0);
  assert.equal(missing.evidence, "insufficient");
  assert.ok(missing.reasons[0].includes("No captured records"));
  assert.equal(report.rows[2].count, 35);
  assert.equal(report.rows[2].evidence, "unstable");
  assert.deepEqual(source, before);
  assert.doesNotMatch(
    JSON.stringify(report),
    /"prices"|"variants"|"suburbs"|"defaultBrief"|"space"/,
  );
});

test("catalog eligibility requires a supported one-to-four-bedroom row and a matching supported row for pairs", () => {
  const first = city("gauteng", "first", "Zulu", [cohort("house", 3)]);
  const second = city("western-cape", "second", "Alpha", [
    cohort("house", 3),
    cohort("flat", 2),
  ]);
  const third = city("gauteng", "third", "Middle", [cohort("flat", 2)]);
  const zeroOnly = city("gauteng", "studio", "Studio", [cohort("flat", 0)]);
  const fiveOnly = city("gauteng", "large", "Large", [cohort("house", 5)]);
  const unstable = city("gauteng", "unstable", "Unstable", [
    cohort("house", 3, "unstable"),
  ]);
  const result = createReportCatalog(
    [third, first, second, zeroOnly, fiveOnly, unstable, first],
    provenance,
  );
  assert.deepEqual(
    result.cities.map((item) => item.name),
    ["Alpha", "Middle", "Zulu"],
  );
  assert.deepEqual(result.pairs, [
    {
      left: "gauteng/first",
      right: "western-cape/second",
      href: "/compare/gauteng/first/vs/western-cape/second/",
    },
    {
      left: "gauteng/third",
      right: "western-cape/second",
      href: "/compare/gauteng/third/vs/western-cape/second/",
    },
  ]);
  assert.deepEqual(
    createReportCatalog([second, first, third], provenance),
    result,
  );
  assert.equal(
    result.pairs.some((pair) => pair.left === pair.right),
    false,
  );
  assert.equal(
    result.pairs.some((pair) => pair.left === "western-cape/second"),
    false,
  );
  assert.equal(
    result.pairs.some(
      (pair) => pair.href.includes("undefined") || pair.href.includes("null"),
    ),
    false,
  );
  assert.equal(
    result.pairs.some(
      (pair) => pair.left === "gauteng/first" && pair.right === "gauteng/third",
    ),
    false,
  );
});

test("same-name cities remain distinct and canonical pair order follows ASCII keys, not display names", () => {
  const first = city("western-cape", "shared", "Shared", [cohort("house", 1)]);
  const second = city("gauteng", "shared", "Shared", [cohort("house", 1)]);
  const result = createReportCatalog([first, second], provenance);
  assert.deepEqual(
    result.cities.map((item) => item.key),
    ["gauteng/shared", "western-cape/shared"],
  );
  assert.equal(result.pairs.length, 1);
  assert.equal(
    result.pairs[0].href,
    "/compare/gauteng/shared/vs/western-cape/shared/",
  );
  assert.deepEqual(createReportCatalog([], provenance).pairs, []);
  assert.deepEqual(createReportCatalog([first], provenance).pairs, []);
});

test("price differences are signed right minus left and never compare unmatched or unsupported rows", () => {
  assert.deepEqual(findPriceDifference(row(), row("house", 3, 1_250_000)), {
    amount: 250_000,
    percentage: 25,
  });
  assert.deepEqual(findPriceDifference(row("house", 3, 1_250_000), row()), {
    amount: -250_000,
    percentage: -20,
  });
  assert.deepEqual(findPriceDifference(row(), row()), {
    amount: 0,
    percentage: 0,
  });
  assert.equal(findPriceDifference(row(), row("flat")), null);
  assert.equal(findPriceDifference(row(), row("house", 2)), null);
  for (const evidence of ["limited", "insufficient", "unstable"] as const) {
    assert.equal(findPriceDifference(row(), { ...row(), evidence }), null);
    assert.equal(findPriceDifference({ ...row(), evidence }, row()), null);
  }
  for (const median of [null, 0, Infinity, NaN]) {
    assert.equal(findPriceDifference({ ...row(), median }, row()), null);
    assert.equal(findPriceDifference(row(), { ...row(), median }), null);
  }
});

test("server report lookup caches one read and rejects reversed, self, malformed and absent pairs", async () => {
  const temp = await mkdtemp(join(tmpdir(), "reports-server-"));
  try {
    const cwd = join(temp, "website");
    await mkdir(join(cwd, ".generated"), { recursive: true });
    const catalog = createReportCatalog(
      [
        city("gauteng", "pretoria", "Pretoria", [cohort("house", 3)]),
        city("western-cape", "cape-town", "Cape Town", [cohort("house", 3)]),
      ],
      provenance,
    );
    await writeFile(
      join(cwd, ".generated/reports.json"),
      JSON.stringify(catalog),
    );
    const script = `
      import assert from "node:assert/strict";
      import { registerHooks } from "node:module";
      import { writeFile } from "node:fs/promises";
      registerHooks({ resolve(specifier, context, next) {
        return specifier === "server-only" ? {url:"data:text/javascript,export {}",shortCircuit:true} : next(specifier, context);
      }});
      const reports = await import(${JSON.stringify(new URL("../src/lib/reports-server.ts", import.meta.url).href)});
      const first = await reports.getReportCatalog();
      assert.equal(Object.isFrozen(first), true);
      assert.equal(Object.isFrozen(first.cities[0].rows[0].reasons), true);
      assert.equal(Object.isFrozen(first.cities[0].rows[0].qualificationLabels), true);
      assert.equal((await reports.findCityReport("gauteng", "pretoria")).name, "Pretoria");
      assert.equal(await reports.findCityReport("gauteng", "absent"), null);
      const pair = await reports.findComparisonReport("gauteng", "pretoria", "western-cape", "cape-town");
      assert.equal(pair.href, "/compare/gauteng/pretoria/vs/western-cape/cape-town/");
      assert.equal(await reports.findComparisonReport("western-cape", "cape-town", "gauteng", "pretoria"), null);
      assert.equal(await reports.findComparisonReport("gauteng", "pretoria", "gauteng", "pretoria"), null);
      assert.equal(await reports.findComparisonReport("../gauteng", "pretoria", "western-cape", "cape-town"), null);
      assert.equal(await reports.findComparisonReport("gauteng", "absent", "western-cape", "cape-town"), null);
      await writeFile(".generated/reports.json", "invalid JSON after first read");
      assert.equal(await reports.getReportCatalog(), first);
      assert.equal((await reports.findCityReport("gauteng", "pretoria")).name, "Pretoria");
    `;
    execFileSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "-e",
        script,
      ],
      { cwd, stdio: "pipe" },
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("export sitemap includes only reports and canonical pairs and omits it without an origin", async () => {
  const temp = await mkdtemp(join(tmpdir(), "reports-sitemap-"));
  try {
    for (const directory of ["scripts", ".generated", "out"]) {
      await mkdir(join(temp, directory));
    }
    const catalog = createReportCatalog(
      [
        city("gauteng", "pretoria", "Pretoria", [cohort("house", 3)]),
        city("western-cape", "cape-town", "Cape Town", [cohort("house", 3)]),
      ],
      provenance,
    );
    await writeFile(
      join(temp, ".generated/reports.json"),
      JSON.stringify(catalog),
    );
    const script = join(temp, "scripts/export-metadata.mjs");
    await writeFile(
      script,
      await readFile(
        new URL("../scripts/export-metadata.mjs", import.meta.url),
        "utf8",
      ),
    );
    execFileSync(process.execPath, [script], {
      env: { ...process.env, SITE_URL: "https://atlas.example" },
      stdio: "pipe",
    });
    const sitemap = await readFile(join(temp, "out/sitemap.xml"), "utf8");
    assert.match(sitemap, /https:\/\/atlas\.example\/gauteng\/pretoria\//);
    assert.match(
      sitemap,
      /https:\/\/atlas\.example\/compare\/gauteng\/pretoria\/vs\/western-cape\/cape-town\//,
    );
    assert.doesNotMatch(
      sitemap,
      /<loc>https:\/\/atlas\.example\/gauteng\/<\/loc>/,
    );
    assert.doesNotMatch(
      sitemap,
      /compare\/western-cape\/cape-town\/vs\/gauteng/,
    );
    assert.equal((sitemap.match(/<url>/g) ?? []).length, 5);
    execFileSync(process.execPath, [script], {
      env: { ...process.env, SITE_URL: "" },
      stdio: "pipe",
    });
    await assert.rejects(readFile(join(temp, "out/sitemap.xml"), "utf8"), {
      code: "ENOENT",
    });
    assert.doesNotMatch(
      await readFile(join(temp, "out/robots.txt"), "utf8"),
      /Sitemap:/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("weighted tails match expanded linear quantiles across ties and fractional ranks", () => {
  const samples = [
    [100],
    [100, 900],
    [100, 100, 100, 200, 500, 500, 900],
    Array.from(
      { length: 41 },
      (_, index) => Math.floor(index / 3) * 12345 + 100000,
    ),
    [...Array(99).fill(100000), 9000000],
  ];
  for (const prices of samples) {
    const summary = distribution(prices);
    const input = { ...cohort("house", 3), ...summary };
    const report = toReportCity(city("gauteng", "test", "Test", [input]));
    const actual = report.rows[2];
    const sorted = [...prices].sort((left, right) => left - right);
    assert.equal(actual.p5, quantile(sorted, 0.05));
    assert.equal(actual.p95, quantile(sorted, 0.95));
  }
});

test("qualification labels use structured window diagnostics and retain full reasons", () => {
  const input = {
    ...cohort("house", 3),
    checks: {
      priceGuard: { count: 35, median: 1000000 },
      windows: [
        { days: 30 as const, count: 29, median: 2000000 },
        { days: 60 as const, count: 29, median: 2000000 },
        { days: 180 as const, count: 30, median: 1100001 },
      ],
    },
  };
  const report = toReportCity(city("gauteng", "test", "Test", [input]));
  assert.deepEqual(report.rows[2].qualificationLabels, [
    "Prices vary with the listing window.",
    "Shorter-window samples are small.",
  ]);
  assert.deepEqual(report.rows[2].reasons, input.reasons);
  const exactBoundary = {
    ...input,
    checks: {
      ...input.checks,
      windows: [
        { days: 30 as const, count: 30, median: 1100000 },
        { days: 60 as const, count: 30, median: 900000 },
        { days: 180 as const, count: 29, median: 2000000 },
      ],
    },
  };
  assert.deepEqual(
    toReportCity(city("gauteng", "test", "Test", [exactBoundary])).rows[2]
      .qualificationLabels,
    [],
  );
  assert.deepEqual(
    toReportCity(
      city("gauteng", "test", "Test", [{ ...input, evidence: "unstable" }]),
    ).rows[2].qualificationLabels,
    [],
  );
  assert.deepEqual(
    toReportCity(city("gauteng", "test", "Test", [cohort("house", 3)])).rows[2]
      .qualificationLabels,
    [],
  );
});

test("supported and shared helpers require complete five-point prices and matching briefs", () => {
  assert.equal(isSupportedPriceRow(row()), true);
  for (const field of ["p5", "p25", "median", "p75", "p95"] as const) {
    assert.equal(isSupportedPriceRow({ ...row(), [field]: null }), false);
  }
  assert.equal(isSupportedPriceRow({ ...row(), evidence: "unstable" }), false);
  const left = toReportCity(
    city("gauteng", "left", "Left", [
      cohort("house", 3),
      cohort("flat", 2),
      cohort("townhouse", 4, "limited"),
    ]),
  );
  const right = toReportCity(
    city("gauteng", "right", "Right", [
      cohort("house", 3),
      cohort("flat", 1),
      cohort("flat", 2, "unstable"),
    ]),
  );
  assert.deepEqual(
    getSupportedRows(left).map((item) => [item.type, item.bedrooms]),
    [
      ["house", 3],
      ["flat", 2],
    ],
  );
  const shared = getSharedRows(left, right);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].left, left.rows[2]);
  assert.equal(shared[0].right, right.rows[2]);
  assert.deepEqual(getSharedRows(left, { ...right, rows: [] }), []);
});
