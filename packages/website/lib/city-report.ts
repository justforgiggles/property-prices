// Illustrative fixtures only. City identity comes from the directory; analytics do not.
export type PriceRange = { lower: number; median: number; upper: number };
export type CityReport = {
  id: string;
  label: string;
  listings: number;
  askingPrice: PriceRange;
  pricePerSquareMetre: PriceRange;
  ratesAndTaxes: PriceRange;
  months: {
    month: string;
    listings: number;
    lower: number;
    median: number;
    upper: number;
    range: [number, number];
  }[];
  buckets: { label: string; count: number; share: number }[];
};

export const reportPeriod = "July–September 2026";
const bucketLabels = ["Under R1m", "R1m–R2m", "R2m–R3m", "R3m–R5m", "R5m+"];
const range = (lower: number, median: number, upper: number): PriceRange => ({
  lower,
  median,
  upper,
});

function report(
  id: string,
  label: string,
  askingPrice: PriceRange,
  pricePerSquareMetre: PriceRange,
  ratesAndTaxes: PriceRange,
  counts: [number, number, number],
  buckets: [number, number, number, number, number],
): CityReport {
  const listings = counts.reduce((sum, count) => sum + count, 0);
  return {
    id,
    label,
    listings,
    askingPrice,
    pricePerSquareMetre,
    ratesAndTaxes,
    months: ["Jul", "Aug", "Sep"].map((month, index) => {
      const factor = [0.96, 1, 1.03][index];
      const lower = Math.round(askingPrice.lower * factor);
      const upper = Math.round(askingPrice.upper * factor);
      return {
        month,
        listings: counts[index],
        lower,
        median: Math.round(askingPrice.median * factor),
        upper,
        range: [lower, upper],
      };
    }),
    buckets: bucketLabels.map((label, index) => ({
      label,
      count: buckets[index],
      share: (buckets[index] / listings) * 100,
    })),
  };
}

export const cityReports: CityReport[] = [
  report(
    "all",
    "All bedrooms",
    range(1650000, 2850000, 4950000),
    range(24500, 36700, 52400),
    range(820, 1450, 2700),
    [550, 600, 650],
    [184, 413, 386, 477, 340],
  ),
  report(
    "1",
    "1 bedroom",
    range(980000, 1450000, 2100000),
    range(28000, 38500, 53000),
    range(480, 780, 1150),
    [100, 105, 115],
    [85, 145, 65, 20, 5],
  ),
  report(
    "2",
    "2 bedrooms",
    range(1500000, 2250000, 2900000),
    range(26500, 37500, 52000),
    range(720, 1180, 1800),
    [160, 175, 185],
    [70, 180, 160, 90, 20],
  ),
  report(
    "3",
    "3 bedrooms",
    range(2200000, 3350000, 4600000),
    range(22000, 32500, 47000),
    range(1100, 1850, 3000),
    [150, 160, 180],
    [20, 65, 130, 190, 85],
  ),
  report(
    "4",
    "4 bedrooms",
    range(3200000, 4850000, 7600000),
    range(23500, 34500, 49500),
    range(1700, 2800, 4200),
    [85, 100, 105],
    [5, 15, 25, 130, 115],
  ),
  report(
    "5plus",
    "5+ bedrooms",
    range(4500000, 6800000, 10500000),
    range(25000, 36500, 55000),
    range(2300, 3900, 6100),
    [49, 53, 58],
    [2, 4, 4, 43, 107],
  ),
];

export function rand(value: number) {
  return `R${new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 0 }).format(value)}`;
}

export function compactRand(value: number) {
  return value >= 1_000_000
    ? `R${(value / 1_000_000).toFixed(2)}m`
    : rand(value);
}
