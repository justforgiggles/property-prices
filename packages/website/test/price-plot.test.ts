import assert from "node:assert/strict";
import test from "node:test";
import {
  getPriceDomain,
  getPricePlotMarks,
  getPricePosition,
} from "../src/lib/price-plot";

const ordinary = {
  p5: 800000,
  p25: 1200000,
  median: 1500000,
  p75: 1800000,
  p95: 2200000,
};

test("shared axis contains every city's outer percentiles with outward padding", () => {
  const other = { ...ordinary, p5: 600000, p95: 5000000 };
  const domain = getPriceDomain([ordinary, other]);
  assert.ok(domain.min < other.p5);
  assert.ok(domain.max > other.p95);
  assert.equal(
    getPricePlotMarks(ordinary, domain).median,
    getPricePlotMarks(other, domain).median,
  );
  assert.ok(getPricePosition(other.p95, domain) < 1);
});

test("linear axis preserves relative distances", () => {
  const domain = getPriceDomain([ordinary]);
  const low = getPricePosition(1000000, domain);
  const middle = getPricePosition(1500000, domain);
  const high = getPricePosition(2000000, domain);
  assert.ok(Math.abs(middle - low - (high - middle)) < 1e-12);
});

test("equal five-number distribution has a nonempty axis and a single location", () => {
  const equal = {
    p5: 1000000,
    p25: 1000000,
    median: 1000000,
    p75: 1000000,
    p95: 1000000,
  };
  const domain = getPriceDomain([equal]);
  const marks = getPricePlotMarks(equal, domain);
  assert.ok(domain.min < equal.median && domain.max > equal.median);
  assert.equal(marks.coincident, true);
  assert.equal(marks.p5, marks.p25);
  assert.equal(marks.p25, marks.median);
  assert.equal(marks.median, marks.p75);
  assert.equal(marks.p75, marks.p95);
});

test("coincident central percentiles do not invent a box width", () => {
  const row = { ...ordinary, p25: 1500000, median: 1500000, p75: 1500000 };
  const marks = getPricePlotMarks(row, getPriceDomain([row]));
  assert.equal(marks.p25, marks.p75);
  assert.equal(marks.coincident, false);
  assert.ok(marks.p5 < marks.p95);
});

test("empty and invalid domains fail explicitly", () => {
  assert.throws(() => getPriceDomain([]));
  assert.throws(() => getPriceDomain([{ ...ordinary, p95: Infinity }]));
  assert.throws(() => getPricePosition(100, { min: 100, max: 100 }));
});
