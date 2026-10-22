import type {
  CityData,
  Cohort,
  PriceFrequency,
  Evidence,
  PropertyType,
  Provenance,
} from "./insights/types";

export const reportPropertyTypes = ["house", "flat", "townhouse"] as const;

export type PriceRow = {
  type: PropertyType;
  bedrooms: number;
  count: number;
  evidence: Evidence;
  p5: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p95: number | null;
  reasons: string[];
  qualificationLabels: string[];
};

export type SupportedPriceRow = PriceRow & {
  evidence: "supported";
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
};

function findWeightedQuantile(
  prices: PriceFrequency[],
  probability: number,
): number | null {
  const count = prices.reduce((total, [, frequency]) => total + frequency, 0);
  if (!count) {
    return null;
  }
  const rank = (count - 1) * probability;
  const lowerRank = Math.floor(rank);
  const upperRank = Math.ceil(rank);
  let cumulative = 0;
  let lower: number | null = null;
  for (const [price, frequency] of prices) {
    cumulative += frequency;
    if (lower === null && cumulative > lowerRank) {
      lower = price;
    }
    if (cumulative > upperRank && lower !== null) {
      return lower + (price - lower) * (rank - lowerRank);
    }
  }
  return null;
}

function getQualificationLabels(cohort: Cohort): string[] {
  if (cohort.evidence !== "supported") {
    return [];
  }
  const windows = cohort.checks?.windows ?? [];
  const median = cohort.median;
  const labels: string[] = [];
  if (
    median !== null &&
    median > 0 &&
    windows.some(
      (window) =>
        window.count >= 30 &&
        window.median !== null &&
        Math.abs(window.median - median) / median > 0.1,
    )
  ) {
    labels.push("Prices vary with the listing window.");
  }
  if (
    windows.some(
      (window) =>
        (window.days === 30 || window.days === 60) && window.count < 30,
    )
  ) {
    labels.push("Shorter-window samples are small.");
  }
  return labels;
}

export function isSupportedPriceRow(row: PriceRow): row is SupportedPriceRow {
  return (
    row.evidence === "supported" &&
    row.p5 !== null &&
    row.p25 !== null &&
    row.median !== null &&
    row.p75 !== null &&
    row.p95 !== null
  );
}

export function getSupportedRows(city: ReportCity): SupportedPriceRow[] {
  return city.rows.filter(isSupportedPriceRow);
}

export function getSharedRows(
  left: ReportCity,
  right: ReportCity,
): { left: SupportedPriceRow; right: SupportedPriceRow }[] {
  const rightRows = getSupportedRows(right);
  return getSupportedRows(left).flatMap((leftRow) => {
    const rightRow = rightRows.find(
      (candidate) =>
        candidate.type === leftRow.type &&
        candidate.bedrooms === leftRow.bedrooms,
    );
    return rightRow ? [{ left: leftRow, right: rightRow }] : [];
  });
}

export type ReportCity = {
  key: string;
  name: string;
  slug: string;
  provinceName: string;
  provinceSlug: string;
  href: string;
  listingCount: number;
  rows: PriceRow[];
};

export type CityPair = { left: string; right: string; href: string };
export type ReportCatalog = {
  provenance: Provenance;
  cities: ReportCity[];
  pairs: CityPair[];
};

export function toReportCity(city: CityData): ReportCity {
  const rows = reportPropertyTypes.flatMap((type) =>
    Array.from({ length: 4 }, (_, index): PriceRow => {
      const bedrooms = index + 1;
      const cohort = city.cohorts.find(
        (candidate) =>
          candidate.type === type && candidate.bedrooms === bedrooms,
      );
      if (!cohort) {
        return {
          type,
          bedrooms,
          count: 0,
          evidence: "insufficient",
          p5: null,
          p25: null,
          median: null,
          p75: null,
          p95: null,
          qualificationLabels: [],
          reasons: [
            "No captured records match this home type and bedroom count.",
          ],
        };
      }
      const supported = cohort.evidence === "supported";
      return {
        type,
        bedrooms,
        count: cohort.count,
        evidence: cohort.evidence,
        p5: supported ? findWeightedQuantile(cohort.prices, 0.05) : null,
        p25: supported ? cohort.p25 : null,
        median: supported ? cohort.median : null,
        p75: supported ? cohort.p75 : null,
        p95: supported ? findWeightedQuantile(cohort.prices, 0.95) : null,
        reasons: [...cohort.reasons],
        qualificationLabels: getQualificationLabels(cohort),
      };
    }),
  );
  return {
    key: `${city.province.slug}/${city.slug}`,
    name: city.name,
    slug: city.slug,
    provinceName: city.province.name,
    provinceSlug: city.province.slug,
    href: `/${city.province.slug}/${city.slug}/`,
    listingCount: city.listingCount,
    rows,
  };
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createReportCatalog(
  cities: CityData[],
  provenance: Provenance,
): ReportCatalog {
  const byKey = new Map<string, ReportCity>();
  for (const city of cities) {
    const report = toReportCity(city);
    if (
      report.rows.some((row) => row.evidence === "supported") &&
      !byKey.has(report.key)
    ) {
      byKey.set(report.key, report);
    }
  }
  const canonicalCities = [...byKey.values()].sort((left, right) =>
    compareKeys(left.key, right.key),
  );
  const pairs: CityPair[] = [];
  for (let leftIndex = 0; leftIndex < canonicalCities.length; leftIndex++) {
    const left = canonicalCities[leftIndex];
    for (const right of canonicalCities.slice(leftIndex + 1)) {
      if (
        !left.rows.some(
          (row) =>
            row.evidence === "supported" &&
            right.rows.some(
              (other) =>
                other.type === row.type &&
                other.bedrooms === row.bedrooms &&
                other.evidence === "supported",
            ),
        )
      ) {
        continue;
      }
      pairs.push({
        left: left.key,
        right: right.key,
        href: `/compare/${left.key}/vs/${right.key}/`,
      });
    }
  }
  const directory = [...canonicalCities].sort(
    (left, right) =>
      left.name.localeCompare(right.name, "en-ZA") ||
      compareKeys(left.key, right.key),
  );
  return { provenance: { ...provenance }, cities: directory, pairs };
}

export function findPriceDifference(
  left: PriceRow,
  right: PriceRow,
): { amount: number; percentage: number } | null {
  if (
    left.type !== right.type ||
    left.bedrooms !== right.bedrooms ||
    left.evidence !== "supported" ||
    right.evidence !== "supported" ||
    left.median === null ||
    right.median === null ||
    !Number.isFinite(left.median) ||
    !Number.isFinite(right.median) ||
    left.median <= 0 ||
    right.median <= 0
  ) {
    return null;
  }
  const amount = right.median - left.median;
  return { amount, percentage: (amount / left.median) * 100 };
}
