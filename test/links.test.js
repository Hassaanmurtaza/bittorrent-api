import test from "node:test";
import assert from "node:assert/strict";
import { extractSupportedLinks, hasUnsupportedWebUrl } from "../src/links.js";

test("extracts magnet links", () => {
  const links = extractSupportedLinks("open magnet:?xt=urn:btih:abc123&dn=example");
  assert.deepEqual(links, ["magnet:?xt=urn:btih:abc123&dn=example"]);
});

test("extracts direct torrent URLs", () => {
  const links = extractSupportedLinks("https://example.com/file.torrent?download=1");
  assert.deepEqual(links, ["https://example.com/file.torrent?download=1"]);
});

test("ignores ordinary web pages", () => {
  assert.deepEqual(extractSupportedLinks("https://1337x.st/torrent/example"), []);
  assert.equal(hasUnsupportedWebUrl("https://1337x.st/torrent/example"), true);
});
