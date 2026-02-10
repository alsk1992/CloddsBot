/**
 * Crypto HFT Engine — Wires spot feed + poly orderbook → strategies → execution
 *
 * 4 strategies: momentum, mean_reversion, penny_clipper, expiry_fade
 * Real orderbook analysis, round-based market rotation, full exit logic from firstorder.rs
 */

import { logger } from '../../utils/logger.js';
import type { CryptoFeed, PriceUpdate } from '../../feeds/crypto/index.js';
import type { ExecutionService } from '../../execution/index.js';
import { createMarketScanner, type MarketScanner } from './market-scanner.js';
import { createPositionManager, type PositionManager } from './positions.js';
import {
  buildOrderbookSnapshot,
  createSpreadTracker,
  createDepthTracker,
  createBidTracker,
  type SpreadTracker,
  type DepthTracker,
  type BidTracker,
} from './orderbook.js';
import {
  createPriceBuffer,
  evaluateMomentum,
  evaluateMeanReversion,
  evaluatePennyClipper,
  evaluateExpiryFade,
  type PriceBuffer,
  type MomentumConfig,
  type MeanReversionConfig,
  type PennyClipperConfig,
  type ExpiryFadeConfig,
  DEFAULT_MOMENTUM,
  DEFAULT_MEAN_REVERSION,
  DEFAULT_PENNY_CLIPPER,
  DEFAULT_EXPIRY_FADE,
} from './strategies.js';
import type {
  CryptoHftConfig,
  CryptoMarket,
  TradeSignal,
  HftStats,
  OpenPosition,
  OrderbookSnapshot,
  OrderMode,
  ClosedPosition,
  ExitReason,
} from './types.js';

// ── Default Config (all real thresholds from firstorder.rs) ─────────────────

export const DEFAULT_CONFIG: CryptoHftConfig = {
  assets: ['BTC', 'ETH', 'SOL', 'XRP'],

  // Sizing
  sizeUsd: 20,
  minShares: 5.15,
  maxShares: 10,
  maxPositionUsd: 50,
  maxPositions: 3,

  // Round timing
  roundDurationSec: 900,
  minTimeLeftSec: 130,
  minRoundAgeSec: 30,
  forceExitSec: 30,
  warmupSec: 60,

  // Entry execution
  entryOrder: {
    mode: 'maker_then_taker',
    makerTimeoutMs: 15_000,
    takerBufferCents: 0.01,
    makerExitBufferCents: 0.01,
  },
  maxOrderbookStaleMs: 5_000,

  // Exit execution
  exitOrder: {
    mode: 'maker_then_taker',
    makerTimeoutMs: 1_000,
    takerBufferCents: 0.01,
    makerExitBufferCents: 0.01,
  },
  makerExitsForTpOnly: true,
  sellCooldownMs: 2_000,
  exitShareBuffer: 0.02,

  // TP/SL
  takeProfitPct: 15,
  stopLossPct: 12,

  // Ratchet
  ratchetEnabled: true,
  ratchetConfirmTicks: 3,
  ratchetConfirmTolerancePct: 0.5,

  // Trailing
  trailingEnabled: true,
  trailingLatePct: 7,
  trailingMidPct: 10,
  trailingWidePct: 15,

  // Advanced exits
  staleProfitPct: 9,
  staleProfitBidUnchangedSec: 7,
  stagnantProfitPct: 3,
  stagnantDurationSec: 13,
  depthCollapseThresholdPct: 60,

  // Risk
  maxDailyLossUsd: 200,
  stopLossCooldownSec: 180,
  exitCooldownSec: 60,
  negRisk: true,
  dryRun: true,
};

// ── Engine Interface ────────────────────────────────────────────────────────

export interface CryptoHftEngine {
  start(): Promise<void>;
  stop(): void;
  getStats(): HftStats;
  getPositions(): OpenPosition[];
  getClosed(): ClosedPosition[];
  getMarkets(): CryptoMarket[];
  getRoundInfo(): { slot: number; ageSec: number; timeLeftSec: number; canTrade: boolean };
  updateConfig(partial: Partial<CryptoHftConfig>): void;
  getConfig(): CryptoHftConfig;
  setStrategyEnabled(name: string, enabled: boolean): void;
  getEnabledStrategies(): Record<string, boolean>;
  /** Feed an orderbook update from poly WS */
  onOrderbook(tokenId: string, bids: Array<[number, number]>, asks: Array<[number, number]>): void;
}

export function createCryptoHftEngine(
  cryptoFeed: CryptoFeed,
  execution: ExecutionService | null,
  initialConfig?: Partial<CryptoHftConfig>,
  strategyConfigs?: {
    momentum?: Partial<MomentumConfig>;
    meanReversion?: Partial<MeanReversionConfig>;
    pennyClipper?: Partial<PennyClipperConfig>;
    expiryFade?: Partial<ExpiryFadeConfig>;
  }
): CryptoHftEngine {
  let config: CryptoHftConfig = { ...DEFAULT_CONFIG, ...initialConfig };
  const getConfig = () => config;
  const positionMgr: PositionManager = createPositionManager(getConfig);
  const scanner: MarketScanner = createMarketScanner(getConfig);

  // Orderbook trackers
  const spreadTracker: SpreadTracker = createSpreadTracker();
  const depthTracker: DepthTracker = createDepthTracker();
  const bidTracker: BidTracker = createBidTracker();
  const books = new Map<string, OrderbookSnapshot>();

  // Per-asset price buffers (spot + poly)
  const spotBuffers = new Map<string, PriceBuffer>();
  const polyBuffers = new Map<string, PriceBuffer>();
  const polyLastTs = new Map<string, number>(); // freshness

  // Strategy configs
  const momCfg: MomentumConfig = { ...DEFAULT_MOMENTUM, ...strategyConfigs?.momentum };
  const revCfg: MeanReversionConfig = { ...DEFAULT_MEAN_REVERSION, ...strategyConfigs?.meanReversion };
  const clipCfg: PennyClipperConfig = { ...DEFAULT_PENNY_CLIPPER, ...strategyConfigs?.pennyClipper };
  const fadeCfg: ExpiryFadeConfig = { ...DEFAULT_EXPIRY_FADE, ...strategyConfigs?.expiryFade };

  const enabled: Record<string, boolean> = {
    momentum: true,
    mean_reversion: true,
    penny_clipper: true,
    expiry_fade: true,
  };

  // State
  let running = false;
  let startedAt = 0;
  let exitCheckInterval: NodeJS.Timeout | null = null;
  const unsubscribes: Array<() => void> = [];
  let orderInFlight = false;
  let lastSellAt = 0;

  function getSpotBuffer(asset: string): PriceBuffer {
    let buf = spotBuffers.get(asset);
    if (!buf) {
      buf = createPriceBuffer(180);
      spotBuffers.set(asset, buf);
    }
    return buf;
  }

  function getPolyBuffer(asset: string): PriceBuffer {
    let buf = polyBuffers.get(asset);
    if (!buf) {
      buf = createPriceBuffer(180);
      polyBuffers.set(asset, buf);
    }
    return buf;
  }

  function getBook(tokenId: string): OrderbookSnapshot | null {
    const b = books.get(tokenId);
    if (!b) return null;
    if (Date.now() - b.timestamp > config.maxOrderbookStaleMs) return null;
    return b;
  }

  function computeShares(price: number): number {
    if (price <= 0) return config.minShares;
    const raw = config.sizeUsd / price;
    return Math.max(config.minShares, Math.min(config.maxShares, Math.floor(raw * 100) / 100));
  }

  async function executeEntry(signal: TradeSignal, market: CryptoMarket) {
    if (orderInFlight) return;
    orderInFlight = true;

    const shares = computeShares(signal.price);
    const isMaker = signal.orderMode === 'maker' || signal.orderMode === 'maker_then_taker';

    logger.info(
      {
        strategy: signal.strategy,
        asset: signal.asset,
        dir: signal.direction,
        price: signal.price.toFixed(2),
        shares,
        mode: signal.orderMode,
        confidence: signal.confidence.toFixed(2),
        reason: signal.reason,
        dryRun: config.dryRun,
      },
      'Entry signal'
    );

    if (config.dryRun) {
      positionMgr.open({
        strategy: signal.strategy,
        asset: signal.asset,
        direction: signal.direction,
        tokenId: signal.tokenId,
        conditionId: market.conditionId,
        entryPrice: signal.price,
        shares,
        expiresAt: market.expiresAt,
        wasMaker: isMaker,
      });
      orderInFlight = false;
      return;
    }

    if (!execution) {
      orderInFlight = false;
      return;
    }

    try {
      const postOnly = signal.orderMode === 'maker';
      const orderType = signal.orderMode === 'fok' ? 'FOK' as const : 'GTC' as const;

      const result = await execution.buyLimit({
        platform: 'polymarket',
        marketId: market.conditionId,
        tokenId: signal.tokenId,
        price: signal.orderMode === 'taker' || signal.orderMode === 'fok'
          ? Math.min(0.99, signal.price + config.entryOrder.takerBufferCents)
          : signal.price,
        size: shares,
        negRisk: config.negRisk,
        orderType,
        postOnly,
      });

      if (result.success && result.filledSize && result.filledSize > 0) {
        positionMgr.open({
          strategy: signal.strategy,
          asset: signal.asset,
          direction: signal.direction,
          tokenId: signal.tokenId,
          conditionId: market.conditionId,
          entryPrice: result.avgFillPrice ?? signal.price,
          shares: result.filledSize,
          expiresAt: market.expiresAt,
          wasMaker: postOnly,
        });
      } else if (signal.orderMode === 'maker_then_taker') {
        // Maker didn't fill or was rejected — cancel any resting order, then taker
        if (result.success && result.orderId) {
          try {
            await execution.cancelOrder('polymarket', result.orderId);
          } catch { /* best effort cancel */ }
        }
        logger.info({ strategy: signal.strategy, asset: signal.asset }, 'Maker unfilled, escalating to taker');
        const takerResult = await execution.buyLimit({
          platform: 'polymarket',
          marketId: market.conditionId,
          tokenId: signal.tokenId,
          price: Math.min(0.99, signal.price + config.entryOrder.takerBufferCents),
          size: shares,
          negRisk: config.negRisk,
          orderType: 'GTC',
        });

        if (takerResult.success && takerResult.filledSize && takerResult.filledSize > 0) {
          positionMgr.open({
            strategy: signal.strategy,
            asset: signal.asset,
            direction: signal.direction,
            tokenId: signal.tokenId,
            conditionId: market.conditionId,
            entryPrice: takerResult.avgFillPrice ?? signal.price,
            shares: takerResult.filledSize,
            expiresAt: market.expiresAt,
            wasMaker: false,
          });
        }
      } else if (!result.success) {
        logger.warn({ error: result.error, strategy: signal.strategy }, 'Entry order failed');
      }
    } catch (err) {
      logger.error({ err, strategy: signal.strategy }, 'Entry execution error');
    } finally {
      orderInFlight = false;
    }
  }

  async function executeExit(
    pos: OpenPosition,
    reason: ExitReason,
    exitPrice: number,
    useMaker: boolean
  ) {
    // Sell cooldown
    if (Date.now() - lastSellAt < config.sellCooldownMs) return;
    lastSellAt = Date.now();

    const sellShares = Math.max(0.01, Math.floor((pos.shares - config.exitShareBuffer) * 100) / 100);

    if (config.dryRun) {
      positionMgr.close(pos.id, exitPrice, reason, useMaker);
      return;
    }

    if (!execution) {
      positionMgr.close(pos.id, exitPrice, reason, useMaker);
      return;
    }

    try {
      const sellPrice = useMaker
        ? exitPrice
        : Math.max(0.01, exitPrice - config.exitOrder.takerBufferCents);

      const result = await execution.sellLimit({
        platform: 'polymarket',
        marketId: pos.conditionId,
        tokenId: pos.tokenId,
        price: sellPrice,
        size: sellShares,
        negRisk: config.negRisk,
        orderType: useMaker ? 'GTC' as const : 'FOK' as const,
        postOnly: useMaker,
      });

      positionMgr.close(
        pos.id,
        result.avgFillPrice ?? exitPrice,
        reason,
        useMaker && result.success
      );
    } catch (err) {
      logger.error({ err, positionId: pos.id, reason }, 'Exit execution error');
      positionMgr.close(pos.id, exitPrice, reason, false);
    }
  }

  function onSpotTick(update: PriceUpdate) {
    if (!running) return;
    const asset = update.symbol;
    if (!config.assets.includes(asset)) return;

    getSpotBuffer(asset).push(update.price);

    // Only evaluate on spot ticks
    evaluateAll(asset);
  }

  function evaluateAll(asset: string) {
    // Warmup check
    if (Date.now() - startedAt < config.warmupSec * 1000) return;

    // Round timing check
    const roundCheck = scanner.canTrade();
    if (!roundCheck.ok) return;

    const market = scanner.getMarket(asset);
    if (!market) return;

    // Can we open?
    const spotBuf = getSpotBuffer(asset);
    const polyBuf = getPolyBuffer(asset);

    // Gather context
    const round = scanner.getRound();
    const upBook = getBook(market.upTokenId);
    const downBook = getBook(market.downTokenId);
    const spotMove30 = spotBuf.movePct(30);
    const spotMove60 = spotBuf.movePct(60);
    const spotMove5 = spotBuf.movePct(5);
    const polyAge = polyLastTs.has(market.conditionId)
      ? (Date.now() - polyLastTs.get(market.conditionId)!) / 1000
      : 999;

    // Evaluate each enabled strategy
    const signals: TradeSignal[] = [];

    if (enabled.momentum) {
      // Momentum picks direction from spot move, use matching book
      const momBook = spotMove30 > 0 ? upBook : downBook;
      const sig = evaluateMomentum(market, spotMove30, 30, momBook, polyAge, momCfg);
      if (sig) signals.push(sig);
    }

    if (enabled.mean_reversion) {
      // Mean reversion: try with up book first, if result trades DOWN re-check with down book
      let sig = evaluateMeanReversion(market, spotMove60, round.ageSec, upBook, revCfg);
      if (sig && sig.direction === 'down' && downBook) {
        // Re-evaluate with the correct book for the DOWN side
        sig = evaluateMeanReversion(market, spotMove60, round.ageSec, downBook, revCfg);
      }
      if (sig) signals.push(sig);
    }

    if (enabled.penny_clipper) {
      // Penny clipper evaluates both sides, use UP book (spread similar on both)
      const sig = evaluatePennyClipper(market, spotBuf, polyBuf, upBook ?? downBook, clipCfg);
      if (sig) signals.push(sig);
    }

    if (enabled.expiry_fade) {
      // Expiry fade buys the cheap side
      const sig = evaluateExpiryFade(market, spotMove5, upBook ?? downBook, fadeCfg);
      if (sig) signals.push(sig);
    }

    if (signals.length === 0) return;

    // Pick highest confidence signal
    signals.sort((a, b) => b.confidence - a.confidence);
    const best = signals[0];

    // Pre-check: can we open for this asset+direction?
    const canOpen = positionMgr.canOpen(best.asset, best.direction);
    if (!canOpen.ok) return;

    executeEntry(best, market);
  }

  function checkExits() {
    if (!running) return;

    const exits = positionMgr.checkExits(getBook);

    for (const { position, reason, exitPrice, useMaker } of exits) {
      // For stop loss, always use FOK (speed)
      const actualUseMaker = reason === 'stop_loss' || reason === 'force_exit' ? false : useMaker;
      executeExit(position, reason, exitPrice, actualUseMaker);
    }

    // Also tick all positions with current prices
    for (const pos of positionMgr.getOpen()) {
      const book = getBook(pos.tokenId);
      const price = book?.bestBid ?? pos.currentPrice;
      positionMgr.tick(pos.id, price, book);
    }
  }

  return {
    async start() {
      if (running) return;
      running = true;
      startedAt = Date.now();

      logger.info(
        {
          assets: config.assets,
          dryRun: config.dryRun,
          size: config.sizeUsd,
          strategies: Object.entries(enabled).filter(([, v]) => v).map(([k]) => k),
        },
        'Crypto HFT engine starting'
      );

      scanner.start();
      await scanner.refresh();

      // Subscribe to spot prices
      for (const asset of config.assets) {
        const unsub = cryptoFeed.subscribeSymbol(asset, onSpotTick);
        unsubscribes.push(unsub);
      }

      // Exit check loop (every 500ms — real HFT needs fast exits)
      exitCheckInterval = setInterval(checkExits, 500);
    },

    stop() {
      running = false;
      for (const unsub of unsubscribes) unsub();
      unsubscribes.length = 0;
      scanner.stop();
      if (exitCheckInterval) { clearInterval(exitCheckInterval); exitCheckInterval = null; }
      logger.info('Crypto HFT engine stopped');
    },

    onOrderbook(tokenId, bids, asks) {
      const snapshot = buildOrderbookSnapshot(tokenId, bids, asks);
      books.set(tokenId, snapshot);
      spreadTracker.record(tokenId, snapshot.spread);
      depthTracker.record(tokenId, snapshot.bidDepth, snapshot.askDepth);
      bidTracker.record(tokenId, snapshot.bestBid);

      // Update poly price in market scanner + poly buffer
      for (const market of scanner.getRound().markets) {
        if (market.upTokenId === tokenId) {
          scanner.updatePrice(market.conditionId, snapshot.midPrice, market.downPrice);
          getPolyBuffer(market.asset).push(snapshot.midPrice);
          polyLastTs.set(market.conditionId, Date.now());
        } else if (market.downTokenId === tokenId) {
          scanner.updatePrice(market.conditionId, market.upPrice, snapshot.midPrice);
          getPolyBuffer(market.asset).push(snapshot.midPrice);
          polyLastTs.set(market.conditionId, Date.now());
        }
      }
    },

    getStats: () => positionMgr.getStats(),
    getPositions: () => positionMgr.getOpen(),
    getClosed: () => positionMgr.getClosed(),
    getMarkets: () => scanner.getRound().markets,

    getRoundInfo() {
      const round = scanner.getRound();
      const ct = scanner.canTrade();
      return { slot: round.slot, ageSec: round.ageSec, timeLeftSec: round.timeLeftSec, canTrade: ct.ok };
    },

    updateConfig(partial) {
      config = { ...config, ...partial };
      logger.info({ updated: Object.keys(partial) }, 'Config updated');
    },

    getConfig: () => ({ ...config }),

    setStrategyEnabled(name, value) {
      if (name in enabled) {
        enabled[name] = value;
        logger.info({ strategy: name, enabled: value }, 'Strategy toggled');
      }
    },

    getEnabledStrategies: () => ({ ...enabled }),
  };
}

// ── Re-exports ──────────────────────────────────────────────────────────────

export type { CryptoHftConfig, CryptoMarket, TradeSignal, HftStats, OpenPosition, ClosedPosition, OrderMode, StrategyPreset, OrderbookSnapshot } from './types.js';
export type { PositionManager } from './positions.js';
export type { MarketScanner } from './market-scanner.js';
export { createMarketScanner } from './market-scanner.js';
export { createPositionManager } from './positions.js';
export { buildOrderbookSnapshot, createSpreadTracker, createDepthTracker, createBidTracker } from './orderbook.js';
export { createPriceBuffer, evaluateMomentum, evaluateMeanReversion, evaluatePennyClipper, evaluateExpiryFade } from './strategies.js';
export { savePreset, loadPreset, deletePreset, listPresets, BUILT_IN_PRESETS } from './presets.js';
export { takerFee, takerFeePct } from './types.js';
