import assert from "node:assert/strict";
import test from "node:test";
import { cityPath, suburbPath, slugify } from "../lib/city-routes.mjs";
import {
  formatPeriod,
  formatMonth,
  bucketLabel,
  compactRand,
  rand,
} from "../lib/city-report.ts";

test("city URLs include province and normalize punctuation and accents", () => {
  assert.equal(
    cityPath({ name: "Cape Town", province: "Western Cape" }),
    "/western-cape/cape-town/",
  );
  assert.notEqual(
    cityPath({ name: "Heidelberg", province: "Gauteng" }),
    cityPath({ name: "Heidelberg", province: "Western Cape" }),
  );
  assert.equal(
    suburbPath({
      province: "Western Cape",
      city: "Cape Town",
      name: "Sea Point",
    }),
    "/western-cape/cape-town/sea-point/",
  );
  assert.notEqual(
    suburbPath({ province: "Gauteng", city: "Pretoria", name: "Central" }),
    suburbPath({ province: "Gauteng", city: "Johannesburg", name: "Central" }),
  );
  assert.equal(slugify("  Gordon's Bay / Côte  "), "gordon-s-bay-cote");
});

test("data formatting handles absent statistics, zero, and periods across years", () => {
  assert.equal(rand(null), "—");
  assert.equal(rand(0), "R0");
  assert.equal(compactRand(1500000), "R1.50m");
  assert.equal(formatMonth("2025-12", true), "December 2025");
  assert.equal(
    formatPeriod({ start: "2025-11-01", end: "2026-01-31" }),
    "1 November 2025 – 31 January 2026",
  );
  assert.equal(bucketLabel(0, 1000000), "Under R1m");
  assert.equal(bucketLabel(5000000, null), "R5m+");
});
