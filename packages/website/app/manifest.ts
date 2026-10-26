import type { MetadataRoute } from "next";
import { site, siteUrl } from "@/site.config.mjs";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: site.url,
    name: site.name,
    short_name: site.name,
    description: site.description,
    lang: site.language,
    start_url: site.url,
    scope: site.url,
    display: "browser",
    background_color: site.background,
    theme_color: site.background,
    icons: [
      {
        src: siteUrl("icons/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: siteUrl("icons/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
