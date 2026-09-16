import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

export type RawListing = { id: number; jsonld: Array<unknown> };
export type ListingIdCheckpoint = { date: string; id: number };

function isDate(value: string): boolean {
  const parsedDate = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
}

function getCheckpointPath(directory: string): string {
  return join(dirname(directory), "checkpoints.csv");
}

async function readCheckpoints(directory: string): Promise<Map<string, number>> {
  let csv = "";

  try {
    csv = await readFile(getCheckpointPath(directory), "utf8");
  } catch (error: unknown) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const checkpoints = new Map<string, number>();

  for (const [index, line] of csv.split("\n").entries()) {
    if (!line || (index === 0 && line === "date,id")) {
      continue;
    }

    const [date, rawId, ...extra] = line.split(",");
    const id = Number(rawId);

    if (extra.length > 0 || !date || !isDate(date) || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`Invalid listing ID checkpoint at line ${index + 1}`);
    }

    checkpoints.set(date, id);
  }

  return checkpoints;
}

export async function readListingIdCheckpoint(directory: string, cutoffDate: string): Promise<ListingIdCheckpoint | null> {
  const checkpoints = await readCheckpoints(directory);
  let checkpoint: ListingIdCheckpoint | null = null;

  for (const [date, id] of checkpoints) {
    if (date <= cutoffDate && (checkpoint === null || date > checkpoint.date)) {
      checkpoint = { date, id };
    }
  }

  return checkpoint;
}

export async function updateListingIdCheckpoint(directory: string, cutoffDate: string, listingId: number): Promise<void> {
  const checkpoints = await readCheckpoints(directory);
  const current = checkpoints.get(cutoffDate);

  if (current !== undefined && current >= listingId) {
    return;
  }

  checkpoints.set(cutoffDate, listingId);
  const rows = [...checkpoints.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, id]) => `${date},${id}`);
  const path = getCheckpointPath(directory);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${["date,id", ...rows].join("\n")}\n`);
}

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
      if (isDate(date)) {
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
