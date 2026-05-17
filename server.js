import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { extractSupportedLinks, hasUnsupportedWebUrl } from "./src/links.js";
import { addToQbittorrent } from "./src/qbittorrent.js";
import { createRelayStore } from "./src/storage.js";
import { search1337x } from "./src/searchProviders/x1337.js";

const DEFAULT_CONFIG = {
  port: 7331,
  host: "127.0.0.1",
  qbittorrentUrl: "http://127.0.0.1:8080",
  username: "admin",
  password: "adminadmin",
  token: "",
  mode: "local",
  relayToken: "",
  queueFile: "relay-queue.json",
  queueKey: "qbittorrent-relay-queue",
  defaultCategory: "",
  startPaused: false
};

export async function loadConfig() {
  const fileConfig = existsSync("config.json")
    ? JSON.parse(await readFile("config.json", "utf8"))
    : {};

  const config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    port: Number(process.env.PORT || fileConfig.port || DEFAULT_CONFIG.port),
    host: process.env.HOST || fileConfig.host || DEFAULT_CONFIG.host,
    qbittorrentUrl:
      process.env.QB_URL || fileConfig.qbittorrentUrl || DEFAULT_CONFIG.qbittorrentUrl,
    username: process.env.QB_USER || fileConfig.username || DEFAULT_CONFIG.username,
    password: process.env.QB_PASS || fileConfig.password || DEFAULT_CONFIG.password,
    token: process.env.BRIDGE_TOKEN || fileConfig.token || "",
    mode: process.env.MODE || fileConfig.mode || DEFAULT_CONFIG.mode,
    relayToken: process.env.RELAY_TOKEN || fileConfig.relayToken || "",
    queueFile: process.env.RELAY_QUEUE_FILE || fileConfig.queueFile || DEFAULT_CONFIG.queueFile,
    queueKey: process.env.RELAY_QUEUE_KEY || fileConfig.queueKey || DEFAULT_CONFIG.queueKey,
    kvRestApiUrl:
      process.env.KV_REST_API_URL ||
      process.env.UPSTASH_REDIS_REST_URL ||
      fileConfig.kvRestApiUrl ||
      "",
    kvRestApiToken:
      process.env.KV_REST_API_TOKEN ||
      process.env.UPSTASH_REDIS_REST_TOKEN ||
      fileConfig.kvRestApiToken ||
      ""
  };

  if (!config.token || config.token === "change-this-to-a-long-random-string") {
    config.token = randomBytes(24).toString("hex");
    config.temporaryToken = true;
  }

  if (config.mode === "relay" && !config.relayToken) {
    throw new Error("RELAY_TOKEN is required when MODE=relay.");
  }

  if (
    config.mode === "relay" &&
    process.env.VERCEL &&
    (!config.kvRestApiUrl || !config.kvRestApiToken)
  ) {
    throw new Error(
      "KV_REST_API_URL and KV_REST_API_TOKEN are required for relay mode on Vercel. Add a Redis storage integration before deploying."
    );
  }

  return config;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json",
    "cache-control": "no-store",
    ...headers
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

function verifyLocalRequest(req, config) {
  const remote = req.socket.remoteAddress;
  const localAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  if (!localAddresses.has(remote)) {
    throw Object.assign(new Error("Only local requests are accepted."), { statusCode: 403 });
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const providedToken = req.headers["x-bridge-token"] || url.searchParams.get("token");
  if (providedToken !== config.token) {
    throw Object.assign(new Error("Missing or invalid bridge token."), { statusCode: 401 });
  }

  return url;
}

function page(config, message = "") {
  const escapedToken = escapeHtml(config.token);
  const escapedMessage = escapeHtml(message);
  const tokenNote = config.temporaryToken
    ? "Temporary token for this run. Create config.json to keep one stable."
    : "Using token from config.json or BRIDGE_TOKEN.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>qBittorrent Local Bridge</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f4ef;
      color: #202124;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px 16px;
      box-sizing: border-box;
    }
    main {
      width: min(820px, 100%);
    }
    h1 {
      font-size: clamp(2rem, 5vw, 4rem);
      line-height: 1;
      margin: 0 0 16px;
      letter-spacing: 0;
    }
    p {
      color: #5c5f64;
      line-height: 1.55;
      max-width: 68ch;
    }
    form {
      display: grid;
      gap: 14px;
      margin-top: 28px;
    }
    textarea, input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #c8c3ba;
      border-radius: 8px;
      padding: 14px;
      font: inherit;
      background: #fffdfa;
      color: inherit;
    }
    textarea {
      min-height: 160px;
      resize: vertical;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 12px 18px;
      font: inherit;
      font-weight: 700;
      background: #255f85;
      color: white;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.65;
      cursor: wait;
    }
    label {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #3c4043;
    }
    label input {
      width: auto;
    }
    code {
      overflow-wrap: anywhere;
    }
    .notice {
      min-height: 24px;
      margin-top: 18px;
      font-weight: 700;
    }
    .fine {
      margin-top: 26px;
      font-size: 0.92rem;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        background: #171817;
        color: #f2f0ea;
      }
      p, label {
        color: #c9c5bc;
      }
      textarea, input {
        background: #202220;
        border-color: #4b4d48;
      }
      button {
        background: #4f95bd;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>qBittorrent bridge</h1>
    <p>Paste a magnet link or direct <code>.torrent</code> URL from a legal source. This local bridge sends it to qBittorrent on this PC.</p>
    <form id="add-form">
      <textarea id="links" name="links" autocomplete="off" spellcheck="false" placeholder="magnet:?xt=urn:btih:..."></textarea>
      <div class="row">
        <button type="submit">Add to qBittorrent</button>
        <label><input id="paused" type="checkbox"> Add paused</label>
      </div>
    </form>
    <div id="notice" class="notice">${escapedMessage}</div>
    <p class="fine">Endpoint: <code>http://${escapeHtml(config.host)}:${config.port}/add?token=${escapedToken}&url=...</code><br>${escapeHtml(tokenNote)}</p>
  </main>
  <script>
    const token = ${JSON.stringify(config.token)};
    const form = document.querySelector("#add-form");
    const notice = document.querySelector("#notice");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      button.disabled = true;
      notice.textContent = "Adding...";
      try {
        const response = await fetch("/api/add", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bridge-token": token
          },
          body: JSON.stringify({
            text: document.querySelector("#links").value,
            paused: document.querySelector("#paused").checked
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Add failed");
        notice.textContent = "Added " + result.added.length + " item(s) to qBittorrent.";
        form.reset();
      } catch (error) {
        notice.textContent = error.message === "Failed to fetch"
          ? "Could not reach the local bridge. Start it again with launch.ps1 or start.ps1, then refresh this page."
          : error.message;
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function relayPage(config, message = "") {
  const escapedMessage = escapeHtml(message);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Torrent Relay</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f4ef;
      color: #202124;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: start center;
      padding: 32px 16px;
      box-sizing: border-box;
    }
    main {
      width: min(900px, 100%);
    }
    h1 {
      font-size: clamp(2rem, 5vw, 4rem);
      line-height: 1;
      margin: 0 0 16px;
      letter-spacing: 0;
    }
    p {
      color: #5c5f64;
      line-height: 1.55;
      max-width: 68ch;
    }
    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid #d6d2c9;
      margin-top: 22px;
    }
    .tab {
      background: transparent;
      color: #5c5f64;
      border: 0;
      border-bottom: 3px solid transparent;
      padding: 10px 14px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      border-radius: 0;
    }
    .tab.active {
      color: #202124;
      border-bottom-color: #255f85;
    }
    .panel.hidden { display: none; }
    form {
      display: grid;
      gap: 14px;
      margin-top: 22px;
    }
    textarea, input, select {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #c8c3ba;
      border-radius: 8px;
      padding: 12px;
      font: inherit;
      background: #fffdfa;
      color: inherit;
    }
    textarea {
      min-height: 180px;
      resize: vertical;
    }
    label.field {
      display: grid;
      gap: 6px;
      font-size: 0.92rem;
      color: #3c4043;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    button {
      width: fit-content;
      border: 0;
      border-radius: 8px;
      padding: 12px 18px;
      font: inherit;
      font-weight: 700;
      background: #255f85;
      color: white;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.65;
      cursor: wait;
    }
    .notice {
      min-height: 24px;
      margin-top: 14px;
      font-weight: 700;
    }
    table.results {
      width: 100%;
      border-collapse: collapse;
      margin-top: 14px;
      font-size: 0.92rem;
    }
    table.results th, table.results td {
      text-align: left;
      padding: 8px 6px;
      border-bottom: 1px solid #e3dfd6;
      vertical-align: top;
    }
    table.results th {
      font-weight: 700;
      color: #3c4043;
    }
    table.results td.right { text-align: right; }
    table.results a { color: inherit; }
    table.results tr:hover { background: rgba(0,0,0,0.04); }
    .actions {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-top: 14px;
    }
    .actions.hidden { display: none; }
    @media (prefers-color-scheme: dark) {
      :root {
        background: #171817;
        color: #f2f0ea;
      }
      p, label.field { color: #c9c5bc; }
      textarea, input, select {
        background: #202220;
        border-color: #4b4d48;
      }
      button { background: #4f95bd; }
      .tabs { border-bottom-color: #3a3c38; }
      .tab { color: #c9c5bc; }
      .tab.active { color: #f2f0ea; border-bottom-color: #4f95bd; }
      table.results th, table.results td { border-bottom-color: #3a3c38; }
      table.results tr:hover { background: rgba(255,255,255,0.04); }
    }
  </style>
</head>
<body>
  <main>
    <h1>Torrent relay</h1>
    <p>Search 1337x, or paste a magnet / direct <code>.torrent</code> URL. Your home PC poller will pick it up and send it to qBittorrent.</p>

    <div class="tabs" role="tablist">
      <button type="button" class="tab active" data-tab="search">Search 1337x</button>
      <button type="button" class="tab" data-tab="magnet">Paste magnet</button>
    </div>

    <section class="panel" data-panel="search">
      <form id="search-form">
        <input id="search-query" type="search" autocomplete="off" placeholder="Search query (e.g. batman vs superman)">
        <div class="row">
          <label class="field">
            Type
            <select id="search-type">
              <option value="movie">Movie</option>
              <option value="tvshow">TV Show</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label class="field">
            Top
            <select id="search-limit">
              <option value="5" selected>5</option>
              <option value="10">10</option>
            </select>
          </label>
        </div>
        <input id="token" type="password" autocomplete="current-password" placeholder="Relay token">
        <button type="submit">Search</button>
      </form>
      <div id="search-notice" class="notice"></div>
      <table id="search-results" class="results" hidden>
        <thead>
          <tr>
            <th></th>
            <th>Title</th>
            <th class="right">Seeds</th>
            <th class="right">Leeches</th>
            <th>Size</th>
            <th>Date</th>
            <th>Uploader</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <div class="actions hidden">
        <button type="button" id="queue-selected">Queue selected (0)</button>
        <span id="queue-notice"></span>
      </div>
    </section>

    <section class="panel hidden" data-panel="magnet">
      <form id="relay-form">
        <textarea id="links" autocomplete="off" spellcheck="false" placeholder="magnet:?xt=urn:btih:..."></textarea>
        <label class="field">
          Type
          <select id="magnet-type">
            <option value="movie">Movie</option>
            <option value="tvshow">TV Show</option>
            <option value="other">Other</option>
          </select>
        </label>
        <input id="magnet-token" type="password" autocomplete="current-password" placeholder="Relay token">
        <button type="submit">Queue for home PC</button>
      </form>
      <div id="notice" class="notice">${escapedMessage}</div>
    </section>
  </main>
  <script>
    // --- Tab switching ----------------------------------------------------
    const tabButtons = document.querySelectorAll(".tab");
    const panels = document.querySelectorAll(".panel");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
        panels.forEach((p) =>
          p.classList.toggle("hidden", p.dataset.panel !== btn.dataset.tab)
        );
      });
    });

    // --- Shared: relay token from query string ----------------------------
    const params = new URLSearchParams(location.search);
    const tokenParam = params.get("token") || "";
    const searchTokenInput = document.querySelector("#token");
    const magnetTokenInput = document.querySelector("#magnet-token");
    searchTokenInput.value = tokenParam;
    magnetTokenInput.value = tokenParam;
    // Keep them in sync if user retypes one.
    searchTokenInput.addEventListener("input", () => { magnetTokenInput.value = searchTokenInput.value; });
    magnetTokenInput.addEventListener("input", () => { searchTokenInput.value = magnetTokenInput.value; });

    // --- Paste-magnet flow ------------------------------------------------
    const relayForm = document.querySelector("#relay-form");
    const notice = document.querySelector("#notice");

    relayForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = relayForm.querySelector("button");
      button.disabled = true;
      notice.textContent = "Queueing...";
      try {
        const response = await fetch("/api/relay/add", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-relay-token": magnetTokenInput.value
          },
          body: JSON.stringify({
            text: document.querySelector("#links").value,
            type: document.querySelector("#magnet-type").value
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Queue failed");
        notice.textContent = "Queued " + result.links + " " + result.type + " link(s). Keep your home poller running.";
        document.querySelector("#links").value = "";
      } catch (error) {
        notice.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    // --- Search flow ------------------------------------------------------
    const searchForm = document.querySelector("#search-form");
    const searchNotice = document.querySelector("#search-notice");
    const resultsTable = document.querySelector("#search-results");
    const resultsBody = resultsTable.querySelector("tbody");
    const actionsBox = document.querySelector(".actions");
    const queueBtn = document.querySelector("#queue-selected");
    const queueNotice = document.querySelector("#queue-notice");

    function escAttr(v) {
      return String(v == null ? "" : v)
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    }
    function fmtBytes(n) {
      if (!n) return "";
      const u = ["B","KB","MB","GB","TB"];
      let i = 0; let v = n;
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
      return v.toFixed(v < 10 && i > 0 ? 1 : 0) + " " + u[i];
    }
    function updateQueueButton() {
      const n = resultsBody.querySelectorAll("input[type=checkbox]:checked").length;
      queueBtn.textContent = "Queue selected (" + n + ")";
      queueBtn.disabled = n === 0;
    }
    resultsBody.addEventListener("change", updateQueueButton);

    searchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = document.querySelector("#search-query").value.trim();
      const type = document.querySelector("#search-type").value;
      const limit = Number(document.querySelector("#search-limit").value) || 5;
      if (!query) { searchNotice.textContent = "Enter a search query."; return; }
      const button = searchForm.querySelector("button");
      button.disabled = true;
      searchNotice.textContent = "Searching 1337x...";
      resultsBody.innerHTML = "";
      resultsTable.hidden = true;
      actionsBox.classList.add("hidden");
      queueNotice.textContent = "";
      try {
        const response = await fetch("/api/relay/search", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-relay-token": searchTokenInput.value
          },
          body: JSON.stringify({ query, type, limit })
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Search failed");
        const results = Array.isArray(body.results) ? body.results : [];
        if (results.length === 0) {
          searchNotice.textContent = "No results.";
          return;
        }
        searchNotice.textContent = "Found " + results.length + " result(s). Pick one or more, then Queue selected.";
        for (const r of results) {
          const tr = document.createElement("tr");
          tr.innerHTML = [
            '<td><input type="checkbox" data-magnet="', escAttr(r.magnet), '"></td>',
            '<td><a href="', escAttr(r.detailUrl), '" target="_blank" rel="noopener noreferrer">', escAttr(r.name), '</a></td>',
            '<td class="right">', String(r.seeds || 0), '</td>',
            '<td class="right">', String(r.leeches || 0), '</td>',
            '<td>', escAttr(r.sizeText || fmtBytes(r.sizeBytes)), '</td>',
            '<td>', escAttr(r.date || ""), '</td>',
            '<td>', escAttr(r.uploader || ""), '</td>'
          ].join("");
          resultsBody.appendChild(tr);
        }
        resultsTable.hidden = false;
        actionsBox.classList.remove("hidden");
        updateQueueButton();
      } catch (error) {
        searchNotice.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    queueBtn.addEventListener("click", async () => {
      const checked = Array.from(resultsBody.querySelectorAll("input[type=checkbox]:checked"));
      if (checked.length === 0) return;
      const type = document.querySelector("#search-type").value;
      queueBtn.disabled = true;
      queueNotice.textContent = "Queueing " + checked.length + " item(s)...";
      let ok = 0, fail = 0;
      for (const cb of checked) {
        const magnet = cb.dataset.magnet;
        try {
          const r = await fetch("/api/relay/add", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-relay-token": searchTokenInput.value
            },
            body: JSON.stringify({ text: magnet, type })
          });
          if (r.ok) { ok++; cb.checked = false; }
          else { fail++; }
        } catch { fail++; }
      }
      queueNotice.textContent = "Queued " + ok + (fail ? " (failed " + fail + ")" : "") + ".";
      updateQueueButton();
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function unsupportedMessage(text) {
  if (hasUnsupportedWebUrl(text)) {
    return "Only magnet links and direct .torrent URLs are supported. This bridge does not scrape torrent index pages.";
  }
  return "Paste at least one magnet link or direct .torrent URL.";
}

function verifyRelayRequest(req, config) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const providedToken = req.headers["x-relay-token"] || url.searchParams.get("token");
  if (providedToken !== config.relayToken) {
    throw Object.assign(new Error("Missing or invalid relay token."), { statusCode: 401 });
  }

  return url;
}

const ALLOWED_TYPES = new Set(["movie", "tvshow", "other"]);

function normalizeType(value) {
  if (typeof value !== "string") return "other";
  const cleaned = value.trim().toLowerCase().replace(/[\s-]+/g, "");
  if (cleaned === "tv" || cleaned === "tvshow" || cleaned === "tvshows" || cleaned === "show" || cleaned === "series") {
    return "tvshow";
  }
  if (cleaned === "movie" || cleaned === "movies" || cleaned === "film") {
    return "movie";
  }
  if (ALLOWED_TYPES.has(cleaned)) return cleaned;
  return "other";
}

async function queueRelayItem(store, text, options = {}) {
  const links = extractSupportedLinks(text);
  if (links.length === 0) {
    throw Object.assign(new Error(unsupportedMessage(text)), { statusCode: 400 });
  }

  const item = {
    id: `${Date.now()}-${randomBytes(4).toString("hex")}`,
    createdAt: new Date().toISOString(),
    links,
    paused: Boolean(options.paused),
    category: options.category || "",
    type: normalizeType(options.type)
  };

  return await store.push(item);
}

async function handleAdd(config, req, res, text, options = {}) {
  const links = extractSupportedLinks(text);
  if (links.length === 0) {
    return send(res, 400, { error: unsupportedMessage(text) });
  }

  await addToQbittorrent(config, links, options);
  return send(res, 200, { added: links });
}

export function createRequestHandler(config) {
  const relayStore = createRelayStore(config);

  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (config.mode === "relay") {
        if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/submit")) {
          return send(res, 200, relayPage(config));
        }

        if (req.method === "GET" && url.pathname === "/health") {
          return send(res, 200, { ok: true, mode: "relay" });
        }

        if (req.method === "POST" && url.pathname === "/api/relay/add") {
          verifyRelayRequest(req, config);
          const body = await readJson(req);
          const item = await queueRelayItem(relayStore, body.text || body.url || "", {
            paused: Boolean(body.paused),
            category: body.category,
            type: body.type
          });
          return send(res, 200, { id: item.id, links: item.links.length, type: item.type });
        }

        if (req.method === "POST" && url.pathname === "/api/relay/search") {
          verifyRelayRequest(req, config);
          const body = await readJson(req);
          const query = String(body.query || "").trim();
          if (!query) {
            return send(res, 400, { error: "query is required" });
          }
          const type = normalizeType(body.type);
          const limit = Math.max(1, Math.min(20, Number(body.limit) || 5));
          try {
            const results = await search1337x(query, { type, limit });
            return send(res, 200, { results });
          } catch (err) {
            return send(res, 502, { error: err.message || "Search failed" });
          }
        }

        if (req.method === "GET" && url.pathname === "/api/relay/poll") {
          verifyRelayRequest(req, config);
          const queue = await relayStore.list();
          return send(res, 200, { items: queue });
        }

        if (req.method === "POST" && url.pathname === "/api/relay/ack") {
          verifyRelayRequest(req, config);
          const body = await readJson(req);
          const acked = await relayStore.removeByIds(Array.isArray(body.ids) ? body.ids : []);
          return send(res, 200, { acked });
        }

        return send(res, 404, { error: "Not found" });
      }

      if (req.method === "GET" && url.pathname === "/") {
        return send(res, 200, page(config));
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/add") {
        const verifiedUrl = verifyLocalRequest(req, config);
        const text = verifiedUrl.searchParams.get("url") || "";
        const links = extractSupportedLinks(text);
        if (links.length === 0) {
          return send(res, 400, page(config, unsupportedMessage(text)));
        }

        await addToQbittorrent(config, links, {
          paused: verifiedUrl.searchParams.get("paused") === "true"
        });
        return send(res, 200, page(config, `Added ${links.length} item(s) to qBittorrent.`));
      }

      if (req.method === "POST" && url.pathname === "/api/add") {
        verifyLocalRequest(req, config);
        const body = await readJson(req);
        return await handleAdd(config, req, res, body.text || body.url || "", {
          paused: Boolean(body.paused),
          category: body.category
        });
      }

      return send(res, 404, { error: "Not found" });
    } catch (error) {
      const status = error.statusCode || 500;
      return send(res, status, { error: error.message || "Server error" });
    }
  };
}

let defaultHandler;

export default async function serverHandler(req, res) {
  if (!defaultHandler) {
    defaultHandler = createRequestHandler(await loadConfig());
  }

  return await defaultHandler(req, res);
}

async function main() {
  const config = await loadConfig();
  const server = http.createServer(createRequestHandler(config));

  server.listen(config.port, config.host, () => {
    console.log(`qBittorrent bridge: http://${config.host}:${config.port}`);
    console.log(`Token: ${config.token}`);
    if (config.temporaryToken) {
      console.log("Create config.json from config.example.json to keep a stable token.");
    }
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
