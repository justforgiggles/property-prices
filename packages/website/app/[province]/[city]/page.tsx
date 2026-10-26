import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { CityReportDetails } from "@/components/city-report";
import { PriceRangeVisual } from "@/components/price-range";
import { Card, CardContent } from "@/components/ui/card";
import manifest from "@/data/city-manifest.json";
import { loadCityAnalytics } from "@/lib/load-city-analytics";
import { compactRand, rand, formatPeriod } from "@/lib/city-report";
import { site, siteUrl, socialImage } from "@/site.config.mjs";

type Params = { province: string; city: string };
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return manifest.cities.map((city) => ({
    province: city.provinceSlug,
    city: city.citySlug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const route = await params;
  const analytics = await loadCityAnalytics(route.province, route.city);
  const city = { name: analytics.city.name, province: analytics.province.name };
  const title = `${city.name} Asking Prices & Property Listings | Prop Radar`;
  const description = `Explore recorded residential asking prices in ${city.name}, ${city.province}, for ${formatPeriod(analytics.period)}. Compare bedrooms, price ranges and published listing counts.`;
  const url = siteUrl(`${analytics.province.slug}/${analytics.city.slug}/`);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: {
      index: analytics.bedroomGroups.all.askingPrice.count >= 5,
      follow: true,
    },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName: site.name,
      locale: "en_ZA",
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: socialImage.url, alt: socialImage.alt }],
    },
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const route = await params;
  const analytics = await loadCityAnalytics(route.province, route.city);
  const city = { name: analytics.city.name, province: analytics.province.name };
  const report = analytics.bedroomGroups.all;
  const reportPeriod = formatPeriod(analytics.period);
  return (
    <SiteShell>
      <nav className="pt-6 sm:pt-7" aria-label="Back to city directory">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          All cities
        </Link>
      </nav>
      <section
        className="pt-8 text-center sm:pt-10"
        aria-labelledby="city-title"
      >
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
          {city.province}
        </p>
        <h1
          id="city-title"
          className="mt-3 text-4xl font-medium leading-[1.12] tracking-tight text-balance sm:text-6xl"
        >
          {city.name}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
          A local view of asking prices, the homes behind them, and how listings
          compare.
        </p>
        <p className="mt-5 inline-flex flex-wrap justify-center gap-x-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span>Residential sales</span>
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
            The city at a glance
          </p>
          <h2
            id="overview-heading"
            className="max-w-sm text-2xl font-medium leading-snug tracking-tight sm:text-3xl"
          >
            A starting point for your next move.
          </h2>
          <p className="mt-5 text-sm leading-7 text-muted-foreground sm:text-base">
            {report.askingPrice.median !== null ? (
              <>
                Across {report.listingCount.toLocaleString("en-ZA")} recorded
                residential sale listings, the typical asking price is{" "}
                <strong className="font-medium text-foreground">
                  {compactRand(report.askingPrice.median)}
                </strong>
                , with the middle half between{" "}
                {compactRand(report.askingPrice.p25)} and{" "}
                {compactRand(report.askingPrice.p75)}.
              </>
            ) : (
              <>
                There {report.listingCount === 1 ? "is" : "are"}{" "}
                {report.listingCount.toLocaleString("en-ZA")} recorded
                residential sale{" "}
                {report.listingCount === 1 ? "listing" : "listings"} in this
                period. At least five valid asking prices are needed to show a
                typical price and range.
              </>
            )}
          </p>
          <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">
            Buying or selling? Start with the city-wide picture, then explore
            homes with a similar number of bedrooms. The range helps put the
            midpoint in context.
          </p>
        </div>
        <Card className="gap-0 rounded-lg py-7 border-border shadow-none sm:py-8">
          <CardContent className="px-6 sm:px-8">
            <h3 className="text-sm font-medium">Typical asking price</h3>
            <p className="mt-3 text-5xl font-medium tracking-tight tabular-nums sm:text-6xl">
              {compactRand(report.askingPrice.median)}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Median advertised price · all bedrooms ·{" "}
              {report.askingPrice.count.toLocaleString("en-ZA")} valid prices
            </p>
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
                <dd className="mt-1 text-xs text-muted-foreground">
                  {report.pricePerSquareMetre.count.toLocaleString("en-ZA")}{" "}
                  valid observations
                </dd>
              </div>
              <div className="border-l border-border pl-5">
                <dt className="text-xs text-muted-foreground">
                  Recorded listings
                </dt>
                <dd className="mt-2 text-xl font-medium tabular-nums sm:text-2xl">
                  {report.listingCount.toLocaleString("en-ZA")}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </section>
      <CityReportDetails analytics={analytics} />
    </SiteShell>
  );
}
