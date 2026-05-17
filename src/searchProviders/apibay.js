// The Pirate Bay's public JSON API (apibay.org). No Cloudflare, no scraping,
// no HTML parsing -- a simple GET that returns a typed list of torrents.
//
// Endpoint:
//   GET https://apibay.org/q.php?q=<query>&cat=<category>
//     cat 0   = all
//     cat 200 = Video (movies + TV)
//     cat 201 = Movies
//     cat 205 = TV
//
// Each result object includes info_hash, name, seeders, leechers, size,
// added (unix seconds), username, etc. We synthesize magnet links from the
// info_hash + a baked-in tracker list, the same way the TPB site does.

const APIBAY_BASE = "https://apibay.org";

const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://9.rarbg.to:2710/announce",
  "udp://tracker.openbittorrent.com:80/announce",
  "udp://tracker.coppersurfer.tk:6969/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.leechers-paradise.org:6969/announce"
];

const CATEGORY_MAP = {
  movie: "201",
  tvshow: "205",
  other: "200" // all video
};

export function buildMagnet(infoHash, name) {
  if (!infoHash) return null;
  const trs = TRACKERS.map((t) => "&tr=" + encodeURIComponent(t)).join("");
  return "magnet:?xt=urn:btih:" + infoHash + "&dn=" + encodeURIComponent(name || "") + trs;
}

export function humanSize(n) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(v < 10 && i > 0 ? 1 : 0) + " " + u[i];
}

// "No results" marker from apibay.
function isNoResults(arr) {
  return (
    Array.isArray(arr) &&
    arr.length === 1 &&
    arr[0].id === "0" &&
    arr[0].info_hash === "0000000000000000000000000000000000000000"
  );
}

export function mapApibayResult(r) {
  const size = Number(r.size) || 0;
  return {
    name: r.name || "",
    seeds: Number(r.seeders) || 0,
    leeches: Number(r.leechers) || 0,
    sizeBytes: size,
    sizeText: humanSize(size),
    date: r.added ? new Date(Number(r.added) * 1000).toISOString().slice(0, 10) : "",
    uploader: r.username || "",
    detailUrl: r.id
      ? "https://thepiratebay.org/description.php?id=" + r.id
      : "",
    magnet: buildMagnet(r.info_hash, r.name)
  };
}

export async function searchApibay(query, options = {}) {
  const { type = "other", limit = 5, minSeeds = 1, timeoutMs = 9000 } = options;
  if (!query || typeof query !== "string" || !query.trim()) {
    throw new Error("Search query is required.");
  }
  const cat = CATEGORY_MAP[type] || "200";
  const url = new URL(APIBAY_BASE + "/q.php");
  url.searchParams.set("q", query.trim());
  url.searchParams.set("cat", cat);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let body;
  try {
    const resp = await fetch(url, {
      headers: { accept: "application/json" },
      signal: ac.signal
    });
    if (!resp.ok) {
      throw new Error("apibay returned HTTP " + resp.status);
    }
    body = await resp.json();
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(body) || isNoResults(body)) return [];

  const cap = Math.max(1, Math.min(20, Number(limit) || 5));
  const mapped = body.map(mapApibayResult).filter((r) => r.magnet && r.seeds >= minSeeds);
  mapped.sort((a, b) => b.seeds - a.seeds || b.leeches - a.leeches);
  return mapped.slice(0, cap);
}
