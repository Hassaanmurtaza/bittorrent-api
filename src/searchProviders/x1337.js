// Pure scraper for 1337x search results. Lives server-side (browser can't
// reach 1337x due to CORS). Exposes a single async function that takes a
// query plus options and returns up to N magnets sorted by seed count.
//
// Two-step flow:
//   1) GET https://<domain>/sort-category-search/<query>/<Category>/seeders/desc/1/
//      -> parse the result table (name, seeds, leeches, size, date, uploader,
//         detail-page path).
//   2) For the top N filtered rows, GET each detail page in parallel and
//      extract the first magnet: link.
//
// Cloudflare can intermittently serve a JS challenge instead of the real
// page; we detect that and throw a clear error so the UI can surface it.

import { parse } from "node-html-parser";

const DEFAULT_DOMAIN = "1337x.st";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CATEGORY_MAP = {
  movie: "Movies",
  tvshow: "TV",
  other: null // generic search (no category)
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

async function httpGet(url, { timeoutMs = 8000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.5"
      },
      redirect: "follow",
      signal: ac.signal
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`1337x returned HTTP ${resp.status}`);
    }
    if (/Just a moment\.\.\.|cf-browser-verification|challenge-platform/.test(text)) {
      throw new Error("Cloudflare challenged the request (retry in a moment)");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export function parseSizeToBytes(sizeText) {
  if (!sizeText || typeof sizeText !== "string") return 0;
  // Examples: "1.2 GB", "856.4 MB", "12 KB", "1,234 MB"
  const cleaned = sizeText.replace(/ /g, " ").trim();
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
  // node-html-parser: text nodes have nodeType === 3
  return node.childNodes
    .filter((n) => n.nodeType === 3)
    .map((n) => n.text)
    .join("")
    .trim();
}

export function parseSearchResults(html, domain = DEFAULT_DOMAIN) {
  const root = parse(html);
  // 1337x's main result table varies in surrounding markup but the rows live
  // in a tbody and always carry coll-1 ... coll-5 class names on the cells.
  const rows = root.querySelectorAll("tbody tr");
  const results = [];
  for (const row of rows) {
    const nameCell = row.querySelector("td.coll-1, td.name");
    if (!nameCell) continue;
    const anchors = nameCell.querySelectorAll("a");
    // First anchor is the category icon; last anchor is the title.
    const titleAnchor = anchors[anchors.length - 1];
    if (!titleAnchor) continue;
    const path = titleAnchor.getAttribute("href") || "";
    if (!path.startsWith("/torrent/")) continue;
    const name = titleAnchor.text.trim();

    const seedsText = (row.querySelector("td.coll-2, td.seeds")?.text || "").trim();
    const leechesText = (row.querySelector("td.coll-3, td.leeches")?.text || "").trim();
    const date = (row.querySelector("td.coll-date, td.coll-4.date")?.text || "").trim();

    // The size cell often contains a hidden <span> with the seed count for
    // mobile views; take only the direct text to isolate "1.2 GB".
    const sizeCell = row.querySelector("td.coll-4.size, td.size, td.coll-4");
    let sizeText = directTextOf(sizeCell);
    if (!sizeText && sizeCell) {
      // Fallback: strip trailing digits (the embedded mobile seed count).
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

export async function search1337x(query, options = {}) {
  const {
    type = "other",
    limit = 5,
    minSeeds = 1,
    domain = DEFAULT_DOMAIN,
    timeoutMs = 8000
  } = options;

  if (!query || typeof query !== "string" || !query.trim()) {
    throw new Error("Search query is required.");
  }

  const url = buildSearchUrl(domain, query, type);
  const html = await httpGet(url, { timeoutMs });

  const all = parseSearchResults(html, domain);
  const filtered = all.filter((r) => r.seeds >= minSeeds);
  filtered.sort((a, b) => b.seeds - a.seeds || b.leeches - a.leeches);

  const cap = Math.max(1, Math.min(20, Number(limit) || 5));
  const top = filtered.slice(0, cap);

  // Fetch detail pages in parallel for magnet links.
  await Promise.all(
    top.map(async (r) => {
      try {
        const detailHtml = await httpGet(r.detailUrl, { timeoutMs });
        r.magnet = parseMagnetFromDetailPage(detailHtml);
      } catch (err) {
        r.magnet = null;
        r.error = err.message;
      }
    })
  );

  // Drop rows where we couldn't extract a magnet (dead detail page, etc.).
  return top.filter((r) => r.magnet);
}
