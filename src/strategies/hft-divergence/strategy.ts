/**
 * HFT Divergence Strategy — Main engine
 *
 * Wires: CryptoFeed → DivergenceDetector → MarketRotator → PositionManager → ExecutionService
 *
 * On each spot tick:
 *   1. Feed tick to detector
 *   2. detector.detect() → DivergenceSignal[]
 *   3. For best signal: check canOpen(), find market, place order
 *
 * Every 500ms:
 *   4. checkExits() → ExitSignal[] → sell orders
 */

import { logger } from '../../utils/logger.js';
import type { CryptoFeed, PriceUpdate } from '../../feeds/crypto/index.js';
import type { ExecutionService } from '../../execution/index.js';
import { createDivergenceDetector, type DivergenceDetector } from './detector.js';
import { createMarketRotator, type MarketRotator } from './market-rotator.js';
import { createDivPositionManager, type DivPositionManager } from './position-manager.js';
import type {
  HftDivergenceConfig,
  DivergenceSignal,
  DivPosition,
  DivClosedPosition,
  DivStats,
  DivMarket,
  DivExitReason,
} from './types.js';

// ── Engine Interface ────────────────────────────────────────────────────────

export interface HftDivergenceEngine {
  start(): Promise<void>;
  stop(): void;
  getStats(): DivStats;
  getPositions(): DivPosition[];
  getClosed(): DivClosedPosition[];
  getMarkets(): DivMarket[];
  getRoundInfo(): { slot: number; timeLeftSec: number };
  updateConfig(partial: Partial<HftDivergenceConfig>): void;
  getConfig(): HftDivergenceConfig;
}

export function createHftDivergenceEngine(
  feed: CryptoFeed,
  execution: ExecutionService | null,
  initialConfig: Partial<HftDivergenceConfig>
): HftDivergenceEngine {
  let config: HftDivergenceConfig = { ...DEFAULT_ENGINE_CONFIG, ...initialConfig };
  const getConfig = () => config;

  const detector: DivergenceDetector = createDivergenceDetector(config);
  const rotator: MarketRotator = createMarketRotator(getConfig);
  const positions: DivPositionManager = createDivPositionManager(getConfig);

  let running = false;
  let startedAt = 0;
  let exitTimer: NodeJS.Timeout | null = null;
  const unsubscribes: Array<() => void> = [];
  let orderInFlight = false;

  // ── Entry Logic ─────────────────────────────────────────────────────────

  async function onSpotTick(update: PriceUpdate) {
    if (!running) return;
    const asset = update.symbol;
    if (!config.assets.includes(asset)) return;

    // Warmup: skip first 10s
    if (Date.now() - startedAt < 10_000) return;

    detector.onSpotTick(asset, update.price, update.timestamp.getTime());

    const signals = detector.detect(asset);
    if (signals.length === 0) return;

    // Pick highest confidence signal
    signals.sort((a, b) => b.confidence - a.confidence);
    const best = signals[0];

    await tryEntry(best);
  }

  async function tryEntry(signal: DivergenceSignal) {
    if (orderInFlight) return;

    const canOpen = positions.canOpen(signal.asset);
    if (!canOpen.ok) return;

    const market = rotator.getMarket(signal.asset);
    if (!market) return;

    // Check time left
    const timeLeftSec = (market.expiresAt - Date.now()) / 1000;
    if (timeLeftSec < config.timeExitSec + 30) return; // not enough time

    const tokenId = signal.direction === 'up' ? market.upTokenId : market.downTokenId;
    const price = signal.direction === 'up' ? market.upPrice : market.downPrice;
    if (price <= 0) return;
    const shares = Math.floor((config.defaultSizeUsd / price) * 100) / 100;

    if (shares < 1 || !isFinite(shares)) return;

    orderInFlight = true;

    logger.info(
      {
        tag: signal.strategyTag,
        asset: signal.asset,
        dir: signal.direction,
        spotMove: signal.spotMovePct.toFixed(3) + '%',
        window: signal.windowSec + 's',
        polyMid: signal.polyMidPrice.toFixed(2),
        price: price.toFixed(2),
        shares,
        confidence: signal.confidence.toFixed(2),
        dryRun: config.dryRun,
      },
      'Divergence entry signal'
    );

    if (config.dryRun) {
      positions.open({
        asset: signal.asset,
        direction: signal.direction,
        tokenId,
        conditionId: market.conditionId,
        strategyTag: signal.strategyTag,
        entryPrice: price,
        shares,
        expiresAt: market.expiresAt,
      });
      orderInFlight = false;
      return;
    }

    if (!execution) {
      orderInFlight = false;
      return;
    }

    try {
      const result = await execution.buyLimit({
        platform: 'polymarket',
        marketId: market.conditionId,
        tokenId,
        price: config.preferMaker ? price : Math.min(0.99, price + config.takerBufferCents),
        size: shares,
        negRisk: config.negRisk,
        orderType: 'GTC',
        postOnly: config.preferMaker,
      });

      if (result.success && result.filledSize && result.filledSize > 0) {
        positions.open({
          asset: signal.asset,
          direction: signal.direction,
          tokenId,
          conditionId: market.conditionId,
          strategyTag: signal.strategyTag,
          entryPrice: result.avgFillPrice ?? price,
          shares: result.filledSize,
          expiresAt: market.expiresAt,
        });
      } else if (config.preferMaker && result.orderId) {
        // Maker didn't fill — cancel and try taker
        try { await execution.cancelOrder('polymarket', result.orderId); } catch { /* best effort */ }

        const takerResult = await execution.buyLimit({
          platform: 'polymarket',
          marketId: market.conditionId,
          tokenId,
          price: Math.min(0.99, price + config.takerBufferCents),
          size: shares,
          negRisk: config.negRisk,
          orderType: 'GTC',
        });

        if (takerResult.success && takerResult.filledSize && takerResult.filledSize > 0) {
          positions.open({
            asset: signal.asset,
            direction: signal.direction,
            tokenId,
            conditionId: market.conditionId,
            strategyTag: signal.strategyTag,
            entryPrice: takerResult.avgFillPrice ?? price,
            shares: takerResult.filledSize,
            expiresAt: market.expiresAt,
          });
        }
      }
    } catch (err) {
      logger.error({ err, tag: signal.strategyTag }, 'Divergence entry failed');
    } finally {
      orderInFlight = false;
    }
  }

  // ── Exit Logic ──────────────────────────────────────────────────────────

  async function checkExits() {
    if (!running) return;

    // Tick all open positions with latest poly prices
    for (const pos of positions.getOpen()) {
      const market = rotator.getMarket(pos.asset);
      if (!market) continue;
      const price = pos.direction === 'up' ? market.upPrice : market.downPrice;
      positions.tick(pos.id, price);
    }

    const exits = positions.checkExits();
    for (const exit of exits) {
      await executeExit(exit.positionId, exit.exitPrice, exit.reason);
    }
  }

  async function executeExit(positionId: string, exitPrice: number, reason: DivExitReason) {
    const pos = positions.getOpen().find((p) => p.id === positionId);
    if (!pos) return;

    if (config.dryRun || !execution) {
      positions.close(positionId, exitPrice, reason);
      return;
    }

    try {
      const useFok = reason === 'stop_loss' || reason === 'force_exit';
      const sellPrice = useFok
        ? Math.max(0.01, exitPrice - config.takerBufferCents)
        : exitPrice;

      const result = await execution.sellLimit({
        platform: 'polymarket',
        marketId: pos.conditionId,
        tokenId: pos.tokenId,
        price: sellPrice,
        size: Math.max(0.01, pos.shares - 0.02),
        negRisk: config.negRisk,
        orderType: useFok ? 'FOK' : 'GTC',
        postOnly: !useFok,
      });

      positions.close(positionId, result.avgFillPrice ?? exitPrice, reason);
    } catch (err) {
      logger.error({ err, positionId, reason }, 'Divergence exit failed');
      positions.close(positionId, exitPrice, reason);
    }
  }

  // ── Poly Price Updates ──────────────────────────────────────────────────

  function onPolyPrice(asset: string, midPrice: number) {
    detector.onPolyTick(asset, midPrice, Date.now());
  }

  // ── Public Interface ────────────────────────────────────────────────────

  return {
    async start() {
      if (running) return;
      running = true;
      startedAt = Date.now();

      logger.info(
        {
          assets: config.assets,
          windows: config.windows,
          dryRun: config.dryRun,
          size: config.defaultSizeUsd,
        },
        'HFT Divergence engine starting'
      );

      rotator.start();
      await rotator.refresh();

      // Subscribe to spot prices
      for (const asset of config.assets) {
        const unsub = feed.subscribeSymbol(asset, onSpotTick);
        unsubscribes.push(unsub);
      }

      // Exit check loop
      exitTimer = setInterval(checkExits, 500);
    },

    stop() {
      running = false;
      for (const unsub of unsubscribes) unsub();
      unsubscribes.length = 0;
      rotator.stop();
      if (exitTimer) { clearInterval(exitTimer); exitTimer = null; }
      logger.info('HFT Divergence engine stopped');
    },

    getStats: () => positions.getStats(),
    getPositions: () => positions.getOpen(),
    getClosed: () => positions.getClosed(),
    getMarkets: () => rotator.getActiveMarkets(),

    getRoundInfo() {
      const slot = rotator.getCurrentSlot();
      const expiresAt = (slot + 1) * config.marketDurationSec * 1000;
      return { slot, timeLeftSec: Math.max(0, (expiresAt - Date.now()) / 1000) };
    },

    updateConfig(partial) {
      config = { ...config, ...partial };
      logger.info({ updated: Object.keys(partial) }, 'Divergence config updated');
    },

    getConfig: () => ({ ...config }),
  };
}

// ── Default Config ──────────────────────────────────────────────────────────

const DEFAULT_ENGINE_CONFIG: HftDivergenceConfig = {
  assets: ['BTC', 'ETH', 'SOL', 'XRP'],
  marketDurationSec: 900,

  windows: [5, 10, 15, 30, 60, 90, 120],
  thresholdBuckets: [
    { min: 0.08, max: 0.10 },
    { min: 0.10, max: 0.12 },
    { min: 0.12, max: 0.14 },
    { min: 0.14, max: 0.16 },
    { min: 0.16, max: 0.20 },
    { min: 0.20, max: Infinity },
  ],
  minSpotMovePct: 0.08,
  maxPolyFreshnessSec: 5,
  maxPolyMidForEntry: 0.85,

  defaultSizeUsd: 20,
  maxPositionSizeUsd: 100,
  maxConcurrentPositions: 3,
  preferMaker: true,
  makerTimeoutMs: 15_000,
  takerBufferCents: 0.01,
  negRisk: true,

  takeProfitPct: 15,
  stopLossPct: 25,
  trailingStopPct: 8,
  trailingActivationPct: 10,
  forceExitSec: 30,
  timeExitSec: 120,

  maxDailyLossUsd: 200,
  cooldownAfterLossSec: 30,
  cooldownAfterExitSec: 15,
  dryRun: true,
};
