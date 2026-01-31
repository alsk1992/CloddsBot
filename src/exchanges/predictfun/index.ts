/**
 * Predict.fun Exchange Integration
 *
 * Full trading support using the official @predictdotfun/sdk.
 * BNB Chain prediction market with on-chain CLOB.
 */

import { Wallet, JsonRpcProvider, parseEther, formatEther } from 'ethers';
import { OrderBuilder, ChainId, Side } from '@predictdotfun/sdk';
import { logger } from '../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface PredictFunConfig {
  privateKey: string;
  predictAccount?: string; // Smart wallet/deposit address
  rpcUrl?: string;
  apiKey?: string;
  dryRun?: boolean;
}

export interface PredictFunOrderResult {
  success: boolean;
  orderId?: string;
  orderHash?: string;
  status?: string;
  error?: string;
  txHash?: string;
}

export interface PredictFunPosition {
  marketId: string;
  marketTitle: string;
  outcome: string;
  tokenId: string;
  shares: string;
  avgEntryPrice: string;
  currentPrice: string;
  unrealizedPnl: string;
  conditionId: string;
  indexSet: string;
  isNegRisk: boolean;
  isYieldBearing: boolean;
}

export interface PredictFunOrder {
  orderHash: string;
  marketId: string;
  side: 'BUY' | 'SELL';
  price: string;
  size: string;
  filled: string;
  status: string;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  createdAt: number;
}

export interface PredictFunBalance {
  usdtBalance: string;
  usdtBalanceWei: string;
}

// =============================================================================
// CLIENT MANAGEMENT
// =============================================================================

const DEFAULT_RPC_URL = 'https://bsc-dataseed.binance.org/';
const API_BASE = 'https://api.predict.fun/v1';

let orderBuilder: OrderBuilder | null = null;
let currentConfig: PredictFunConfig | null = null;

async function getOrderBuilder(config: PredictFunConfig): Promise<OrderBuilder> {
  // Check if we can reuse existing builder
  if (
    orderBuilder &&
    currentConfig?.privateKey === config.privateKey &&
    currentConfig?.predictAccount === config.predictAccount
  ) {
    return orderBuilder;
  }

  const provider = new JsonRpcProvider(config.rpcUrl || DEFAULT_RPC_URL);
  const signer = new Wallet(config.privateKey, provider);

  const options = config.predictAccount
    ? { predictAccount: config.predictAccount as `0x${string}` }
    : undefined;

  orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer, options);
  currentConfig = config;

  logger.info({ address: signer.address }, 'Predict.fun OrderBuilder initialized');
  return orderBuilder;
}

function getApiHeaders(config: PredictFunConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['x-api-key'] = config.apiKey;
  }
  return headers;
}

// =============================================================================
// MARKET DATA (API-based, no wallet needed)
// =============================================================================

export async function getMarkets(
  config: PredictFunConfig,
  options?: { first?: number; after?: string; status?: string }
): Promise<unknown[]> {
  const params = new URLSearchParams();
  if (options?.first) params.append('first', String(options.first));
  if (options?.after) params.append('after', options.after);
  if (options?.status) params.append('status', options.status);

  const response = await fetch(`${API_BASE}/markets?${params}`, {
    headers: getApiHeaders(config),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json() as { success: boolean; data?: unknown[] };
  return data.data || [];
}

export async function getMarket(config: PredictFunConfig, marketId: string): Promise<unknown | null> {
  const response = await fetch(`${API_BASE}/markets/${marketId}`, {
    headers: getApiHeaders(config),
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json() as { success: boolean; data?: unknown };
  return data.data || null;
}

export async function getOrderbook(config: PredictFunConfig, marketId: string): Promise<unknown | null> {
  const response = await fetch(`${API_BASE}/markets/${marketId}/orderbook`, {
    headers: getApiHeaders(config),
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json() as { success: boolean; data?: unknown };
  return data.data || null;
}

// =============================================================================
// ACCOUNT DATA
// =============================================================================

export async function getBalance(config: PredictFunConfig): Promise<PredictFunBalance> {
  const builder = await getOrderBuilder(config);
  const balanceWei = await builder.balanceOf();

  return {
    usdtBalance: formatEther(balanceWei),
    usdtBalanceWei: balanceWei.toString(),
  };
}

export async function getOpenOrders(config: PredictFunConfig): Promise<PredictFunOrder[]> {
  const response = await fetch(`${API_BASE}/orders`, {
    headers: getApiHeaders(config),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json() as {
    success: boolean;
    data?: Array<{
      hash: string;
      marketId: string;
      side: number;
      price: string;
      size: string;
      filledSize: string;
      status: string;
      isNegRisk: boolean;
      isYieldBearing: boolean;
      createdAt: number;
    }>;
  };

  return (data.data || []).map(o => ({
    orderHash: o.hash,
    marketId: o.marketId,
    side: o.side === 0 ? 'BUY' : 'SELL',
    price: o.price,
    size: o.size,
    filled: o.filledSize,
    status: o.status,
    isNegRisk: o.isNegRisk,
    isYieldBearing: o.isYieldBearing,
    createdAt: o.createdAt,
  }));
}

export async function getPositions(config: PredictFunConfig): Promise<PredictFunPosition[]> {
  const response = await fetch(`${API_BASE}/positions`, {
    headers: getApiHeaders(config),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json() as {
    success: boolean;
    data?: Array<{
      marketId: string;
      marketTitle: string;
      outcome: string;
      tokenId: string;
      shares: string;
      avgEntryPrice: string;
      currentPrice: string;
      unrealizedPnl: string;
      conditionId: string;
      indexSet: string;
      isNegRisk: boolean;
      isYieldBearing: boolean;
    }>;
  };

  return (data.data || []).map(p => ({
    marketId: p.marketId,
    marketTitle: p.marketTitle,
    outcome: p.outcome,
    tokenId: p.tokenId,
    shares: p.shares,
    avgEntryPrice: p.avgEntryPrice,
    currentPrice: p.currentPrice,
    unrealizedPnl: p.unrealizedPnl,
    conditionId: p.conditionId,
    indexSet: p.indexSet,
    isNegRisk: p.isNegRisk,
    isYieldBearing: p.isYieldBearing,
  }));
}

// =============================================================================
// TRADING
// =============================================================================

export async function setApprovals(config: PredictFunConfig): Promise<{ success: boolean; error?: string }> {
  if (config.dryRun) {
    logger.info('[DRY RUN] Set approvals');
    return { success: true };
  }

  const builder = await getOrderBuilder(config);
  try {
    const result = await builder.setApprovals();
    if (!result.success) {
      return { success: false, error: 'Failed to set approvals' };
    }
    logger.info('Predict.fun approvals set');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Failed to set approvals');
    return { success: false, error: message };
  }
}

export async function createOrder(
  config: PredictFunConfig,
  params: {
    marketId: string;
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    quantity: number;
    feeRateBps?: number;
    isNegRisk?: boolean;
    isYieldBearing?: boolean;
  }
): Promise<PredictFunOrderResult> {
  if (config.dryRun) {
    logger.info(params, '[DRY RUN] Create order');
    return {
      success: true,
      orderId: `dry-${Date.now()}`,
      status: 'DRY_RUN',
    };
  }

  const builder = await getOrderBuilder(config);
  const signer = new Wallet(config.privateKey);
  const maker = config.predictAccount || signer.address;

  try {
    // Calculate amounts using SDK helper
    const pricePerShareWei = parseEther(params.price.toString());
    const quantityWei = parseEther(params.quantity.toString());

    const { makerAmount, takerAmount, pricePerShare } = builder.getLimitOrderAmounts({
      side: params.side === 'BUY' ? Side.BUY : Side.SELL,
      pricePerShareWei,
      quantityWei,
    });

    // Build the order
    const order = builder.buildOrder('LIMIT', {
      maker: maker as `0x${string}`,
      signer: maker as `0x${string}`,
      side: params.side === 'BUY' ? Side.BUY : Side.SELL,
      tokenId: params.tokenId,
      makerAmount,
      takerAmount,
      nonce: 0n,
      feeRateBps: params.feeRateBps || 0,
    });

    // Build typed data and sign
    const typedData = builder.buildTypedData(order, {
      isNegRisk: params.isNegRisk ?? false,
      isYieldBearing: params.isYieldBearing ?? true,
    });

    const signedOrder = await builder.signTypedDataOrder(typedData);
    const hash = builder.buildTypedDataHash(typedData);

    // Submit to API
    const response = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: getApiHeaders(config),
      body: JSON.stringify({
        data: {
          order: { ...signedOrder, hash },
          pricePerShare,
          strategy: 'LIMIT',
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json() as { message?: string };
      throw new Error(errorData.message || `API error: ${response.status}`);
    }

    logger.info({ hash, ...params }, 'Predict.fun order created');
    return {
      success: true,
      orderHash: hash,
      status: 'open',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, ...params }, 'Failed to create order');
    return {
      success: false,
      error: message,
    };
  }
}

export async function cancelOrders(
  config: PredictFunConfig,
  orderHashes: string[],
  options: { isNegRisk: boolean; isYieldBearing: boolean }
): Promise<{ success: boolean; cancelled: number; error?: string }> {
  if (config.dryRun) {
    logger.info({ count: orderHashes.length }, '[DRY RUN] Cancel orders');
    return { success: true, cancelled: orderHashes.length };
  }

  if (orderHashes.length === 0) {
    return { success: true, cancelled: 0 };
  }

  const builder = await getOrderBuilder(config);

  // Fetch full orders from API to get the order objects
  const ordersResponse = await fetch(`${API_BASE}/orders`, {
    headers: getApiHeaders(config),
  });

  if (!ordersResponse.ok) {
    return { success: false, cancelled: 0, error: 'Failed to fetch orders' };
  }

  const ordersData = await ordersResponse.json() as {
    success: boolean;
    data?: Array<{ hash: string; order: Record<string, unknown>; isNegRisk: boolean; isYieldBearing: boolean }>;
  };

  const ordersToCancel = (ordersData.data || [])
    .filter(o => orderHashes.includes(o.hash))
    .filter(o => o.isNegRisk === options.isNegRisk && o.isYieldBearing === options.isYieldBearing)
    .map(o => o.order);

  if (ordersToCancel.length === 0) {
    return { success: true, cancelled: 0 };
  }

  try {
    // Cast to the SDK's Order type - the API returns compatible order objects
    const result = await builder.cancelOrders(ordersToCancel as unknown as Parameters<typeof builder.cancelOrders>[0], options);
    if (!result.success) {
      return { success: false, cancelled: 0, error: 'Cancel transaction failed' };
    }
    logger.info({ cancelled: ordersToCancel.length }, 'Predict.fun orders cancelled');
    return { success: true, cancelled: ordersToCancel.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Failed to cancel orders');
    return { success: false, cancelled: 0, error: message };
  }
}

export async function cancelAllOrders(
  config: PredictFunConfig
): Promise<{ success: boolean; cancelled: number; error?: string }> {
  // Fetch all open orders
  const orders = await getOpenOrders(config);

  if (orders.length === 0) {
    return { success: true, cancelled: 0 };
  }

  // Group orders by type
  const groups = {
    regular: orders.filter(o => !o.isNegRisk && !o.isYieldBearing).map(o => o.orderHash),
    negRisk: orders.filter(o => o.isNegRisk && !o.isYieldBearing).map(o => o.orderHash),
    regularYield: orders.filter(o => !o.isNegRisk && o.isYieldBearing).map(o => o.orderHash),
    negRiskYield: orders.filter(o => o.isNegRisk && o.isYieldBearing).map(o => o.orderHash),
  };

  let totalCancelled = 0;
  const errors: string[] = [];

  // Cancel each group
  if (groups.regular.length > 0) {
    const result = await cancelOrders(config, groups.regular, { isNegRisk: false, isYieldBearing: false });
    totalCancelled += result.cancelled;
    if (result.error) errors.push(result.error);
  }

  if (groups.negRisk.length > 0) {
    const result = await cancelOrders(config, groups.negRisk, { isNegRisk: true, isYieldBearing: false });
    totalCancelled += result.cancelled;
    if (result.error) errors.push(result.error);
  }

  if (groups.regularYield.length > 0) {
    const result = await cancelOrders(config, groups.regularYield, { isNegRisk: false, isYieldBearing: true });
    totalCancelled += result.cancelled;
    if (result.error) errors.push(result.error);
  }

  if (groups.negRiskYield.length > 0) {
    const result = await cancelOrders(config, groups.negRiskYield, { isNegRisk: true, isYieldBearing: true });
    totalCancelled += result.cancelled;
    if (result.error) errors.push(result.error);
  }

  return {
    success: errors.length === 0,
    cancelled: totalCancelled,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

// =============================================================================
// TOKEN OPERATIONS
// =============================================================================

export async function redeemPositions(
  config: PredictFunConfig,
  conditionId: string,
  indexSet: 1 | 2,
  options: { isNegRisk: boolean; isYieldBearing: boolean; amount?: bigint }
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (config.dryRun) {
    logger.info({ conditionId, indexSet }, '[DRY RUN] Redeem positions');
    return { success: true, txHash: '0xdryrun' };
  }

  const builder = await getOrderBuilder(config);

  try {
    const redeemOptions: {
      conditionId: string;
      indexSet: 1 | 2;
      isNegRisk: boolean;
      isYieldBearing: boolean;
      amount?: bigint;
    } = {
      conditionId,
      indexSet,
      isNegRisk: options.isNegRisk,
      isYieldBearing: options.isYieldBearing,
    };

    if (options.amount) {
      redeemOptions.amount = options.amount;
    }

    const result = await builder.redeemPositions(redeemOptions);

    if (!result.success) {
      const errorMsg = result.cause instanceof Error ? result.cause.message : (result.cause || 'Redemption failed');
      return { success: false, error: errorMsg };
    }

    logger.info({ conditionId, txHash: result.receipt?.hash }, 'Positions redeemed');
    return { success: true, txHash: result.receipt?.hash };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, conditionId }, 'Failed to redeem positions');
    return { success: false, error: message };
  }
}

export async function mergePositions(
  config: PredictFunConfig,
  conditionId: string,
  amount: number,
  options: { isNegRisk: boolean; isYieldBearing: boolean }
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (config.dryRun) {
    logger.info({ conditionId, amount }, '[DRY RUN] Merge positions');
    return { success: true, txHash: '0xdryrun' };
  }

  const builder = await getOrderBuilder(config);

  try {
    const amountWei = parseEther(amount.toString());
    const result = await builder.mergePositions({
      conditionId,
      amount: amountWei,
      isNegRisk: options.isNegRisk,
      isYieldBearing: options.isYieldBearing,
    });

    if (!result.success) {
      const errorMsg = result.cause instanceof Error ? result.cause.message : (result.cause || 'Merge failed');
      return { success: false, error: errorMsg };
    }

    logger.info({ conditionId, amount, txHash: result.receipt?.hash }, 'Positions merged');
    return { success: true, txHash: result.receipt?.hash };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, conditionId }, 'Failed to merge positions');
    return { success: false, error: message };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { Side, ChainId };
