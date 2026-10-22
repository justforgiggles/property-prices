import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Area, Catalog, CityData, ProvinceData } from "./types";
const root = resolve(
  process.cwd(),
  process.cwd().endsWith("website")
    ? ".generated"
    : "packages/website/.generated",
);
async function read<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(resolve(root, file), "utf8")) as T;
}
export function getCatalog(): Promise<Catalog> {
  return read<Catalog>("catalog.json");
}
export async function getProvince(slug: string): Promise<ProvinceData> {
  const catalog = await getCatalog();
  if (!catalog.provinces.some((province) => province.slug === slug)) {
    throw Error("Province is not in the generated route manifest");
  }
  return read<ProvinceData>(`provinces/${slug}.json`);
}
export async function getCity(
  province: string,
  city: string,
): Promise<CityData> {
  const catalog = await getCatalog();
  if (
    !catalog.cities.some(
      (route) => route.province === province && route.city === city,
    )
  ) {
    throw Error("City is not in the generated route manifest");
  }
  return read<CityData>(`cities/${province}/${city}.json`);
}

export function toAreaSummary(area: Area): Area {
  return {
    name: area.name,
    slug: area.slug,
    href: area.href,
    listingCount: area.listingCount,
    defaultBrief: area.defaultBrief,
    cohorts: area.cohorts,
    space: area.space,
  };
}
