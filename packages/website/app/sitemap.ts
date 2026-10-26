import type { MetadataRoute } from "next";
import { site } from "@/site.config.mjs";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: site.url }];
}
