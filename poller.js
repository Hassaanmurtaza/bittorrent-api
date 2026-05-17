import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { addToQbittorrent } from "./src/qbittorrent.js";
import { TmdbClient } from "./src/tmdb.js";
import { parseDisplayName, parseSeriesInfo } from "./src/torrentName.js";
import { buildTvSavepath } from "./src/tvFolder.js";
import { search1337x } from "./src/searchProviders/x1337.js";
import { searchApibay } from "./src/searchProviders/apibay.js";
import { searchKnaben } from "./src/searchProviders/knaben.js";

const DEFAULT_CONFIG = {
  qbittorrentUrl: "http://127.0.0.1:8080",
  username: "admin",
  password: "adminadmin",
  defaultCategory: "",
  startPaused: false,
  relayUrl: "",
  relayToken: "",
  pollIntervalSeconds: 20,
  pollSearchIntervalSeconds: 2,
  savePaths: {
    movie: "E:\\Downloads\\Movies",
    tvshow: "E:\\Downloads\\TV Shows",
    other: "E:\\Downloads\\Others"
  },
  tmdb: {
    apiReadToken: "",
    apiKey: "",
    language: "en-CA"
  },
  tvShowOverrides: {},
  searchProvider: "knaben"
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
    searchProvider: (process.env.SEARCH_PROVIDER || fileConfig.searchProvider || DEFAULT_CONFIG.searchProvider).toLowerCase()
  };
}

function resolveSavePath(config, type) {
  const paths = config.savePaths || DEFAULT_CONFIG.savePaths;
  if (type === "movie" && paths.movie) return paths.movie;
  if (type === "tvshow" && paths.tvshow) return paths.tvshow;
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

// Loop 2: search-job queue. Runs every pollSearchIntervalSeconds.
async function searchLoop(config) {
  console.log("Search provider: " + (config.searchProvider || "apibay") + ".");
  console.log("Polling for search jobs every " + config.pollSearchIntervalSeconds + "s.");
  while (true) {
    try {
      const job = await fetchNextSearchJob(config);
      if (!job) {
        await sleep(config.pollSearchIntervalSeconds * 1000);
        continue;
      }
      console.log(
        "Search job " + job.id + ": " + JSON.stringify({ query: job.query, type: job.type, limit: job.limit })
      );
      try {
        const providerName = (config.searchProvider || "knaben").toLowerCase();
        const runSearch =
          providerName === "1337x" ? search1337x :
          providerName === "apibay" ? searchApibay :
          searchKnaben;
        const results = await runSearch(job.query, {
          type: job.type,
          limit: job.limit,
          sortBy: job.sortBy || "seeders"
        });
        await postSearchResult(config, job.id, { results });
        console.log("Search job " + job.id + " -> " + results.length + " result(s).");
      } catch (err) {
        const message = err.message || "Search failed";
        console.error("Search job " + job.id + " failed: " + message);
        await postSearchResult(config, job.id, { error: message });
      }
    } catch (error) {
      console.error("search loop:", error.message);
      await sleep(config.pollSearchIntervalSeconds * 1000);
    }
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

  // Run torrent and search loops concurrently. If either throws an
  // unrecoverable error it'll bubble up and exit the process.
  await Promise.all([torrentsLoop(config, tmdb), searchLoop(config)]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
