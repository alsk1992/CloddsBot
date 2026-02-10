/**
 * Trade History Service - Fetch and analyze trade history
 *
 * Features:
 * - Fetch trades from Polymarket/Kalshi APIs
 * - Calculate daily/weekly/monthly PnL
 * - Win rate and performance metrics
 * - Store in SQLite for persistence
 */

import { logger } from '../utils/logger';
import { Database } from '../db/index';
import {
  buildPolymarketHeadersForUrl,
  PolymarketApiKeyAuth,
} from '../utils/polymarket-auth';
import {
  buildKalshiHeadersForUrl,
  KalshiApiKeyAuth,
} from '../utils/kalshi-auth';

// =============================================================================
// TYPES
// =============================================================================

export interface Trade {
  id: string;
  platform: 'polymarket' | 'kalshi';
  marketId: string;
  marketQuestion?: string;
  outcome: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  value: number;
  fee: number;
  timestamp: Date;
  orderId?: string;
  transactionHash?: string;
}

export interface TradeStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalVolume: number;
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
}

export interface DailyPnL {
  date: string;
  pnl: number;
  trades: number;
  volume: number;
}

export interface TradeHistoryConfig {
  polymarket?: PolymarketApiKeyAuth;
  kalshi?: KalshiApiKeyAuth;
}

export interface TradeHistoryService {
  /** Fetch recent trades from APIs */
  fetchTrades(limit?: number): Promise<Trade[]>;

  /** Get trades from local storage */
  getTrades(filters?: TradeFilters): Trade[];

  /** Get trade by ID */
  getTradeById(id: string): Trade | null;

  /** Sync trades to database */
  syncToDatabase(): Promise<number>;

  /** Get daily PnL for last N days */
  getDailyPnL(days?: number): DailyPnL[];

  /** Get trading statistics */
  getStats(period?: 'day' | 'week' | 'month' | 'all'): TradeStats;

  /** Get today's PnL */
  getTodayPnL(): number;

  /** Get total realized PnL */
  getTotalPnL(): number;

  /** Format trades for chat display */
  formatRecentTrades(limit?: number): string;

  /** Format stats for chat display */
  formatStats(): string;
}

export interface TradeFilters {
  platform?: 'polymarket' | 'kalshi';
  marketId?: string;
  side?: 'buy' | 'sell';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

// =============================================================================
// POLYMARKET API
// =============================================================================

const POLY_CLOB_URL = 'https://clob.polymarket.com';

interface PolymarketTrade {
  id: string;
  market: string;
  asset_id: string;
  side: 'BUY' | 'SELL';
  size: string;
  price: string;
  fee_rate_bps?: string;
  status: string;
  created_at: string;
  match_time?: string;
  outcome?: string;
  transaction_hash?: string;
}

async function fetchPolymarketTrades(
  auth: PolymarketApiKeyAuth,
  limit: number = 100
): Promise<Trade[]> {
  const url = `${POLY_CLOB_URL}/trades?limit=${limit}`;
  const headers = buildPolymarketHeadersForUrl(auth, 'GET', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch Polymarket trades');
      return [];
    }

    const data = (await response.json()) as PolymarketTrade[];

    return data.map((t) => {
      const shares = parseFloat(t.size) || 0;
      const price = parseFloat(t.price) || 0;
      const feeRate = (parseFloat(t.fee_rate_bps ?? '0') || 0) / 10000;
      const value = shares * price;
      const fee = value * feeRate;

      return {
        id: `poly_${t.id}`,
        platform: 'polymarket' as const,
        marketId: t.market,
        outcome: t.outcome || 'Unknown',
        side: t.side.toLowerCase() as 'buy' | 'sell',
        shares,
        price,
        value,
        fee,
        timestamp: new Date(t.match_time || t.created_at),
        transactionHash: t.transaction_hash,
      };
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching Polymarket trades');
    return [];
  }
}

// =============================================================================
// KALSHI API
// =============================================================================

const KALSHI_API_URL = 'https://api.elections.kalshi.com/trade-api/v2';

interface KalshiFill {
  trade_id: string;
  ticker: string;
  market_title?: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  count: number;
  yes_price: number;
  no_price: number;
  created_time: string;
  order_id: string;
}

async function fetchKalshiTrades(
  auth: KalshiApiKeyAuth,
  limit: number = 100
): Promise<Trade[]> {
  const url = `${KALSHI_API_URL}/portfolio/fills?limit=${limit}`;
  const headers = buildKalshiHeadersForUrl(auth, 'GET', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch Kalshi trades');
      return [];
    }

    const data = (await response.json()) as { fills: KalshiFill[] };

    return (data.fills || []).map((t) => {
      const price = (t.side === 'yes' ? t.yes_price : t.no_price) / 100;
      const shares = t.count;
      const value = shares * price;

      return {
        id: `kalshi_${t.trade_id}`,
        platform: 'kalshi' as const,
        marketId: t.ticker,
        marketQuestion: t.market_title,
        outcome: t.side === 'yes' ? 'Yes' : 'No',
        side: t.action,
        shares,
        price,
        value,
        fee: 0, // Kalshi fees are in spread
        timestamp: new Date(t.created_time),
        orderId: t.order_id,
      };
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching Kalshi trades');
    return [];
  }
}

// =============================================================================
// TRADE HISTORY SERVICE
// =============================================================================

export function createTradeHistoryService(
  config: TradeHistoryConfig,
  db?: Database
): TradeHistoryService {
  const trades: Trade[] = [];

  // Initialize database table if provided
  if (db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS trade_history (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        marketId TEXT NOT NULL,
        marketQuestion TEXT,
        outcome TEXT NOT NULL,
        side TEXT NOT NULL,
        shares REAL NOT NULL,
        price REAL NOT NULL,
        value REAL NOT NULL,
        fee REAL NOT NULL,
        timestamp TEXT NOT NULL,
        orderId TEXT,
        transactionHash TEXT
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trade_history(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_trades_platform ON trade_history(platform)`);

    // Load existing trades from database
    try {
      const rows = db.query<Trade & { timestamp: string }>(
        'SELECT * FROM trade_history ORDER BY timestamp DESC LIMIT 1000'
      );
      for (const row of rows) {
        trades.push({
          ...row,
          timestamp: new Date(row.timestamp),
        });
      }
      logger.info({ count: trades.length }, 'Loaded trades from database');
    } catch (err) {
      logger.debug('No existing trades in database');
    }
  }

  function getStartOfPeriod(period: 'day' | 'week' | 'month' | 'all'): Date {
    const now = new Date();
    switch (period) {
      case 'day':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'week':
        const dayOfWeek = now.getDay();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - dayOfWeek);
        startOfWeek.setHours(0, 0, 0, 0);
        return startOfWeek;
      case 'month':
        return new Date(now.getFullYear(), now.getMonth(), 1);
      case 'all':
      default:
        return new Date(0);
    }
  }

  const service: TradeHistoryService = {
    async fetchTrades(limit = 100) {
      const allTrades: Trade[] = [];

      if (config.polymarket) {
        const polyTrades = await fetchPolymarketTrades(config.polymarket, limit);
        allTrades.push(...polyTrades);
      }

      if (config.kalshi) {
        const kalshiTrades = await fetchKalshiTrades(config.kalshi, limit);
        allTrades.push(...kalshiTrades);
      }

      // Sort by timestamp descending
      allTrades.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Merge with existing trades (dedupe by ID)
      const existingIds = new Set(trades.map((t) => t.id));
      for (const trade of allTrades) {
        if (!existingIds.has(trade.id)) {
          trades.unshift(trade);
          existingIds.add(trade.id);
        }
      }

      // Keep sorted
      trades.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Cap in-memory trades to prevent unbounded growth
      if (trades.length > 5000) {
        trades.length = 5000;
      }

      logger.info({ fetched: allTrades.length, total: trades.length }, 'Fetched trades');
      return allTrades;
    },

    getTrades(filters) {
      let result = [...trades];

      if (filters?.platform) {
        result = result.filter((t) => t.platform === filters.platform);
      }
      if (filters?.marketId) {
        result = result.filter((t) => t.marketId === filters.marketId);
      }
      if (filters?.side) {
        result = result.filter((t) => t.side === filters.side);
      }
      if (filters?.startDate) {
        result = result.filter((t) => t.timestamp >= filters.startDate!);
      }
      if (filters?.endDate) {
        result = result.filter((t) => t.timestamp <= filters.endDate!);
      }
      if (filters?.limit) {
        result = result.slice(0, filters.limit);
      }

      return result;
    },

    getTradeById(id) {
      return trades.find((t) => t.id === id) || null;
    },

    async syncToDatabase() {
      if (!db) return 0;

      let synced = 0;
      for (const trade of trades) {
        try {
          db.run(
            `INSERT OR REPLACE INTO trade_history
             (id, platform, marketId, marketQuestion, outcome, side, shares, price, value, fee, timestamp, orderId, transactionHash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              trade.id,
              trade.platform,
              trade.marketId,
              trade.marketQuestion || null,
              trade.outcome,
              trade.side,
              trade.shares,
              trade.price,
              trade.value,
              trade.fee,
              trade.timestamp.toISOString(),
              trade.orderId || null,
              trade.transactionHash || null,
            ]
          );
          synced++;
        } catch (err) {
          logger.warn({ error: err, tradeId: trade.id }, 'Failed to sync trade');
        }
      }

      logger.info({ synced }, 'Synced trades to database');
      return synced;
    },

    getDailyPnL(days = 30) {
      const result: DailyPnL[] = [];
      const now = new Date();

      for (let i = 0; i < days; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().slice(0, 10);

        const dayTrades = trades.filter(
          (t) => t.timestamp.toISOString().slice(0, 10) === dateStr
        );

        // Simplified PnL calculation (buys negative, sells positive)
        const pnl = dayTrades.reduce((sum, t) => {
          return sum + (t.side === 'sell' ? t.value : -t.value) - t.fee;
        }, 0);

        const volume = dayTrades.reduce((sum, t) => sum + t.value, 0);

        result.push({
          date: dateStr,
          pnl,
          trades: dayTrades.length,
          volume,
        });
      }

      return result.reverse();
    },

    getStats(period = 'all') {
      const startDate = getStartOfPeriod(period);
      const periodTrades = trades.filter((t) => t.timestamp >= startDate);

      // Group trades by market to calculate per-market PnL
      const marketPnL = new Map<string, number>();
      for (const trade of periodTrades) {
        const key = `${trade.platform}_${trade.marketId}_${trade.outcome}`;
        const current = marketPnL.get(key) ?? 0;
        const tradeValue = trade.side === 'sell' ? trade.value : -trade.value;
        marketPnL.set(key, current + tradeValue - trade.fee);
      }

      const pnlValues = Array.from(marketPnL.values());
      const wins = pnlValues.filter((p) => p > 0);
      const losses = pnlValues.filter((p) => p < 0);

      const totalWins = wins.reduce((sum, p) => sum + p, 0);
      const totalLosses = Math.abs(losses.reduce((sum, p) => sum + p, 0));

      return {
        totalTrades: periodTrades.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        winRate: pnlValues.length > 0 ? (wins.length / pnlValues.length) * 100 : 0,
        totalVolume: periodTrades.reduce((sum, t) => sum + t.value, 0),
        totalPnL: pnlValues.reduce((sum, p) => sum + p, 0),
        avgWin: wins.length > 0 ? totalWins / wins.length : 0,
        avgLoss: losses.length > 0 ? totalLosses / losses.length : 0,
        profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
        largestWin: wins.length > 0 ? Math.max(...wins) : 0,
        largestLoss: losses.length > 0 ? Math.min(...losses) : 0,
      };
    },

    getTodayPnL() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return trades
        .filter((t) => t.timestamp >= today)
        .reduce((sum, t) => {
          return sum + (t.side === 'sell' ? t.value : -t.value) - t.fee;
        }, 0);
    },

    getTotalPnL() {
      const stats = this.getStats('all');
      return stats.totalPnL;
    },

    formatRecentTrades(limit = 10) {
      const recent = trades.slice(0, limit);

      if (recent.length === 0) {
        return '📭 No recent trades';
      }

      let text = `📜 **Recent Trades** (${recent.length})\n\n`;

      for (const trade of recent) {
        const sideEmoji = trade.side === 'buy' ? '🟢' : '🔴';
        const time = trade.timestamp.toLocaleTimeString();
        const question = trade.marketQuestion
          ? trade.marketQuestion.slice(0, 30) + (trade.marketQuestion.length > 30 ? '...' : '')
          : trade.marketId.slice(0, 15);

        text += `${sideEmoji} **${trade.side.toUpperCase()}** ${trade.shares.toFixed(2)} ${trade.outcome}\n`;
        text += `   ${question}\n`;
        text += `   $${trade.price.toFixed(3)} × ${trade.shares.toFixed(2)} = $${trade.value.toFixed(2)}\n`;
        text += `   _${time}_\n\n`;
      }

      return text;
    },

    formatStats() {
      const stats = this.getStats('all');
      const todayStats = this.getStats('day');
      const weekStats = this.getStats('week');

      let text = `📊 **Trading Statistics**\n\n`;

      text += `**All Time:**\n`;
      text += `  Trades: ${stats.totalTrades}\n`;
      text += `  Win Rate: ${stats.winRate.toFixed(1)}%\n`;
      text += `  Total PnL: $${stats.totalPnL.toFixed(2)}\n`;
      text += `  Volume: $${stats.totalVolume.toFixed(2)}\n\n`;

      text += `**This Week:**\n`;
      text += `  Trades: ${weekStats.totalTrades}\n`;
      text += `  PnL: $${weekStats.totalPnL.toFixed(2)}\n\n`;

      text += `**Today:**\n`;
      text += `  Trades: ${todayStats.totalTrades}\n`;
      text += `  PnL: $${todayStats.totalPnL.toFixed(2)}\n\n`;

      if (stats.totalTrades > 0) {
        text += `**Performance:**\n`;
        text += `  Avg Win: $${stats.avgWin.toFixed(2)}\n`;
        text += `  Avg Loss: $${stats.avgLoss.toFixed(2)}\n`;
        text += `  Profit Factor: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}\n`;
        text += `  Largest Win: $${stats.largestWin.toFixed(2)}\n`;
        text += `  Largest Loss: $${stats.largestLoss.toFixed(2)}\n`;
      }

      return text;
    },
  };

  return service;
}
