import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { CityReportDetails } from "@/components/city-report";
import { PriceRangeVisual } from "@/components/price-range";
import { Card, CardContent } from "@/components/ui/card";
import data from "@/data/cities.json";
import { cityPath, slugify } from "@/lib/city-routes.mjs";
import {
  cityReports,
  compactRand,
  rand,
  reportPeriod,
} from "@/lib/city-report";
import { site, siteUrl, socialImage } from "@/site.config.mjs";

type Params = { province: string; city: string };
const cities = data.cities.filter((city) => city.listingCount > 20);
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  const paths = cities.map(cityPath);
  if (new Set(paths).size !== paths.length)
    throw new Error("City route slugs must be unique within each province");
  return cities.map((city) => ({
    province: slugify(city.province),
    city: slugify(city.name),
  }));
}

function findCity(params: Params) {
  const city = cities.find(
    (city) =>
      slugify(city.province) === params.province &&
      slugify(city.name) === params.city,
  );
  if (!city) notFound();
  return city;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const city = findCity(await params);
  const title = `${city.name} Property Overview — Illustrative Preview | Prop Radar`;
  const description = `Explore an illustrative property overview for ${city.name}, ${city.province}. Preview the city page with sample asking prices, bedroom comparisons and listing charts.`;
  const url = siteUrl(cityPath(city).slice(1));
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: { index: false, follow: true },
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
  const city = findCity(await params);
  const report = cityReports[0];
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
          <span>Illustrative data</span>
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
            In this illustrative overview, the typical asking price is{" "}
            <strong className="font-medium text-foreground">
              {compactRand(report.askingPrice.median)}
            </strong>
            , with the middle half between{" "}
            {compactRand(report.askingPrice.lower)} and{" "}
            {compactRand(report.askingPrice.upper)}.
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
              Median advertised price · all bedrooms
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
              </div>
              <div className="border-l border-border pl-5">
                <dt className="text-xs text-muted-foreground">
                  Recorded listings
                </dt>
                <dd className="mt-2 text-xl font-medium tabular-nums sm:text-2xl">
                  {report.listings.toLocaleString("en-ZA")}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </section>
      <CityReportDetails />
    </SiteShell>
  );
}
