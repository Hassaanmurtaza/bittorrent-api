// Knaben.org's JSON API (https://api.knaben.org/v1). Knaben is an aggregator
// that scrapes 50+ torrent indexers (1337x, TPB, LimeTorrents, YTS, RARBG-
// clones, Nyaa, etc.) and exposes a single unified JSON endpoint -- which
// means Cloudflare-protected sources like 1337x become reachable from a
// regular Node fetch.
//
// Endpoint: POST https://api.knaben.org/v1
//
// Each hit returns:
//   { title, seeders, peers, bytes, date, hash, magnetUrl, link,
//     details, tracker, trackerId, category, categoryId, virusDetection }
//
// Notes:
//   - "peers" in Knaben's response is the number of leechers (incomplete
//     downloaders), which is what our UI calls "leeches".
//   - Some hits (mostly LimeTorrents) have magnetUrl=null but a non-null
//     "link" pointing to knaben.org/live/dl/<source>/... which serves the
//     .torrent file. qBittorrent accepts URLs that resolve to a .torrent,
//     so we pass "link" as a fallback when magnetUrl is missing.
//   - hide_unsafe defaults to true on Knaben's side and filters out many
//     legitimate-looking torrents; we default it to FALSE so users see the
//     same set their browser does when they tick "show unsafe".

const KNABEN_URL = "https://api.knaben.org/v1";

// Category IDs observed in real responses:
//   3000000 = Movies (parent), 3001000 = Movies/HD, 3002000 = Movies/SD,
//   3003000 = Movies/UHD. The parent (3000000) implicitly includes all
//   children. TV-shows category is a config-overridable guess.
const DEFAULT_CATEGORIES = {
  movie: [3000000],
  tvshow: [2000000],
  other: []
};

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function humanSize(n) {
  const v0 = Number(n);
  if (!Number.isFinite(v0) || v0 <= 0) return "";
  let v = v0;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(v < 10 && i > 0 ? 1 : 0) + " " + UNITS[i];
}

export function mapKnabenHit(hit) {
  if (!hit || typeof hit !== "object") return null;
  const seeds = Number(hit.seeders) || 0;
  const leeches = Number(hit.peers) || 0;
  const bytes = Number(hit.bytes) || 0;
  const magnet = hit.magnetUrl || hit.link || null;
  if (!magnet) return null;
  const dateStr = typeof hit.date === "string" ? hit.date.slice(0, 10) : "";
  return {
    name: hit.title || "",
    seeds,
    leeches,
    sizeBytes: bytes,
    sizeText: humanSize(bytes),
    date: dateStr,
    uploader: hit.tracker || hit.trackerId || "",
    detailUrl: hit.details || hit.link || "",
    magnet
  };
}

export async function searchKnaben(query, options = {}) {
  const {
    type = "other",
    limit = 30,
    minSeeds = 1,
    hideUnsafe = false,
    hideXxx = true,
    categories,
    timeoutMs = 12000
  } = options;

  if (!query || typeof query !== "string" || !query.trim()) {
    throw new Error("Search query is required.");
  }

  const cap = Math.max(1, Math.min(100, Number(limit) || 30));
  // Ask for slightly more than the user wants so the seeds>=minSeeds filter
  // still has enough to fill `cap` after dropping dead torrents.
  const fetchSize = Math.min(300, Math.max(cap * 2, cap + 20));

  const cats =
    Array.isArray(categories) && categories.length > 0
      ? categories
      : DEFAULT_CATEGORIES[type] || [];

  const body = {
    query: query.trim(),
    order_by: "seeders",
    order_direction: "desc",
    size: fetchSize,
    from: 0,
    hide_unsafe: Boolean(hideUnsafe),
    hide_xxx: Boolean(hideXxx)
  };
  if (cats.length > 0) {
    body.categories = cats;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let data;
  try {
    const resp = await fetch(KNABEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: ac.signal
    });
    if (!resp.ok) {
      throw new Error("Knaben returned HTTP " + resp.status);
    }
    data = await resp.json();
  } finally {
    clearTimeout(timer);
  }

  const hits = Array.isArray(data?.hits) ? data.hits : [];
  const mapped = [];
  for (const hit of hits) {
    const m = mapKnabenHit(hit);
    if (m && m.seeds >= minSeeds) mapped.push(m);
  }
  // Knaben already returned them sorted by seeders desc, but de-dupe by
  // info-hash (extracted from the magnet) and keep the first occurrence so
  // multiple trackers carrying the same torrent collapse into one row.
  const seenHashes = new Set();
  const deduped = [];
  for (const r of mapped) {
    const hashMatch = r.magnet.match(/xt=urn:btih:([A-Za-z0-9]+)/i);
    const key = hashMatch ? hashMatch[1].toUpperCase() : r.magnet;
    if (seenHashes.has(key)) continue;
    seenHashes.add(key);
    deduped.push(r);
    if (deduped.length >= cap) break;
  }
  return deduped;
}
