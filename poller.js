import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { addToQbittorrent } from "./src/qbittorrent.js";
import { TmdbClient } from "./src/tmdb.js";
import { parseDisplayName, parseSeriesInfo } from "./src/torrentName.js";
import { buildTvSavepath } from "./src/tvFolder.js";

const DEFAULT_CONFIG = {
  qbittorrentUrl: "http://127.0.0.1:8080",
  username: "admin",
  password: "adminadmin",
  defaultCategory: "",
  startPaused: false,
  relayUrl: "",
  relayToken: "",
  pollIntervalSeconds: 20,
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
  tvShowOverrides: {}
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
    }
  };
}

function resolveSavePath(config, type) {
  const paths = config.savePaths || DEFAULT_CONFIG.savePaths;
  if (type === "movie" && paths.movie) return paths.movie;
  if (type === "tvshow" && paths.tvshow) return paths.tvshow;
  return paths.other || DEFAULT_CONFIG.savePaths.other;
}

// Walk the links until we find one with a usable display name. Magnets with
// a "dn" parameter are preferred; direct .torrent URLs work as a fallback.
function firstDisplayName(links) {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const name = parseDisplayName(link);
    if (name) return name;
  }
  return null;
}

function buildLabel(show, info) {
  let label = show.name;
  if (show.year) label += " (" + show.year + ")";
  if (info.isCompleteSeries) {
    label += " [complete series]";
  } else if (info.season !== null && info.season !== undefined) {
    label += " S" + String(info.season).padStart(2, "0");
  }
  return label;
}

// Compute the right savepath + contentLayout for a TV-show queue item.
// Returns { savepath, contentLayout, label }. Falls back to base path with no
// layout override if any step is unhappy, so a bad parse or TMDB outage never
// blocks the torrent.
async function planTvShow(item, config, tmdb) {
  const baseDir = resolveSavePath(config, "tvshow");
  const fallback = { savepath: baseDir, contentLayout: undefined, label: "unresolved" };

  const dn = firstDisplayName(item.links);
  if (!dn) return fallback;

  const info = parseSeriesInfo(dn);
  if (!info.title) return fallback;

  let show = null;
  const overrides = config.tvShowOverrides || {};
  const overrideId = overrides[info.title.toLowerCase()];

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

  const savepath = buildTvSavepath({
    baseDir,
    showName: show.name,
    year: show.year,
    season: info.season,
    isCompleteSeries: info.isCompleteSeries
  });

  return {
    savepath,
    contentLayout: "NoSubfolder",
    label: buildLabel(show, info)
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function relayEndpoint(config, path) {
  const base = config.relayUrl.replace(/\/+$/g, "");
  return base + path;
}

async function poll(config) {
  const response = await fetch(relayEndpoint(config, "/api/relay/poll"), {
    headers: { "x-relay-token": config.relayToken }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Relay poll failed: " + response.status);
  }

  return body.items || [];
}

async function ack(config, ids) {
  if (ids.length === 0) {
    return;
  }

  const response = await fetch(relayEndpoint(config, "/api/relay/ack"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relay-token": config.relayToken
    },
    body: JSON.stringify({ ids })
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Relay ack failed: " + response.status);
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

  console.log("Polling " + config.relayUrl + " every " + config.pollIntervalSeconds + "s.");

  while (true) {
    try {
      const items = await poll(config);
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
        await ack(config, [item.id]);
        const layoutNote = contentLayout ? ", layout=" + contentLayout : "";
        console.log(
          "Added relay item " + item.id + " (" + item.links.length + " link(s), " +
          label + ", savepath=" + savepath + layoutNote + ")."
        );
      }
    } catch (error) {
      console.error(error.message);
    }

    await sleep(config.pollIntervalSeconds * 1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
