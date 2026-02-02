/**
 * Data Service - Market data aggregation for agents
 *
 * Prices, orderbooks, candles, positions, balances, news, sentiment
 */

import { logger } from '../../utils/logger';
import type {
  ComputeRequest,
  DataRequest,
  DataResponse,
  DataType,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface DataService {
  /** Fetch data */
  execute(request: ComputeRequest): Promise<DataResponse>;
  /** Get supported data types */
  getDataTypes(): DataType[];
  /** Get price for asset */
  getPrice(asset: string, source?: string): Promise<PriceData>;
  /** Get orderbook for market */
  getOrderbook(marketId: string, source: string): Promise<OrderbookData>;
}

export interface DataServiceConfig {
  /** CoinGecko API key (for prices) */
  coingeckoKey?: string;
  /** Polymarket subgraph URL */
  polymarketSubgraph?: string;
  /** Default cache TTL in seconds */
  cacheTtl?: number;
}

export interface PriceData {
  asset: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap?: number;
  source: string;
  timestamp: number;
}

export interface OrderbookData {
  marketId: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  spread: number;
  midPrice: number;
  source: string;
  timestamp: number;
}

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface PositionData {
  marketId: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
}

export interface BalanceData {
  token: string;
  balance: number;
  valueUsd: number;
  chain: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<DataServiceConfig> = {
  coingeckoKey: '',
  polymarketSubgraph: 'https://api.goldsky.com/api/public/project_cl6mb1g1v09ol2ntn7jb7a3qg/subgraphs/polymarket-matic/prod/gn',
  cacheTtl: 60,
};

// Simple in-memory cache
const cache = new Map<string, { data: unknown; expires: number }>();

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createDataService(config: DataServiceConfig = {}): DataService {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  function getDataTypes(): DataType[] {
    return ['price', 'orderbook', 'candles', 'trades', 'markets', 'positions', 'balance', 'news', 'sentiment'];
  }

  function getCached<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  function setCache(key: string, data: unknown, ttl: number = cfg.cacheTtl): void {
    cache.set(key, {
      data,
      expires: Date.now() + ttl * 1000,
    });
  }

  async function execute(request: ComputeRequest): Promise<DataResponse> {
    const payload = request.payload as DataRequest;
    const { type, query } = payload;

    logger.info({
      requestId: request.id,
      dataType: type,
      query,
    }, 'Fetching data');

    let data: unknown;
    let source = 'unknown';

    switch (type) {
      case 'price': {
        const result = await getPrice(query.asset as string, query.source as string);
        data = result;
        source = result.source;
        break;
      }
      case 'orderbook': {
        const result = await getOrderbook(query.marketId as string, query.source as string);
        data = result;
        source = result.source;
        break;
      }
      case 'candles': {
        data = await getCandles(
          query.asset as string,
          query.interval as string,
          query.limit as number
        );
        source = 'coingecko';
        break;
      }
      case 'markets': {
        data = await getMarkets(query.platform as string, query.filter as Record<string, unknown>);
        source = query.platform as string;
        break;
      }
      case 'positions': {
        data = await getPositions(query.wallet as string, query.platform as string);
        source = query.platform as string;
        break;
      }
      case 'balance': {
        data = await getBalance(query.wallet as string, query.chain as string);
        source = query.chain as string;
        break;
      }
      case 'news': {
        data = await getNews(query.topic as string, query.limit as number);
        source = 'aggregated';
        break;
      }
      case 'sentiment': {
        data = await getSentiment(query.topic as string);
        source = 'social';
        break;
      }
      default:
        throw new Error(`Unknown data type: ${type}`);
    }

    return {
      type,
      data,
      timestamp: Date.now(),
      source,
    };
  }

  async function getPrice(asset: string, source?: string): Promise<PriceData> {
    const cacheKey = `price:${asset}:${source || 'default'}`;
    const cached = getCached<PriceData>(cacheKey);
    if (cached) return cached;

    // Try CoinGecko first
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${asset}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
        {
          headers: cfg.coingeckoKey ? { 'x-cg-demo-api-key': cfg.coingeckoKey } : {},
        }
      );

      if (response.ok) {
        const data = await response.json() as Record<string, {
          usd: number;
          usd_24h_change: number;
          usd_24h_vol: number;
          usd_market_cap: number;
        }>;

        const assetData = data[asset.toLowerCase()];
        if (assetData) {
          const result: PriceData = {
            asset,
            price: assetData.usd,
            change24h: assetData.usd_24h_change,
            volume24h: assetData.usd_24h_vol,
            marketCap: assetData.usd_market_cap,
            source: 'coingecko',
            timestamp: Date.now(),
          };
          setCache(cacheKey, result);
          return result;
        }
      }
    } catch (error) {
      logger.warn({ error, asset }, 'CoinGecko price fetch failed');
    }

    // Fallback to Binance for common pairs
    try {
      const symbol = `${asset.toUpperCase()}USDT`;
      const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);

      if (response.ok) {
        const data = await response.json() as {
          lastPrice: string;
          priceChangePercent: string;
          volume: string;
        };

        const result: PriceData = {
          asset,
          price: parseFloat(data.lastPrice),
          change24h: parseFloat(data.priceChangePercent),
          volume24h: parseFloat(data.volume) * parseFloat(data.lastPrice),
          source: 'binance',
          timestamp: Date.now(),
        };
        setCache(cacheKey, result);
        return result;
      }
    } catch (error) {
      logger.warn({ error, asset }, 'Binance price fetch failed');
    }

    throw new Error(`Could not fetch price for ${asset}`);
  }

  async function getOrderbook(marketId: string, source: string): Promise<OrderbookData> {
    const cacheKey = `orderbook:${marketId}:${source}`;
    const cached = getCached<OrderbookData>(cacheKey);
    if (cached) return cached;

    if (source === 'polymarket') {
      const response = await fetch(`https://clob.polymarket.com/book?token_id=${marketId}`);

      if (!response.ok) {
        throw new Error(`Polymarket orderbook fetch failed: ${response.status}`);
      }

      const data = await response.json() as {
        bids: Array<{ price: string; size: string }>;
        asks: Array<{ price: string; size: string }>;
      };

      const bids = data.bids.map(b => ({ price: parseFloat(b.price), size: parseFloat(b.size) }));
      const asks = data.asks.map(a => ({ price: parseFloat(a.price), size: parseFloat(a.size) }));

      const bestBid = bids[0]?.price || 0;
      const bestAsk = asks[0]?.price || 1;

      const result: OrderbookData = {
        marketId,
        bids,
        asks,
        spread: bestAsk - bestBid,
        midPrice: (bestBid + bestAsk) / 2,
        source: 'polymarket',
        timestamp: Date.now(),
      };

      setCache(cacheKey, result, 5); // 5 second cache for orderbooks
      return result;
    }

    throw new Error(`Orderbook source ${source} not supported`);
  }

  async function getCandles(
    asset: string,
    interval: string = '1h',
    limit: number = 100
  ): Promise<CandleData[]> {
    const cacheKey = `candles:${asset}:${interval}:${limit}`;
    const cached = getCached<CandleData[]>(cacheKey);
    if (cached) return cached;

    // Use Binance for candles
    const intervalMap: Record<string, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
    };

    const symbol = `${asset.toUpperCase()}USDT`;
    const binanceInterval = intervalMap[interval] || '1h';

    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Binance candles fetch failed: ${response.status}`);
    }

    const data = await response.json() as Array<[
      number, string, string, string, string, string, number, string, number, string, string, string
    ]>;

    const candles: CandleData[] = data.map(kline => ({
      timestamp: kline[0],
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }));

    setCache(cacheKey, candles, 60);
    return candles;
  }

  async function getMarkets(
    platform: string,
    filter?: Record<string, unknown>
  ): Promise<unknown> {
    if (platform === 'polymarket') {
      const response = await fetch('https://gamma-api.polymarket.com/markets?closed=false&limit=100');

      if (!response.ok) {
        throw new Error(`Polymarket markets fetch failed: ${response.status}`);
      }

      return response.json();
    }

    throw new Error(`Markets for ${platform} not supported`);
  }

  async function getPositions(wallet: string, platform: string): Promise<PositionData[]> {
    if (platform === 'polymarket') {
      // Would need to query the subgraph or CLOB API
      // Simplified implementation
      return [];
    }

    throw new Error(`Positions for ${platform} not supported`);
  }

  async function getBalance(wallet: string, chain: string): Promise<BalanceData[]> {
    // Would need to query RPC or indexer
    // Simplified implementation
    return [];
  }

  async function getNews(topic: string, limit: number = 10): Promise<unknown> {
    // Would integrate with news APIs
    return [];
  }

  async function getSentiment(topic: string): Promise<unknown> {
    // Would integrate with social APIs
    return {
      topic,
      score: 0,
      sources: [],
    };
  }

  return {
    execute,
    getDataTypes,
    getPrice,
    getOrderbook,
  };
}
