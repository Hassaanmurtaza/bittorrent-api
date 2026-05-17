export async function qbFetch(config, path, options = {}) {
  const base = config.qbittorrentUrl.replace(/\/+$/g, "");
  try {
    return await fetch(`${base}${path}`, options);
  } catch (error) {
    throw new Error(
      `Could not reach qBittorrent Web UI at ${base}. Open qBittorrent, enable Tools -> Options -> Web UI, and check config.json. (${error.cause?.code || error.message})`
    );
  }
}

export async function login(config) {
  const body = new URLSearchParams({
    username: config.username,
    password: config.password
  });

  const response = await qbFetch(config, "/api/v2/auth/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  const text = await response.text();
  if (!response.ok || text.trim() !== "Ok.") {
    throw new Error(
      "qBittorrent login failed. Check Web UI URL, username, password, and Web UI settings."
    );
  }

  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("qBittorrent did not return a session cookie.");
  }

  return cookie;
}

export async function addToQbittorrent(config, urls, options = {}) {
  const cookie = await login(config);
  const form = new FormData();
  form.set("urls", urls.join("\n"));

  const category = options.category ?? config.defaultCategory;
  if (category) {
    form.set("category", category);
  }

  const paused = options.paused ?? config.startPaused;
  form.set("paused", paused ? "true" : "false");

  if (options.savepath) {
    // Disable Auto Torrent Management so qBittorrent actually honors the
    // savepath we send. With autoTMM=true the path is derived from the
    // category instead and our value is silently ignored.
    form.set("autoTMM", "false");
    form.set("savepath", options.savepath);
  }

  const response = await qbFetch(config, "/api/v2/torrents/add", {
    method: "POST",
    headers: { cookie },
    body: form
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`qBittorrent rejected the torrent add request: ${text || response.status}`);
  }

  return text || "Ok.";
}
