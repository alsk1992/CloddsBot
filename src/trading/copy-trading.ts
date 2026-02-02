/**
 * Copy Trading System
 *
 * Automatically mirrors trades from followed whale addresses.
 * Supports:
 * - Following multiple addresses
 * - Position sizing (fixed, proportional, or percentage)
 * - Delay before copying (to avoid front-running detection)
 * - Filters (min trade size, max position, markets)
 * - Stop loss / take profit
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger';
import type { Platform } from '../types';
import type { ExecutionService, OrderResult } from '../execution/index';
import type { WhaleTracker, WhaleTrade, WhalePosition, MarketCategory, CategoryPerformance } from '../feeds/polymarket/whale-tracker';
import { detectMarketCategory } from '../feeds/polymarket/whale-tracker';
import { hasIdentity, verifyAgent, type VerificationResult } from '../identity/erc8004';
import { getMarketFeatures, checkLiquidity, checkSpread, isHighVolatility } from '../services/feature-engineering';

// =============================================================================
// TYPES
// =============================================================================

export type SizingMode = 'fixed' | 'proportional' | 'percentage';

export interface CopyTradingConfig {
  /** Addresses to copy */
  followedAddresses: string[];
  /** Sizing mode (default: 'fixed') */
  sizingMode?: SizingMode;
  /** Fixed size in $ (for 'fixed' mode, default: 100) */
  fixedSize?: number;
  /** Proportion of whale's trade (for 'proportional' mode, default: 0.1 = 10%) */
  proportionMultiplier?: number;
  /** Percentage of portfolio (for 'percentage' mode, default: 5) */
  portfolioPercentage?: number;
  /** Maximum position size per market $ (default: 500) */
  maxPositionSize?: number;
  /** Minimum trade size to copy $ (default: 1000) */
  minTradeSize?: number;
  /** Delay before copying in ms (default: 5000) */
  copyDelayMs?: number;
  /** Maximum slippage % (default: 2) */
  maxSlippage?: number;
  /** Stop loss % (default: none) */
  stopLoss?: number;
  /** Take profit % (default: none) */
  takeProfit?: number;
  /** Markets to exclude */
  excludedMarkets?: string[];
  /** Only copy these platforms */
  enabledPlatforms?: Platform[];
  /** Dry run mode (default: true) */
  dryRun?: boolean;

  // Win Rate Filtering
  /** Minimum overall win rate % to copy (default: 0 = any) */
  minWinRate?: number;
  /** Minimum win rate % per category to copy (default: 55) */
  minCategoryWinRate?: number;
  /** Minimum trades in category before applying category filter (default: 5) */
  minCategoryTrades?: number;
  /** Categories to exclude from copying */
  excludedCategories?: MarketCategory[];

  // ERC-8004 Identity Verification
  /** Require ERC-8004 verified identity to copy (default: false) */
  requireVerifiedIdentity?: boolean;
  /** Minimum reputation score (0-100) to copy (default: 0 = any) */
  minReputationScore?: number;
  /** Network for identity verification (default: 'base-sepolia') */
  identityNetwork?: string;

  // Feature-based Filtering
  /** Enable feature-based market filtering (default: true) */
  useFeatureFilters?: boolean;
  /** Maximum volatility % to allow copying into (default: 10.0) */
  maxVolatility?: number;
  /** Minimum liquidity score to copy (default: 0.2) */
  minLiquidityScore?: number;
  /** Maximum spread % to copy into (default: 3.0) */
  maxSpreadPct?: number;
}

export interface CopiedTrade {
  id: string;
  originalTrade: WhaleTrade;
  copiedAt: Date;
  side: 'BUY' | 'SELL';
  size: number;
  entryPrice: number;
  exitPrice?: number;
  status: 'pending' | 'filled' | 'partial' | 'failed' | 'closed';
  pnl?: number;
  orderResult?: OrderResult;
}

export interface CopyTradingStats {
  totalCopied: number;
  totalSkipped: number;
  totalPnl: number;
  winRate: number;
  avgReturn: number;
  openPositions: number;
  followedAddresses: number;
}

export interface CopyTradingEvents {
  tradeCopied: (trade: CopiedTrade) => void;
  tradeSkipped: (trade: WhaleTrade, reason: string) => void;
  positionClosed: (trade: CopiedTrade, pnl: number) => void;
  error: (error: Error) => void;
}

export interface CopyTradingService extends EventEmitter<keyof CopyTradingEvents> {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  follow(address: string): void;
  unfollow(address: string): void;
  getFollowedAddresses(): string[];
  getCopiedTrades(limit?: number): CopiedTrade[];
  getOpenPositions(): CopiedTrade[];
  getStats(): CopyTradingStats;
  closePosition(tradeId: string): Promise<void>;
  closeAllPositions(): Promise<void>;
  updateConfig(config: Partial<CopyTradingConfig>): void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<CopyTradingConfig> = {
  followedAddresses: [],
  sizingMode: 'fixed',
  fixedSize: 100,
  proportionMultiplier: 0.1,
  portfolioPercentage: 5,
  maxPositionSize: 500,
  minTradeSize: 1000,
  copyDelayMs: 5000,
  maxSlippage: 2,
  stopLoss: 0,
  takeProfit: 0,
  excludedMarkets: [],
  enabledPlatforms: ['polymarket', 'kalshi'],
  dryRun: true,
  // Win Rate Filtering
  minWinRate: 0,
  minCategoryWinRate: 55,
  minCategoryTrades: 5,
  excludedCategories: [],
  // ERC-8004 Identity Verification
  requireVerifiedIdentity: false,
  minReputationScore: 0,
  identityNetwork: 'base',  // Mainnet (live Jan 29, 2026)
  // Feature-based Filtering
  useFeatureFilters: true,
  maxVolatility: 10.0,
  minLiquidityScore: 0.2,
  maxSpreadPct: 3.0,
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createCopyTradingService(
  whaleTracker: WhaleTracker,
  execution: ExecutionService | null,
  config: CopyTradingConfig
): CopyTradingService {
  const emitter = new EventEmitter() as CopyTradingService;
  let cfg = { ...DEFAULT_CONFIG, ...config };

  let running = false;
  const followedAddresses = new Set<string>(cfg.followedAddresses);
  const copiedTrades: CopiedTrade[] = [];
  const openPositions = new Map<string, CopiedTrade>();
  const pendingCopies = new Map<string, NodeJS.Timeout>();
  const monitoringIntervals = new Map<string, NodeJS.Timeout>();
  const MONITOR_INTERVAL_MS = 5000; // Check prices every 5 seconds

  // Whale performance tracking by category
  interface WhalePerformance {
    address: string;
    overallWinRate: number;
    overallTrades: number;
    byCategory: Map<MarketCategory, { wins: number; losses: number; trades: number; winRate: number }>;
  }
  const whalePerformance = new Map<string, WhalePerformance>();

  // Stats
  const stats: CopyTradingStats = {
    totalCopied: 0,
    totalSkipped: 0,
    totalPnl: 0,
    winRate: 0,
    avgReturn: 0,
    openPositions: 0,
    followedAddresses: followedAddresses.size,
  };

  // ==========================================================================
  // WHALE PERFORMANCE TRACKING
  // ==========================================================================

  function getOrCreateWhalePerformance(address: string): WhalePerformance {
    let perf = whalePerformance.get(address);
    if (!perf) {
      perf = {
        address,
        overallWinRate: 0,
        overallTrades: 0,
        byCategory: new Map(),
      };
      whalePerformance.set(address, perf);
    }
    return perf;
  }

  function updateWhalePerformance(address: string, category: MarketCategory, won: boolean): void {
    const perf = getOrCreateWhalePerformance(address);

    // Update overall stats
    perf.overallTrades++;

    // Update category stats
    let catStats = perf.byCategory.get(category);
    if (!catStats) {
      catStats = { wins: 0, losses: 0, trades: 0, winRate: 0 };
      perf.byCategory.set(category, catStats);
    }

    catStats.trades++;
    if (won) {
      catStats.wins++;
    } else {
      catStats.losses++;
    }
    catStats.winRate = catStats.trades > 0 ? (catStats.wins / catStats.trades) * 100 : 0;

    // Recalculate overall win rate
    let totalWins = 0;
    let totalTrades = 0;
    for (const cat of perf.byCategory.values()) {
      totalWins += cat.wins;
      totalTrades += cat.trades;
    }
    perf.overallWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
  }

  function checkWhaleWinRate(address: string, category: MarketCategory): { pass: boolean; reason?: string } {
    const perf = whalePerformance.get(address);

    // If no performance data, allow (will be tracked going forward)
    if (!perf) {
      return { pass: true };
    }

    // Check overall win rate if configured
    if (cfg.minWinRate > 0 && perf.overallTrades >= 10) {
      if (perf.overallWinRate < cfg.minWinRate) {
        return {
          pass: false,
          reason: `whale_overall_winrate_low (${perf.overallWinRate.toFixed(1)}% < ${cfg.minWinRate}%)`,
        };
      }
    }

    // Check category win rate if configured
    if (cfg.minCategoryWinRate > 0) {
      const catStats = perf.byCategory.get(category);
      if (catStats && catStats.trades >= cfg.minCategoryTrades) {
        if (catStats.winRate < cfg.minCategoryWinRate) {
          return {
            pass: false,
            reason: `whale_${category}_winrate_low (${catStats.winRate.toFixed(1)}% < ${cfg.minCategoryWinRate}% on ${catStats.trades} trades)`,
          };
        }
      }
    }

    return { pass: true };
  }

  // ==========================================================================
  // SIZING CALCULATION
  // ==========================================================================

  function calculateSize(trade: WhaleTrade, portfolioValue = 10000): number {
    let size: number;

    switch (cfg.sizingMode) {
      case 'fixed':
        size = cfg.fixedSize;
        break;

      case 'proportional':
        size = trade.usdValue * cfg.proportionMultiplier;
        break;

      case 'percentage':
        size = portfolioValue * (cfg.portfolioPercentage / 100);
        break;

      default:
        size = cfg.fixedSize;
    }

    // Cap at max position size
    return Math.min(size, cfg.maxPositionSize);
  }

  // ==========================================================================
  // TRADE FILTERING
  // ==========================================================================

  function shouldCopy(trade: WhaleTrade): { copy: boolean; reason?: string } {
    // Check if address is followed
    const whaleAddress = followedAddresses.has(trade.maker) ? trade.maker : trade.taker;
    if (!followedAddresses.has(trade.maker) && !followedAddresses.has(trade.taker)) {
      return { copy: false, reason: 'address_not_followed' };
    }

    // Check minimum size
    if (trade.usdValue < cfg.minTradeSize) {
      return { copy: false, reason: `trade_too_small ($${trade.usdValue} < $${cfg.minTradeSize})` };
    }

    // Check excluded markets
    if (cfg.excludedMarkets.includes(trade.marketId)) {
      return { copy: false, reason: 'market_excluded' };
    }

    // Detect category from market question
    const category = trade.category || detectMarketCategory(trade.marketQuestion || '');

    // Check excluded categories
    if (cfg.excludedCategories.includes(category)) {
      return { copy: false, reason: `category_excluded (${category})` };
    }

    // Check whale win rate (overall and by category)
    const winRateCheck = checkWhaleWinRate(whaleAddress, category);
    if (!winRateCheck.pass) {
      return { copy: false, reason: winRateCheck.reason };
    }

    // Check if we already have max position in this market
    const existingPosition = Array.from(openPositions.values()).find(
      (p) => p.originalTrade.marketId === trade.marketId
    );
    if (existingPosition && existingPosition.size * existingPosition.entryPrice >= cfg.maxPositionSize) {
      return { copy: false, reason: 'max_position_reached' };
    }

    // Feature-based market condition checks
    if (cfg.useFeatureFilters) {
      const features = getMarketFeatures('polymarket', trade.marketId, trade.tokenId);

      if (features) {
        // Check volatility
        if (isHighVolatility(features, cfg.maxVolatility)) {
          const volatilityPct = features.tick?.volatilityPct ?? 0;
          logger.debug(
            { marketId: trade.marketId, volatilityPct, maxVolatility: cfg.maxVolatility },
            'Skip copy: market too volatile'
          );
          return { copy: false, reason: `high_volatility (${volatilityPct.toFixed(2)}% > ${cfg.maxVolatility}%)` };
        }

        // Check liquidity
        if (!checkLiquidity(features, cfg.minLiquidityScore)) {
          const liquidityScore = features.signals.liquidityScore;
          logger.debug(
            { marketId: trade.marketId, liquidityScore, minLiquidityScore: cfg.minLiquidityScore },
            'Skip copy: low liquidity'
          );
          return { copy: false, reason: `low_liquidity (${liquidityScore.toFixed(2)} < ${cfg.minLiquidityScore})` };
        }

        // Check spread
        if (!checkSpread(features, cfg.maxSpreadPct)) {
          const spreadPct = features.orderbook?.spreadPct ?? 0;
          logger.debug(
            { marketId: trade.marketId, spreadPct, maxSpreadPct: cfg.maxSpreadPct },
            'Skip copy: wide spread'
          );
          return { copy: false, reason: `wide_spread (${spreadPct.toFixed(2)}% > ${cfg.maxSpreadPct}%)` };
        }
      }
    }

    return { copy: true };
  }

  // ==========================================================================
  // TRADE EXECUTION
  // ==========================================================================

  async function copyTrade(trade: WhaleTrade): Promise<void> {
    // ERC-8004 Identity Verification (if enabled)
    if (cfg.requireVerifiedIdentity) {
      const traderAddress = followedAddresses.has(trade.maker) ? trade.maker : trade.taker;

      try {
        const isVerified = await hasIdentity(traderAddress, cfg.identityNetwork as any);

        if (!isVerified) {
          logger.warn(
            { traderAddress, marketId: trade.marketId },
            'Skipping trade from UNVERIFIED trader (no ERC-8004 identity)'
          );
          emitter.emit('tradeSkipped', trade, 'unverified_identity');
          stats.totalSkipped++;
          return;
        }

        // Check minimum reputation if configured
        if (cfg.minReputationScore > 0) {
          // Note: Full reputation check requires agent ID lookup via indexer
          // For now, just verify identity exists
          logger.debug({ traderAddress }, 'Trader has verified identity');
        }
      } catch (error) {
        logger.warn(
          { error, traderAddress },
          'Failed to verify trader identity - skipping trade'
        );
        emitter.emit('tradeSkipped', trade, 'identity_verification_failed');
        stats.totalSkipped++;
        return;
      }
    }

    const tradeId = `copy_${trade.id}_${Date.now()}`;
    const size = calculateSize(trade);
    const shares = size / trade.price;

    const copiedTrade: CopiedTrade = {
      id: tradeId,
      originalTrade: trade,
      copiedAt: new Date(),
      side: trade.side,
      size: shares,
      entryPrice: trade.price,
      status: 'pending',
    };

    logger.info(
      {
        tradeId,
        marketId: trade.marketId,
        side: trade.side,
        size: shares,
        price: trade.price,
        dryRun: cfg.dryRun,
        verifiedTrader: cfg.requireVerifiedIdentity,
      },
      'Copying trade'
    );

    if (cfg.dryRun) {
      // Simulate successful execution
      copiedTrade.status = 'filled';
      copiedTrade.orderResult = {
        success: true,
        orderId: `dry_${tradeId}`,
        status: 'filled',
        filledSize: shares,
        avgFillPrice: trade.price,
      };
    } else if (execution) {
      try {
        // Execute the trade
        let result: OrderResult;

        if (trade.side === 'BUY') {
          result = await execution.buyLimit({
            platform: 'polymarket',
            marketId: trade.marketId,
            tokenId: trade.tokenId,
            outcome: trade.outcome,
            price: trade.price * (1 + cfg.maxSlippage / 100), // Allow slippage
            size: shares,
            orderType: 'GTC',
          });
        } else {
          result = await execution.sellLimit({
            platform: 'polymarket',
            marketId: trade.marketId,
            tokenId: trade.tokenId,
            outcome: trade.outcome,
            price: trade.price * (1 - cfg.maxSlippage / 100),
            size: shares,
            orderType: 'GTC',
          });
        }

        copiedTrade.orderResult = result;
        copiedTrade.status = result.success ? 'filled' : 'failed';
        copiedTrade.entryPrice = result.avgFillPrice || trade.price;
      } catch (error) {
        copiedTrade.status = 'failed';
        logger.error({ tradeId, error }, 'Failed to copy trade');
        emitter.emit('error', error instanceof Error ? error : new Error(String(error)));
        return;
      }
    } else {
      // No execution service - cannot execute real trades
      copiedTrade.status = 'failed';
      logger.error({ tradeId }, 'Cannot copy trade: no execution service configured');
      stats.totalSkipped++;
      emitter.emit('tradeSkipped', trade, 'No execution service configured');
      return;
    }

    copiedTrades.unshift(copiedTrade);
    if (copiedTrades.length > 1000) {
      copiedTrades.pop();
    }

    if (copiedTrade.status === 'filled') {
      openPositions.set(tradeId, copiedTrade);
      stats.totalCopied++;
      stats.openPositions = openPositions.size;

      logger.info({ tradeId, status: copiedTrade.status }, 'Trade copied successfully');
      emitter.emit('tradeCopied', copiedTrade);

      // Set up stop loss / take profit monitoring if configured
      if (cfg.stopLoss > 0 || cfg.takeProfit > 0) {
        monitorPosition(copiedTrade);
      }
    }
  }

  function monitorPosition(trade: CopiedTrade): void {
    // Clear any existing monitoring for this trade
    const existingInterval = monitoringIntervals.get(trade.id);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    logger.info(
      { tradeId: trade.id, stopLoss: cfg.stopLoss, takeProfit: cfg.takeProfit, entryPrice: trade.entryPrice },
      'Starting SL/TP monitoring for position'
    );

    // Set up periodic price checking
    const intervalId = setInterval(async () => {
      try {
        // Check if position still exists
        const position = openPositions.get(trade.id);
        if (!position || position.status === 'closed') {
          clearInterval(intervalId);
          monitoringIntervals.delete(trade.id);
          return;
        }

        // Fetch current price from whale tracker's market data
        const currentPrice = await getCurrentPrice(trade);
        if (currentPrice === null) {
          logger.debug({ tradeId: trade.id }, 'Could not fetch current price');
          return;
        }

        // Calculate PnL percentage
        const pnlPct = trade.side === 'BUY'
          ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

        // Check stop loss
        if (cfg.stopLoss > 0 && pnlPct <= -cfg.stopLoss) {
          logger.warn(
            { tradeId: trade.id, pnlPct, stopLoss: cfg.stopLoss, currentPrice },
            'Stop loss triggered - closing position'
          );
          clearInterval(intervalId);
          monitoringIntervals.delete(trade.id);
          await closePositionInternal(trade.id, 'stop_loss', currentPrice);
          return;
        }

        // Check take profit
        if (cfg.takeProfit > 0 && pnlPct >= cfg.takeProfit) {
          logger.info(
            { tradeId: trade.id, pnlPct, takeProfit: cfg.takeProfit, currentPrice },
            'Take profit triggered - closing position'
          );
          clearInterval(intervalId);
          monitoringIntervals.delete(trade.id);
          await closePositionInternal(trade.id, 'take_profit', currentPrice);
          return;
        }

        // Log periodic update
        logger.debug(
          { tradeId: trade.id, currentPrice, entryPrice: trade.entryPrice, pnlPct: pnlPct.toFixed(2) },
          'Position monitoring update'
        );
      } catch (error) {
        logger.error({ error, tradeId: trade.id }, 'Error in position monitoring');
      }
    }, MONITOR_INTERVAL_MS);

    monitoringIntervals.set(trade.id, intervalId);
  }

  async function getCurrentPrice(trade: CopiedTrade): Promise<number | null> {
    try {
      // Try to get price from whale tracker's cached market data
      const marketId = trade.originalTrade.marketId;
      const tokenId = trade.originalTrade.tokenId;

      // Fetch from Polymarket CLOB API
      const response = await fetch(`https://clob.polymarket.com/price?token_id=${tokenId}`);
      if (!response.ok) return null;

      const data = await response.json() as { price?: string };
      return data.price ? parseFloat(data.price) : null;
    } catch {
      return null;
    }
  }

  async function closePositionInternal(
    tradeId: string,
    reason: 'stop_loss' | 'take_profit' | 'manual',
    exitPrice: number
  ): Promise<void> {
    const position = openPositions.get(tradeId);
    if (!position) return;

    try {
      // Calculate final PnL
      const pnl = position.side === 'BUY'
        ? (exitPrice - position.entryPrice) * position.size
        : (position.entryPrice - exitPrice) * position.size;

      // Execute the close order (opposite side)
      const closeSide = position.side === 'BUY' ? 'sell' : 'buy';

      if (!cfg.dryRun && execution) {
        const result = await execution.protectedSell({
          platform: 'polymarket',
          marketId: position.originalTrade.marketId,
          tokenId: position.originalTrade.tokenId,
          price: exitPrice,
          size: position.size,
        }, cfg.maxSlippage / 100);

        if (!result.success) {
          logger.error({ tradeId, error: result.error }, 'Failed to close position');
          return;
        }
      } else if (!cfg.dryRun && !execution) {
        logger.error({ tradeId }, 'Cannot close position: no execution service configured');
        return;
      }

      // Update position state
      position.status = 'closed';
      position.exitPrice = exitPrice;
      position.pnl = pnl;

      // Update stats
      openPositions.delete(tradeId);
      stats.openPositions = openPositions.size;
      stats.totalPnl += pnl;

      // Calculate win rate
      const closedTrades = copiedTrades.filter(t => t.status === 'closed' && t.pnl !== undefined);
      const wins = closedTrades.filter(t => (t.pnl || 0) > 0).length;
      stats.winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
      stats.avgReturn = closedTrades.length > 0
        ? closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / closedTrades.length
        : 0;

      // Track whale performance by category
      const whaleAddress = followedAddresses.has(position.originalTrade.maker)
        ? position.originalTrade.maker
        : position.originalTrade.taker;
      const category = position.originalTrade.category ||
        detectMarketCategory(position.originalTrade.marketQuestion || '');
      const won = pnl > 0;
      updateWhalePerformance(whaleAddress, category, won);

      logger.info(
        { tradeId, reason, pnl, exitPrice, entryPrice: position.entryPrice, whaleAddress, category, won },
        'Position closed - whale performance updated'
      );

      emitter.emit('positionClosed', position, pnl);
    } catch (error) {
      logger.error({ error, tradeId }, 'Error closing position');
      emitter.emit('error', error as Error);
    }
  }

  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================

  function handleWhaleTrade(trade: WhaleTrade): void {
    const { copy, reason } = shouldCopy(trade);

    if (!copy) {
      stats.totalSkipped++;
      logger.debug({ tradeId: trade.id, reason }, 'Skipping trade');
      emitter.emit('tradeSkipped', trade, reason!);
      return;
    }

    // Schedule copy with delay
    const timeoutId = setTimeout(() => {
      pendingCopies.delete(trade.id);
      copyTrade(trade).catch((error) => {
        logger.error({ tradeId: trade.id, error }, 'Error copying trade');
      });
    }, cfg.copyDelayMs);

    pendingCopies.set(trade.id, timeoutId);
    logger.info({ tradeId: trade.id, delayMs: cfg.copyDelayMs }, 'Scheduled trade copy');
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  Object.assign(emitter, {
    start(): void {
      if (running) return;

      running = true;
      logger.info({ config: cfg, followedCount: followedAddresses.size }, 'Starting copy trading');

      // Listen to whale trades
      whaleTracker.on('trade', handleWhaleTrade);
    },

    stop(): void {
      if (!running) return;

      running = false;

      // Stop listening
      whaleTracker.off('trade', handleWhaleTrade);

      // Cancel pending copies
      for (const timeoutId of pendingCopies.values()) {
        clearTimeout(timeoutId);
      }
      pendingCopies.clear();

      // Stop all position monitoring
      for (const intervalId of monitoringIntervals.values()) {
        clearInterval(intervalId);
      }
      monitoringIntervals.clear();

      logger.info('Copy trading stopped');
    },

    isRunning(): boolean {
      return running;
    },

    follow(address: string): void {
      followedAddresses.add(address);
      whaleTracker.trackAddress(address);
      stats.followedAddresses = followedAddresses.size;
      logger.info({ address }, 'Now following address');
    },

    unfollow(address: string): void {
      followedAddresses.delete(address);
      stats.followedAddresses = followedAddresses.size;
      logger.info({ address }, 'Stopped following address');
    },

    getFollowedAddresses(): string[] {
      return Array.from(followedAddresses);
    },

    getCopiedTrades(limit = 100): CopiedTrade[] {
      return copiedTrades.slice(0, limit);
    },

    getOpenPositions(): CopiedTrade[] {
      return Array.from(openPositions.values());
    },

    getStats(): CopyTradingStats {
      return { ...stats };
    },

    async closePosition(tradeId: string): Promise<void> {
      const position = openPositions.get(tradeId);
      if (!position) {
        throw new Error(`Position ${tradeId} not found`);
      }

      // Stop monitoring this position
      const intervalId = monitoringIntervals.get(tradeId);
      if (intervalId) {
        clearInterval(intervalId);
        monitoringIntervals.delete(tradeId);
      }

      // Get current price for exit
      const currentPrice = await getCurrentPrice(position);
      const exitPrice = currentPrice ?? position.entryPrice;

      await closePositionInternal(tradeId, 'manual', exitPrice);
    },

    async closeAllPositions(): Promise<void> {
      const positions = Array.from(openPositions.keys());
      await Promise.all(positions.map(tradeId => emitter.closePosition(tradeId)));
    },

    updateConfig(newConfig: Partial<CopyTradingConfig>): void {
      cfg = { ...cfg, ...newConfig };

      if (newConfig.followedAddresses) {
        followedAddresses.clear();
        for (const addr of newConfig.followedAddresses) {
          followedAddresses.add(addr);
        }
        stats.followedAddresses = followedAddresses.size;
      }

      logger.info({ config: cfg }, 'Copy trading config updated');
    },
  } as Partial<CopyTradingService>);

  return emitter;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Find the best addresses to copy based on historical performance
 */
export async function findBestAddressesToCopy(
  whaleTracker: WhaleTracker,
  options: {
    minWinRate?: number;
    minTrades?: number;
    minAvgReturn?: number;
    limit?: number;
  } = {}
): Promise<Array<{ address: string; winRate: number; avgReturn: number; totalTrades: number }>> {
  const { minWinRate = 55, minTrades = 10, minAvgReturn = 5, limit = 10 } = options;

  const whales = whaleTracker.getKnownWhales();

  return whales
    .filter((w) => w.winRate >= minWinRate && w.avgReturn >= minAvgReturn)
    .filter((w) => w.recentTrades.length >= minTrades)
    .map((w) => ({
      address: w.address,
      winRate: w.winRate,
      avgReturn: w.avgReturn,
      totalTrades: w.recentTrades.length,
    }))
    .sort((a, b) => b.avgReturn - a.avgReturn)
    .slice(0, limit);
}

// =============================================================================
// EXPORTS
// =============================================================================

export type { CopyTradingConfig as CopyConfig };
