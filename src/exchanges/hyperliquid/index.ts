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
