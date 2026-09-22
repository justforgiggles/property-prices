import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Autocomplete, ListingPage, type RawListing } from "../src/property24.js";
import { crawlSearch } from "../src/scraper.js";
import { Storage } from "../src/storage.js";

function rawListing(id: number, date = "2026-09-12"): RawListing {
  return { id, jsonld: [{ "@graph": [{ datePosted: date }] }] };
}

test("listing rates and taxes are numeric, absent, or reported when unparseable", async () => {
  const originalFetch = globalThis.fetch;
  const progress: Array<string> = [];
  const values = new Map([
    [1, "R 1 600"],
    [2, "R 374.95"],
    [3, null],
    [4, "Contact agent"],
    [5, ""],
  ]);

  globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const id = Number(url.pathname.split("/").at(-1));
    const value = values.get(id);
    const overview = value === null ? "" : `<div class="p24_propertyOverviewKey">Rates and Taxes</div><div class="p24_propertyOverviewResult"><div class="p24_info">${value}</div></div>`;
    return new Response(`<p>Rates and Taxes R 9 999</p>${overview}<script type="application/ld+json">${JSON.stringify(rawListing(id).jsonld[0])}</script>`);
  };

  try {
    for (const [id, expected] of [[1, 1600], [2, 374.95], [3, null], [4, null], [5, null]] as const) {
      const listing = await new ListingPage(`https://www.property24.com/for-sale/example/${id}`, (message) => progress.push(message)).parse();
      assert.equal(listing.ratesAndTaxes, expected);
    }

    assert.deepEqual(progress.filter((message) => message.startsWith("Rates and Taxes parse failed:")), [
      "Rates and Taxes parse failed: https://www.property24.com/for-sale/example/4 value=\"Contact agent\"",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("newest searches stop at the first old organic listing without using promoted listings as the boundary", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "property-data-"));
  const storage = new Storage(join(temporaryDirectory, "raw"));
  const requests = new Map<string, number>();
  const originalFetch = globalThis.fetch;

  await storage.insertListing(rawListing(100));
  globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.set(url.pathname, (requests.get(url.pathname) ?? 0) + 1);

    if (url.pathname === "/autocomplete/propertiesgrouped") {
      return Response.json({ areas: [
        { id: 1, name: "Cape Town", parentName: "Western Cape", type: 2 },
        { id: 2, name: "Johannesburg", parentName: "Gauteng", type: 2 },
        { id: 3, name: "Durban", parentName: "KwaZulu Natal", type: 2 },
      ] });
    }

    if (url.pathname === "/search") {
      return new Response(`<title>Property for sale</title>
        <div class="p24_topTile"><div class="p24_tileContainer js_resultTile"><div class="p24_proTile"><a href="/for-sale/example/900">Promoted</a></div></div></div>
        <div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/200">Organic</a></div>
        <div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/100">Known organic</a></div>
        <div class="p24_pager"><a href="/search/p2">Next</a></div>`);
    }

    if (url.pathname === "/search/p2") {
      return new Response(`<title>Property for sale</title>
        <div class="p24_topTile"><div class="p24_tileContainer js_resultTile"><div class="p24_proTile"><a href="/for-sale/example/901">Promoted</a></div></div></div>
        <div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/175">Recent organic</a></div>
        <div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/150">Old organic</a></div>
        <div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/140">Later organic</a></div>
        <div class="p24_pager"><a href="/search/p3">Next</a></div>`);
    }

    if (url.pathname.startsWith("/for-sale/example/")) {
      const id = Number(url.pathname.split("/").at(-1));
      const date = id === 150 || id === 901 ? "2026-08-01" : "2026-09-12";
      return new Response(`<title>Home for sale</title><script type="application/ld+json">${JSON.stringify(rawListing(id, date).jsonld[0])}</script>`);
    }

    throw new Error(`Unexpected request: ${url.href}`);
  };

  try {
    const searches = await Autocomplete.findAll();
    const progress: Array<string> = [];
    assert.equal(searches.length, 3);
    assert.ok(searches.every((url) => new URL(url).searchParams.get("sp") === "so=Newest"));
    assert.equal(await crawlSearch("https://www.property24.com/search", storage, "2026-09-01", 0, (message) => progress.push(message)), 3);
    assert.deepEqual(progress, [
      "page 1 started",
      "HTTP GET started: https://www.property24.com/search",
      "HTTP GET finished (200): https://www.property24.com/search",
      "HTTP GET started: https://www.property24.com/for-sale/example/900",
      "HTTP GET finished (200): https://www.property24.com/for-sale/example/900",
      "HTTP GET started: https://www.property24.com/for-sale/example/200",
      "HTTP GET finished (200): https://www.property24.com/for-sale/example/200",
      "listing 100 skipped: already captured (https://www.property24.com/for-sale/example/100)",
      "page 1 finished, 3 results, 2 new listings",
      "page 2 started",
      "HTTP GET started: https://www.property24.com/search/p2",
      "HTTP GET finished (200): https://www.property24.com/search/p2",
      "HTTP GET started: https://www.property24.com/for-sale/example/901",
      "HTTP GET finished (200): https://www.property24.com/for-sale/example/901",
      "listing 901 skipped: published 2026-08-01 before cutoff 2026-09-01 (https://www.property24.com/for-sale/example/901)",
      "HTTP GET started: https://www.property24.com/for-sale/example/175",
      "HTTP GET finished (200): https://www.property24.com/for-sale/example/175",
      "HTTP GET started: https://www.property24.com/for-sale/example/150",
      "HTTP GET finished (200): https://www.property24.com/for-sale/example/150",
      "listing 150 skipped: published 2026-08-01 before cutoff 2026-09-01 (https://www.property24.com/for-sale/example/150)",
      "cutoff reached at listing 150; stopping city",
      "page 2 finished, 4 results, 1 new listings",
    ]);
    assert.equal(requests.get("/for-sale/example/900"), 1);
    assert.equal(requests.get("/for-sale/example/200"), 1);
    assert.equal(requests.get("/for-sale/example/901"), 1);
    assert.equal(requests.get("/for-sale/example/175"), 1);
    assert.equal(requests.get("/for-sale/example/150"), 1);
    assert.equal(requests.get("/for-sale/example/100"), undefined);
    assert.equal(requests.get("/for-sale/example/140"), undefined);
    assert.equal(requests.get("/search/p2"), 1);
    assert.equal(requests.get("/search/p3"), undefined);
    assert.equal(await storage.hasListing(901), false);
    assert.equal(await storage.hasListing(175), true);
    assert.equal(await storage.hasListing(150), false);
    assert.equal(await storage.hasListing(140), false);
    assert.equal(await crawlSearch("https://www.property24.com/search", storage, "2026-09-01", 0), 0);
    assert.equal(requests.get("/search/p2"), 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(temporaryDirectory, { recursive: true });
  }
});
