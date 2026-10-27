import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readListings, directoryFromListings } from "./listing-data.mjs";
import { writeWebsiteData } from "./generate-city-analytics.mjs";

export async function generateCities(directory, now = new Date()) {
  return directoryFromListings(await readListings(directory), now);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const website = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = await writeWebsiteData(
    resolve(website, "../../data/raw"),
    resolve(website, "data"),
  );
  console.log(
    `Generated ${result.manifest.cities.length} city reports and ${result.suburbReports.length} suburb reports (${result.manifest.period.start}–${result.manifest.period.end}) and ${result.directory.totalListings} directory listings`,
  );
}
