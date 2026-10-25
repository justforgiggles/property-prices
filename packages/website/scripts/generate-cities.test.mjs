import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateCities } from "./generate-cities.mjs";

function listing(id, date, name = "Cape Town", province = "Western Cape") {
  return {
    id,
    jsonld: [
      {
        "@graph": [
          { datePosted: date },
          {
            breadcrumb: {
              itemListElement: [
                { position: 2, name: province },
                { position: 3, name },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function fixture(t, records) {
  const directory = await mkdtemp(join(tmpdir(), "prop-radar-cities-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "2026-10-25.jsonl"),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n\n",
  );
  return directory;
}

test("counts publication dates in the inclusive 90-day window and excludes future listings", async (t) => {
  const directory = await fixture(t, [
    listing(1, "2026-07-27"),
    listing(2, "2026-07-28"),
    listing(3, "2026-10-25"),
    listing(4, "2026-10-26"),
  ]);
  const data = await generateCities(
    directory,
    new Date("2026-10-25T12:00:00Z"),
  );
  assert.equal(data.windowStart, "2026-07-28");
  assert.equal(data.windowEnd, "2026-10-25");
  assert.equal(data.generatedAt, "2026-10-25T12:00:00.000Z");
  assert.equal(data.totalListings, 2);
  assert.deepEqual(data.cities, [
    { name: "Cape Town", province: "Western Cape", listingCount: 2 },
  ]);
});

test("uses the South African calendar date at UTC rollover, including year boundaries", async (t) => {
  const directory = await fixture(t, [listing(1, "2026-01-01")]);
  const before = await generateCities(
    directory,
    new Date("2025-12-31T21:59:59Z"),
  );
  const after = await generateCities(
    directory,
    new Date("2025-12-31T22:00:00Z"),
  );
  assert.equal(before.windowEnd, "2025-12-31");
  assert.equal(before.totalListings, 0);
  assert.equal(after.windowEnd, "2026-01-01");
  assert.equal(after.windowStart, "2025-10-04");
  assert.equal(after.totalListings, 1);
});

test("deduplicates IDs across files, separates provinces, and sorts cities alphabetically", async (t) => {
  const records = [
    listing(1, "2026-10-25", "Heidelberg", "Western Cape"),
    listing(2, "2026-10-25", "Heidelberg", "Gauteng"),
    listing(3, "2026-10-25", "Cape Town"),
    listing(4, "2026-10-25", "Cape Town"),
    listing(5, "2026-01-01", "Old City"),
  ];
  const directory = await fixture(t, records);
  await writeFile(
    join(directory, "2026-10-24.jsonl"),
    JSON.stringify(records[0]),
  );
  const data = await generateCities(
    directory,
    new Date("2026-10-25T12:00:00Z"),
  );
  assert.deepEqual(data.cities, [
    { name: "Cape Town", province: "Western Cape", listingCount: 2 },
    { name: "Heidelberg", province: "Gauteng", listingCount: 1 },
    { name: "Heidelberg", province: "Western Cape", listingCount: 1 },
  ]);
  assert.equal(data.totalListings, 4);
  assert.equal(
    data.totalListings,
    data.cities.reduce((sum, city) => sum + city.listingCount, 0),
  );
});

test("returns an empty snapshot when no listings qualify", async (t) => {
  const directory = await fixture(t, [listing(1, "2026-01-01")]);
  const data = await generateCities(
    directory,
    new Date("2026-10-25T12:00:00Z"),
  );
  assert.equal(data.totalListings, 0);
  assert.deepEqual(data.cities, []);
});

for (const [name, record] of [
  ["missing ID", { jsonld: [] }],
  ["invalid date", listing(1, "2026-02-30")],
  ["missing city", listing(1, "2026-10-25", "")],
  ["missing province", listing(1, "2026-10-25", "Cape Town", "")],
]) {
  test(`rejects ${name} with source context`, async (t) => {
    const directory = await fixture(t, [record]);
    await assert.rejects(generateCities(directory), /2026-10-25\.jsonl:1:/);
  });
}

test("rejects malformed JSON rather than publishing partial counts", async (t) => {
  const directory = await fixture(t, []);
  await writeFile(join(directory, "2026-10-25.jsonl"), "{broken\n");
  await assert.rejects(generateCities(directory), /2026-10-25\.jsonl:1:/);
});
