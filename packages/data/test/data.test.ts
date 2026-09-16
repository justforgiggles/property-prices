import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Autocomplete, ListingPage, SearchPage } from "../src/property24.js";
import { crawlSearch } from "../src/scraper.js";
import { Storage } from "../src/storage.js";

function raw(id: number, date: string): { id: number; jsonld: Array<unknown> } {
  return { id, jsonld: [{ "@graph": [{ datePosted: date, about: {}, offers: {} }] }] };
}

test("autocomplete returns cities from the three supported provinces", async () => {
  const originalFetch = globalThis.fetch;
  let areas = [
    { id: 432, name: "Cape Town", parentName: "Western Cape", type: 2 },
    { id: 100, name: "Johannesburg", parentName: "Gauteng", type: 2 },
    { id: 169, name: "Durban", parentName: "KwaZulu Natal", type: 2 },
    { id: 30, name: "Bloemfontein", parentName: "Free State", type: 2 },
    { id: 432, name: "Cape Town", parentName: "Western Cape", type: 2 },
  ];
  globalThis.fetch = async () => Response.json({ areas });

  try {
    assert.deepEqual(await Autocomplete.findAll(), [
      "https://www.property24.com/for-sale/cape-town/western-cape/432?PropertyCategory=House%2CApartmentOrFlat%2CTownhouse",
      "https://www.property24.com/for-sale/durban/kwazulu-natal/169?PropertyCategory=House%2CApartmentOrFlat%2CTownhouse",
      "https://www.property24.com/for-sale/johannesburg/gauteng/100?PropertyCategory=House%2CApartmentOrFlat%2CTownhouse",
    ]);
    areas = areas.filter((area) => area.parentName !== "KwaZulu Natal");
    await assert.rejects(Autocomplete.findAll(), /no city locations for: KwaZulu Natal/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("daily raw files preserve schema and prevent duplicate reruns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "property-data-"));
  const storage = new Storage(directory);
  assert.equal(storage.findListingPublicationDate(raw(1, "2026-09-01")), "2026-09-01");
  assert.equal(storage.findListingPublicationDate(raw(3, "2026-02-30")), null);
  assert.equal(await storage.insertListing(raw(1, "2026-09-01")), true);
  assert.equal(await storage.insertListing(raw(1, "2026-09-01")), false);
  assert.equal(await storage.insertListing(raw(2, "2026-02-30")), false);
  assert.equal(await storage.insertListing(raw(3, "2026-09-02")), true);
  assert.deepEqual((await readdir(directory)).sort(), ["2026-09-01.jsonl", "2026-09-02.jsonl"]);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "2026-09-01.jsonl"), "utf8")), raw(1, "2026-09-01"));
  assert.equal(await new Storage(directory).hasListing(1), true);
  assert.equal(await new Storage(directory).hasListing(4), false);
});

test("page objects cache search HTML and crawl captures only new IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "property-crawl-"));
  const directory = join(root, "raw");
  const requests = new Map<string, number>();
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    requests.set(path, (requests.get(path) ?? 0) + 1);
    response.setHeader("Content-Type", "text/html");

    if (path === "/search") {
      response.end('<title>Property for sale</title><div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/123">Home</a></div><div class="p24_pager"><a href="javascript:;">Next</a></div>');
      return;
    }

    if (path === "/repeat") {
      response.end('<title>Property for sale</title><div class="p24_pager"><a href="/repeat">Next</a></div>');
      return;
    }

    if (path === "/denied") {
      response.end("<title>Access denied</title>");
      return;
    }

    response.end('<title>Home for sale</title><script type="application/ld+json">{"@graph":[{"datePosted":"2026-09-01","about":{},"offers":{}}]}</script>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/search`;
    const searchPage = new SearchPage(url);
    assert.deepEqual(await searchPage.parseAll(), [`http://127.0.0.1:${address.port}/for-sale/example/123`]);
    assert.equal(await searchPage.next(), null);
    assert.equal(requests.get("/search"), 1);

    const storage = new Storage(directory);
    assert.equal(await crawlSearch(url, storage, "2026-08-16", 0), 1);
    assert.equal(await crawlSearch(url, storage, "2026-08-16", 0), 0);
    await assert.rejects(new SearchPage(`http://127.0.0.1:${address.port}/denied`).parseAll(), /did not return a sale results page/);
    await assert.rejects(crawlSearch(`http://127.0.0.1:${address.port}/repeat`, storage, "2026-08-16", 0), /repeated a pagination URL/);
    assert.equal((await new ListingPage(`http://127.0.0.1:${address.port}/for-sale/example/123`).parse()).id, 123);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("listing ID checkpoints persist the newest applicable threshold", async () => {
  const root = await mkdtemp(join(tmpdir(), "property-checkpoint-"));
  const storage = new Storage(join(root, "raw"));
  assert.equal(await storage.findListingIdCheckpoint("2026-08-16"), null);
  await storage.updateListingIdCheckpoint("2026-08-01", 100);
  await storage.updateListingIdCheckpoint("2026-08-01", 90);
  await storage.updateListingIdCheckpoint("2026-09-01", 300);
  assert.equal(await storage.findListingIdCheckpoint("2026-08-16"), 100);
  assert.equal(await storage.findListingIdCheckpoint("2026-09-01"), 300);
  assert.equal(await readFile(join(root, "checkpoints.csv"), "utf8"), "date,id\n2026-08-01,100\n2026-09-01,300\n");
});

test("crawl skips checkpointed IDs and advances the threshold from old details", async () => {
  const root = await mkdtemp(join(tmpdir(), "property-checkpoint-crawl-"));
  const storage = new Storage(join(root, "raw"));
  const requests = new Map<string, number>();
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    requests.set(path, (requests.get(path) ?? 0) + 1);
    response.setHeader("Content-Type", "text/html");

    if (path === "/search") {
      response.end('<title>Property for sale</title><div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/200">Old</a></div><div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/150">Below advanced checkpoint</a></div><div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/201">Recent</a></div>');
      return;
    }

    const date = path.endsWith("/200") ? "2026-08-01" : "2026-09-01";
    response.end(`<title>Home for sale</title><script type="application/ld+json">{"@graph":[{"datePosted":"${date}","about":{},"offers":{}}]}</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/search`;
    await storage.updateListingIdCheckpoint("2026-08-01", 100);
    assert.equal(await crawlSearch(url, storage, "2026-08-16", 0), 1);
    assert.equal(requests.get("/for-sale/example/200"), 1);
    assert.equal(requests.get("/for-sale/example/150"), undefined);
    assert.equal(requests.get("/for-sale/example/201"), 1);
    assert.equal(await storage.findListingIdCheckpoint("2026-08-16"), 200);
    assert.equal(await crawlSearch(url, storage, "2026-08-16", 0), 0);
    assert.equal(requests.get("/for-sale/example/200"), 1);
    assert.equal(requests.get("/for-sale/example/201"), 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
