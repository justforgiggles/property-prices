export type Statistics = {
  count: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
};

export type BedroomGroupId = "all" | "1" | "2" | "3" | "4" | "5plus";
export type BedroomGroup = {
  listingCount: number;
  askingPrice: Statistics;
  pricePerSquareMetre: Statistics;
  ratesAndTaxes: Statistics;
  askingPriceChangePercent: number | null;
  months: { month: string; listingCount: number; askingPrice: Statistics }[];
  priceDistribution: {
    count: number;
    buckets: {
      min: number;
      max: number | null;
      count: number;
      percentage: number | null;
    }[];
  };
};
export type LocationAnalytics = {
  schemaVersion: 1;
  generatedAt: string;
  province: { name: string; slug: string };
  city: { name: string; slug: string };
  period: { start: string; end: string };
  bedroomGroups: Record<BedroomGroupId, BedroomGroup>;
};

export type SuburbLink = { name: string; slug: string; listingCount: number };
export type CityAnalytics = LocationAnalytics & { suburbs: SuburbLink[] };
export type SuburbAnalytics = LocationAnalytics & {
  suburb: { name: string; slug: string };
};

export const bedroomTabs: { id: BedroomGroupId; label: string }[] = [
  { id: "all", label: "All bedrooms" },
  { id: "1", label: "1 bedroom" },
  { id: "2", label: "2 bedrooms" },
  { id: "3", label: "3 bedrooms" },
  { id: "4", label: "4 bedrooms" },
  { id: "5plus", label: "5+ bedrooms" },
];

export function rand(value: number | null) {
  return value === null
    ? "—"
    : `R${new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 0 }).format(value)}`;
}

export function compactRand(value: number | null) {
  return value !== null && value >= 1_000_000
    ? `R${(value / 1_000_000).toFixed(2)}m`
    : rand(value);
}

export function formatMonth(month: string, full = false) {
  return new Intl.DateTimeFormat("en-GB", {
    month: full ? "long" : "short",
    ...(full ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export function formatPeriod(period: LocationAnalytics["period"]) {
  const start = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    ...(period.start.slice(0, 4) !== period.end.slice(0, 4)
      ? { year: "numeric" as const }
      : {}),
    timeZone: "UTC",
  }).format(new Date(`${period.start}T00:00:00Z`));
  const end = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period.end}T00:00:00Z`));
  return `${start} – ${end}`;
}

export function bucketLabel(min: number, max: number | null) {
  const short = (value: number) => `R${value / 1_000_000}m`;
  return min === 0
    ? `Under ${short(max!)}`
    : max === null
      ? `${short(min)}+`
      : `${short(min)}–${short(max)}`;
}
