import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readData, variants, type Row } from "./data";
import { distribution } from "../src/lib/insights/statistics";
import { createReportCatalog } from "../src/lib/reports";
import type {
  Area,
  Brief,
  Catalog,
  CityData,
  Cohort,
  PropertyType,
  SpaceSummary,
} from "../src/lib/insights/types";
const website = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function parseOption(key: string): string | undefined {
  const i = args.indexOf(key);
  return i < 0 ? undefined : args[i + 1];
}
const names: Record<PropertyType, string> = {
  house: "House",
  flat: "Apartment / Flat",
  townhouse: "Townhouse",
};
const profiles: Brief[] = Object.keys(names).flatMap((type) =>
  Array.from({ length: 7 }, (_, bedrooms) => ({
    type: type as PropertyType,
    bedrooms,
  })),
);
const data = await readData(
  parseOption("--data-dir") ?? resolve(website, "../../data/raw"),
);
const asOf =
  parseOption("--as-of") ??
  data.rows.reduce((date, r) => (r.date > date ? r.date : date), "");
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
  new Date(asOf + "T00:00:00Z").toISOString().slice(0, 10) !== asOf
) {
  throw Error("Invalid --as-of date");
}
const start = new Date(Date.parse(asOf + "T00:00:00Z") - 89 * 86400000)
  .toISOString()
  .slice(0, 10);
const rows = data.rows.filter((r) => r.date >= start && r.date <= asOf);
type Sets = ReturnType<typeof variants> & {
  priceGuard: Row[];
  days30: Row[];
  days60: Row[];
  days180: Row[];
};
function publicationWindow(days: number): Row[] {
  const since = new Date(
    Date.parse(asOf + "T00:00:00Z") - (days - 1) * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  return data.rows.filter((row) => row.date >= since && row.date <= asOf);
}
const all: Sets = {
  ...variants(rows),
  priceGuard: rows.filter(
    (row) => row.price >= 100_000 && row.price <= 50_000_000,
  ),
  days30: publicationWindow(30),
  days60: publicationWindow(60),
  days180: publicationWindow(180),
};
function toSlug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function toDisplayLabel(s: string): string {
  return s === "kwazulu natal" ? "KwaZulu-Natal" : (data.labels.get(s) ?? s);
}
function selectRows(sets: Sets, predicate: (r: Row) => boolean): Sets {
  return {
    baseline: sets.baseline.filter(predicate),
    image: sets.image.filter(predicate),
    group: sets.group.filter(predicate),
    priceGuard: sets.priceGuard.filter(predicate),
    days30: sets.days30.filter(predicate),
    days60: sets.days60.filter(predicate),
    days180: sets.days180.filter(predicate),
  };
}
function cohort(sets: Sets, brief: Brief): Cohort {
  const s = selectRows(
    sets,
    (r) =>
      r.property_type === names[brief.type] && r.bedrooms === brief.bedrooms,
  );
  const baseline = distribution(s.baseline.map((r) => r.price)),
    image = distribution(s.image.map((r) => r.price)),
    group = distribution(s.group.map((r) => r.price));
  const reasons: string[] = [];
  let evidence: Cohort["evidence"] =
    baseline.count < 20
      ? "insufficient"
      : baseline.count < 30
        ? "limited"
        : "supported";
  if (evidence === "insufficient") {
    reasons.push(
      "Fewer than 20 captured listings; local summaries are withheld.",
    );
  }
  if (evidence === "limited") {
    reasons.push("20–29 captured listings; limited descriptive evidence.");
  }
  if (evidence === "supported" && Math.min(image.count, group.count) < 30) {
    evidence = "unstable";
    reasons.push(
      "Fewer than 30 records remain after reducing potentially repeated listings.",
    );
  }
  if (
    evidence === "supported" &&
    [image, group].some(
      (v) => Math.abs(v.median! - baseline.median!) / baseline.median! > 0.1,
    )
  ) {
    evidence = "unstable";
    reasons.push(
      "The median changes by more than 10% under duplicate sensitivity checks.",
    );
  }
  const guard = distribution(s.priceGuard.map((row) => row.price));
  if (
    evidence === "supported" &&
    (guard.count < 30 ||
      Math.abs(guard.median! - baseline.median!) / baseline.median! > 0.1)
  ) {
    evidence = "unstable";
    reasons.push(
      "The R100k–R50m price guardrail leaves fewer than 30 records or changes the median by more than 10%.",
    );
  }
  const windows = ([30, 60, 180] as const).map((days) => {
    const result = distribution(s[`days${days}`].map((row) => row.price));
    if (evidence === "supported") {
      if (days < 90 && result.count < 30) {
        reasons.push(
          `The ${days}-day publication sample has only ${result.count} records, too few to check the shorter-window median reliably.`,
        );
      } else if (
        result.count >= 30 &&
        Math.abs(result.median! - baseline.median!) / baseline.median! > 0.1
      ) {
        reasons.push(
          `The ${days}-day publication-sample median differs by more than 10% from this 90-day result. This is window-sensitive descriptive evidence, not a market price trend.`,
        );
      }
    }
    return { days, count: result.count, median: result.median };
  });
  return {
    ...baseline,
    ...brief,
    evidence,
    reasons,
    variants: { image, group },
    checks: {
      priceGuard: { count: guard.count, median: guard.median },
      windows,
    },
  };
}
function space(sets: Sets): SpaceSummary | null {
  const summaries = [sets.baseline, sets.image, sets.group].map((rs) => {
    const selected = rs.filter(
      (r) =>
        r.property_type === names.flat &&
        r.bedrooms === 2 &&
        r.price >= 1e6 &&
        r.price <= 1.5e6,
    );
    const sizes = selected.flatMap((r) =>
      r.floor_size !== null && r.floor_size >= 30 && r.floor_size <= 300
        ? [r.floor_size]
        : [],
    );
    const tight = sizes.filter((size) => size >= 40 && size <= 150);
    return {
      tight: distribution(tight),
      tightCoverage: selected.length
        ? (tight.length / selected.length) * 100
        : 0,
      ...distribution(sizes),
      total: selected.length,
      coverage: selected.length ? (sizes.length / selected.length) * 100 : 0,
    };
  });
  const [base, ...alternatives] = summaries;
  if (
    summaries.some(
      (x) =>
        x.count < 30 ||
        x.coverage < 70 ||
        x.tight.count < 30 ||
        x.tightCoverage < 70 ||
        Math.abs(x.tight.median! - x.median!) / x.median! > 0.1,
    ) ||
    alternatives.some(
      (x) => Math.abs(x.median! - base.median!) / base.median! > 0.1,
    )
  ) {
    return null;
  }
  return {
    count: base.count,
    total: base.total,
    p25: base.p25!,
    median: base.median!,
    p75: base.p75!,
    coverage: base.coverage,
    evidence: "supported",
  };
}
function area(
  name: string,
  href: string | null,
  sets: Sets,
  children: Area[] = [],
): Area {
  const cohorts = profiles
    .map((p) => cohort(sets, p))
    .filter((c) => c.count > 0);
  const eligible = cohorts.filter((c) => c.evidence === "supported");
  function countSupportedChildren(c: Cohort): number {
    return children.filter((a) =>
      a.cohorts.some(
        (x) =>
          x.type === c.type &&
          x.bedrooms === c.bedrooms &&
          x.evidence === "supported",
      ),
    ).length;
  }
  eligible.sort(
    (a, b) =>
      countSupportedChildren(b) - countSupportedChildren(a) ||
      Math.min(b.count, b.variants.image.count, b.variants.group.count) -
        Math.min(a.count, a.variants.image.count, a.variants.group.count),
  );
  const chosen = eligible[0] ?? cohorts[0];
  return {
    name: toDisplayLabel(name),
    slug: toSlug(name),
    href,
    listingCount: sets.baseline.length,
    defaultBrief: chosen
      ? { type: chosen.type, bedrooms: chosen.bedrooms }
      : { type: "house", bedrooms: 3 },
    cohorts,
    space: space(sets),
  };
}
const output = parseOption("--output-dir") ?? join(website, ".generated");
async function writeJson(path: string, value: unknown): Promise<void> {
  const target = join(output, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value) + "\n");
}
const provinces: Area[] = [],
  routes: Catalog["cities"] = [];
const allCities: CityData[] = [];
for (const province of ["gauteng", "western cape", "kwazulu natal"]) {
  const provinceSlug = toSlug(province),
    ps = selectRows(all, (r) => r.province === province),
    cities: Area[] = [],
    used = new Set<string>();
  for (const city of [...new Set(ps.baseline.map((r) => r.city))].sort()) {
    const cs = selectRows(ps, (r) => r.city === city);
    if (cs.baseline.length < 100) {
      continue;
    }
    const citySlug = toSlug(city);
    if (!citySlug || used.has(citySlug)) {
      throw Error("City slug collision: " + city);
    }
    used.add(citySlug);
    const suburbs = [...new Set(cs.baseline.map((r) => r.suburb))]
      .sort()
      .map((s) =>
        area(
          s,
          null,
          selectRows(cs, (r) => r.suburb === s),
        ),
      );
    const a = area(city, `/${provinceSlug}/${citySlug}/`, cs, suburbs);
    if (!a.cohorts.some((c) => c.evidence === "supported")) {
      continue;
    }
    const result: CityData = {
      ...a,
      province: {
        name: toDisplayLabel(province),
        slug: provinceSlug,
        href: `/${provinceSlug}/`,
      },
      suburbs,
    };
    cities.push(a);
    routes.push({ province: provinceSlug, city: citySlug });
    allCities.push(result);
    await writeJson(`cities/${provinceSlug}/${citySlug}.json`, result);
  }
  const a = area(province, `/${provinceSlug}/`, ps, cities);
  provinces.push(a);
  await writeJson(`provinces/${provinceSlug}.json`, { ...a, cities });
}
const catalog: Catalog = {
  provenance: {
    asOf,
    windowStart: start,
    windowDays: 90,
    rawSha256: data.source.raw_sha256,
    rawRows: data.raw.length,
    cleanRows: data.rows.length,
    cohortRows: rows.length,
    generatedAt: parseOption("--generated-at") ?? new Date().toISOString(),
  },
  provinces,
  cities: routes,
  featuredComparison: {
    province: "gauteng",
    city: "pretoria",
    brief: { type: "house", bedrooms: 3 },
    budget: 2e6,
  },
};
await writeJson("catalog.json", catalog);
const reports = createReportCatalog(allCities, catalog.provenance);
await writeJson("reports.json", reports);
await writeJson("audit.json", {
  ...data.source,
  ...data.audit,
  asOf,
  windowStart: start,
  cohortRows: rows.length,
  groups: new Set(data.rows.map((r) => r.group)).size,
  variants: {
    baseline: rows.length,
    image: all.image.length,
    group: all.group.length,
  },
  eligibleCities: routes.length,
  cityDefaults: allCities.map((c) => ({
    province: c.province.slug,
    city: c.slug,
    brief: c.defaultBrief,
  })),
});
console.log(
  `Generated ${reports.cities.length} city reports and ${reports.pairs.length} comparisons from ${rows.length} cohort records (${asOf}).`,
);
