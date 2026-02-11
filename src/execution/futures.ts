/**
 * Futures Execution Service - Perpetuals/Futures trading infrastructure
 *
 * Supports: Binance Futures, Bybit, MEXC, Hyperliquid
 *
 * Key differences from prediction market ExecutionService:
 * - Long/short positions (not yes/no outcomes)
 * - Leverage support
 * - Margin types (isolated/cross)
 * - Position sizing in contracts or base currency
 * - Funding rates awareness
 */

import { logger } from '../utils/logger';
import { createHmac, randomBytes } from 'crypto';
import { Wallet } from 'ethers';
import * as bybit from '../exchanges/bybit';
import * as mexc from '../exchanges/mexc';
import * as hyperliquid from '../exchanges/hyperliquid';

// Helper to derive wallet address from private key
function getWalletAddress(privateKey: string): string {
  const wallet = new Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  return wallet.address;
}

// =============================================================================
// TYPES
// =============================================================================

export type FuturesPlatform = 'binance' | 'bybit' | 'mexc' | 'hyperliquid';
export type PositionSide = 'long' | 'short';
export type MarginType = 'isolated' | 'cross';
export type FuturesOrderType = 'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'STOP_LIMIT' | 'TAKE_PROFIT_LIMIT';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX'; // GTX = post-only

export interface FuturesOrderRequest {
  platform: FuturesPlatform;
  symbol: string;           // e.g., 'BTCUSDT'
  side: PositionSide;
  price?: number;           // For limit orders
  size: number;             // In contracts or base currency
  leverage?: number;        // 1-125x depending on exchange/symbol
  marginType?: MarginType;
  orderType?: FuturesOrderType;
  timeInForce?: TimeInForce;
  reduceOnly?: boolean;     // Close position only, don't open new
  stopPrice?: number;       // For stop/take-profit orders
  closePosition?: boolean;  // Close entire position
}

export interface FuturesOrderResult {
  success: boolean;
  orderId?: string;
  clientOrderId?: string;
  filledSize?: number;
  avgFillPrice?: number;
  status?: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED';
  error?: string;
  commission?: number;
  commissionAsset?: string;
}

export interface FuturesPosition {
  platform: FuturesPlatform;
  symbol: string;
  side: PositionSide;
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  leverage: number;
  marginType: MarginType;
  unrealizedPnl: number;
  margin: number;
  notional: number;
}

export interface FuturesOpenOrder {
  orderId: string;
  clientOrderId?: string;
  platform: FuturesPlatform;
  symbol: string;
  side: PositionSide;
  price: number;
  originalSize: number;
  filledSize: number;
  remainingSize: number;
  orderType: FuturesOrderType;
  timeInForce: TimeInForce;
  status: string;
  reduceOnly: boolean;
  stopPrice?: number;
  createdAt: Date;
}

export interface FuturesBalance {
  platform: FuturesPlatform;
  asset: string;           // e.g., 'USDT'
  balance: number;
  availableBalance: number;
  unrealizedPnl: number;
  marginBalance: number;
  maintenanceMargin: number;
  initialMargin: number;
}

export interface FundingRate {
  platform: FuturesPlatform;
  symbol: string;
  fundingRate: number;     // As decimal (0.0001 = 0.01%)
  fundingTime: Date;
  nextFundingTime: Date;
  markPrice: number;
  indexPrice: number;
}

export interface FuturesConfig {
  binance?: {
    apiKey: string;
    secretKey: string;
    testnet?: boolean;
  };
  bybit?: {
    apiKey: string;
    secretKey: string;
    testnet?: boolean;
  };
  mexc?: {
    apiKey: string;
    secretKey: string;
  };
  hyperliquid?: {
    privateKey: string;
    vaultAddress?: string;
    testnet?: boolean;
  };
  /** Default leverage (1-125x) */
  defaultLeverage?: number;
  /** Default margin type */
  defaultMarginType?: MarginType;
  /** Max position size in USD */
  maxPositionSize?: number;
  /** Dry run mode */
  dryRun?: boolean;
}

export interface FuturesExecutionService {
  // Position management
  openLong(request: Omit<FuturesOrderRequest, 'side'>): Promise<FuturesOrderResult>;
  openShort(request: Omit<FuturesOrderRequest, 'side'>): Promise<FuturesOrderResult>;
  closeLong(request: Omit<FuturesOrderRequest, 'side' | 'reduceOnly'>): Promise<FuturesOrderResult>;
  closeShort(request: Omit<FuturesOrderRequest, 'side' | 'reduceOnly'>): Promise<FuturesOrderResult>;
  closePosition(platform: FuturesPlatform, symbol: string): Promise<FuturesOrderResult>;

  // Order management
  placeLimitOrder(request: FuturesOrderRequest): Promise<FuturesOrderResult>;
  placeMarketOrder(request: Omit<FuturesOrderRequest, 'price'>): Promise<FuturesOrderResult>;
  placeStopLoss(request: FuturesOrderRequest & { stopPrice: number }): Promise<FuturesOrderResult>;
  placeTakeProfit(request: FuturesOrderRequest & { stopPrice: number }): Promise<FuturesOrderResult>;
  cancelOrder(platform: FuturesPlatform, symbol: string, orderId: string): Promise<boolean>;
  cancelAllOrders(platform: FuturesPlatform, symbol?: string): Promise<number>;

  // Queries
  getOpenOrders(platform?: FuturesPlatform, symbol?: string): Promise<FuturesOpenOrder[]>;
  getPositions(platform?: FuturesPlatform, symbol?: string): Promise<FuturesPosition[]>;
  getBalance(platform?: FuturesPlatform): Promise<FuturesBalance[]>;
  getFundingRate(platform: FuturesPlatform, symbol: string): Promise<FundingRate | null>;

  // Configuration
  setLeverage(platform: FuturesPlatform, symbol: string, leverage: number): Promise<boolean>;
  setMarginType(platform: FuturesPlatform, symbol: string, marginType: MarginType): Promise<boolean>;

  // Income history
  getIncomeHistory(platform: FuturesPlatform, params?: {
    symbol?: string;
    limit?: number;
  }): Promise<Array<{ symbol: string; type: string; amount: number; time: Date }>>;

  // Risk helpers
  calculateLiquidationPrice(params: {
    platform: FuturesPlatform;
    symbol: string;
    side: PositionSide;
    entryPrice: number;
    leverage: number;
    marginType: MarginType;
  }): number;
}

// =============================================================================
// MEXC margin type preference (per-order, tracked locally)
// =============================================================================

const mexcMarginPreference = new Map<string, MarginType>();

// =============================================================================
// BINANCE FUTURES
// =============================================================================

const BINANCE_FUTURES_URL = 'https://fapi.binance.com';
const BINANCE_FUTURES_TESTNET_URL = 'https://testnet.binancefuture.com';

function getBinanceUrl(testnet?: boolean): string {
  return testnet ? BINANCE_FUTURES_TESTNET_URL : BINANCE_FUTURES_URL;
}

function signBinanceRequest(params: Record<string, string | number>, secretKey: string): string {
  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return createHmac('sha256', secretKey).update(queryString).digest('hex');
}

async function binanceFuturesRequest(
  config: NonNullable<FuturesConfig['binance']>,
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<unknown> {
  const baseUrl = getBinanceUrl(config.testnet);
  const timestamp = Date.now();
  const allParams = { ...params, timestamp, recvWindow: 5000 };
  const signature = signBinanceRequest(allParams, config.secretKey);
  const queryString = Object.entries(allParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&') + `&signature=${signature}`;

  const url = `${baseUrl}${endpoint}?${queryString}`;

  const response = await fetch(url, {
    method,
    headers: {
      'X-MBX-APIKEY': config.apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error((data as { msg?: string }).msg || `HTTP ${response.status}`);
  }

  return data;
}

async function placeBinanceFuturesOrder(
  config: NonNullable<FuturesConfig['binance']>,
  request: FuturesOrderRequest
): Promise<FuturesOrderResult> {
  try {
    const params: Record<string, string | number> = {
      symbol: request.symbol,
      side: request.side === 'long' ? 'BUY' : 'SELL',
      type: request.orderType || 'MARKET',
      quantity: request.size,
    };

    if (request.price && (request.orderType === 'LIMIT' || request.orderType === 'STOP_LIMIT' || request.orderType === 'TAKE_PROFIT_LIMIT')) {
      params.price = request.price;
    }

    if (request.timeInForce) {
      params.timeInForce = request.timeInForce;
    } else if (request.orderType === 'LIMIT') {
      params.timeInForce = 'GTC';
    }

    if (request.reduceOnly) {
      params.reduceOnly = 'true';
    }

    if (request.stopPrice) {
      params.stopPrice = request.stopPrice;
    }

    if (request.closePosition) {
      params.closePosition = 'true';
    }

    const data = await binanceFuturesRequest(config, 'POST', '/fapi/v1/order', params) as {
      orderId?: number;
      clientOrderId?: string;
      executedQty?: string;
      avgPrice?: string;
      status?: string;
      commission?: string;
      commissionAsset?: string;
    };

    return {
      success: true,
      orderId: data.orderId?.toString(),
      clientOrderId: data.clientOrderId,
      filledSize: parseFloat(data.executedQty || '0'),
      avgFillPrice: parseFloat(data.avgPrice || '0'),
      status: data.status as FuturesOrderResult['status'],
      commission: parseFloat(data.commission || '0'),
      commissionAsset: data.commissionAsset,
    };
  } catch (error) {
    logger.error({ error, request }, 'Binance Futures order failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function cancelBinanceFuturesOrder(
  config: NonNullable<FuturesConfig['binance']>,
  symbol: string,
  orderId: string
): Promise<boolean> {
  try {
    await binanceFuturesRequest(config, 'DELETE', '/fapi/v1/order', {
      symbol,
      orderId: parseInt(orderId, 10),
    });
    return true;
  } catch (error) {
    logger.error({ error, symbol, orderId }, 'Failed to cancel Binance Futures order');
    return false;
  }
}

async function getBinanceFuturesPositions(
  config: NonNullable<FuturesConfig['binance']>,
  symbol?: string
): Promise<FuturesPosition[]> {
  try {
    const data = await binanceFuturesRequest(config, 'GET', '/fapi/v2/positionRisk') as Array<{
      symbol: string;
      positionAmt: string;
      entryPrice: string;
      markPrice: string;
      liquidationPrice: string;
      leverage: string;
      marginType: string;
      unRealizedProfit: string;
      isolatedMargin: string;
      notional: string;
    }>;

    return data
      .filter(p => parseFloat(p.positionAmt) !== 0)
      .filter(p => !symbol || p.symbol === symbol)
      .map(p => ({
        platform: 'binance' as const,
        symbol: p.symbol,
        side: parseFloat(p.positionAmt) > 0 ? 'long' as const : 'short' as const,
        size: Math.abs(parseFloat(p.positionAmt)),
        entryPrice: parseFloat(p.entryPrice),
        markPrice: parseFloat(p.markPrice),
        liquidationPrice: parseFloat(p.liquidationPrice),
        leverage: parseInt(p.leverage, 10),
        marginType: p.marginType.toLowerCase() as MarginType,
        unrealizedPnl: parseFloat(p.unRealizedProfit),
        margin: parseFloat(p.isolatedMargin),
        notional: Math.abs(parseFloat(p.notional)),
      }));
  } catch (error) {
    logger.error({ error }, 'Failed to get Binance Futures positions');
    return [];
  }
}

async function getBinanceFuturesOpenOrders(
  config: NonNullable<FuturesConfig['binance']>,
  symbol?: string
): Promise<FuturesOpenOrder[]> {
  try {
    const params: Record<string, string | number> = {};
    if (symbol) params.symbol = symbol;

    const data = await binanceFuturesRequest(config, 'GET', '/fapi/v1/openOrders', params) as Array<{
      orderId: number;
      clientOrderId: string;
      symbol: string;
      side: string;
      price: string;
      origQty: string;
      executedQty: string;
      type: string;
      timeInForce: string;
      status: string;
      reduceOnly: boolean;
      stopPrice: string;
      time: number;
    }>;

    return data.map(o => ({
      orderId: o.orderId.toString(),
      clientOrderId: o.clientOrderId,
      platform: 'binance' as const,
      symbol: o.symbol,
      side: o.side === 'BUY' ? 'long' as const : 'short' as const,
      price: parseFloat(o.price),
      originalSize: parseFloat(o.origQty),
      filledSize: parseFloat(o.executedQty),
      remainingSize: parseFloat(o.origQty) - parseFloat(o.executedQty),
      orderType: o.type as FuturesOrderType,
      timeInForce: o.timeInForce as TimeInForce,
      status: o.status,
      reduceOnly: o.reduceOnly,
      stopPrice: o.stopPrice ? parseFloat(o.stopPrice) : undefined,
      createdAt: new Date(o.time),
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get Binance Futures open orders');
    return [];
  }
}

async function getBinanceFuturesBalance(
  config: NonNullable<FuturesConfig['binance']>
): Promise<FuturesBalance[]> {
  try {
    const data = await binanceFuturesRequest(config, 'GET', '/fapi/v2/account') as {
      assets: Array<{
        asset: string;
        walletBalance: string;
        availableBalance: string;
        unrealizedProfit: string;
        marginBalance: string;
        maintMargin: string;
        initialMargin: string;
      }>;
    };

    return data.assets
      .filter(a => parseFloat(a.walletBalance) > 0 || parseFloat(a.marginBalance) > 0)
      .map(a => ({
        platform: 'binance' as const,
        asset: a.asset,
        balance: parseFloat(a.walletBalance),
        availableBalance: parseFloat(a.availableBalance),
        unrealizedPnl: parseFloat(a.unrealizedProfit),
        marginBalance: parseFloat(a.marginBalance),
        maintenanceMargin: parseFloat(a.maintMargin),
        initialMargin: parseFloat(a.initialMargin),
      }));
  } catch (error) {
    logger.error({ error }, 'Failed to get Binance Futures balance');
    return [];
  }
}

async function getBinanceFundingRate(
  config: NonNullable<FuturesConfig['binance']>,
  symbol: string
): Promise<FundingRate | null> {
  try {
    const data = await binanceFuturesRequest(config, 'GET', '/fapi/v1/premiumIndex', { symbol }) as {
      symbol: string;
      lastFundingRate: string;
      nextFundingTime: number;
      markPrice: string;
      indexPrice: string;
      time: number;
    };

    return {
      platform: 'binance',
      symbol: data.symbol,
      fundingRate: parseFloat(data.lastFundingRate),
      fundingTime: new Date(data.time),
      nextFundingTime: new Date(data.nextFundingTime),
      markPrice: parseFloat(data.markPrice),
      indexPrice: parseFloat(data.indexPrice),
    };
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to get Binance funding rate');
    return null;
  }
}

async function setBinanceLeverage(
  config: NonNullable<FuturesConfig['binance']>,
  symbol: string,
  leverage: number
): Promise<boolean> {
  try {
    await binanceFuturesRequest(config, 'POST', '/fapi/v1/leverage', {
      symbol,
      leverage,
    });
    return true;
  } catch (error) {
    logger.error({ error, symbol, leverage }, 'Failed to set Binance leverage');
    return false;
  }
}

async function setBinanceMarginType(
  config: NonNullable<FuturesConfig['binance']>,
  symbol: string,
  marginType: MarginType
): Promise<boolean> {
  try {
    await binanceFuturesRequest(config, 'POST', '/fapi/v1/marginType', {
      symbol,
      marginType: marginType.toUpperCase(),
    });
    return true;
  } catch (error) {
    // Error code -4046 means margin type is already set
    const errMsg = error instanceof Error ? error.message : '';
    if (errMsg.includes('-4046')) {
      return true;
    }
    logger.error({ error, symbol, marginType }, 'Failed to set Binance margin type');
    return false;
  }
}

// =============================================================================
// BYBIT FUTURES
// =============================================================================

async function placeBybitFuturesOrder(
  config: NonNullable<FuturesConfig['bybit']>,
  request: FuturesOrderRequest
): Promise<FuturesOrderResult> {
  try {
    const bybitConfig: bybit.BybitConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
      testnet: config.testnet,
    };

    let result: bybit.OrderResult;

    if (request.reduceOnly || request.closePosition) {
      // Close position
      const closeResult = await bybit.closePosition(bybitConfig, request.symbol);
      if (!closeResult) {
        return { success: true }; // No position to close
      }
      result = closeResult;
    } else if (request.orderType === 'LIMIT' && request.price) {
      // Limit order
      if (request.leverage) {
        await bybit.setLeverage(bybitConfig, request.symbol, request.leverage);
      }
      result = await bybit.placeLimitOrder(
        bybitConfig,
        request.symbol,
        request.side === 'long' ? 'Buy' : 'Sell',
        request.size,
        request.price,
        { reduceOnly: request.reduceOnly, timeInForce: request.timeInForce }
      );
    } else if ((request.orderType === 'STOP_LOSS' || request.orderType === 'TAKE_PROFIT') && request.stopPrice) {
      // Stop order
      result = await bybit.placeStopOrder(
        bybitConfig,
        request.symbol,
        request.side === 'long' ? 'Buy' : 'Sell',
        request.size,
        request.stopPrice,
        { price: request.price }
      );
    } else if (request.side === 'long') {
      result = await bybit.openLong(bybitConfig, request.symbol, request.size, request.leverage);
    } else {
      result = await bybit.openShort(bybitConfig, request.symbol, request.size, request.leverage);
    }

    return {
      success: true,
      orderId: result.orderId,
      filledSize: result.cumExecQty,
      avgFillPrice: result.avgPrice,
      status: result.orderStatus === 'Filled' ? 'FILLED' : 'NEW',
    };
  } catch (error) {
    logger.error({ error, request }, 'Bybit Futures order failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function cancelBybitFuturesOrder(
  config: NonNullable<FuturesConfig['bybit']>,
  symbol: string,
  orderId: string
): Promise<boolean> {
  try {
    const bybitConfig: bybit.BybitConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
      testnet: config.testnet,
    };
    return await bybit.cancelOrder(bybitConfig, symbol, orderId);
  } catch (error) {
    logger.error({ error, symbol, orderId }, 'Failed to cancel Bybit order');
    return false;
  }
}

async function getBybitFuturesPositions(
  config: NonNullable<FuturesConfig['bybit']>,
  symbol?: string
): Promise<FuturesPosition[]> {
  try {
    const bybitConfig: bybit.BybitConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
      testnet: config.testnet,
    };
    const positions = await bybit.getPositions(bybitConfig);

    return positions
      .filter(p => !symbol || p.symbol === symbol)
      .map(p => ({
        platform: 'bybit' as const,
        symbol: p.symbol,
        side: p.side === 'Buy' ? 'long' as const : 'short' as const,
        size: p.size,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        liquidationPrice: p.liqPrice,
        leverage: p.leverage,
        marginType: 'isolated' as const, // Bybit unified account
        unrealizedPnl: p.unrealisedPnl,
        margin: p.leverage > 0 ? p.positionValue / p.leverage : p.positionValue,
        notional: p.positionValue,
      }));
  } catch (error) {
    logger.error({ error }, 'Failed to get Bybit positions');
    return [];
  }
}

async function getBybitFuturesOpenOrders(
  config: NonNullable<FuturesConfig['bybit']>,
  symbol?: string
): Promise<FuturesOpenOrder[]> {
  try {
    const bybitConfig: bybit.BybitConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
      testnet: config.testnet,
    };
    const orders = await bybit.getOpenOrders(bybitConfig, symbol);

    return orders.map(o => ({
      orderId: o.orderId,
      platform: 'bybit' as const,
      symbol: o.symbol,
      side: o.side === 'Buy' ? 'long' as const : 'short' as const,
      price: o.price,
      originalSize: o.qty,
      filledSize: o.cumExecQty,
      remainingSize: o.qty - o.cumExecQty,
      orderType: (o.orderType === 'Market' ? 'MARKET' : 'LIMIT') as FuturesOrderType,
      timeInForce: 'GTC' as TimeInForce,
      status: o.orderStatus,
      reduceOnly: false,
      createdAt: new Date(),
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get Bybit open orders');
    return [];
  }
}

async function getBybitFuturesBalance(
  config: NonNullable<FuturesConfig['bybit']>
): Promise<FuturesBalance[]> {
  try {
    const bybitConfig: bybit.BybitConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
      testnet: config.testnet,
    };
    const balances = await bybit.getBalance(bybitConfig);

    return balances.map(b => ({
      platform: 'bybit' as const,
      asset: b.coin,
      balance: b.walletBalance,
      availableBalance: b.availableBalance,
      unrealizedPnl: b.unrealisedPnl,
      marginBalance: b.equity,
      maintenanceMargin: 0,
      initialMargin: b.equity - b.availableBalance,
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get Bybit balance');
    return [];
  }
}

async function getBybitFundingRate(
  config: NonNullable<FuturesConfig['bybit']>,
  symbol: string
): Promise<FundingRate | null> {
  try {
    const bybitConfig: bybit.BybitConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
      testnet: config.testnet,
    };
    const data = await bybit.getFundingRate(bybitConfig, symbol);

    return {
      platform: 'bybit',
      symbol: data.symbol,
      fundingRate: data.fundingRate,
      fundingTime: new Date(),
      nextFundingTime: new Date(data.fundingRateTimestamp),
      markPrice: data.markPrice,
      indexPrice: data.indexPrice,
    };
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to get Bybit funding rate');
    return null;
  }
}

async function setBybitLeverage(
  config: NonNullable<FuturesConfig['bybit']>,
  symbol: string,
  leverage: number
): Promise<boolean> {
  try {
    const bybitConfig: bybit.BybitConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
      testnet: config.testnet,
    };
    await bybit.setLeverage(bybitConfig, symbol, leverage);
    return true;
  } catch (error) {
    logger.error({ error, symbol, leverage }, 'Failed to set Bybit leverage');
    return false;
  }
}

// =============================================================================
// MEXC FUTURES
// =============================================================================

async function placeMexcFuturesOrder(
  config: NonNullable<FuturesConfig['mexc']>,
  request: FuturesOrderRequest
): Promise<FuturesOrderResult> {
  try {
    const mexcConfig: mexc.MexcConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
    };

    const openType = mexcMarginPreference.get(request.symbol) === 'cross' ? 2 : 1;
    let result: mexc.OrderResult | null;

    if (request.reduceOnly || request.closePosition) {
      result = await mexc.closePosition(mexcConfig, request.symbol);
      if (!result) {
        return { success: true }; // No position to close
      }
    } else if (request.orderType === 'LIMIT' && request.price) {
      // Limit order
      const side = request.side === 'long'
        ? (request.reduceOnly ? 4 : 1)  // 1=open long, 4=close short
        : (request.reduceOnly ? 2 : 3); // 3=open short, 2=close long
      result = await mexc.placeLimitOrder(
        mexcConfig,
        request.symbol,
        side,
        request.size,
        request.price,
        { leverage: request.leverage, openType }
      );
    } else if ((request.orderType === 'STOP_LOSS' || request.orderType === 'TAKE_PROFIT') && request.stopPrice) {
      // Stop order
      const side = request.side === 'long' ? 4 : 2; // Close sides for stops
      result = await mexc.placeStopOrder(
        mexcConfig,
        request.symbol,
        side,
        request.size,
        request.stopPrice,
        { price: request.price, openType }
      );
    } else if (request.side === 'long') {
      result = await mexc.openLong(mexcConfig, request.symbol, request.size, request.leverage, openType);
    } else {
      result = await mexc.openShort(mexcConfig, request.symbol, request.size, request.leverage, openType);
    }

    return {
      success: true,
      orderId: result.orderId,
      filledSize: result.dealVol,
      avgFillPrice: result.dealAvgPrice,
      status: result.state === 2 ? 'FILLED' : 'NEW',
    };
  } catch (error) {
    logger.error({ error, request }, 'MEXC Futures order failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function cancelMexcFuturesOrder(
  config: NonNullable<FuturesConfig['mexc']>,
  symbol: string,
  orderId: string
): Promise<boolean> {
  try {
    const mexcConfig: mexc.MexcConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
    };
    return await mexc.cancelOrder(mexcConfig, symbol, orderId);
  } catch (error) {
    logger.error({ error, symbol, orderId }, 'Failed to cancel MEXC order');
    return false;
  }
}

async function getMexcFuturesPositions(
  config: NonNullable<FuturesConfig['mexc']>,
  symbol?: string
): Promise<FuturesPosition[]> {
  try {
    const mexcConfig: mexc.MexcConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
    };
    const positions = await mexc.getPositions(mexcConfig);

    return positions
      .filter(p => !symbol || p.symbol === symbol)
      .map(p => ({
        platform: 'mexc' as const,
        symbol: p.symbol,
        side: p.positionType === 1 ? 'long' as const : 'short' as const,
        size: p.holdVol,
        entryPrice: p.openAvgPrice,
        markPrice: p.markPrice,
        liquidationPrice: p.liquidatePrice,
        leverage: p.leverage,
        marginType: 'isolated' as const,
        unrealizedPnl: p.unrealisedPnl,
        margin: p.leverage > 0 ? p.positionValue / p.leverage : p.positionValue,
        notional: p.positionValue,
      }));
  } catch (error) {
    logger.error({ error }, 'Failed to get MEXC positions');
    return [];
  }
}

async function getMexcFuturesOpenOrders(
  config: NonNullable<FuturesConfig['mexc']>,
  symbol?: string
): Promise<FuturesOpenOrder[]> {
  try {
    const mexcConfig: mexc.MexcConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
    };
    const orders = await mexc.getOpenOrders(mexcConfig, symbol);

    return orders.map(o => ({
      orderId: o.orderId,
      platform: 'mexc' as const,
      symbol: o.symbol,
      side: (o.side === 1 || o.side === 2) ? 'long' as const : 'short' as const,
      price: o.price,
      originalSize: o.vol,
      filledSize: o.dealVol,
      remainingSize: o.vol - o.dealVol,
      orderType: (o.orderType === 5 ? 'MARKET' : 'LIMIT') as FuturesOrderType,
      timeInForce: 'GTC' as TimeInForce,
      status: String(o.state),
      reduceOnly: o.side === 2 || o.side === 4,
      createdAt: new Date(),
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get MEXC open orders');
    return [];
  }
}

async function getMexcFuturesBalance(
  config: NonNullable<FuturesConfig['mexc']>
): Promise<FuturesBalance[]> {
  try {
    const mexcConfig: mexc.MexcConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
    };
    const balances = await mexc.getBalance(mexcConfig);

    return balances.map(b => ({
      platform: 'mexc' as const,
      asset: b.currency,
      balance: b.equity,
      availableBalance: b.availableBalance,
      unrealizedPnl: b.unrealisedPnl,
      marginBalance: b.equity,
      maintenanceMargin: 0,
      initialMargin: b.frozenBalance,
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get MEXC balance');
    return [];
  }
}

async function getMexcFundingRate(
  config: NonNullable<FuturesConfig['mexc']>,
  symbol: string
): Promise<FundingRate | null> {
  try {
    const mexcConfig: mexc.MexcConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
    };
    const data = await mexc.getFundingRate(mexcConfig, symbol);

    return {
      platform: 'mexc',
      symbol: data.symbol,
      fundingRate: data.fundingRate,
      fundingTime: new Date(),
      nextFundingTime: new Date(data.nextSettleTime),
      markPrice: data.markPrice,
      indexPrice: data.indexPrice,
    };
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to get MEXC funding rate');
    return null;
  }
}

async function setMexcLeverage(
  config: NonNullable<FuturesConfig['mexc']>,
  symbol: string,
  leverage: number
): Promise<boolean> {
  try {
    const mexcConfig: mexc.MexcConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
    };
    await mexc.setLeverage(mexcConfig, symbol, leverage);
    return true;
  } catch (error) {
    logger.error({ error, symbol, leverage }, 'Failed to set MEXC leverage');
    return false;
  }
}

// =============================================================================
// HYPERLIQUID
// =============================================================================

async function placeHyperliquidOrder(
  config: NonNullable<FuturesConfig['hyperliquid']>,
  request: FuturesOrderRequest
): Promise<FuturesOrderResult> {
  try {
    const walletAddress = getWalletAddress(config.privateKey);

    const hlConfig: hyperliquid.HyperliquidConfig = {
      walletAddress,
      privateKey: config.privateKey,
      testnet: config.testnet,
      vaultAddress: config.vaultAddress,
    };

    // Handle reduce-only / close position
    if (request.reduceOnly || request.closePosition) {
      const state = await hyperliquid.getUserState(walletAddress);
      const position = state.assetPositions.find(p => p.position.coin === request.symbol);

      if (!position || parseFloat(position.position.szi) === 0) {
        return { success: true }; // No position to close
      }

      const positionSize = Math.abs(parseFloat(position.position.szi));
      const isLong = parseFloat(position.position.szi) > 0;

      const result = await hyperliquid.placePerpOrder(hlConfig, {
        coin: request.symbol,
        side: isLong ? 'SELL' : 'BUY',
        size: positionSize,
        type: 'MARKET',
        reduceOnly: true,
      });

      return {
        success: result.success,
        orderId: result.orderId?.toString(),
        error: result.error,
      };
    }

    // Regular order (LIMIT or MARKET)
    // Note: For stop/TP orders, Hyperliquid uses trigger orders via SDK.
    // placePerpOrder handles LIMIT and MARKET; stop orders are placed as
    // reduce-only market orders immediately (use trading/futures module
    // for proper trigger-based stop orders with the raw API).
    const result = await hyperliquid.placePerpOrder(hlConfig, {
      coin: request.symbol,
      side: request.side === 'long' ? 'BUY' : 'SELL',
      size: request.size,
      price: request.price,
      type: request.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
      reduceOnly: request.reduceOnly,
    });

    return {
      success: result.success,
      orderId: result.orderId?.toString(),
      error: result.error,
    };
  } catch (error) {
    logger.error({ error, request }, 'Hyperliquid order failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function cancelHyperliquidOrder(
  config: NonNullable<FuturesConfig['hyperliquid']>,
  symbol: string,
  orderId: string
): Promise<boolean> {
  try {
    const walletAddress = getWalletAddress(config.privateKey);

    const hlConfig: hyperliquid.HyperliquidConfig = {
      walletAddress,
      privateKey: config.privateKey,
      testnet: config.testnet,
      vaultAddress: config.vaultAddress,
    };

    const result = await hyperliquid.cancelOrder(hlConfig, symbol, parseInt(orderId, 10));
    return result.success;
  } catch (error) {
    logger.error({ error, symbol, orderId }, 'Failed to cancel Hyperliquid order');
    return false;
  }
}

async function getHyperliquidPositions(
  config: NonNullable<FuturesConfig['hyperliquid']>,
  symbol?: string
): Promise<FuturesPosition[]> {
  try {
    const walletAddress = getWalletAddress(config.privateKey);

    const [state, mids] = await Promise.all([
      hyperliquid.getUserState(walletAddress),
      hyperliquid.getAllMids(),
    ]);

    return state.assetPositions
      .filter(p => parseFloat(p.position.szi) !== 0)
      .filter(p => !symbol || p.position.coin === symbol)
      .map(p => {
        const size = parseFloat(p.position.szi);
        const entryPrice = parseFloat(p.position.entryPx);
        const unrealizedPnl = parseFloat(p.position.unrealizedPnl);
        const markPrice = parseFloat(mids[p.position.coin] || '0') || entryPrice;
        const leverage = p.position.leverage?.value || 10;
        const isCross = p.position.leverage?.type === 'cross';
        const margin = parseFloat(p.position.marginUsed || '0') || Math.abs(size * markPrice) / leverage;

        return {
          platform: 'hyperliquid' as const,
          symbol: p.position.coin,
          side: size > 0 ? 'long' as const : 'short' as const,
          size: Math.abs(size),
          entryPrice,
          markPrice,
          liquidationPrice: parseFloat(p.position.liquidationPx || '0'),
          leverage,
          marginType: isCross ? 'cross' as const : 'isolated' as const,
          unrealizedPnl,
          margin,
          notional: Math.abs(size * markPrice),
        };
      });
  } catch (error) {
    logger.error({ error }, 'Failed to get Hyperliquid positions');
    return [];
  }
}

async function getHyperliquidOpenOrders(
  config: NonNullable<FuturesConfig['hyperliquid']>,
  symbol?: string
): Promise<FuturesOpenOrder[]> {
  try {
    const walletAddress = getWalletAddress(config.privateKey);

    const orders = await hyperliquid.getOpenOrders(walletAddress);

    return orders
      .filter(o => !symbol || o.coin === symbol)
      .map(o => ({
        orderId: o.oid.toString(),
        platform: 'hyperliquid' as const,
        symbol: o.coin,
        side: o.side === 'B' ? 'long' as const : 'short' as const,
        price: parseFloat(o.limitPx),
        originalSize: parseFloat(o.sz),
        filledSize: 0,
        remainingSize: parseFloat(o.sz),
        orderType: 'LIMIT' as FuturesOrderType,
        timeInForce: 'GTC' as TimeInForce,
        status: 'open',
        reduceOnly: false,
        createdAt: new Date(o.timestamp),
      }));
  } catch (error) {
    logger.error({ error }, 'Failed to get Hyperliquid open orders');
    return [];
  }
}

async function getHyperliquidBalance(
  config: NonNullable<FuturesConfig['hyperliquid']>
): Promise<FuturesBalance[]> {
  try {
    const walletAddress = getWalletAddress(config.privateKey);

    const state = await hyperliquid.getUserState(walletAddress);

    const accountValue = parseFloat(state.marginSummary.accountValue);
    const marginUsed = parseFloat(state.marginSummary.totalMarginUsed);
    const unrealizedPnl = state.assetPositions.reduce(
      (sum, p) => sum + parseFloat(p.position.unrealizedPnl || '0'), 0
    );

    return [{
      platform: 'hyperliquid' as const,
      asset: 'USDC',
      balance: accountValue,
      availableBalance: accountValue - marginUsed,
      unrealizedPnl,
      marginBalance: accountValue,
      maintenanceMargin: marginUsed * 0.5,
      initialMargin: marginUsed,
    }];
  } catch (error) {
    logger.error({ error }, 'Failed to get Hyperliquid balance');
    return [];
  }
}

async function getHyperliquidFundingRate(
  symbol: string
): Promise<FundingRate | null> {
  try {
    const [rates, mids] = await Promise.all([
      hyperliquid.getFundingRates(),
      hyperliquid.getAllMids(),
    ]);
    const rate = rates.find(r => r.coin === symbol);

    if (!rate) return null;

    const midPrice = parseFloat(mids[symbol] || '0');
    const premium = parseFloat(rate.premium || '0');
    // HL index (oracle) price derived from mark and premium: index = mark / (1 + premium)
    const indexPrice = premium !== 0 ? midPrice / (1 + premium) : midPrice;

    return {
      platform: 'hyperliquid',
      symbol: rate.coin,
      fundingRate: parseFloat(rate.funding),
      fundingTime: new Date(),
      nextFundingTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      markPrice: midPrice,
      indexPrice,
    };
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to get Hyperliquid funding rate');
    return null;
  }
}

async function setHyperliquidLeverage(
  config: NonNullable<FuturesConfig['hyperliquid']>,
  symbol: string,
  leverage: number
): Promise<boolean> {
  try {
    const walletAddress = getWalletAddress(config.privateKey);

    const hlConfig: hyperliquid.HyperliquidConfig = {
      walletAddress,
      privateKey: config.privateKey,
      testnet: config.testnet,
      vaultAddress: config.vaultAddress,
    };

    const result = await hyperliquid.updateLeverage(hlConfig, symbol, leverage, true);
    return result.success;
  } catch (error) {
    logger.error({ error, symbol, leverage }, 'Failed to set Hyperliquid leverage');
    return false;
  }
}

// =============================================================================
// INCOME HISTORY HELPERS
// =============================================================================

type IncomeRecord = { symbol: string; type: string; amount: number; time: Date };

async function getBinanceIncomeHistory(
  config: NonNullable<FuturesConfig['binance']>,
  params?: { symbol?: string; limit?: number }
): Promise<IncomeRecord[]> {
  try {
    const reqParams: Record<string, string | number> = { limit: params?.limit || 50 };
    if (params?.symbol) reqParams.symbol = params.symbol;
    const data = await binanceFuturesRequest(config, 'GET', '/fapi/v1/income', reqParams) as Array<{
      symbol: string;
      incomeType: string;
      income: string;
      asset: string;
      time: number;
    }>;
    return data.map(d => ({
      symbol: d.symbol,
      type: d.incomeType,
      amount: parseFloat(d.income),
      time: new Date(d.time),
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get Binance income history');
    return [];
  }
}

async function getBybitIncomeHistory(
  config: NonNullable<FuturesConfig['bybit']>,
  params?: { symbol?: string; limit?: number }
): Promise<IncomeRecord[]> {
  try {
    const bybitConfig: bybit.BybitConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
      testnet: config.testnet,
    };
    const records = await bybit.getIncomeHistory(bybitConfig, params);
    return records.map(r => ({
      symbol: r.symbol,
      type: r.type,
      amount: r.amount,
      time: r.time,
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get Bybit income history');
    return [];
  }
}

async function getMexcIncomeHistory(
  config: NonNullable<FuturesConfig['mexc']>,
  params?: { symbol?: string; limit?: number }
): Promise<IncomeRecord[]> {
  try {
    const mexcConfig: mexc.MexcConfig = {
      apiKey: config.apiKey,
      apiSecret: config.secretKey,
    };
    const records = await mexc.getIncomeHistory(mexcConfig, params);
    return records.map(r => ({
      symbol: r.symbol,
      type: r.type,
      amount: r.amount,
      time: r.time,
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get MEXC income history');
    return [];
  }
}

async function getHyperliquidIncomeHistory(
  hlConfig: NonNullable<FuturesConfig['hyperliquid']>,
  params?: { symbol?: string; limit?: number }
): Promise<IncomeRecord[]> {
  try {
    const walletAddress = getWalletAddress(hlConfig.privateKey);
    const startTime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    const data = await hyperliquid.getUserFunding(walletAddress, startTime);
    return data
      .filter(d => !params?.symbol || d.coin === params.symbol)
      .slice(0, params?.limit || 50)
      .map(d => ({
        symbol: d.coin,
        type: 'FUNDING',
        amount: parseFloat(d.usdc),
        time: new Date(d.time),
      }));
  } catch (error) {
    logger.error({ error }, 'Failed to get Hyperliquid income history');
    return [];
  }
}

// =============================================================================
// HYPERLIQUID MARGIN TYPE
// =============================================================================

async function setHyperliquidMarginType(
  hlConfig: NonNullable<FuturesConfig['hyperliquid']>,
  symbol: string,
  marginType: MarginType
): Promise<boolean> {
  try {
    const walletAddress = getWalletAddress(hlConfig.privateKey);
    const config: hyperliquid.HyperliquidConfig = {
      walletAddress,
      privateKey: hlConfig.privateKey,
      testnet: hlConfig.testnet,
      vaultAddress: hlConfig.vaultAddress,
    };
    // Get current leverage from user state
    const state = await hyperliquid.getUserState(walletAddress);
    const position = state.assetPositions.find(p => p.position.coin === symbol);
    const currentLeverage = position?.position.leverage?.value || 10;
    const isCross = marginType === 'cross';
    const result = await hyperliquid.updateLeverage(config, symbol, currentLeverage, isCross);
    return result.success;
  } catch (error) {
    logger.error({ error, symbol, marginType }, 'Failed to set Hyperliquid margin type');
    return false;
  }
}

// =============================================================================
// SERVICE FACTORY
// =============================================================================

export function createFuturesExecutionService(config: FuturesConfig): FuturesExecutionService {
  const defaultLeverage = config.defaultLeverage || 10;
  const defaultMarginType = config.defaultMarginType || 'isolated';
  const maxPositionSize = config.maxPositionSize || 10000; // $10k default

  async function executeOrder(request: FuturesOrderRequest): Promise<FuturesOrderResult> {
    // Validate position size
    const checkPrice = request.price || 0;
    if (checkPrice > 0 && request.size * checkPrice > maxPositionSize) {
      return {
        success: false,
        error: `Position size exceeds max $${maxPositionSize}`,
      };
    }
    if (checkPrice === 0) {
      logger.warn({ size: request.size, symbol: request.symbol }, 'No price available for notional size check (market order) — skipping guard');
    }

    // Dry run
    if (config.dryRun) {
      logger.info({ ...request, dryRun: true }, 'Dry run futures order');
      return {
        success: true,
        orderId: `dry_${randomBytes(8).toString('hex')}`,
        status: 'FILLED',
        filledSize: request.size,
        avgFillPrice: request.price,
      };
    }

    // Route to appropriate exchange
    switch (request.platform) {
      case 'binance':
        if (!config.binance) {
          return { success: false, error: 'Binance Futures not configured' };
        }
        return placeBinanceFuturesOrder(config.binance, request);

      case 'bybit':
        if (!config.bybit) {
          return { success: false, error: 'Bybit not configured' };
        }
        return placeBybitFuturesOrder(config.bybit, request);

      case 'mexc':
        if (!config.mexc) {
          return { success: false, error: 'MEXC not configured' };
        }
        return placeMexcFuturesOrder(config.mexc, request);

      case 'hyperliquid':
        if (!config.hyperliquid) {
          return { success: false, error: 'Hyperliquid not configured' };
        }
        return placeHyperliquidOrder(config.hyperliquid, request);

      default:
        return { success: false, error: `Unknown platform: ${request.platform}` };
    }
  }

  const service: FuturesExecutionService = {
    async openLong(request) {
      return executeOrder({
        ...request,
        side: 'long',
        leverage: request.leverage || defaultLeverage,
        marginType: request.marginType || defaultMarginType,
      });
    },

    async openShort(request) {
      return executeOrder({
        ...request,
        side: 'short',
        leverage: request.leverage || defaultLeverage,
        marginType: request.marginType || defaultMarginType,
      });
    },

    async closeLong(request) {
      return executeOrder({
        ...request,
        side: 'short', // Sell to close long
        reduceOnly: true,
      });
    },

    async closeShort(request) {
      return executeOrder({
        ...request,
        side: 'long', // Buy to close short
        reduceOnly: true,
      });
    },

    async closePosition(platform, symbol) {
      const positions = await this.getPositions(platform, symbol);
      const position = positions.find(p => p.symbol === symbol);

      if (!position) {
        return { success: true }; // No position to close
      }

      return executeOrder({
        platform,
        symbol,
        side: position.side === 'long' ? 'short' : 'long',
        size: position.size,
        orderType: 'MARKET',
        reduceOnly: true,
        closePosition: true,
      });
    },

    async placeLimitOrder(request) {
      return executeOrder({
        ...request,
        orderType: 'LIMIT',
        timeInForce: request.timeInForce || 'GTC',
      });
    },

    async placeMarketOrder(request) {
      return executeOrder({
        ...request,
        orderType: 'MARKET',
      });
    },

    async placeStopLoss(request) {
      return executeOrder({
        ...request,
        orderType: 'STOP_LOSS',
        reduceOnly: true,
      });
    },

    async placeTakeProfit(request) {
      return executeOrder({
        ...request,
        orderType: 'TAKE_PROFIT',
        reduceOnly: true,
      });
    },

    async cancelOrder(platform, symbol, orderId) {
      if (config.dryRun) {
        logger.info({ platform, symbol, orderId, dryRun: true }, 'Dry run cancel');
        return true;
      }

      switch (platform) {
        case 'binance':
          if (!config.binance) return false;
          return cancelBinanceFuturesOrder(config.binance, symbol, orderId);
        case 'bybit':
          if (!config.bybit) return false;
          return cancelBybitFuturesOrder(config.bybit, symbol, orderId);
        case 'mexc':
          if (!config.mexc) return false;
          return cancelMexcFuturesOrder(config.mexc, symbol, orderId);
        case 'hyperliquid':
          if (!config.hyperliquid) return false;
          return cancelHyperliquidOrder(config.hyperliquid, symbol, orderId);
        default:
          logger.warn({ platform }, 'Cancel not implemented for platform');
          return false;
      }
    },

    async cancelAllOrders(platform, symbol) {
      if (config.dryRun) {
        logger.info({ platform, symbol, dryRun: true }, 'Dry run cancel all');
        return 0;
      }

      let count = 0;

      if (platform === 'binance' || !platform) {
        if (config.binance) {
          const orders = await getBinanceFuturesOpenOrders(config.binance, symbol);
          for (const order of orders) {
            if (await cancelBinanceFuturesOrder(config.binance, order.symbol, order.orderId)) {
              count++;
            }
          }
        }
      }

      if (platform === 'bybit' || !platform) {
        if (config.bybit) {
          const orders = await getBybitFuturesOpenOrders(config.bybit, symbol);
          for (const order of orders) {
            if (await cancelBybitFuturesOrder(config.bybit, order.symbol, order.orderId)) {
              count++;
            }
          }
        }
      }

      if (platform === 'mexc' || !platform) {
        if (config.mexc) {
          const orders = await getMexcFuturesOpenOrders(config.mexc, symbol);
          for (const order of orders) {
            if (await cancelMexcFuturesOrder(config.mexc, order.symbol, order.orderId)) {
              count++;
            }
          }
        }
      }

      if (platform === 'hyperliquid' || !platform) {
        if (config.hyperliquid) {
          const orders = await getHyperliquidOpenOrders(config.hyperliquid, symbol);
          for (const order of orders) {
            if (await cancelHyperliquidOrder(config.hyperliquid, order.symbol, order.orderId)) {
              count++;
            }
          }
        }
      }

      return count;
    },

    async getOpenOrders(platform, symbol) {
      const orders: FuturesOpenOrder[] = [];

      if ((!platform || platform === 'binance') && config.binance) {
        orders.push(...await getBinanceFuturesOpenOrders(config.binance, symbol));
      }

      if ((!platform || platform === 'bybit') && config.bybit) {
        orders.push(...await getBybitFuturesOpenOrders(config.bybit, symbol));
      }

      if ((!platform || platform === 'mexc') && config.mexc) {
        orders.push(...await getMexcFuturesOpenOrders(config.mexc, symbol));
      }

      if ((!platform || platform === 'hyperliquid') && config.hyperliquid) {
        orders.push(...await getHyperliquidOpenOrders(config.hyperliquid, symbol));
      }

      return orders;
    },

    async getPositions(platform, symbol) {
      const positions: FuturesPosition[] = [];

      if ((!platform || platform === 'binance') && config.binance) {
        positions.push(...await getBinanceFuturesPositions(config.binance, symbol));
      }

      if ((!platform || platform === 'bybit') && config.bybit) {
        positions.push(...await getBybitFuturesPositions(config.bybit, symbol));
      }

      if ((!platform || platform === 'mexc') && config.mexc) {
        positions.push(...await getMexcFuturesPositions(config.mexc, symbol));
      }

      if ((!platform || platform === 'hyperliquid') && config.hyperliquid) {
        positions.push(...await getHyperliquidPositions(config.hyperliquid, symbol));
      }

      return positions;
    },

    async getBalance(platform) {
      const balances: FuturesBalance[] = [];

      if ((!platform || platform === 'binance') && config.binance) {
        balances.push(...await getBinanceFuturesBalance(config.binance));
      }

      if ((!platform || platform === 'bybit') && config.bybit) {
        balances.push(...await getBybitFuturesBalance(config.bybit));
      }

      if ((!platform || platform === 'mexc') && config.mexc) {
        balances.push(...await getMexcFuturesBalance(config.mexc));
      }

      if ((!platform || platform === 'hyperliquid') && config.hyperliquid) {
        balances.push(...await getHyperliquidBalance(config.hyperliquid));
      }

      return balances;
    },

    async getFundingRate(platform, symbol) {
      switch (platform) {
        case 'binance':
          if (!config.binance) return null;
          return getBinanceFundingRate(config.binance, symbol);
        case 'bybit':
          if (!config.bybit) return null;
          return getBybitFundingRate(config.bybit, symbol);
        case 'mexc':
          if (!config.mexc) return null;
          return getMexcFundingRate(config.mexc, symbol);
        case 'hyperliquid':
          return getHyperliquidFundingRate(symbol);
        default:
          return null;
      }
    },

    async setLeverage(platform, symbol, leverage) {
      if (config.dryRun) {
        logger.info({ platform, symbol, leverage, dryRun: true }, 'Dry run set leverage');
        return true;
      }

      switch (platform) {
        case 'binance':
          if (!config.binance) return false;
          return setBinanceLeverage(config.binance, symbol, leverage);
        case 'bybit':
          if (!config.bybit) return false;
          return setBybitLeverage(config.bybit, symbol, leverage);
        case 'mexc':
          if (!config.mexc) return false;
          return setMexcLeverage(config.mexc, symbol, leverage);
        case 'hyperliquid':
          if (!config.hyperliquid) return false;
          return setHyperliquidLeverage(config.hyperliquid, symbol, leverage);
        default:
          logger.warn({ platform }, 'Set leverage not implemented for platform');
          return false;
      }
    },

    async setMarginType(platform, symbol, marginType) {
      if (config.dryRun) {
        logger.info({ platform, symbol, marginType, dryRun: true }, 'Dry run set margin type');
        return true;
      }

      switch (platform) {
        case 'binance':
          if (!config.binance) return false;
          return setBinanceMarginType(config.binance, symbol, marginType);
        case 'bybit':
          // Bybit unified account doesn't have separate margin type setting
          logger.info({ symbol, marginType }, 'Bybit unified account - margin type set via leverage');
          return true;
        case 'mexc':
          // MEXC sets margin type via openType in order (1=isolated, 2=cross)
          mexcMarginPreference.set(symbol, marginType);
          logger.info({ symbol, marginType }, 'MEXC margin type preference saved (applied per-order)');
          return true;
        case 'hyperliquid':
          if (!config.hyperliquid) return false;
          return setHyperliquidMarginType(config.hyperliquid, symbol, marginType);
        default:
          logger.warn({ platform }, 'Set margin type not implemented for platform');
          return false;
      }
    },

    async getIncomeHistory(platform, params) {
      switch (platform) {
        case 'binance':
          if (!config.binance) return [];
          return getBinanceIncomeHistory(config.binance, params);
        case 'bybit':
          if (!config.bybit) return [];
          return getBybitIncomeHistory(config.bybit, params);
        case 'mexc':
          if (!config.mexc) return [];
          return getMexcIncomeHistory(config.mexc, params);
        case 'hyperliquid':
          if (!config.hyperliquid) return [];
          return getHyperliquidIncomeHistory(config.hyperliquid, params);
        default:
          return [];
      }
    },

    calculateLiquidationPrice(params) {
      // Simplified liquidation price calculation
      // Real calculation is more complex and varies by exchange
      const { side, entryPrice, leverage } = params;

      // Maintenance margin rate (simplified - typically 0.4% for BTC on Binance)
      const mmr = 0.004;
      const safeLeverage = leverage > 0 ? leverage : 1;

      if (side === 'long') {
        // Liq price for long = Entry * (1 - 1/leverage + mmr)
        return entryPrice * (1 - 1 / safeLeverage + mmr);
      } else {
        // Liq price for short = Entry * (1 + 1/leverage - mmr)
        return entryPrice * (1 + 1 / safeLeverage - mmr);
      }
    },
  };

  logger.info(
    {
      binance: !!config.binance,
      bybit: !!config.bybit,
      mexc: !!config.mexc,
      hyperliquid: !!config.hyperliquid,
      dryRun: !!config.dryRun,
    },
    'Futures Execution Service initialized'
  );

  return service;
}

