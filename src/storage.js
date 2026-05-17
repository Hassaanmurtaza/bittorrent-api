import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export function createRelayStore(config) {
  if (config.kvRestApiUrl || config.kvRestApiToken) {
    if (!config.kvRestApiUrl || !config.kvRestApiToken) {
      throw new Error("Both KV_REST_API_URL and KV_REST_API_TOKEN are required for Redis relay storage.");
    }

    return new RedisRelayStore(config);
  }

  return new FileRelayStore(config);
}

class FileRelayStore {
  constructor(config) {
    this.queueFile = config.queueFile;
  }

  async list() {
    if (!existsSync(this.queueFile)) {
      return [];
    }

    const content = await readFile(this.queueFile, "utf8");
    if (!content.trim()) {
      return [];
    }

    return JSON.parse(content);
  }

  async push(item) {
    const queue = await this.list();
    queue.push(item);
    await writeFile(this.queueFile, JSON.stringify(queue, null, 2), "utf8");
    return item;
  }

  async removeByIds(ids) {
    const idSet = new Set(ids);
    const queue = await this.list();
    const remaining = queue.filter((item) => !idSet.has(item.id));
    await writeFile(this.queueFile, JSON.stringify(remaining, null, 2), "utf8");
    return queue.length - remaining.length;
  }
}

class RedisRelayStore {
  constructor(config) {
    this.url = config.kvRestApiUrl.replace(/\/+$/g, "");
    this.token = config.kvRestApiToken;
    this.key = config.queueKey;
  }

  async command(args) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(args)
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      throw new Error(body.error || `Redis command failed: ${response.status}`);
    }

    return body.result;
  }

  async list() {
    const items = await this.command(["LRANGE", this.key, "0", "-1"]);
    return Array.isArray(items) ? items.map((item) => JSON.parse(item)) : [];
  }

  async push(item) {
    await this.command(["RPUSH", this.key, JSON.stringify(item)]);
    return item;
  }

  async removeByIds(ids) {
    const idSet = new Set(ids);
    const items = await this.command(["LRANGE", this.key, "0", "-1"]);
    if (!Array.isArray(items) || items.length === 0) {
      return 0;
    }

    let removed = 0;
    for (const serialized of items) {
      const item = JSON.parse(serialized);
      if (idSet.has(item.id)) {
        const count = await this.command(["LREM", this.key, "0", serialized]);
        removed += Number(count || 0);
      }
    }

    return removed;
  }
}
