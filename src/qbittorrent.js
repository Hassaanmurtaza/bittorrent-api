export async function qbFetch(config, path, options = {}) {
  const base = config.qbittorrentUrl.replace(/\/+$/g, "");
  try {
    return await fetch(base + path, options);
  } catch (error) {
    const cause = (error.cause && error.cause.code) || error.message;
    throw new Error(
      "Could not reach qBittorrent Web UI at " + base +
      ". Open qBittorrent, enable Tools -> Options -> Web UI, and check config.json. (" + cause + ")"
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

  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : null;
  if (!cookie) {
    throw new Error("qBittorrent did not return a session cookie.");
  }

  return cookie;
}

export async function addToQbittorrent(config, urls, options = {}) {
  const cookie = await login(config);
  const form = new FormData();
  form.set("urls", urls.join("\n"));

  const category = options.category != null ? options.category : config.defaultCategory;
  if (category) {
    form.set("category", category);
  }

  const paused = options.paused != null ? options.paused : config.startPaused;
  form.set("paused", paused ? "true" : "false");

  if (options.savepath) {
    // Disable Auto Torrent Management so qBittorrent actually honors the
    // savepath we send. With autoTMM=true the path is derived from the
    // category instead and our value is silently ignored.
    form.set("autoTMM", "false");
    form.set("savepath", options.savepath);
  }

  if (options.contentLayout) {
    // qBittorrent 4.3.2+ understands contentLayout with values
    // "Original" / "Subfolder" / "NoSubfolder". Older versions used a boolean
    // root_folder field, so we send both for backwards compatibility.
    form.set("contentLayout", options.contentLayout);
    if (options.contentLayout === "NoSubfolder") {
      form.set("root_folder", "false");
    } else if (options.contentLayout === "Subfolder") {
      form.set("root_folder", "true");
    }
  }

  const response = await qbFetch(config, "/api/v2/torrents/add", {
    method: "POST",
    headers: { cookie },
    body: form
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error("qBittorrent rejected the torrent add request: " + (text || response.status));
  }

  return text || "Ok.";
}

export async function getTorrents(config) {
  const cookie = await login(config);
  const response = await qbFetch(config, "/api/v2/torrents/info", {
    headers: { cookie }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error("qBittorrent /torrents/info failed: " + response.status + " " + text.slice(0, 120));
  }
  const list = await response.json();
  if (!Array.isArray(list)) return [];
  return list.map((t) => ({
    hash: t.hash,
    name: t.name,
    state: t.state,
    progress: Number(t.progress) || 0,
    size: Number(t.size) || 0,
    downloaded: Number(t.downloaded) || 0,
    dlspeed: Number(t.dlspeed) || 0,
    upspeed: Number(t.upspeed) || 0,
    eta: Number(t.eta) || 0,
    numSeeds: Number(t.num_seeds) || 0,
    numLeechs: Number(t.num_leechs) || 0,
    numComplete: Number(t.num_complete) || 0,
    numIncomplete: Number(t.num_incomplete) || 0,
    addedOn: t.added_on,
    category: t.category,
    savePath: t.save_path,
    ratio: Number(t.ratio) || 0
  }));
}

export async function deleteTorrents(config, hashes, deleteFiles = false) {
  if (!Array.isArray(hashes) || hashes.length === 0) return;
  const cookie = await login(config);
  const form = new URLSearchParams();
  form.set("hashes", hashes.join("|"));
  form.set("deleteFiles", deleteFiles ? "true" : "false");
  const response = await qbFetch(config, "/api/v2/torrents/delete", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error("qBittorrent /torrents/delete failed: " + response.status + " " + text.slice(0, 120));
  }
}
