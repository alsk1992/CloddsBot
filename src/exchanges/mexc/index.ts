/**
 * MEXC Futures Integration
 *
 * USDT perpetual futures with up to 200x leverage. No KYC for small amounts.
 */

import crypto from 'crypto';
import { logger } from '../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface MexcConfig {
  apiKey: string;
  apiSecret: string;
  dryRun?: boolean;
}

export interface Position {
  symbol: string;
  positionType: number; // 1=Long, 2=Short
  holdVol: number;
  openAvgPrice: number;
  markPrice: number;
  unrealisedPnl: number;
  realisedPnl: number;
  leverage: number;
  liquidatePrice: number;
  positionValue: number;
}

export interface Balance {
  currency: string;
  availableBalance: number;
  frozenBalance: number;
  equity: number;
  unrealisedPnl: number;
}

export interface OrderResult {
  orderId: string;
  symbol: string;
  side: number;
  orderType: number;
  price: number;
  vol: number;
  dealVol: number;
  dealAvgPrice: number;
  state: number;
}

export interface FundingRate {
  symbol: string;
  fundingRate: number;
  nextSettleTime: number;
  markPrice: number;
  indexPrice: number;
}

// =============================================================================
// API HELPERS
// =============================================================================

const BASE_URL = 'https://contract.mexc.com';

interface MexcApiResponse {
  code: number;
  message?: string;
  data: unknown;
}

function sign(params: Record<string, string | number>, secret: string): string {
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function request(
  config: MexcConfig,
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<unknown> {
  const timestamp = Date.now();
  const allParams = { ...params, timestamp };
  const signature = sign(allParams, config.apiSecret);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ApiKey': config.apiKey,
    'Request-Time': String(timestamp),
    'Signature': signature,
  };

  let url = `${BASE_URL}${endpoint}`;
  let body: string | undefined;

  if (method === 'GET') {
    const qs = Object.entries(allParams).map(([k, v]) => `${k}=${v}`).join('&');
    url += `?${qs}`;
  } else {
    body = JSON.stringify(allParams);
  }

  const response = await fetch(url, { method, headers, body });
  const data = await response.json() as MexcApiResponse;

  if (data.code !== 0) {
    throw new Error(data.message || `MEXC API error: ${data.code}`);
  }

  return data.data;
}

// =============================================================================
// MARKET DATA
// =============================================================================

export async function getPrice(config: MexcConfig, symbol: string): Promise<number> {
  const data = await request(config, 'GET', '/api/v1/contract/ticker', { symbol }) as { lastPrice: number | string };
  return typeof data.lastPrice === 'string' ? parseFloat(data.lastPrice) : data.lastPrice;
}

export async function getFundingRate(config: MexcConfig, symbol: string): Promise<FundingRate> {
  const data = await request(config, 'GET', '/api/v1/contract/funding_rate', { symbol }) as {
    fundingRate: number;
    nextSettleTime: number;
    markPrice: number;
    indexPrice: number;
  };
  return {
    symbol,
    fundingRate: data.fundingRate,
    nextSettleTime: data.nextSettleTime,
    markPrice: data.markPrice,
    indexPrice: data.indexPrice ?? data.markPrice,
  };
}

export async function getMarkets(config: MexcConfig): Promise<string[]> {
  const data = await request(config, 'GET', '/api/v1/contract/detail') as Array<{ symbol: string; state: number }>;
  return data.filter(s => s.state === 0).map(s => s.symbol);
}

// =============================================================================
// ACCOUNT
// =============================================================================

export async function getBalance(config: MexcConfig): Promise<Balance[]> {
  const data = await request(config, 'GET', '/api/v1/private/account/assets') as Array<{
    currency: string;
    availableBalance: number;
    frozenBalance: number;
    equity: number;
    unrealisedPnl: number;
  }>;

  return data
    .filter(b => b.equity > 0)
    .map(b => ({
      currency: b.currency,
      availableBalance: b.availableBalance,
      frozenBalance: b.frozenBalance,
      equity: b.equity,
      unrealisedPnl: b.unrealisedPnl,
    }));
}

export async function getPositions(config: MexcConfig): Promise<Position[]> {
  const data = await request(config, 'GET', '/api/v1/private/position/open_positions') as Array<{
    symbol: string;
    positionType: number;
    holdVol: number;
    openAvgPrice: number;
    markPrice: number;
    unrealisedPnl: number;
    realisedPnl: number;
    leverage: number;
    liquidatePrice: number;
    positionValue: number;
  }>;

  return data
    .filter(p => p.holdVol > 0)
    .map(p => ({
      symbol: p.symbol,
      positionType: p.positionType,
      holdVol: p.holdVol,
      openAvgPrice: p.openAvgPrice,
      markPrice: p.markPrice,
      unrealisedPnl: p.unrealisedPnl,
      realisedPnl: p.realisedPnl,
      leverage: p.leverage,
      liquidatePrice: p.liquidatePrice,
      positionValue: p.positionValue,
    }));
}

export async function getOpenOrders(config: MexcConfig, symbol?: string): Promise<OrderResult[]> {
  const params: Record<string, string | number> = {};
  if (symbol) params.symbol = symbol;

  const data = await request(config, 'GET', '/api/v1/private/order/list/open_orders', params) as Array<{
    orderId: string;
    symbol: string;
    side: number;
    orderType: number;
    price: number;
    vol: number;
    dealVol: number;
    dealAvgPrice: number;
    state: number;
  }>;

  return data.map(o => ({
    orderId: o.orderId,
    symbol: o.symbol,
    side: o.side,
    orderType: o.orderType,
    price: o.price,
    vol: o.vol,
    dealVol: o.dealVol,
    dealAvgPrice: o.dealAvgPrice,
    state: o.state,
  }));
}

// =============================================================================
// TRADING
// =============================================================================

export async function setLeverage(
  config: MexcConfig,
  symbol: string,
  leverage: number
): Promise<void> {
  if (config.dryRun) {
    logger.info({ symbol, leverage }, '[DRY RUN] Set leverage');
    return;
  }

  await request(config, 'POST', '/api/v1/private/position/change_leverage', {
    symbol,
    leverage,
  });
}

export async function openLong(
  config: MexcConfig,
  symbol: string,
  vol: number,
  leverage?: number,
  openType?: number // 1=Isolated, 2=Cross
): Promise<OrderResult> {
  if (leverage != null) {
    await setLeverage(config, symbol, leverage);
  }

  if (config.dryRun) {
    logger.info({ symbol, vol, leverage }, '[DRY RUN] Open long');
    return {
      orderId: Date.now().toString(),
      symbol,
      side: 1, // Open Long
      orderType: 5, // Market
      price: 0,
      vol,
      dealVol: vol,
      dealAvgPrice: 0,
      state: 0,
    };
  }

  const data = await request(config, 'POST', '/api/v1/private/order/submit', {
    symbol,
    side: 1, // 1=Open Long
    type: 5, // 5=Market
    vol,
    leverage: leverage ?? 10,
    openType: openType ?? 1, // 1=Isolated, 2=Cross
  }) as { orderId: string };

  return {
    orderId: data.orderId,
    symbol,
    side: 1,
    orderType: 5,
    price: 0,
    vol,
    dealVol: vol,
    dealAvgPrice: 0,
    state: 2,
  };
}

export async function openShort(
  config: MexcConfig,
  symbol: string,
  vol: number,
  leverage?: number,
  openType?: number // 1=Isolated, 2=Cross
): Promise<OrderResult> {
  if (leverage != null) {
    await setLeverage(config, symbol, leverage);
  }

  if (config.dryRun) {
    logger.info({ symbol, vol, leverage }, '[DRY RUN] Open short');
    return {
      orderId: Date.now().toString(),
      symbol,
      side: 3, // Open Short
      orderType: 5, // Market
      price: 0,
      vol,
      dealVol: vol,
      dealAvgPrice: 0,
      state: 0,
    };
  }

  const data = await request(config, 'POST', '/api/v1/private/order/submit', {
    symbol,
    side: 3, // 3=Open Short
    type: 5, // 5=Market
    vol,
    leverage: leverage ?? 10,
    openType: openType ?? 1,
  }) as { orderId: string };

  return {
    orderId: data.orderId,
    symbol,
    side: 3,
    orderType: 5,
    price: 0,
    vol,
    dealVol: vol,
    dealAvgPrice: 0,
    state: 2,
  };
}

export async function closePosition(
  config: MexcConfig,
  symbol: string
): Promise<OrderResult | null> {
  const positions = await getPositions(config);
  const position = positions.find(p => p.symbol === symbol);

  if (!position || position.holdVol === 0) {
    return null;
  }

  // side: 2=Close Short (close long), 4=Close Long (close short)
  const side = position.positionType === 1 ? 4 : 2;
  const vol = position.holdVol;

  if (config.dryRun) {
    logger.info({ symbol, side, vol }, '[DRY RUN] Close position');
    return {
      orderId: Date.now().toString(),
      symbol,
      side,
      orderType: 5,
      price: position.markPrice,
      vol,
      dealVol: vol,
      dealAvgPrice: position.markPrice,
      state: 0,
    };
  }

  const data = await request(config, 'POST', '/api/v1/private/order/submit', {
    symbol,
    side,
    type: 5,
    vol,
  }) as { orderId: string };

  return {
    orderId: data.orderId,
    symbol,
    side,
    orderType: 5,
    price: 0,
    vol,
    dealVol: vol,
    dealAvgPrice: 0,
    state: 2,
  };
}

export async function closeAllPositions(config: MexcConfig): Promise<OrderResult[]> {
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
  config: MexcConfig,
  symbol: string,
  orderId: string
): Promise<boolean> {
  if (config.dryRun) {
    logger.info({ symbol, orderId }, '[DRY RUN] Cancel order');
    return true;
  }

  await request(config, 'POST', '/api/v1/private/order/cancel', {
    symbol,
    orderId,
  });
  return true;
}

export async function cancelAllOrders(
  config: MexcConfig,
  symbol: string
): Promise<number> {
  if (config.dryRun) {
    logger.info({ symbol }, '[DRY RUN] Cancel all orders');
    return 0;
  }

  await request(config, 'POST', '/api/v1/private/order/cancel_all', { symbol });
  return 1;
}

export async function placeLimitOrder(
  config: MexcConfig,
  symbol: string,
  side: number, // 1=open long, 2=close short, 3=open short, 4=close long
  vol: number,
  price: number,
  params?: { leverage?: number; openType?: number }
): Promise<OrderResult> {
  if (config.dryRun) {
    logger.info({ symbol, side, vol, price }, '[DRY RUN] Place limit order');
    return {
      orderId: Date.now().toString(),
      symbol,
      side,
      orderType: 1,
      price,
      vol,
      dealVol: 0,
      dealAvgPrice: 0,
      state: 0,
    };
  }

  const data = await request(config, 'POST', '/api/v1/private/order/submit', {
    symbol,
    side,
    type: 1, // 1=Limit
    vol,
    price,
    leverage: params?.leverage ?? 10,
    openType: params?.openType ?? 1,
  }) as { orderId: string };

  return {
    orderId: data.orderId,
    symbol,
    side,
    orderType: 1,
    price,
    vol,
    dealVol: 0,
    dealAvgPrice: 0,
    state: 2,
  };
}

export async function placeStopOrder(
  config: MexcConfig,
  symbol: string,
  side: number, // 2=close long, 4=close short
  vol: number,
  triggerPrice: number,
  params?: { price?: number; openType?: number }
): Promise<OrderResult> {
  if (config.dryRun) {
    logger.info({ symbol, side, vol, triggerPrice }, '[DRY RUN] Place stop order');
    return {
      orderId: Date.now().toString(),
      symbol,
      side,
      orderType: params?.price ? 1 : 5,
      price: params?.price ?? triggerPrice,
      vol,
      dealVol: 0,
      dealAvgPrice: 0,
      state: 0,
    };
  }

  const orderParams: Record<string, string | number> = {
    symbol,
    side,
    type: params?.price ? 1 : 5, // 1=limit, 5=market
    vol,
    triggerPrice,
    triggerType: 1, // 1=trigger by mark price
    openType: params?.openType ?? 1,
  };

  if (params?.price) {
    orderParams.price = params.price;
  }

  const data = await request(config, 'POST', '/api/v1/private/order/submit', orderParams) as { orderId: string };

  return {
    orderId: data.orderId,
    symbol,
    side,
    orderType: params?.price ? 1 : 5,
    price: params?.price ?? triggerPrice,
    vol,
    dealVol: 0,
    dealAvgPrice: 0,
    state: 2,
  };
}

export interface IncomeRecord {
  symbol: string;
  type: string;
  amount: number;
  time: Date;
}

export async function getIncomeHistory(
  config: MexcConfig,
  params?: { symbol?: string; limit?: number }
): Promise<IncomeRecord[]> {
  const reqParams: Record<string, string | number> = {
    page_num: 1,
    page_size: params?.limit ?? 50,
  };
  if (params?.symbol) reqParams.symbol = params.symbol;

  const data = await request(config, 'GET', '/api/v1/private/position/list/history_positions', reqParams) as Array<{
    symbol: string;
    realisedPnl: number;
    closeTime: number;
  }>;

  return data.map((d) => ({
    symbol: d.symbol,
    type: 'REALIZED_PNL',
    amount: d.realisedPnl ?? 0,
    time: new Date(d.closeTime ?? Date.now()),
  }));
}
