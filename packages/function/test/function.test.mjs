import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { predict } from "../dist/inference.js";
import { valuation } from "../dist/valuation.js";

function response() {
  return {
    code: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

const property = {
  bathrooms: 2,
  bedrooms: 3,
  locality_1: "Cape Town",
  locality_2: "Sea Point",
  region: "Western Cape",
  size: 120,
  type: "House",
};

test("prediction endpoint validates only model fields and methods", async () => {
  const method = response();
  await predict({ method: "GET", body: property }, method);
  assert.equal(method.code, 405);
  assert.equal(method.headers.Allow, "POST");

  for (const body of [{ ...property, address: "1 Main Street" }, { ...property, size: 0 }, { ...property, region: "" }]) {
    const invalid = response();
    await predict({ method: "POST", body }, invalid);
    assert.equal(invalid.code, 400);
  }
});

test("prediction endpoint serves a finite ordered ZAR interval", async () => {
  const result = response();
  await predict({ method: "POST", body: property }, result);
  assert.equal(result.code, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.ok(result.body.low <= result.body.recommended && result.body.recommended <= result.body.high);
  assert.ok([result.body.low, result.body.recommended, result.body.high].every(Number.isFinite));
});

test("function inference matches the independently verified model bundle", async () => {
  const records = JSON.parse(readFileSync(new URL("../../model/tests/verification-records.json", import.meta.url), "utf8"));
  const expected = JSON.parse(execFileSync(process.execPath, [
    new URL("../../model/tests/verify-onnx.cjs", import.meta.url).pathname,
    "--model-dir", new URL("../models", import.meta.url).pathname,
    "--json",
  ], { encoding: "utf8" }));

  for (const [index, record] of records.entries()) {
    const result = response();
    const { country: _, ...body } = record;
    await predict({ method: "POST", body }, result);

    for (const field of ["low", "recommended", "high"]) {
      assert.ok(Math.abs(result.body[field] - expected[index][field]) <= 1);
    }
  }
});

const submission = {
  created_at: "2026-09-16T12:00:00.000Z",
  data: {
    bathrooms: " 2 ",
    bedrooms: "3",
    city: "Cape Town",
    email: "thandi@example.com",
    first_name: "  Thandi <Test>  ",
    floor_area: " 120 ",
    property_type: "House",
    province: "Western Cape",
    suburb: "Sea Point",
  },
  form_id: "property-valuation",
  id: "submission-123",
  metadata: { ip_address: "127.0.0.1", user_agent: "test" },
  status: "completed",
  updated_at: "2026-09-16T12:00:00.000Z",
};

test("valuation webhook validates completed form submissions", async () => {
  const method = response();
  await valuation({ method: "GET", body: submission }, method);
  assert.equal(method.code, 405);
  assert.equal(method.headers.Allow, "POST");

  for (const body of [
    null,
    { ...submission, status: "partial" },
    { ...submission, data: { ...submission.data, province: "Eastern Cape" } },
    { ...submission, data: { ...submission.data, city: "Durban" } },
    { ...submission, data: { ...submission.data, suburb: "" } },
    { ...submission, data: { ...submission.data, bedrooms: "1.5" } },
    { ...submission, data: { ...submission.data, bedrooms: "1e1" } },
    { ...submission, data: { ...submission.data, email: "not-an-email" } },
    { ...submission, data: { ...submission.data, first_name: "   " } },
    { ...submission, data: { ...submission.data, floor_area: "5001" } },
  ]) {
    const invalid = response();
    await valuation({ method: "POST", body }, invalid);
    assert.equal(invalid.code, 400);
  }
});

test("valuation webhook emails an escaped estimate once", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM_EMAIL;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200 };
  };
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "estimates@example.com";

  try {
    const result = response();
    await valuation({ method: "POST", body: submission }, result);
    assert.equal(result.code, 204);
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.options.headers["Idempotency-Key"], "property-valuation/submission-123");

    const email = JSON.parse(request.options.body);
    assert.deepEqual(email.to, ["thandi@example.com"]);
    assert.match(email.html, /Hi Thandi &lt;Test&gt;,/);
    assert.doesNotMatch(email.html, /\{\{[^}]+\}\}/);
    assert.match(email.html, /Likely range:/);
    assert.match(email.text, /Hi Thandi <Test>,/);
    assert.doesNotMatch(email.text, /\{\{[^}]+\}\}/);
    assert.match(email.text, /Floor area: 120 m²/);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }

    if (originalFrom === undefined) {
      delete process.env.RESEND_FROM_EMAIL;
    } else {
      process.env.RESEND_FROM_EMAIL = originalFrom;
    }
  }
});

test("valuation webhook reports Resend failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM_EMAIL;
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "estimates@example.com";

  try {
    const result = response();
    await valuation({ method: "POST", body: submission }, result);
    assert.equal(result.code, 502);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }

    if (originalFrom === undefined) {
      delete process.env.RESEND_FROM_EMAIL;
    } else {
      process.env.RESEND_FROM_EMAIL = originalFrom;
    }
  }
});
