import type { Metadata } from "next";
import {
  formatPeriod,
  type CityAnalytics,
  type SuburbAnalytics,
} from "@/lib/city-report";
import { site, siteUrl, socialImage } from "@/site.config.mjs";
export function locationMetadata(
  analytics: CityAnalytics | SuburbAnalytics,
): Metadata {
  const suburb = "suburb" in analytics ? analytics.suburb : null;
  const city = {
    name: suburb
      ? `${suburb.name}, ${analytics.city.name}`
      : analytics.city.name,
    province: analytics.province.name,
  };
  const title = `${city.name} Asking Prices & Property Listings | Prop Radar`;
  const description = `Explore recorded residential asking prices in ${city.name}, ${city.province}, for ${formatPeriod(analytics.period)}. Compare bedrooms, price ranges and published listing counts.`;
  const url = siteUrl(
    `${analytics.province.slug}/${analytics.city.slug}/${suburb ? `${suburb.slug}/` : ""}`,
  );
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
