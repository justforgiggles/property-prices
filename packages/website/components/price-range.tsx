import { compactRand, rand, type Statistics } from "@/lib/city-report";

export function PriceRangeVisual({
  value,
  compact = false,
  label = "Middle 50% price range",
  emptyMessage = "There aren’t enough asking prices to show a useful comparison yet.",
}: {
  value: Statistics;
  compact?: boolean;
  label?: string;
  emptyMessage?: string;
}) {
  const format = compact ? compactRand : rand;
  if (value.median === null || value.p25 === null || value.p75 === null) {
    return <p className="my-5 text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  const position =
    value.p75 === value.p25
      ? 50
      : ((value.median - value.p25) / (value.p75 - value.p25)) * 100;
  return (
    <div>
      <p className="mt-4 text-xs text-muted-foreground">{label}</p>
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
          <dt className="sr-only">Lower end of the middle 50% range</dt>
          <dd className="mt-1 font-medium">{format(value.p25)}</dd>
        </div>
        <div className="text-right">
          <dt className="sr-only">Upper end of the middle 50% range</dt>
          <dd className="mt-1 font-medium">{format(value.p75)}</dd>
        </div>
      </dl>
    </div>
  );
}
