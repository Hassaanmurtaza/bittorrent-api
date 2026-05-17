import test from "node:test";
import assert from "node:assert/strict";
import { formatDuration, computeEta, annotateEta } from "../src/eta.js";

test("formatDuration: handles all magnitudes", () => {
  assert.equal(formatDuration(0), "—");
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDuration(-5), "—");
  assert.equal(formatDuration(30), "<1m");
  assert.equal(formatDuration(60), "1m");
  assert.equal(formatDuration(45 * 60), "45m");
  assert.equal(formatDuration(60 * 60), "1h 0m");
  assert.equal(formatDuration(90 * 60), "1h 30m");
  assert.equal(formatDuration(2 * 24 * 3600 + 5 * 3600), "2d 5h");
  assert.equal(formatDuration(60 * 24 * 3600), "60d+");
});

test("computeEta: caps at connection bandwidth when swarm is huge", () => {
  // 1000 seeds * 8 Mbps = 8 Gbps swarm, but downlink is 2350 Mbps.
  const out = computeEta(2 * 1024 ** 3 /* 2 GiB */, 1000, 2350, 8);
  assert.equal(out.effectiveMbps, 2350);
  assert.ok(out.etaSeconds > 0);
  assert.ok(out.etaSeconds < 30); // ~7-8s at 2350 Mbps
});

test("computeEta: limited by swarm when seeds are few", () => {
  // 3 seeds * 8 Mbps = 24 Mbps, well under 2350.
  const out = computeEta(1 * 1024 ** 3 /* 1 GiB */, 3, 2350, 8);
  assert.equal(out.effectiveMbps, 24);
  // 1 GiB / (24/8 MB/s) = 1073741824 / 3000000 ≈ 358 s
  assert.ok(out.etaSeconds > 300 && out.etaSeconds < 400);
});

test("computeEta: dead torrent returns null eta", () => {
  const out = computeEta(1024, 0, 2350, 8);
  assert.equal(out.etaSeconds, null);
  assert.equal(out.bytesPerSec, 0);
});

test("annotateEta: adds fields, preserves the rest", () => {
  const orig = { name: "x", seeds: 100, leeches: 5, sizeBytes: 1024 ** 3, sizeText: "1.0 GB", magnet: "magnet:..." };
  const out = annotateEta(orig, 2350, 8);
  assert.equal(out.name, "x");
  assert.equal(out.magnet, "magnet:...");
  assert.equal(typeof out.etaSeconds, "number");
  assert.equal(typeof out.etaText, "string");
  assert.ok(out.etaText.length > 0);
  assert.ok(out.estimatedMBps > 0);
});

test("annotateEta: dead torrent gets em-dash text", () => {
  const orig = { name: "dead", seeds: 0, sizeBytes: 1e9 };
  const out = annotateEta(orig, 2350, 8);
  assert.equal(out.etaText, "—");
  assert.equal(out.estimatedMBps, 0);
});
import { computeEtaRange, formatEtaRange } from "../src/eta.js";

test("computeEtaRange: fast end is shorter than slow end", () => {
  const { fast, slow } = computeEtaRange(1 * 1024 ** 3, 10, 2350, 8);
  assert.ok(fast.etaSeconds < slow.etaSeconds);
});

test("formatEtaRange: returns single value when fast == slow", () => {
  assert.equal(formatEtaRange(60, 60), "1m");
});

test("formatEtaRange: returns fast – slow with en-dash", () => {
  assert.equal(formatEtaRange(60, 600), "1m – 10m");
});

test("formatEtaRange: returns em-dash for dead torrent", () => {
  assert.equal(formatEtaRange(null, null), "—");
});

test("annotateEta: result contains etaRangeText", () => {
  const out = annotateEta({ name: "x", seeds: 5, sizeBytes: 1e9 }, 2350, 8);
  assert.equal(typeof out.etaRangeText, "string");
  assert.ok(out.etaRangeText.length > 0);
});
