import { createReadStream } from "node:fs";
import { mkdir, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type RawListing = { id: number; jsonld: Array<unknown> };

export function findPublicationDate(listing: RawListing): string | null {
  for (const document of listing.jsonld) {
    if (typeof document !== "object" || document === null || !("@graph" in document)) {
      continue;
    }

    const graph = document["@graph"];

    if (!Array.isArray(graph)) {
      continue;
    }

    for (const node of graph) {
      if (typeof node !== "object" || node === null || !("datePosted" in node)) {
        continue;
      }

      const datePosted = node.datePosted;

      if (typeof datePosted !== "string") {
        continue;
      }

      const date = datePosted.slice(0, 10);
      const parsedDate = new Date(`${date}T00:00:00Z`);

      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date) {
        return date;
      }
    }
  }

  return null;
}

export async function readCapturedIds(directory: string): Promise<Set<number>> {
  const ids = new Set<number>();
  await mkdir(directory, { recursive: true });

  for (const name of await readdir(directory)) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) {
      continue;
    }

    const lines = createInterface({ input: createReadStream(join(directory, name)), crlfDelay: Infinity });

    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const listing = JSON.parse(line) as { id?: unknown };

      if (typeof listing.id !== "number" || !Number.isSafeInteger(listing.id)) {
        throw new Error(`Invalid listing ID in ${name}`);
      }

      if (ids.has(listing.id)) {
        throw new Error(`Duplicate listing ID ${listing.id} in raw data`);
      }

      ids.add(listing.id);
    }
  }

  return ids;
}

export async function captureListing(directory: string, ids: Set<number>, listing: RawListing, after: string): Promise<boolean> {
  if (!Number.isSafeInteger(listing.id) || ids.has(listing.id)) {
    return false;
  }

  const date = findPublicationDate(listing);

  if (date === null || date < after) {
    return false;
  }

  await mkdir(directory, { recursive: true });
  const file = await open(join(directory, `${date}.jsonl`), "a");

  try {
    await file.write(`${JSON.stringify(listing)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }

  ids.add(listing.id);
  return true;
}
