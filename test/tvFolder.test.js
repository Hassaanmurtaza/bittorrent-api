import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeWindowsName,
  formatSeasonFolder,
  buildTvSavepath
} from "../src/tvFolder.js";

test("sanitizeWindowsName strips reserved chars", () => {
  assert.equal(sanitizeWindowsName('Marvel\'s: Daredevil?'), "Marvel's Daredevil");
});

test("sanitizeWindowsName collapses whitespace and strips trailing dots", () => {
  assert.equal(sanitizeWindowsName("  Lost   in   Space.  "), "Lost in Space");
});

test("sanitizeWindowsName handles null/empty", () => {
  assert.equal(sanitizeWindowsName(null), "");
  assert.equal(sanitizeWindowsName(""), "");
});

test("formatSeasonFolder zero-pads", () => {
  assert.equal(formatSeasonFolder(6), "Season 06");
  assert.equal(formatSeasonFolder(12), "Season 12");
  assert.equal(formatSeasonFolder(0), "Season 00");
});

test("formatSeasonFolder rejects bad inputs", () => {
  assert.equal(formatSeasonFolder(null), null);
  assert.equal(formatSeasonFolder(undefined), null);
  assert.equal(formatSeasonFolder("not a number"), null);
  assert.equal(formatSeasonFolder(-1), null);
});

test("buildTvSavepath: single season", () => {
  const p = buildTvSavepath({
    baseDir: "E:\\Downloads\\TV Shows",
    showName: "Black Clover",
    year: 2017,
    season: 6,
    isCompleteSeries: false
  });
  assert.equal(p, "E:\\Downloads\\TV Shows\\Black Clover (2017)\\Season 06");
});

test("buildTvSavepath: complete series stays at show root", () => {
  const p = buildTvSavepath({
    baseDir: "E:\\Downloads\\TV Shows",
    showName: "Breaking Bad",
    year: 2008,
    season: null,
    isCompleteSeries: true
  });
  assert.equal(p, "E:\\Downloads\\TV Shows\\Breaking Bad (2008)");
});

test("buildTvSavepath: missing season falls back to show root", () => {
  const p = buildTvSavepath({
    baseDir: "E:\\Downloads\\TV Shows",
    showName: "Some Anime",
    year: 2017,
    season: null,
    isCompleteSeries: false
  });
  assert.equal(p, "E:\\Downloads\\TV Shows\\Some Anime (2017)");
});

test("buildTvSavepath: no year produces a clean folder name", () => {
  const p = buildTvSavepath({
    baseDir: "E:\\Downloads\\TV Shows",
    showName: "Mystery Show",
    year: null,
    season: 1,
    isCompleteSeries: false
  });
  assert.equal(p, "E:\\Downloads\\TV Shows\\Mystery Show\\Season 01");
});

test("buildTvSavepath: sanitizes reserved characters in show name", () => {
  const p = buildTvSavepath({
    baseDir: "E:\\Downloads\\TV Shows",
    showName: 'Marvel\'s: Daredevil?',
    year: 2015,
    season: 3,
    isCompleteSeries: false
  });
  assert.equal(p, "E:\\Downloads\\TV Shows\\Marvel's Daredevil (2015)\\Season 03");
});

test("buildTvSavepath: falls back to baseDir if no show name", () => {
  const p = buildTvSavepath({
    baseDir: "E:\\Downloads\\TV Shows",
    showName: "",
    year: 2020,
    season: 1
  });
  assert.equal(p, "E:\\Downloads\\TV Shows");
});

test("buildTvSavepath: returns null with no baseDir", () => {
  assert.equal(
    buildTvSavepath({ baseDir: "", showName: "Foo", year: 2020, season: 1 }),
    null
  );
});
