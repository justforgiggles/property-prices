import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Autocomplete, type RawListing } from "../src/property24.js";
import { crawlSearch } from "../src/scraper.js";
import { Storage } from "../src/storage.js";

function rawListing(id: number): RawListing {
  return { id, jsonld: [{ "@graph": [{ datePosted: "2026-09-12" }] }] };
}

test("newest searches stop after known organic results without excluding promoted listings", async () => {
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
        <div class="p24_pager"><a href="/search/p2">Next</a></div>`);
    }

    if (url.pathname === "/search/p2") {
      return new Response(`<title>Property for sale</title>
        <div class="p24_topTile"><div class="p24_tileContainer js_resultTile"><div class="p24_proTile"><a href="/for-sale/example/900">Promoted</a></div></div></div>
        <div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/100">Organic</a></div>
        <div class="p24_pager"><a href="/search/p3">Next</a></div>`);
    }

    if (url.pathname.startsWith("/for-sale/example/")) {
      const id = Number(url.pathname.split("/").at(-1));
      return new Response(`<title>Home for sale</title><script type="application/ld+json">${JSON.stringify(rawListing(id).jsonld[0])}</script>`);
    }

    throw new Error(`Unexpected request: ${url.href}`);
  };

  try {
    const searches = await Autocomplete.findAll();
    assert.equal(searches.length, 3);
    assert.ok(searches.every((url) => new URL(url).searchParams.get("sp") === "so=Newest"));
    assert.equal(await crawlSearch("https://www.property24.com/search", storage, "2026-09-01", 0), 2);
    assert.equal(requests.get("/for-sale/example/900"), 1);
    assert.equal(requests.get("/for-sale/example/200"), 1);
    assert.equal(requests.get("/search/p2"), 1);
    assert.equal(requests.get("/search/p3"), undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(temporaryDirectory, { recursive: true });
  }
});
