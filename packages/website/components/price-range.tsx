import { compactRand, rand, type PriceRange } from "@/lib/city-report";

export function PriceRangeVisual({
  value,
  compact = false,
}: {
  value: PriceRange;
  compact?: boolean;
}) {
  const format = compact ? compactRand : rand;
  const position =
    ((value.median - value.lower) / (value.upper - value.lower)) * 100;
  return (
    <div>
      <div
        className="relative mx-1 my-5 h-1.5 rounded-full bg-primary/15"
        aria-hidden="true"
      >
        <span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-card bg-primary ring-1 ring-primary/25"
          style={{ left: `${position}%` }}
        />
      </div>
      <dl className="flex justify-between gap-4 text-sm tabular-nums">
        <div>
          <dt className="text-xs text-muted-foreground">25th percentile</dt>
          <dd className="mt-1 font-medium">{format(value.lower)}</dd>
        </div>
        <div className="text-right">
          <dt className="text-xs text-muted-foreground">75th percentile</dt>
          <dd className="mt-1 font-medium">{format(value.upper)}</dd>
        </div>
      </dl>
    </div>
  );
}
