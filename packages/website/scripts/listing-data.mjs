import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

function numeric(value, min, max) {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
  )
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

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

  const suburbName = breadcrumbs.find((item) => item?.position === 4)?.name;

  if (
    typeof province !== "string" ||
    !province.trim() ||
    typeof name !== "string" ||
    !name.trim()
  ) {
    throw new Error(`Missing city or province for listing ${record.id}`);
  }

  const advert = nodes.find((node) => node?.about) ?? {};
  const property = advert.about ?? {};
  const specification = advert.offers?.priceSpecification ?? {};
  const kind = property["@type"];
  const residential =
    kind === "Apartment" ||
    kind === "House" ||
    /\b(?:house|apartment|townhouse|flat)\b/i.test(property.description ?? "");
  const rental = /\b(?:to let|to rent|for rent|available for rental)\b/i.test(
    advert.description ?? "",
  );
  const area = property.floorSize;
  return {
    id: record.id,
    date,
    province,
    name,
    suburb:
      typeof suburbName === "string" && suburbName.trim()
        ? suburbName.trim()
        : null,
    eligible: residential && !rental,
    price:
      specification.priceCurrency === "ZAR"
        ? numeric(specification.price, 10000, Infinity)
        : null,
    bedrooms: numeric(property.numberOfBedrooms ?? record.bedrooms, 0, 100),
    floorArea:
      area?.value != null
        ? area.unitCode === "MTK"
          ? numeric(area.value, 5, 100000)
          : null
        : numeric(record.size, 5, 100000),
    rates: numeric(record.ratesAndTaxes, 0, 1000000),
  };
}

export async function readListings(directory) {
  const records = [];
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
      lineNumber++;
      if (!line.trim()) continue;
      try {
        records.push(parseListing(JSON.parse(line)));
      } catch (error) {
        throw new Error(`${file}:${lineNumber}: ${error.message}`, {
          cause: error,
        });
      }
    }
  }
  return records;
}

export function southAfricanDate(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function directoryFromListings(records, now) {
  const windowEnd = southAfricanDate(now);
  const start = new Date(`${windowEnd}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 89);
  const windowStart = start.toISOString().slice(0, 10);
  const cities = new Map();
  const ids = new Set();
  for (const listing of records) {
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
