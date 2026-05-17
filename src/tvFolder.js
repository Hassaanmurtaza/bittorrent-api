// Builds the Emby-friendly destination path for a TV-show torrent:
//   <baseDir>\<Show Name> (Year)\Season NN
// or for complete-series / unknown-season packs:
//   <baseDir>\<Show Name> (Year)

import path from "node:path";

const WINDOWS_RESERVED = /[<>:"/\\|?*\x00-\x1f]/g;
const TRAILING_DOTS_OR_SPACES = /[.\s]+$/;
const COLLAPSE_WS = /\s+/g;

export function sanitizeWindowsName(name) {
  if (name === null || name === undefined) return "";
  let cleaned = String(name).replace(WINDOWS_RESERVED, "");
  cleaned = cleaned.replace(COLLAPSE_WS, " ").trim();
  cleaned = cleaned.replace(TRAILING_DOTS_OR_SPACES, "");
  return cleaned;
}

export function formatSeasonFolder(season) {
  if (season === null || season === undefined || season === "") return null;
  const n = Number(season);
  if (!Number.isFinite(n) || n < 0) return null;
  return "Season " + String(n).padStart(2, "0");
}

export function buildTvSavepath({
  baseDir,
  showName,
  year,
  season,
  isCompleteSeries
} = {}) {
  if (!baseDir) return null;
  const safeName = sanitizeWindowsName(showName);
  if (!safeName) return baseDir;

  const folder = year ? safeName + " (" + year + ")" : safeName;
  const showDir = path.win32.join(baseDir, folder);

  if (isCompleteSeries) return showDir;

  const seasonFolder = formatSeasonFolder(season);
  if (!seasonFolder) return showDir;

  return path.win32.join(showDir, seasonFolder);
}
