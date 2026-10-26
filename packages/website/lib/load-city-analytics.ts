import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import { notFound } from "next/navigation";
import manifest from "@/data/city-manifest.json";
import type { CityAnalytics } from "@/lib/city-report";

export const loadCityAnalytics = cache(
  async (province: string, city: string): Promise<CityAnalytics> => {
    const entry = manifest.cities.find(
      (entry) => entry.provinceSlug === province && entry.citySlug === city,
    );
    if (!entry) notFound();
    // Resolve only manifest-owned paths, never arbitrary route parameters.
    return JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "data/cities",
          entry.provinceSlug,
          `${entry.citySlug}.json`,
        ),
        "utf8",
      ),
    );
  },
);
