import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

function parseListing(record) {
  if (!Number.isSafeInteger(record?.id) || !Array.isArray(record.jsonld)) {
    throw new Error("Expected a listing ID and JSON-LD documents");
  }

  const nodes = record.jsonld.flatMap((document) =>
    Array.isArray(document?.["@graph"]) ? document["@graph"] : [],
  );
  const publication = nodes.find(
    (node) => typeof node?.datePosted === "string",
  );
  const date = publication?.datePosted.slice(0, 10);
  const parsedDate = new Date(`${date}T00:00:00Z`);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid publication date for listing ${record.id}`);
  }

  const location = nodes.find((node) =>
    Array.isArray(node?.breadcrumb?.itemListElement),
  );
  const breadcrumbs = location?.breadcrumb.itemListElement ?? [];
  const province = breadcrumbs.find((item) => item?.position === 2)?.name;
  const name = breadcrumbs.find((item) => item?.position === 3)?.name;

  if (
    typeof province !== "string" ||
    !province.trim() ||
    typeof name !== "string" ||
    !name.trim()
  ) {
    throw new Error(`Missing city or province for listing ${record.id}`);
  }

  return { id: record.id, date, province, name };
}

export async function generateCities(directory, now = new Date()) {
  const windowEnd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const start = new Date(`${windowEnd}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 89);
  const windowStart = start.toISOString().slice(0, 10);
  const cities = new Map();
  const ids = new Set();
  const files = (await readdir(directory))
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
    .sort();

  for (const file of files) {
    const lines = createInterface({
      input: createReadStream(join(directory, file)),
      crlfDelay: Infinity,
    });
    let lineNumber = 0;

    for await (const line of lines) {
      lineNumber += 1;

      if (!line.trim()) {
        continue;
      }

      let listing;

      try {
        listing = parseListing(JSON.parse(line));
      } catch (error) {
        throw new Error(`${file}:${lineNumber}: ${error.message}`, {
          cause: error,
        });
      }

      if (
        listing.date < windowStart ||
        listing.date > windowEnd ||
        ids.has(listing.id)
      ) {
        continue;
      }

      ids.add(listing.id);
      const key = JSON.stringify([listing.province, listing.name]);
      const city = cities.get(key) ?? {
        name: listing.name,
        province: listing.province,
        listingCount: 0,
      };
      city.listingCount += 1;
      cities.set(key, city);
    }
  }

  return {
    generatedAt: now.toISOString(),
    windowStart,
    windowEnd,
    totalListings: ids.size,
    cities: [...cities.values()].sort(
      (left, right) =>
        left.name.localeCompare(right.name, "en-ZA") ||
        left.province.localeCompare(right.province, "en-ZA"),
    ),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const website = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const data = await generateCities(resolve(website, "../../data/raw"));
  await mkdir(join(website, "data"), { recursive: true });
  await writeFile(
    join(website, "data/cities.json"),
    `${JSON.stringify(data, null, 2)}\n`,
  );
  console.log(
    `Generated ${data.cities.length} cities with ${data.totalListings.toLocaleString("en-ZA")} listings (${data.windowStart}–${data.windowEnd})`,
  );
}
