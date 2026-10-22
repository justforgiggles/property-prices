/** Build-only extraction. Private source fields never enter public insights. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { caseFoldExceptions } from "./unicode-case-fold";
export type Row = {
  id: string;
  price: number;
  province: string;
  city: string;
  suburb: string;
  bedrooms: number | null;
  bathrooms: number | null;
  floor_size: number | null;
  rates: number | null;
  date: string;
  snapshot: string;
  kind: string;
  property_type: string;
  street: string;
  image: string;
  description: string;
  group: number;
};
type Audit = {
  raw_rows: number;
  excluded_rows: number;
  repeated_ids_removed: number;
  valid_rows: number;
  invalid_features_set_missing: Record<
    "bedrooms" | "bathrooms" | "floor_size" | "rates",
    number
  >;
};
type ObjectValue = Record<string, unknown>;
function parseObject(v: unknown): ObjectValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw Error("Expected object");
  }
  return v as ObjectValue;
}
function getFieldOrFallback(
  o: ObjectValue,
  key: string,
  value: unknown,
): unknown {
  return Object.hasOwn(o, key) ? o[key] : value;
}
export function normalize(v: unknown): string {
  return (
    Array.from(
      String(v || "").trim(),
      (character) => caseFoldExceptions[character] ?? character.toLowerCase(),
    )
      .join("")
      .replace(/\s+/gu, " ")
      .replaceAll("kwazulu-natal", "kwazulu natal") || "__unknown__"
  );
}
export function numeric(v: unknown): number | null {
  if (
    v === null ||
    v === undefined ||
    typeof v === "object" ||
    (typeof v === "string" && !v.trim())
  ) {
    return null;
  }
  if (
    typeof v === "string" &&
    !/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|inf(?:inity)?)$/i.test(
      v.trim(),
    )
  ) {
    return null;
  }
  const n =
    typeof v === "string" && /^[+-]?inf$/i.test(v.trim())
      ? v.trim().startsWith("-")
        ? -Infinity
        : Infinity
      : Number(v);
  return Number.isNaN(n) ? null : n;
}
export function extract(record: unknown, snapshot: string): Row {
  const r = parseObject(record);
  const docs = r.jsonld as unknown[];
  const n = parseObject((parseObject(docs[0])["@graph"] as unknown[])[0]);
  const p = parseObject(n.about);
  const address = parseObject(p.address);
  const crumbs = new Map(
    (parseObject(n.breadcrumb).itemListElement as unknown[]).map((x) => {
      const b = parseObject(x);
      return [Number(b.position), b.name] as const;
    }),
  );
  const size = parseObject(getFieldOrFallback(p, "floorSize", {}));
  return {
    id: String(r.id),
    price:
      numeric(parseObject(parseObject(n.offers).priceSpecification).price) ??
      NaN,
    province: normalize(crumbs.has(2) ? crumbs.get(2) : address.addressRegion),
    city: normalize(crumbs.get(3)),
    suburb: normalize(crumbs.has(4) ? crumbs.get(4) : address.addressLocality),
    bedrooms: numeric(getFieldOrFallback(p, "numberOfBedrooms", r.bedrooms)),
    bathrooms: numeric(
      getFieldOrFallback(p, "numberOfBathroomsTotal", r.bathrooms),
    ),
    floor_size: numeric(getFieldOrFallback(size, "value", r.size)),
    rates: numeric(r.ratesAndTaxes),
    date: String(n.datePosted),
    snapshot,
    kind: String(p["@type"]),
    property_type: String(p.description ?? ""),
    street: normalize(address.streetAddress),
    image: String(n.image ?? ""),
    description: String(n.description ?? ""),
    group: 0,
  };
}
function collectLabels(record: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  const document = parseObject((parseObject(record).jsonld as unknown[])[0]);
  const listing = parseObject((document["@graph"] as unknown[])[0]);
  for (const item of parseObject(listing.breadcrumb)
    .itemListElement as unknown[]) {
    const crumb = parseObject(item);
    if (
      [2, 3, 4].includes(Number(crumb.position)) &&
      typeof crumb.name === "string"
    ) {
      const key = normalize(crumb.name);
      if (!labels.has(key)) {
        labels.set(key, crumb.name.trim().replace(/\s+/g, " "));
      }
    }
  }
  return labels;
}
export const limits = {
  bedrooms: [0, 100],
  bathrooms: [0, 100],
  floor_size: [5, 100000],
  rates: [0, 1000000],
} as const;
export function cleanRows(raw: Row[]): { rows: Row[]; audit: Audit } {
  const corrections = { bedrooms: 0, bathrooms: 0, floor_size: 0, rates: 0 };
  let excluded = 0;
  const valid: Row[] = [];
  for (const original of raw) {
    const r = { ...original };
    if (
      !Number.isFinite(r.price) ||
      r.price < 10000 ||
      /\b(?:to let|to rent|for rent|available for rental)\b/i.test(
        r.description,
      ) ||
      !(
        ["Apartment", "House"].includes(r.kind) ||
        /house|apartment|townhouse|flat/i.test(r.property_type)
      )
    ) {
      excluded++;
      continue;
    }
    for (const k of Object.keys(limits) as (keyof typeof limits)[]) {
      const v = r[k];
      if (
        v !== null &&
        (!Number.isFinite(v) || v < limits[k][0] || v > limits[k][1])
      ) {
        r[k] = null;
        corrections[k]++;
      }
    }
    valid.push(r);
  }
  valid.sort(
    (a, b) => compare(a.date, b.date) || compare(a.snapshot, b.snapshot),
  );
  const last = new Map<string, number>();
  valid.forEach((r, i) => last.set(r.id, i));
  const rows = valid.filter((r, i) => last.get(r.id) === i);
  return {
    rows,
    audit: {
      raw_rows: raw.length,
      excluded_rows: excluded,
      repeated_ids_removed: valid.length - rows.length,
      valid_rows: rows.length,
      invalid_features_set_missing: corrections,
    },
  };
}
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function assignGroups(rows: Row[]): Row[] {
  const parent = rows.map((_, i) => i),
    seen = new Map<string, number>();
  function findRoot(start: number): number {
    let i = start;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  rows.forEach((r, i) => {
    const geo = [r.province, r.city, r.suburb],
      keys: unknown[][] = [];
    if (r.street !== "__unknown__" && /\p{Nd}/u.test(r.street)) {
      keys.push(["street", geo, r.street]);
    }
    if (r.image) {
      keys.push(["image", r.image]);
    }
    if (r.description.length > 60) {
      keys.push([
        "text",
        geo,
        normalize(r.description),
        r.bedrooms,
        r.bathrooms,
        r.floor_size,
      ]);
    }
    for (const key of keys) {
      const k = JSON.stringify(key),
        prior = seen.get(k);
      if (prior !== undefined) {
        parent[findRoot(i)] = findRoot(prior);
      } else {
        seen.set(k, i);
      }
    }
  });
  return rows.map((r, i) => ({ ...r, group: findRoot(i) }));
}
export function variants(rows: Row[]): {
  baseline: Row[];
  image: Row[];
  group: Row[];
} {
  const sorted = [...rows].sort(
    (a, b) => compare(a.date, b.date) || compare(a.id, b.id),
  );
  const images = new Set<string>(),
    groups = new Set<number>(),
    image: Row[] = [],
    group: Row[] = [];
  for (const r of sorted) {
    const k = JSON.stringify([
      r.image,
      r.province,
      r.city,
      r.suburb,
      r.property_type,
      r.bedrooms,
      r.bathrooms,
      r.floor_size,
    ]);
    if (!r.image || !images.has(k)) {
      image.push(r);
      images.add(k);
    }
    if (!groups.has(r.group)) {
      group.push(r);
      groups.add(r.group);
    }
  }
  return { baseline: rows, image, group };
}
export async function readData(directory: string): Promise<{
  rows: Row[];
  raw: Row[];
  labels: Map<string, string>;
  audit: Audit;
  source: {
    files: number;
    raw_sha256: string;
    malformed: { file: string; line: number; error: string }[];
  };
}> {
  const files = (await readdir(directory))
      .filter((x) => x.endsWith(".jsonl"))
      .sort(compare),
    hash = createHash("sha256"),
    raw: Row[] = [],
    labels = new Map<string, string>(),
    malformed: { file: string; line: number; error: string }[] = [];
  for (const file of files) {
    hash.update(file);
    let lineNo = 0;
    for await (const line of createInterface({
      input: createReadStream(join(directory, file)),
      crlfDelay: Infinity,
    })) {
      lineNo++;
      hash.update(line);
      try {
        const record: unknown = JSON.parse(line);
        for (const [key, label] of collectLabels(record)) {
          if (!labels.has(key)) {
            labels.set(key, label);
          }
        }
        raw.push(extract(record, file.slice(0, -6)));
      } catch (error) {
        malformed.push({ file, line: lineNo, error: String(error) });
      }
    }
  }
  if (!raw.length) {
    throw Error("No extractable listings");
  }
  const { rows: cleaned, audit } = cleanRows(raw);
  const rows = assignGroups(cleaned);
  return {
    rows,
    raw,
    labels,
    audit,
    source: { files: files.length, raw_sha256: hash.digest("hex"), malformed },
  };
}
