/**
 * Crypto Price Feed - Real-time prices for all major cryptos
 *
 * Supports: BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, MATIC, DOT, LINK
 *
 * Features:
 * - WebSocket streams from Binance (real-time)
 * - REST fallback from Coinbase, CoinGecko
 * - Price comparison (spot vs Polymarket prediction markets)
 * - OHLCV historical data
 * - 24h change tracking
 */

import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';
import { logger } from '../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface CryptoPrices {
  BTC: number;
  ETH: number;
  SOL: number;
  XRP: number;
  DOGE: number;
  ADA: number;
  AVAX: number;
  MATIC: number;
  DOT: number;
  LINK: number;
  timestamp: Date;
}

export interface PriceUpdate {
  symbol: string;
  price: number;
  volume24h?: number;
  change24h?: number;
  changePct24h?: number;
  high24h?: number;
  low24h?: number;
  timestamp: Date;
  source: 'binance' | 'coinbase' | 'coingecko';
}

export interface OHLCV {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CryptoFeed extends EventEmitter {
  /** Start WebSocket connections */
  start(): void;

  /** Stop all connections */
  stop(): void;

  /** Get current BTC price */
  getBTCPrice(): number | null;

  /** Get current ETH price */
  getETHPrice(): number | null;

  /** Get current SOL price */
  getSOLPrice(): number | null;

  /** Get current XRP price */
  getXRPPrice(): number | null;

  /** Get current DOGE price */
  getDOGEPrice(): number | null;

  /** Get all current prices */
  getPrices(): CryptoPrices | null;

  /** Get price for any symbol */
  getPrice(symbol: string): number | null;

  /** Get full price data including 24h stats */
  getPriceData(symbol: string): PriceUpdate | null;

  /** Subscribe to price updates */
  subscribePrices(callback: (prices: CryptoPrices) => void): () => void;

  /** Subscribe to a specific symbol */
  subscribeSymbol(symbol: string, callback: (update: PriceUpdate) => void): () => void;

  /** Fetch OHLCV data */
  getOHLCV(symbol: string, interval: string, limit?: number): Promise<OHLCV[]>;

  /** Get 24h price change */
  get24hChange(symbol: string): Promise<{ change: number; changePct: number } | null>;

  /** Compare spot price to a target (e.g., Polymarket price) */
  getDivergence(symbol: string, targetPrice: number): { spot: number; target: number; diff: number; diffPct: number } | null;

  /** Check if feed is connected */
  isConnected(): boolean;

  /** Get all supported symbols */
  getSupportedSymbols(): string[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';
const BINANCE_REST_URL = 'https://api.binance.com/api/v3';
const COINBASE_REST_URL = 'https://api.coinbase.com/v2';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3';

// All supported trading pairs
const SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'MATICUSDT',
  'DOTUSDT',
  'LINKUSDT',
];

// Map Binance symbols to normalized names
const SYMBOL_TO_NAME: Record<string, string> = {
  'BTCUSDT': 'BTC',
  'ETHUSDT': 'ETH',
  'SOLUSDT': 'SOL',
  'XRPUSDT': 'XRP',
  'DOGEUSDT': 'DOGE',
  'ADAUSDT': 'ADA',
  'AVAXUSDT': 'AVAX',
  'MATICUSDT': 'MATIC',
  'DOTUSDT': 'DOT',
  'LINKUSDT': 'LINK',
};

// Map normalized names to Binance symbols
const NAME_TO_SYMBOL: Record<string, string> = {
  'BTC': 'BTCUSDT',
  'ETH': 'ETHUSDT',
  'SOL': 'SOLUSDT',
  'XRP': 'XRPUSDT',
  'DOGE': 'DOGEUSDT',
  'ADA': 'ADAUSDT',
  'AVAX': 'AVAXUSDT',
  'MATIC': 'MATICUSDT',
  'DOT': 'DOTUSDT',
  'LINK': 'LINKUSDT',
};

// CoinGecko IDs for fallback
const COINGECKO_IDS: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'SOL': 'solana',
  'XRP': 'ripple',
  'DOGE': 'dogecoin',
  'ADA': 'cardano',
  'AVAX': 'avalanche-2',
  'MATIC': 'matic-network',
  'DOT': 'polkadot',
  'LINK': 'chainlink',
};

// Coinbase pair names
const COINBASE_PAIRS: Record<string, string> = {
  'BTC': 'BTC-USD',
  'ETH': 'ETH-USD',
  'SOL': 'SOL-USD',
  'XRP': 'XRP-USD',
  'DOGE': 'DOGE-USD',
  'ADA': 'ADA-USD',
  'AVAX': 'AVAX-USD',
  'MATIC': 'MATIC-USD',
  'DOT': 'DOT-USD',
  'LINK': 'LINK-USD',
};

// =============================================================================
// BINANCE WEBSOCKET MESSAGE TYPES
// =============================================================================

interface BinanceTickerMessage {
  e: string;       // Event type: "24hrTicker"
  E: number;       // Event time
  s: string;       // Symbol: "BTCUSDT"
  p: string;       // Price change
  P: string;       // Price change percent
  w: string;       // Weighted average price
  c: string;       // Last price (close)
  Q: string;       // Last quantity
  o: string;       // Open price
  h: string;       // High price
  l: string;       // Low price
  v: string;       // Total traded base asset volume
  q: string;       // Total traded quote asset volume
}

// =============================================================================
// FALLBACK PRICE FETCHERS
// =============================================================================

async function fetchCoinbasePrice(symbol: string): Promise<number | null> {
  const pair = COINBASE_PAIRS[symbol];
  if (!pair) return null;

  try {
    const response = await fetch(`${COINBASE_REST_URL}/prices/${pair}/spot`);
    if (!response.ok) return null;

    const data = (await response.json()) as { data: { amount: string } };
    return parseFloat(data.data.amount);
  } catch {
    return null;
  }
}

async function fetchCoingeckoPrices(): Promise<Partial<CryptoPrices> | null> {
  try {
    const ids = Object.values(COINGECKO_IDS).join(',');
    const response = await fetch(`${COINGECKO_URL}/simple/price?ids=${ids}&vs_currencies=usd`);
    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, { usd: number }>;

    const prices: Partial<CryptoPrices> = {};
    for (const [symbol, cgId] of Object.entries(COINGECKO_IDS)) {
      if (data[cgId]?.usd) {
        (prices as Record<string, number>)[symbol] = data[cgId].usd;
      }
    }

    return prices;
  } catch {
    return null;
  }
}

async function fetchBinancePrice(symbol: string): Promise<number | null> {
  const binanceSymbol = NAME_TO_SYMBOL[symbol.toUpperCase()] || `${symbol.toUpperCase()}USDT`;

  try {
    const response = await fetch(`${BINANCE_REST_URL}/ticker/price?symbol=${binanceSymbol}`);
    if (!response.ok) return null;

    const data = (await response.json()) as { price: string };
    return parseFloat(data.price);
  } catch {
    return null;
  }
}

async function fetchBinance24hr(symbol: string): Promise<PriceUpdate | null> {
  const binanceSymbol = NAME_TO_SYMBOL[symbol.toUpperCase()] || `${symbol.toUpperCase()}USDT`;

  try {
    const response = await fetch(`${BINANCE_REST_URL}/ticker/24hr?symbol=${binanceSymbol}`);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      lastPrice: string;
      priceChange: string;
      priceChangePercent: string;
      highPrice: string;
      lowPrice: string;
      volume: string;
      quoteVolume: string;
    };

    return {
      symbol: symbol.toUpperCase(),
      price: parseFloat(data.lastPrice),
      change24h: parseFloat(data.priceChange),
      changePct24h: parseFloat(data.priceChangePercent),
      high24h: parseFloat(data.highPrice),
      low24h: parseFloat(data.lowPrice),
      volume24h: parseFloat(data.quoteVolume),
      timestamp: new Date(),
      source: 'binance',
    };
  } catch {
    return null;
  }
}

// =============================================================================
// CRYPTO FEED SERVICE
// =============================================================================

export function createCryptoFeed(): CryptoFeed {
  const emitter = new EventEmitter() as CryptoFeed;
  let ws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let pingInterval: NodeJS.Timeout | null = null;
  let connected = false;

  // Store latest prices and full price data
  const prices = new Map<string, number>();
  const priceData = new Map<string, PriceUpdate>();
  let lastUpdate: Date | null = null;

  function normalizeSymbol(symbol: string): string {
    const upper = symbol.toUpperCase().replace('USDT', '').replace('USD', '').replace('-', '');
    return upper;
  }

  function connect() {
    if (ws) return;

    // Subscribe to all ticker streams
    const streams = SYMBOLS.map((s) => `${s.toLowerCase()}@ticker`).join('/');
    const url = `${BINANCE_WS_URL}/${streams}`;

    logger.info({ symbols: SYMBOLS.length }, 'Connecting to Binance WebSocket');
    ws = new WebSocket(url);

    ws.on('open', () => {
      logger.info('Binance WebSocket connected');
      connected = true;

      // Start ping interval to keep connection alive
      pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 30000);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as BinanceTickerMessage;

        if (message.e === '24hrTicker' && message.s && message.c) {
          const symbol = SYMBOL_TO_NAME[message.s] || message.s;
          const price = parseFloat(message.c);

          prices.set(symbol, price);
          lastUpdate = new Date();

          // Store full price data
          const update: PriceUpdate = {
            symbol,
            price,
            change24h: parseFloat(message.p),
            changePct24h: parseFloat(message.P),
            high24h: parseFloat(message.h),
            low24h: parseFloat(message.l),
            volume24h: parseFloat(message.q),
            timestamp: lastUpdate,
            source: 'binance',
          };
          priceData.set(symbol, update);

          // Emit individual update
          emitter.emit('price', update);
          emitter.emit(`price:${symbol}`, update);

          // Emit combined prices if we have the major ones
          if (prices.has('BTC') && prices.has('ETH') && prices.has('XRP')) {
            const combined: CryptoPrices = {
              BTC: prices.get('BTC') || 0,
              ETH: prices.get('ETH') || 0,
              SOL: prices.get('SOL') || 0,
              XRP: prices.get('XRP') || 0,
              DOGE: prices.get('DOGE') || 0,
              ADA: prices.get('ADA') || 0,
              AVAX: prices.get('AVAX') || 0,
              MATIC: prices.get('MATIC') || 0,
              DOT: prices.get('DOT') || 0,
              LINK: prices.get('LINK') || 0,
              timestamp: lastUpdate,
            };
            emitter.emit('prices', combined);
          }
        }
      } catch (err) {
        logger.debug({ err }, 'Failed to parse Binance message');
      }
    });

    ws.on('close', () => {
      logger.warn('Binance WebSocket disconnected');
      ws = null;
      connected = false;

      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }

      // Reconnect after delay
      reconnectTimer = setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'Binance WebSocket error');
    });

    ws.on('pong', () => {
      logger.debug('Binance pong received');
    });
  }

  // Attach methods to emitter
  Object.assign(emitter, {
    start() {
      connect();
    },

    stop() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }

      if (ws) {
        ws.close();
        ws = null;
      }

      connected = false;
      logger.info('Crypto feed stopped');
    },

    getBTCPrice() {
      return prices.get('BTC') || null;
    },

    getETHPrice() {
      return prices.get('ETH') || null;
    },

    getSOLPrice() {
      return prices.get('SOL') || null;
    },

    getXRPPrice() {
      return prices.get('XRP') || null;
    },

    getDOGEPrice() {
      return prices.get('DOGE') || null;
    },

    getPrices() {
      if (!prices.has('BTC')) return null;

      return {
        BTC: prices.get('BTC') || 0,
        ETH: prices.get('ETH') || 0,
        SOL: prices.get('SOL') || 0,
        XRP: prices.get('XRP') || 0,
        DOGE: prices.get('DOGE') || 0,
        ADA: prices.get('ADA') || 0,
        AVAX: prices.get('AVAX') || 0,
        MATIC: prices.get('MATIC') || 0,
        DOT: prices.get('DOT') || 0,
        LINK: prices.get('LINK') || 0,
        timestamp: lastUpdate || new Date(),
      };
    },

    getPrice(symbol: string) {
      const normalized = normalizeSymbol(symbol);
      return prices.get(normalized) || null;
    },

    getPriceData(symbol: string) {
      const normalized = normalizeSymbol(symbol);
      return priceData.get(normalized) || null;
    },

    subscribePrices(callback) {
      emitter.on('prices', callback);
      return () => emitter.off('prices', callback);
    },

    subscribeSymbol(symbol, callback) {
      const normalized = normalizeSymbol(symbol);
      const event = `price:${normalized}`;
      emitter.on(event, callback);
      return () => emitter.off(event, callback);
    },

    async getOHLCV(symbol, interval, limit = 100) {
      const normalized = normalizeSymbol(symbol);
      const binanceSymbol = NAME_TO_SYMBOL[normalized] || `${normalized}USDT`;

      try {
        const response = await fetch(
          `${BINANCE_REST_URL}/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`
        );
        if (!response.ok) return [];

        const data = (await response.json()) as Array<[number, string, string, string, string, string]>;

        return data.map((k) => ({
          timestamp: new Date(k[0]),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
      } catch {
        return [];
      }
    },

    async get24hChange(symbol) {
      const normalized = normalizeSymbol(symbol);

      // Try from cache first
      const cached = priceData.get(normalized);
      if (cached && cached.change24h !== undefined) {
        return {
          change: cached.change24h,
          changePct: cached.changePct24h || 0,
        };
      }

      // Fetch from API
      const data = await fetchBinance24hr(normalized);
      if (data && data.change24h !== undefined) {
        return {
          change: data.change24h,
          changePct: data.changePct24h || 0,
        };
      }

      return null;
    },

    getDivergence(symbol, targetPrice) {
      const spot = emitter.getPrice(symbol);
      if (spot === null) return null;

      const diff = spot - targetPrice;
      const diffPct = (diff / targetPrice) * 100;

      return {
        spot,
        target: targetPrice,
        diff,
        diffPct,
      };
    },

    isConnected() {
      return connected;
    },

    getSupportedSymbols() {
      return Object.keys(NAME_TO_SYMBOL);
    },
  } as Partial<CryptoFeed>);

  return emitter;
}

// =============================================================================
// STANDALONE PRICE FETCHERS (no WebSocket needed)
// =============================================================================

export async function getBTCPrice(): Promise<number | null> {
  return fetchBinancePrice('BTC');
}

export async function getETHPrice(): Promise<number | null> {
  return fetchBinancePrice('ETH');
}

export async function getSOLPrice(): Promise<number | null> {
  return fetchBinancePrice('SOL');
}

export async function getXRPPrice(): Promise<number | null> {
  return fetchBinancePrice('XRP');
}

export async function getDOGEPrice(): Promise<number | null> {
  return fetchBinancePrice('DOGE');
}

export async function getPrice(symbol: string): Promise<number | null> {
  // Try Binance first
  let price = await fetchBinancePrice(symbol);
  if (price !== null) return price;

  // Try Coinbase
  price = await fetchCoinbasePrice(symbol.toUpperCase());
  if (price !== null) return price;

  // Try CoinGecko
  const cgPrices = await fetchCoingeckoPrices();
  const normalized = symbol.toUpperCase().replace('USDT', '').replace('USD', '');
  if (cgPrices && normalized in cgPrices) {
    return (cgPrices as Record<string, number>)[normalized];
  }

  return null;
}

export async function getAllPrices(): Promise<CryptoPrices | null> {
  const symbols = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'MATIC', 'DOT', 'LINK'];

  const results = await Promise.all(symbols.map((s) => fetchBinancePrice(s)));

  if (results[0] === null) return null;

  return {
    BTC: results[0] || 0,
    ETH: results[1] || 0,
    SOL: results[2] || 0,
    XRP: results[3] || 0,
    DOGE: results[4] || 0,
    ADA: results[5] || 0,
    AVAX: results[6] || 0,
    MATIC: results[7] || 0,
    DOT: results[8] || 0,
    LINK: results[9] || 0,
    timestamp: new Date(),
  };
}

export async function getPriceWithDetails(symbol: string): Promise<PriceUpdate | null> {
  return fetchBinance24hr(symbol);
}

// =============================================================================
// UTILITY: Format price for display
// =============================================================================

export function formatPrice(price: number, symbol?: string): string {
  if (symbol === 'DOGE' || symbol === 'XRP' || symbol === 'ADA') {
    return `$${price.toFixed(4)}`;
  }
  if (price >= 1000) {
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  return `$${price.toFixed(4)}`;
}

export function formatChange(change: number, changePct: number): string {
  const sign = change >= 0 ? '+' : '';
  const emoji = change >= 0 ? '🟢' : '🔴';
  return `${emoji} ${sign}${formatPrice(Math.abs(change))} (${sign}${changePct.toFixed(2)}%)`;
}

// =============================================================================
// WHALE TRACKER RE-EXPORTS
// =============================================================================

export * from './whale-tracker';
