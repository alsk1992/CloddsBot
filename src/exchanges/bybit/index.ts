/**
 * Bybit Futures Integration
 *
 * USDT perpetual futures with up to 100x leverage.
 */

import { RestClientV5 } from 'bybit-api';
import { logger } from '../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface BybitConfig {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
  dryRun?: boolean;
}

export interface Position {
  symbol: string;
  side: 'Buy' | 'Sell';
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealisedPnl: number;
  cumRealisedPnl: number;
  leverage: number;
  liqPrice: number;
  positionValue: number;
}

export interface Balance {
  coin: string;
  equity: number;
  availableBalance: number;
  walletBalance: number;
  unrealisedPnl: number;
}

export interface OrderResult {
  orderId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: string;
  price: number;
  qty: number;
  cumExecQty: number;
  avgPrice: number;
  orderStatus: string;
}

export interface FundingRate {
  symbol: string;
  fundingRate: number;
  fundingRateTimestamp: number;
  markPrice: number;
  indexPrice: number;
}

// =============================================================================
// CLIENT
// =============================================================================

let client: RestClientV5 | null = null;
let currentConfig: BybitConfig | null = null;

function getClient(config: BybitConfig): RestClientV5 {
  if (client && currentConfig?.apiKey === config.apiKey) {
    return client;
  }

  client = new RestClientV5({
    key: config.apiKey,
    secret: config.apiSecret,
    testnet: config.testnet,
  });
  currentConfig = config;

  return client;
}

// =============================================================================
// MARKET DATA
// =============================================================================

export async function getPrice(config: BybitConfig, symbol: string): Promise<number> {
  const c = getClient(config);
  const result = await c.getTickers({ category: 'linear', symbol });
  if (!result.result?.list?.length) throw new Error('No ticker data');
  const ticker = result.result.list[0];
  return parseFloat(ticker.markPrice);
}

export async function getFundingRate(config: BybitConfig, symbol: string): Promise<FundingRate> {
  const c = getClient(config);
  const result = await c.getTickers({ category: 'linear', symbol });
  if (!result.result?.list?.length) throw new Error('No ticker data');
  const ticker = result.result.list[0];
  return {
    symbol,
    fundingRate: parseFloat(ticker.fundingRate),
    fundingRateTimestamp: parseInt(ticker.nextFundingTime, 10),
    markPrice: parseFloat(ticker.markPrice),
    indexPrice: parseFloat((ticker as unknown as Record<string, string>).indexPrice ?? ticker.markPrice),
  };
}

export async function getMarkets(config: BybitConfig): Promise<string[]> {
  const c = getClient(config);
  const result = await c.getInstrumentsInfo({ category: 'linear' });
  return result.result.list
    .filter((s: { status: string }) => s.status === 'Trading')
    .map((s: { symbol: string }) => s.symbol);
}

// =============================================================================
// ACCOUNT
// =============================================================================

export async function getBalance(config: BybitConfig): Promise<Balance[]> {
  const c = getClient(config);
  const result = await c.getWalletBalance({ accountType: 'UNIFIED' });

  const coins = result.result.list[0]?.coin || [];
  return coins
    .filter((coin: { equity: string }) => parseFloat(coin.equity) > 0)
    .map((coin: { coin: string; equity: string; availableToWithdraw: string; walletBalance: string; unrealisedPnl: string }) => ({
      coin: coin.coin,
      equity: parseFloat(coin.equity),
      availableBalance: parseFloat(coin.availableToWithdraw),
      walletBalance: parseFloat(coin.walletBalance),
      unrealisedPnl: parseFloat(coin.unrealisedPnl),
    }));
}

export async function getPositions(config: BybitConfig): Promise<Position[]> {
  const c = getClient(config);
  const result = await c.getPositionInfo({ category: 'linear', settleCoin: 'USDT' });

  return result.result.list
    .filter((p) => parseFloat(p.size) > 0)
    .map((p) => ({
      symbol: p.symbol,
      side: p.side as 'Buy' | 'Sell',
      size: parseFloat(p.size),
      entryPrice: parseFloat(p.avgPrice),
      markPrice: parseFloat(p.markPrice),
      unrealisedPnl: parseFloat(p.unrealisedPnl),
      cumRealisedPnl: parseFloat(p.cumRealisedPnl),
      leverage: parseFloat(p.leverage ?? '1'),
      liqPrice: parseFloat(p.liqPrice ?? '0'),
      positionValue: parseFloat(p.positionValue),
    }));
}

export async function getOpenOrders(config: BybitConfig, symbol?: string): Promise<OrderResult[]> {
  const c = getClient(config);
  const params: { category: 'linear'; symbol?: string } = { category: 'linear' };
  if (symbol) params.symbol = symbol;
  const result = await c.getActiveOrders(params);

  return result.result.list.map((o: { orderId: string; symbol: string; side: string; orderType: string; price: string; qty: string; cumExecQty: string; avgPrice: string; orderStatus: string }) => ({
    orderId: o.orderId,
    symbol: o.symbol,
    side: o.side as 'Buy' | 'Sell',
    orderType: o.orderType,
    price: parseFloat(o.price),
    qty: parseFloat(o.qty),
    cumExecQty: parseFloat(o.cumExecQty),
    avgPrice: parseFloat(o.avgPrice ?? '0'),
    orderStatus: o.orderStatus,
  }));
}

// =============================================================================
// TRADING
// =============================================================================

export async function setLeverage(
  config: BybitConfig,
  symbol: string,
  leverage: number
): Promise<void> {
  if (config.dryRun) {
    logger.info({ symbol, leverage }, '[DRY RUN] Set leverage');
    return;
  }

  const c = getClient(config);
  await c.setLeverage({
    category: 'linear',
    symbol,
    buyLeverage: String(leverage),
    sellLeverage: String(leverage),
  });
}

export async function openLong(
  config: BybitConfig,
  symbol: string,
  qty: number,
  leverage?: number
): Promise<OrderResult> {
  if (leverage != null) {
    await setLeverage(config, symbol, leverage);
  }

  if (config.dryRun) {
    logger.info({ symbol, qty, leverage }, '[DRY RUN] Open long');
    return {
      orderId: Date.now().toString(),
      symbol,
      side: 'Buy',
      orderType: 'Market',
      price: 0,
      qty,
      cumExecQty: qty,
      avgPrice: 0,
      orderStatus: 'DRY_RUN',
    };
  }

  const c = getClient(config);
  const result = await c.submitOrder({
    category: 'linear',
    symbol,
    side: 'Buy',
    orderType: 'Market',
    qty: String(qty),
  });

  return {
    orderId: result.result.orderId,
    symbol,
    side: 'Buy',
    orderType: 'Market',
    price: 0,
    qty,
    cumExecQty: qty,
    avgPrice: 0,
    orderStatus: 'Created',
  };
}

export async function openShort(
  config: BybitConfig,
  symbol: string,
  qty: number,
  leverage?: number
): Promise<OrderResult> {
  if (leverage != null) {
    await setLeverage(config, symbol, leverage);
  }

  if (config.dryRun) {
    logger.info({ symbol, qty, leverage }, '[DRY RUN] Open short');
    return {
      orderId: Date.now().toString(),
      symbol,
      side: 'Sell',
      orderType: 'Market',
      price: 0,
      qty,
      cumExecQty: qty,
      avgPrice: 0,
      orderStatus: 'DRY_RUN',
    };
  }

  const c = getClient(config);
  const result = await c.submitOrder({
    category: 'linear',
    symbol,
    side: 'Sell',
    orderType: 'Market',
    qty: String(qty),
  });

  return {
    orderId: result.result.orderId,
    symbol,
    side: 'Sell',
    orderType: 'Market',
    price: 0,
    qty,
    cumExecQty: qty,
    avgPrice: 0,
    orderStatus: 'Created',
  };
}

export async function closePosition(
  config: BybitConfig,
  symbol: string
): Promise<OrderResult | null> {
  const positions = await getPositions(config);
  const position = positions.find(p => p.symbol === symbol);

  if (!position || position.size === 0) {
    return null;
  }

  const side = position.side === 'Buy' ? 'Sell' : 'Buy';
  const qty = position.size;

  if (config.dryRun) {
    logger.info({ symbol, side, qty }, '[DRY RUN] Close position');
    return {
      orderId: Date.now().toString(),
      symbol,
      side: side as 'Buy' | 'Sell',
      orderType: 'Market',
      price: position.markPrice,
      qty,
      cumExecQty: qty,
      avgPrice: position.markPrice,
      orderStatus: 'DRY_RUN',
    };
  }

  const c = getClient(config);
  const result = await c.submitOrder({
    category: 'linear',
    symbol,
    side,
    orderType: 'Market',
    qty: String(qty),
    reduceOnly: true,
  });

  return {
    orderId: result.result.orderId,
    symbol,
    side: side as 'Buy' | 'Sell',
    orderType: 'Market',
    price: 0,
    qty,
    cumExecQty: qty,
    avgPrice: 0,
    orderStatus: 'Created',
  };
}

export async function closeAllPositions(config: BybitConfig): Promise<OrderResult[]> {
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
  config: BybitConfig,
  symbol: string,
  orderId: string
): Promise<boolean> {
  if (config.dryRun) {
    logger.info({ symbol, orderId }, '[DRY RUN] Cancel order');
    return true;
  }

  const c = getClient(config);
  await c.cancelOrder({ category: 'linear', symbol, orderId });
  return true;
}

export async function cancelAllOrders(
  config: BybitConfig,
  symbol: string
): Promise<number> {
  if (config.dryRun) {
    logger.info({ symbol }, '[DRY RUN] Cancel all orders');
    return 0;
  }

  const c = getClient(config);
  await c.cancelAllOrders({ category: 'linear', symbol });
  return 1;
}

export async function placeLimitOrder(
  config: BybitConfig,
  symbol: string,
  side: 'Buy' | 'Sell',
  qty: number,
  price: number,
  params?: { reduceOnly?: boolean; timeInForce?: string }
): Promise<OrderResult> {
  if (config.dryRun) {
    logger.info({ symbol, side, qty, price }, '[DRY RUN] Place limit order');
    return {
      orderId: Date.now().toString(),
      symbol,
      side,
      orderType: 'Limit',
      price,
      qty,
      cumExecQty: 0,
      avgPrice: 0,
      orderStatus: 'DRY_RUN',
    };
  }

  const c = getClient(config);
  const result = await c.submitOrder({
    category: 'linear',
    symbol,
    side,
    orderType: 'Limit',
    qty: String(qty),
    price: String(price),
    timeInForce: (params?.timeInForce ?? 'GTC') as 'GTC' | 'IOC' | 'FOK',
    ...(params?.reduceOnly ? { reduceOnly: true } : {}),
  });

  return {
    orderId: result.result.orderId,
    symbol,
    side,
    orderType: 'Limit',
    price,
    qty,
    cumExecQty: 0,
    avgPrice: 0,
    orderStatus: 'New',
  };
}

export async function placeStopOrder(
  config: BybitConfig,
  symbol: string,
  side: 'Buy' | 'Sell',
  qty: number,
  triggerPrice: number,
  params?: { price?: number }
): Promise<OrderResult> {
  if (config.dryRun) {
    logger.info({ symbol, side, qty, triggerPrice }, '[DRY RUN] Place stop order');
    return {
      orderId: Date.now().toString(),
      symbol,
      side,
      orderType: 'Stop',
      price: triggerPrice,
      qty,
      cumExecQty: 0,
      avgPrice: 0,
      orderStatus: 'DRY_RUN',
    };
  }

  const c = getClient(config);
  const result = await c.submitOrder({
    category: 'linear',
    symbol,
    side,
    orderType: params?.price ? 'Limit' : 'Market',
    qty: String(qty),
    triggerPrice: String(triggerPrice),
    triggerBy: 'MarkPrice',
    reduceOnly: true,
    ...(params?.price ? { price: String(params.price), timeInForce: 'GTC' as const } : {}),
  });

  return {
    orderId: result.result.orderId,
    symbol,
    side,
    orderType: 'Stop',
    price: triggerPrice,
    qty,
    cumExecQty: 0,
    avgPrice: 0,
    orderStatus: 'New',
  };
}

export interface IncomeRecord {
  symbol: string;
  type: string;
  amount: number;
  time: Date;
}

export async function getIncomeHistory(
  config: BybitConfig,
  params?: { symbol?: string; limit?: number }
): Promise<IncomeRecord[]> {
  const c = getClient(config);
  const result = await c.getClosedPnL({
    category: 'linear',
    ...(params?.symbol ? { symbol: params.symbol } : {}),
    limit: params?.limit ?? 50,
  });

  return result.result.list.map((r: { symbol: string; closedPnl: string; createdTime: string }) => {
    const ts = parseInt(r.createdTime, 10);
    return {
      symbol: r.symbol,
      type: 'REALIZED_PNL',
      amount: parseFloat(r.closedPnl),
      time: new Date(Number.isNaN(ts) ? 0 : ts),
    };
  });
}
