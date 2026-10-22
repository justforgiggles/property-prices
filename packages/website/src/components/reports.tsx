import type { ReactElement } from "react";
import { Plus } from "lucide-react";
import { formatCount, formatPrice } from "@/lib/format";
import {
  findPriceDifference,
  getSharedRows,
  getSupportedRows,
  type ReportCity,
  type SupportedPriceRow,
} from "@/lib/reports";
import {
  getPriceDomain,
  formatPlotPrice,
  type PriceDomain,
} from "@/lib/price-plot";
import { PricePlot } from "@/components/price-plot";

const categories = [
  { type: "house", name: "Houses" },
  { type: "flat", name: "Flats" },
  { type: "townhouse", name: "Townhouses" },
] as const;

function ExactFigures({
  row,
  cityName,
}: {
  row: SupportedPriceRow;
  cityName: string;
}): ReactElement {
  return (
    <details className="plot-figures">
      <summary>
        About these figures{" "}
        <span className="sr-only">
          for {cityName}, {row.bedrooms}-bedroom {row.type}s
        </span>
        <Plus size={14} aria-hidden="true" />
      </summary>
      <div>
        <p className="plot-figures-intro">
          {formatCount(row.count)} recorded asking prices in {cityName}. These
          percentiles describe the recorded sample, not final selling prices or
          current availability.
        </p>
        <dl>
          {(
            [
              ["5th percentile", row.p5],
              ["25th percentile", row.p25],
              ["Median", row.median],
              ["75th percentile", row.p75],
              ["95th percentile", row.p95],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{formatPlotPrice(value)}</dd>
            </div>
          ))}
        </dl>
        {row.reasons.length > 0 && (
          <ul>
            {row.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function CityDistribution({
  row,
  cityName,
  domain,
  paired = false,
  tone = "primary",
}: {
  row: SupportedPriceRow;
  cityName: string;
  domain: PriceDomain;
  paired?: boolean;
  tone?: "primary" | "secondary";
}): ReactElement {
  return (
    <div className={`city-distribution distribution-${tone}`}>
      {paired && (
        <p className="distribution-city">
          <span aria-hidden="true" />
          {cityName}
        </p>
      )}
      <div className="distribution-heading">
        <div>
          <span className="distribution-label">Median asking price</span>
          <strong>{formatPrice(row.median)}</strong>
        </div>
        <p>
          {formatCount(row.count)}
          <span>listing records</span>
        </p>
      </div>
      <PricePlot row={row} domain={domain} cityName={cityName} tone={tone} />
      <p className="distribution-middle">
        <span>Middle half</span>
        <strong>
          {formatPrice(row.p25)}–{formatPrice(row.p75)}
        </strong>
      </p>
      {row.qualificationLabels.length > 0 && (
        <div className="plot-qualifications">
          {row.qualificationLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
      <ExactFigures row={row} cityName={cityName} />
    </div>
  );
}

function DifferenceNote({
  left,
  right,
  leftName,
  rightName,
}: {
  left: SupportedPriceRow;
  right: SupportedPriceRow;
  leftName: string;
  rightName: string;
}): ReactElement {
  const difference = findPriceDifference(left, right);
  if (!difference) {
    throw new Error(
      "A displayed city comparison requires supported matching rows.",
    );
  }
  return (
    <div data-testid="price-difference" className="plot-difference">
      {difference.amount === 0 ? (
        <p>
          <strong>Same recorded median.</strong> {leftName} and {rightName} have
          a {formatPrice(0)} difference (0.0%).
        </p>
      ) : (
        <p>
          <strong>
            {formatPrice(Math.abs(difference.amount))}{" "}
            {difference.amount > 0 ? "higher" : "lower"}
          </strong>{" "}
          median in {rightName} than {leftName} (
          {Math.abs(difference.percentage).toFixed(1)}%).
        </p>
      )}
    </div>
  );
}

export function CityPriceReport({
  city,
  idPrefix = "",
}: {
  city: ReportCity;
  idPrefix?: string;
}): ReactElement {
  const supported = getSupportedRows(city);
  return (
    <div className="price-report">
      {categories.map((category) => {
        const rows = supported.filter((row) => row.type === category.type);
        if (rows.length === 0) {
          return null;
        }
        const domain = getPriceDomain(rows);
        return (
          <section
            key={category.type}
            id={`${idPrefix}${category.name.toLowerCase()}`}
            className="report-category"
          >
            <div className="report-category-heading">
              <div>
                <h2>
                  {category.name} in {city.name}
                </h2>
              </div>
              <p>One price scale across {category.name.toLowerCase()}.</p>
            </div>
            <div className="distribution-grid">
              {rows.map((row) => (
                <article
                  className="distribution-card"
                  key={row.bedrooms}
                  data-testid="price-row"
                  data-category={`${row.type}-${row.bedrooms}`}
                >
                  <h3>
                    {row.bedrooms}
                    <span>{row.bedrooms === 1 ? "bedroom" : "bedrooms"}</span>
                  </h3>
                  <CityDistribution
                    row={row}
                    cityName={city.name}
                    domain={domain}
                  />
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function CityComparisonReport({
  left,
  right,
  idPrefix = "",
}: {
  left: ReportCity;
  right: ReportCity;
  idPrefix?: string;
}): ReactElement {
  const shared = getSharedRows(left, right);
  return (
    <div className="comparison-report">
      {categories.map((category) => {
        const rows = shared.filter((row) => row.left.type === category.type);
        if (rows.length === 0) {
          return null;
        }
        const domain = getPriceDomain(
          rows.flatMap((row) => [row.left, row.right]),
        );
        return (
          <section
            key={category.type}
            id={`${idPrefix}${category.name.toLowerCase()}`}
            className="report-category"
          >
            <div className="report-category-heading">
              <div>
                <h2>{category.name}, side by side</h2>
              </div>
              <p>One price scale across both cities.</p>
            </div>
            <div className="distribution-grid">
              {rows.map((row) => (
                <article
                  className="distribution-card paired-distribution-card"
                  key={row.left.bedrooms}
                  data-testid="comparison-row"
                  data-category={`${row.left.type}-${row.left.bedrooms}`}
                >
                  <h3>
                    {row.left.bedrooms}
                    <span>
                      {row.left.bedrooms === 1 ? "bedroom" : "bedrooms"}
                    </span>
                  </h3>
                  <CityDistribution
                    row={row.left}
                    cityName={left.name}
                    domain={domain}
                    paired
                  />
                  <CityDistribution
                    row={row.right}
                    cityName={right.name}
                    domain={domain}
                    tone="secondary"
                    paired
                  />
                  <DifferenceNote
                    left={row.left}
                    right={row.right}
                    leftName={left.name}
                    rightName={right.name}
                  />
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
