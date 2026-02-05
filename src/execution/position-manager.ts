/**
 * Position Manager with Stop-Loss and Take-Profit Automation
 *
 * Features:
 * - Automatic stop-loss orders
 * - Automatic take-profit orders
 * - Trailing stops
 * - Position tracking across platforms
 * - P&L monitoring and alerts
 */

import { EventEmitter } from 'eventemitter3';
import { logger } from '../utils/logger';
import type { Platform } from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface Position {
  /** Unique position ID */
  id: string;
  /** Platform */
  platform: Platform;
  /** Market ID */
  marketId: string;
  /** Token/Outcome ID */
  tokenId: string;
  /** Outcome name */
  outcomeName: string;
  /** Position side (long = bought shares, short = sold) */
  side: 'long' | 'short';
  /** Number of shares */
  size: number;
  /** Average entry price */
  entryPrice: number;
  /** Current market price */
  currentPrice: number;
  /** Unrealized P&L in USD */
  unrealizedPnL: number;
  /** Unrealized P&L as percentage */
  unrealizedPnLPct: number;
  /** When position was opened */
  openedAt: Date;
  /** Stop-loss price (if set) */
  stopLoss?: number;
  /** Take-profit price (if set) */
  takeProfit?: number;
  /** Trailing stop distance (if set) */
  trailingStop?: number;
  /** Highest price seen (for trailing stop) */
  highWaterMark?: number;
  /** Lowest price seen (for trailing stop) */
  lowWaterMark?: number;
  /** Status */
  status: 'open' | 'closing' | 'closed';
  /** Tags for grouping */
  tags?: string[];
}

export interface StopLossConfig {
  /** Stop-loss price (absolute) */
  price?: number;
  /** Stop-loss as % from entry (e.g., 5 = 5% loss) */
  percentFromEntry?: number;
  /** Trailing stop as % (e.g., 3 = 3% trailing) */
  trailingPercent?: number;
}

export interface TakeProfitConfig {
  /** Take-profit price (absolute) */
  price?: number;
  /** Take-profit as % from entry (e.g., 10 = 10% profit) */
  percentFromEntry?: number;
  /** Partial take-profit levels */
  partialLevels?: Array<{ percent: number; sizePercent: number }>;
}

export interface PositionUpdate {
  positionId: string;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
}

export interface PositionClose {
  position: Position;
  closePrice: number;
  realizedPnL: number;
  reason: 'stop_loss' | 'take_profit' | 'trailing_stop' | 'manual' | 'expired';
}

export interface PositionManagerConfig {
  /** Default stop-loss % from entry (default: 10) */
  defaultStopLossPct: number;
  /** Default take-profit % from entry (default: 20) */
  defaultTakeProfitPct: number;
  /** Check interval in ms (default: 1000) */
  checkIntervalMs: number;
  /** Whether to auto-set stops on new positions (default: false) */
  autoSetStops: boolean;
  /** Callback to execute close orders */
  executeClose?: (position: Position, reason: string) => Promise<boolean>;
}

export interface PositionManager extends EventEmitter {
  /** Add or update a position */
  updatePosition(position: Omit<Position, 'id' | 'unrealizedPnL' | 'unrealizedPnLPct' | 'status'>): Position;

  /** Set stop-loss for a position */
  setStopLoss(positionId: string, config: StopLossConfig): void;

  /** Set take-profit for a position */
  setTakeProfit(positionId: string, config: TakeProfitConfig): void;

  /** Remove stop-loss from a position */
  removeStopLoss(positionId: string): void;

  /** Remove take-profit from a position */
  removeTakeProfit(positionId: string): void;

  /** Update current price for a position */
  updatePrice(positionId: string, price: number): void;

  /** Update prices for multiple positions */
  updatePrices(updates: Array<{ positionId: string; price: number }>): void;

  /** Get all positions */
  getPositions(): Position[];

  /** Get position by ID */
  getPosition(id: string): Position | undefined;

  /** Get positions by platform */
  getPositionsByPlatform(platform: Platform): Position[];

  /** Close a position manually */
  closePosition(positionId: string, closePrice: number, reason?: string): void;

  /** Get total unrealized P&L */
  getTotalUnrealizedPnL(): number;

  /** Get aggregate statistics */
  getStats(): {
    totalPositions: number;
    openPositions: number;
    totalUnrealizedPnL: number;
    positionsWithStopLoss: number;
    positionsWithTakeProfit: number;
    byPlatform: Record<Platform, { count: number; pnl: number }>;
  };

  /** Start monitoring */
  start(): void;

  /** Stop monitoring */
  stop(): void;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: PositionManagerConfig = {
  defaultStopLossPct: 10,
  defaultTakeProfitPct: 20,
  checkIntervalMs: 1000,
  autoSetStops: false,
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createPositionManager(
  config: Partial<PositionManagerConfig> = {}
): PositionManager {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const emitter = new EventEmitter() as PositionManager;

  const positions = new Map<string, Position>();
  let checkInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Generate position ID
   */
  function generateId(platform: Platform, marketId: string, tokenId: string): string {
    return `${platform}:${marketId}:${tokenId}`;
  }

  /**
   * Calculate unrealized P&L
   */
  function calculatePnL(position: Position): { pnl: number; pnlPct: number } {
    const priceDiff = position.currentPrice - position.entryPrice;
    const direction = position.side === 'long' ? 1 : -1;
    const pnl = priceDiff * position.size * direction;
    const pnlPct = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100 * direction;

    return { pnl, pnlPct };
  }

  /**
   * Check if stop-loss or take-profit triggered
   */
  function checkTriggers(position: Position): 'stop_loss' | 'take_profit' | 'trailing_stop' | null {
    if (position.status !== 'open') return null;

    const { currentPrice, entryPrice, side, stopLoss, takeProfit, trailingStop, highWaterMark, lowWaterMark } = position;

    // For long positions
    if (side === 'long') {
      // Stop-loss check
      if (stopLoss !== undefined && currentPrice <= stopLoss) {
        return 'stop_loss';
      }

      // Take-profit check
      if (takeProfit !== undefined && currentPrice >= takeProfit) {
        return 'take_profit';
      }

      // Trailing stop check
      if (trailingStop !== undefined && highWaterMark !== undefined) {
        const trailingStopPrice = highWaterMark * (1 - trailingStop / 100);
        if (currentPrice <= trailingStopPrice) {
          return 'trailing_stop';
        }
      }
    }

    // For short positions
    if (side === 'short') {
      // Stop-loss check (price goes up for shorts)
      if (stopLoss !== undefined && currentPrice >= stopLoss) {
        return 'stop_loss';
      }

      // Take-profit check (price goes down for shorts)
      if (takeProfit !== undefined && currentPrice <= takeProfit) {
        return 'take_profit';
      }

      // Trailing stop check
      if (trailingStop !== undefined && lowWaterMark !== undefined) {
        const trailingStopPrice = lowWaterMark * (1 + trailingStop / 100);
        if (currentPrice >= trailingStopPrice) {
          return 'trailing_stop';
        }
      }
    }

    return null;
  }

  /**
   * Update or create position
   */
  function updatePosition(
    input: Omit<Position, 'id' | 'unrealizedPnL' | 'unrealizedPnLPct' | 'status'>
  ): Position {
    const id = generateId(input.platform, input.marketId, input.tokenId);

    let position = positions.get(id);

    if (position) {
      // Update existing position
      position.currentPrice = input.currentPrice;
      position.size = input.size;
      position.entryPrice = input.entryPrice; // Could average if adding to position

      const { pnl, pnlPct } = calculatePnL(position);
      position.unrealizedPnL = pnl;
      position.unrealizedPnLPct = pnlPct;

      // Update water marks
      if (position.trailingStop !== undefined) {
        position.highWaterMark = Math.max(position.highWaterMark || 0, input.currentPrice);
        position.lowWaterMark = Math.min(position.lowWaterMark || Infinity, input.currentPrice);
      }
    } else {
      // Create new position
      position = {
        ...input,
        id,
        unrealizedPnL: 0,
        unrealizedPnLPct: 0,
        status: 'open',
        highWaterMark: input.currentPrice,
        lowWaterMark: input.currentPrice,
      };

      const { pnl, pnlPct } = calculatePnL(position);
      position.unrealizedPnL = pnl;
      position.unrealizedPnLPct = pnlPct;

      // Auto-set stops if enabled
      if (cfg.autoSetStops) {
        setStopLoss(id, { percentFromEntry: cfg.defaultStopLossPct });
        setTakeProfit(id, { percentFromEntry: cfg.defaultTakeProfitPct });
      }
    }

    positions.set(id, position);
    emitter.emit('position_updated', position);

    return position;
  }

  /**
   * Set stop-loss for a position
   */
  function setStopLoss(positionId: string, config: StopLossConfig): void {
    const position = positions.get(positionId);
    if (!position) {
      logger.warn({ positionId }, 'Position not found for stop-loss');
      return;
    }

    if (config.price !== undefined) {
      position.stopLoss = config.price;
    } else if (config.percentFromEntry !== undefined) {
      const direction = position.side === 'long' ? -1 : 1;
      position.stopLoss = position.entryPrice * (1 + (direction * config.percentFromEntry) / 100);
    }

    if (config.trailingPercent !== undefined) {
      position.trailingStop = config.trailingPercent;
      position.highWaterMark = position.currentPrice;
      position.lowWaterMark = position.currentPrice;
    }

    logger.info(
      { positionId, stopLoss: position.stopLoss, trailingStop: position.trailingStop },
      'Stop-loss set'
    );

    emitter.emit('stop_loss_set', { position, config });
  }

  /**
   * Set take-profit for a position
   */
  function setTakeProfit(positionId: string, config: TakeProfitConfig): void {
    const position = positions.get(positionId);
    if (!position) {
      logger.warn({ positionId }, 'Position not found for take-profit');
      return;
    }

    if (config.price !== undefined) {
      position.takeProfit = config.price;
    } else if (config.percentFromEntry !== undefined) {
      const direction = position.side === 'long' ? 1 : -1;
      position.takeProfit = position.entryPrice * (1 + (direction * config.percentFromEntry) / 100);
    }

    logger.info({ positionId, takeProfit: position.takeProfit }, 'Take-profit set');

    emitter.emit('take_profit_set', { position, config });
  }

  /**
   * Remove stop-loss
   */
  function removeStopLoss(positionId: string): void {
    const position = positions.get(positionId);
    if (position) {
      position.stopLoss = undefined;
      position.trailingStop = undefined;
      emitter.emit('stop_loss_removed', { position });
    }
  }

  /**
   * Remove take-profit
   */
  function removeTakeProfit(positionId: string): void {
    const position = positions.get(positionId);
    if (position) {
      position.takeProfit = undefined;
      emitter.emit('take_profit_removed', { position });
    }
  }

  /**
   * Update price for a position
   */
  function updatePrice(positionId: string, price: number): void {
    const position = positions.get(positionId);
    if (!position || position.status !== 'open') return;

    position.currentPrice = price;

    const { pnl, pnlPct } = calculatePnL(position);
    position.unrealizedPnL = pnl;
    position.unrealizedPnLPct = pnlPct;

    // Update water marks for trailing stop
    if (position.trailingStop !== undefined) {
      position.highWaterMark = Math.max(position.highWaterMark || 0, price);
      position.lowWaterMark = Math.min(position.lowWaterMark || Infinity, price);
    }

    // Check triggers
    const trigger = checkTriggers(position);
    if (trigger) {
      handleTrigger(position, trigger);
    }

    emitter.emit('price_updated', { positionId, price, pnl, pnlPct });
  }

  /**
   * Update multiple prices
   */
  function updatePrices(updates: Array<{ positionId: string; price: number }>): void {
    for (const update of updates) {
      updatePrice(update.positionId, update.price);
    }
  }

  /**
   * Handle trigger activation
   */
  async function handleTrigger(
    position: Position,
    trigger: 'stop_loss' | 'take_profit' | 'trailing_stop'
  ): Promise<void> {
    if (position.status !== 'open') return;

    position.status = 'closing';

    logger.info(
      {
        positionId: position.id,
        trigger,
        price: position.currentPrice,
        pnl: position.unrealizedPnL,
      },
      'Position trigger activated'
    );

    // Emit trigger event
    emitter.emit('trigger_activated', { position, trigger });

    // Execute close if callback provided
    if (cfg.executeClose) {
      try {
        const success = await cfg.executeClose(position, trigger);
        if (success) {
          closePosition(position.id, position.currentPrice, trigger);
        } else {
          // Failed to close - reset status
          position.status = 'open';
          logger.error({ positionId: position.id }, 'Failed to execute close order');
        }
      } catch (error) {
        position.status = 'open';
        logger.error({ error, positionId: position.id }, 'Error executing close order');
      }
    } else {
      // No execution callback - just emit event for manual handling
      closePosition(position.id, position.currentPrice, trigger);
    }
  }

  /**
   * Close a position
   */
  function closePosition(positionId: string, closePrice: number, reason = 'manual'): void {
    const position = positions.get(positionId);
    if (!position) return;

    position.status = 'closed';
    position.currentPrice = closePrice;

    const { pnl } = calculatePnL(position);

    const closeEvent: PositionClose = {
      position,
      closePrice,
      realizedPnL: pnl,
      reason: reason as PositionClose['reason'],
    };

    logger.info(
      {
        positionId,
        closePrice,
        realizedPnL: pnl,
        reason,
      },
      'Position closed'
    );

    emitter.emit('position_closed', closeEvent);

    // Remove from active tracking
    positions.delete(positionId);
  }

  /**
   * Get all positions
   */
  function getPositions(): Position[] {
    return Array.from(positions.values());
  }

  /**
   * Get position by ID
   */
  function getPosition(id: string): Position | undefined {
    return positions.get(id);
  }

  /**
   * Get positions by platform
   */
  function getPositionsByPlatform(platform: Platform): Position[] {
    return getPositions().filter((p) => p.platform === platform);
  }

  /**
   * Get total unrealized P&L
   */
  function getTotalUnrealizedPnL(): number {
    return getPositions().reduce((sum, p) => sum + p.unrealizedPnL, 0);
  }

  /**
   * Get aggregate statistics
   */
  function getStats(): ReturnType<PositionManager['getStats']> {
    const allPositions = getPositions();
    const openPositions = allPositions.filter((p) => p.status === 'open');

    const byPlatform: Record<Platform, { count: number; pnl: number }> = {} as any;

    for (const position of openPositions) {
      if (!byPlatform[position.platform]) {
        byPlatform[position.platform] = { count: 0, pnl: 0 };
      }
      byPlatform[position.platform].count++;
      byPlatform[position.platform].pnl += position.unrealizedPnL;
    }

    return {
      totalPositions: allPositions.length,
      openPositions: openPositions.length,
      totalUnrealizedPnL: getTotalUnrealizedPnL(),
      positionsWithStopLoss: openPositions.filter((p) => p.stopLoss !== undefined).length,
      positionsWithTakeProfit: openPositions.filter((p) => p.takeProfit !== undefined).length,
      byPlatform,
    };
  }

  /**
   * Start monitoring
   */
  function start(): void {
    checkInterval = setInterval(() => {
      // Periodic check of all positions
      for (const position of positions.values()) {
        if (position.status === 'open') {
          const trigger = checkTriggers(position);
          if (trigger) {
            handleTrigger(position, trigger);
          }
        }
      }
    }, cfg.checkIntervalMs);

    logger.info({ config: cfg }, 'Position manager started');
    emitter.emit('started');
  }

  /**
   * Stop monitoring
   */
  function stop(): void {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }

    logger.info('Position manager stopped');
    emitter.emit('stopped');
  }

  // Attach methods
  Object.assign(emitter, {
    updatePosition,
    setStopLoss,
    setTakeProfit,
    removeStopLoss,
    removeTakeProfit,
    updatePrice,
    updatePrices,
    getPositions,
    getPosition,
    getPositionsByPlatform,
    closePosition,
    getTotalUnrealizedPnL,
    getStats,
    start,
    stop,
  });

  return emitter;
}

// =============================================================================
// GLOBAL POSITION MANAGER
// =============================================================================

let globalPositionManager: PositionManager | null = null;

export function getGlobalPositionManager(): PositionManager {
  if (!globalPositionManager) {
    globalPositionManager = createPositionManager();
  }
  return globalPositionManager;
}
