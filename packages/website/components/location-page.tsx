import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { CityReportDetails } from "@/components/city-report";
import { PriceRangeVisual } from "@/components/price-range";
import { SuburbDirectory } from "@/components/suburb-directory";
import { Card, CardContent } from "@/components/ui/card";
import {
  compactRand,
  rand,
  formatPeriod,
  type CityAnalytics,
  type SuburbAnalytics,
} from "@/lib/city-report";
export function LocationPage({
  analytics,
}: {
  analytics: CityAnalytics | SuburbAnalytics;
}) {
  const suburb = "suburb" in analytics ? analytics.suburb : null;
  const name = suburb?.name ?? analytics.city.name;
  const city = { name: analytics.city.name, province: analytics.province.name };
  const cityHref = `/${analytics.province.slug}/${analytics.city.slug}/`;
  const report = analytics.bedroomGroups.all;
  const reportPeriod = formatPeriod(analytics.period);
  return (
    <SiteShell>
      <nav
        className="pt-6 sm:pt-7"
        aria-label={suburb ? `Back to ${city.name}` : "Back to city directory"}
      >
        <Link
          href={suburb ? cityHref : "/"}
          className="inline-flex items-center gap-2 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {suburb ? `Back to ${city.name}` : "All cities"}
        </Link>
      </nav>
      <section
        className="pt-8 text-center sm:pt-10"
        aria-labelledby="city-title"
      >
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
          {suburb ? `${city.name}, ${city.province}` : city.province}
        </p>
        <h1
          id="city-title"
          className="mt-3 text-4xl font-medium leading-[1.12] tracking-tight text-balance sm:text-6xl"
        >
          {name}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
          Explore recent asking prices in {name}. Compare by bedroom count and
          see how prices have changed.
        </p>
        <p className="mt-5 inline-flex flex-wrap justify-center gap-x-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span>Recent asking prices</span>
          <span aria-hidden="true">·</span>
          <span>{reportPeriod}</span>
        </p>
      </section>
      <section
        className="mt-10 grid items-center gap-8 sm:mt-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16"
        aria-labelledby="overview-heading"
      >
        <div>
          <p className="mb-3 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            The {suburb ? "suburb" : "city"} at a glance
          </p>
          <h2
            id="overview-heading"
            className="max-w-sm text-2xl font-medium leading-snug tracking-tight sm:text-3xl"
          >
            Recent asking prices at a glance
          </h2>
          <p className="mt-5 text-sm leading-7 text-muted-foreground sm:text-base">
            {report.askingPrice.median !== null ? (
              <>
                The typical asking price in {name} is{" "}
                <strong className="font-medium text-foreground">
                  {compactRand(report.askingPrice.median)}
                </strong>
                . The middle 50% of asking prices fall between{" "}
                {compactRand(report.askingPrice.p25)} and{" "}
                {compactRand(report.askingPrice.p75)}.
              </>
            ) : report.listingCount === 0 ? (
              "No listings to show for this period."
            ) : (
              "There aren’t enough asking prices to show a useful comparison yet."
            )}
          </p>
          <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">
            Compare similar-sized homes to put your budget or asking price in
            context.
          </p>
        </div>
        <Card className="gap-0 rounded-lg py-7 border-border shadow-none sm:py-8">
          <CardContent className="px-6 sm:px-8">
            <h3 className="text-sm font-medium">Typical asking price</h3>
            <p className="mt-3 text-5xl font-medium tracking-tight tabular-nums sm:text-6xl">
              {compactRand(report.askingPrice.median)}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">All bedrooms</p>
            <div className="mt-6">
              <PriceRangeVisual value={report.askingPrice} compact />
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Typical price per m²
                </dt>
                <dd className="mt-2 text-xl font-medium tabular-nums sm:text-2xl">
                  {rand(report.pricePerSquareMetre.median)}
                </dd>
              </div>
              <div className="border-l border-border pl-5">
                <dt className="text-xs text-muted-foreground">Listings</dt>
                <dd className="mt-2 text-xl font-medium tabular-nums sm:text-2xl">
                  {report.listingCount.toLocaleString("en-ZA")}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </section>
      <CityReportDetails
        analytics={{
          period: analytics.period,
          bedroomGroups: analytics.bedroomGroups,
        }}
      />
      {"suburbs" in analytics && (
        <SuburbDirectory
          suburbs={analytics.suburbs}
          cityName={city.name}
          cityHref={cityHref}
        />
      )}
    </SiteShell>
  );
}
