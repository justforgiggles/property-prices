import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { predict } from "../dist/index.js";

function response() {
  return {
    code: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
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
