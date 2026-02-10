/**
 * Divergence Detector — Rolling-window spot vs poly price divergence
 *
 * Ports signal detection from Rust's detect_divergence_scaled.
 *
 * For each spot tick, checks all configured windows (5s, 10s, ..., 120s):
 *   1. Binary search rolling buffer for spot price N seconds ago
 *   2. spotMovePct = (currentSpot - spotNSecsAgo) / spotNSecsAgo * 100
 *   3. If |spotMovePct| >= minSpotMovePct AND poly is fresh:
 *      → emit DivergenceSignal with strategy tag "BTC_DOWN_s12-14_w15"
 */

import type {
  HftDivergenceConfig,
  DivergenceSignal,
  Direction,
  ThresholdBucket,
} from './types.js';

// ── Rolling Price Buffer ────────────────────────────────────────────────────

interface PriceTick {
  price: number;
  ts: number; // unix ms
}

interface RollingBuffer {
  push(price: number, ts: number): void;
  /** Find price at approximately `secsAgo` seconds before latest. Uses binary search. */
  priceAt(secsAgo: number): number | null;
  latest(): PriceTick | null;
  size(): number;
}

function createRollingBuffer(maxAgeSec: number): RollingBuffer {
  const ticks: PriceTick[] = [];

  function prune(now: number) {
    const cutoff = now - maxAgeSec * 1000;
    while (ticks.length > 0 && ticks[0].ts < cutoff) {
      ticks.shift();
    }
  }

  return {
    push(price, ts) {
      ticks.push({ price, ts });
      prune(ts);
    },

    priceAt(secsAgo) {
      if (ticks.length === 0) return null;
      const latest = ticks[ticks.length - 1];
      const targetTs = latest.ts - secsAgo * 1000;

      // Binary search for closest tick at or before targetTs
      let lo = 0;
      let hi = ticks.length - 1;

      if (ticks[0].ts > targetTs) return null; // don't have data that far back

      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ticks[mid].ts <= targetTs) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }

      return ticks[lo].price;
    },

    latest() {
      return ticks.length > 0 ? ticks[ticks.length - 1] : null;
    },

    size() {
      return ticks.length;
    },
  };
}

// ── Bucket Labeling ─────────────────────────────────────────────────────────

function bucketLabel(bucket: ThresholdBucket): string {
  const minStr = (bucket.min * 100).toFixed(0).padStart(2, '0');
  if (bucket.max === Infinity) return `s${minStr}+`;
  const maxStr = (bucket.max * 100).toFixed(0).padStart(2, '0');
  return `s${minStr}-${maxStr}`;
}

function findBucket(
  spotMovePct: number,
  buckets: ThresholdBucket[]
): ThresholdBucket | null {
  const abs = Math.abs(spotMovePct);
  for (const b of buckets) {
    if (abs >= b.min && abs < b.max) return b;
  }
  return null;
}

// ── Strategy Tag Encoding ───────────────────────────────────────────────────
// Matches CLAUDE.md format: BTC_DOWN_s12-14_w15

function buildStrategyTag(
  asset: string,
  direction: Direction,
  bucket: ThresholdBucket,
  windowSec: number
): string {
  return `${asset}_${direction.toUpperCase()}_${bucketLabel(bucket)}_w${windowSec}`;
}

function buildWindowTag(asset: string, direction: Direction, windowSec: number): string {
  return `${asset}_${direction.toUpperCase()}_w${windowSec}`;
}

function buildThresholdTag(asset: string, direction: Direction, bucket: ThresholdBucket): string {
  return `${asset}_${direction.toUpperCase()}_${bucketLabel(bucket)}`;
}

// ── Detector ────────────────────────────────────────────────────────────────

export interface DivergenceDetector {
  /** Record a spot price tick */
  onSpotTick(asset: string, price: number, ts: number): void;
  /** Record a poly mid-price tick */
  onPolyTick(asset: string, midPrice: number, ts: number): void;
  /** Detect divergence signals for an asset (call after spot tick) */
  detect(asset: string): DivergenceSignal[];
  /** Get detector state for debugging */
  getState(asset: string): {
    spotTicks: number;
    latestSpot: number | null;
    latestPoly: number | null;
    polyFreshnessSec: number;
  } | null;
}

export function createDivergenceDetector(
  config: HftDivergenceConfig
): DivergenceDetector {
  // Per-asset rolling spot buffers (keep 150s of data for 120s max window)
  const spotBuffers = new Map<string, RollingBuffer>();
  // Per-asset latest poly mid-price + timestamp
  const polyState = new Map<string, { price: number; ts: number }>();
  // Signal counts for stats
  const signalCounts = new Map<string, number>();

  function getSpotBuffer(asset: string): RollingBuffer {
    let buf = spotBuffers.get(asset);
    if (!buf) {
      buf = createRollingBuffer(150); // 150s covers all windows + margin
      spotBuffers.set(asset, buf);
    }
    return buf;
  }

  return {
    onSpotTick(asset, price, ts) {
      getSpotBuffer(asset).push(price, ts);
    },

    onPolyTick(asset, midPrice, ts) {
      polyState.set(asset, { price: midPrice, ts });
    },

    detect(asset) {
      const buf = spotBuffers.get(asset);
      if (!buf || buf.size() < 2) return [];

      const latestTick = buf.latest();
      if (!latestTick) return [];

      const poly = polyState.get(asset);
      if (!poly) return [];

      // Check poly freshness
      const polyFreshnessSec = (latestTick.ts - poly.ts) / 1000;
      if (polyFreshnessSec > config.maxPolyFreshnessSec) return [];

      // Skip if poly already moved too far (already priced in)
      if (poly.price > config.maxPolyMidForEntry) return [];

      const signals: DivergenceSignal[] = [];

      for (const windowSec of config.windows) {
        const pastPrice = buf.priceAt(windowSec);
        if (pastPrice === null || pastPrice === 0) continue;

        const spotMovePct = ((latestTick.price - pastPrice) / pastPrice) * 100;

        if (Math.abs(spotMovePct) < config.minSpotMovePct) continue;

        const bucket = findBucket(spotMovePct, config.thresholdBuckets);
        if (!bucket) continue;

        const direction: Direction = spotMovePct > 0 ? 'up' : 'down';

        const strategyTag = buildStrategyTag(asset, direction, bucket, windowSec);
        const windowTag = buildWindowTag(asset, direction, windowSec);
        const thresholdTag = buildThresholdTag(asset, direction, bucket);

        // Confidence: higher spot move + fresher poly = higher confidence
        const moveConfidence = Math.min(1, Math.abs(spotMovePct) / 0.30);
        const freshnessConfidence = Math.max(0, 1 - polyFreshnessSec / config.maxPolyFreshnessSec);
        const confidence = moveConfidence * 0.7 + freshnessConfidence * 0.3;

        signalCounts.set(strategyTag, (signalCounts.get(strategyTag) ?? 0) + 1);
        if (signalCounts.size > 1000) {
          const oldest = signalCounts.keys().next().value;
          if (oldest !== undefined) signalCounts.delete(oldest);
        }

        signals.push({
          asset,
          direction,
          spotMovePct,
          windowSec,
          polyMidPrice: poly.price,
          polyFreshnessSec,
          spotPrice: latestTick.price,
          bucket: bucketLabel(bucket),
          strategyTag,
          windowTag,
          thresholdTag,
          confidence,
          timestamp: latestTick.ts,
        });
      }

      return signals;
    },

    getState(asset) {
      const buf = spotBuffers.get(asset);
      const poly = polyState.get(asset);
      if (!buf) return null;

      const latest = buf.latest();
      return {
        spotTicks: buf.size(),
        latestSpot: latest?.price ?? null,
        latestPoly: poly?.price ?? null,
        polyFreshnessSec: latest && poly ? (latest.ts - poly.ts) / 1000 : 999,
      };
    },
  };
}

export function getSignalCounts(): Map<string, number> {
  // Module-level accessor for stats
  return new Map();
}
