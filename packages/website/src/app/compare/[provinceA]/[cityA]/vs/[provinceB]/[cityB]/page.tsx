import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import {
  SiteHeader,
  SiteFooter,
  EvidenceDisclosure,
  ReportJumpLinks,
} from "@/components/atlas";
import { PlotLegend } from "@/components/price-plot";
import { getSharedRows } from "@/lib/reports";
import { CityComparisonReport } from "@/components/reports";
import { formatDate } from "@/lib/format";
import { findComparisonReport, getReportCatalog } from "@/lib/reports-server";
import { getPageMetadata } from "@/lib/site";

export const dynamicParams = false;
type RouteParams = {
  provinceA: string;
  cityA: string;
  provinceB: string;
  cityB: string;
};
type Props = { params: Promise<RouteParams> };

export async function generateStaticParams(): Promise<RouteParams[]> {
  const catalog = await getReportCatalog();
  return catalog.pairs.map((pair) => {
    const [provinceA, cityA] = pair.left.split("/");
    const [provinceB, cityB] = pair.right.split("/");
    return { provinceA, cityA, provinceB, cityB };
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { provinceA, cityA, provinceB, cityB } = await params;
  const report = await findComparisonReport(provinceA, cityA, provinceB, cityB);
  if (!report) {
    notFound();
  }
  return getPageMetadata(
    `${report.left.name} vs ${report.right.name}: home asking prices`,
    `Compare home asking-price ranges in ${report.left.name}, ${report.left.provinceName}, and ${report.right.name}, ${report.right.provinceName}, for matching home categories.`,
    report.href,
  );
}

export default async function ComparisonPage({
  params,
}: Props): Promise<ReactElement> {
  const { provinceA, cityA, provinceB, cityB } = await params;
  const [catalog, report] = await Promise.all([
    getReportCatalog(),
    findComparisonReport(provinceA, cityA, provinceB, cityB),
  ]);
  if (!report) {
    notFound();
  }
  const { left, right } = report;

  return (
    <>
      <SiteHeader />
      <main id="main" className="shell">
        <header className="page-intro comparison-intro">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link href="/#cities">Cities</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">City comparison</span>
          </nav>
          <p className="eyebrow">City comparison · Home asking prices</p>
          <h1>
            {left.name}
            <br />
            <em>vs {right.name}.</em>
          </h1>
          <p className="intro-copy">
            Compare asking-price ranges for matching home types and bedroom
            counts.
          </p>
          <div className="location-meta">
            <span>
              Listing publication dates:{" "}
              {formatDate(catalog.provenance.windowStart)}–
              {formatDate(catalog.provenance.asOf)}
            </span>
          </div>
        </header>
        <div className="report-cities" aria-label="Individual city reports">
          {[left, right].map((city) => (
            <Link key={city.key} href={city.href} prefetch={false}>
              <span>
                <span className="eyebrow">{city.provinceName}</span>
                <strong>{city.name}</strong>
                <span className="fine-print">Explore {city.name}</span>
              </span>
              <ArrowUpRight size={22} aria-hidden="true" />
            </Link>
          ))}
        </div>
        <ReportJumpLinks
          types={getSharedRows(left, right).map((row) => row.left.type)}
        />
        <div className="report-reading-note">
          <p>
            Only matching home categories with enough consistent evidence in
            both cities are shown.
          </p>
          <p>
            These are recorded asking prices, not final selling prices. Listings
            may no longer be available.
          </p>
        </div>
        <PlotLegend />
        <CityComparisonReport left={left} right={right} />
        <section className="report-methodology">
          <div>
            <p className="eyebrow">About the figures</p>
            <h2>
              Different prices.
              <br />
              <em>More to understand.</em>
            </h2>
          </div>
          <div>
            <p>
              A lower asking price does not establish better value. Homes can
              differ in size, condition and exact location, even within the same
              category.
            </p>
            <Link className="text-link" href="/methodology/">
              About the data <ArrowUpRight size={18} />
            </Link>
            <EvidenceDisclosure provenance={catalog.provenance} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
