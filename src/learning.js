// Online learning of per-seed download throughput from observed qBittorrent
// snapshots. The poller calls updateLearning(snapshot) every status push, and
// the EMA refines until we have enough samples to trust over the static
// config fallback.
//
// Sample rule: each torrent in the "downloading" state with dlspeed above a
// noise floor and at least 1 seed contributes one observation:
//   sample_mbps_per_seed = (dlspeed_bps * 8) / (numSeeds * 1e6)
//
// EMA: learned = α * sample + (1 - α) * learned   (α = 0.05 ≈ "last ~20")

export const DEFAULT_LEARNING = {
  perSeedMbps: null,
  perSeedSamples: 0,
  totalMbpsObservedMax: 0,
  lastUpdate: null
};
export const EMA_ALPHA = 0.05;
export const MIN_SAMPLES_FOR_LEARNED = 20;
export const MIN_DLSPEED_BPS = 500_000; // 4 Mbps, filters out idle / handshake noise

export function updateLearning(prev, torrents) {
  const learning = {
    perSeedMbps: prev?.perSeedMbps ?? null,
    perSeedSamples: prev?.perSeedSamples ?? 0,
    totalMbpsObservedMax: prev?.totalMbpsObservedMax ?? 0,
    lastUpdate: new Date().toISOString()
  };
  if (!Array.isArray(torrents) || torrents.length === 0) return learning;

  let totalDlspeed = 0;
  for (const t of torrents) {
    if (!t || t.state !== "downloading") continue;
    totalDlspeed += Number(t.dlspeed) || 0;
    if (!Number.isFinite(t.dlspeed) || t.dlspeed < MIN_DLSPEED_BPS) continue;
    if (!Number.isFinite(t.numSeeds) || t.numSeeds < 1) continue;
    const sampleMbps = (t.dlspeed * 8) / (t.numSeeds * 1e6);
    if (learning.perSeedMbps === null) {
      learning.perSeedMbps = sampleMbps;
    } else {
      learning.perSeedMbps = EMA_ALPHA * sampleMbps + (1 - EMA_ALPHA) * learning.perSeedMbps;
    }
    learning.perSeedSamples += 1;
  }
  const totalMbps = (totalDlspeed * 8) / 1e6;
  if (totalMbps > learning.totalMbpsObservedMax) {
    learning.totalMbpsObservedMax = totalMbps;
  }
  return learning;
}

export function effectivePerSeedMbps(learning, fallbackMbps) {
  if (
    learning &&
    typeof learning.perSeedMbps === "number" &&
    Number.isFinite(learning.perSeedMbps) &&
    learning.perSeedMbps > 0 &&
    learning.perSeedSamples >= MIN_SAMPLES_FOR_LEARNED
  ) {
    return learning.perSeedMbps;
  }
  return fallbackMbps;
}

export function summarizeLearning(learning) {
  if (!learning || typeof learning !== "object") {
    return { samples: 0, perSeedMbps: null, trusted: false };
  }
  const samples = learning.perSeedSamples || 0;
  const perSeedMbps =
    typeof learning.perSeedMbps === "number" && Number.isFinite(learning.perSeedMbps)
      ? Math.round(learning.perSeedMbps * 10) / 10
      : null;
  return {
    samples,
    perSeedMbps,
    trusted: samples >= MIN_SAMPLES_FOR_LEARNED && perSeedMbps !== null,
    totalMbpsObservedMax: Math.round((learning.totalMbpsObservedMax || 0) * 10) / 10
  };
}
