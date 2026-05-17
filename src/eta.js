// Estimates real-world download speed and ETA for a search result based on
// the user's connection cap and the swarm health (seed count). Pure math,
// no I/O, so it lives outside any search provider.
//
// Model:
//   effective_bps = min(connection_bps, seeders * per_seed_bps)
//   eta_seconds   = size_bytes / (effective_bps / 8)
//
// per_seed_bps is the per-seeder average upload rate you observe in
// practice -- this varies wildly by torrent age, geography, and time of
// day. The default below (8 Mbps = 1 MB/s per seed) is a reasonable
// conservative starting point. Tune via config.bandwidth.perSeedMbps if
// your real downloads are consistently faster or slower than predicted.
//
// We also report a best-case / worst-case ETA range by multiplying the
// per-seed rate. Best case (fast swarm, fresh release): 2x. Worst case
// (slow seeders, ISP throttling, distant peers): 0.3x.

export const DEFAULT_DOWNLOAD_MBPS = 2350; // user's measured downlink
export const DEFAULT_PER_SEED_MBPS = 8;    // ~1 MB/s per seed (rule of thumb)
export const BEST_CASE_MULTIPLIER = 2.0;
export const WORST_CASE_MULTIPLIER = 0.3;

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return "<1m";
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return totalMinutes + "m";
  const totalHours = Math.floor(totalMinutes / 60);
  const restMinutes = totalMinutes % 60;
  if (totalHours < 24) return totalHours + "h " + restMinutes + "m";
  const days = Math.floor(totalHours / 24);
  const restHours = totalHours % 24;
  if (days < 30) return days + "d " + restHours + "h";
  return days + "d+";
}

export function computeEta(sizeBytes, seeds, downloadMbps, perSeedMbps) {
  const sz = Number(sizeBytes) || 0;
  const s = Number(seeds) || 0;
  const dlMbps = Number(downloadMbps) || DEFAULT_DOWNLOAD_MBPS;
  const psMbps = Number(perSeedMbps) || 0;
  if (sz <= 0 || s <= 0 || dlMbps <= 0 || psMbps <= 0) {
    return { effectiveMbps: 0, bytesPerSec: 0, etaSeconds: null };
  }
  const swarmMbps = s * psMbps;
  const effectiveMbps = Math.min(dlMbps, swarmMbps);
  const bytesPerSec = (effectiveMbps * 1e6) / 8;
  const etaSeconds = Math.round(sz / bytesPerSec);
  return { effectiveMbps, bytesPerSec, etaSeconds };
}

export function computeEtaRange(sizeBytes, seeds, downloadMbps, perSeedMbps) {
  const fast = computeEta(sizeBytes, seeds, downloadMbps, perSeedMbps * BEST_CASE_MULTIPLIER);
  const slow = computeEta(sizeBytes, seeds, downloadMbps, perSeedMbps * WORST_CASE_MULTIPLIER);
  return { fast, slow };
}

export function formatEtaRange(fastSeconds, slowSeconds) {
  const fastText = formatDuration(fastSeconds);
  const slowText = formatDuration(slowSeconds);
  if (fastText === "—" && slowText === "—") return "—";
  if (fastText === slowText) return fastText;
  return fastText + " – " + slowText;
}

// Returns a NEW object with eta fields added.
export function annotateEta(result, downloadMbps, perSeedMbps) {
  const center = computeEta(result?.sizeBytes, result?.seeds, downloadMbps, perSeedMbps);
  const { fast, slow } = computeEtaRange(
    result?.sizeBytes,
    result?.seeds,
    downloadMbps,
    perSeedMbps
  );
  return {
    ...result,
    etaSeconds: center.etaSeconds,
    etaText: formatDuration(center.etaSeconds),
    etaFastSeconds: fast.etaSeconds,
    etaSlowSeconds: slow.etaSeconds,
    etaRangeText: formatEtaRange(fast.etaSeconds, slow.etaSeconds),
    estimatedMBps: Math.round((center.bytesPerSec / 1e6) * 10) / 10,
    estimatedMbps: Math.round(center.effectiveMbps * 10) / 10
  };
}
