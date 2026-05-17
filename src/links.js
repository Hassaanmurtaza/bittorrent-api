const MAGNET_PATTERN = /magnet:\?[^\s<>"']+/gi;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

export function normalizeInput(input) {
  return String(input ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("\u200B", "")
    .trim();
}

function stripTrailingPunctuation(value) {
  return value.replace(/[),.;\]]+$/g, "");
}

function isTorrentUrl(value) {
  try {
    const parsed = new URL(value);
    return /\.torrent$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function extractSupportedLinks(input) {
  const text = normalizeInput(input);
  const links = new Set();

  for (const match of text.matchAll(MAGNET_PATTERN)) {
    links.add(stripTrailingPunctuation(match[0]));
  }

  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = stripTrailingPunctuation(match[0]);
    if (isTorrentUrl(candidate)) {
      links.add(candidate);
    }
  }

  return [...links];
}

export function hasUnsupportedWebUrl(input) {
  const text = normalizeInput(input);
  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = stripTrailingPunctuation(match[0]);
    if (!isTorrentUrl(candidate)) {
      return true;
    }
  }
  return false;
}
