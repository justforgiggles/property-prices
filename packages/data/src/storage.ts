import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

import type { RawListing } from "./property24.js";

export class Storage {
  private listingIds: Promise<Set<number>> | null = null;

  public constructor(private readonly directory: string) {}

  public async hasListing(listingId: number): Promise<boolean> {
    const ids = await (this.listingIds ??= this.readListingIds());
    return ids.has(listingId);
  }

  public async insertListing(listing: RawListing): Promise<boolean> {
    const ids = await (this.listingIds ??= this.readListingIds());

    if (!Number.isSafeInteger(listing.id) || ids.has(listing.id)) {
      return false;
    }

    const date = this.findListingPublicationDate(listing);

    if (date === null) {
      return false;
    }

    await mkdir(this.directory, { recursive: true });
    const file = await open(join(this.directory, `${date}.jsonl`), "a");

    try {
      await file.write(`${JSON.stringify(listing)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }

    ids.add(listing.id);
    return true;
  }

  public findListingPublicationDate(listing: RawListing): string | null {
    for (const document of listing.jsonld) {
      if (typeof document !== "object" || document === null || !("@graph" in document)) {
        continue;
      }

      const graph = document["@graph"];

      if (!Array.isArray(graph)) {
        continue;
      }

      for (const node of graph) {
        if (typeof node !== "object" || node === null || !("datePosted" in node) || typeof node.datePosted !== "string") {
          continue;
        }

        const date = node.datePosted.slice(0, 10);
        const parsedDate = new Date(`${date}T00:00:00Z`);

        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date) {
          return date;
        }
      }
    }

    return null;
  }

  public async findListingIdCheckpoint(cutoffDate: string): Promise<number | null> {
    const checkpoints = await this.readCheckpoints();
    let checkpointDate = "";
    let checkpointId: number | null = null;

    for (const [date, id] of checkpoints) {
      if (date <= cutoffDate && date > checkpointDate) {
        checkpointDate = date;
        checkpointId = id;
      }
    }

    return checkpointId;
  }

  public async updateListingIdCheckpoint(cutoffDate: string, listingId: number): Promise<void> {
    const checkpoints = await this.readCheckpoints();
    const current = checkpoints.get(cutoffDate);

    if (current !== undefined && current >= listingId) {
      return;
    }

    checkpoints.set(cutoffDate, listingId);
    const rows = [...checkpoints.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, id]) => `${date},${id}`);
    const path = join(dirname(this.directory), "checkpoints.csv");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${["date,id", ...rows].join("\n")}\n`);
  }

  private async readListingIds(): Promise<Set<number>> {
    const ids = new Set<number>();
    await mkdir(this.directory, { recursive: true });

    for (const name of await readdir(this.directory)) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) {
        continue;
      }

      const lines = createInterface({ input: createReadStream(join(this.directory, name)), crlfDelay: Infinity });

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

  private async readCheckpoints(): Promise<Map<string, number>> {
    let csv = "";

    try {
      csv = await readFile(join(dirname(this.directory), "checkpoints.csv"), "utf8");
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
      const parsedDate = new Date(`${date}T00:00:00Z`);

      if (extra.length > 0 || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || !Number.isSafeInteger(id) || id <= 0) {
        throw new Error(`Invalid listing ID checkpoint at line ${index + 1}`);
      }

      checkpoints.set(date, id);
    }

    return checkpoints;
  }
}
