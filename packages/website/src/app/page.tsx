import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { SiteHeader, SiteFooter } from "@/components/atlas";
import { CityDiscovery } from "@/components/city-directory";
import { getReportCatalog } from "@/lib/reports-server";
import { getPageMetadata } from "@/lib/site";

export const metadata: Metadata = getPageMetadata(
  "Home asking prices, city by city",
  "Explore home asking prices by city, home type and bedroom count. See price ranges, understand the median and compare cities.",
  "/",
);

const FEATURED_CITY_KEYS = [
  "western-cape/cape-town",
  "gauteng/johannesburg",
  "gauteng/pretoria",
  "kwazulu-natal/durban",
  "western-cape/blouberg",
  "gauteng/sandton",
];

export default async function HomePage(): Promise<ReactElement> {
  const catalog = await getReportCatalog();
  const cities = catalog.cities.map((city) => ({
    key: city.key,
    name: city.name,
    provinceName: city.provinceName,
    href: city.href,
  }));
  const featured = FEATURED_CITY_KEYS.flatMap((key) => {
    const city = cities.find((candidate) => candidate.key === key);
    return city ? [city] : [];
  });

  return (
    <>
      <SiteHeader />
      <main id="main" className="shell">
        <CityDiscovery cities={cities} featured={featured} />
        <aside className="report-methodology">
          <div>
            <p className="eyebrow">About the figures</p>
            <h2>
              Useful numbers.
              <br />
              <em>Clear boundaries.</em>
            </h2>
          </div>
          <div>
            <p>
              These are recorded asking prices, not final selling prices.
              Listings may no longer be available. Each report shows price
              ranges and listing counts for home categories with enough
              consistent evidence.
            </p>
            <Link className="text-link" href="/methodology/">
              About the data <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </aside>
      </main>
      <SiteFooter />
    </>
  );
}
