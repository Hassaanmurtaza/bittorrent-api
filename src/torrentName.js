// Pulls a usable display name out of a torrent link (magnet "dn" parameter, or
// the basename of a direct .torrent URL) and then teases out the show title,
// season number, and whether it looks like a complete-series pack.
//
// This module is pure: no I/O, no network. All the network-y bits live in
// src/tmdb.js. Keeping it pure makes it cheap to unit-test the regex zoo.

const RELEASE_TAG_PATTERN =
  /\b(1080p|720p|2160p|4k|webrip|web-?dl|web|bluray|brrip|hdtv|x264|x265|h264|h265|hevc|aac|dts|ddp|ac3|hdr10?|10bit|dvdrip|repack|proper|extended|directors?\.?cut|remastered|imax|amzn|nf|hulu|dsnp|atvp|max)\b/i;

// Anything that says "we are past the title and into metadata":
//   S06, S06E12, Season 6, Seasons 1-9, 6x12
const SEASON_MARKER_PATTERN =
  /\bS\d{1,2}(?:E\d{1,3})?\b|\bSeasons?\s*\d{1,2}\b|\b\d{1,2}x\d{1,3}\b/i;

// Anime-style absolute episode numbering: "Black Clover - 042" / "- 170".
const ANIME_EPISODE_PATTERN = /\s+[-–]\s+\d{1,4}\b/;

const COMPLETE_SERIES_PATTERNS = [
  /\bcomplete[\s.\-_]*(series|collection)?\b/i,
  /\bS\d{1,2}\s*[-–]\s*S\d{1,2}\b/i,
  /\bSeasons?\s*\d{1,2}\s*[-–]\s*\d{1,2}\b/i,
  /\bSeries\s*\d{1,2}\s*[-–]\s*\d{1,2}\b/i
];

const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/;
const TRAILING_GROUP_PATTERN = /\s*[-–][A-Za-z0-9]+\s*$/;
const LEADING_BRACKETS_PATTERN = /^\s*[\[(][^\])]+[\])]\s*/;

// Convert dot/underscore separators into spaces so the markers above match
// cleanly. Magnets like "Black.Clover.S06.1080p" become "Black Clover S06 1080p".
function normalizeSeparators(value) {
  return String(value)
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDisplayName(link) {
  if (typeof link !== "string" || !link) return null;

  if (link.toLowerCase().startsWith("magnet:")) {
    const queryStart = link.indexOf("?");
    if (queryStart < 0) return null;
    let params;
    try {
      params = new URLSearchParams(link.slice(queryStart + 1));
    } catch {
      return null;
    }
    const dn = params.get("dn");
    return dn ? dn.trim() : null;
  }

  try {
    const url = new URL(link);
    const last = url.pathname.split("/").filter(Boolean).pop() || "";
    if (!last) return null;
    const decoded = decodeURIComponent(last).replace(/\.torrent$/i, "").trim();
    return decoded || null;
  } catch {
    return null;
  }
}

function detectCompleteSeries(value) {
  for (const rx of COMPLETE_SERIES_PATTERNS) {
    if (rx.test(value)) return true;
  }
  return false;
}

function detectSeason(value) {
  // Priority: SxxExx, then Season xx (also matches Seasons xx), NxNN, bare Sxx.
  const ordered = [
    /\bS(\d{1,2})E\d{1,3}\b/i,
    /\bSeasons?\s*(\d{1,2})\b/i,
    /\b(\d{1,2})x\d{1,3}\b/,
    /\bS(\d{1,2})\b/i
  ];
  for (const rx of ordered) {
    const m = value.match(rx);
    if (m) {
      const season = parseInt(m[1], 10);
      if (!Number.isNaN(season) && season >= 0 && season <= 99) {
        return season;
      }
    }
  }
  return null;
}

function firstIndexOfAny(value, patterns) {
  let earliest = -1;
  for (const rx of patterns) {
    const m = value.match(rx);
    if (m && typeof m.index === "number") {
      if (earliest === -1 || m.index < earliest) earliest = m.index;
    }
  }
  return earliest;
}

function extractTitle(value) {
  // Strip a leading bracketed tag like "[SubsPlease]" or "(Anime)".
  let working = value.replace(LEADING_BRACKETS_PATTERN, "").trim();

  // Cut at the first season / year / complete / release-tag / anime-episode /
  // open-bracket marker. Whichever appears first wins -- that is the boundary
  // between title and metadata.
  const cut = firstIndexOfAny(working, [
    SEASON_MARKER_PATTERN,
    YEAR_PATTERN,
    /\bcomplete\b/i,
    RELEASE_TAG_PATTERN,
    ANIME_EPISODE_PATTERN,
    /\s\[/
  ]);
  if (cut > 0) {
    working = working.slice(0, cut).trim();
  }

  // Strip a trailing "-RELEASEGROUP" / "- Group" segment.
  working = working.replace(TRAILING_GROUP_PATTERN, "").trim();
  // Strip stray trailing dashes / underscores.
  working = working.replace(/[-_]+$/g, "").trim();

  return working || null;
}

export function parseSeriesInfo(displayName) {
  const empty = { title: null, season: null, isCompleteSeries: false };
  if (!displayName) return empty;

  const normalized = normalizeSeparators(displayName);
  if (!normalized) return empty;

  const isCompleteSeries = detectCompleteSeries(normalized);
  const season = detectSeason(normalized);
  const title = extractTitle(normalized);

  return { title, season, isCompleteSeries };
}
