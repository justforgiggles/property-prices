import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Autocomplete } from "./property24.js";
import { crawlSearch } from "./scraper.js";
import { Storage } from "./storage.js";

async function main(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/raw");
  const storage = new Storage(directory);

  if (command !== "scrape" || arguments_.length !== 0) {
    throw new Error("Usage: npm run scrape");
  }

  const cutoffDate = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const cities = await Autocomplete.findAll((progress) => console.log(`City discovery: ${progress}`));
  let captured = 0;
  let failed = 0;

  for (const [index, url] of cities.entries()) {
    const city = `${index + 1}/${cities.length} cities`;
    console.log(`${city}: started`);

    try {
      captured += await crawlSearch(url, storage, cutoffDate, 4_000, (progress) => {
        console.log(`${city}: ${progress}`);

        if (progress.startsWith("Rates and Taxes parse failed:")) {
          appendFileSync(resolve(directory, "../rates-and-taxes-parse-errors.log"), `${progress}\n`);
        }
      });
      console.log(`${city}: finished, ${captured} total new listings`);
    } catch (error: unknown) {
      failed += 1;
      console.error(`${city}: failed (${url}): ${error instanceof Error ? error.message : String(error)}`);
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
