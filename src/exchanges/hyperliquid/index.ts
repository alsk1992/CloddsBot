/**
 * Hyperliquid L1 Integration
 *
 * Full support for the dominant perps DEX (69% market share).
 * Includes perps, spot, HLP vault, staking, and points.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Wallet, keccak256, getBytes, Signature } from 'ethers';
import { logger } from '../../utils/logger';

// =============================================================================
// CONSTANTS
// =============================================================================

const API_URL = 'https://api.hyperliquid.xyz';
const WS_URL = 'wss://api.hyperliquid.xyz/ws';

// HLP Vault address
const HLP_VAULT = '0x010461C14e146ac35fE42271BDC1134EE31C703B';

// =============================================================================
// TYPES
// =============================================================================

export interface HyperliquidConfig {
  walletAddress: string;
  privateKey: string;
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
    tokens: [number, number]; // [base, quote] indices
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
  levels: [OrderbookLevel[], OrderbookLevel[]]; // [bids, asks]
  time: number;
}

export interface SpotBalance {
  coin: string;
  hold: string;
  total: string;
  entryNtl: string;
}

export interface VaultInfo {
  vaultAddress: string;
  name: string;
  leader: string;
  tvl: number;
  apr: number;
  maxDrawdown: number;
  followerCount: number;
  isClosed: boolean;
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

// =============================================================================
// SIGNING
// =============================================================================

function signL1Action(action: unknown, nonce: number, privateKey: string, vaultAddress?: string): { r: string; s: string; v: number } {
  const wallet = new Wallet(privateKey);

  // Hyperliquid L1 uses a specific signing scheme
  const connectionId = vaultAddress
    ? keccak256(getBytes(vaultAddress.toLowerCase()))
    : '0x0000000000000000000000000000000000000000000000000000000000000000';

  // Phantom agent for signing
  const source = vaultAddress ? 'b' : 'a';

  // Create action hash
  const actionBytes = Buffer.from(JSON.stringify(action));
  const actionHash = keccak256(actionBytes);

  // Create nonce bytes (big-endian)
  const nonceBytes = Buffer.alloc(8);
  nonceBytes.writeBigUInt64BE(BigInt(nonce));

  // Combine for signing
  const toSign = Buffer.concat([
    Buffer.from(actionHash.slice(2), 'hex'),
    nonceBytes,
    Buffer.from([source === 'a' ? 0 : 1]),
  ]);

  const messageHash = keccak256(toSign);
  const sig = wallet.signingKey.sign(messageHash);

  return {
    r: sig.r,
    s: sig.s,
    v: sig.v,
  };
}

// =============================================================================
// HTTP CLIENT
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

/**
 * Get perp market metadata
 */
export async function getPerpMeta(): Promise<PerpMeta> {
  return httpRequest('/info', { type: 'meta' });
}

/**
 * Get spot market metadata
 */
export async function getSpotMeta(): Promise<SpotMeta> {
  return httpRequest('/info', { type: 'spotMeta' });
}

/**
 * Get all mid prices
 */
export async function getAllMids(): Promise<Record<string, string>> {
  return httpRequest('/info', { type: 'allMids' });
}

/**
 * Get orderbook for a coin
 */
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

/**
 * Get spot orderbook
 */
export async function getSpotOrderbook(coin: string): Promise<Orderbook> {
  const data = await httpRequest<{ levels: [[string, string, number][], [string, string, number][]] }>('/info', {
    type: 'l2Book',
    coin,
    nSigFigs: 5,
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

/**
 * Get funding rates
 */
export async function getFundingRates(): Promise<Array<{ coin: string; funding: string; premium: string; openInterest: string }>> {
  const meta = await getPerpMeta();
  const data = await httpRequest<Array<{ funding: string; premium: string; openInterest: string }>>('/info', {
    type: 'metaAndAssetCtxs',
  });

  // Second element is the asset contexts
  const contexts = (data as unknown as [PerpMeta, Array<{ funding: string; premium: string; openInterest: string }>])[1];

  return meta.universe.map((asset, i) => ({
    coin: asset.name,
    funding: contexts[i]?.funding || '0',
    premium: contexts[i]?.premium || '0',
    openInterest: contexts[i]?.openInterest || '0',
  }));
}

/**
 * Get HLP vault stats
 */
export async function getHlpStats(): Promise<HlpStats> {
  const vaultInfo = await httpRequest<{
    portfolio: Array<Array<{ coin: string; szi: string; entryPx: string }>>;
    vaultEquity: string;
    apr: number;
    dayPnl: string;
  }>('/info', {
    type: 'vaultDetails',
    vaultAddress: HLP_VAULT,
  });

  // Get additional stats
  const summary = await httpRequest<{ volume24h?: string }>('/info', {
    type: 'globalStats',
  });

  return {
    tvl: parseFloat(vaultInfo.vaultEquity),
    apr24h: vaultInfo.apr,
    apr7d: vaultInfo.apr, // API doesn't separate these
    apr30d: vaultInfo.apr,
    volume24h: parseFloat(summary.volume24h || '0'),
    pnl24h: parseFloat(vaultInfo.dayPnl),
  };
}

/**
 * Get leaderboard
 */
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

// =============================================================================
// USER ENDPOINTS (Auth Required)
// =============================================================================

/**
 * Get user state (positions, balances)
 */
export async function getUserState(userAddress: string): Promise<{
  marginSummary: { accountValue: string; totalMarginUsed: string };
  crossMarginSummary: { accountValue: string };
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

/**
 * Get spot balances
 */
export async function getSpotBalances(userAddress: string): Promise<SpotBalance[]> {
  const data = await httpRequest<{ balances: SpotBalance[] }>('/info', {
    type: 'spotClearinghouseState',
    user: userAddress,
  });
  return data.balances;
}

/**
 * Get user fills
 */
export async function getUserFills(userAddress: string, limit = 100): Promise<UserFills[]> {
  return httpRequest('/info', {
    type: 'userFills',
    user: userAddress,
    aggregateByTime: false,
  });
}

/**
 * Get open orders
 */
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

/**
 * Get user points
 */
export async function getUserPoints(userAddress: string): Promise<PointsData> {
  try {
    const data = await httpRequest<{
      total: string;
      daily: string;
      rank: number;
      breakdown?: {
        trading?: string;
        referrals?: string;
        hlp?: string;
        staking?: string;
      };
    }>('/info', {
      type: 'userPoints',
      user: userAddress,
    });

    return {
      total: parseFloat(data.total || '0'),
      daily: parseFloat(data.daily || '0'),
      rank: data.rank || 0,
      breakdown: {
        trading: parseFloat(data.breakdown?.trading || '0'),
        referrals: parseFloat(data.breakdown?.referrals || '0'),
        hlp: parseFloat(data.breakdown?.hlp || '0'),
        staking: parseFloat(data.breakdown?.staking || '0'),
      },
    };
  } catch {
    // Points endpoint might not be available
    return {
      total: 0,
      daily: 0,
      rank: 0,
      breakdown: { trading: 0, referrals: 0, hlp: 0, staking: 0 },
    };
  }
}

/**
 * Get referral state
 */
export async function getReferralState(userAddress: string): Promise<{
  code: string;
  referredBy: string | null;
  referralCount: number;
  totalRebates: number;
}> {
  const data = await httpRequest<{
    referrerState?: { code: string };
    referredBy?: string;
    cumVlm: string;
    unclaimedRewards: string;
  }>('/info', {
    type: 'referral',
    user: userAddress,
  });

  return {
    code: data.referrerState?.code || '',
    referredBy: data.referredBy || null,
    referralCount: 0, // Not directly available
    totalRebates: parseFloat(data.unclaimedRewards || '0'),
  };
}

// =============================================================================
// TRADING ACTIONS
// =============================================================================

/**
 * Place spot order
 */
export async function placeSpotOrder(
  config: HyperliquidConfig,
  order: SpotOrder
): Promise<{ success: boolean; orderId?: number; error?: string }> {
  if (config.dryRun) {
    logger.info({ order }, '[DRY RUN] Would place Hyperliquid spot order');
    return { success: true, orderId: Date.now() };
  }

  const spotMeta = await getSpotMeta();
  const market = spotMeta.universe.find(m => m.name === order.coin);
  if (!market) {
    return { success: false, error: `Unknown spot market: ${order.coin}` };
  }

  const nonce = Date.now();
  const orderWire = {
    a: market.index,
    b: order.side === 'BUY',
    p: String(order.price),
    s: String(order.size),
    r: order.reduceOnly || false,
    t: order.type === 'LIMIT'
      ? { limit: { tif: order.postOnly ? 'Alo' : 'Gtc' } }
      : { limit: { tif: 'Ioc' } },
    c: order.clientOrderId || undefined,
  };

  const action = {
    type: 'order',
    orders: [orderWire],
    grouping: 'na',
    isSpot: true,
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    const result = await httpRequest<{
      status: string;
      response?: {
        data?: {
          statuses: Array<{ resting?: { oid: number }; filled?: { oid: number }; error?: string }>;
        };
      };
    }>('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });

    const status = result.response?.data?.statuses?.[0];
    if (status?.error) {
      return { success: false, error: status.error };
    }

    const orderId = status?.resting?.oid || status?.filled?.oid;
    return { success: true, orderId };
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
    logger.info({ order }, '[DRY RUN] Would place Hyperliquid TWAP order');
    return { success: true, twapId: `twap-${Date.now()}` };
  }

  const perpMeta = await getPerpMeta();
  const asset = perpMeta.universe.find(a => a.name === order.coin);
  if (!asset) {
    return { success: false, error: `Unknown asset: ${order.coin}` };
  }

  const assetIndex = perpMeta.universe.indexOf(asset);
  const nonce = Date.now();

  const action = {
    type: 'twapOrder',
    twap: {
      a: assetIndex,
      b: order.side === 'BUY',
      s: String(order.size),
      r: order.reduceOnly || false,
      m: order.durationMinutes,
      t: order.randomize !== false,
    },
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    const result = await httpRequest<{
      status: string;
      response?: { data?: { running?: { id: string } } };
    }>('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });

    const twapId = result.response?.data?.running?.id;
    return { success: !!twapId, twapId };
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
  twapId: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    return { success: true };
  }

  const nonce = Date.now();
  const action = { type: 'twapCancel', a: parseInt(twapId) };
  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    await httpRequest('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });
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

  const nonce = Date.now();
  const action = {
    type: 'vaultTransfer',
    vaultAddress: HLP_VAULT,
    usd: String(amount),
    isDeposit: true,
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    await httpRequest('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });
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

  const nonce = Date.now();
  const action = {
    type: 'vaultTransfer',
    vaultAddress: HLP_VAULT,
    usd: String(amount),
    isDeposit: false,
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    await httpRequest('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// =============================================================================
// ADDITIONAL INFO ENDPOINTS
// =============================================================================

/**
 * Get candle/OHLCV data
 */
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

/**
 * Get order status by order ID or client order ID
 */
export async function getOrderStatus(
  userAddress: string,
  oid?: number,
  cloid?: string
): Promise<{
  status: 'open' | 'filled' | 'canceled' | 'rejected';
  filledSz: string;
  avgPx: string;
} | null> {
  const data = await httpRequest<{
    status: string;
    order?: {
      order: { origSz: string; limitPx: string };
      status: string;
      statusTimestamp: number;
    };
  }>('/info', {
    type: 'orderStatus',
    user: userAddress,
    oid,
    cloid,
  });

  if (!data.order) return null;

  return {
    status: data.order.status as 'open' | 'filled' | 'canceled' | 'rejected',
    filledSz: data.order.order.origSz,
    avgPx: data.order.order.limitPx,
  };
}

/**
 * Get user rate limit status
 */
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

/**
 * Get historical orders
 */
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

/**
 * Get sub-accounts
 */
export async function getSubAccounts(userAddress: string): Promise<Array<{
  name: string;
  subAccountUser: string;
  master: string;
  clearinghouseState: unknown;
}>> {
  return httpRequest('/info', {
    type: 'subAccounts',
    user: userAddress,
  });
}

/**
 * Get user fee schedule
 */
export async function getUserFees(userAddress: string): Promise<{
  makerRate: number;
  takerRate: number;
  volume30d: number;
  vipTier: number;
}> {
  const data = await httpRequest<{
    userCrossRate: string;
    userAddRate: string;
    activeReferralDiscount: string;
    trial30dVolume?: string;
  }>('/info', {
    type: 'userFees',
    user: userAddress,
  });

  return {
    makerRate: parseFloat(data.userAddRate),
    takerRate: parseFloat(data.userCrossRate),
    volume30d: parseFloat(data.trial30dVolume || '0'),
    vipTier: 0, // Derived from volume
  };
}

/**
 * Get borrow/lend user state (HIP-2)
 */
export async function getBorrowLendState(userAddress: string): Promise<{
  deposits: Array<{ token: string; amount: string; apy: string }>;
  borrows: Array<{ token: string; amount: string; apy: string }>;
  healthFactor: number;
}> {
  const data = await httpRequest<{
    deposits: Array<{ token: string; amount: string; apy: string }>;
    borrows: Array<{ token: string; amount: string; apy: string }>;
    marginRatio?: string;
  }>('/info', {
    type: 'borrowLendUserState',
    user: userAddress,
  });

  return {
    deposits: data.deposits || [],
    borrows: data.borrows || [],
    healthFactor: data.marginRatio ? parseFloat(data.marginRatio) : 999,
  };
}

/**
 * Get all borrow/lend reserve states
 */
export async function getAllBorrowLendReserves(): Promise<Array<{
  token: string;
  totalDeposits: string;
  totalBorrows: string;
  depositApy: string;
  borrowApy: string;
  utilizationRate: string;
}>> {
  return httpRequest('/info', {
    type: 'allBorrowLendReserveStates',
  });
}

// =============================================================================
// ADDITIONAL EXCHANGE ACTIONS
// =============================================================================

/**
 * Modify an existing order
 */
export async function modifyOrder(
  config: HyperliquidConfig,
  oid: number,
  coin: string,
  newPrice: number,
  newSize: number,
  isBuy: boolean
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ oid, newPrice, newSize }, '[DRY RUN] Would modify order');
    return { success: true };
  }

  const perpMeta = await getPerpMeta();
  const asset = perpMeta.universe.find(a => a.name === coin);
  if (!asset) {
    return { success: false, error: `Unknown asset: ${coin}` };
  }

  const assetIndex = perpMeta.universe.indexOf(asset);
  const nonce = Date.now();

  const action = {
    type: 'modify',
    oid,
    order: {
      a: assetIndex,
      b: isBuy,
      p: String(newPrice),
      s: String(newSize),
      r: false,
      t: { limit: { tif: 'Gtc' } },
    },
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    await httpRequest('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Cancel order by client order ID
 */
export async function cancelByCloid(
  config: HyperliquidConfig,
  coin: string,
  cloid: string
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ coin, cloid }, '[DRY RUN] Would cancel order by cloid');
    return { success: true };
  }

  const perpMeta = await getPerpMeta();
  const asset = perpMeta.universe.find(a => a.name === coin);
  if (!asset) {
    return { success: false, error: `Unknown asset: ${coin}` };
  }

  const assetIndex = perpMeta.universe.indexOf(asset);
  const nonce = Date.now();

  const action = {
    type: 'cancelByCloid',
    cancels: [{ asset: assetIndex, cloid }],
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    await httpRequest('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Update leverage for a coin
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

  const perpMeta = await getPerpMeta();
  const asset = perpMeta.universe.find(a => a.name === coin);
  if (!asset) {
    return { success: false, error: `Unknown asset: ${coin}` };
  }

  const assetIndex = perpMeta.universe.indexOf(asset);
  const nonce = Date.now();

  const action = {
    type: 'updateLeverage',
    asset: assetIndex,
    isCross,
    leverage,
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    await httpRequest('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Update isolated margin for a position
 */
export async function updateIsolatedMargin(
  config: HyperliquidConfig,
  coin: string,
  amount: number // positive to add, negative to remove
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ coin, amount }, '[DRY RUN] Would update isolated margin');
    return { success: true };
  }

  const perpMeta = await getPerpMeta();
  const asset = perpMeta.universe.find(a => a.name === coin);
  if (!asset) {
    return { success: false, error: `Unknown asset: ${coin}` };
  }

  const assetIndex = perpMeta.universe.indexOf(asset);
  const nonce = Date.now();

  const action = {
    type: 'updateIsolatedMargin',
    asset: assetIndex,
    isBuy: true, // Direction of position
    ntli: Math.round(amount * 1e6), // Convert to integer
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    await httpRequest('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Schedule cancel all orders (dead man's switch)
 * Set time to null to disable
 */
export async function scheduleCancel(
  config: HyperliquidConfig,
  timeMs: number | null
): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info({ timeMs }, '[DRY RUN] Would schedule cancel');
    return { success: true };
  }

  const nonce = Date.now();
  const action = {
    type: 'scheduleCancel',
    time: timeMs,
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    await httpRequest('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Cancel order by order ID
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

  const perpMeta = await getPerpMeta();
  const asset = perpMeta.universe.find(a => a.name === coin);
  if (!asset) {
    return { success: false, error: `Unknown asset: ${coin}` };
  }

  const assetIndex = perpMeta.universe.indexOf(asset);
  const nonce = Date.now();

  const action = {
    type: 'cancel',
    cancels: [{ a: assetIndex, o: oid }],
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    await httpRequest('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Place perp order (limit or market)
 */
export async function placePerpOrder(
  config: HyperliquidConfig,
  order: {
    coin: string;
    side: 'BUY' | 'SELL';
    size: number;
    price?: number;
    type?: 'LIMIT' | 'MARKET';
    reduceOnly?: boolean;
    postOnly?: boolean;
    clientOrderId?: string;
  }
): Promise<{ success: boolean; orderId?: number; error?: string }> {
  if (config.dryRun) {
    logger.info({ order }, '[DRY RUN] Would place Hyperliquid perp order');
    return { success: true, orderId: Date.now() };
  }

  const perpMeta = await getPerpMeta();
  const asset = perpMeta.universe.find(a => a.name === order.coin);
  if (!asset) {
    return { success: false, error: `Unknown asset: ${order.coin}` };
  }

  const assetIndex = perpMeta.universe.indexOf(asset);
  const nonce = Date.now();

  // Get price for market orders
  let price = order.price;
  if (!price || order.type === 'MARKET') {
    const mids = await getAllMids();
    const mid = parseFloat(mids[order.coin] || '0');
    price = order.side === 'BUY' ? mid * 1.01 : mid * 0.99;
  }

  const tif = order.type === 'MARKET' ? 'Ioc' : order.postOnly ? 'Alo' : 'Gtc';

  const orderWire = {
    a: assetIndex,
    b: order.side === 'BUY',
    p: String(price),
    s: String(order.size),
    r: order.reduceOnly || false,
    t: { limit: { tif } },
    c: order.clientOrderId,
  };

  const action = {
    type: 'order',
    orders: [orderWire],
    grouping: 'na',
  };

  const signature = signL1Action(action, nonce, config.privateKey);

  try {
    const result = await httpRequest<{
      status: string;
      response?: {
        data?: {
          statuses: Array<{ resting?: { oid: number }; filled?: { oid: number }; error?: string }>;
        };
      };
    }>('/exchange', {
      action,
      nonce,
      signature: { r: signature.r, s: signature.s, v: signature.v },
      vaultAddress: null,
    });

    const status = result.response?.data?.statuses?.[0];
    if (status?.error) {
      return { success: false, error: status.error };
    }

    const orderId = status?.resting?.oid || status?.filled?.oid;
    return { success: true, orderId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// =============================================================================
// WEBSOCKET CLIENT
// =============================================================================

export class HyperliquidWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private subscriptions: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(private userAddress?: string) {
    super();
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {
      logger.info('Hyperliquid WebSocket connected');
      this.reconnectAttempts = 0;
      this.emit('connected');

      // Resubscribe
      for (const sub of this.subscriptions) {
        this.ws?.send(sub);
      }

      // Start ping
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ method: 'ping' }));
        }
      }, 30000);
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.channel === 'l2Book') {
          this.emit('orderbook', msg.data);
        } else if (msg.channel === 'trades') {
          this.emit('trades', msg.data);
        } else if (msg.channel === 'user') {
          this.emit('user', msg.data);
        } else if (msg.channel === 'allMids') {
          this.emit('prices', msg.data);
        }
      } catch (error) {
        logger.debug({ error }, 'Failed to parse WebSocket message');
      }
    });

    this.ws.on('close', () => {
      logger.info('Hyperliquid WebSocket closed');
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      logger.error({ error }, 'Hyperliquid WebSocket error');
      this.emit('error', error);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    setTimeout(() => this.connect(), delay);
  }

  subscribeOrderbook(coin: string): void {
    const msg = JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'l2Book', coin },
    });
    this.subscriptions.add(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    }
  }

  subscribeTrades(coin: string): void {
    const msg = JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'trades', coin },
    });
    this.subscriptions.add(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    }
  }

  subscribeAllMids(): void {
    const msg = JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'allMids' },
    });
    this.subscriptions.add(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    }
  }

  subscribeUser(): void {
    if (!this.userAddress) return;

    const msg = JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'user', user: this.userAddress },
    });
    this.subscriptions.add(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    }
  }

  disconnect(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.subscriptions.clear();
    this.ws?.close();
    this.ws = null;
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
