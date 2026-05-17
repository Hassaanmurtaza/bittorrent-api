import test from "node:test";
import assert from "node:assert/strict";
import { humanSize, mapKnabenHit, searchKnaben } from "../src/searchProviders/knaben.js";

test("humanSize formats bytes correctly", () => {
  assert.equal(humanSize(0), "");
  assert.equal(humanSize(1024), "1.0 KB");
  assert.equal(humanSize(1024 * 1024), "1.0 MB");
  assert.equal(humanSize(3073907968), "2.9 GB");
});

test("mapKnabenHit: full hit with magnetUrl", () => {
  const out = mapKnabenHit({
    bytes: 3073907968,
    cachedOrigin: "1337x",
    category: "Movies / HD",
    categoryId: [3001000, 3000000],
    date: "2017-03-10T23:00:00+00:00",
    details: "https://1337x.to/torrent/2106497/Foo/",
    hash: "C4CF33A4F4827C1A1E1CCCCEB04CE01A8A115473",
    link: "https://knaben.org/live/dl/1337x/?path=...",
    magnetUrl: "magnet:?xt=urn:btih:C4CF33A4F4827C1A1E1CCCCEB04CE01A8A115473&dn=Foo",
    peers: 100,
    seeders: 628,
    title: "Batman v Superman: Dawn of Justice (2016) [1080p] [YTS] [YIFY]",
    tracker: "1337x",
    trackerId: "1337x"
  });
  assert.equal(out.name, "Batman v Superman: Dawn of Justice (2016) [1080p] [YTS] [YIFY]");
  assert.equal(out.seeds, 628);
  assert.equal(out.leeches, 100);
  assert.equal(out.sizeBytes, 3073907968);
  assert.equal(out.sizeText, "2.9 GB");
  assert.equal(out.date, "2017-03-10");
  assert.equal(out.uploader, "1337x");
  assert.equal(out.detailUrl, "https://1337x.to/torrent/2106497/Foo/");
  assert.ok(out.magnet.startsWith("magnet:?xt=urn:btih:C4CF33A4F4827"));
});

test("mapKnabenHit: falls back to link when magnetUrl is null", () => {
  const out = mapKnabenHit({
    bytes: 1000000,
    title: "Foo",
    seeders: 10,
    peers: 1,
    hash: "AAAA",
    magnetUrl: null,
    link: "https://knaben.org/live/dl/limetorrents/?path=abc",
    details: "https://limetorrents.example/foo.html",
    tracker: "LimeTorrents",
    date: "2024-09-26T00:18:35+00:00"
  });
  assert.equal(out.magnet, "https://knaben.org/live/dl/limetorrents/?path=abc");
  assert.equal(out.uploader, "LimeTorrents");
});

test("mapKnabenHit: returns null when both magnetUrl and link missing", () => {
  const out = mapKnabenHit({ title: "x", magnetUrl: null, link: null });
  assert.equal(out, null);
});

test("searchKnaben: integrates against stubbed fetch and de-dupes by info-hash", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.knaben.org/v1");
    assert.equal(init.method, "POST");
    const body = JSON.parse(init.body);
    assert.equal(body.query, "batman v superman");
    assert.equal(body.order_by, "seeders");
    assert.equal(body.order_direction, "desc");
    assert.equal(body.hide_unsafe, false);
    assert.equal(body.hide_xxx, true);
    assert.deepEqual(body.categories, [3000000]);
    const payload = {
      total: { value: 3 },
      hits: [
        { title: "BvS 1080p YIFY", seeders: 600, peers: 100,
          bytes: 2e9, magnetUrl: "magnet:?xt=urn:btih:AAAA1111&dn=A",
          hash: "AAAA1111", date: "2024-01-01", tracker: "1337x", details: "https://1337x/A" },
        { title: "BvS 1080p YIFY DUP", seeders: 500, peers: 50,
          bytes: 2e9, magnetUrl: "magnet:?xt=urn:btih:AAAA1111&dn=A_dup",
          hash: "AAAA1111", date: "2024-01-02", tracker: "TPB", details: "https://tpb/A" },
        { title: "BvS 4K BluRay", seeders: 400, peers: 30,
          bytes: 8e9, magnetUrl: "magnet:?xt=urn:btih:BBBB2222&dn=B",
          hash: "BBBB2222", date: "2024-03-01", tracker: "1337x", details: "https://1337x/B" }
      ]
    };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  try {
    const results = await searchKnaben("batman v superman", { type: "movie", limit: 10 });
    assert.equal(results.length, 2); // duplicate AAAA1111 dropped
    assert.equal(results[0].name, "BvS 1080p YIFY");
    assert.equal(results[1].name, "BvS 4K BluRay");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("searchKnaben: filters out 0-seed dead torrents", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      total: { value: 2 },
      hits: [
        { title: "alive", seeders: 5, peers: 0, bytes: 1e6,
          magnetUrl: "magnet:?xt=urn:btih:CC", hash: "CC", date: "2024-01-01", tracker: "x", details: "" },
        { title: "dead", seeders: 0, peers: 0, bytes: 1e6,
          magnetUrl: "magnet:?xt=urn:btih:DD", hash: "DD", date: "2024-01-01", tracker: "x", details: "" }
      ]
    }),
    text: async () => ""
  });
  try {
    const results = await searchKnaben("anything", { type: "other", limit: 10 });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "alive");
  } finally {
    globalThis.fetch = origFetch;
  }
});
test("searchKnaben: sortBy=size sorts by size desc with seeders as tiebreak", async () => {
  const origFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({
      total: { value: 3 },
      hits: [
        { title: "Big A 600s", seeders: 600, peers: 10, bytes: 8e9,
          magnetUrl: "magnet:?xt=urn:btih:AA", hash: "AA", tracker: "1337x", details: "" },
        { title: "Big B 100s", seeders: 100, peers: 5, bytes: 8e9,
          magnetUrl: "magnet:?xt=urn:btih:BB", hash: "BB", tracker: "tpb", details: "" },
        { title: "Smol 1000s", seeders: 1000, peers: 50, bytes: 1e9,
          magnetUrl: "magnet:?xt=urn:btih:CC", hash: "CC", tracker: "yts", details: "" }
      ]
    }), text: async () => "" };
  };
  try {
    const results = await searchKnaben("x", { type: "movie", limit: 10, sortBy: "size" });
    assert.equal(capturedBody.order_by, "bytes");
    assert.equal(results[0].name, "Big A 600s"); // size 8GB, seeders 600
    assert.equal(results[1].name, "Big B 100s"); // size 8GB, seeders 100 (tiebreak)
    assert.equal(results[2].name, "Smol 1000s"); // size 1GB last
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("searchKnaben: sortBy=seeders is the default and uses leechers as tiebreak", async () => {
  const origFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({
      total: { value: 3 },
      hits: [
        { title: "Tied 100/5",  seeders: 100, peers: 5,  bytes: 1e9,
          magnetUrl: "magnet:?xt=urn:btih:AA", hash: "AA", tracker: "x", details: "" },
        { title: "Tied 100/20", seeders: 100, peers: 20, bytes: 1e9,
          magnetUrl: "magnet:?xt=urn:btih:BB", hash: "BB", tracker: "x", details: "" },
        { title: "Lower 50",    seeders: 50,  peers: 99, bytes: 9e9,
          magnetUrl: "magnet:?xt=urn:btih:CC", hash: "CC", tracker: "x", details: "" }
      ]
    }), text: async () => "" };
  };
  try {
    const results = await searchKnaben("x", { type: "movie", limit: 10 });
    assert.equal(capturedBody.order_by, "seeders");
    assert.equal(results[0].name, "Tied 100/20"); // higher leech tiebreak
    assert.equal(results[1].name, "Tied 100/5");
    assert.equal(results[2].name, "Lower 50");
  } finally {
    globalThis.fetch = origFetch;
  }
});
test("searchKnaben: sortBy=date sorts by date desc with seeders as tiebreak", async () => {
  const origFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({
      total: { value: 3 },
      hits: [
        { title: "Old 1000s", seeders: 1000, peers: 0, bytes: 1e9,
          magnetUrl: "magnet:?xt=urn:btih:AA", hash: "AA", tracker: "x", details: "",
          date: "2020-01-15T00:00:00+00:00" },
        { title: "Fresh A 100s", seeders: 100, peers: 0, bytes: 1e9,
          magnetUrl: "magnet:?xt=urn:btih:BB", hash: "BB", tracker: "x", details: "",
          date: "2025-06-01T00:00:00+00:00" },
        { title: "Fresh B 500s", seeders: 500, peers: 0, bytes: 1e9,
          magnetUrl: "magnet:?xt=urn:btih:CC", hash: "CC", tracker: "x", details: "",
          date: "2025-06-01T00:00:00+00:00" }
      ]
    }), text: async () => "" };
  };
  try {
    const results = await searchKnaben("x", { type: "movie", limit: 10, sortBy: "date" });
    assert.equal(capturedBody.order_by, "date");
    assert.equal(results[0].name, "Fresh B 500s"); // same date as B, higher seeds wins
    assert.equal(results[1].name, "Fresh A 100s");
    assert.equal(results[2].name, "Old 1000s");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("searchKnaben: game type sends the games category", async () => {
  const origFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ total: { value: 0 }, hits: [] }), text: async () => "" };
  };
  try {
    await searchKnaben("doom", { type: "game", limit: 10 });
    assert.deepEqual(capturedBody.categories, [4000000]);
  } finally {
    globalThis.fetch = origFetch;
  }
});
