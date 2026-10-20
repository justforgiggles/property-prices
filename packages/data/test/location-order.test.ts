import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { sortCitiesByRecentListings } from "../src/location-order.js";
import type { RawListing } from "../src/property24.js";

function listing(id: number, province: string, city: string, date = "2026-09-21"): RawListing {
  return {
    id,
    jsonld: [{
      "@graph": [{
        datePosted: date,
        breadcrumb: {
          itemListElement: [
            { position: 2, name: province },
            { position: 3, name: city },
          ],
        },
      }],
    }],
  };
}

test("recent volume ranks provinces before cities and keeps zero-count cities with alphabetical ties", async () => {
  const directory = await mkdtemp(join(tmpdir(), "location-order-"));
  const cities = [
    { parentName: "KwaZulu Natal", name: "Shared" },
    { parentName: "Western Cape", name: "Unknown" },
    { parentName: "Gauteng", name: "Zero B" },
    { parentName: "Gauteng", name: "Beta" },
    { parentName: "Gauteng", name: "Shared" },
    { parentName: "Gauteng", name: "Zero A" },
    { parentName: "Gauteng", name: "Alpha" },
  ];
  const original = [...cities];
  const listings = [
    listing(1, "Gauteng", "Shared"),
    listing(2, "Gauteng", "Shared"),
    listing(3, "Gauteng", "Alpha"),
    listing(4, "Gauteng", "Beta"),
    listing(5, "KwaZulu Natal", "Shared"),
    listing(6, "KwaZulu Natal", "Shared"),
    listing(7, "KwaZulu Natal", "Shared"),
    ...Array.from({ length: 5 }, (_, index) => listing(10 + index, "Western Cape", "Unknown", "2026-09-20")),
    { id: 20, jsonld: [{ "@graph": [{ datePosted: "invalid" }] }] },
    { id: 21, jsonld: [{ "@graph": [{ datePosted: "2026-09-21" }] }] },
  ];

  try {
    await writeFile(join(directory, "2026-09-20.jsonl"), listings.map((value) => JSON.stringify(value)).join("\n") + "\n\n");
    await writeFile(join(directory, "notes.txt"), "ignored");
    const sorted = await sortCitiesByRecentListings(cities, directory, "2026-09-21");
    assert.deepEqual(sorted, [cities[4], cities[6], cities[3], cities[5], cities[2], cities[0], cities[1]]);
    assert.deepEqual(cities, original);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("missing and empty data sort alphabetically within alphabetically tied provinces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "location-order-"));
  const cities = [
    { parentName: "Western Cape", name: "Alpha" },
    { parentName: "Gauteng", name: "Zulu" },
    { parentName: "Gauteng", name: "Beta" },
  ];

  try {
    for (const path of [directory, join(directory, "missing")]) {
      assert.deepEqual(await sortCitiesByRecentListings(cities, path), [cities[2], cities[1], cities[0]]);
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("default ranking window follows the rolling 29-day cutoff on each call", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "location-order-"));
  const cities = [{ parentName: "Gauteng", name: "Alpha" }, { parentName: "Gauteng", name: "Zulu" }];
  const now = context.mock.method(Date, "now", () => Date.parse("2026-10-20T12:00:00Z"));

  try {
    await writeFile(join(directory, "2026-09-21.jsonl"), JSON.stringify(listing(1, "Gauteng", "Zulu")));
    assert.deepEqual(await sortCitiesByRecentListings(cities, directory), [cities[1], cities[0]]);
    now.mock.mockImplementation(() => Date.parse("2026-10-21T12:00:00Z"));
    assert.deepEqual(await sortCitiesByRecentListings(cities, directory), cities);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("corrupt data and duplicate IDs fail explicitly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "location-order-"));

  try {
    const file = join(directory, "2026-09-21.jsonl");
    for (const contents of ["{", JSON.stringify({ id: "invalid", jsonld: [] }), JSON.stringify({ id: 1 })]) {
      await writeFile(file, contents);
      await assert.rejects(sortCitiesByRecentListings([], directory));
    }

    const row = JSON.stringify(listing(1, "Gauteng", "Johannesburg"));
    await writeFile(file, `${row}\n${row}`);
    await assert.rejects(sortCitiesByRecentListings([], directory), /Duplicate listing ID 1/);
    await assert.rejects(sortCitiesByRecentListings([], file), /ENOTDIR/);
  } finally {
    await rm(directory, { recursive: true });
  }
});
