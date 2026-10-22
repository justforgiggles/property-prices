import type { Metadata } from "next";
import type { ReactElement } from "react";
import {
  SiteHeader,
  SiteFooter,
  SectionHeading,
  EvidenceDisclosure,
} from "@/components/atlas";
import { CityPriceReport, CityComparisonReport } from "@/components/reports";
import { CityDirectory } from "@/components/city-directory";
import { getReportCatalog } from "@/lib/reports-server";
import { PlotLegend, PricePlot } from "@/components/price-plot";
import { getPriceDomain } from "@/lib/price-plot";
import { getSupportedRows, type SupportedPriceRow } from "@/lib/reports";

export const metadata: Metadata = {
  title: "Design system · Home Atlas",
  robots: { index: false, follow: false },
};

export default async function DesignSystemPage(): Promise<ReactElement> {
  const catalog = await getReportCatalog();
  const pretoria = catalog.cities.find(
    (city) => city.key === "gauteng/pretoria",
  );
  const capeTown = catalog.cities.find(
    (city) => city.key === "western-cape/cape-town",
  );
  if (!pretoria || !capeTown) {
    throw new Error(
      "The design system requires Pretoria and Cape Town reports.",
    );
  }
  const longestNames = [...catalog.cities]
    .sort((left, right) => right.name.length - left.name.length)
    .slice(0, 6);
  const equalDemo: SupportedPriceRow = {
    type: "house",
    bedrooms: 2,
    count: 100,
    evidence: "supported",
    p5: 1000000,
    p25: 1000000,
    median: 1000000,
    p75: 1000000,
    p95: 1000000,
    reasons: [],
    qualificationLabels: [],
  };
  const coincidentDemo: SupportedPriceRow = {
    ...equalDemo,
    p5: 500000,
    p95: 1500000,
  };
  const demoDomain = getPriceDomain([equalDemo, coincidentDemo]);
  const palette = [
    { name: "Canvas", color: "#F7F5EF" },
    { name: "Surface", color: "#FFFFFF" },
    { name: "Ink", color: "#172C28" },
    { name: "Muted", color: "#52645D" },
    { name: "Primary", color: "#195C46" },
    { name: "Accent", color: "#B75C3B" },
    { name: "Border", color: "#D9E0D9" },
  ];
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell design-system">
        <header className="page-intro">
          <p className="eyebrow">The field guide · Design foundations</p>
          <h1>
            Clear reports.
            <br />
            <em>A closer perspective.</em>
          </h1>
          <p className="intro-copy">
            The Home Atlas component library. Consistent home categories,
            readable comparisons and evidence that stays visible.
          </p>
        </header>
        <section className="section-space">
          <SectionHeading
            eyebrow="01 / Foundations"
            title="Warm, clear, considered."
            description="Fraunces tells the story. Manrope makes the numbers and evidence easy to read."
          />
          <div className="palette-grid">
            {palette.map((token) => (
              <div key={token.name}>
                <div
                  className="palette-swatch"
                  style={{ background: token.color }}
                />
                <strong>{token.name}</strong>
                <p className="fine-print">{token.color}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="section-space">
          <SectionHeading
            eyebrow="02 / Discovery"
            title="Find a city. Open its report."
            description="Real longer place names test the directory at every screen width. Search also demonstrates the empty state."
          />
          <CityDirectory
            cities={longestNames.map((city) => ({
              key: city.key,
              name: city.name,
              provinceName: city.provinceName,
              href: city.href,
            }))}
          />
        </section>
        <section className="section-space">
          <SectionHeading
            eyebrow="03 / The city report"
            title="A clear view of the spread."
            description="Actual Pretoria data. Only supported home categories are shown, with a shared price axis per property section."
          />
          <p className="report-reading-note">
            {getSupportedRows(pretoria).length} of {pretoria.rows.length}{" "}
            categories have supported evidence. The other categories are
            omitted.
          </p>
          <PlotLegend />
          <CityPriceReport city={pretoria} />
        </section>
        <section className="section-space">
          <SectionHeading
            eyebrow="04 / The comparison report"
            title="The same categories, side by side."
            description="Actual Pretoria and Cape Town data. Only categories supported in both cities appear; the shared price axis makes their distributions directly readable."
          />
          <CityComparisonReport
            left={pretoria}
            right={capeTown}
            idPrefix="comparison-"
          />
        </section>
        <section className="section-space">
          <SectionHeading
            eyebrow="05 / Geometry checks"
            title="Coincident values stay coincident."
            description="Synthetic examples for component validation, not market evidence. Both use exactly the same price axis."
          />
          <div className="plot-demo-grid">
            <div className="plot-demo">
              <h3>All five values equal</h3>
              <PricePlot
                row={equalDemo}
                domain={demoDomain}
                cityName="Synthetic equal-values example"
              />
              <p>
                Every percentile is R1 000 000. A single marker preserves the
                zero spread.
              </p>
            </div>
            <div className="plot-demo">
              <h3>A zero-width middle half</h3>
              <PricePlot
                row={coincidentDemo}
                domain={demoDomain}
                cityName="Synthetic coincident-values example"
                tone="secondary"
              />
              <p>
                P5: R500 000; P25, median and P75: R1 000 000; P95: R1 500 000.
                No artificial box width.
              </p>
            </div>
          </div>
        </section>
        <section className="section-space">
          <SectionHeading
            eyebrow="06 / Evidence"
            title="The detail stays close."
          />
          <EvidenceDisclosure provenance={catalog.provenance} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
