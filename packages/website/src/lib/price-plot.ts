export type FiveNumberSummary = {
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
};
export type PriceDomain = { min: number; max: number };
export type PricePlotMarks = FiveNumberSummary & { coincident: boolean };

export function getPriceDomain(rows: FiveNumberSummary[]): PriceDomain {
  if (rows.length === 0) {
    throw new Error("A price axis needs at least one supported distribution.");
  }
  const lowest = Math.min(...rows.map((row) => row.p5));
  const highest = Math.max(...rows.map((row) => row.p95));
  if (
    !Number.isFinite(lowest) ||
    !Number.isFinite(highest) ||
    lowest < 0 ||
    highest < lowest
  ) {
    throw new Error("A price axis requires finite ordered nonnegative prices.");
  }
  const span = highest - lowest;
  const padding = span > 0 ? span * 0.06 : Math.max(highest * 0.1, 1);
  const rawStep = (span + padding * 2) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;
  return {
    min: Math.max(0, Math.floor((lowest - padding) / step) * step),
    max: Math.ceil((highest + padding) / step) * step,
  };
}

export function getPricePosition(price: number, domain: PriceDomain): number {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(domain.min) ||
    !Number.isFinite(domain.max) ||
    domain.max <= domain.min
  ) {
    throw new Error(
      "A price position requires a finite value and a nonempty axis.",
    );
  }
  return (price - domain.min) / (domain.max - domain.min);
}

export function getPricePlotMarks(
  row: FiveNumberSummary,
  domain: PriceDomain,
): PricePlotMarks {
  return {
    p5: getPricePosition(row.p5, domain),
    p25: getPricePosition(row.p25, domain),
    median: getPricePosition(row.median, domain),
    p75: getPricePosition(row.p75, domain),
    p95: getPricePosition(row.p95, domain),
    coincident: row.p5 === row.p95,
  };
}

export function formatAxisPrice(price: number): string {
  if (price >= 1000000) {
    return `R${new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 }).format(price / 1000000)}m`;
  }
  if (price >= 1000) {
    return `R${new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 1 }).format(price / 1000)}k`;
  }
  return `R${new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 }).format(price)}`;
}

export function formatPlotPrice(price: number): string {
  return `R${new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 }).format(price).replace(/\s/g, " ")}`;
}
