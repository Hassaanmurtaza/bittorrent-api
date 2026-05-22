import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { addToQbittorrent, getTorrents, deleteTorrents } from "./src/qbittorrent.js";
import { TmdbClient } from "./src/tmdb.js";
import { parseDisplayName, parseSeriesInfo } from "./src/torrentName.js";
import { buildTvSavepath } from "./src/tvFolder.js";
import { search1337x } from "./src/searchProviders/x1337.js";
import { searchApibay } from "./src/searchProviders/apibay.js";
import { searchKnaben } from "./src/searchProviders/knaben.js";
import { annotateEta } from "./src/eta.js";
import {
  DEFAULT_LEARNING,
  updateLearning,
  effectivePerSeedMbps,
  summarizeLearning
} from "./src/learning.js";

const DEFAULT_CONFIG = {
  qbittorrentUrl: "http://127.0.0.1:8080",
  username: "admin",
  password: "adminadmin",
  defaultCategory: "",
  startPaused: false,
  relayUrl: "",
  relayToken: "",
  // Eco defaults — kept slow so we don't burn through Upstash's 500K
  // commands/month free tier. Each loop hits Redis once per tick, so the
  // intervals below cap us at roughly:
  //   torrents : 1440/day (60s)
  //   search   : 2880/day idle, 5760/day active (15s/30s adaptive)
  //   status   : 5760/day active, 720/day idle (15s/120s adaptive)
  // Plus we skip the status SET when the snapshot fingerprint hasn't
  // changed and only persist `learning` when sample count increased.
  pollIntervalSeconds: 60,
  pollSearchIntervalSeconds: 15,
  pollSearchIdleIntervalSeconds: 30,
  pushStatsIntervalSeconds: 15,
  pushStatsIdleIntervalSeconds: 120,
  savePaths: {
    movie: "E:\\Downloads\\Movies",
    tvshow: "E:\\Downloads\\TV Shows",
    game: "E:\\Downloads\\Games",
    other: "E:\\Downloads\\Others"
  },
  tmdb: {
    apiReadToken: "",
    apiKey: "",
    language: "en-CA"
  },
  tvShowOverrides: {},
  searchProvider: "knaben",
  bandwidth: { downloadMbps: 2350, perSeedMbps: 8 },
  learningFile: "relay-learning.json"
};

async function loadConfig() {
  const fileConfig = existsSync("config.json")
    ? JSON.parse(await readFile("config.json", "utf8"))
    : {};

  const fileTmdb = fileConfig.tmdb || {};
  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    qbittorrentUrl: process.env.QB_URL || fileConfig.qbittorrentUrl || DEFAULT_CONFIG.qbittorrentUrl,
    username: process.env.QB_USER || fileConfig.username || DEFAULT_CONFIG.username,
    password: process.env.QB_PASS || fileConfig.password || DEFAULT_CONFIG.password,
    relayUrl: process.env.RELAY_URL || fileConfig.relayUrl || "",
    relayToken: process.env.RELAY_TOKEN || fileConfig.relayToken || "",
    pollIntervalSeconds: Number(
      process.env.POLL_INTERVAL_SECONDS ||
        fileConfig.pollIntervalSeconds ||
        DEFAULT_CONFIG.pollIntervalSeconds
    ),
    pollSearchIntervalSeconds: Number(
      process.env.POLL_SEARCH_INTERVAL_SECONDS ||
        fileConfig.pollSearchIntervalSeconds ||
        DEFAULT_CONFIG.pollSearchIntervalSeconds
    ),
    pollSearchIdleIntervalSeconds: Number(
      process.env.POLL_SEARCH_IDLE_INTERVAL_SECONDS ||
        fileConfig.pollSearchIdleIntervalSeconds ||
        DEFAULT_CONFIG.pollSearchIdleIntervalSeconds
    ),
    pushStatsIntervalSeconds: Number(
      process.env.PUSH_STATS_INTERVAL_SECONDS ||
        fileConfig.pushStatsIntervalSeconds ||
        DEFAULT_CONFIG.pushStatsIntervalSeconds
    ),
    pushStatsIdleIntervalSeconds: Number(
      process.env.PUSH_STATS_IDLE_INTERVAL_SECONDS ||
        fileConfig.pushStatsIdleIntervalSeconds ||
        DEFAULT_CONFIG.pushStatsIdleIntervalSeconds
    ),
    savePaths: {
      ...DEFAULT_CONFIG.savePaths,
      ...(fileConfig.savePaths || {})
    },
    tmdb: {
      ...DEFAULT_CONFIG.tmdb,
      ...fileTmdb,
      apiReadToken:
        process.env.TMDB_READ_TOKEN || fileTmdb.apiReadToken || DEFAULT_CONFIG.tmdb.apiReadToken,
      apiKey: process.env.TMDB_API_KEY || fileTmdb.apiKey || DEFAULT_CONFIG.tmdb.apiKey,
      language: process.env.TMDB_LANGUAGE || fileTmdb.language || DEFAULT_CONFIG.tmdb.language
    },
    tvShowOverrides: {
      ...DEFAULT_CONFIG.tvShowOverrides,
      ...(fileConfig.tvShowOverrides || {})
    },
    searchProvider: (process.env.SEARCH_PROVIDER || fileConfig.searchProvider || DEFAULT_CONFIG.searchProvider).toLowerCase(),
    bandwidth: {
      ...DEFAULT_CONFIG.bandwidth,
      ...(fileConfig.bandwidth || {})
    },
    learningFile: process.env.LEARNING_FILE || fileConfig.learningFile || DEFAULT_CONFIG.learningFile
  };
}

async function loadLearningFromRelay(config) {
  try {
    const r = await fetch(relayEndpoint(config, "/api/relay/learning"), {
      headers: { "x-relay-token": config.relayToken }
    });
    if (!r.ok) return null;
    const body = await r.json();
    if (body && typeof body === "object" && body.perSeedSamples !== undefined) {
      return { ...DEFAULT_LEARNING, ...body };
    }
    return null;
  } catch {
    return null;
  }
}

async function loadLearningFromFile(file) {
  try {
    const text = await readFile(file, "utf8");
    const data = JSON.parse(text);
    return { ...DEFAULT_LEARNING, ...data };
  } catch {
    return null;
  }
}

function resolveSavePath(config, type) {
  const paths = config.savePaths || DEFAULT_CONFIG.savePaths;
  if (type === "movie" && paths.movie) return paths.movie;
  if (type === "tvshow" && paths.tvshow) return paths.tvshow;
  if (type === "game" && paths.game) return paths.game;
  return paths.other || DEFAULT_CONFIG.savePaths.other;
}

function firstDisplayName(links) {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const name = parseDisplayName(link);
    if (name) return name;
  }
  return null;
}

function readOverride(overrides, title) {
  if (!overrides || !title) return { tmdbId: null, defaultSeason: null };
  const raw = overrides[title.toLowerCase()];
  if (raw === undefined || raw === null) return { tmdbId: null, defaultSeason: null };
  if (typeof raw === "number" || typeof raw === "string") {
    return { tmdbId: raw, defaultSeason: null };
  }
  if (typeof raw === "object") {
    const ds = raw.defaultSeason;
    const normalizedDs = ds === null || ds === undefined || ds === "" ? null : Number(ds);
    return {
      tmdbId: raw.tmdbId !== undefined && raw.tmdbId !== null ? raw.tmdbId : null,
      defaultSeason: Number.isFinite(normalizedDs) ? normalizedDs : null
    };
  }
  return { tmdbId: null, defaultSeason: null };
}

function buildLabel(show, effectiveSeason, isCompleteSeries, usedDefaultSeason) {
  let label = show.name;
  if (show.year) label += " (" + show.year + ")";
  if (isCompleteSeries) {
    label += " [complete series]";
  } else if (effectiveSeason !== null && effectiveSeason !== undefined) {
    const tag = usedDefaultSeason ? " [default]" : "";
    label += " S" + String(effectiveSeason).padStart(2, "0") + tag;
  }
  return label;
}

async function planTvShow(item, config, tmdb) {
  const baseDir = resolveSavePath(config, "tvshow");
  const fallback = { savepath: baseDir, contentLayout: undefined, label: "unresolved" };

  const dn = firstDisplayName(item.links);
  if (!dn) return fallback;

  const info = parseSeriesInfo(dn);
  if (!info.title) return fallback;

  const { tmdbId: overrideId, defaultSeason } = readOverride(config.tvShowOverrides, info.title);

  let show = null;
  try {
    if (overrideId) {
      show = await tmdb.lookupTvById(overrideId);
    } else if (tmdb.isConfigured()) {
      show = await tmdb.lookupTv(info.title);
    }
  } catch (error) {
    console.error("TMDB lookup failed for " + info.title + ": " + error.message);
    return fallback;
  }

  if (!show || !show.name) return fallback;

  const usedDefaultSeason = info.season === null && defaultSeason !== null && !info.isCompleteSeries;
  const effectiveSeason = info.season !== null ? info.season : (info.isCompleteSeries ? null : defaultSeason);

  const savepath = buildTvSavepath({
    baseDir,
    showName: show.name,
    year: show.year,
    season: effectiveSeason,
    isCompleteSeries: info.isCompleteSeries
  });

  return {
    savepath,
    contentLayout: "NoSubfolder",
    label: buildLabel(show, effectiveSeason, info.isCompleteSeries, usedDefaultSeason)
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function relayEndpoint(config, path) {
  const base = config.relayUrl.replace(/\/+$/g, "");
  return base + path;
}

async function pollTorrents(config) {
  const response = await fetch(relayEndpoint(config, "/api/relay/poll"), {
    headers: { "x-relay-token": config.relayToken }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Relay poll failed: " + response.status);
  }

  return body.items || [];
}

async function ackTorrents(config, ids) {
  if (ids.length === 0) return;
  const response = await fetch(relayEndpoint(config, "/api/relay/ack"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relay-token": config.relayToken
    },
    body: JSON.stringify({ ids })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Relay ack failed: " + response.status);
}

async function fetchNextSearchJob(config) {
  const r = await fetch(relayEndpoint(config, "/api/relay/search/jobs/next"), {
    headers: { "x-relay-token": config.relayToken }
  });
  if (!r.ok) {
    // 404 or 5xx -> swallow and retry next tick; log non-trivial errors only.
    if (r.status !== 404) {
      const text = await r.text().catch(() => "");
      throw new Error("search job fetch failed: " + r.status + " " + text.slice(0, 120));
    }
    return null;
  }
  const body = await r.json();
  return body.job || null;
}

async function postSearchResult(config, jobId, payload) {
  const r = await fetch(
    relayEndpoint(config, "/api/relay/search/jobs/" + encodeURIComponent(jobId) + "/result"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-token": config.relayToken
      },
      body: JSON.stringify(payload)
    }
  );
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error("posting search result failed: " + r.status + " " + text.slice(0, 120));
  }
}

// Loop 1: torrent queue (existing behavior, just renamed).
async function torrentsLoop(config, tmdb) {
  console.log("Polling " + config.relayUrl + " for torrents every " + config.pollIntervalSeconds + "s.");
  while (true) {
    try {
      const items = await pollTorrents(config);
      for (const item of items) {
        let savepath = resolveSavePath(config, item.type);
        let contentLayout;
        let label = item.type || "other";

        if (item.type === "tvshow") {
          const plan = await planTvShow(item, config, tmdb);
          savepath = plan.savepath;
          contentLayout = plan.contentLayout;
          label = "tvshow:" + plan.label;
        }

        await addToQbittorrent(config, item.links, {
          paused: item.paused,
          category: item.category,
          savepath,
          contentLayout
        });
        await ackTorrents(config, [item.id]);
        const layoutNote = contentLayout ? ", layout=" + contentLayout : "";
        console.log(
          "Added relay item " + item.id + " (" + item.links.length + " link(s), " +
          label + ", savepath=" + savepath + layoutNote + ")."
        );
      }
    } catch (error) {
      console.error("torrents loop:", error.message);
    }
    await sleep(config.pollIntervalSeconds * 1000);
  }
}

// Loop 2: search-job queue.
//
// Adaptive cadence: while we're seeing jobs we poll on the "active" interval
// (pollSearchIntervalSeconds, default 15s). After IDLE_THRESHOLD consecutive
// empty pulls we back off to pollSearchIdleIntervalSeconds (default 30s). The
// first request after a long quiet period therefore picks up at most a half
// minute late, which is acceptable for an interactive search UI.
async function searchLoop(config) {
  const activeMs = Math.max(1, Number(config.pollSearchIntervalSeconds) || 15) * 1000;
  const idleMs = Math.max(activeMs / 1000, Number(config.pollSearchIdleIntervalSeconds) || 30) * 1000;
  const IDLE_THRESHOLD = 3; // 3 empty ticks before backing off
  let emptyTicks = 0;
  console.log("Search provider: " + (config.searchProvider || "knaben") + ".");
  console.log(
    "Polling for search jobs every " + (activeMs / 1000) + "s (idle: " + (idleMs / 1000) + "s)."
  );
  while (true) {
    try {
      const job = await fetchNextSearchJob(config);
      if (!job) {
        emptyTicks++;
        const sleepMs = emptyTicks >= IDLE_THRESHOLD ? idleMs : activeMs;
        await sleep(sleepMs);
        continue;
      }
      emptyTicks = 0;
      console.log(
        "Search job " + job.id + ": " + JSON.stringify({ query: job.query, type: job.type, limit: job.limit })
      );
      try {
        const providerName = (config.searchProvider || "knaben").toLowerCase();
        const runSearch =
          providerName === "1337x" ? search1337x :
          providerName === "apibay" ? searchApibay :
          searchKnaben;
        const rawResults = await runSearch(job.query, {
          type: job.type,
          limit: job.limit,
          sortBy: job.sortBy || "seeders"
        });
        const bw = config.bandwidth || {};
        const learnedRate = effectivePerSeedMbps(learning, bw.perSeedMbps);
        const results = rawResults.map((r) =>
          annotateEta(r, bw.downloadMbps, learnedRate)
        );
        await postSearchResult(config, job.id, { results });
        console.log("Search job " + job.id + " -> " + results.length + " result(s) annotated with ETA at " + (config.bandwidth?.downloadMbps || 2350) + " Mbps cap).");
      } catch (err) {
        const message = err.message || "Search failed";
        console.error("Search job " + job.id + " failed: " + message);
        await postSearchResult(config, job.id, { error: message });
      }
    } catch (error) {
      console.error("search loop:", error.message);
      await sleep(activeMs);
    }
  }
}


// Loop 3: push qBittorrent's /torrents/info snapshot to the relay every
// pushStatsIntervalSeconds so the relay UI can render live download stats.

async function fetchNextDeleteJob(config) {
  const r = await fetch(relayEndpoint(config, "/api/relay/torrents/delete/jobs/next"), {
    headers: { "x-relay-token": config.relayToken }
  });
  if (!r.ok) {
    if (r.status !== 404) {
      const text = await r.text().catch(() => "");
      throw new Error("delete job fetch failed: " + r.status + " " + text.slice(0, 120));
    }
    return null;
  }
  const body = await r.json();
  return body.job || null;
}

async function drainDeleteJobs(config) {
  // Process up to 10 deletes per tick to avoid starving the status push.
  for (let i = 0; i < 10; i++) {
    const job = await fetchNextDeleteJob(config);
    if (!job) return;
    try {
      await deleteTorrents(config, [job.hash], Boolean(job.deleteFiles));
      console.log(
        "Removed torrent " + (job.name || job.hash) +
        (job.deleteFiles ? " (with files)" : "") + "."
      );
    } catch (err) {
      console.error("delete failed for " + job.hash + ": " + err.message);
    }
  }
}

// Module-level learning state (shared by status push + search loops)
let learning = { ...DEFAULT_LEARNING };

// Coarse fingerprint of the current torrents snapshot. We deliberately round
// speeds and progress so that a torrent ticking from 65.43% -> 65.44% doesn't
// trigger a Redis write. This is the single biggest savings: when the swarm
// is steady (a "stalled" torrent, or an idle qBittorrent with completed
// torrents seeding) the fingerprint stays identical for hours and we skip
// the relay POST entirely.
function fingerprintTorrents(torrents) {
  if (!Array.isArray(torrents)) return "";
  return torrents
    .map((t) => [
      t.hash,
      t.state,
      Math.round((Number(t.progress) || 0) * 200),       // 0.5% buckets
      Math.round((Number(t.dlspeed) || 0) / 131072),     // ~128 KB/s buckets
      Math.round((Number(t.upspeed) || 0) / 131072),
      Number(t.numSeeds) || 0,
      Number(t.numLeechs) || 0
    ].join(":"))
    .join("|");
}

// "Active" means qBittorrent is actually moving bytes for at least one
// torrent. We keep the fast cadence while bytes are flowing (so the UI
// feels live and we capture fresh learning samples) and slow way down the
// rest of the time. Note: a torrent stuck at "downloading" with dlspeed=0
// counts as idle for cadence purposes — there's nothing for the UI to
// usefully refresh.
function hasActiveTraffic(torrents) {
  if (!Array.isArray(torrents)) return false;
  for (const t of torrents) {
    if ((Number(t.dlspeed) || 0) > 0) return true;
    if ((Number(t.upspeed) || 0) > 0) return true;
  }
  return false;
}

async function statusPushLoop(config) {
  const activeMs = Math.max(1, Number(config.pushStatsIntervalSeconds) || 15) * 1000;
  const idleMs = Math.max(activeMs / 1000, Number(config.pushStatsIdleIntervalSeconds) || 120) * 1000;
  // Force a push at least this often so the UI doesn't think we're stale
  // even when literally nothing has changed.
  const HEARTBEAT_MS = 5 * 60 * 1000;
  console.log(
    "Pushing qBittorrent status every " + (activeMs / 1000) + "s active / " +
    (idleMs / 1000) + "s idle (heartbeat " + (HEARTBEAT_MS / 1000) + "s)."
  );

  let lastFingerprint = "";
  let lastLearningSamples = -1;
  let lastPushAt = 0;

  while (true) {
    let active = false;
    try {
      await drainDeleteJobs(config);
      const torrents = await getTorrents(config);
      learning = updateLearning(learning, torrents);
      active = hasActiveTraffic(torrents);

      const fingerprint = fingerprintTorrents(torrents);
      const samples = Number(learning && learning.perSeedSamples) || 0;
      const learningChanged = samples !== lastLearningSamples;
      const snapshotChanged = fingerprint !== lastFingerprint;
      const now = Date.now();
      const heartbeatDue = now - lastPushAt >= HEARTBEAT_MS;

      if (snapshotChanged || learningChanged || heartbeatDue) {
        // Tell the relay whether it should bother re-persisting `learning`
        // to its own Redis key. The status snapshot itself always carries
        // the latest `learning` for the UI; the standalone learning key is
        // only useful on poller restart, so we only refresh it when sample
        // count moved.
        const r = await fetch(relayEndpoint(config, "/api/relay/torrents/status"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-relay-token": config.relayToken
          },
          body: JSON.stringify({
            torrents,
            learning,
            persistLearning: learningChanged
          })
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          throw new Error("relay status push failed: " + r.status + " " + text.slice(0, 120));
        }
        lastFingerprint = fingerprint;
        lastLearningSamples = samples;
        lastPushAt = now;
      }
    } catch (error) {
      console.error("status push:", error.message);
    }
    await sleep(active ? activeMs : idleMs);
  }
}

async function main() {
  const config = await loadConfig();
  if (!config.relayUrl || !config.relayToken) {
    throw new Error("Set relayUrl and relayToken in config.json, or RELAY_URL and RELAY_TOKEN.");
  }

  const tmdb = new TmdbClient(config.tmdb);
  if (!tmdb.isConfigured()) {
    console.log(
      "TMDB credentials missing - TV shows will be saved to the base TV folder without per-show subdirectories."
    );
  }

  // Run torrent / search / status loops concurrently. If any throws an
  // unrecoverable error it'll bubble up and exit the process.
  await Promise.all([
    torrentsLoop(config, tmdb),
    searchLoop(config),
    statusPushLoop(config)
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
