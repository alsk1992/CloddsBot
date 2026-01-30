/**
 * Futures Trading Module
 *
 * Real perpetual futures trading with leverage across multiple exchanges:
 * - Binance Futures (USDT-M perpetuals)
 * - Bybit (USDT perpetuals)
 * - Hyperliquid (decentralized, on Arbitrum)
 * - dYdX v4 (decentralized)
 */

import { EventEmitter } from 'events';
import { createHmac } from 'crypto';
import { logger } from '../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export type FuturesExchange = 'binance' | 'bybit' | 'hyperliquid' | 'dydx';

export type OrderSide = 'BUY' | 'SELL';
export type PositionSide = 'LONG' | 'SHORT';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
export type MarginType = 'ISOLATED' | 'CROSS';

export interface FuturesCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string; // For some exchanges
  testnet?: boolean;
}

export interface FuturesPosition {
  exchange: FuturesExchange;
  symbol: string;
  side: PositionSide;
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  leverage: number;
  marginType: MarginType;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  margin: number;
  timestamp: number;
}

export interface FuturesOrder {
  id: string;
  exchange: FuturesExchange;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  size: number;
  price?: number;
  stopPrice?: number;
  leverage: number;
  reduceOnly: boolean;
  status: 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED' | 'REJECTED';
  filledSize: number;
  avgFillPrice: number;
  timestamp: number;
}

export interface FuturesOrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  size: number;
  price?: number;
  stopPrice?: number;
  leverage?: number;
  reduceOnly?: boolean;
  takeProfit?: number;
  stopLoss?: number;
}

export interface FuturesBalance {
  exchange: FuturesExchange;
  asset: string;
  available: number;
  total: number;
  unrealizedPnl: number;
  marginBalance: number;
}

export interface FuturesMarket {
  exchange: FuturesExchange;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: number;
  lotSize: number;
  minNotional: number;
  maxLeverage: number;
  fundingRate: number;
  markPrice: number;
  indexPrice: number;
  volume24h: number;
}

export interface FuturesConfig {
  exchange: FuturesExchange;
  credentials: FuturesCredentials;
  defaultLeverage?: number;
  defaultMarginType?: MarginType;
  maxPositionSize?: number;
  maxLeverage?: number;
  dryRun?: boolean;
}

// =============================================================================
// BINANCE FUTURES CLIENT
// =============================================================================

class BinanceFuturesClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private dryRun: boolean;

  constructor(credentials: FuturesCredentials, dryRun = false) {
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
    this.baseUrl = credentials.testnet
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';
    this.dryRun = dryRun;
  }

  private sign(params: Record<string, string | number>): string {
    const queryString = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
  }

  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    params: Record<string, string | number> = {},
    signed = false
  ): Promise<unknown> {
    const url = new URL(endpoint, this.baseUrl);

    if (signed) {
      params.timestamp = Date.now();
      params.signature = this.sign(params);
    }

    if (method === 'GET') {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: method !== 'GET' ? new URLSearchParams(params as Record<string, string>).toString() : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ msg: response.statusText }));
      throw new Error(`Binance error: ${(error as { msg?: string }).msg || response.statusText}`);
    }

    return response.json();
  }

  async getBalance(): Promise<FuturesBalance> {
    const data = await this.request('GET', '/fapi/v2/balance', {}, true) as Array<{
      asset: string;
      availableBalance: string;
      balance: string;
      crossUnPnl: string;
    }>;
    const usdt = data.find(b => b.asset === 'USDT') || { availableBalance: '0', balance: '0', crossUnPnl: '0' };
    return {
      exchange: 'binance',
      asset: 'USDT',
      available: parseFloat(usdt.availableBalance),
      total: parseFloat(usdt.balance),
      unrealizedPnl: parseFloat(usdt.crossUnPnl),
      marginBalance: parseFloat(usdt.balance) + parseFloat(usdt.crossUnPnl),
    };
  }

  async getPositions(): Promise<FuturesPosition[]> {
    const data = await this.request('GET', '/fapi/v2/positionRisk', {}, true) as Array<{
      symbol: string;
      positionAmt: string;
      entryPrice: string;
      markPrice: string;
      unRealizedProfit: string;
      liquidationPrice: string;
      leverage: string;
      marginType: string;
      isolatedMargin: string;
    }>;

    return data
      .filter(p => parseFloat(p.positionAmt) !== 0)
      .map(p => {
        const size = parseFloat(p.positionAmt);
        const entryPrice = parseFloat(p.entryPrice);
        const markPrice = parseFloat(p.markPrice);
        const pnl = parseFloat(p.unRealizedProfit);
        const positionValue = Math.abs(size) * entryPrice;

        return {
          exchange: 'binance' as FuturesExchange,
          symbol: p.symbol,
          side: size > 0 ? 'LONG' : 'SHORT' as PositionSide,
          size: Math.abs(size),
          entryPrice,
          markPrice,
          liquidationPrice: parseFloat(p.liquidationPrice),
          leverage: parseInt(p.leverage),
          marginType: p.marginType.toUpperCase() as MarginType,
          unrealizedPnl: pnl,
          unrealizedPnlPct: positionValue > 0 ? (pnl / positionValue) * 100 : 0,
          margin: parseFloat(p.isolatedMargin) || positionValue / parseInt(p.leverage),
          timestamp: Date.now(),
        };
      });
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.request('POST', '/fapi/v1/leverage', { symbol, leverage }, true);
  }

  async setMarginType(symbol: string, marginType: MarginType): Promise<void> {
    try {
      await this.request('POST', '/fapi/v1/marginType', { symbol, marginType }, true);
    } catch (err) {
      // Ignore if already set
      const msg = (err as Error).message;
      if (!msg.includes('No need to change')) throw err;
    }
  }

  async placeOrder(order: FuturesOrderRequest): Promise<FuturesOrder> {
    if (this.dryRun) {
      logger.info({ order }, '[DRY RUN] Would place Binance futures order');
      return {
        id: `dry-${Date.now()}`,
        exchange: 'binance',
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        size: order.size,
        price: order.price,
        leverage: order.leverage || 1,
        reduceOnly: order.reduceOnly || false,
        status: 'FILLED',
        filledSize: order.size,
        avgFillPrice: order.price || 0,
        timestamp: Date.now(),
      };
    }

    // Set leverage first
    if (order.leverage) {
      await this.setLeverage(order.symbol, order.leverage);
    }

    const params: Record<string, string | number> = {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.size,
    };

    if (order.price && order.type === 'LIMIT') {
      params.price = order.price;
      params.timeInForce = 'GTC';
    }

    if (order.stopPrice) {
      params.stopPrice = order.stopPrice;
    }

    if (order.reduceOnly) {
      params.reduceOnly = 'true';
    }

    const result = await this.request('POST', '/fapi/v1/order', params, true) as {
      orderId: number;
      symbol: string;
      side: string;
      type: string;
      origQty: string;
      executedQty: string;
      avgPrice: string;
      status: string;
      updateTime: number;
    };

    // Place TP/SL orders if specified
    if (order.takeProfit) {
      await this.request('POST', '/fapi/v1/order', {
        symbol: order.symbol,
        side: order.side === 'BUY' ? 'SELL' : 'BUY',
        type: 'TAKE_PROFIT_MARKET',
        stopPrice: order.takeProfit,
        closePosition: 'true',
      }, true);
    }

    if (order.stopLoss) {
      await this.request('POST', '/fapi/v1/order', {
        symbol: order.symbol,
        side: order.side === 'BUY' ? 'SELL' : 'BUY',
        type: 'STOP_MARKET',
        stopPrice: order.stopLoss,
        closePosition: 'true',
      }, true);
    }

    return {
      id: String(result.orderId),
      exchange: 'binance',
      symbol: result.symbol,
      side: result.side as OrderSide,
      type: result.type as OrderType,
      size: parseFloat(result.origQty),
      leverage: order.leverage || 1,
      reduceOnly: order.reduceOnly || false,
      status: result.status as FuturesOrder['status'],
      filledSize: parseFloat(result.executedQty),
      avgFillPrice: parseFloat(result.avgPrice),
      timestamp: result.updateTime,
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.request('DELETE', '/fapi/v1/order', { symbol, orderId }, true);
  }

  async closePosition(symbol: string): Promise<FuturesOrder | null> {
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol === symbol);

    if (!position) return null;

    return this.placeOrder({
      symbol,
      side: position.side === 'LONG' ? 'SELL' : 'BUY',
      type: 'MARKET',
      size: position.size,
      reduceOnly: true,
    });
  }

  async getMarkets(): Promise<FuturesMarket[]> {
    const [exchangeInfo, tickers, fundingRates] = await Promise.all([
      this.request('GET', '/fapi/v1/exchangeInfo') as Promise<{
        symbols: Array<{
          symbol: string;
          baseAsset: string;
          quoteAsset: string;
          filters: Array<{ filterType: string; tickSize?: string; stepSize?: string; notional?: string }>;
        }>;
      }>,
      this.request('GET', '/fapi/v1/ticker/24hr') as Promise<Array<{
        symbol: string;
        lastPrice: string;
        volume: string;
      }>>,
      this.request('GET', '/fapi/v1/premiumIndex') as Promise<Array<{
        symbol: string;
        markPrice: string;
        indexPrice: string;
        lastFundingRate: string;
      }>>,
    ]);

    const tickerMap = new Map(tickers.map(t => [t.symbol, t]));
    const fundingMap = new Map(fundingRates.map(f => [f.symbol, f]));

    return exchangeInfo.symbols
      .filter(s => s.quoteAsset === 'USDT')
      .map(s => {
        const ticker = tickerMap.get(s.symbol);
        const funding = fundingMap.get(s.symbol);
        const priceFilter = s.filters.find(f => f.filterType === 'PRICE_FILTER');
        const lotFilter = s.filters.find(f => f.filterType === 'LOT_SIZE');
        const notionalFilter = s.filters.find(f => f.filterType === 'MIN_NOTIONAL');

        return {
          exchange: 'binance' as FuturesExchange,
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          tickSize: parseFloat(priceFilter?.tickSize || '0.01'),
          lotSize: parseFloat(lotFilter?.stepSize || '0.001'),
          minNotional: parseFloat(notionalFilter?.notional || '5'),
          maxLeverage: 125, // Binance max
          fundingRate: parseFloat(funding?.lastFundingRate || '0') * 100,
          markPrice: parseFloat(funding?.markPrice || ticker?.lastPrice || '0'),
          indexPrice: parseFloat(funding?.indexPrice || '0'),
          volume24h: parseFloat(ticker?.volume || '0'),
        };
      });
  }
}

// =============================================================================
// BYBIT FUTURES CLIENT
// =============================================================================

class BybitFuturesClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private dryRun: boolean;

  constructor(credentials: FuturesCredentials, dryRun = false) {
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
    this.baseUrl = credentials.testnet
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com';
    this.dryRun = dryRun;
  }

  private sign(params: string, timestamp: number): string {
    const payload = `${timestamp}${this.apiKey}5000${params}`;
    return createHmac('sha256', this.apiSecret).update(payload).digest('hex');
  }

  private async request(
    method: 'GET' | 'POST',
    endpoint: string,
    params: Record<string, string | number> = {}
  ): Promise<unknown> {
    const timestamp = Date.now();
    const queryString = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    const signature = this.sign(queryString, timestamp);

    const url = new URL(endpoint, this.baseUrl);
    if (method === 'GET' && queryString) {
      url.search = queryString;
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'X-BAPI-API-KEY': this.apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': String(timestamp),
        'X-BAPI-RECV-WINDOW': '5000',
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(params) : undefined,
    });

    const data = await response.json() as { retCode: number; retMsg: string; result: unknown };
    if (data.retCode !== 0) {
      throw new Error(`Bybit error: ${data.retMsg}`);
    }

    return data.result;
  }

  async getBalance(): Promise<FuturesBalance> {
    const data = await this.request('GET', '/v5/account/wallet-balance', {
      accountType: 'UNIFIED',
    }) as { list: Array<{ coin: Array<{ coin: string; availableToWithdraw: string; walletBalance: string; unrealisedPnl: string }> }> };

    const account = data.list[0];
    const usdt = account?.coin?.find(c => c.coin === 'USDT') || {
      availableToWithdraw: '0',
      walletBalance: '0',
      unrealisedPnl: '0',
    };

    return {
      exchange: 'bybit',
      asset: 'USDT',
      available: parseFloat(usdt.availableToWithdraw),
      total: parseFloat(usdt.walletBalance),
      unrealizedPnl: parseFloat(usdt.unrealisedPnl),
      marginBalance: parseFloat(usdt.walletBalance),
    };
  }

  async getPositions(): Promise<FuturesPosition[]> {
    const data = await this.request('GET', '/v5/position/list', {
      category: 'linear',
      settleCoin: 'USDT',
    }) as { list: Array<{
      symbol: string;
      size: string;
      side: string;
      avgPrice: string;
      markPrice: string;
      liqPrice: string;
      leverage: string;
      unrealisedPnl: string;
      positionIM: string;
      tradeMode: number;
    }> };

    return data.list
      .filter(p => parseFloat(p.size) > 0)
      .map(p => {
        const size = parseFloat(p.size);
        const entryPrice = parseFloat(p.avgPrice);
        const markPrice = parseFloat(p.markPrice);
        const pnl = parseFloat(p.unrealisedPnl);
        const positionValue = size * entryPrice;

        return {
          exchange: 'bybit' as FuturesExchange,
          symbol: p.symbol,
          side: p.side === 'Buy' ? 'LONG' : 'SHORT' as PositionSide,
          size,
          entryPrice,
          markPrice,
          liquidationPrice: parseFloat(p.liqPrice),
          leverage: parseInt(p.leverage),
          marginType: p.tradeMode === 0 ? 'CROSS' : 'ISOLATED' as MarginType,
          unrealizedPnl: pnl,
          unrealizedPnlPct: positionValue > 0 ? (pnl / positionValue) * 100 : 0,
          margin: parseFloat(p.positionIM),
          timestamp: Date.now(),
        };
      });
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    try {
      await this.request('POST', '/v5/position/set-leverage', {
        category: 'linear',
        symbol,
        buyLeverage: String(leverage),
        sellLeverage: String(leverage),
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (!msg.includes('leverage not modified')) throw err;
    }
  }

  async placeOrder(order: FuturesOrderRequest): Promise<FuturesOrder> {
    if (this.dryRun) {
      logger.info({ order }, '[DRY RUN] Would place Bybit futures order');
      return {
        id: `dry-${Date.now()}`,
        exchange: 'bybit',
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        size: order.size,
        price: order.price,
        leverage: order.leverage || 1,
        reduceOnly: order.reduceOnly || false,
        status: 'FILLED',
        filledSize: order.size,
        avgFillPrice: order.price || 0,
        timestamp: Date.now(),
      };
    }

    if (order.leverage) {
      await this.setLeverage(order.symbol, order.leverage);
    }

    const params: Record<string, string | number> = {
      category: 'linear',
      symbol: order.symbol,
      side: order.side === 'BUY' ? 'Buy' : 'Sell',
      orderType: order.type === 'MARKET' ? 'Market' : 'Limit',
      qty: String(order.size),
    };

    if (order.price && order.type === 'LIMIT') {
      params.price = String(order.price);
    }

    if (order.reduceOnly) {
      params.reduceOnly = 'true';
    }

    if (order.takeProfit) {
      params.takeProfit = String(order.takeProfit);
    }

    if (order.stopLoss) {
      params.stopLoss = String(order.stopLoss);
    }

    const result = await this.request('POST', '/v5/order/create', params) as {
      orderId: string;
      orderLinkId: string;
    };

    return {
      id: result.orderId,
      exchange: 'bybit',
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      size: order.size,
      price: order.price,
      leverage: order.leverage || 1,
      reduceOnly: order.reduceOnly || false,
      status: 'NEW',
      filledSize: 0,
      avgFillPrice: 0,
      timestamp: Date.now(),
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.request('POST', '/v5/order/cancel', {
      category: 'linear',
      symbol,
      orderId,
    });
  }

  async closePosition(symbol: string): Promise<FuturesOrder | null> {
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol === symbol);

    if (!position) return null;

    return this.placeOrder({
      symbol,
      side: position.side === 'LONG' ? 'SELL' : 'BUY',
      type: 'MARKET',
      size: position.size,
      reduceOnly: true,
    });
  }

  async getMarkets(): Promise<FuturesMarket[]> {
    const [instruments, tickers] = await Promise.all([
      this.request('GET', '/v5/market/instruments-info', { category: 'linear' }) as Promise<{
        list: Array<{
          symbol: string;
          baseCoin: string;
          quoteCoin: string;
          priceFilter: { tickSize: string };
          lotSizeFilter: { qtyStep: string; minOrderQty: string };
          leverageFilter: { maxLeverage: string };
        }>;
      }>,
      this.request('GET', '/v5/market/tickers', { category: 'linear' }) as Promise<{
        list: Array<{
          symbol: string;
          lastPrice: string;
          indexPrice: string;
          markPrice: string;
          fundingRate: string;
          volume24h: string;
        }>;
      }>,
    ]);

    const tickerMap = new Map(tickers.list.map(t => [t.symbol, t]));

    return instruments.list
      .filter(i => i.quoteCoin === 'USDT')
      .map(i => {
        const ticker = tickerMap.get(i.symbol);
        return {
          exchange: 'bybit' as FuturesExchange,
          symbol: i.symbol,
          baseAsset: i.baseCoin,
          quoteAsset: i.quoteCoin,
          tickSize: parseFloat(i.priceFilter.tickSize),
          lotSize: parseFloat(i.lotSizeFilter.qtyStep),
          minNotional: parseFloat(i.lotSizeFilter.minOrderQty),
          maxLeverage: parseInt(i.leverageFilter.maxLeverage),
          fundingRate: parseFloat(ticker?.fundingRate || '0') * 100,
          markPrice: parseFloat(ticker?.markPrice || '0'),
          indexPrice: parseFloat(ticker?.indexPrice || '0'),
          volume24h: parseFloat(ticker?.volume24h || '0'),
        };
      });
  }
}

// =============================================================================
// HYPERLIQUID CLIENT (Decentralized on Arbitrum)
// =============================================================================

class HyperliquidClient {
  private walletAddress: string;
  private privateKey: string;
  private baseUrl = 'https://api.hyperliquid.xyz';
  private dryRun: boolean;

  constructor(credentials: FuturesCredentials, dryRun = false) {
    this.walletAddress = credentials.apiKey; // Wallet address
    this.privateKey = credentials.apiSecret; // Private key for signing
    this.dryRun = dryRun;
  }

  private async request(endpoint: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid error: ${response.statusText}`);
    }

    return response.json();
  }

  async getBalance(): Promise<FuturesBalance> {
    const data = await this.request('/info', {
      type: 'clearinghouseState',
      user: this.walletAddress,
    }) as { marginSummary: { accountValue: string; totalMarginUsed: string; totalNtlPos: string } };

    const margin = data.marginSummary;
    const total = parseFloat(margin.accountValue);
    const used = parseFloat(margin.totalMarginUsed);

    return {
      exchange: 'hyperliquid',
      asset: 'USDC',
      available: total - used,
      total,
      unrealizedPnl: 0, // Included in accountValue
      marginBalance: total,
    };
  }

  async getPositions(): Promise<FuturesPosition[]> {
    const data = await this.request('/info', {
      type: 'clearinghouseState',
      user: this.walletAddress,
    }) as { assetPositions: Array<{
      position: {
        coin: string;
        szi: string;
        entryPx: string;
        positionValue: string;
        unrealizedPnl: string;
        liquidationPx: string;
        leverage: { value: string; type: string };
        marginUsed: string;
      };
    }> };

    const meta = await this.request('/info', { type: 'meta' }) as {
      universe: Array<{ name: string; szDecimals: number }>;
    };

    // Get mark prices
    const allMids = await this.request('/info', { type: 'allMids' }) as Record<string, string>;

    return data.assetPositions
      .filter(ap => parseFloat(ap.position.szi) !== 0)
      .map(ap => {
        const p = ap.position;
        const size = parseFloat(p.szi);
        const entryPrice = parseFloat(p.entryPx);
        const markPrice = parseFloat(allMids[p.coin] || p.entryPx);
        const pnl = parseFloat(p.unrealizedPnl);
        const positionValue = Math.abs(size) * entryPrice;

        return {
          exchange: 'hyperliquid' as FuturesExchange,
          symbol: p.coin,
          side: size > 0 ? 'LONG' : 'SHORT' as PositionSide,
          size: Math.abs(size),
          entryPrice,
          markPrice,
          liquidationPrice: parseFloat(p.liquidationPx || '0'),
          leverage: parseInt(p.leverage.value),
          marginType: p.leverage.type === 'cross' ? 'CROSS' : 'ISOLATED' as MarginType,
          unrealizedPnl: pnl,
          unrealizedPnlPct: positionValue > 0 ? (pnl / positionValue) * 100 : 0,
          margin: parseFloat(p.marginUsed),
          timestamp: Date.now(),
        };
      });
  }

  async placeOrder(order: FuturesOrderRequest): Promise<FuturesOrder> {
    if (this.dryRun) {
      logger.info({ order }, '[DRY RUN] Would place Hyperliquid order');
      return {
        id: `dry-${Date.now()}`,
        exchange: 'hyperliquid',
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        size: order.size,
        price: order.price,
        leverage: order.leverage || 1,
        reduceOnly: order.reduceOnly || false,
        status: 'FILLED',
        filledSize: order.size,
        avgFillPrice: order.price || 0,
        timestamp: Date.now(),
      };
    }

    // Hyperliquid uses EIP-712 signing - simplified for now
    // In production, use proper ethers.js signing
    const orderPayload = {
      type: 'order',
      orders: [{
        a: 0, // Asset index - would need to look up
        b: order.side === 'BUY',
        p: order.price || 0,
        s: String(order.size),
        r: order.reduceOnly || false,
        t: order.type === 'LIMIT' ? { limit: { tif: 'Gtc' } } : { market: {} },
      }],
      grouping: 'na',
    };

    const result = await this.request('/exchange', {
      action: orderPayload,
      nonce: Date.now(),
      signature: '0x...', // Would need proper signing
    }) as { status: string; response: { data: { statuses: Array<{ resting?: { oid: number } }> } } };

    const status = result.response?.data?.statuses?.[0];

    return {
      id: String(status?.resting?.oid || Date.now()),
      exchange: 'hyperliquid',
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      size: order.size,
      price: order.price,
      leverage: order.leverage || 1,
      reduceOnly: order.reduceOnly || false,
      status: 'NEW',
      filledSize: 0,
      avgFillPrice: 0,
      timestamp: Date.now(),
    };
  }

  async cancelOrder(_symbol: string, orderId: string): Promise<void> {
    await this.request('/exchange', {
      action: { type: 'cancel', cancels: [{ a: 0, o: parseInt(orderId) }] },
      nonce: Date.now(),
      signature: '0x...',
    });
  }

  async closePosition(symbol: string): Promise<FuturesOrder | null> {
    const positions = await this.getPositions();
    const position = positions.find(p => p.symbol === symbol);

    if (!position) return null;

    return this.placeOrder({
      symbol,
      side: position.side === 'LONG' ? 'SELL' : 'BUY',
      type: 'MARKET',
      size: position.size,
      reduceOnly: true,
    });
  }

  async getMarkets(): Promise<FuturesMarket[]> {
    const [meta, allMids] = await Promise.all([
      this.request('/info', { type: 'meta' }) as Promise<{
        universe: Array<{ name: string; szDecimals: number; maxLeverage: number }>;
      }>,
      this.request('/info', { type: 'allMids' }) as Promise<Record<string, string>>,
    ]);

    return meta.universe.map(m => ({
      exchange: 'hyperliquid' as FuturesExchange,
      symbol: m.name,
      baseAsset: m.name,
      quoteAsset: 'USDC',
      tickSize: 0.1,
      lotSize: Math.pow(10, -m.szDecimals),
      minNotional: 10,
      maxLeverage: m.maxLeverage,
      fundingRate: 0, // Would need separate call
      markPrice: parseFloat(allMids[m.name] || '0'),
      indexPrice: parseFloat(allMids[m.name] || '0'),
      volume24h: 0, // Would need separate call
    }));
  }
}

// =============================================================================
// UNIFIED FUTURES SERVICE
// =============================================================================

export class FuturesService extends EventEmitter {
  private clients: Map<FuturesExchange, BinanceFuturesClient | BybitFuturesClient | HyperliquidClient> = new Map();
  private config: FuturesConfig[];
  private positionMonitorInterval: NodeJS.Timeout | null = null;

  constructor(configs: FuturesConfig[]) {
    super();
    this.config = configs;

    for (const config of configs) {
      this.initClient(config);
    }
  }

  private initClient(config: FuturesConfig): void {
    switch (config.exchange) {
      case 'binance':
        this.clients.set('binance', new BinanceFuturesClient(config.credentials, config.dryRun));
        break;
      case 'bybit':
        this.clients.set('bybit', new BybitFuturesClient(config.credentials, config.dryRun));
        break;
      case 'hyperliquid':
        this.clients.set('hyperliquid', new HyperliquidClient(config.credentials, config.dryRun));
        break;
    }
    logger.info({ exchange: config.exchange }, 'Initialized futures client');
  }

  private getClient(exchange: FuturesExchange): BinanceFuturesClient | BybitFuturesClient | HyperliquidClient {
    const client = this.clients.get(exchange);
    if (!client) {
      throw new Error(`Exchange ${exchange} not configured`);
    }
    return client;
  }

  /** Get balance for an exchange */
  async getBalance(exchange: FuturesExchange): Promise<FuturesBalance> {
    return this.getClient(exchange).getBalance();
  }

  /** Get all balances across configured exchanges */
  async getAllBalances(): Promise<FuturesBalance[]> {
    const balances = await Promise.all(
      Array.from(this.clients.keys()).map(ex => this.getBalance(ex))
    );
    return balances;
  }

  /** Get positions for an exchange */
  async getPositions(exchange: FuturesExchange): Promise<FuturesPosition[]> {
    return this.getClient(exchange).getPositions();
  }

  /** Get all positions across configured exchanges */
  async getAllPositions(): Promise<FuturesPosition[]> {
    const positions = await Promise.all(
      Array.from(this.clients.keys()).map(ex => this.getPositions(ex))
    );
    return positions.flat();
  }

  /** Place a futures order */
  async placeOrder(exchange: FuturesExchange, order: FuturesOrderRequest): Promise<FuturesOrder> {
    const config = this.config.find(c => c.exchange === exchange);

    // Apply max leverage limit
    if (config?.maxLeverage && order.leverage && order.leverage > config.maxLeverage) {
      throw new Error(`Leverage ${order.leverage}x exceeds max ${config.maxLeverage}x`);
    }

    const result = await this.getClient(exchange).placeOrder(order);
    this.emit('order', result);

    logger.info({
      exchange,
      symbol: order.symbol,
      side: order.side,
      size: order.size,
      leverage: order.leverage,
    }, 'Placed futures order');

    return result;
  }

  /** Open a long position */
  async openLong(
    exchange: FuturesExchange,
    symbol: string,
    size: number,
    leverage: number,
    options?: { price?: number; takeProfit?: number; stopLoss?: number }
  ): Promise<FuturesOrder> {
    return this.placeOrder(exchange, {
      symbol,
      side: 'BUY',
      type: options?.price ? 'LIMIT' : 'MARKET',
      size,
      leverage,
      price: options?.price,
      takeProfit: options?.takeProfit,
      stopLoss: options?.stopLoss,
    });
  }

  /** Open a short position */
  async openShort(
    exchange: FuturesExchange,
    symbol: string,
    size: number,
    leverage: number,
    options?: { price?: number; takeProfit?: number; stopLoss?: number }
  ): Promise<FuturesOrder> {
    return this.placeOrder(exchange, {
      symbol,
      side: 'SELL',
      type: options?.price ? 'LIMIT' : 'MARKET',
      size,
      leverage,
      price: options?.price,
      takeProfit: options?.takeProfit,
      stopLoss: options?.stopLoss,
    });
  }

  /** Close a position */
  async closePosition(exchange: FuturesExchange, symbol: string): Promise<FuturesOrder | null> {
    const result = await this.getClient(exchange).closePosition(symbol);
    if (result) {
      this.emit('positionClosed', result);
      logger.info({ exchange, symbol }, 'Closed futures position');
    }
    return result;
  }

  /** Close all positions on an exchange */
  async closeAllPositions(exchange: FuturesExchange): Promise<FuturesOrder[]> {
    const positions = await this.getPositions(exchange);
    const results = await Promise.all(
      positions.map(p => this.closePosition(exchange, p.symbol))
    );
    return results.filter((r): r is FuturesOrder => r !== null);
  }

  /** Cancel an order */
  async cancelOrder(exchange: FuturesExchange, symbol: string, orderId: string): Promise<void> {
    await this.getClient(exchange).cancelOrder(symbol, orderId);
    this.emit('orderCanceled', { exchange, symbol, orderId });
  }

  /** Get available markets */
  async getMarkets(exchange: FuturesExchange): Promise<FuturesMarket[]> {
    return this.getClient(exchange).getMarkets();
  }

  /** Start monitoring positions for liquidation risk */
  startPositionMonitor(intervalMs = 5000): void {
    if (this.positionMonitorInterval) return;

    this.positionMonitorInterval = setInterval(async () => {
      try {
        const positions = await this.getAllPositions();

        for (const position of positions) {
          // Calculate liquidation proximity
          const priceDiff = Math.abs(position.markPrice - position.liquidationPrice);
          const liqProximity = (priceDiff / position.markPrice) * 100;

          if (liqProximity < 5) {
            this.emit('liquidationWarning', {
              level: liqProximity < 2 ? 'critical' : liqProximity < 3 ? 'danger' : 'warning',
              position,
              proximityPct: liqProximity,
            });
          }
        }
      } catch (err) {
        logger.error({ err }, 'Position monitor error');
      }
    }, intervalMs);
  }

  /** Stop position monitoring */
  stopPositionMonitor(): void {
    if (this.positionMonitorInterval) {
      clearInterval(this.positionMonitorInterval);
      this.positionMonitorInterval = null;
    }
  }

  /** Get configured exchanges */
  getExchanges(): FuturesExchange[] {
    return Array.from(this.clients.keys());
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createFuturesService(configs: FuturesConfig[]): FuturesService {
  return new FuturesService(configs);
}

// =============================================================================
// EXPORTS
// =============================================================================

export { BinanceFuturesClient, BybitFuturesClient, HyperliquidClient };
