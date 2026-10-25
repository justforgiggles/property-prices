import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Autocomplete, ListingPage, SearchPage } from "./property24.js";
import { Storage } from "./storage.js";

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "property-scrape-smoke-"));
  const storage = new Storage(directory);
  const cities = await Autocomplete.findAll(console.log);
  const city = cities[0];

  if (city === undefined) {
    throw new Error("No city found for smoke test");
  }

  console.log(`Smoke test city: ${city}`);
  const listings = await new SearchPage(city, console.log).parseAll();
  const cutoff = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  let captured = 0;

  for (const listing of listings.slice(0, 10)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 4_000));
    const detail = await new ListingPage(listing.url, console.log).parse();
    const date = storage.findListingPublicationDate(detail);

    if (date !== null && date >= cutoff && await storage.insertListing(detail)) {
      captured += 1;
    }
  }

  if (captured === 0) {
    throw new Error("Smoke test captured no valid recent listings");
  }

  let stored = 0;

  for (const name of await readdir(directory)) {
    const lines = (await readFile(join(directory, name), "utf8")).trim().split("\n");

    for (const line of lines) {
      const listing = JSON.parse(line) as { id: number; jsonld: Array<unknown> };

      if (!Number.isSafeInteger(listing.id) || !Array.isArray(listing.jsonld) || listing.jsonld.length === 0) {
        throw new Error("Smoke test wrote invalid listing data");
      }

      stored += 1;
    }
  }

  if (stored !== captured) {
    throw new Error("Smoke test storage count mismatch");
  }

  console.log(`Smoke test passed: ${captured} valid listings in ${directory}; repository data unchanged`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
