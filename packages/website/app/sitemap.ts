import type { MetadataRoute } from "next";
import { site, siteUrl } from "@/site.config.mjs";
import manifest from "@/data/city-manifest.json";

import suburbs from "@/data/suburb-manifest.json";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site.url },
    ...manifest.cities
      .filter((city) => city.indexable)
      .map((city) => ({
        url: siteUrl(`${city.provinceSlug}/${city.citySlug}/`),
      })),
    ...suburbs.suburbs
      .filter((suburb) => suburb.indexable)
      .map((suburb) => ({
        url: siteUrl(
          `${suburb.provinceSlug}/${suburb.citySlug}/${suburb.suburbSlug}/`,
        ),
      })),
  ];
}
