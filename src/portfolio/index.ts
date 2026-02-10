/**
 * Portfolio Service - Track positions, balances, and PnL
 *
 * Features:
 * - Fetch positions from Polymarket/Kalshi APIs
 * - Fetch positions from futures exchanges (Hyperliquid, Binance, Bybit, MEXC)
 * - Calculate unrealized PnL
 * - Track portfolio value over time
 * - Multi-platform aggregation with Promise.allSettled
 * - Locked balance calculation (Polymarket open orders, futures margin)
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

export interface Position {
  id: string;
  platform: string;
  marketId: string;
  marketQuestion?: string;
  outcome: string;
  tokenId?: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  value: number;
  costBasis: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  realizedPnL: number;
  /** Futures-specific fields */
  leverage?: number;
  marginType?: string;
  liquidationPrice?: number;
  notionalValue?: number;
  side?: 'long' | 'short';
}

export interface PortfolioBalance {
  platform: string;
  available: number;
  locked: number;
  total: number;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCostBasis: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  realizedPnL: number;
  positionsCount: number;
  balances: PortfolioBalance[];
  positions: Position[];
  lastUpdated: Date;
}

export interface PortfolioConfig {
  polymarket?: PolymarketApiKeyAuth;
  kalshi?: KalshiApiKeyAuth;
  hyperliquid?: { walletAddress: string; privateKey: string };
  binance?: { apiKey: string; apiSecret: string };
  bybit?: { apiKey: string; apiSecret: string };
  mexc?: { apiKey: string; apiSecret: string };
  /** Cache TTL in seconds */
  cacheTtlSeconds?: number;
}

// =============================================================================
// CORRELATION TRACKING TYPES
// =============================================================================

export type PositionCategory =
  | 'politics'
  | 'crypto'
  | 'sports'
  | 'economics'
  | 'entertainment'
  | 'weather'
  | 'science'
  | 'other';

export interface PositionCorrelation {
  positionA: string;
  positionB: string;
  correlation: number; // -1 to 1
  correlationType: 'positive' | 'negative' | 'neutral';
  reason: string;
}

export interface CategoryExposure {
  category: PositionCategory;
  positionCount: number;
  totalValue: number;
  valuePercent: number;
  positions: string[];
}

export interface ConcentrationRisk {
  /** Herfindahl-Hirschman Index (0-10000, higher = more concentrated) */
  hhi: number;
  /** Largest position as % of portfolio */
  largestPositionPct: number;
  /** Top 3 positions as % of portfolio */
  top3Pct: number;
  /** Diversification score (0-100, higher = more diversified) */
  diversificationScore: number;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface CorrelationMatrix {
  /** Position IDs in order */
  positions: string[];
  /** NxN correlation matrix */
  matrix: number[][];
  /** High correlation pairs (|correlation| > 0.7) */
  highCorrelationPairs: PositionCorrelation[];
  /** Overall portfolio correlation score (0-1, lower = better diversified) */
  portfolioCorrelation: number;
}

export interface PortfolioRiskMetrics {
  correlationMatrix: CorrelationMatrix;
  categoryExposure: CategoryExposure[];
  platformExposure: {
    platform: string;
    positionCount: number;
    totalValue: number;
    valuePercent: number;
  }[];
  concentrationRisk: ConcentrationRisk;
  hedgedPositions: Array<{
    longPosition: string;
    shortPosition: string;
    hedgeRatio: number;
  }>;
}

export interface PortfolioService {
  /** Fetch all positions from connected platforms */
  fetchPositions(): Promise<Position[]>;

  /** Fetch balances from connected platforms */
  fetchBalances(): Promise<PortfolioBalance[]>;

  /** Get portfolio summary with PnL */
  getSummary(): Promise<PortfolioSummary>;

  /** Get positions for a specific platform */
  getPositionsByPlatform(platform: string): Promise<Position[]>;

  /** Get a specific position */
  getPosition(platform: string, marketId: string, outcome: string): Promise<Position | null>;

  /** Calculate total unrealized PnL */
  getUnrealizedPnL(): Promise<number>;

  /** Get total portfolio value */
  getTotalValue(): Promise<number>;

  /** Format portfolio for chat display */
  formatSummary(): Promise<string>;

  /** Format positions table for chat */
  formatPositionsTable(): Promise<string>;

  /** Refresh cache */
  refresh(): Promise<void>;

  // Correlation tracking methods

  /** Calculate correlation between two positions */
  calculateCorrelation(positionA: Position, positionB: Position): PositionCorrelation;

  /** Get full correlation matrix for portfolio */
  getCorrelationMatrix(): Promise<CorrelationMatrix>;

  /** Get category exposure breakdown */
  getCategoryExposure(): Promise<CategoryExposure[]>;

  /** Get concentration risk metrics */
  getConcentrationRisk(): Promise<ConcentrationRisk>;

  /** Get comprehensive portfolio risk metrics */
  getPortfolioRiskMetrics(): Promise<PortfolioRiskMetrics>;

  /** Classify a position into a category */
  classifyPosition(position: Position): PositionCategory;

  /** Find hedged position pairs */
  findHedgedPairs(): Promise<Array<{ longPosition: string; shortPosition: string; hedgeRatio: number }>>;
}

// =============================================================================
// POLYMARKET API
// =============================================================================

const POLY_CLOB_URL = 'https://clob.polymarket.com';
const POLY_GAMMA_URL = 'https://gamma-api.polymarket.com';

interface PolymarketPosition {
  asset: string;
  condition_id: string;
  size: string;
  avgPrice: string;
  cur_price: string;
  pnl?: string;
  realized_pnl?: string;
  market?: string;
  outcome?: string;
}

interface PolymarketBalanceResponse {
  balance: string;
  allowance?: string;
}

async function fetchPolymarketPositions(auth: PolymarketApiKeyAuth): Promise<Position[]> {
  const url = `${POLY_CLOB_URL}/positions`;
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
      logger.error({ status: response.status }, 'Failed to fetch Polymarket positions');
      return [];
    }

    const data = (await response.json()) as PolymarketPosition[];

    return data.map((p) => {
      const shares = parseFloat(p.size) || 0;
      const avgPrice = parseFloat(p.avgPrice) || 0;
      const currentPrice = parseFloat(p.cur_price) || 0;
      const costBasis = shares * avgPrice;
      const value = shares * currentPrice;
      const unrealizedPnL = value - costBasis;
      const unrealizedPnLPct = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;

      return {
        id: `poly_${p.asset}`,
        platform: 'polymarket' as const,
        marketId: p.condition_id,
        marketQuestion: p.market,
        outcome: p.outcome || 'Unknown',
        tokenId: p.asset,
        shares,
        avgPrice,
        currentPrice,
        value,
        costBasis,
        unrealizedPnL,
        unrealizedPnLPct,
        realizedPnL: parseFloat(p.realized_pnl ?? '0') || 0,
      };
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching Polymarket positions');
    return [];
  }
}

async function fetchPolymarketBalance(auth: PolymarketApiKeyAuth): Promise<PortfolioBalance> {
  const url = `${POLY_CLOB_URL}/balance`;
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
      logger.error({ status: response.status }, 'Failed to fetch Polymarket balance');
      return { platform: 'polymarket', available: 0, locked: 0, total: 0 };
    }

    const data = (await response.json()) as PolymarketBalanceResponse;
    const total = (parseFloat(data.balance) || 0) / 1e6; // USDC has 6 decimals

    // Calculate locked USDC from open buy orders
    let locked = 0;
    try {
      const ordersUrl = `${POLY_CLOB_URL}/orders?state=OPEN`;
      const ordersHeaders = buildPolymarketHeadersForUrl(auth, 'GET', ordersUrl);
      const ordersRes = await fetch(ordersUrl, {
        method: 'GET',
        headers: { ...ordersHeaders, 'Content-Type': 'application/json' },
      });
      if (ordersRes.ok) {
        const orders = (await ordersRes.json()) as Array<{
          side: string;
          price: string;
          size_matched: string;
          original_size: string;
        }>;
        for (const order of orders) {
          if (order.side === 'BUY') {
            const remaining =
              (parseFloat(order.original_size) || 0) - (parseFloat(order.size_matched) || 0);
            locked += remaining * (parseFloat(order.price) || 0);
          }
        }
      }
    } catch {
      // Non-critical — just leave locked at 0
    }

    return {
      platform: 'polymarket',
      available: total - locked,
      locked,
      total,
    };
  } catch (error) {
    logger.error({ error }, 'Error fetching Polymarket balance');
    return { platform: 'polymarket', available: 0, locked: 0, total: 0 };
  }
}

// =============================================================================
// KALSHI API
// =============================================================================

const KALSHI_API_URL = 'https://api.elections.kalshi.com/trade-api/v2';

interface KalshiPosition {
  market_id: string;
  market_title?: string;
  position: number;
  average_price: number;
  resting_orders_count: number;
  realized_pnl: number;
  total_cost: number;
}

interface KalshiBalanceResponse {
  balance: number;
  portfolio_value?: number;
}

async function fetchKalshiMarketPrice(
  auth: KalshiApiKeyAuth,
  ticker: string
): Promise<{ yesPrice: number; noPrice: number } | null> {
  const url = `${KALSHI_API_URL}/markets/${ticker}`;
  const headers = buildKalshiHeadersForUrl(auth, 'GET', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { ...headers, 'Content-Type': 'application/json' },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      market: { yes_price?: number; yes_bid?: number; no_bid?: number };
    };
    const m = data.market;
    const yesPrice = (m.yes_price ?? m.yes_bid ?? 0) / 100;
    const noPrice = (m.no_bid ?? 0) / 100 || Math.max(0, 1 - yesPrice);
    return { yesPrice, noPrice };
  } catch {
    return null;
  }
}

async function fetchKalshiPositions(auth: KalshiApiKeyAuth): Promise<Position[]> {
  const url = `${KALSHI_API_URL}/portfolio/positions`;
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
      logger.error({ status: response.status }, 'Failed to fetch Kalshi positions');
      return [];
    }

    const data = (await response.json()) as { market_positions: KalshiPosition[] };
    const positions = data.market_positions || [];

    // Fetch current prices for all positions in parallel
    const priceMap = new Map<string, { yesPrice: number; noPrice: number }>();
    const uniqueMarkets = Array.from(new Set(positions.map((p) => p.market_id)));

    const prices = await Promise.all(
      uniqueMarkets.map((ticker) => fetchKalshiMarketPrice(auth, ticker))
    );
    uniqueMarkets.forEach((ticker, i) => {
      if (prices[i]) priceMap.set(ticker, prices[i]!);
    });

    return positions.map((p) => {
      const shares = Math.abs(p.position);
      const avgPrice = p.average_price / 100; // Kalshi uses cents
      const isYes = p.position > 0;
      const marketPrice = priceMap.get(p.market_id);
      const currentPrice = marketPrice
        ? (isYes ? marketPrice.yesPrice : marketPrice.noPrice)
        : avgPrice; // Fall back to avgPrice if price fetch fails
      const costBasis = p.total_cost / 100;
      const value = shares * currentPrice;
      const unrealizedPnL = value - costBasis;
      const unrealizedPnLPct = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;

      return {
        id: `kalshi_${p.market_id}`,
        platform: 'kalshi' as const,
        marketId: p.market_id,
        marketQuestion: p.market_title,
        outcome: isYes ? 'Yes' : 'No',
        shares,
        avgPrice,
        currentPrice,
        value,
        costBasis,
        unrealizedPnL,
        unrealizedPnLPct,
        realizedPnL: p.realized_pnl / 100,
      };
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching Kalshi positions');
    return [];
  }
}

async function fetchKalshiBalance(auth: KalshiApiKeyAuth): Promise<PortfolioBalance> {
  const url = `${KALSHI_API_URL}/portfolio/balance`;
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
      logger.error({ status: response.status }, 'Failed to fetch Kalshi balance');
      return { platform: 'kalshi', available: 0, locked: 0, total: 0 };
    }

    const data = (await response.json()) as KalshiBalanceResponse;
    const available = data.balance / 100; // Cents to dollars

    return {
      platform: 'kalshi',
      available,
      locked: 0,
      total: available,
    };
  } catch (error) {
    logger.error({ error }, 'Error fetching Kalshi balance');
    return { platform: 'kalshi', available: 0, locked: 0, total: 0 };
  }
}

// =============================================================================
// EXCHANGE FETCHERS (dynamic imports — SDKs only load when credentials present)
// =============================================================================

async function fetchHyperliquidPositions(
  config: { walletAddress: string; privateKey: string }
): Promise<Position[]> {
  try {
    const hl = await import('../exchanges/hyperliquid/index');
    const state = await hl.getUserState(config.walletAddress);
    return state.assetPositions
      .filter((ap) => parseFloat(ap.position.szi) !== 0)
      .map((ap) => {
        const p = ap.position;
        const shares = Math.abs(parseFloat(p.szi));
        const entryPrice = parseFloat(p.entryPx);
        const unrealizedPnL = parseFloat(p.unrealizedPnl);
        const isLong = parseFloat(p.szi) > 0;
        const currentPrice = shares > 1e-12 ? entryPrice + unrealizedPnL / shares : entryPrice;
        const costBasis = shares * entryPrice;
        const value = shares * currentPrice;
        const unrealizedPnLPct = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;

        return {
          id: `hl_${p.coin}_${isLong ? 'long' : 'short'}`,
          platform: 'hyperliquid',
          marketId: p.coin,
          marketQuestion: `${p.coin} Perp`,
          outcome: isLong ? 'Long' : 'Short',
          shares,
          avgPrice: entryPrice,
          currentPrice,
          value,
          costBasis,
          unrealizedPnL,
          unrealizedPnLPct,
          realizedPnL: 0,
          side: isLong ? 'long' as const : 'short' as const,
          liquidationPrice: p.liquidationPx ? parseFloat(p.liquidationPx) : undefined,
        };
      });
  } catch (error) {
    logger.error({ error }, 'Error fetching Hyperliquid positions');
    return [];
  }
}

async function fetchHyperliquidBalance(
  config: { walletAddress: string; privateKey: string }
): Promise<PortfolioBalance> {
  try {
    const hl = await import('../exchanges/hyperliquid/index');
    const state = await hl.getUserState(config.walletAddress);
    const accountValue = parseFloat(state.marginSummary.accountValue);
    const marginUsed = parseFloat(state.marginSummary.totalMarginUsed);
    return {
      platform: 'hyperliquid',
      available: accountValue - marginUsed,
      locked: marginUsed,
      total: accountValue,
    };
  } catch (error) {
    logger.error({ error }, 'Error fetching Hyperliquid balance');
    return { platform: 'hyperliquid', available: 0, locked: 0, total: 0 };
  }
}

async function fetchBinancePositions(
  config: { apiKey: string; apiSecret: string }
): Promise<Position[]> {
  try {
    const bin = await import('../exchanges/binance-futures/index');
    const positions = await bin.getPositions(config);
    return positions
      .filter((p) => p.positionAmt !== 0)
      .map((p) => {
        const isLong = p.positionAmt > 0;
        const shares = Math.abs(p.positionAmt);
        const costBasis = shares * p.entryPrice;
        const value = Math.abs(p.notional);
        const unrealizedPnLPct = costBasis > 0 ? (p.unrealizedProfit / costBasis) * 100 : 0;

        return {
          id: `binance_${p.symbol}_${p.positionSide}`,
          platform: 'binance',
          marketId: p.symbol,
          marketQuestion: `${p.symbol} Perp`,
          outcome: isLong ? 'Long' : 'Short',
          shares,
          avgPrice: p.entryPrice,
          currentPrice: p.markPrice,
          value,
          costBasis,
          unrealizedPnL: p.unrealizedProfit,
          unrealizedPnLPct,
          realizedPnL: 0,
          leverage: p.leverage,
          marginType: p.marginType,
          liquidationPrice: p.liquidationPrice ?? undefined,
          notionalValue: Math.abs(p.notional),
          side: isLong ? 'long' as const : 'short' as const,
        };
      });
  } catch (error) {
    logger.error({ error }, 'Error fetching Binance positions');
    return [];
  }
}

async function fetchBinanceBalance(
  config: { apiKey: string; apiSecret: string }
): Promise<PortfolioBalance> {
  try {
    const bin = await import('../exchanges/binance-futures/index');
    const balances = await bin.getBalance(config);
    const usdt = balances.find((b) => b.asset === 'USDT');
    if (!usdt) return { platform: 'binance', available: 0, locked: 0, total: 0 };
    return {
      platform: 'binance',
      available: usdt.availableBalance,
      locked: usdt.balance - usdt.availableBalance,
      total: usdt.balance,
    };
  } catch (error) {
    logger.error({ error }, 'Error fetching Binance balance');
    return { platform: 'binance', available: 0, locked: 0, total: 0 };
  }
}

async function fetchBybitPositions(
  config: { apiKey: string; apiSecret: string }
): Promise<Position[]> {
  try {
    const bb = await import('../exchanges/bybit/index');
    const positions = await bb.getPositions(config);
    return positions
      .filter((p) => p.size !== 0)
      .map((p) => {
        const isLong = p.side === 'Buy';
        const costBasis = p.size * p.entryPrice;
        const unrealizedPnLPct = costBasis > 0 ? (p.unrealisedPnl / costBasis) * 100 : 0;

        return {
          id: `bybit_${p.symbol}_${p.side}`,
          platform: 'bybit',
          marketId: p.symbol,
          marketQuestion: `${p.symbol} Perp`,
          outcome: isLong ? 'Long' : 'Short',
          shares: p.size,
          avgPrice: p.entryPrice,
          currentPrice: p.markPrice,
          value: p.positionValue,
          costBasis,
          unrealizedPnL: p.unrealisedPnl,
          unrealizedPnLPct,
          realizedPnL: p.cumRealisedPnl,
          leverage: p.leverage,
          liquidationPrice: p.liqPrice ?? undefined,
          notionalValue: p.positionValue,
          side: isLong ? 'long' as const : 'short' as const,
        };
      });
  } catch (error) {
    logger.error({ error }, 'Error fetching Bybit positions');
    return [];
  }
}

async function fetchBybitBalance(
  config: { apiKey: string; apiSecret: string }
): Promise<PortfolioBalance> {
  try {
    const bb = await import('../exchanges/bybit/index');
    const balances = await bb.getBalance(config);
    const usdt = balances.find((b) => b.coin === 'USDT');
    if (!usdt) return { platform: 'bybit', available: 0, locked: 0, total: 0 };
    return {
      platform: 'bybit',
      available: usdt.availableBalance,
      locked: usdt.equity - usdt.availableBalance,
      total: usdt.equity,
    };
  } catch (error) {
    logger.error({ error }, 'Error fetching Bybit balance');
    return { platform: 'bybit', available: 0, locked: 0, total: 0 };
  }
}

async function fetchMexcPositions(
  config: { apiKey: string; apiSecret: string }
): Promise<Position[]> {
  try {
    const mx = await import('../exchanges/mexc/index');
    const positions = await mx.getPositions(config);
    return positions
      .filter((p) => p.holdVol !== 0)
      .map((p) => {
        const isLong = p.positionType === 1;
        const costBasis = p.holdVol * p.openAvgPrice;
        const unrealizedPnLPct = costBasis > 0 ? (p.unrealisedPnl / costBasis) * 100 : 0;

        return {
          id: `mexc_${p.symbol}_${isLong ? 'long' : 'short'}`,
          platform: 'mexc',
          marketId: p.symbol,
          marketQuestion: `${p.symbol} Perp`,
          outcome: isLong ? 'Long' : 'Short',
          shares: p.holdVol,
          avgPrice: p.openAvgPrice,
          currentPrice: p.markPrice,
          value: p.positionValue,
          costBasis,
          unrealizedPnL: p.unrealisedPnl,
          unrealizedPnLPct,
          realizedPnL: p.realisedPnl,
          leverage: p.leverage,
          liquidationPrice: p.liquidatePrice ?? undefined,
          notionalValue: p.positionValue,
          side: isLong ? 'long' as const : 'short' as const,
        };
      });
  } catch (error) {
    logger.error({ error }, 'Error fetching MEXC positions');
    return [];
  }
}

async function fetchMexcBalance(
  config: { apiKey: string; apiSecret: string }
): Promise<PortfolioBalance> {
  try {
    const mx = await import('../exchanges/mexc/index');
    const balances = await mx.getBalance(config);
    const usdt = balances.find((b) => b.currency === 'USDT');
    if (!usdt) return { platform: 'mexc', available: 0, locked: 0, total: 0 };
    return {
      platform: 'mexc',
      available: usdt.availableBalance,
      locked: usdt.frozenBalance,
      total: usdt.equity,
    };
  } catch (error) {
    logger.error({ error }, 'Error fetching MEXC balance');
    return { platform: 'mexc', available: 0, locked: 0, total: 0 };
  }
}

// =============================================================================
// PORTFOLIO SERVICE
// =============================================================================

export function createPortfolioService(config: PortfolioConfig, db?: Database): PortfolioService {
  const cacheTtl = (config.cacheTtlSeconds ?? 30) * 1000;
  let cachedPositions: Position[] | null = null;
  let cachedBalances: PortfolioBalance[] | null = null;
  let lastFetch = 0;

  async function refreshIfStale(): Promise<void> {
    if (Date.now() - lastFetch > cacheTtl) {
      await service.refresh();
    }
  }

  const service: PortfolioService = {
    async fetchPositions() {
      const fetchers: Promise<Position[]>[] = [];

      if (config.polymarket) fetchers.push(fetchPolymarketPositions(config.polymarket));
      if (config.kalshi) fetchers.push(fetchKalshiPositions(config.kalshi));
      if (config.hyperliquid) fetchers.push(fetchHyperliquidPositions(config.hyperliquid));
      if (config.binance) fetchers.push(fetchBinancePositions(config.binance));
      if (config.bybit) fetchers.push(fetchBybitPositions(config.bybit));
      if (config.mexc) fetchers.push(fetchMexcPositions(config.mexc));

      const results = await Promise.allSettled(fetchers);
      const positions: Position[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          positions.push(...result.value);
        } else {
          logger.error({ error: result.reason }, 'Exchange position fetch failed');
        }
      }

      cachedPositions = positions;
      lastFetch = Date.now();

      logger.info({ count: positions.length }, 'Fetched positions');
      return positions;
    },

    async fetchBalances() {
      const fetchers: Promise<PortfolioBalance>[] = [];

      if (config.polymarket) fetchers.push(fetchPolymarketBalance(config.polymarket));
      if (config.kalshi) fetchers.push(fetchKalshiBalance(config.kalshi));
      if (config.hyperliquid) fetchers.push(fetchHyperliquidBalance(config.hyperliquid));
      if (config.binance) fetchers.push(fetchBinanceBalance(config.binance));
      if (config.bybit) fetchers.push(fetchBybitBalance(config.bybit));
      if (config.mexc) fetchers.push(fetchMexcBalance(config.mexc));

      const results = await Promise.allSettled(fetchers);
      const balances: PortfolioBalance[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          balances.push(result.value);
        } else {
          logger.error({ error: result.reason }, 'Exchange balance fetch failed');
        }
      }

      cachedBalances = balances;
      return balances;
    },

    async getSummary() {
      await refreshIfStale();

      const positions = cachedPositions || [];
      const balances = cachedBalances || [];

      const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
      const totalCostBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
      const unrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
      const realizedPnL = positions.reduce((sum, p) => sum + p.realizedPnL, 0);
      const unrealizedPnLPct = totalCostBasis > 0 ? (unrealizedPnL / totalCostBasis) * 100 : 0;

      return {
        totalValue,
        totalCostBasis,
        unrealizedPnL,
        unrealizedPnLPct,
        realizedPnL,
        positionsCount: positions.length,
        balances,
        positions,
        lastUpdated: new Date(lastFetch),
      };
    },

    async getPositionsByPlatform(platform) {
      await refreshIfStale();
      return (cachedPositions || []).filter((p) => p.platform === platform);
    },

    async getPosition(platform, marketId, outcome) {
      await refreshIfStale();
      return (
        (cachedPositions || []).find(
          (p) => p.platform === platform && p.marketId === marketId && p.outcome === outcome
        ) || null
      );
    },

    async getUnrealizedPnL() {
      await refreshIfStale();
      return (cachedPositions || []).reduce((sum, p) => sum + p.unrealizedPnL, 0);
    },

    async getTotalValue() {
      await refreshIfStale();
      const positions = cachedPositions || [];
      const balances = cachedBalances || [];

      const positionValue = positions.reduce((sum, p) => sum + p.value, 0);
      const cashValue = balances.reduce((sum, b) => sum + b.available, 0);

      return positionValue + cashValue;
    },

    async formatSummary() {
      const summary = await this.getSummary();
      const pnlSign = summary.unrealizedPnL >= 0 ? '+' : '';
      const pnlEmoji = summary.unrealizedPnL >= 0 ? '🟢' : '🔴';

      let text = `📊 **Portfolio Summary**\n\n`;
      text += `**Total Value:** $${summary.totalValue.toFixed(2)}\n`;
      text += `**Positions:** ${summary.positionsCount}\n`;
      text += `**Unrealized P&L:** ${pnlEmoji} ${pnlSign}$${summary.unrealizedPnL.toFixed(2)} (${pnlSign}${summary.unrealizedPnLPct.toFixed(1)}%)\n`;
      text += `**Realized P&L:** $${summary.realizedPnL.toFixed(2)}\n\n`;

      text += `**Balances:**\n`;
      for (const bal of summary.balances) {
        let balLine = `  ${bal.platform}: $${bal.total.toFixed(2)}`;
        if (bal.locked > 0) {
          balLine += ` ($${bal.available.toFixed(2)} avail, $${bal.locked.toFixed(2)} locked)`;
        }
        text += balLine + '\n';
      }

      text += `\n_Updated: ${summary.lastUpdated.toLocaleTimeString()}_`;

      return text;
    },

    async formatPositionsTable() {
      await refreshIfStale();
      const positions = cachedPositions || [];

      if (positions.length === 0) {
        return '📭 No open positions';
      }

      let text = `📈 **Open Positions** (${positions.length})\n\n`;

      for (const pos of positions) {
        const pnlSign = pos.unrealizedPnL >= 0 ? '+' : '';
        const pnlEmoji = pos.unrealizedPnL >= 0 ? '🟢' : '🔴';
        const question = pos.marketQuestion
          ? pos.marketQuestion.slice(0, 40) + (pos.marketQuestion.length > 40 ? '...' : '')
          : pos.marketId.slice(0, 20);

        text += `**${question}** [${pos.platform}]\n`;
        if (pos.side) {
          const leverageStr = pos.leverage ? ` ${pos.leverage}x` : '';
          const liqStr = pos.liquidationPrice ? ` | liq $${pos.liquidationPrice.toFixed(2)}` : '';
          text += `  ${pos.side.toUpperCase()}${leverageStr}: ${pos.shares.toFixed(4)} @ $${pos.currentPrice.toFixed(2)}\n`;
          text += `  ${pnlEmoji} ${pnlSign}$${pos.unrealizedPnL.toFixed(2)} (${pnlSign}${pos.unrealizedPnLPct.toFixed(1)}%)${liqStr}\n\n`;
        } else {
          text += `  ${pos.outcome}: ${pos.shares.toFixed(2)} @ $${pos.currentPrice.toFixed(3)}\n`;
          text += `  ${pnlEmoji} ${pnlSign}$${pos.unrealizedPnL.toFixed(2)} (${pnlSign}${pos.unrealizedPnLPct.toFixed(1)}%)\n\n`;
        }
      }

      return text;
    },

    async refresh() {
      await Promise.all([this.fetchPositions(), this.fetchBalances()]);
      logger.info('Portfolio refreshed');
    },

    // =========================================================================
    // CORRELATION TRACKING
    // =========================================================================

    classifyPosition(position: Position): PositionCategory {
      const question = (position.marketQuestion || '').toLowerCase();

      // Politics keywords
      if (/trump|biden|harris|election|president|congress|senate|governor|poll|vote/i.test(question)) {
        return 'politics';
      }

      // Crypto keywords
      if (/bitcoin|btc|ethereum|eth|crypto|solana|sol|doge|token|blockchain/i.test(question)) {
        return 'crypto';
      }

      // Sports keywords
      if (/nfl|nba|mlb|nhl|super\s*bowl|world\s*series|playoff|championship|team|game|match|win/i.test(question)) {
        return 'sports';
      }

      // Economics keywords
      if (/fed|interest\s*rate|inflation|cpi|gdp|recession|unemployment|fomc|tariff|trade/i.test(question)) {
        return 'economics';
      }

      // Weather keywords
      if (/weather|temperature|hurricane|storm|rain|snow|heat|cold|climate/i.test(question)) {
        return 'weather';
      }

      // Entertainment keywords
      if (/movie|oscar|emmy|grammy|album|song|celebrity|actor|netflix|disney/i.test(question)) {
        return 'entertainment';
      }

      // Science keywords
      if (/nasa|space|mars|moon|vaccine|fda|drug|research|study|discovery/i.test(question)) {
        return 'science';
      }

      return 'other';
    },

    calculateCorrelation(positionA: Position, positionB: Position): PositionCorrelation {
      const questionA = (positionA.marketQuestion || '').toLowerCase();
      const questionB = (positionB.marketQuestion || '').toLowerCase();

      // Same market, opposite outcomes = negative correlation
      if (positionA.marketId === positionB.marketId) {
        if (positionA.outcome !== positionB.outcome) {
          return {
            positionA: positionA.id,
            positionB: positionB.id,
            correlation: -1.0,
            correlationType: 'negative',
            reason: 'Same market, opposite outcomes',
          };
        }
        return {
          positionA: positionA.id,
          positionB: positionB.id,
          correlation: 1.0,
          correlationType: 'positive',
          reason: 'Same market, same outcome',
        };
      }

      // Check for related topics
      const categoryA = this.classifyPosition(positionA);
      const categoryB = this.classifyPosition(positionB);

      // Same category = moderate positive correlation
      if (categoryA === categoryB && categoryA !== 'other') {
        // Look for more specific correlations
        const extractKeyEntities = (q: string): string[] => {
          const entities: string[] = [];
          // Extract names
          const nameMatch = q.match(/\b(trump|biden|harris|musk|bezos|bitcoin|ethereum|solana)\b/gi);
          if (nameMatch) entities.push(...nameMatch.map((n) => n.toLowerCase()));
          // Extract years
          const yearMatch = q.match(/\b(202\d)\b/g);
          if (yearMatch) entities.push(...yearMatch);
          return entities;
        };

        const entitiesA = extractKeyEntities(questionA);
        const entitiesB = extractKeyEntities(questionB);
        const sharedEntities = entitiesA.filter((e) => entitiesB.includes(e));

        if (sharedEntities.length > 0) {
          return {
            positionA: positionA.id,
            positionB: positionB.id,
            correlation: Math.min(1.0, 0.7 + sharedEntities.length * 0.1),
            correlationType: 'positive',
            reason: `Same category (${categoryA}) with shared entities: ${sharedEntities.join(', ')}`,
          };
        }

        return {
          positionA: positionA.id,
          positionB: positionB.id,
          correlation: 0.4,
          correlationType: 'positive',
          reason: `Same category: ${categoryA}`,
        };
      }

      // Check for economic/political correlation
      if (
        (categoryA === 'politics' && categoryB === 'economics') ||
        (categoryA === 'economics' && categoryB === 'politics')
      ) {
        return {
          positionA: positionA.id,
          positionB: positionB.id,
          correlation: 0.3,
          correlationType: 'positive',
          reason: 'Politics and economics are often correlated',
        };
      }

      // Default: low/no correlation
      return {
        positionA: positionA.id,
        positionB: positionB.id,
        correlation: 0.1,
        correlationType: 'neutral',
        reason: 'Different categories',
      };
    },

    async getCorrelationMatrix(): Promise<CorrelationMatrix> {
      await refreshIfStale();
      const positions = cachedPositions || [];

      if (positions.length === 0) {
        return {
          positions: [],
          matrix: [],
          highCorrelationPairs: [],
          portfolioCorrelation: 0,
        };
      }

      const positionIds = positions.map((p) => p.id);
      const n = positions.length;
      const matrix: number[][] = Array(n)
        .fill(null)
        .map(() => Array(n).fill(0));
      const highCorrelationPairs: PositionCorrelation[] = [];

      // Calculate pairwise correlations
      for (let i = 0; i < n; i++) {
        matrix[i][i] = 1.0; // Self-correlation
        for (let j = i + 1; j < n; j++) {
          const corr = this.calculateCorrelation(positions[i], positions[j]);
          matrix[i][j] = corr.correlation;
          matrix[j][i] = corr.correlation;

          if (Math.abs(corr.correlation) > 0.7) {
            highCorrelationPairs.push(corr);
          }
        }
      }

      // Calculate overall portfolio correlation (average of absolute correlations)
      let totalCorr = 0;
      let count = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          totalCorr += Math.abs(matrix[i][j]);
          count++;
        }
      }
      const portfolioCorrelation = count > 0 ? totalCorr / count : 0;

      return {
        positions: positionIds,
        matrix,
        highCorrelationPairs,
        portfolioCorrelation,
      };
    },

    async getCategoryExposure(): Promise<CategoryExposure[]> {
      await refreshIfStale();
      const positions = cachedPositions || [];

      if (positions.length === 0) {
        return [];
      }

      const totalValue = positions.reduce((sum, p) => sum + Math.abs(p.value), 0);
      const byCategory = new Map<PositionCategory, { value: number; positions: string[] }>();

      for (const pos of positions) {
        const category = this.classifyPosition(pos);
        const existing = byCategory.get(category) || { value: 0, positions: [] };
        existing.value += Math.abs(pos.value);
        existing.positions.push(pos.id);
        byCategory.set(category, existing);
      }

      const exposures: CategoryExposure[] = [];
      for (const [category, data] of byCategory) {
        exposures.push({
          category,
          positionCount: data.positions.length,
          totalValue: data.value,
          valuePercent: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
          positions: data.positions,
        });
      }

      // Sort by value descending
      exposures.sort((a, b) => b.totalValue - a.totalValue);
      return exposures;
    },

    async getConcentrationRisk(): Promise<ConcentrationRisk> {
      await refreshIfStale();
      const positions = cachedPositions || [];

      if (positions.length === 0) {
        return {
          hhi: 0,
          largestPositionPct: 0,
          top3Pct: 0,
          diversificationScore: 100,
          riskLevel: 'low',
        };
      }

      const totalValue = positions.reduce((sum, p) => sum + Math.abs(p.value), 0);
      if (totalValue === 0) {
        return {
          hhi: 0,
          largestPositionPct: 0,
          top3Pct: 0,
          diversificationScore: 100,
          riskLevel: 'low',
        };
      }

      // Calculate market shares (as percentages)
      const shares = positions.map((p) => (Math.abs(p.value) / totalValue) * 100);
      shares.sort((a, b) => b - a);

      // HHI = sum of squared market shares
      const hhi = shares.reduce((sum, s) => sum + s * s, 0);

      const largestPositionPct = shares[0];
      const top3Pct = shares.slice(0, 3).reduce((sum, s) => sum + s, 0);

      // Diversification score: 100 - (HHI normalized to 0-100)
      // Max HHI = 10000 (single position), Min HHI = 10000/n (equal distribution)
      const maxHhi = 10000;
      const minHhi = positions.length > 0 ? 10000 / positions.length : 0;
      const denominator = maxHhi - minHhi;
      const normalizedHhi = denominator > 0 ? ((hhi - minHhi) / denominator) * 100 : 100;
      const diversificationScore = Math.max(0, 100 - normalizedHhi);

      // Risk level thresholds
      let riskLevel: ConcentrationRisk['riskLevel'];
      if (largestPositionPct > 50 || hhi > 5000) {
        riskLevel = 'critical';
      } else if (largestPositionPct > 30 || hhi > 2500) {
        riskLevel = 'high';
      } else if (largestPositionPct > 20 || hhi > 1500) {
        riskLevel = 'medium';
      } else {
        riskLevel = 'low';
      }

      return {
        hhi: Math.round(hhi),
        largestPositionPct,
        top3Pct,
        diversificationScore: Math.round(diversificationScore),
        riskLevel,
      };
    },

    async findHedgedPairs(): Promise<Array<{ longPosition: string; shortPosition: string; hedgeRatio: number }>> {
      await refreshIfStale();
      const positions = cachedPositions || [];

      const hedgedPairs: Array<{ longPosition: string; shortPosition: string; hedgeRatio: number }> = [];

      // Find positions in the same market with opposite outcomes
      const byMarket = new Map<string, Position[]>();
      for (const pos of positions) {
        const key = `${pos.platform}:${pos.marketId}`;
        const existing = byMarket.get(key) || [];
        existing.push(pos);
        byMarket.set(key, existing);
      }

      for (const [_, marketPositions] of byMarket) {
        if (marketPositions.length >= 2) {
          // Find YES and NO positions
          const yesPos = marketPositions.find((p) => p.outcome.toLowerCase() === 'yes');
          const noPos = marketPositions.find((p) => p.outcome.toLowerCase() === 'no');

          if (yesPos && noPos) {
            const minValue = Math.min(Math.abs(yesPos.value), Math.abs(noPos.value));
            const maxValue = Math.max(Math.abs(yesPos.value), Math.abs(noPos.value));
            const hedgeRatio = maxValue > 0 ? minValue / maxValue : 0;

            hedgedPairs.push({
              longPosition: yesPos.value > noPos.value ? yesPos.id : noPos.id,
              shortPosition: yesPos.value > noPos.value ? noPos.id : yesPos.id,
              hedgeRatio,
            });
          }
        }
      }

      return hedgedPairs;
    },

    async getPortfolioRiskMetrics(): Promise<PortfolioRiskMetrics> {
      await refreshIfStale();
      const positions = cachedPositions || [];

      const [correlationMatrix, categoryExposure, concentrationRisk, hedgedPositions] = await Promise.all([
        this.getCorrelationMatrix(),
        this.getCategoryExposure(),
        this.getConcentrationRisk(),
        this.findHedgedPairs(),
      ]);

      // Platform exposure
      const totalValue = positions.reduce((sum, p) => sum + Math.abs(p.value), 0);
      const byPlatform = new Map<string, { count: number; value: number }>();

      for (const pos of positions) {
        const existing = byPlatform.get(pos.platform) || { count: 0, value: 0 };
        existing.count++;
        existing.value += Math.abs(pos.value);
        byPlatform.set(pos.platform, existing);
      }

      const platformExposure = Array.from(byPlatform.entries()).map(([platform, data]) => ({
        platform,
        positionCount: data.count,
        totalValue: data.value,
        valuePercent: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
      }));

      return {
        correlationMatrix,
        categoryExposure,
        platformExposure,
        concentrationRisk,
        hedgedPositions,
      };
    },
  };

  return service;
}

export { PolymarketApiKeyAuth, KalshiApiKeyAuth };
