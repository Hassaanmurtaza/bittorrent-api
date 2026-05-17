import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { addToQbittorrent } from "./src/qbittorrent.js";

const DEFAULT_CONFIG = {
  qbittorrentUrl: "http://127.0.0.1:8080",
  username: "admin",
  password: "adminadmin",
  defaultCategory: "",
  startPaused: false,
  relayUrl: "",
  relayToken: "",
  pollIntervalSeconds: 20
};

async function loadConfig() {
  const fileConfig = existsSync("config.json")
    ? JSON.parse(await readFile("config.json", "utf8"))
    : {};

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
    )
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function relayEndpoint(config, path) {
  const base = config.relayUrl.replace(/\/+$/g, "");
  return `${base}${path}`;
}

async function poll(config) {
  const response = await fetch(relayEndpoint(config, "/api/relay/poll"), {
    headers: { "x-relay-token": config.relayToken }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `Relay poll failed: ${response.status}`);
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
    throw new Error(body.error || `Relay ack failed: ${response.status}`);
  }
}

async function main() {
  const config = await loadConfig();
  if (!config.relayUrl || !config.relayToken) {
    throw new Error("Set relayUrl and relayToken in config.json, or RELAY_URL and RELAY_TOKEN.");
  }

  console.log(`Polling ${config.relayUrl} every ${config.pollIntervalSeconds}s.`);

  while (true) {
    try {
      const items = await poll(config);
      for (const item of items) {
        await addToQbittorrent(config, item.links, {
          paused: item.paused,
          category: item.category
        });
        await ack(config, [item.id]);
        console.log(`Added relay item ${item.id} (${item.links.length} link(s)).`);
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
