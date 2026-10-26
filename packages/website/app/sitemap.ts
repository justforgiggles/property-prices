import type { MetadataRoute } from "next";
import { site, siteUrl } from "@/site.config.mjs";
import manifest from "@/data/city-manifest.json";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site.url },
    ...manifest.cities
      .filter((city) => city.indexable)
      .map((city) => ({
        url: siteUrl(`${city.provinceSlug}/${city.citySlug}/`),
      })),
  ];
}
