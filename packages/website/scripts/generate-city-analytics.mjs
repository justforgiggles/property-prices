import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readListings,
  southAfricanDate,
  directoryFromListings,
} from "./listing-data.mjs";
import { slugify } from "../lib/city-routes.mjs";

export function completedMonths(now) {
  const [year, month] = southAfricanDate(now).split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 4, 1));
  const last = new Date(Date.UTC(year, month - 1, 0));
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
    months: Array.from({ length: 3 }, (_, index) =>
      new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1))
        .toISOString()
        .slice(0, 7),
    ),
  };
}

export function statistics(values) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  const count = sorted.length;
  if (count < 5) return { count, median: null, p25: null, p75: null };
  const percentile = (q) => {
    const position = (count - 1) * q;
    const lower = Math.floor(position);
    return (
      sorted[lower] +
      (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
    );
  };
  return {
    count,
    median: percentile(0.5),
    p25: percentile(0.25),
    p75: percentile(0.75),
  };
}

function summarizeGroup(records, months) {
  const askingPrice = statistics(records.map((record) => record.price));
  const monthly = months.map((month) => {
    const rows = records.filter((record) => record.date.startsWith(month));
    return {
      month,
      listingCount: rows.length,
      askingPrice: statistics(rows.map((record) => record.price)),
    };
  });
  const first = monthly[0].askingPrice.median;
  const last = monthly[2].askingPrice.median;
  const boundaries = [0, 1e6, 2e6, 3e6, 5e6, null];
  return {
    listingCount: records.length,
    askingPrice,
    pricePerSquareMetre: statistics(
      records.map((record) =>
        record.price !== null && record.floorArea !== null
          ? record.price / record.floorArea
          : null,
      ),
    ),
    ratesAndTaxes: statistics(records.map((record) => record.rates)),
    askingPriceChangePercent:
      first === null || last === null ? null : (last / first - 1) * 100,
    months: monthly,
    priceDistribution: {
      count: askingPrice.count,
      buckets: boundaries.slice(0, -1).map((min, index) => {
        const max = boundaries[index + 1];
        const count = records.filter(
          (record) =>
            record.price !== null &&
            record.price >= min &&
            (max === null || record.price < max),
        ).length;
        return {
          min,
          max,
          count,
          percentage: askingPrice.count
            ? (count / askingPrice.count) * 100
            : null,
        };
      }),
    },
  };
}

function summarizeBedrooms(records, months) {
  return Object.fromEntries(
    ["all", "1", "2", "3", "4", "5plus"].map((id) => {
      const rows =
        id === "all"
          ? records
          : records.filter(
              (record) =>
                record.bedrooms !== null &&
                (id === "5plus"
                  ? record.bedrooms >= 5
                  : record.bedrooms >= Number(id) &&
                    record.bedrooms < Number(id) + 1),
            );
      return [id, summarizeGroup(rows, months)];
    }),
  );
}

function suburbDirectory(records, directory) {
  const ids = new Set();
  const suburbs = new Map();
  for (const record of records) {
    if (
      record.date < directory.windowStart ||
      record.date > directory.windowEnd ||
      ids.has(record.id)
    )
      continue;
    ids.add(record.id);
    if (!record.suburb) continue;
    const key = JSON.stringify([record.province, record.name, record.suburb]);
    const suburb = suburbs.get(key) ?? {
      province: record.province,
      city: record.name,
      name: record.suburb,
      listingCount: 0,
      records: [],
    };
    suburb.listingCount++;
    suburbs.set(key, suburb);
  }
  return suburbs;
}

export async function generateWebsiteData(source, now = new Date()) {
  const records = await readListings(source);
  const directory = directoryFromListings(records, now);
  const period = completedMonths(now);
  // Files are read in snapshot order; the last line wins within a snapshot.
  const latest = new Map(records.map((record) => [record.id, record]));
  const cities = new Map(
    directory.cities.map((city) => [
      JSON.stringify([city.province, city.name]),
      { ...city, records: [] },
    ]),
  );
  for (const record of latest.values()) {
    if (record.date < period.start || record.date > period.end) continue;
    const key = JSON.stringify([record.province, record.name]);
    const city = cities.get(key) ?? {
      name: record.name,
      province: record.province,
      records: [],
    };
    if (record.eligible) city.records.push(record);
    cities.set(key, city);
  }
  const suburbs = suburbDirectory(records, directory);
  for (const record of latest.values()) {
    if (
      !record.suburb ||
      record.date < period.start ||
      record.date > period.end
    )
      continue;
    const key = JSON.stringify([record.province, record.name, record.suburb]);
    const suburb = suburbs.get(key) ?? {
      province: record.province,
      city: record.name,
      name: record.suburb,
      listingCount: 0,
      records: [],
    };
    if (record.eligible) suburb.records.push(record);
    suburbs.set(key, suburb);
  }
  const suburbPaths = new Set();
  const suburbReports = [];
  const navigation = new Map();
  for (const suburb of [...suburbs.values()].sort(
    (a, b) =>
      a.province.localeCompare(b.province, "en-ZA") ||
      a.city.localeCompare(b.city, "en-ZA") ||
      a.name.localeCompare(b.name, "en-ZA"),
  )) {
    const province = { name: suburb.province, slug: slugify(suburb.province) };
    const city = { name: suburb.city, slug: slugify(suburb.city) };
    const identity = { name: suburb.name, slug: slugify(suburb.name) };
    const path = `${province.slug}/${city.slug}/${identity.slug}`;
    if (!identity.slug || suburbPaths.has(path))
      throw new Error(`Ambiguous or empty suburb route: ${path}`);
    suburbPaths.add(path);
    suburbReports.push({
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      province,
      city,
      suburb: identity,
      period: { start: period.start, end: period.end },
      bedroomGroups: summarizeBedrooms(suburb.records, period.months),
    });
    const key = JSON.stringify([suburb.province, suburb.city]);
    const links = navigation.get(key) ?? [];
    links.push({
      name: suburb.name,
      slug: identity.slug,
      listingCount: suburb.listingCount,
    });
    navigation.set(key, links);
  }
  const paths = new Set();
  const reports = [...cities.values()]
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "en-ZA") ||
        a.province.localeCompare(b.province, "en-ZA"),
    )
    .map((city) => {
      const province = { name: city.province, slug: slugify(city.province) };
      const identity = { name: city.name, slug: slugify(city.name) };
      const path = `${province.slug}/${identity.slug}`;
      if (!province.slug || !identity.slug || paths.has(path))
        throw new Error(`Ambiguous or empty city route: ${path}`);
      paths.add(path);
      const bedroomGroups = summarizeBedrooms(city.records, period.months);
      return {
        schemaVersion: 1,
        generatedAt: now.toISOString(),
        province,
        city: identity,
        period: { start: period.start, end: period.end },
        bedroomGroups,
        suburbs: (
          navigation.get(JSON.stringify([city.province, city.name])) ?? []
        ).sort(
          (a, b) =>
            b.listingCount - a.listingCount ||
            a.name.localeCompare(b.name, "en-ZA"),
        ),
      };
    });
  const manifest = {
    generatedAt: now.toISOString(),
    period: { start: period.start, end: period.end },
    cities: reports.map((report) => ({
      name: report.city.name,
      province: report.province.name,
      citySlug: report.city.slug,
      provinceSlug: report.province.slug,
      indexable: report.bedroomGroups.all.askingPrice.count >= 5,
    })),
  };
  const suburbManifest = {
    generatedAt: now.toISOString(),
    period: { start: period.start, end: period.end },
    suburbs: suburbReports.map((report) => ({
      name: report.suburb.name,
      province: report.province.name,
      city: report.city.name,
      provinceSlug: report.province.slug,
      citySlug: report.city.slug,
      suburbSlug: report.suburb.slug,
      indexable: report.bedroomGroups.all.askingPrice.count >= 5,
    })),
  };
  return { directory, reports, manifest, suburbReports, suburbManifest };
}

export async function writeWebsiteData(source, output, now = new Date()) {
  const result = await generateWebsiteData(source, now);
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(join(output, ".city-generation-"));
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  try {
    await mkdir(join(staging, "cities"));
    for (const report of result.reports) {
      const province = join(staging, "cities", report.province.slug);
      await mkdir(province, { recursive: true });
      await writeFile(join(province, `${report.city.slug}.json`), json(report));
    }
    await mkdir(join(staging, "suburbs"));
    for (const report of result.suburbReports) {
      const city = join(
        staging,
        "suburbs",
        report.province.slug,
        report.city.slug,
      );
      await mkdir(city, { recursive: true });
      await writeFile(join(city, `${report.suburb.slug}.json`), json(report));
    }
    await writeFile(
      join(staging, "suburb-manifest.json"),
      json(result.suburbManifest),
    );
    await writeFile(join(staging, "cities.json"), json(result.directory));
    await writeFile(join(staging, "city-manifest.json"), json(result.manifest));
    // Only replace generator-owned files after extraction and aggregation succeed.
    await rm(join(output, "cities"), { recursive: true, force: true });
    await rm(join(output, "suburbs"), { recursive: true, force: true });
    for (const name of [
      "cities",
      "cities.json",
      "city-manifest.json",
      "suburbs",
      "suburb-manifest.json",
    ])
      await rename(join(staging, name), join(output, name));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return result;
}
