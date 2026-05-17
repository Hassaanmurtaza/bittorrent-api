import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LEARNING,
  EMA_ALPHA,
  MIN_SAMPLES_FOR_LEARNED,
  updateLearning,
  effectivePerSeedMbps,
  summarizeLearning
} from "../src/learning.js";

test("default learning is empty / not trusted", () => {
  assert.equal(DEFAULT_LEARNING.perSeedMbps, null);
  assert.equal(DEFAULT_LEARNING.perSeedSamples, 0);
  const sum = summarizeLearning(DEFAULT_LEARNING);
  assert.equal(sum.trusted, false);
});

test("updateLearning: first sample becomes the initial value", () => {
  const next = updateLearning(DEFAULT_LEARNING, [
    { state: "downloading", dlspeed: 100e6 /* 100 MB/s */, numSeeds: 10 }
  ]);
  // 100MB/s * 8 / 10 seeds / 1e6 = 80 Mbps per seed
  assert.equal(Math.round(next.perSeedMbps), 80);
  assert.equal(next.perSeedSamples, 1);
});

test("updateLearning: subsequent samples blend via EMA", () => {
  let learning = updateLearning(DEFAULT_LEARNING, [
    { state: "downloading", dlspeed: 100e6, numSeeds: 10 } // -> 80
  ]);
  // Feed many samples at 8 Mbps/seed; EMA should drift toward 8.
  for (let i = 0; i < 200; i++) {
    learning = updateLearning(learning, [
      { state: "downloading", dlspeed: 8e6, numSeeds: 1 } // -> 64 Mbps/seed actually
    ]);
  }
  // 1 seed * 8 Mbps = 64 Mbps per seed for a 1-seed torrent at 8 MB/s.
  // Sanity: should converge close to 64 (between 60 and 70).
  assert.ok(learning.perSeedMbps > 60 && learning.perSeedMbps < 70);
});

test("updateLearning: skips torrents that aren't downloading", () => {
  const next = updateLearning(DEFAULT_LEARNING, [
    { state: "uploading", dlspeed: 100e6, numSeeds: 10 },
    { state: "stalledDL", dlspeed: 0, numSeeds: 5 }
  ]);
  assert.equal(next.perSeedMbps, null);
  assert.equal(next.perSeedSamples, 0);
});

test("updateLearning: skips torrents below noise floor", () => {
  // 100 KB/s = 800,000 bps, which is below MIN_DLSPEED_BPS=500_000... wait actually 800K > 500K so it'd count
  const next = updateLearning(DEFAULT_LEARNING, [
    { state: "downloading", dlspeed: 100e3 /* 100 KB/s = 800 kbps */, numSeeds: 5 }
  ]);
  // 100,000 bps < 500,000 noise floor → skipped
  assert.equal(next.perSeedMbps, null);
});

test("updateLearning: tracks peak total swarm bandwidth", () => {
  let learning = updateLearning(DEFAULT_LEARNING, [
    { state: "downloading", dlspeed: 50e6, numSeeds: 10 },
    { state: "downloading", dlspeed: 30e6, numSeeds: 5 }
  ]);
  // total dlspeed = 80 MB/s = 640 Mbps
  assert.equal(Math.round(learning.totalMbpsObservedMax), 640);
  // A smaller subsequent snapshot should NOT reduce the max
  learning = updateLearning(learning, [
    { state: "downloading", dlspeed: 10e6, numSeeds: 5 }
  ]);
  assert.equal(Math.round(learning.totalMbpsObservedMax), 640);
});

test("effectivePerSeedMbps: falls back until threshold reached", () => {
  const fallback = 8;
  const small = { perSeedMbps: 50, perSeedSamples: 5 };
  assert.equal(effectivePerSeedMbps(small, fallback), fallback);
  const big = { perSeedMbps: 50, perSeedSamples: MIN_SAMPLES_FOR_LEARNED };
  assert.equal(effectivePerSeedMbps(big, fallback), 50);
});

test("summarizeLearning: rounds and reports trust", () => {
  const sum = summarizeLearning({
    perSeedMbps: 12.345,
    perSeedSamples: 100,
    totalMbpsObservedMax: 1234.567
  });
  assert.equal(sum.perSeedMbps, 12.3);
  assert.equal(sum.samples, 100);
  assert.equal(sum.trusted, true);
  assert.equal(sum.totalMbpsObservedMax, 1234.6);
});
