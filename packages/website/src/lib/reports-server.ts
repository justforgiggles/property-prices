import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CityPair, ReportCatalog, ReportCity } from "./reports";

const filename = resolve(
  process.cwd(),
  process.cwd().endsWith("website")
    ? ".generated/reports.json"
    : "packages/website/.generated/reports.json",
);
let catalogPromise: Promise<ReportCatalog> | null = null;
const citiesByKey = new Map<string, ReportCity>();
const pairsByKey = new Map<string, CityPair>();

async function readReportCatalog(): Promise<ReportCatalog> {
  const catalog = JSON.parse(await readFile(filename, "utf8")) as ReportCatalog;
  for (const city of catalog.cities) {
    for (const row of city.rows) {
      Object.freeze(row.reasons);
      Object.freeze(row.qualificationLabels);
      Object.freeze(row);
    }
    Object.freeze(city.rows);
    Object.freeze(city);
    citiesByKey.set(city.key, city);
  }
  for (const pair of catalog.pairs) {
    Object.freeze(pair);
    pairsByKey.set(`${pair.left}|${pair.right}`, pair);
  }
  Object.freeze(catalog.provenance);
  Object.freeze(catalog.cities);
  Object.freeze(catalog.pairs);
  return Object.freeze(catalog);
}

export function getReportCatalog(): Promise<ReportCatalog> {
  catalogPromise ??= readReportCatalog();
  return catalogPromise;
}

export async function findCityReport(
  province: string,
  city: string,
): Promise<ReportCity | null> {
  await getReportCatalog();
  return citiesByKey.get(`${province}/${city}`) ?? null;
}

export async function findComparisonReport(
  provinceA: string,
  cityA: string,
  provinceB: string,
  cityB: string,
): Promise<{ left: ReportCity; right: ReportCity; href: string } | null> {
  await getReportCatalog();
  const pair = pairsByKey.get(`${provinceA}/${cityA}|${provinceB}/${cityB}`);
  if (!pair) {
    return null;
  }
  const left = citiesByKey.get(pair.left);
  const right = citiesByKey.get(pair.right);
  if (!left || !right) {
    throw Error("Comparison manifest references an absent city report.");
  }
  return { left, right, href: pair.href };
}
