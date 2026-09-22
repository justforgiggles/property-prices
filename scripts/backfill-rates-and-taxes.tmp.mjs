import { appendFileSync } from "node:fs";
import { readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { ListingPage } from "../packages/data/src/property24.ts";

const dataDir = resolve(import.meta.dirname, "../data");
const rawDir = join(dataDir, "raw");
const parseLog = join(dataDir, "rates-and-taxes-backfill-parse-errors.jsonl");
const fetchLog = join(dataDir, "rates-and-taxes-backfill-failures.jsonl");
const selectedIds = new Set(process.argv.slice(2).map(Number));

if ([...selectedIds].some((id) => !Number.isSafeInteger(id) || id <= 0)) {
  throw new Error("Usage: node --import tsx scripts/backfill-rates-and-taxes.tmp.mjs [listing-id ...]");
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  await sleep(2_000);
  return originalFetch(...args);
};

function findUrl(listing) {
  for (const document of listing.jsonld ?? []) {
    for (const node of document?.["@graph"] ?? []) {
      if (typeof node?.url === "string" && node.url.endsWith(`/${listing.id}`)) {
        return node.url;
      }
    }
  }
  return null;
}

async function save(path, listings, expectedText) {
  const temporaryPath = `${path}.rates-backfill.tmp`;
  if (await readFile(path, "utf8") !== expectedText) {
    throw new Error(`Raw file changed during backfill: ${path}`);
  }
  const updatedText = `${listings.map((listing) => JSON.stringify(listing)).join("\n")}\n`;
  await writeFile(temporaryPath, updatedText);
  if (await readFile(path, "utf8") !== expectedText) {
    await unlink(temporaryPath);
    throw new Error(`Raw file changed during backfill: ${path}`);
  }
  await rename(temporaryPath, path);
  return updatedText;
}

async function backfill(listing) {
  const url = findUrl(listing);
  let lastError = "No listing URL in saved JSON-LD";

  if (url !== null) {
    for (let attempt = 1; ; attempt += 1) {
      const parseMessages = [];
      let parsed;

      try {
        parsed = await new ListingPage(url, (message) => {
          if (message.startsWith("Rates and Taxes parse failed:")) {
            parseMessages.push(message);
          }
        }).parse();

        if (findUrl(parsed) === null) {
          throw new Error("Fetched page JSON-LD does not match listing ID");
        }

      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (/request failed \((404|410)\)/.test(lastError)) {
          break;
        }

        if (/request failed \((403|429|5\d\d)\)|fetch failed|timeout/i.test(lastError)) {
          console.warn(`Backfill retry ${attempt}: ${listing.id} ${lastError}`);
          await sleep(Math.min(attempt * 10_000, 300_000));
          continue;
        }

        if (attempt === 3) {
          break;
        }
        await sleep(attempt * 10_000);
        continue;
      }

      for (const message of parseMessages) {
        appendFileSync(parseLog, `${JSON.stringify({ id: listing.id, url, message })}\n`);
        console.warn(message);
      }

      return parsed.ratesAndTaxes ?? null;
    }
  }

  appendFileSync(fetchLog, `${JSON.stringify({ id: listing.id, url, error: lastError })}\n`);
  console.warn(`Backfill fetch failed: ${listing.id} ${url ?? "no URL"}: ${lastError}`);
  return null;
}

const files = (await readdir(rawDir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
let processed = 0;
let numeric = 0;
let missing = 0;

for (const name of files) {
  const path = join(rawDir, name);
  let expectedText = await readFile(path, "utf8");
  const listings = expectedText.trimEnd().split("\n").map(JSON.parse);
  let changed = 0;

  const pending = listings.filter((listing) => selectedIds.size > 0 ? selectedIds.has(listing.id) : !Object.hasOwn(listing, "ratesAndTaxes"));

  for (let offset = 0; offset < pending.length; offset += 3) {
    const batch = pending.slice(offset, offset + 3);
    const values = await Promise.all(batch.map(backfill));

    for (const [index, listing] of batch.entries()) {
      listing.ratesAndTaxes = values[index];
      processed += 1;
      changed += 1;
      if (listing.ratesAndTaxes === null) missing += 1;
      else numeric += 1;
    }

    if (changed % 25 < batch.length) {
      expectedText = await save(path, listings, expectedText);
      console.log(`${name}: ${changed} updated; ${processed} total (${numeric} numeric, ${missing} null)`);
    }
  }

  if (changed > 0) {
    await save(path, listings, expectedText);
    console.log(`${name}: complete, ${changed} updated; ${processed} total (${numeric} numeric, ${missing} null)`);
  }
}

console.log(`Backfill complete: ${processed} updated (${numeric} numeric, ${missing} null)`);

const ids = new Set();
let verified = 0;
let unresolvedParseErrors = 0;
let flaggedIds = new Set();

try {
  flaggedIds = new Set((await readFile(parseLog, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line).id));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

for (const name of (await readdir(rawDir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))) {
  for (const line of (await readFile(join(rawDir, name), "utf8")).trimEnd().split("\n")) {
    const listing = JSON.parse(line);
    if (ids.has(listing.id) || !Object.hasOwn(listing, "ratesAndTaxes") ||
        (listing.ratesAndTaxes !== null && (!Number.isFinite(listing.ratesAndTaxes) || listing.ratesAndTaxes < 0))) {
      throw new Error(`Backfill verification failed for listing ${listing.id} in ${name}`);
    }
    ids.add(listing.id);
    verified += 1;
    if (flaggedIds.has(listing.id) && listing.ratesAndTaxes === null) unresolvedParseErrors += 1;
  }
}

if (verified < 25_802 || unresolvedParseErrors > 0) {
  throw new Error(`Backfill verification: ${verified} records; ${unresolvedParseErrors} unresolved parse errors`);
}

console.log(`Verified ${verified} records; removing temporary backfill script`);
await unlink(fileURLToPath(import.meta.url));
