/**
 * Opinion.trade Exchange Integration
 *
 * Full trading support using the unofficial-opinion-clob-sdk.
 * BNB Chain prediction market with on-chain CLOB.
 */

import {
  Client,
  OrderSide,
  OrderType,
  safeAmountToWei,
  weiToAmount,
  type ClientConfig,
  type PlaceOrderDataInput,
  type Market as OpinionMarket,
  type Order as OpinionOrder,
  type Position as OpinionPosition,
  type Balance as OpinionBalance,
  type Trade as OpinionTrade,
  type Orderbook,
} from 'unofficial-opinion-clob-sdk';
import { logger } from '../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface OpinionConfig {
  apiKey: string;
  privateKey: string;
  vaultAddress: string;
  rpcUrl?: string;
  chainId?: number;
  dryRun?: boolean;
}

export interface OpinionOrderResult {
  success: boolean;
  orderId?: string;
  status?: string;
  error?: string;
  txHash?: string;
}

export interface OpinionPositionInfo {
  marketId: number;
  marketTitle: string;
  outcome: string;
  sharesOwned: string;
  sharesFrozen: string;
  avgEntryPrice: string;
  currentValue: string;
  unrealizedPnl: string;
  unrealizedPnlPercent: string;
  tokenId: string;
}

export interface OpinionBalanceInfo {
  walletAddress: string;
  multiSigAddress: string;
  balances: Array<{
    symbol: string;
    totalBalance: string;
    availableBalance: string;
    frozenBalance: string;
  }>;
}

export interface OpinionOrderInfo {
  orderId: string;
  marketId: number;
  marketTitle: string;
  side: 'BUY' | 'SELL';
  outcome: string;
  price: string;
  orderShares: string;
  filledShares: string;
  status: string;
  createdAt: number;
}

export interface OpinionTradeInfo {
  tradeNo: string;
  txHash: string;
  marketId: number;
  marketTitle: string;
  side: string;
  outcome: string;
  price: string;
  shares: string;
  amount: string;
  fee: string;
  profit: string;
  createdAt: number;
}

// =============================================================================
// CLIENT MANAGEMENT
// =============================================================================

let client: Client | null = null;
let currentConfig: OpinionConfig | null = null;

const DEFAULT_RPC_URL = 'https://bsc-dataseed.binance.org/';
const DEFAULT_HOST = 'https://proxy.opinion.trade:8443';
const QUOTE_DECIMALS = 6; // USDC/USDT decimals

function getClient(config: OpinionConfig): Client {
  // Check if we can reuse existing client
  if (
    client &&
    currentConfig?.apiKey === config.apiKey &&
    currentConfig?.privateKey === config.privateKey &&
    currentConfig?.vaultAddress === config.vaultAddress
  ) {
    return client;
  }

  const clientConfig: ClientConfig = {
    host: DEFAULT_HOST,
    apiKey: config.apiKey,
    rpcUrl: config.rpcUrl || DEFAULT_RPC_URL,
    privateKey: config.privateKey as `0x${string}`,
    vaultAddress: config.vaultAddress as `0x${string}`,
    chainId: config.chainId || 56,
  };

  client = new Client(clientConfig);
  currentConfig = config;

  logger.info({ vaultAddress: config.vaultAddress }, 'Opinion client initialized');
  return client;
}

// =============================================================================
// MARKET DATA
// =============================================================================

export async function getMarkets(
  config: OpinionConfig,
  options?: { page?: number; limit?: number; status?: string }
): Promise<OpinionMarket[]> {
  const c = getClient(config);
  const result = await c.getMarkets({
    page: options?.page || 1,
    limit: options?.limit || 50,
    status: options?.status || 'activated',
  });
  return result.list;
}

export async function getMarket(config: OpinionConfig, marketId: number): Promise<OpinionMarket | null> {
  const c = getClient(config);
  try {
    return await c.getMarket(marketId);
  } catch {
    return null;
  }
}

export async function getOrderbook(config: OpinionConfig, tokenId: string): Promise<Orderbook | null> {
  const c = getClient(config);
  try {
    return await c.getOrderbook(tokenId);
  } catch {
    return null;
  }
}

export async function getLatestPrice(config: OpinionConfig, tokenId: string): Promise<number | null> {
  const c = getClient(config);
  try {
    const result = await c.getLatestPrice(tokenId);
    return parseFloat(result.price);
  } catch {
    return null;
  }
}

export async function getPriceHistory(
  config: OpinionConfig,
  tokenId: string,
  interval?: string,
  startAt?: number
): Promise<Array<{ timestamp: number; price: number }>> {
  const c = getClient(config);
  try {
    const history = await c.getPriceHistory({
      tokenId,
      interval: interval || '1h',
      startAt,
    });
    return history.map(p => ({
      timestamp: p.t,
      price: parseFloat(p.p),
    }));
  } catch {
    return [];
  }
}

export async function getFeeRates(
  config: OpinionConfig,
  tokenId: string
): Promise<{ takerFeeBps: number; makerFeeBps: number } | null> {
  const c = getClient(config);
  try {
    const rates = await c.getFeeRates(tokenId);
    return {
      takerFeeBps: parseInt(rates.takerFeeBps),
      makerFeeBps: parseInt(rates.makerFeeBps),
    };
  } catch {
    return null;
  }
}

// =============================================================================
// ACCOUNT DATA
// =============================================================================

export async function getBalances(config: OpinionConfig): Promise<OpinionBalanceInfo[]> {
  const c = getClient(config);
  const balances = await c.getMyBalances();

  return balances.map(b => ({
    walletAddress: b.walletAddress,
    multiSigAddress: b.multiSignAddress,
    balances: b.balances.map(tb => ({
      symbol: 'USDC', // Opinion uses USDC
      totalBalance: weiToAmount(BigInt(tb.totalBalance), tb.tokenDecimals),
      availableBalance: weiToAmount(BigInt(tb.availableBalance), tb.tokenDecimals),
      frozenBalance: weiToAmount(BigInt(tb.frozenBalance), tb.tokenDecimals),
    })),
  }));
}

export async function getPositions(
  config: OpinionConfig,
  marketId?: number
): Promise<OpinionPositionInfo[]> {
  const c = getClient(config);
  const result = await c.getMyPositions({
    marketId,
    page: 1,
    limit: 100,
  });

  return result.list.map(p => ({
    marketId: p.marketId,
    marketTitle: p.marketTitle,
    outcome: p.outcome,
    sharesOwned: p.sharesOwned,
    sharesFrozen: p.sharesFrozen,
    avgEntryPrice: p.avgEntryPrice,
    currentValue: p.currentValueInQuoteToken,
    unrealizedPnl: p.unrealizedPnl,
    unrealizedPnlPercent: p.unrealizedPnlPercent,
    tokenId: p.tokenId,
  }));
}

export async function getOpenOrders(
  config: OpinionConfig,
  marketId?: number
): Promise<OpinionOrderInfo[]> {
  const c = getClient(config);
  const result = await c.getMyOrders({
    marketId,
    status: '1', // pending/open orders
    page: 1,
    limit: 100,
  });

  return result.list.map(o => ({
    orderId: o.orderId,
    marketId: o.marketId,
    marketTitle: o.marketTitle,
    side: o.sideEnum === 'BUY' ? 'BUY' : 'SELL',
    outcome: o.outcome,
    price: o.price,
    orderShares: o.orderShares,
    filledShares: o.filledShares,
    status: o.statusEnum,
    createdAt: o.createdAt,
  }));
}

export async function getOrderById(config: OpinionConfig, orderId: string): Promise<OpinionOrderInfo | null> {
  const c = getClient(config);
  try {
    const o = await c.getOrderById(orderId);
    return {
      orderId: o.orderId,
      marketId: o.marketId,
      marketTitle: o.marketTitle,
      side: o.sideEnum === 'BUY' ? 'BUY' : 'SELL',
      outcome: o.outcome,
      price: o.price,
      orderShares: o.orderShares,
      filledShares: o.filledShares,
      status: o.statusEnum,
      createdAt: o.createdAt,
    };
  } catch {
    return null;
  }
}

export async function getTrades(
  config: OpinionConfig,
  marketId?: number
): Promise<OpinionTradeInfo[]> {
  const c = getClient(config);
  const result = await c.getMyTrades({
    marketId,
    page: 1,
    limit: 100,
  });

  return result.list.map(t => ({
    tradeNo: t.tradeNo,
    txHash: t.txHash,
    marketId: t.marketId,
    marketTitle: t.marketTitle,
    side: t.side,
    outcome: t.outcome,
    price: t.price,
    shares: t.shares,
    amount: t.amount,
    fee: String(t.fee),
    profit: t.profit,
    createdAt: t.createdAt,
  }));
}

// =============================================================================
// TRADING
// =============================================================================

export async function enableTrading(config: OpinionConfig): Promise<{ success: boolean; txHashes: string[] }> {
  if (config.dryRun) {
    logger.info('[DRY RUN] Enable trading');
    return { success: true, txHashes: ['0xdryrun'] };
  }

  const c = getClient(config);
  try {
    const results = await c.enableTrading();
    const txHashes = results.map(r => r.txHash);
    logger.info({ txHashes }, 'Trading enabled');
    return { success: true, txHashes };
  } catch (error) {
    logger.error({ error }, 'Failed to enable trading');
    return { success: false, txHashes: [] };
  }
}

export async function placeOrder(
  config: OpinionConfig,
  marketId: number,
  tokenId: string,
  side: 'BUY' | 'SELL',
  price: number,
  amount: number,
  orderType: 'LIMIT' | 'MARKET' = 'LIMIT'
): Promise<OpinionOrderResult> {
  if (config.dryRun) {
    logger.info({ marketId, tokenId, side, price, amount, orderType }, '[DRY RUN] Place order');
    return {
      success: true,
      orderId: `dry-${Date.now()}`,
      status: 'DRY_RUN',
    };
  }

  const c = getClient(config);

  const orderData: PlaceOrderDataInput = {
    marketId,
    tokenId,
    price: price.toString(),
    side: side === 'BUY' ? OrderSide.BUY : OrderSide.SELL,
    orderType: orderType === 'MARKET' ? OrderType.MARKET_ORDER : OrderType.LIMIT_ORDER,
  };

  // For BUY orders, specify amount in quote token (USDC)
  // For SELL orders, specify amount in base token (outcome shares)
  if (side === 'BUY') {
    orderData.makerAmountInQuoteToken = amount.toString();
  } else {
    orderData.makerAmountInBaseToken = amount.toString();
  }

  try {
    const result = await c.placeOrder(orderData, true);
    logger.info({ marketId, tokenId, side, price, amount, result }, 'Order placed');
    return {
      success: true,
      orderId: result?.orderId || result?.id,
      status: 'open',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, marketId, tokenId, side }, 'Failed to place order');
    return {
      success: false,
      error: message,
    };
  }
}

export async function cancelOrder(config: OpinionConfig, orderId: string): Promise<boolean> {
  if (config.dryRun) {
    logger.info({ orderId }, '[DRY RUN] Cancel order');
    return true;
  }

  const c = getClient(config);
  try {
    await c.cancelOrder(orderId);
    logger.info({ orderId }, 'Order cancelled');
    return true;
  } catch (error) {
    logger.error({ error, orderId }, 'Failed to cancel order');
    return false;
  }
}

export async function cancelAllOrders(
  config: OpinionConfig,
  marketId?: number,
  side?: 'BUY' | 'SELL'
): Promise<{ cancelled: number; failed: number }> {
  if (config.dryRun) {
    logger.info({ marketId, side }, '[DRY RUN] Cancel all orders');
    return { cancelled: 0, failed: 0 };
  }

  const c = getClient(config);
  try {
    const result = await c.cancelAllOrders({
      marketId,
      side: side === 'BUY' ? OrderSide.BUY : side === 'SELL' ? OrderSide.SELL : undefined,
    });
    logger.info({ cancelled: result.cancelled, failed: result.failed }, 'Orders cancelled');
    return { cancelled: result.cancelled, failed: result.failed };
  } catch (error) {
    logger.error({ error }, 'Failed to cancel all orders');
    return { cancelled: 0, failed: 0 };
  }
}

export async function placeOrdersBatch(
  config: OpinionConfig,
  orders: Array<{
    marketId: number;
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    amount: number;
  }>
): Promise<OpinionOrderResult[]> {
  if (config.dryRun) {
    logger.info({ count: orders.length }, '[DRY RUN] Batch place orders');
    return orders.map((_, i) => ({
      success: true,
      orderId: `dry-batch-${i}-${Date.now()}`,
      status: 'DRY_RUN',
    }));
  }

  const c = getClient(config);
  const orderInputs: PlaceOrderDataInput[] = orders.map(o => ({
    marketId: o.marketId,
    tokenId: o.tokenId,
    price: o.price.toString(),
    side: o.side === 'BUY' ? OrderSide.BUY : OrderSide.SELL,
    orderType: OrderType.LIMIT_ORDER,
    makerAmountInQuoteToken: o.side === 'BUY' ? o.amount.toString() : undefined,
    makerAmountInBaseToken: o.side === 'SELL' ? o.amount.toString() : undefined,
  }));

  try {
    const results = await c.placeOrdersBatch(orderInputs, true);
    return results.map(r => ({
      success: !r?.error,
      orderId: r?.orderId || r?.id,
      status: r?.error ? 'failed' : 'open',
      error: r?.error,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return orders.map(() => ({
      success: false,
      error: message,
    }));
  }
}

export async function cancelOrdersBatch(
  config: OpinionConfig,
  orderIds: string[]
): Promise<Array<{ orderId: string; success: boolean }>> {
  if (config.dryRun) {
    logger.info({ count: orderIds.length }, '[DRY RUN] Batch cancel orders');
    return orderIds.map(orderId => ({ orderId, success: true }));
  }

  const c = getClient(config);
  try {
    const results = await c.cancelOrdersBatch(orderIds);
    return orderIds.map((orderId, i) => ({
      orderId,
      success: !results[i]?.error,
    }));
  } catch (error) {
    return orderIds.map(orderId => ({ orderId, success: false }));
  }
}

// =============================================================================
// TOKEN OPERATIONS
// =============================================================================

export async function split(
  config: OpinionConfig,
  marketId: number,
  amount: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (config.dryRun) {
    logger.info({ marketId, amount }, '[DRY RUN] Split');
    return { success: true, txHash: '0xdryrun' };
  }

  const c = getClient(config);
  try {
    const amountWei = safeAmountToWei(amount, QUOTE_DECIMALS);
    const result = await c.split(marketId, amountWei, true);
    logger.info({ marketId, amount, txHash: result.txHash }, 'Split completed');
    return { success: true, txHash: result.txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, marketId, amount }, 'Split failed');
    return { success: false, error: message };
  }
}

export async function merge(
  config: OpinionConfig,
  marketId: number,
  amount: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (config.dryRun) {
    logger.info({ marketId, amount }, '[DRY RUN] Merge');
    return { success: true, txHash: '0xdryrun' };
  }

  const c = getClient(config);
  try {
    const amountWei = safeAmountToWei(amount, QUOTE_DECIMALS);
    const result = await c.merge(marketId, amountWei, true);
    logger.info({ marketId, amount, txHash: result.txHash }, 'Merge completed');
    return { success: true, txHash: result.txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, marketId, amount }, 'Merge failed');
    return { success: false, error: message };
  }
}

export async function redeem(
  config: OpinionConfig,
  marketId: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (config.dryRun) {
    logger.info({ marketId }, '[DRY RUN] Redeem');
    return { success: true, txHash: '0xdryrun' };
  }

  const c = getClient(config);
  try {
    const result = await c.redeem(marketId, true);
    logger.info({ marketId, txHash: result.txHash }, 'Redeem completed');
    return { success: true, txHash: result.txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, marketId }, 'Redeem failed');
    return { success: false, error: message };
  }
}

// =============================================================================
// HELPER EXPORTS
// =============================================================================

export { OrderSide, OrderType, safeAmountToWei, weiToAmount };
