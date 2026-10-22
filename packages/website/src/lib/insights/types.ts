export type PropertyType = "house" | "flat" | "townhouse";
export type Brief = { type: PropertyType; bedrooms: number };
export type Evidence = "supported" | "limited" | "insufficient" | "unstable";
export type PriceFrequency = [price: number, count: number];
export type Distribution = {
  count: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
  prices: PriceFrequency[];
};
export type Cohort = Distribution &
  Brief & {
    evidence: Evidence;
    reasons: string[];
    variants: { image: Distribution; group: Distribution };
    checks?: {
      priceGuard: { count: number; median: number | null };
      windows: { days: 30 | 60 | 180; count: number; median: number | null }[];
    };
  };
export type SpaceSummary = {
  count: number;
  total: number;
  p25: number;
  median: number;
  p75: number;
  coverage: number;
  evidence: "supported";
};
export type Area = {
  space: SpaceSummary | null;
  name: string;
  slug: string;
  href: string | null;
  listingCount: number;
  defaultBrief: Brief;
  cohorts: Cohort[];
};
export type ProvinceData = Area & { cities: Area[] };
export type CityData = Area & {
  province: { name: string; slug: string; href: string };
  suburbs: Area[];
};
export type Provenance = {
  asOf: string;
  windowStart: string;
  windowDays: number;
  rawSha256: string;
  rawRows: number;
  cleanRows: number;
  cohortRows: number;
  generatedAt: string;
};
export type Catalog = {
  provenance: Provenance;
  provinces: Area[];
  cities: { province: string; city: string }[];
  featuredComparison: {
    province: string;
    city: string;
    brief: Brief;
    budget: number;
  };
};
