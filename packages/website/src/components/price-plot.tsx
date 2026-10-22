import type { ReactElement } from "react";
import type { SupportedPriceRow } from "@/lib/reports";
import {
  formatAxisPrice,
  formatPlotPrice,
  getPricePlotMarks,
  type PriceDomain,
} from "@/lib/price-plot";

function getSvgPosition(value: number): number {
  return 8 + value * 384;
}

export function PricePlot({
  row,
  domain,
  cityName,
  tone = "primary",
}: {
  row: SupportedPriceRow;
  domain: PriceDomain;
  cityName: string;
  tone?: "primary" | "secondary";
}): ReactElement {
  const marks = getPricePlotMarks(row, domain);
  const description = `${cityName}, ${row.bedrooms}-bedroom ${row.type === "flat" ? "flats" : `${row.type}s`}. 5th percentile ${formatPlotPrice(row.p5)}; 25th percentile ${formatPlotPrice(row.p25)}; median ${formatPlotPrice(row.median)}; 75th percentile ${formatPlotPrice(row.p75)}; 95th percentile ${formatPlotPrice(row.p95)}. ${marks.coincident ? "All five percentile values coincide." : "Line shows the middle 90%; box shows the middle half."}`;
  return (
    <div className={`price-plot price-plot-${tone}`}>
      <svg
        data-testid="price-plot"
        data-domain-min={domain.min}
        data-domain-max={domain.max}
        role="img"
        aria-label={description}
        viewBox="0 0 400 44"
        preserveAspectRatio="none"
      >
        <line x1="8" x2="392" y1="22" y2="22" className="plot-baseline" />
        {!marks.coincident && (
          <>
            <line
              x1={getSvgPosition(marks.p5)}
              x2={getSvgPosition(marks.p95)}
              y1="22"
              y2="22"
              className="plot-whisker"
            />
            <line
              x1={getSvgPosition(marks.p5)}
              x2={getSvgPosition(marks.p5)}
              y1="15"
              y2="29"
              className="plot-cap"
            />
            <line
              x1={getSvgPosition(marks.p95)}
              x2={getSvgPosition(marks.p95)}
              y1="15"
              y2="29"
              className="plot-cap"
            />
            <rect
              x={getSvgPosition(marks.p25)}
              y="11"
              width={getSvgPosition(marks.p75) - getSvgPosition(marks.p25)}
              height="22"
              rx="2"
              className="plot-box"
            />
          </>
        )}
        <line
          x1={getSvgPosition(marks.median)}
          x2={getSvgPosition(marks.median)}
          y1="7"
          y2="37"
          className="plot-median"
        />
      </svg>
      <div className="plot-axis" aria-hidden="true">
        <span>{formatAxisPrice(domain.min)}</span>
        <span>{formatAxisPrice((domain.min + domain.max) / 2)}</span>
        <span>{formatAxisPrice(domain.max)}</span>
      </div>
    </div>
  );
}

export function PlotLegend(): ReactElement {
  return (
    <div className="plot-legend" aria-label="How to read the price plots">
      <p>Read the asking-price spread</p>
      <div>
        <span>
          <svg width="30" height="16" viewBox="0 0 30 16" aria-hidden="true">
            <path
              d="M2 8H28M2 4V12M28 4V12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          Line: middle 90%
        </span>
        <span>
          <svg width="30" height="16" viewBox="0 0 30 16" aria-hidden="true">
            <rect
              x="2"
              y="3"
              width="26"
              height="10"
              fill="currentColor"
              opacity=".25"
            />
          </svg>
          Box: middle half
        </span>
        <span>
          <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
            <path d="M11 1V15" stroke="currentColor" strokeWidth="3" />
          </svg>
          Marker: median
        </span>
      </div>
      <small>
        The median is the middle recorded asking price. Each property section
        shares one price scale; the outer 10% is not shown.
      </small>
    </div>
  );
}
