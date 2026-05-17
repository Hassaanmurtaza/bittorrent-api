import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMagnet,
  humanSize,
  mapApibayResult,
  searchApibay
} from "../src/searchProviders/apibay.js";

test("buildMagnet: produces a valid magnet with name + trackers", () => {
  const m = buildMagnet("ABCDEF1234567890", "Some Name 2024");
  assert.ok(m.startsWith("magnet:?xt=urn:btih:ABCDEF1234567890"));
  assert.match(m, /dn=Some%20Name%202024/);
  assert.match(m, /tr=udp%3A%2F%2Ftracker\.opentrackr\.org/);
});

test("buildMagnet: returns null with no info_hash", () => {
  assert.equal(buildMagnet(null, "x"), null);
  assert.equal(buildMagnet("", "x"), null);
});

test("humanSize: bytes / KB / MB / GB", () => {
  assert.equal(humanSize(0), "");
  assert.equal(humanSize(1024), "1.0 KB");
  assert.equal(humanSize(1024 * 1024), "1.0 MB");
  assert.equal(humanSize(1.5 * 1024 ** 3), "1.5 GB");
  assert.equal(humanSize(10 * 1024 ** 3), "10 GB");
});

test("mapApibayResult: shape matches what the relay UI expects", () => {
  const out = mapApibayResult({
    id: "1",
    name: "Foo Bar 2024",
    info_hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    seeders: "100",
    leechers: "5",
    size: "1073741824",
    username: "Uploader",
    added: "1700000000"
  });
  assert.equal(out.name, "Foo Bar 2024");
  assert.equal(out.seeds, 100);
  assert.equal(out.leeches, 5);
  assert.equal(out.sizeBytes, 1073741824);
  assert.equal(out.sizeText, "1.0 GB");
  assert.equal(out.date, "2023-11-14");
  assert.equal(out.uploader, "Uploader");
  assert.ok(out.magnet.startsWith("magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
  assert.equal(out.detailUrl, "https://thepiratebay.org/description.php?id=1");
});

test("searchApibay: integrates against a stubbed fetch", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url.toString());
    assert.equal(u.host, "apibay.org");
    assert.equal(u.pathname, "/q.php");
    assert.equal(u.searchParams.get("q"), "batman v superman");
    assert.equal(u.searchParams.get("cat"), "201");
    const body = [
      {
        id: "1", name: "Batman v Superman 2016 1080p", info_hash: "AAAA1111AAAA1111AAAA1111AAAA1111AAAA1111",
        seeders: "500", leechers: "30", size: "2147483648", username: "X", added: "1717000000"
      },
      {
        id: "2", name: "Batman v Superman Ultimate", info_hash: "BBBB2222BBBB2222BBBB2222BBBB2222BBBB2222",
        seeders: "900", leechers: "50", size: "5368709120", username: "Y", added: "1715000000"
      },
      {
        id: "3", name: "Dead torrent", info_hash: "CCCC3333CCCC3333CCCC3333CCCC3333CCCC3333",
        seeders: "0", leechers: "1", size: "1048576", username: "Z", added: "1710000000"
      }
    ];
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  };
  try {
    const results = await searchApibay("batman v superman", { type: "movie", limit: 5 });
    assert.equal(results.length, 2); // dead one filtered
    assert.equal(results[0].seeds, 900); // sorted by seeds desc
    assert.equal(results[0].name, "Batman v Superman Ultimate");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("searchApibay: handles apibay's 'no results' sentinel", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "[]",
    json: async () => [
      { id: "0", name: "No results returned", info_hash: "0000000000000000000000000000000000000000",
        leechers: "0", seeders: "0", num_files: "0", size: "0", username: "", added: "0", status: "", category: "0", imdb: "" }
    ]
  });
  try {
    const results = await searchApibay("zzznothingzz", { type: "other", limit: 5 });
    assert.deepEqual(results, []);
  } finally {
    globalThis.fetch = origFetch;
  }
});
