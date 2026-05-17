// Tiny TMDB client. We only need two endpoints (search-by-name and
// fetch-by-id), and we cache results in memory so a season pack with twelve
// episodes doesn't make twelve identical API calls.
//
// Supports either authentication style TMDB offers:
//   - v4 read access token  -> sent as `Authorization: Bearer <token>` header
//   - v3 API key            -> sent as `api_key` query parameter
// If both are provided, the v4 token wins. Either is enough.

const TMDB_BASE = "https://api.themoviedb.org/3";

function toYear(dateString) {
  if (typeof dateString !== "string" || dateString.length < 4) return null;
  const year = Number(dateString.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export class TmdbClient {
  constructor({ apiReadToken = "", apiKey = "", language = "en-US" } = {}) {
    this.apiReadToken = apiReadToken || "";
    this.apiKey = apiKey || "";
    this.language = language || "en-US";
    this.cache = new Map();
  }

  isConfigured() {
    return Boolean(this.apiReadToken || this.apiKey);
  }

  async _request(pathname, searchParams = {}) {
    const url = new URL(`${TMDB_BASE}${pathname}`);
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
    const headers = { accept: "application/json" };
    if (this.apiReadToken) {
      headers.authorization = `Bearer ${this.apiReadToken}`;
    } else if (this.apiKey) {
      url.searchParams.set("api_key", this.apiKey);
    } else {
      throw new Error("TMDB client is not configured (set tmdb.apiReadToken or tmdb.apiKey).");
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`TMDB request failed: ${response.status} ${body.slice(0, 200)}`);
    }
    return response.json();
  }

  async lookupTv(query) {
    if (!query || typeof query !== "string") return null;
    const cacheKey = `q:${query.toLowerCase()}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const data = await this._request("/search/tv", {
      query,
      language: this.language,
      include_adult: "false"
    });
    const first = Array.isArray(data?.results) ? data.results[0] : null;
    if (!first) {
      this.cache.set(cacheKey, null);
      return null;
    }
    const result = {
      name: first.name || first.original_name || query,
      year: toYear(first.first_air_date),
      tmdbId: first.id
    };
    this.cache.set(cacheKey, result);
    return result;
  }

  async lookupTvById(id) {
    if (id === null || id === undefined || id === "") return null;
    const cacheKey = `id:${id}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const data = await this._request(`/tv/${encodeURIComponent(id)}`, {
      language: this.language
    });
    const result = {
      name: data?.name || data?.original_name || null,
      year: toYear(data?.first_air_date),
      tmdbId: data?.id ?? Number(id)
    };
    this.cache.set(cacheKey, result);
    return result;
  }
}
