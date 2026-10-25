import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Autocomplete } from "./property24.js";
import { crawlSearch } from "./scraper.js";
import { Storage } from "./storage.js";

async function main(): Promise<void> {
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/raw");
  const storage = new Storage(directory);

  const cutoffDate = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const cities = await Autocomplete.findAll((progress) => console.log(`City discovery: ${progress}`));
  let failed = 0;

  for (const [index, url] of cities.entries()) {
    const city = `${index + 1}/${cities.length} cities`;
    console.log(`${city}: started`);

    try {
      await crawlSearch(url, storage, cutoffDate, 4_000, (progress) => {
        console.log(`${city}: ${progress}`);

        if (progress.startsWith("Rates and Taxes parse failed:")) {
          appendFileSync(resolve(directory, "../rates-and-taxes-parse-errors.log"), `${progress}\n`);
        }
      });
      console.log(`${city}: finished, ${storage.listingsAdded} total new listings`);
    } catch (error: unknown) {
      failed += 1;
      console.error(`${city}: failed (${url}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`Crawl finished: ${storage.listingsAdded} new listings, ${failed} incomplete cities`);
  writeFileSync(resolve(directory, "../result.json"), `${JSON.stringify({
    completed_at: new Date().toISOString(),
    listings_added: storage.listingsAdded,
    failed_cities: failed,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
