import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { Storage } from "./storage.js";

type CityLocation = { name: string; parentName: string };

export async function sortCitiesByRecentListings<T extends CityLocation>(
  cities: Array<T>,
  directory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/raw"),
  cutoffDate = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10),
): Promise<Array<T>> {
  const provinces = new Map<string, number>();
  const cityCounts = new Map<string, number>();
  const ids = new Set<number>();
  const storage = new Storage(directory);
  let files: Array<string>;

  try {
    files = await readdir(directory);
  } catch (error: unknown) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }

    files = [];
  }

  for (const file of files.sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)) {
      continue;
    }

    const lines = createInterface({ input: createReadStream(join(directory, file)), crlfDelay: Infinity });

    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const listing: unknown = JSON.parse(line);

      if (!isObject(listing) || typeof listing.id !== "number" || !Number.isSafeInteger(listing.id) || !Array.isArray(listing.jsonld)) {
        throw new Error(`Invalid listing in ${file}`);
      }

      if (ids.has(listing.id)) {
        throw new Error(`Duplicate listing ID ${listing.id} in raw data`);
      }

      ids.add(listing.id);
      const date = storage.findListingPublicationDate({ id: listing.id, jsonld: listing.jsonld });

      if (date === null || date < cutoffDate) {
        continue;
      }

      for (const document of listing.jsonld) {
        if (!isObject(document) || !Array.isArray(document["@graph"])) {
          continue;
        }

        const location = document["@graph"].find((node: unknown) => isObject(node) && isObject(node.breadcrumb));

        if (!isObject(location) || !isObject(location.breadcrumb) || !Array.isArray(location.breadcrumb.itemListElement)) {
          continue;
        }

        const breadcrumbs: Array<unknown> = location.breadcrumb.itemListElement;
        const province = breadcrumbs.find((item) => isObject(item) && item.position === 2);
        const city = breadcrumbs.find((item) => isObject(item) && item.position === 3);

        if (!isObject(province) || typeof province.name !== "string" || !isObject(city) || typeof city.name !== "string") {
          continue;
        }

        const key = JSON.stringify([province.name, city.name]);
        provinces.set(province.name, (provinces.get(province.name) ?? 0) + 1);
        cityCounts.set(key, (cityCounts.get(key) ?? 0) + 1);
        break;
      }
    }
  }

  return [...cities].sort((left, right) =>
    (provinces.get(right.parentName) ?? 0) - (provinces.get(left.parentName) ?? 0)
    || left.parentName.localeCompare(right.parentName)
    || (cityCounts.get(JSON.stringify([right.parentName, right.name])) ?? 0) - (cityCounts.get(JSON.stringify([left.parentName, left.name])) ?? 0)
    || left.name.localeCompare(right.name),
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
