import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRelayStore } from "../src/storage.js";

test("file relay store queues and removes items", async () => {
  const directory = await mkdtemp(join(tmpdir(), "torrent-api-"));
  try {
    const store = createRelayStore({
      queueFile: join(directory, "queue.json")
    });

    await store.push({ id: "one", links: ["magnet:?xt=urn:btih:abc"] });
    await store.push({ id: "two", links: ["https://example.com/file.torrent"] });

    assert.deepEqual(
      (await store.list()).map((item) => item.id),
      ["one", "two"]
    );
    assert.equal(await store.removeByIds(["one"]), 1);
    assert.deepEqual(
      (await store.list()).map((item) => item.id),
      ["two"]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("partial Redis relay storage config is rejected", () => {
  assert.throws(
    () => createRelayStore({ kvRestApiUrl: "https://example.com", queueFile: "queue.json" }),
    /Both KV_REST_API_URL and KV_REST_API_TOKEN/
  );
});
