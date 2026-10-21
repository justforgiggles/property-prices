import assert from "node:assert/strict";
import { test } from "node:test";

test("proxy retries three times, buffers response bodies and redacts failures", async () => {
  const original = globalThis.fetch;
  const originalError = console.error;
  const logs = [];
  let calls = 0;
  process.env.OXYLABS_USERNAME = "test";
  process.env.OXYLABS_PASSWORD = "private-test-password";
  console.error = (message) => logs.push(message);
  globalThis.fetch = async (_url, options) => {
    assert.ok(options.dispatcher);
    calls++;
    if (calls < 3) throw new Error("private-test-password");
    return new Response("success");
  };
  try {
    await import("../scripts/scrape-proxy.mjs");
    const response = await fetch("https://example.com");
    assert.equal(await response.text(), "success");
    assert.equal(calls, 3);
    assert.equal(logs.length, 2);
    assert.ok(logs.every((line) => !line.includes("private-test-password")));
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
    delete process.env.OXYLABS_USERNAME;
    delete process.env.OXYLABS_PASSWORD;
  }
});
