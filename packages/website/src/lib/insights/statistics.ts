import type { Distribution } from "./types";
export function quantile(sorted: number[], probability: number): number | null {
  if (!sorted.length) {
    return null;
  }
  const index = (sorted.length - 1) * probability;
  const lo = Math.floor(index),
    hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
export function distribution(prices: number[]): Distribution {
  const sorted = [...prices].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const price of sorted) {
    counts.set(price, (counts.get(price) ?? 0) + 1);
  }
  return {
    count: sorted.length,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    prices: [...counts],
  };
}
