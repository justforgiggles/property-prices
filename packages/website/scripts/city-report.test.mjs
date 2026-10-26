import assert from "node:assert/strict";
import test from "node:test";
import { cityPath, slugify } from "../lib/city-routes.mjs";
import { cityReports } from "../lib/city-report.ts";

test("city URLs include province and normalize punctuation and accents", () => {
  assert.equal(
    cityPath({ name: "Cape Town", province: "Western Cape" }),
    "/western-cape/cape-town/",
  );
  assert.notEqual(
    cityPath({ name: "Heidelberg", province: "Gauteng" }),
    cityPath({ name: "Heidelberg", province: "Western Cape" }),
  );
  assert.equal(slugify("  Gordon's Bay / Côte  "), "gordon-s-bay-cote");
});

test("every bedroom fixture reconciles its charts, counts and price ranges", () => {
  assert.deepEqual(
    cityReports.map((report) => report.id),
    ["all", "1", "2", "3", "4", "5plus"],
  );
  for (const report of cityReports) {
    assert.equal(
      report.months.reduce((sum, month) => sum + month.listings, 0),
      report.listings,
    );
    assert.equal(
      report.buckets.reduce((sum, bucket) => sum + bucket.count, 0),
      report.listings,
    );
    assert.ok(
      Math.abs(
        report.buckets.reduce((sum, bucket) => sum + bucket.share, 0) - 100,
      ) < 0.00001,
    );
    for (const range of [
      report.askingPrice,
      report.pricePerSquareMetre,
      report.ratesAndTaxes,
      ...report.months,
    ]) {
      assert.ok(
        range.lower > 0 &&
          range.lower <= range.median &&
          range.median <= range.upper,
      );
    }
    // Percentiles must fall in a price band compatible with its share of listings.
    const boundaries = [0, 1e6, 2e6, 3e6, 5e6, Infinity];
    for (const [key, quantile] of [
      ["lower", 0.25],
      ["median", 0.5],
      ["upper", 0.75],
    ]) {
      const index = boundaries.findIndex(
        (lower, i) =>
          report.askingPrice[key] >= lower &&
          report.askingPrice[key] < boundaries[i + 1],
      );
      const before = report.buckets
        .slice(0, index)
        .reduce((sum, bucket) => sum + bucket.count, 0);
      assert.ok(
        before <= report.listings * quantile &&
          before + report.buckets[index].count >= report.listings * quantile,
        `${report.label}: ${key} agrees with distribution`,
      );
    }
  }
  const [all, ...groups] = cityReports;
  for (let i = 0; i < all.months.length; i++)
    assert.ok(
      groups.reduce((sum, group) => sum + group.months[i].listings, 0) <=
        all.months[i].listings,
    );
  for (let i = 0; i < all.buckets.length; i++)
    assert.ok(
      groups.reduce((sum, group) => sum + group.buckets[i].count, 0) <=
        all.buckets[i].count,
    );
});
