import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { crawlSearch, parseDetailPage, parseSearchPage } from "../src/property24.js";
import { captureListing, findPublicationDate, readCapturedIds, readListingIdCheckpoint, updateListingIdCheckpoint } from "../src/storage.js";

function raw(id: number, date: string): { id: number; jsonld: Array<unknown> } {
  return { id, jsonld: [{ "@graph": [{ datePosted: date, about: {}, offers: {} }] }] };
}

test("daily raw files preserve schema and prevent duplicate reruns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "property-data-"));
  const ids = await readCapturedIds(directory);
  assert.equal(findPublicationDate(raw(1, "2026-09-01")), "2026-09-01");
  assert.equal(findPublicationDate(raw(3, "2026-02-30")), null);
  assert.equal(await captureListing(directory, ids, raw(1, "2026-09-01"), "2026-08-16"), true);
  assert.equal(await captureListing(directory, ids, raw(1, "2026-09-01"), "2026-08-16"), false);
  assert.equal(await captureListing(directory, ids, raw(2, "2026-08-01"), "2026-08-16"), false);
  assert.equal(await captureListing(directory, ids, raw(3, "2026-09-02"), "2026-08-16"), true);
  assert.deepEqual((await readdir(directory)).sort(), ["2026-09-01.jsonl", "2026-09-02.jsonl"]);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "2026-09-01.jsonl"), "utf8")), raw(1, "2026-09-01"));
  assert.deepEqual(await readCapturedIds(directory), new Set([1, 3]));
});

test("plain HTML crawl stops at javascript pagination and captures only new IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "property-crawl-"));
  const directory = join(root, "raw");
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");

    if (request.url === "/search") {
      response.end('<title>Property for sale</title><div class="p24_tileContainer js_resultTile"><a href="/for-sale/example/123">Home</a></div><div class="p24_pager"><a href="javascript:;">Next</a></div>');
      return;
    }

    if (request.url === "/repeat") {
      response.end('<title>Property for sale</title><div class="p24_pager"><a href="/repeat">Next</a></div>');
      return;
    }

    response.end('<title>Home for sale</title><script type="application/ld+json">{"@graph":[{"datePosted":"2026-09-01","about":{},"offers":{}}]}</script>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/search`;
    const ids = await readCapturedIds(directory);
    assert.equal(await crawlSearch(url, directory, ids, "2026-08-16", 0), 1);
    assert.equal(await crawlSearch(url, directory, ids, "2026-08-16", 0), 0);
    assert.equal(parseSearchPage('<title>Property for sale</title><div class="p24_pager"><a href="javascript:;">Next</a></div>', url).next, null);
    assert.throws(() => parseSearchPage("<title>Access denied</title>", url), /did not return a sale results page/);
    await assert.rejects(crawlSearch(`http://127.0.0.1:${address.port}/repeat`, directory, ids, "2026-08-16", 0), /repeated a pagination URL/);
    assert.equal(parseDetailPage('<script type="application/ld+json">{"@graph":[]}</script>', `http://127.0.0.1:${address.port}/for-sale/example/123`).id, 123);
  } finally {
    server.close();
  }
});

test("listing ID checkpoints persist the newest applicable threshold", async () => {
  const root = await mkdtemp(join(tmpdir(), "property-checkpoint-"));
  const directory = join(root, "raw");
  assert.equal(await readListingIdCheckpoint(directory, "2026-08-16"), null);
  await updateListingIdCheckpoint(directory, "2026-08-01", 100);
  await updateListingIdCheckpoint(directory, "2026-08-01", 90);
  await updateListingIdCheckpoint(directory, "2026-09-01", 300);
  assert.deepEqual(await readListingIdCheckpoint(directory, "2026-08-16"), { date: "2026-08-01", id: 100 });
  assert.deepEqual(await readListingIdCheckpoint(directory, "2026-09-01"), { date: "2026-09-01", id: 300 });
  assert.equal(await readFile(join(root, "checkpoints.csv"), "utf8"), "date,id\n2026-08-01,100\n2026-09-01,300\n");
});

test("crawl skips checkpointed IDs and advances the threshold from old details", async () => {
  const root = await mkdtemp(join(tmpdir(), "property-checkpoint-crawl-"));
  const directory = join(root, "raw");
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
    const ids = await readCapturedIds(directory);
    await updateListingIdCheckpoint(directory, "2026-08-01", 100);
    assert.equal(await crawlSearch(url, directory, ids, "2026-08-16", 0), 1);
    assert.equal(requests.get("/for-sale/example/200"), 1);
    assert.equal(requests.get("/for-sale/example/150"), undefined);
    assert.equal(requests.get("/for-sale/example/201"), 1);
    assert.deepEqual(await readListingIdCheckpoint(directory, "2026-08-16"), { date: "2026-08-16", id: 200 });
    assert.equal(await crawlSearch(url, directory, ids, "2026-08-16", 0), 0);
    assert.equal(requests.get("/for-sale/example/200"), 1);
    assert.equal(requests.get("/for-sale/example/201"), 1);
  } finally {
    server.close();
  }
});
