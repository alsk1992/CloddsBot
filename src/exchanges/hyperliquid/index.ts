/**
 * Hyperliquid L1 Integration
 *
 * Full support for the dominant perps DEX (69% market share).
 * Uses official SDK for proper signing.
 *
 * @see https://github.com/nomeida/hyperliquid
 */

import { EventEmitter } from 'events';
import { Hyperliquid } from 'hyperliquid';
import { logger } from '../../utils/logger';

// =============================================================================
// CONSTANTS
// =============================================================================

const API_URL = 'https://api.hyperliquid.xyz';
const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const HLP_VAULT = '0x010461C14e146ac35fE42271BDC1134EE31C703B';

// =============================================================================
// TYPES
// =============================================================================

export interface HyperliquidConfig {
  walletAddress: string;
  privateKey: string;
  testnet?: boolean;
  vaultAddress?: string;
  dryRun?: boolean;
}

export interface SpotMeta {
  tokens: Array<{
    name: string;
    szDecimals: number;
    weiDecimals: number;
    index: number;
    tokenId: string;
    isCanonical: boolean;
  }>;
  universe: Array<{
    name: string;
    tokens: [number, number];
    index: number;
  }>;
}

export interface PerpMeta {
  universe: Array<{
    name: string;
    szDecimals: number;
    maxLeverage: number;
  }>;
}

export interface OrderbookLevel {
  price: number;
  size: number;
  numOrders: number;
}

export interface Orderbook {
  coin: string;
  levels: [OrderbookLevel[], OrderbookLevel[]];
  time: number;
}

export interface SpotBalance {
  coin: string;
  hold: string;
  total: string;
  entryNtl: string;
}

export interface HlpStats {
  tvl: number;
  apr24h: number;
  apr7d: number;
  apr30d: number;
  volume24h: number;
  pnl24h: number;
}

export interface PointsData {
  total: number;
  daily: number;
  rank: number;
  breakdown: {
    trading: number;
    referrals: number;
    hlp: number;
    staking: number;
  };
}

export interface SpotOrder {
  coin: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  type: 'LIMIT' | 'MARKET';
  reduceOnly?: boolean;
  postOnly?: boolean;
  clientOrderId?: string;
}

export interface PerpOrder {
  coin: string;
  side: 'BUY' | 'SELL';
  size: number;
  price?: number;
  type?: 'LIMIT' | 'MARKET';
  reduceOnly?: boolean;
  postOnly?: boolean;
  clientOrderId?: string;
}

export interface TwapOrder {
  coin: string;
  side: 'BUY' | 'SELL';
  size: number;
  durationMinutes: number;
  randomize?: boolean;
  reduceOnly?: boolean;
}

export interface UserFills {
  closedPnl: string;
  coin: string;
  crossed: boolean;
  dir: string;
  hash: string;
  oid: number;
  px: string;
  side: string;
  startPosition: string;
  sz: string;
  time: number;
  fee: string;
}

export interface OrderResult {
  success: boolean;
  orderId?: number;
  error?: string;
}

// =============================================================================
// SDK CLIENT CACHE
// =============================================================================

const sdkCache = new Map<string, Hyperliquid>();

function getSDK(config: HyperliquidConfig): Hyperliquid {
  const key = `${config.walletAddress}-${config.testnet ? 'test' : 'main'}`;

  let sdk = sdkCache.get(key);
  if (!sdk) {
    sdk = new Hyperliquid({
      privateKey: config.privateKey,
      testnet: config.testnet || false,
      walletAddress: config.walletAddress,
      vaultAddress: config.vaultAddress,
    });
    sdkCache.set(key, sdk);
  }

  return sdk;
}

// =============================================================================
// HTTP HELPER (for read-only endpoints)
// =============================================================================

async function httpRequest<T>(endpoint: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hyperliquid API error: ${response.status} ${text}`);
  }

  return response.json() as Promise<T>;
}

// =============================================================================
// INFO ENDPOINTS (No Auth Required)
// =============================================================================

export async function getPerpMeta(): Promise<PerpMeta> {
  return httpRequest('/info', { type: 'meta' });
}

export async function getSpotMeta(): Promise<SpotMeta> {
  return httpRequest('/info', { type: 'spotMeta' });
}

export async function getAllMids(): Promise<Record<string, string>> {
  return httpRequest('/info', { type: 'allMids' });
}

export async function getOrderbook(coin: string): Promise<Orderbook> {
  const data = await httpRequest<{ levels: [[string, string, number][], [string, string, number][]] }>('/info', {
    type: 'l2Book',
    coin,
  });

  return {
    coin,
    levels: [
      data.levels[0].map(([px, sz, n]) => ({ price: parseFloat(px), size: parseFloat(sz), numOrders: n })),
      data.levels[1].map(([px, sz, n]) => ({ price: parseFloat(px), size: parseFloat(sz), numOrders: n })),
    ],
    time: Date.now(),
  };
}

export async function getFundingRates(): Promise<Array<{ coin: string; funding: string; premium: string; openInterest: string }>> {
  const meta = await getPerpMeta();
  const data = await httpRequest<[PerpMeta, Array<{ funding: string; premium: string; openInterest: string }>]>('/info', {
    type: 'metaAndAssetCtxs',
  });

  const contexts = data[1];
  return meta.universe.map((asset, i) => ({
    coin: asset.name,
    funding: contexts[i]?.funding || '0',
    premium: contexts[i]?.premium || '0',
    openInterest: contexts[i]?.openInterest || '0',
  }));
}

export async function getHlpStats(): Promise<HlpStats> {
  const vaultInfo = await httpRequest<{
    vaultEquity: string;
    apr: number;
    dayPnl: string;
  }>('/info', {
    type: 'vaultDetails',
    vaultAddress: HLP_VAULT,
  });

  return {
    tvl: parseFloat(vaultInfo.vaultEquity),
    apr24h: vaultInfo.apr,
    apr7d: vaultInfo.apr,
    apr30d: vaultInfo.apr,
    volume24h: 0,
    pnl24h: parseFloat(vaultInfo.dayPnl),
  };
}

export async function getLeaderboard(timeframe: 'day' | 'week' | 'month' | 'allTime' = 'day'): Promise<Array<{
  address: string;
  pnl: number;
  roi: number;
  volume: number;
}>> {
  const data = await httpRequest<Array<{
    ethAddress: string;
    pnl: string;
    roi: string;
    vlm: string;
  }>>('/info', {
    type: 'leaderboard',
    timeframe,
  });

  return data.map(entry => ({
    address: entry.ethAddress,
    pnl: parseFloat(entry.pnl),
    roi: parseFloat(entry.roi),
    volume: parseFloat(entry.vlm),
  }));
}

export async function getCandles(
  coin: string,
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
  startTime?: number,
  endTime?: number
): Promise<Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>> {
  const data = await httpRequest<Array<{
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
  }>>('/info', {
    type: 'candleSnapshot',
    coin,
    interval,
    startTime: startTime || Date.now() - 24 * 60 * 60 * 1000,
    endTime: endTime || Date.now(),
  });

  return data.map(c => ({
    time: c.t,
    open: parseFloat(c.o),
    high: parseFloat(c.h),
    low: parseFloat(c.l),
    close: parseFloat(c.c),
    volume: parseFloat(c.v),
  }));
}

// =============================================================================
// USER INFO ENDPOINTS
// =============================================================================

export async function getUserState(userAddress: string): Promise<{
  marginSummary: { accountValue: string; totalMarginUsed: string };
  assetPositions: Array<{
    position: {
      coin: string;
      szi: string;
      entryPx: string;
      unrealizedPnl: string;
      liquidationPx: string;
    };
  }>;
}> {
  return httpRequest('/info', {
    type: 'clearinghouseState',
    user: userAddress,
  });
}

export async function getSpotBalances(userAddress: string): Promise<SpotBalance[]> {
  const data = await httpRequest<{ balances: SpotBalance[] }>('/info', {
    type: 'spotClearinghouseState',
    user: userAddress,
  });
  return data.balances;
}

export async function getUserFills(userAddress: string): Promise<UserFills[]> {
  return httpRequest('/info', {
    type: 'userFills',
    user: userAddress,
  });
}

export async function getOpenOrders(userAddress: string): Promise<Array<{
  coin: string;
  oid: number;
  side: string;
  limitPx: string;
  sz: string;
  timestamp: number;
}>> {
  return httpRequest('/info', {
    type: 'openOrders',
    user: userAddress,
  });
}

export async function getUserPoints(userAddress: string): Promise<PointsData> {
  try {
    const data = await httpRequest<{
      total: string;
      daily: string;
      rank: number;
    }>('/info', {
      type: 'userPoints',
      user: userAddress,
    });

    return {
      total: parseFloat(data.total || '0'),
      daily: parseFloat(data.daily || '0'),
      rank: data.rank || 0,
      breakdown: { trading: 0, referrals: 0, hlp: 0, staking: 0 },
    };
  } catch {
    return {
      total: 0,
      daily: 0,
      rank: 0,
      breakdown: { trading: 0, referrals: 0, hlp: 0, staking: 0 },
    };
  }
}

export async function getUserRateLimit(userAddress: string): Promise<{
  cumVlm: number;
  nRequestsUsed: number;
  nRequestsCap: number;
}> {
  const data = await httpRequest<{
    cumVlm: string;
    nRequestsUsed: number;
    nRequestsCap: number;
  }>('/info', {
    type: 'userRateLimit',
    user: userAddress,
  });

  return {
    cumVlm: parseFloat(data.cumVlm),
    nRequestsUsed: data.nRequestsUsed,
    nRequestsCap: data.nRequestsCap,
  };
}

export async function getHistoricalOrders(userAddress: string): Promise<Array<{
  coin: string;
  side: string;
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  status: string;
}>> {
  return httpRequest('/info', {
    type: 'historicalOrders',
    user: userAddress,
  });
}

export async function getUserFees(userAddress: string): Promise<{
  makerRate: number;
  takerRate: number;
  volume30d: number;
}> {
  const data = await httpRequest<{
    userCrossRate: string;
    userAddRate: string;
  }>('/info', {
    type: 'userFees',
    user: userAddress,
  });

  return {
    makerRate: parseFloat(data.userAddRate),
    takerRate: parseFloat(data.userCrossRate),
    volume30d: 0,
  };
}

export async function getBorrowLendState(userAddress: string): Promise<{
  deposits: Array<{ token: string; amount: string; apy: string }>;
  borrows: Array<{ token: string; amount: string; apy: string }>;
  healthFactor: number;
}> {
  try {
    const data = await httpRequest<{
      deposits: Array<{ token: string; amount: string; apy: string }>;
      borrows: Array<{ token: string; amount: string; apy: string }>;
    }>('/info', {
      type: 'borrowLendUserState',
      user: userAddress,
    });

    return {
      deposits: data.deposits || [],
      borrows: data.borrows || [],
      healthFactor: 999,
    };
  } catch {
    return { deposits: [], borrows: [], healthFactor: 999 };
  }
}

export async function getAllBorrowLendReserves(): Promise<Array<{
  token: string;
  totalDeposits: string;
  totalBorrows: string;
  depositApy: string;
  borrowApy: string;
  utilizationRate: string;
}>> {
  try {
    return await httpRequest('/info', { type: 'allBorrowLendReserveStates' });
  } catch {
    return [];
  }
}

/**
 * Get order status by order ID
 */
export async function getOrderStatus(userAddress: string, oid: number | string): Promise<{
  order: {
    coin: string;
    side: string;
    limitPx: string;
    sz: string;
    oid: number;
    timestamp: number;
    origSz: string;
  };
  status: string;
  statusTimestamp: number;
} | null> {
  try {
    return await httpRequest('/info', {
      type: 'orderStatus',
      user: userAddress,
      oid,
    });
  } catch {
    return null;
  }
}

/**
 * Get frontend-enriched open orders
 */
export async function getFrontendOpenOrders(userAddress: string): Promise<Array<{
  coin: string;
  oid: number;
  side: string;
  limitPx: string;
  sz: string;
  origSz: string;
  timestamp: number;
  cloid?: string;
  reduceOnly: boolean;
  orderType: string;
  triggerPx?: string;
  triggerCondition?: string;
}>> {
  return httpRequest('/info', {
    type: 'frontendOpenOrders',
    user: userAddress,
  });
}

/**
 * Get user fills filtered by time range
 */
export async function getUserFillsByTime(
  userAddress: string,
  startTime: number,
  endTime?: number,
  aggregateByTime?: boolean
): Promise<UserFills[]> {
  return httpRequest('/info', {
    type: 'userFillsByTime',
    user: userAddress,
    startTime,
    endTime,
    aggregateByTime,
  });
}

/**
 * Get funding history for a coin
 */
export async function getFundingHistory(
  coin: string,
  startTime: number,
  endTime?: number
): Promise<Array<{
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
}>> {
  return httpRequest('/info', {
    type: 'fundingHistory',
    coin,
    startTime,
    endTime,
  });
}

/**
 * Get predicted funding rates across venues
 */
export async function getPredictedFundings(): Promise<Array<{
  coin: string;
  venue: string;
  predictedFunding: string;
}>> {
  return httpRequest('/info', { type: 'predictedFundings' });
}

/**
 * Get user funding history
 */
export async function getUserFunding(
  userAddress: string,
  startTime: number,
  endTime?: number
): Promise<Array<{
  time: number;
  coin: string;
  usdc: string;
  szi: string;
  fundingRate: string;
}>> {
  return httpRequest('/info', {
    type: 'userFunding',
    user: userAddress,
    startTime,
    endTime,
  });
}

/**
 * Get user non-funding ledger updates (deposits, withdrawals, transfers)
 */
export async function getUserNonFundingLedgerUpdates(
  userAddress: string,
  startTime: number,
  endTime?: number
): Promise<Array<{
  time: number;
  hash: string;
  delta: {
    type: 'deposit' | 'withdraw' | 'transfer' | 'liquidation';
    usdc: string;
  };
}>> {
  return httpRequest('/info', {
    type: 'userNonFundingLedgerUpdates',
    user: userAddress,
    startTime,
    endTime,
  });
}

/**
 * Get user portfolio
 */
export async function getUserPortfolio(userAddress: string): Promise<{
  accountValue: string;
  pnl: {
    allTime: string;
    day: string;
    week: string;
    month: string;
  };
  vlm: {
    allTime: string;
    day: string;
    week: string;
    month: string;
  };
}> {
  return httpRequest('/info', {
    type: 'portfolio',
    user: userAddress,
  });
}

/**
 * Get user subaccounts
 */
export async function getSubAccounts(userAddress: string): Promise<Array<{
  subAccountUser: string;
  name: string;
  clearinghouseState: unknown;
}>> {
  return httpRequest('/info', {
    type: 'subAccounts',
    user: userAddress,
  });
}

/**
 * Get user vault equities
 */
export async function getUserVaultEquities(userAddress: string): Promise<Array<{
  vaultAddress: string;
  vaultName: string;
  equity: string;
}>> {
  return httpRequest('/info', {
    type: 'userVaultEquities',
    user: userAddress,
  });
}

/**
 * Get user referral info
 */
export async function getUserReferral(userAddress: string): Promise<{
  referredBy?: string;
  cumReferrerRebate: string;
  cumRefereeDiscount: string;
  unclaimedRewards: string;
  referralCode?: string;
}> {
  return httpRequest('/info', {
    type: 'referral',
    user: userAddress,
  });
}

/**
 * Get TWAP slice fills
 */
export async function getUserTwapSliceFills(userAddress: string): Promise<Array<{
  twapId: number;
  coin: string;
  side: string;
  sz: string;
  px: string;
  time: number;
  fee: string;
}>> {
  return httpRequest('/info', {
    type: 'userTwapSliceFills',
    user: userAddress,
  });
}

/**
 * Get token details
 */
export async function getTokenDetails(tokenId: string): Promise<{
  name: string;
  szDecimals: number;
  weiDecimals: number;
  fullName?: string;
  totalSupply?: string;
  circulatingSupply?: string;
  markPx?: string;
} | null> {
  try {
    return await httpRequest('/info', {
      type: 'tokenDetails',
      tokenId,
    });
  } catch {
    return null;
  }
}

/**
 * Get spot metadata with asset contexts
 */
export async function getSpotMetaAndAssetCtxs(): Promise<[SpotMeta, Array<{
  coin: string;
  markPx: string;
  midPx: string;
  prevDayPx: string;
  dayNtlVlm: string;
  circulatingSupply: string;
}>]> {
  return httpRequest('/info', { type: 'spotMetaAndAssetCtxs' });
}

/**
 * Get perps at open interest cap
 */
export async function getPerpsAtOpenInterestCap(): Promise<string[]> {
  return httpRequest('/info', { type: 'perpsAtOpenInterestCap' });
}

/**
 * Get active asset data (user's leverage and sizing for a coin)
 */
export async function getActiveAssetData(userAddress: string, coin: string): Promise<{
  leverage: {
    type: string;
    value: number;
    rawUsd: string;
  };
  maxTradeSzs: [string, string];
}> {
  return httpRequest('/info', {
    type: 'activeAssetData',
    user: userAddress,
    coin,
  });
}

/**
 * Get user staking delegations
 */
export async function getDelegations(userAddress: string): Promise<Array<{
  validator: string;
  amount: string;
  lockedUntil?: number;
}>> {
  return httpRequest('/info', {
    type: 'delegations',
    user: userAddress,
  });
}

/**
 * Get delegator summary
 */
export async function getDelegatorSummary(userAddress: string): Promise<{
  totalDelegated: string;
  pendingUnlock: string;
  rewards: string;
}> {
  return httpRequest('/info', {
    type: 'delegatorSummary',
    user: userAddress,
  });
}

/**
 * Get delegator rewards
 */
export async function getDelegatorRewards(userAddress: string): Promise<Array<{
  time: number;
  amount: string;
  validator: string;
}>> {
  return httpRequest('/info', {
    type: 'delegatorRewards',
    user: userAddress,
  });
}

// =============================================================================
// TRADING ACTIONS (Using Official SDK)
// =============================================================================

/**
 * Place a perp order
 */
export async function placePerpOrder(
  config: HyperliquidConfig,
  order: PerpOrder
): Promise<OrderResult> {
  if (config.dryRun) {
    logger.info({ order }, '[DRY RUN] Would place Hyperliquid perp order');
    return { success: true, orderId: Date.now() };
  }

  try {
    const sdk = getSDK(config);

    // Get current price for market orders
    let limitPx = order.price;
    if (!limitPx || order.type === 'MARKET') {
      const mids = await getAllMids();
      const mid = parseFloat(mids[order.coin] || '0');
      limitPx = order.side === 'BUY' ? mid * 1.005 : mid * 0.995;
    }

    const tif = order.type === 'MARKET' ? 'Ioc' : order.postOnly ? 'Alo' : 'Gtc';

    const result = await sdk.exchange.placeOrder({
      coin: order.coin,
      is_buy: order.side === 'BUY',
      sz: order.size,
      limit_px: limitPx,
      order_type: { limit: { tif } },
      reduce_only: order.reduceOnly || false,
    });

    // Extract order ID from response
    const status = result?.response?.data?.statuses?.[0];
    const orderId = status?.resting?.oid || status?.filled?.oid;

    if (status?.error) {
      return { success: false, error: status.error };
    }

    return { success: true, orderId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, order }, 'Hyperliquid perp order failed');
    return { success: false, error: message };
  }
}

/**
 * Place a spot order
 */
export async function placeSpotOrder(
  config: HyperliquidConfig,
  order: SpotOrder
): Promise<OrderResult> {
  if (config.dryRun) {
    logger.info({ order }, '[DRY RUN] Would place Hyperliquid spot order');
    return { success: true, orderId: Date.now() };
  }

  try {
    const sdk = getSDK(config);

    const tif = order.type === 'MARKET' ? 'Ioc' : order.postOnly ? 'Alo' : 'Gtc';

    const result = await sdk.exchange.placeOrder({
      coin: order.coin,
      is_buy: order.side === 'BUY',
      sz: order.size,
      limit_px: order.price,
      order_type: { limit: { tif } },
      reduce_only: order.reduceOnly || false,
    });

    const status = result?.response?.data?.statuses?.[0];
    const orderId = status?.resting?.oid || status?.filled?.oid;

    if (status?.error) {
      return { success: false, error: status.error };
    }

    return { success: true, orderId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, order }, 'Hyperliquid spot order failed');
    return { success: false, error: message };
  }
}

/**
 * Cancel order by ID
 */
export async function cancelOrder(
  config: HyperliquidConfig,
  coin: string,
  oid: number
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ coin, oid }, '[DRY RUN] Would cancel order');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.cancelOrder({ coin, o: oid });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Cancel order by client order ID (cloid)
 */
export async function cancelOrderByCloid(
  config: HyperliquidConfig,
  coin: string,
  cloid: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ coin, cloid }, '[DRY RUN] Would cancel order by cloid');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.cancelOrderByCloid(coin, cloid);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Modify an existing order
 */
export async function modifyOrder(
  config: HyperliquidConfig,
  oid: number,
  order: PerpOrder
): Promise<OrderResult> {
  if (config.dryRun) {
    logger.info({ oid, order }, '[DRY RUN] Would modify order');
    return { success: true, orderId: oid };
  }

  try {
    const sdk = getSDK(config);
    const tif = order.type === 'MARKET' ? 'Ioc' : order.postOnly ? 'Alo' : 'Gtc';

    await sdk.exchange.modifyOrder(oid, {
      coin: order.coin,
      is_buy: order.side === 'BUY',
      sz: order.size,
      limit_px: order.price || 0,
      order_type: { limit: { tif } },
      reduce_only: order.reduceOnly || false,
    });
    return { success: true, orderId: oid };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Batch modify multiple orders
 */
export async function batchModifyOrders(
  config: HyperliquidConfig,
  modifications: Array<{ oid: number; order: PerpOrder }>
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ count: modifications.length }, '[DRY RUN] Would batch modify orders');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    const modifies = modifications.map(({ oid, order }) => {
      const tif = (order.type === 'MARKET' ? 'Ioc' : order.postOnly ? 'Alo' : 'Gtc') as 'Ioc' | 'Alo' | 'Gtc';
      return {
        oid,
        order: {
          coin: order.coin,
          is_buy: order.side === 'BUY',
          sz: order.size,
          limit_px: order.price || 0,
          order_type: { limit: { tif } },
          reduce_only: order.reduceOnly || false,
        },
      };
    });

    await sdk.exchange.batchModifyOrders(modifies);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Cancel all orders for a coin
 */
export async function cancelAllOrders(
  config: HyperliquidConfig,
  coin?: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ coin }, '[DRY RUN] Would cancel all orders');
    return { success: true };
  }

  try {
    const openOrders = await getOpenOrders(config.walletAddress);
    const ordersToCancel = coin
      ? openOrders.filter(o => o.coin === coin)
      : openOrders;

    const sdk = getSDK(config);
    for (const order of ordersToCancel) {
      await sdk.exchange.cancelOrder({ coin: order.coin, o: order.oid });
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Update leverage
 */
export async function updateLeverage(
  config: HyperliquidConfig,
  coin: string,
  leverage: number,
  isCross: boolean = true
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ coin, leverage, isCross }, '[DRY RUN] Would update leverage');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.updateLeverage(coin, isCross ? 'cross' : 'isolated', leverage);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Update isolated margin for a position
 * @param ntli - Amount in USDC (positive to add, negative to remove)
 */
export async function updateIsolatedMargin(
  config: HyperliquidConfig,
  coin: string,
  isBuy: boolean,
  ntli: number
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ coin, isBuy, ntli }, '[DRY RUN] Would update isolated margin');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.updateIsolatedMargin(coin, isBuy, ntli);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Schedule automatic cancellation of all orders (dead man's switch)
 * @param time - Unix timestamp in ms (at least 5 seconds in future), or undefined to cancel scheduled
 */
export async function scheduleCancel(
  config: HyperliquidConfig,
  time?: number
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ time }, '[DRY RUN] Would schedule cancel');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.scheduleCancel(time ?? null);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Transfer between spot and perp accounts
 */
export async function transferBetweenSpotAndPerp(
  config: HyperliquidConfig,
  amount: number,
  toPerp: boolean
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ amount, toPerp }, '[DRY RUN] Would transfer');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.transferBetweenSpotAndPerp(amount, toPerp);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Deposit to HLP vault
 */
export async function depositToHlp(
  config: HyperliquidConfig,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ amount }, '[DRY RUN] Would deposit to HLP');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.vaultTransfer(HLP_VAULT, true, amount);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Withdraw from HLP vault
 */
export async function withdrawFromHlp(
  config: HyperliquidConfig,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ amount }, '[DRY RUN] Would withdraw from HLP');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.vaultTransfer(HLP_VAULT, false, amount);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Place TWAP order
 */
export async function placeTwapOrder(
  config: HyperliquidConfig,
  order: TwapOrder
): Promise<{ success: boolean; twapId?: string; error?: string }> {
  if (config.dryRun) {
    logger.info({ order }, '[DRY RUN] Would place TWAP order');
    return { success: true, twapId: `twap-${Date.now()}` };
  }

  try {
    const sdk = getSDK(config);
    const result = await sdk.exchange.placeTwapOrder({
      coin: order.coin,
      is_buy: order.side === 'BUY',
      sz: order.size,
      minutes: order.durationMinutes,
      reduce_only: order.reduceOnly || false,
      randomize: order.randomize || false,
    });

    const twapId = result?.response?.data?.status?.running?.twapId;
    return { success: !!twapId, twapId: twapId?.toString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Cancel TWAP order
 */
export async function cancelTwap(
  config: HyperliquidConfig,
  coin: string,
  twapId: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.cancelTwapOrder({ coin, twap_id: parseInt(twapId) });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Transfer USDC to another wallet on Hyperliquid L1
 */
export async function usdTransfer(
  config: HyperliquidConfig,
  destination: string,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ destination, amount }, '[DRY RUN] Would transfer USD');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.usdTransfer(destination, amount);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Transfer spot tokens to another wallet
 */
export async function spotTransfer(
  config: HyperliquidConfig,
  destination: string,
  token: string,
  amount: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ destination, token, amount }, '[DRY RUN] Would transfer spot');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.spotTransfer(destination, token, amount);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Withdraw USDC to L1 (Arbitrum)
 */
export async function withdrawToL1(
  config: HyperliquidConfig,
  destination: string,
  amount: number
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ destination, amount }, '[DRY RUN] Would withdraw to L1');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.initiateWithdrawal(destination, amount);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Approve an agent wallet for API trading
 */
export async function approveAgent(
  config: HyperliquidConfig,
  agentAddress: string,
  agentName?: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ agentAddress, agentName }, '[DRY RUN] Would approve agent');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.approveAgent({ agentAddress, agentName });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Set maximum builder fee rate
 */
export async function approveBuilderFee(
  config: HyperliquidConfig,
  builder: string,
  maxFeeRate: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ builder, maxFeeRate }, '[DRY RUN] Would approve builder fee');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.approveBuilderFee({ builder, maxFeeRate });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Set referrer code
 */
export async function setReferrer(
  config: HyperliquidConfig,
  code: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ code }, '[DRY RUN] Would set referrer');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.setReferrer(code);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Create a subaccount
 */
export async function createSubAccount(
  config: HyperliquidConfig,
  name: string
): Promise<{ success: boolean; subAccountUser?: string; error?: string }> {
  if (config.dryRun) {
    logger.info({ name }, '[DRY RUN] Would create subaccount');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    const result = await sdk.exchange.createSubAccount(name);
    // Result contains the new subaccount address
    return { success: true, subAccountUser: (result as { subAccountUser?: string })?.subAccountUser };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Claim referral rewards
 */
export async function claimRewards(
  config: HyperliquidConfig
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info('[DRY RUN] Would claim rewards');
    return { success: true };
  }

  try {
    const sdk = getSDK(config);
    await sdk.exchange.claimRewards();
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// =============================================================================
// WEBSOCKET CLIENT
// =============================================================================

export class HyperliquidWebSocket extends EventEmitter {
  private sdk: Hyperliquid | null = null;
  private config: HyperliquidConfig | null = null;

  constructor(config?: HyperliquidConfig) {
    super();
    if (config) {
      this.config = config;
    }
  }

  async connect(): Promise<void> {
    try {
      this.sdk = new Hyperliquid({
        enableWs: true,
        privateKey: this.config?.privateKey,
        walletAddress: this.config?.walletAddress,
        testnet: this.config?.testnet || false,
      });

      await this.sdk.connect();
      this.emit('connected');

      // Subscribe to all mids by default
      this.sdk.subscriptions.subscribeToAllMids((data: unknown) => {
        this.emit('prices', data);
      });

    } catch (error) {
      logger.error({ error }, 'Failed to connect Hyperliquid WebSocket');
      this.emit('error', error);
    }
  }

  async subscribeOrderbook(coin: string): Promise<void> {
    if (!this.sdk) return;

    await this.sdk.subscriptions.subscribeToL2Book(coin, (data) => {
      this.emit('orderbook', data);
    });
  }

  async subscribeTrades(coin: string): Promise<void> {
    if (!this.sdk) return;

    await this.sdk.subscriptions.subscribeToTrades(coin, (data) => {
      this.emit('trades', { coin, data });
    });
  }

  async subscribeUser(): Promise<void> {
    if (!this.sdk || !this.config?.walletAddress) return;

    await this.sdk.subscriptions.subscribeToUserFills(this.config.walletAddress, (data) => {
      this.emit('user', data);
    });
  }

  async subscribeOrderUpdates(): Promise<void> {
    if (!this.sdk || !this.config?.walletAddress) return;

    await this.sdk.subscriptions.subscribeToOrderUpdates(this.config.walletAddress, (data) => {
      this.emit('orderUpdates', data);
    });
  }

  async subscribeUserEvents(): Promise<void> {
    if (!this.sdk || !this.config?.walletAddress) return;

    await this.sdk.subscriptions.subscribeToUserEvents(this.config.walletAddress, (data) => {
      this.emit('userEvents', data);
    });
  }

  async subscribeUserFundings(): Promise<void> {
    if (!this.sdk || !this.config?.walletAddress) return;

    await this.sdk.subscriptions.subscribeToUserFundings(this.config.walletAddress, (data) => {
      this.emit('userFundings', data);
    });
  }

  async subscribeCandle(coin: string, interval: string): Promise<void> {
    if (!this.sdk) return;

    await this.sdk.subscriptions.subscribeToCandle(coin, interval, (data) => {
      this.emit('candle', { coin, interval, data });
    });
  }

  async subscribeBbo(coin: string): Promise<void> {
    if (!this.sdk) return;

    await this.sdk.subscriptions.subscribeToBbo(coin, (data) => {
      this.emit('bbo', data);
    });
  }

  async subscribeActiveAssetCtx(coin: string): Promise<void> {
    if (!this.sdk) return;

    await this.sdk.subscriptions.subscribeToActiveAssetCtx(coin, (data) => {
      this.emit('activeAssetCtx', { coin, data });
    });
  }

  async subscribeTwapHistory(): Promise<void> {
    if (!this.sdk || !this.config?.walletAddress) return;

    await this.sdk.subscriptions.subscribeToUserTwapHistory(this.config.walletAddress, (data) => {
      this.emit('twapHistory', data);
    });
  }

  async subscribeTwapSliceFills(): Promise<void> {
    if (!this.sdk || !this.config?.walletAddress) return;

    await this.sdk.subscriptions.subscribeToUserTwapSliceFills(this.config.walletAddress, (data) => {
      this.emit('twapSliceFills', data);
    });
  }

  disconnect(): void {
    if (this.sdk) {
      this.sdk.disconnect();
      this.sdk = null;
    }
    this.emit('disconnected');
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  HLP_VAULT,
  API_URL,
  WS_URL,
};
