// Scraper for 1337x search results. Server-side only (browser can't reach
// 1337x due to CORS). Exposes a single async function that takes a query
// plus options and returns up to N magnets sorted by seed count.
//
// Cloudflare reality: every 1337x mirror sits behind Cloudflare. From a
// cloud-function IP (Vercel), Cloudflare frequently returns either an HTTP
// 403 or a "Just a moment..." JS-challenge page. We mitigate by:
//   1) Sending a full set of browser-realistic headers (UA, Sec-Fetch-*,
//      Accept-Language, Accept-Encoding, Upgrade-Insecure-Requests).
//   2) Rotating through several mirror domains in sequence on failure.
//   3) Returning a clear error message so the UI can surface it.

import { parse } from "node-html-parser";

const DEFAULT_MIRRORS = [
  "1337x.to",
  "1337x.st",
  "1337x.tw",
  "1337x.is",
  "1337x.gd"
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BROWSER_HEADERS = {
  "user-agent": USER_AGENT,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "accept-encoding": "gzip, deflate, br",
  "upgrade-insecure-requests": "1",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1"
};

const CATEGORY_MAP = {
  movie: "Movies",
  tvshow: "TV",
  other: null
};

const SIZE_UNITS = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024
};

function buildSearchUrl(domain, query, type) {
  const cat = CATEGORY_MAP[type] || null;
  const q = encodeURIComponent(query.trim());
  if (cat) {
    return `https://${domain}/sort-category-search/${q}/${cat}/seeders/desc/1/`;
  }
  return `https://${domain}/sort-search/${q}/seeders/desc/1/`;
}

function looksLikeCloudflareChallenge(text) {
  return /Just a moment\.\.\.|cf-browser-verification|challenge-platform|Attention Required|cf-error-details/.test(
    text
  );
}

async function httpGet(url, { timeoutMs = 9000, referer = "" } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers = { ...BROWSER_HEADERS };
    if (referer) headers.referer = referer;
    const resp = await fetch(url, { headers, redirect: "follow", signal: ac.signal });
    const text = await resp.text();
    if (resp.status === 403) {
      const reason = looksLikeCloudflareChallenge(text)
        ? "Cloudflare bot protection blocked the request"
        : "1337x returned HTTP 403";
      throw Object.assign(new Error(reason), { status: 403, cloudflare: looksLikeCloudflareChallenge(text) });
    }
    if (resp.status === 429) {
      throw Object.assign(new Error("1337x rate-limited (HTTP 429)"), { status: 429 });
    }
    if (!resp.ok) {
      throw Object.assign(new Error(`1337x returned HTTP ${resp.status}`), { status: resp.status });
    }
    if (looksLikeCloudflareChallenge(text)) {
      throw Object.assign(new Error("Cloudflare challenged the request (retry in a moment)"), {
        status: 503,
        cloudflare: true
      });
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export function parseSizeToBytes(sizeText) {
  if (!sizeText || typeof sizeText !== "string") return 0;
  const cleaned = sizeText.replace(/ /g, " ").trim();
  const m = cleaned.match(/([\d.,]+)\s*([KMGT]?B)/i);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  const unit = m[2].toUpperCase();
  const mult = SIZE_UNITS[unit] || 1;
  return Math.round(n * mult);
}

function directTextOf(node) {
  if (!node || !node.childNodes) return "";
  return node.childNodes
    .filter((n) => n.nodeType === 3)
    .map((n) => n.text)
    .join("")
    .trim();
}

export function parseSearchResults(html, domain) {
  const root = parse(html);
  const rows = root.querySelectorAll("tbody tr");
  const results = [];
  for (const row of rows) {
    const nameCell = row.querySelector("td.coll-1, td.name");
    if (!nameCell) continue;
    const anchors = nameCell.querySelectorAll("a");
    const titleAnchor = anchors[anchors.length - 1];
    if (!titleAnchor) continue;
    const path = titleAnchor.getAttribute("href") || "";
    if (!path.startsWith("/torrent/")) continue;
    const name = titleAnchor.text.trim();

    const seedsText = (row.querySelector("td.coll-2, td.seeds")?.text || "").trim();
    const leechesText = (row.querySelector("td.coll-3, td.leeches")?.text || "").trim();
    const date = (row.querySelector("td.coll-date, td.coll-4.date")?.text || "").trim();

    const sizeCell = row.querySelector("td.coll-4.size, td.size, td.coll-4");
    let sizeText = directTextOf(sizeCell);
    if (!sizeText && sizeCell) {
      sizeText = (sizeCell.text || "").replace(/\s*\d+\s*$/, "").trim();
    }

    const uploaderAnchor = row.querySelector("td.coll-5 a, td.uploader a");
    const uploader = uploaderAnchor ? uploaderAnchor.text.trim() : "";

    results.push({
      name,
      seeds: Number(seedsText) || 0,
      leeches: Number(leechesText) || 0,
      sizeText,
      sizeBytes: parseSizeToBytes(sizeText),
      date,
      uploader,
      detailPath: path,
      detailUrl: `https://${domain}${path}`,
      magnet: null
    });
  }
  return results;
}

export function parseMagnetFromDetailPage(html) {
  const root = parse(html);
  const anchors = root.querySelectorAll("a");
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    if (href.toLowerCase().startsWith("magnet:")) return href;
  }
  return null;
}

// Try each domain in sequence until one returns a parseable search page.
// Returns { domain, html, attempts } where attempts is a list of per-domain
// errors (for diagnostics in the UI).
async function fetchSearchWithFallback(query, type, mirrors, timeoutMs) {
  const attempts = [];
  for (const domain of mirrors) {
    const url = buildSearchUrl(domain, query, type);
    try {
      const html = await httpGet(url, { timeoutMs });
      // Sanity check: did we get actual search results markup?
      if (!/coll-1|tablesorter|table-list/i.test(html)) {
        attempts.push({ domain, error: "Page didn't contain a search results table" });
        continue;
      }
      return { domain, html, attempts };
    } catch (err) {
      attempts.push({ domain, error: err.message || String(err) });
      // Keep trying other mirrors.
    }
  }
  const summary = attempts
    .map((a) => `${a.domain}: ${a.error}`)
    .join(" | ");
  throw new Error(`All 1337x mirrors blocked or failed. ${summary}`);
}

export async function search1337x(query, options = {}) {
  const {
    type = "other",
    limit = 5,
    minSeeds = 1,
    mirrors = DEFAULT_MIRRORS,
    domain = null, // override: if set, used INSTEAD of the rotation
    timeoutMs = 9000
  } = options;

  if (!query || typeof query !== "string" || !query.trim()) {
    throw new Error("Search query is required.");
  }

  const tryList = domain ? [domain] : mirrors;
  const { domain: usedDomain, html } = await fetchSearchWithFallback(
    query,
    type,
    tryList,
    timeoutMs
  );

  const all = parseSearchResults(html, usedDomain);
  const filtered = all.filter((r) => r.seeds >= minSeeds);
  filtered.sort((a, b) => b.seeds - a.seeds || b.leeches - a.leeches);

  const cap = Math.max(1, Math.min(20, Number(limit) || 5));
  const top = filtered.slice(0, cap);

  const refererBase = `https://${usedDomain}/`;
  await Promise.all(
    top.map(async (r) => {
      try {
        const detailHtml = await httpGet(r.detailUrl, { timeoutMs, referer: refererBase });
        r.magnet = parseMagnetFromDetailPage(detailHtml);
      } catch (err) {
        r.magnet = null;
        r.error = err.message;
      }
    })
  );

  return top.filter((r) => r.magnet);
}
