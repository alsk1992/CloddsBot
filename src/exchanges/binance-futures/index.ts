/**
 * Binance Futures Integration
 *
 * USDT-M perpetual futures with up to 125x leverage.
 */

import { USDMClient } from 'binance';
import { logger } from '../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface BinanceFuturesConfig {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
  dryRun?: boolean;
}

export interface Position {
  symbol: string;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unrealizedProfit: number;
  liquidationPrice: number;
  leverage: number;
  marginType: 'cross' | 'isolated';
  isolatedMargin: number;
  notional: number;
}

export interface Balance {
  asset: string;
  balance: number;
  availableBalance: number;
  crossWalletBalance: number;
  unrealizedProfit: number;
}

export interface OrderResult {
  orderId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  type: string;
  price: number;
  avgPrice: number;
  origQty: number;
  executedQty: number;
  status: string;
}

export interface FundingRate {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
  markPrice: number;
}

// =============================================================================
// CLIENT
// =============================================================================

let client: USDMClient | null = null;
let currentConfig: BinanceFuturesConfig | null = null;

function getClient(config: BinanceFuturesConfig): USDMClient {
  if (client && currentConfig?.apiKey === config.apiKey) {
    return client;
  }

  client = new USDMClient({
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    baseUrl: config.testnet ? 'https://testnet.binancefuture.com' : undefined,
  });
  currentConfig = config;

  return client;
}

// =============================================================================
// MARKET DATA
// =============================================================================

export async function getPrice(config: BinanceFuturesConfig, symbol: string): Promise<number> {
  const c = getClient(config);
  const ticker = await c.getMarkPrice({ symbol });
  const price = parseFloat(String(ticker.markPrice));
  if (Number.isNaN(price)) throw new Error(`Invalid mark price for ${symbol}`);
  return price;
}

export async function getFundingRate(config: BinanceFuturesConfig, symbol: string): Promise<FundingRate> {
  const c = getClient(config);
  const data = await c.getMarkPrice({ symbol });
  return {
    symbol,
    fundingRate: parseFloat(String(data.lastFundingRate)),
    fundingTime: data.nextFundingTime,
    markPrice: parseFloat(String(data.markPrice)),
  };
}

export async function getMarkets(config: BinanceFuturesConfig): Promise<string[]> {
  const c = getClient(config);
  const info = await c.getExchangeInfo();
  return info.symbols
    .filter((s: { status: string }) => s.status === 'TRADING')
    .map((s: { symbol: string }) => s.symbol);
}

// =============================================================================
// ACCOUNT
// =============================================================================

export async function getBalance(config: BinanceFuturesConfig): Promise<Balance[]> {
  const c = getClient(config);
  const account = await c.getAccountInformation();

  return account.assets
    .filter((a) => parseFloat(String(a.walletBalance)) > 0)
    .map((a) => ({
      asset: a.asset,
      balance: parseFloat(String(a.walletBalance)),
      availableBalance: parseFloat(String(a.availableBalance)),
      crossWalletBalance: parseFloat(String(a.crossWalletBalance)),
      unrealizedProfit: parseFloat(String(a.unrealizedProfit)),
    }));
}

export async function getPositions(config: BinanceFuturesConfig): Promise<Position[]> {
  const c = getClient(config);
  const positions = await c.getPositions();

  return positions
    .filter((p) => parseFloat(String(p.positionAmt)) !== 0)
    .map((p) => ({
      symbol: p.symbol,
      positionSide: p.positionSide as 'LONG' | 'SHORT' | 'BOTH',
      positionAmt: parseFloat(String(p.positionAmt)),
      entryPrice: parseFloat(String(p.entryPrice)),
      markPrice: parseFloat(String(p.markPrice)),
      unrealizedProfit: parseFloat(String(p.unRealizedProfit)),
      liquidationPrice: parseFloat(String(p.liquidationPrice)),
      leverage: parseInt(String(p.leverage), 10) || 1,
      marginType: p.marginType as 'cross' | 'isolated',
      isolatedMargin: parseFloat(String(p.isolatedMargin)),
      notional: parseFloat(String(p.notional)),
    }));
}

export async function getOpenOrders(config: BinanceFuturesConfig, symbol?: string): Promise<OrderResult[]> {
  const c = getClient(config);
  const orders = symbol
    ? await c.getAllOpenOrders({ symbol })
    : await c.getAllOpenOrders();

  return orders.map((o) => ({
    orderId: o.orderId,
    symbol: o.symbol,
    side: o.side as 'BUY' | 'SELL',
    positionSide: o.positionSide as 'LONG' | 'SHORT' | 'BOTH',
    type: o.type,
    price: parseFloat(String(o.price)),
    avgPrice: parseFloat(String(o.avgPrice)),
    origQty: parseFloat(String(o.origQty)),
    executedQty: parseFloat(String(o.executedQty)),
    status: o.status,
  }));
}

// =============================================================================
// TRADING
// =============================================================================

export async function setLeverage(
  config: BinanceFuturesConfig,
  symbol: string,
  leverage: number
): Promise<void> {
  if (config.dryRun) {
    logger.info({ symbol, leverage }, '[DRY RUN] Set leverage');
    return;
  }

  const c = getClient(config);
  await c.setLeverage({ symbol, leverage });
}

export async function openLong(
  config: BinanceFuturesConfig,
  symbol: string,
  quantity: number,
  leverage?: number
): Promise<OrderResult> {
  if (leverage != null) {
    await setLeverage(config, symbol, leverage);
  }

  if (config.dryRun) {
    logger.info({ symbol, quantity, leverage }, '[DRY RUN] Open long');
    return {
      orderId: Date.now(),
      symbol,
      side: 'BUY',
      positionSide: 'BOTH',
      type: 'MARKET',
      price: 0,
      avgPrice: 0,
      origQty: quantity,
      executedQty: quantity,
      status: 'DRY_RUN',
    };
  }

  const c = getClient(config);
  const result = await c.submitNewOrder({
    symbol,
    side: 'BUY',
    type: 'MARKET',
    quantity,
  });

  return {
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side as 'BUY' | 'SELL',
    positionSide: (result.positionSide ?? 'BOTH') as 'LONG' | 'SHORT' | 'BOTH',
    type: result.type,
    price: parseFloat(String(result.price ?? 0)),
    avgPrice: parseFloat(String(result.avgPrice ?? 0)),
    origQty: parseFloat(String(result.origQty)),
    executedQty: parseFloat(String(result.executedQty)),
    status: result.status,
  };
}

export async function openShort(
  config: BinanceFuturesConfig,
  symbol: string,
  quantity: number,
  leverage?: number
): Promise<OrderResult> {
  if (leverage != null) {
    await setLeverage(config, symbol, leverage);
  }

  if (config.dryRun) {
    logger.info({ symbol, quantity, leverage }, '[DRY RUN] Open short');
    return {
      orderId: Date.now(),
      symbol,
      side: 'SELL',
      positionSide: 'BOTH',
      type: 'MARKET',
      price: 0,
      avgPrice: 0,
      origQty: quantity,
      executedQty: quantity,
      status: 'DRY_RUN',
    };
  }

  const c = getClient(config);
  const result = await c.submitNewOrder({
    symbol,
    side: 'SELL',
    type: 'MARKET',
    quantity,
  });

  return {
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side as 'BUY' | 'SELL',
    positionSide: (result.positionSide ?? 'BOTH') as 'LONG' | 'SHORT' | 'BOTH',
    type: result.type,
    price: parseFloat(String(result.price ?? 0)),
    avgPrice: parseFloat(String(result.avgPrice ?? 0)),
    origQty: parseFloat(String(result.origQty)),
    executedQty: parseFloat(String(result.executedQty)),
    status: result.status,
  };
}

export async function closePosition(
  config: BinanceFuturesConfig,
  symbol: string
): Promise<OrderResult | null> {
  const positions = await getPositions(config);
  const position = positions.find(p => p.symbol === symbol);

  if (!position || position.positionAmt === 0) {
    return null;
  }

  const side = position.positionAmt > 0 ? 'SELL' : 'BUY';
  const quantity = Math.abs(position.positionAmt);

  if (config.dryRun) {
    logger.info({ symbol, side, quantity }, '[DRY RUN] Close position');
    return {
      orderId: Date.now(),
      symbol,
      side: side as 'BUY' | 'SELL',
      positionSide: 'BOTH',
      type: 'MARKET',
      price: position.markPrice,
      avgPrice: position.markPrice,
      origQty: quantity,
      executedQty: quantity,
      status: 'DRY_RUN',
    };
  }

  const c = getClient(config);
  const result = await c.submitNewOrder({
    symbol,
    side,
    type: 'MARKET',
    quantity,
    reduceOnly: 'true',
  });

  return {
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side as 'BUY' | 'SELL',
    positionSide: (result.positionSide ?? 'BOTH') as 'LONG' | 'SHORT' | 'BOTH',
    type: result.type,
    price: parseFloat(String(result.price ?? 0)),
    avgPrice: parseFloat(String(result.avgPrice ?? 0)),
    origQty: parseFloat(String(result.origQty)),
    executedQty: parseFloat(String(result.executedQty)),
    status: result.status,
  };
}

export async function closeAllPositions(config: BinanceFuturesConfig): Promise<OrderResult[]> {
  const positions = await getPositions(config);
  const results: OrderResult[] = [];

  for (const position of positions) {
    const result = await closePosition(config, position.symbol);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

export async function cancelOrder(
  config: BinanceFuturesConfig,
  symbol: string,
  orderId: number
): Promise<boolean> {
  if (config.dryRun) {
    logger.info({ symbol, orderId }, '[DRY RUN] Cancel order');
    return true;
  }

  const c = getClient(config);
  await c.cancelOrder({ symbol, orderId });
  return true;
}

export async function cancelAllOrders(
  config: BinanceFuturesConfig,
  symbol: string
): Promise<number> {
  if (config.dryRun) {
    logger.info({ symbol }, '[DRY RUN] Cancel all orders');
    return 0;
  }

  const c = getClient(config);
  await c.cancelAllOpenOrders({ symbol });
  return 1;
}

export async function setMarginType(
  config: BinanceFuturesConfig,
  symbol: string,
  marginType: 'ISOLATED' | 'CROSSED'
): Promise<void> {
  if (config.dryRun) {
    logger.info({ symbol, marginType }, '[DRY RUN] Set margin type');
    return;
  }

  const c = getClient(config);
  try {
    await c.setMarginType({ symbol, marginType });
  } catch (err: unknown) {
    // -4046 = already set to this type
    if (!(err instanceof Error) || !err.message.includes('-4046')) throw err;
  }
}

export async function placeLimitOrder(
  config: BinanceFuturesConfig,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  price: number,
  params?: { reduceOnly?: boolean; timeInForce?: string; postOnly?: boolean }
): Promise<OrderResult> {
  if (config.dryRun) {
    logger.info({ symbol, side, quantity, price }, '[DRY RUN] Place limit order');
    return {
      orderId: Date.now(),
      symbol,
      side,
      positionSide: 'BOTH',
      type: 'LIMIT',
      price,
      avgPrice: 0,
      origQty: quantity,
      executedQty: 0,
      status: 'DRY_RUN',
    };
  }

  const c = getClient(config);
  const result = await c.submitNewOrder({
    symbol,
    side,
    type: 'LIMIT',
    quantity,
    price,
    timeInForce: params?.postOnly ? 'GTX' : ((params?.timeInForce ?? 'GTC') as 'GTC' | 'IOC' | 'FOK'),
    ...(params?.reduceOnly ? { reduceOnly: 'true' } : {}),
  });

  return {
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side as 'BUY' | 'SELL',
    positionSide: (result.positionSide ?? 'BOTH') as 'LONG' | 'SHORT' | 'BOTH',
    type: result.type,
    price: parseFloat(String(result.price ?? 0)),
    avgPrice: parseFloat(String(result.avgPrice ?? 0)),
    origQty: parseFloat(String(result.origQty)),
    executedQty: parseFloat(String(result.executedQty)),
    status: result.status,
  };
}

export async function placeStopOrder(
  config: BinanceFuturesConfig,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  stopPrice: number,
  params?: { price?: number; reduceOnly?: boolean }
): Promise<OrderResult> {
  if (config.dryRun) {
    logger.info({ symbol, side, quantity, stopPrice }, '[DRY RUN] Place stop order');
    return {
      orderId: Date.now(),
      symbol,
      side,
      positionSide: 'BOTH',
      type: params?.price ? 'STOP' : 'STOP_MARKET',
      price: params?.price ?? stopPrice,
      avgPrice: 0,
      origQty: quantity,
      executedQty: 0,
      status: 'DRY_RUN',
    };
  }

  const type = params?.price ? 'STOP' : 'STOP_MARKET';
  const c = getClient(config);
  const result = await c.submitNewOrder({
    symbol,
    side,
    type: type as 'STOP' | 'STOP_MARKET',
    quantity,
    stopPrice,
    ...(params?.price ? { price: params.price, timeInForce: 'GTC' as const } : {}),
    reduceOnly: params?.reduceOnly !== false ? 'true' : undefined,
  });

  return {
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side as 'BUY' | 'SELL',
    positionSide: (result.positionSide ?? 'BOTH') as 'LONG' | 'SHORT' | 'BOTH',
    type: result.type,
    price: parseFloat(String(result.price ?? 0)),
    avgPrice: parseFloat(String(result.avgPrice ?? 0)),
    origQty: parseFloat(String(result.origQty)),
    executedQty: parseFloat(String(result.executedQty)),
    status: result.status,
  };
}

export interface IncomeRecord {
  symbol: string;
  incomeType: string;
  income: number;
  asset: string;
  time: Date;
}

export async function getIncomeHistory(
  config: BinanceFuturesConfig,
  params?: { symbol?: string; limit?: number }
): Promise<IncomeRecord[]> {
  const c = getClient(config);
  const reqParams: { symbol?: string; limit?: number } = {};
  if (params?.symbol) reqParams.symbol = params.symbol;
  if (params?.limit) reqParams.limit = params.limit;

  const data = await c.getIncomeHistory(reqParams) as Array<{
    symbol: string;
    incomeType: string;
    income: string;
    asset: string;
    time: number;
  }>;
  return data.map(d => ({
    symbol: d.symbol,
    incomeType: d.incomeType,
    income: parseFloat(d.income),
    asset: d.asset,
    time: new Date(d.time),
  }));
}
