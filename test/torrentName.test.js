import test from "node:test";
import assert from "node:assert/strict";
import { parseDisplayName, parseSeriesInfo } from "../src/torrentName.js";

test("parseDisplayName reads dn= from a magnet", () => {
  const dn = parseDisplayName(
    "magnet:?xt=urn:btih:abc&dn=Black.Clover.S06.1080p.WEB-DL&tr=udp%3A%2F%2Ftracker"
  );
  assert.equal(dn, "Black.Clover.S06.1080p.WEB-DL");
});

test("parseDisplayName returns null when magnet has no dn", () => {
  assert.equal(parseDisplayName("magnet:?xt=urn:btih:abc"), null);
});

test("parseDisplayName falls back to the .torrent basename", () => {
  assert.equal(
    parseDisplayName("https://example.com/files/Black.Clover.S06E01.720p.torrent?dl=1"),
    "Black.Clover.S06E01.720p"
  );
});

test("parseDisplayName handles non-strings and garbage", () => {
  assert.equal(parseDisplayName(null), null);
  assert.equal(parseDisplayName(""), null);
  assert.equal(parseDisplayName("not a url"), null);
});

test("parseSeriesInfo extracts title and season for SxxExx", () => {
  const info = parseSeriesInfo("Black.Clover.S06E12.1080p.WEB-DL.x265-GROUP");
  assert.equal(info.title, "Black Clover");
  assert.equal(info.season, 6);
  assert.equal(info.isCompleteSeries, false);
});

test("parseSeriesInfo extracts title and season for season-pack Sxx", () => {
  const info = parseSeriesInfo("Black.Clover.S06.1080p.WEB-DL");
  assert.equal(info.title, "Black Clover");
  assert.equal(info.season, 6);
  assert.equal(info.isCompleteSeries, false);
});

test("parseSeriesInfo handles 'Season 6' wording", () => {
  const info = parseSeriesInfo("Black Clover Season 6 1080p WEB-DL");
  assert.equal(info.title, "Black Clover");
  assert.equal(info.season, 6);
});

test("parseSeriesInfo handles NxNN notation", () => {
  const info = parseSeriesInfo("Some.Show.6x12.HDTV");
  assert.equal(info.title, "Some Show");
  assert.equal(info.season, 6);
});

test("parseSeriesInfo strips a leading bracket group prefix (anime absolute)", () => {
  // Anime absolute numbering: we cannot pull a season number out of '042'.
  // What we *can* do is trim the leading [SubsPlease] and the trailing
  // "- 042 [1080p].mkv" off the title.
  const info = parseSeriesInfo("[SubsPlease] Black Clover - 042 [1080p].mkv");
  assert.equal(info.title, "Black Clover");
  assert.equal(info.season, null);
  assert.equal(info.isCompleteSeries, false);
});

test("parseSeriesInfo detects a complete-series pack", () => {
  const info = parseSeriesInfo("Breaking.Bad.Complete.Series.1080p.BluRay");
  assert.equal(info.title, "Breaking Bad");
  assert.equal(info.isCompleteSeries, true);
});

test("parseSeriesInfo detects S01-S05 range", () => {
  const info = parseSeriesInfo("Mad.Men.S01-S07.1080p.WEB-DL");
  assert.equal(info.title, "Mad Men");
  assert.equal(info.isCompleteSeries, true);
});

test("parseSeriesInfo detects 'Seasons 1-4' range", () => {
  const info = parseSeriesInfo("The Office Seasons 1-9 1080p WEB-DL");
  assert.equal(info.title, "The Office");
  assert.equal(info.isCompleteSeries, true);
});

test("parseSeriesInfo handles a movie-style release name (no season)", () => {
  const info = parseSeriesInfo("Inception.2010.1080p.BluRay.x264-GROUP");
  assert.equal(info.title, "Inception");
  assert.equal(info.season, null);
  assert.equal(info.isCompleteSeries, false);
});

test("parseSeriesInfo returns empty info for empty/garbage input", () => {
  assert.deepEqual(parseSeriesInfo(""), { title: null, season: null, isCompleteSeries: false });
  assert.deepEqual(parseSeriesInfo(null), { title: null, season: null, isCompleteSeries: false });
});
