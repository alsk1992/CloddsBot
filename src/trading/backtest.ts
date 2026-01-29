/**
 * Backtest Engine - Test strategies on historical data
 *
 * Features:
 * - Walk-forward backtesting
 * - Multiple data sources (trades, external)
 * - Performance metrics calculation
 * - Sharpe/Sortino ratios
 * - Monte Carlo simulation
 */

import { Database } from '../db/index';
import { logger } from '../utils/logger';
import type { Platform } from '../types';
import type { Strategy, StrategyContext, Signal } from './bots/index';
import type { Trade } from './logger';

// =============================================================================
// TYPES
// =============================================================================

export interface BacktestConfig {
  /** Start date */
  startDate: Date;
  /** End date */
  endDate: Date;
  /** Initial capital */
  initialCapital: number;
  /** Commission per trade (%) */
  commissionPct: number;
  /** Slippage per trade (%) */
  slippagePct: number;
  /** Data resolution (ms) */
  resolutionMs: number;
  /** Risk-free rate for Sharpe calculation (annual %) */
  riskFreeRate: number;
}

export interface PriceBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestTrade {
  timestamp: Date;
  platform: Platform;
  marketId: string;
  outcome: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  commission: number;
  slippage: number;
  pnl?: number;
  signal?: Signal;
}

export interface BacktestResult {
  /** Strategy ID */
  strategyId: string;
  /** Config used */
  config: BacktestConfig;
  /** Performance metrics */
  metrics: BacktestMetrics;
  /** All trades */
  trades: BacktestTrade[];
  /** Equity curve */
  equityCurve: Array<{ timestamp: Date; equity: number }>;
  /** Daily returns */
  dailyReturns: Array<{ date: string; return: number }>;
  /** Drawdown series */
  drawdowns: Array<{ timestamp: Date; drawdownPct: number }>;
}

export interface BacktestMetrics {
  /** Total return (%) */
  totalReturnPct: number;
  /** Annualized return (%) */
  annualizedReturnPct: number;
  /** Total trades */
  totalTrades: number;
  /** Win rate (%) */
  winRate: number;
  /** Profit factor */
  profitFactor: number;
  /** Average trade return (%) */
  avgTradePct: number;
  /** Average winning trade (%) */
  avgWinPct: number;
  /** Average losing trade (%) */
  avgLossPct: number;
  /** Max drawdown (%) */
  maxDrawdownPct: number;
  /** Max drawdown duration (days) */
  maxDrawdownDays: number;
  /** Sharpe ratio (annualized) */
  sharpeRatio: number;
  /** Sortino ratio (annualized) */
  sortinoRatio: number;
  /** Calmar ratio (return / max drawdown) */
  calmarRatio: number;
  /** Total commission paid */
  totalCommission: number;
  /** Total slippage cost */
  totalSlippage: number;
  /** Final equity */
  finalEquity: number;
}

export interface BacktestEngine {
  /** Run backtest on a strategy */
  run(strategy: Strategy, config: BacktestConfig): Promise<BacktestResult>;

  /** Run backtest with custom price data */
  runWithData(
    strategy: Strategy,
    config: BacktestConfig,
    data: Map<string, PriceBar[]>
  ): Promise<BacktestResult>;

  /** Compare multiple strategies */
  compare(
    strategies: Strategy[],
    config: BacktestConfig
  ): Promise<{ results: BacktestResult[]; ranking: string[] }>;

  /** Run Monte Carlo simulation */
  monteCarlo(
    result: BacktestResult,
    simulations: number
  ): MonteCarloResult;

  /** Load historical data from trades */
  loadHistoricalData(
    platform: Platform,
    marketId: string,
    startDate: Date,
    endDate: Date
  ): Promise<PriceBar[]>;
}

export interface MonteCarloResult {
  simulations: number;
  /** Percentile outcomes */
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  /** Probability of profit */
  probabilityOfProfit: number;
  /** Probability of loss > 20% */
  probabilityOfMajorLoss: number;
  /** Expected value */
  expectedValue: number;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

const DEFAULT_CONFIG: BacktestConfig = {
  startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
  endDate: new Date(),
  initialCapital: 10000,
  commissionPct: 0.1, // 0.1%
  slippagePct: 0.05, // 0.05%
  resolutionMs: 60 * 60 * 1000, // 1 hour
  riskFreeRate: 5, // 5% annual
};

export function createBacktestEngine(db: Database): BacktestEngine {
  // Load historical prices from trade log
  async function loadPricesFromTrades(
    platform: Platform,
    marketId: string,
    startDate: Date,
    endDate: Date
  ): Promise<PriceBar[]> {
    const rows = db.query<{
      created_at: string;
      price: number;
      size: number;
    }>(
      `SELECT created_at, price, size FROM trades
       WHERE platform = ? AND market_id = ?
       AND created_at >= ? AND created_at <= ?
       ORDER BY created_at`,
      [platform, marketId, startDate.toISOString(), endDate.toISOString()]
    );

    // Aggregate into hourly bars
    const bars = new Map<string, PriceBar>();

    for (const row of rows) {
      const ts = new Date(row.created_at);
      const hourKey = `${ts.toISOString().slice(0, 13)}:00:00.000Z`;

      let bar = bars.get(hourKey);
      if (!bar) {
        bar = {
          timestamp: new Date(hourKey),
          open: row.price,
          high: row.price,
          low: row.price,
          close: row.price,
          volume: 0,
        };
        bars.set(hourKey, bar);
      }

      bar.high = Math.max(bar.high, row.price);
      bar.low = Math.min(bar.low, row.price);
      bar.close = row.price;
      bar.volume += row.size;
    }

    return Array.from(bars.values()).sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
  }

  function calculateMetrics(
    trades: BacktestTrade[],
    equityCurve: Array<{ timestamp: Date; equity: number }>,
    config: BacktestConfig
  ): BacktestMetrics {
    const closedTrades = trades.filter((t) => t.pnl !== undefined);
    const wins = closedTrades.filter((t) => (t.pnl || 0) > 0);
    const losses = closedTrades.filter((t) => (t.pnl || 0) < 0);

    // Basic metrics
    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalWins = wins.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + (t.pnl || 0), 0));
    const totalCommission = trades.reduce((sum, t) => sum + t.commission, 0);
    const totalSlippage = trades.reduce((sum, t) => sum + t.slippage, 0);

    const finalEquity = equityCurve.length > 0
      ? equityCurve[equityCurve.length - 1].equity
      : config.initialCapital;

    const totalReturnPct = ((finalEquity - config.initialCapital) / config.initialCapital) * 100;

    // Annualized return
    const days = (config.endDate.getTime() - config.startDate.getTime()) / (24 * 60 * 60 * 1000);
    const annualizedReturnPct = totalReturnPct * (365 / Math.max(1, days));

    // Win rate
    const winRate = closedTrades.length > 0
      ? (wins.length / closedTrades.length) * 100
      : 0;

    // Profit factor
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Average trade
    const avgTradePct = closedTrades.length > 0
      ? closedTrades.reduce((sum, t) => sum + ((t.pnl || 0) / t.price / t.size) * 100, 0) / closedTrades.length
      : 0;

    const avgWinPct = wins.length > 0
      ? wins.reduce((sum, t) => sum + ((t.pnl || 0) / t.price / t.size) * 100, 0) / wins.length
      : 0;

    const avgLossPct = losses.length > 0
      ? losses.reduce((sum, t) => sum + ((t.pnl || 0) / t.price / t.size) * 100, 0) / losses.length
      : 0;

    // Drawdown
    let maxDrawdownPct = 0;
    let maxDrawdownDays = 0;
    let peak = config.initialCapital;
    let drawdownStartDate: Date | null = null;

    for (const point of equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
        drawdownStartDate = null;
      } else {
        const drawdown = ((peak - point.equity) / peak) * 100;
        if (drawdown > maxDrawdownPct) {
          maxDrawdownPct = drawdown;
        }
        if (!drawdownStartDate) {
          drawdownStartDate = point.timestamp;
        }
        const ddDays = (point.timestamp.getTime() - drawdownStartDate.getTime()) / (24 * 60 * 60 * 1000);
        if (ddDays > maxDrawdownDays) {
          maxDrawdownDays = ddDays;
        }
      }
    }

    // Daily returns for Sharpe/Sortino
    const dailyReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].equity;
      const curr = equityCurve[i].equity;
      dailyReturns.push((curr - prev) / prev);
    }

    // Sharpe ratio
    const avgDailyReturn = dailyReturns.length > 0
      ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
      : 0;
    const stdDailyReturn = dailyReturns.length > 1
      ? Math.sqrt(dailyReturns.reduce((sum, r) => sum + (r - avgDailyReturn) ** 2, 0) / (dailyReturns.length - 1))
      : 0;
    const dailyRiskFree = config.riskFreeRate / 100 / 252;
    const sharpeRatio = stdDailyReturn > 0
      ? ((avgDailyReturn - dailyRiskFree) / stdDailyReturn) * Math.sqrt(252)
      : 0;

    // Sortino ratio (only downside deviation)
    const negativeReturns = dailyReturns.filter((r) => r < 0);
    const downsideDeviation = negativeReturns.length > 1
      ? Math.sqrt(negativeReturns.reduce((sum, r) => sum + r ** 2, 0) / negativeReturns.length)
      : 0;
    const sortinoRatio = downsideDeviation > 0
      ? ((avgDailyReturn - dailyRiskFree) / downsideDeviation) * Math.sqrt(252)
      : 0;

    // Calmar ratio
    const calmarRatio = maxDrawdownPct > 0 ? annualizedReturnPct / maxDrawdownPct : 0;

    return {
      totalReturnPct,
      annualizedReturnPct,
      totalTrades: trades.length,
      winRate,
      profitFactor,
      avgTradePct,
      avgWinPct,
      avgLossPct,
      maxDrawdownPct,
      maxDrawdownDays,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      totalCommission,
      totalSlippage,
      finalEquity,
    };
  }

  return {
    async run(strategy, config) {
      const cfg = { ...DEFAULT_CONFIG, ...config };

      // Load historical data for markets in strategy
      const data = new Map<string, PriceBar[]>();

      for (const platform of strategy.config.platforms) {
        const markets = strategy.config.markets || [];
        for (const marketId of markets) {
          const bars = await loadPricesFromTrades(platform, marketId, cfg.startDate, cfg.endDate);
          data.set(`${platform}:${marketId}`, bars);
        }
      }

      return this.runWithData(strategy, cfg, data);
    },

    async runWithData(strategy, config, data) {
      const cfg = { ...DEFAULT_CONFIG, ...config };
      const trades: BacktestTrade[] = [];
      const equityCurve: Array<{ timestamp: Date; equity: number }> = [];
      const positions = new Map<string, { shares: number; avgPrice: number; entryTime: Date }>();

      let equity = cfg.initialCapital;
      let cash = cfg.initialCapital;

      // Build timeline of all price points
      const timeline: Array<{ timestamp: Date; market: string; price: number }> = [];

      for (const [market, bars] of data) {
        for (const bar of bars) {
          timeline.push({ timestamp: bar.timestamp, market, price: bar.close });
        }
      }

      timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Simulate through timeline
      for (const point of timeline) {
        // Update position values
        const [platform, marketId] = point.market.split(':');
        const posKey = `${point.market}:yes`; // Simplified - just YES outcome

        const position = positions.get(posKey);
        if (position) {
          // Update unrealized PnL
          const posValue = position.shares * point.price;
          equity = cash + posValue;
        }

        // Build context for strategy
        const ctx: StrategyContext = {
          portfolioValue: equity,
          availableBalance: cash,
          positions: new Map(
            Array.from(positions.entries()).map(([k, v]) => [
              k,
              {
                shares: v.shares,
                avgPrice: v.avgPrice,
                currentPrice: point.price,
              },
            ])
          ),
          recentTrades: trades.slice(-10) as unknown as Trade[],
          markets: new Map(),
          priceHistory: new Map([[posKey, [point.price]]]),
          timestamp: point.timestamp,
          isBacktest: true,
        };

        // Get signals from strategy
        const signals = await strategy.evaluate(ctx);

        // Execute signals
        for (const signal of signals) {
          if (signal.type === 'buy') {
            const size = signal.size || Math.floor(cash * 0.1 / point.price);
            if (size <= 0) continue;

            const commission = size * point.price * (cfg.commissionPct / 100);
            const slippage = size * point.price * (cfg.slippagePct / 100);
            const cost = size * point.price + commission + slippage;

            if (cost > cash) continue;

            cash -= cost;

            const existing = positions.get(posKey);
            if (existing) {
              const totalShares = existing.shares + size;
              existing.avgPrice = (existing.avgPrice * existing.shares + point.price * size) / totalShares;
              existing.shares = totalShares;
            } else {
              positions.set(posKey, { shares: size, avgPrice: point.price, entryTime: point.timestamp });
            }

            trades.push({
              timestamp: point.timestamp,
              platform: platform as Platform,
              marketId,
              outcome: 'yes',
              side: 'buy',
              price: point.price,
              size,
              commission,
              slippage,
              signal,
            });
          }

          if (signal.type === 'sell') {
            const position = positions.get(posKey);
            if (!position || position.shares <= 0) continue;

            const size = signal.size || position.shares;
            const actualSize = Math.min(size, position.shares);

            const commission = actualSize * point.price * (cfg.commissionPct / 100);
            const slippage = actualSize * point.price * (cfg.slippagePct / 100);
            const proceeds = actualSize * point.price - commission - slippage;
            const pnl = proceeds - actualSize * position.avgPrice;

            cash += proceeds;
            position.shares -= actualSize;

            if (position.shares <= 0) {
              positions.delete(posKey);
            }

            trades.push({
              timestamp: point.timestamp,
              platform: platform as Platform,
              marketId,
              outcome: 'yes',
              side: 'sell',
              price: point.price,
              size: actualSize,
              commission,
              slippage,
              pnl,
              signal,
            });
          }
        }

        // Record equity
        let positionsValue = 0;
        for (const [key, pos] of positions) {
          const lastPrice = data.get(key.split(':').slice(0, 2).join(':'))?.slice(-1)[0]?.close || pos.avgPrice;
          positionsValue += pos.shares * lastPrice;
        }
        equity = cash + positionsValue;
        equityCurve.push({ timestamp: point.timestamp, equity });
      }

      // Calculate metrics
      const metrics = calculateMetrics(trades, equityCurve, cfg);

      // Build daily returns
      const dailyReturns: Array<{ date: string; return: number }> = [];
      const dailyEquity = new Map<string, number>();

      for (const point of equityCurve) {
        const date = point.timestamp.toISOString().slice(0, 10);
        dailyEquity.set(date, point.equity);
      }

      let prevEquity = cfg.initialCapital;
      for (const [date, eq] of dailyEquity) {
        const ret = (eq - prevEquity) / prevEquity;
        dailyReturns.push({ date, return: ret });
        prevEquity = eq;
      }

      // Build drawdown series
      const drawdowns: Array<{ timestamp: Date; drawdownPct: number }> = [];
      let peak = cfg.initialCapital;

      for (const point of equityCurve) {
        if (point.equity > peak) peak = point.equity;
        const dd = ((peak - point.equity) / peak) * 100;
        drawdowns.push({ timestamp: point.timestamp, drawdownPct: dd });
      }

      logger.info(
        {
          strategyId: strategy.config.id,
          totalReturn: `${metrics.totalReturnPct.toFixed(2)}%`,
          sharpe: metrics.sharpeRatio.toFixed(2),
          trades: metrics.totalTrades,
        },
        'Backtest completed'
      );

      return {
        strategyId: strategy.config.id,
        config: cfg,
        metrics,
        trades,
        equityCurve,
        dailyReturns,
        drawdowns,
      };
    },

    async compare(strategies, config) {
      const results: BacktestResult[] = [];

      for (const strategy of strategies) {
        const result = await this.run(strategy, config);
        results.push(result);
      }

      // Rank by Sharpe ratio
      const ranking = results
        .sort((a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio)
        .map((r) => r.strategyId);

      return { results, ranking };
    },

    monteCarlo(result, simulations) {
      const returns = result.dailyReturns.map((d) => d.return);
      const outcomes: number[] = [];

      for (let i = 0; i < simulations; i++) {
        // Shuffle returns and calculate outcome
        const shuffled = [...returns].sort(() => Math.random() - 0.5);
        let equity = result.config.initialCapital;

        for (const ret of shuffled) {
          equity *= 1 + ret;
        }

        outcomes.push((equity - result.config.initialCapital) / result.config.initialCapital);
      }

      outcomes.sort((a, b) => a - b);

      const percentile = (p: number) => outcomes[Math.floor(outcomes.length * p)];

      return {
        simulations,
        percentiles: {
          p5: percentile(0.05) * 100,
          p25: percentile(0.25) * 100,
          p50: percentile(0.5) * 100,
          p75: percentile(0.75) * 100,
          p95: percentile(0.95) * 100,
        },
        probabilityOfProfit: outcomes.filter((o) => o > 0).length / outcomes.length,
        probabilityOfMajorLoss: outcomes.filter((o) => o < -0.2).length / outcomes.length,
        expectedValue: outcomes.reduce((a, b) => a + b, 0) / outcomes.length * 100,
      };
    },

    async loadHistoricalData(platform, marketId, startDate, endDate) {
      return loadPricesFromTrades(platform, marketId, startDate, endDate);
    },
  };
}
