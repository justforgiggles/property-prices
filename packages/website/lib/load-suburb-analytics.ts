import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import { notFound } from "next/navigation";
import manifest from "@/data/suburb-manifest.json";
import type { SuburbAnalytics } from "@/lib/city-report";

export const loadSuburbAnalytics = cache(
  async (
    province: string,
    city: string,
    suburb: string,
  ): Promise<SuburbAnalytics> => {
    const entry = manifest.suburbs.find(
      (entry) =>
        entry.provinceSlug === province &&
        entry.citySlug === city &&
        entry.suburbSlug === suburb,
    );
    if (!entry) notFound();
    // Resolve only manifest-owned paths, never arbitrary route parameters.
    return JSON.parse(
      await readFile(
        join(
          process.cwd(),
          "data/suburbs",
          entry.provinceSlug,
          entry.citySlug,
          `${entry.suburbSlug}.json`,
        ),
        "utf8",
      ),
    );
  },
);
