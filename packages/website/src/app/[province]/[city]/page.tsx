import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import {
  SiteHeader,
  SiteFooter,
  SectionHeading,
  EvidenceDisclosure,
  ReportJumpLinks,
} from "@/components/atlas";
import { PlotLegend } from "@/components/price-plot";
import { getSupportedRows } from "@/lib/reports";
import { CityPriceReport } from "@/components/reports";
import { CityChooser } from "@/components/city-directory";
import { formatDate } from "@/lib/format";
import { getReportCatalog, findCityReport } from "@/lib/reports-server";
import { getPageMetadata } from "@/lib/site";

export const dynamicParams = false;
type Props = { params: Promise<{ province: string; city: string }> };

export async function generateStaticParams(): Promise<
  { province: string; city: string }[]
> {
  return (await getReportCatalog()).cities.map((city) => ({
    province: city.provinceSlug,
    city: city.slug,
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { province, city } = await params;
  const report = await findCityReport(province, city);
  if (!report) {
    notFound();
  }
  return getPageMetadata(
    `Home asking prices in ${report.name}`,
    `Explore home asking-price ranges by property type and bedroom count in ${report.name}, ${report.provinceName}.`,
    report.href,
  );
}

export default async function CityPage({
  params,
}: Props): Promise<ReactElement> {
  const { province, city } = await params;
  const [catalog, report] = await Promise.all([
    getReportCatalog(),
    findCityReport(province, city),
  ]);
  if (!report) {
    notFound();
  }
  const partnerRoutes = new Map(
    catalog.pairs
      .filter((pair) => pair.left === report.key || pair.right === report.key)
      .map((pair) => [
        pair.left === report.key ? pair.right : pair.left,
        pair.href,
      ]),
  );
  const partners = catalog.cities
    .filter((candidate) => partnerRoutes.has(candidate.key))
    .map((candidate) => ({
      key: candidate.key,
      name: candidate.name,
      provinceName: candidate.provinceName,
      href: partnerRoutes.get(candidate.key)!,
    }));

  return (
    <>
      <SiteHeader />
      <main id="main" className="shell">
        <header className="page-intro report-intro">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link href="/#cities">Cities</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{report.name}</span>
          </nav>
          <p className="eyebrow">{report.provinceName} · City report</p>
          <h1>
            Home asking prices
            <br />
            <em>in {report.name}.</em>
          </h1>
          <p className="intro-copy">
            Explore asking-price ranges by home type and bedroom count.
          </p>
          <div className="location-meta">
            <span>
              Listing publication dates:{" "}
              {formatDate(catalog.provenance.windowStart)}–
              {formatDate(catalog.provenance.asOf)}
            </span>
          </div>
        </header>
        <ReportJumpLinks
          types={getSupportedRows(report).map((row) => row.type)}
          showCompare
        />
        <div className="report-reading-note">
          <p>Only home categories with enough consistent evidence are shown.</p>
          <p>
            These are recorded asking prices, not final selling prices. Listings
            may no longer be available.
          </p>
        </div>
        <PlotLegend />
        <CityPriceReport city={report} />
        <section className="report-navigation" id="compare">
          <SectionHeading
            eyebrow="Another perspective"
            title="Compare with another city"
            description={`See how asking prices in ${report.name} compare for the same home type and bedroom count.`}
          />
          {partners.length > 0 ? (
            <CityChooser cities={partners} />
          ) : (
            <p className="fine-print">
              No other city has enough consistent evidence for a matching
              comparison yet.
            </p>
          )}
        </section>
        <section className="report-methodology">
          <div>
            <p className="eyebrow">About the figures</p>
            <h2>
              A starting point
              <br />
              <em>for a closer look.</em>
            </h2>
          </div>
          <div>
            <p>
              Homes in the same category can still differ in size, condition and
              exact location. Use these ranges to guide a closer look at
              individual homes.
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
