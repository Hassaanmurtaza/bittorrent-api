import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const DEFAULT_SEARCH_RESULT_TTL_SECONDS = 600;

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
    this.searchJobsFile = config.searchJobsFile || "relay-search-jobs.json";
    this.searchResultsFile = config.searchResultsFile || "relay-search-results.json";
    this.torrentsStatusFile = config.torrentsStatusFile || "relay-torrents-status.json";
    this.deleteJobsFile = config.deleteJobsFile || "relay-delete-jobs.json";
    this.learningFile = config.learningRelayFile || "relay-learning-store.json";
  }

  async _readJson(file) {
    if (!existsSync(file)) return null;
    const content = await readFile(file, "utf8");
    if (!content.trim()) return null;
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async _writeJson(file, value) {
    await writeFile(file, JSON.stringify(value, null, 2), "utf8");
  }

  async list() {
    const queue = await this._readJson(this.queueFile);
    return Array.isArray(queue) ? queue : [];
  }

  async push(item) {
    const queue = await this.list();
    queue.push(item);
    await this._writeJson(this.queueFile, queue);
    return item;
  }

  async removeByIds(ids) {
    const idSet = new Set(ids);
    const queue = await this.list();
    const remaining = queue.filter((item) => !idSet.has(item.id));
    await this._writeJson(this.queueFile, remaining);
    return queue.length - remaining.length;
  }

  // --- Search-job queue (FIFO) ------------------------------------------

  async pushSearchJob(job) {
    const jobs = (await this._readJson(this.searchJobsFile)) || [];
    jobs.push(job);
    await this._writeJson(this.searchJobsFile, jobs);
    return job;
  }

  async popSearchJob() {
    const jobs = (await this._readJson(this.searchJobsFile)) || [];
    if (jobs.length === 0) return null;
    const next = jobs.shift();
    await this._writeJson(this.searchJobsFile, jobs);
    return next;
  }

  // --- Search results KV (with TTL) -------------------------------------

  async _readResultsMap() {
    const map = (await this._readJson(this.searchResultsFile)) || {};
    // Drop expired keys lazily on read.
    const now = Date.now();
    for (const [k, v] of Object.entries(map)) {
      if (v && v.expiresAt && v.expiresAt < now) delete map[k];
    }
    return map;
  }

  async setSearchResult(jobId, payload, ttlSeconds = DEFAULT_SEARCH_RESULT_TTL_SECONDS) {
    const map = await this._readResultsMap();
    map[jobId] = { ...payload, expiresAt: Date.now() + ttlSeconds * 1000 };
    await this._writeJson(this.searchResultsFile, map);
  }

  async getSearchResult(jobId) {
    const map = await this._readResultsMap();
    const entry = map[jobId] || null;
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) return null;
    const { expiresAt, ...rest } = entry;
    return rest;
  }

  // --- Torrents status snapshot (with TTL) ------------------------------

  async setTorrentsStatus(payload, ttlSeconds = 60) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    await this._writeJson(this.torrentsStatusFile, { ...payload, expiresAt });
  }

  async getTorrentsStatus() {
    const data = await this._readJson(this.torrentsStatusFile);
    if (!data) return null;
    if (data.expiresAt && data.expiresAt < Date.now()) return null;
    const { expiresAt, ...rest } = data;
    return rest;
  }

  // --- Torrent-delete job queue ----------------------------------------

  async pushDeleteJob(job) {
    const jobs = (await this._readJson(this.deleteJobsFile)) || [];
    jobs.push(job);
    await this._writeJson(this.deleteJobsFile, jobs);
    return job;
  }

  async popDeleteJob() {
    const jobs = (await this._readJson(this.deleteJobsFile)) || [];
    if (jobs.length === 0) return null;
    const next = jobs.shift();
    await this._writeJson(this.deleteJobsFile, jobs);
    return next;
  }

  // --- Learned ETA model (no TTL) --------------------------------------

  async setLearning(payload) {
    if (!payload || typeof payload !== "object") return;
    await this._writeJson(this.learningFile, payload);
  }

  async getLearning() {
    return await this._readJson(this.learningFile);
  }
}

class RedisRelayStore {
  constructor(config) {
    this.url = config.kvRestApiUrl.replace(/\/+$/g, "");
    this.token = config.kvRestApiToken;
    this.key = config.queueKey;
    this.searchJobsKey = `${config.queueKey}:search:jobs`;
    this.searchResultPrefix = `${config.queueKey}:search:result:`;
    this.torrentsStatusKey = `${config.queueKey}:torrents:status`;
    this.deleteJobsKey = `${config.queueKey}:torrents:delete:jobs`;
    this.learningKey = `${config.queueKey}:learning`;
  }

  async command(args) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
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

  // --- Search-job queue -------------------------------------------------

  async pushSearchJob(job) {
    await this.command(["RPUSH", this.searchJobsKey, JSON.stringify(job)]);
    return job;
  }

  async popSearchJob() {
    const raw = await this.command(["LPOP", this.searchJobsKey]);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // --- Search results KV ------------------------------------------------

  async setSearchResult(jobId, payload, ttlSeconds = DEFAULT_SEARCH_RESULT_TTL_SECONDS) {
    const key = `${this.searchResultPrefix}${jobId}`;
    await this.command([
      "SET",
      key,
      JSON.stringify(payload),
      "EX",
      String(Math.max(1, Number(ttlSeconds) || DEFAULT_SEARCH_RESULT_TTL_SECONDS))
    ]);
  }

  async getSearchResult(jobId) {
    const raw = await this.command(["GET", `${this.searchResultPrefix}${jobId}`]);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // --- Torrents status snapshot ----------------------------------------

  async setTorrentsStatus(payload, ttlSeconds = 60) {
    await this.command([
      "SET",
      this.torrentsStatusKey,
      JSON.stringify(payload),
      "EX",
      String(Math.max(1, Number(ttlSeconds) || 60))
    ]);
  }

  async getTorrentsStatus() {
    const raw = await this.command(["GET", this.torrentsStatusKey]);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // --- Torrent-delete job queue ----------------------------------------

  async pushDeleteJob(job) {
    await this.command(["RPUSH", this.deleteJobsKey, JSON.stringify(job)]);
    return job;
  }

  async popDeleteJob() {
    const raw = await this.command(["LPOP", this.deleteJobsKey]);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // --- Learned ETA model (no TTL) --------------------------------------

  async setLearning(payload) {
    if (!payload || typeof payload !== "object") return;
    await this.command(["SET", this.learningKey, JSON.stringify(payload)]);
  }

  async getLearning() {
    const raw = await this.command(["GET", this.learningKey]);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
}
