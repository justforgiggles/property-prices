import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { crawlSearch, getCitySearchUrls } from "./property24.js";
import { captureListing, readCapturedIds, type RawListing } from "./storage.js";

function getAfterDate(arguments_: Array<string>): string {
  const index = arguments_.indexOf("--after");
  const date = index < 0 ? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10) : arguments_[index + 1];
  const parsedDate = new Date(`${date}T00:00:00Z`);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error("--after must be a valid YYYY-MM-DD date");
  }

  return date;
}

async function main(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/raw");
  const ids = await readCapturedIds(directory);

  if (command === "import") {
    if (arguments_.length !== 1) {
      throw new Error("Usage: npm run import:raw -- /path/to/raw.jsonl");
    }

    const lines = createInterface({ input: createReadStream(resolve(arguments_[0])), crlfDelay: Infinity });
    let captured = 0;

    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const listing = JSON.parse(line) as RawListing;

      if (!listing || !Array.isArray(listing.jsonld)) {
        throw new Error("Import accepts only raw {id, jsonld} listings");
      }

      if (await captureListing(directory, ids, listing, "0000-01-01")) {
        captured += 1;
      }
    }

    console.log(`Imported ${captured} new raw listings`);
    return;
  }

  if (command !== "scrape" || !(arguments_.length === 0 || (arguments_.length === 2 && arguments_[0] === "--after"))) {
    throw new Error("Usage: npm run scrape -- [--after YYYY-MM-DD]");
  }

  const after = getAfterDate(arguments_);
  const cities = await getCitySearchUrls();
  let captured = 0;
  let failed = 0;

  for (const [index, url] of cities.entries()) {
    try {
      captured += await crawlSearch(url, directory, ids, after, 10_000);
      console.log(`${index + 1}/${cities.length} cities, ${captured} new listings`);
    } catch (error: unknown) {
      failed += 1;
      console.error(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`Crawl finished: ${captured} new listings, ${failed} incomplete cities`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
