import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { signAndSendVersionedTransaction } from './wallet';

// ===== LEGACY TYPES (for backward compatibility) =====

export interface RaydiumSwapParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: 'BaseIn' | 'BaseOut';
  txVersion?: 'V0' | 'LEGACY';
  computeUnitPriceMicroLamports?: number;
}

export interface RaydiumSwapResult {
  signature: string;
  routeSummary?: unknown;
  inputAmount?: string;
  outputAmount?: string;
  txId?: string;
}

/** Legacy pool info shape for backward compatibility */
export interface RaydiumPoolInfo {
  id?: string;
  name?: string;
  baseMint: string;
  quoteMint: string;
  lpMint?: string;
  marketId?: string;
  type?: string;
  liquidity?: number;
  volume24h?: number;
  address?: string;
}

export interface RaydiumQuote {
  outAmount?: string;
  minOutAmount?: string;
  priceImpact?: number;
  raw?: unknown;
}

// ===== NEW TYPES =====

export interface ClmmPositionInfo {
  nftMint: string;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  tokenA: string;
  tokenB: string;
  feeOwedA?: string;
  feeOwedB?: string;
  rewardInfos?: Array<{
    mint: string;
    amountOwed: string;
  }>;
}

export interface CreateClmmPositionParams {
  poolId: string;
  priceLower: number;
  priceUpper: number;
  baseAmount: string;
  baseIn?: boolean;
  slippage?: number;
}

export interface CreateClmmPositionResult {
  signature: string;
  nftMint: string;
}

export interface IncreaseLiquidityParams {
  poolId: string;
  positionNftMint: string;
  amountA?: string;
  amountB?: string;
  slippage?: number;
}

export interface DecreaseLiquidityParams {
  poolId: string;
  positionNftMint: string;
  liquidity?: string;
  percentBps?: number;
  closePosition?: boolean;
  slippage?: number;
}

export interface AmmLiquidityParams {
  poolId: string;
  amountA?: string;
  amountB?: string;
  fixedSide?: 'a' | 'b';
  slippage?: number;
}

export interface AmmWithdrawParams {
  poolId: string;
  lpAmount: string;
  slippage?: number;
}

export interface CreateClmmPoolParams {
  mintA: string;
  mintB: string;
  initialPrice: number;
  configIndex?: number;
}

export interface RaydiumPoolInfoV2 {
  id: string;
  type: 'CLMM' | 'AMM' | 'CPMM';
  mintA: string;
  mintB: string;
  symbolA?: string;
  symbolB?: string;
  price?: number;
  tvl?: number;
  volume24h?: number;
  feeRate?: number;
  lpMint?: string;
}

// ===== LEGACY REST API FUNCTIONS (backward compatible) =====

export async function executeRaydiumSwap(
  connection: Connection,
  keypair: Keypair,
  params: RaydiumSwapParams
): Promise<RaydiumSwapResult> {
  const baseUrl = process.env.RAYDIUM_SWAP_BASE_URL || 'https://transaction-v1.raydium.io';
  const slippageBps = params.slippageBps ?? 50;
  const swapMode = params.swapMode ?? 'BaseIn';
  const txVersion = params.txVersion ?? 'V0';

  const computeUrl = new URL(`${baseUrl}/compute/swap-base-${swapMode === 'BaseOut' ? 'out' : 'in'}`);
  computeUrl.searchParams.set('inputMint', params.inputMint);
  computeUrl.searchParams.set('outputMint', params.outputMint);
  // Verified against a live call: the API expects the amount under the single
  // name "amount" for both swap-base-in and swap-base-out — "inputAmount"/
  // "outputAmount" both return {success:false, msg:"REQ_AMOUNT_ERROR"}.
  computeUrl.searchParams.set('amount', params.amount);
  computeUrl.searchParams.set('slippageBps', slippageBps.toString());
  computeUrl.searchParams.set('txVersion', txVersion);
  if (params.computeUnitPriceMicroLamports !== undefined) {
    computeUrl.searchParams.set('computeUnitPriceMicroLamports', params.computeUnitPriceMicroLamports.toString());
  }

  const computeResponse = await fetch(computeUrl.toString());
  if (!computeResponse.ok) {
    throw new Error(`Raydium compute error: ${computeResponse.status}`);
  }

  const computeJson = await computeResponse.json() as any;
  const routeSummary = computeJson?.data;
  if (!routeSummary) {
    throw new Error('Raydium compute response missing data');
  }

  const txResponse = await fetch(`${baseUrl}/transaction/swap-base-${swapMode === 'BaseOut' ? 'out' : 'in'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      wallet: keypair.publicKey.toBase58(),
      computeUnitPriceMicroLamports: params.computeUnitPriceMicroLamports,
      swapResponse: routeSummary,
      txVersion,
    }),
  });

  if (!txResponse.ok) {
    throw new Error(`Raydium swap error: ${txResponse.status}`);
  }

  const txJson = await txResponse.json() as any;
  const txData = txJson?.data?.[0]?.transaction || txJson?.data?.transaction || txJson?.transaction;
  if (!txData) {
    throw new Error('Raydium swap response missing transaction');
  }

  const txBytes = Buffer.from(txData, 'base64');
  const signature = await signAndSendVersionedTransaction(connection, keypair, new Uint8Array(txBytes));

  return { signature, routeSummary };
}

export async function getRaydiumQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: 'BaseIn' | 'BaseOut';
}): Promise<RaydiumQuote> {
  const baseUrl = process.env.RAYDIUM_SWAP_BASE_URL || 'https://transaction-v1.raydium.io';
  const slippageBps = params.slippageBps ?? 50;
  const swapMode = params.swapMode ?? 'BaseIn';

  const computeUrl = new URL(`${baseUrl}/compute/swap-base-${swapMode === 'BaseOut' ? 'out' : 'in'}`);
  computeUrl.searchParams.set('inputMint', params.inputMint);
  computeUrl.searchParams.set('outputMint', params.outputMint);
  // Verified against a live call: the API expects the amount under the single
  // name "amount" for both swap-base-in and swap-base-out — "inputAmount"/
  // "outputAmount" both return {success:false, msg:"REQ_AMOUNT_ERROR"}.
  computeUrl.searchParams.set('amount', params.amount);
  computeUrl.searchParams.set('slippageBps', slippageBps.toString());
  computeUrl.searchParams.set('txVersion', 'V0');

  const response = await fetch(computeUrl.toString());
  if (!response.ok) {
    throw new Error(`Raydium compute error: ${response.status}`);
  }

  const data = await response.json() as any;
  if (data?.success === false) {
    throw new Error(`Raydium compute error: ${data?.msg ?? 'unknown error'}`);
  }
  const summary = data?.data ?? data;

  // Verified against a live call to transaction-v1.raydium.io/compute/swap-base-in:
  // the response uses outputAmount/otherAmountThreshold/priceImpactPct, not the
  // outAmount/minOutAmount/priceImpact names this used to read (which were always
  // undefined, silently zeroing every Raydium quote).
  return {
    outAmount: summary?.outputAmount?.toString?.() ?? summary?.outputAmount,
    minOutAmount: summary?.otherAmountThreshold?.toString?.() ?? summary?.otherAmountThreshold,
    priceImpact: summary?.priceImpactPct !== undefined ? Number(summary.priceImpactPct) : undefined,
    raw: summary,
  };
}

export async function listRaydiumPools(filters?: {
  tokenMints?: string[];
  limit?: number;
}): Promise<RaydiumPoolInfo[]> {
  // The old endpoint (api.raydium.io/v2/sdk/liquidity/mainnet.json) is a
  // multi-hundred-megabyte bulk dump of every pool ever created — a live call
  // to it throws "Cannot create a string longer than 0x1fffffe8 characters"
  // (V8's max string length) before it even reaches JSON.parse. Replaced with
  // the current, paginated api-v3.raydium.io API, verified against a live call.
  const baseUrl = process.env.RAYDIUM_POOL_LIST_URL || 'https://api-v3.raydium.io/pools/info';
  const tokenMints = filters?.tokenMints || [];
  const limit = filters?.limit && filters.limit > 0 ? filters.limit : 50;
  const pageSize = Math.min(Math.max(limit, 1), 1000);

  // /pools/info/mint requires at least one mint; with none given, list the
  // highest-liquidity pools overall via /pools/info/list instead.
  const url = tokenMints.length > 0
    ? new URL(`${baseUrl}/mint`)
    : new URL(`${baseUrl}/list`);
  if (tokenMints[0]) url.searchParams.set('mint1', tokenMints[0]);
  if (tokenMints[1]) url.searchParams.set('mint2', tokenMints[1]);
  url.searchParams.set('poolType', 'all');
  url.searchParams.set('poolSortField', 'liquidity');
  url.searchParams.set('sortType', 'desc');
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('page', '1');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Raydium pool list error: ${response.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as Record<string, any>;
  if (data?.success === false) {
    throw new Error(`Raydium pool list error: ${data?.msg ?? 'unknown error'}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pools: Array<Record<string, any>> = data?.data?.data ?? [];
  const tokenMintsLower = tokenMints.map((m) => m.toLowerCase());

  const results: RaydiumPoolInfo[] = [];
  for (const pool of pools) {
    const baseMint = pool.mintA?.address;
    const quoteMint = pool.mintB?.address;
    if (!baseMint || !quoteMint) continue;

    if (tokenMintsLower.length > 0) {
      const matches = tokenMintsLower.every((mint) =>
        [String(baseMint).toLowerCase(), String(quoteMint).toLowerCase()].includes(mint)
      );
      if (!matches) continue;
    }

    results.push({
      id: pool.id,
      address: pool.id,
      name: pool.mintA?.symbol && pool.mintB?.symbol ? `${pool.mintA.symbol}-${pool.mintB.symbol}` : undefined,
      baseMint: String(baseMint),
      quoteMint: String(quoteMint),
      lpMint: pool.lpMint?.address,
      marketId: pool.marketId,
      type: pool.type,
      liquidity: typeof pool.tvl === 'number' ? pool.tvl : undefined,
      volume24h: typeof pool.day?.volume === 'number' ? pool.day.volume : undefined,
    });

    if (results.length >= limit) break;
  }

  return results;
}

// ===== SDK-BASED FUNCTIONS (new implementation) =====

async function loadSdk() {
  const { Raydium } = await import('@raydium-io/raydium-sdk-v2');
  return Raydium;
}

export async function initRaydiumSdk(
  connection: Connection,
  owner?: Keypair,
  cluster: 'mainnet' | 'devnet' = 'mainnet'
): Promise<any> {
  const Raydium = await loadSdk();
  return Raydium.load({
    connection,
    owner: owner?.publicKey,
    cluster,
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });
}

// ===== POOL QUERIES (SDK) =====

export async function getRaydiumPoolInfoSdk(
  connection: Connection,
  poolId: string
): Promise<RaydiumPoolInfoV2 | null> {
  const raydium = await initRaydiumSdk(connection);

  try {
    const data = await raydium.api.fetchPoolById({ ids: poolId });
    if (!data || data.length === 0) return null;

    const pool = data[0];
    return {
      id: pool.id,
      type: pool.type === 'Concentrated' ? 'CLMM' : pool.type === 'Standard' ? 'AMM' : 'CPMM',
      mintA: pool.mintA?.address || pool.baseMint,
      mintB: pool.mintB?.address || pool.quoteMint,
      symbolA: pool.mintA?.symbol,
      symbolB: pool.mintB?.symbol,
      price: pool.price,
      tvl: pool.tvl,
      volume24h: pool.day?.volume,
      feeRate: pool.feeRate,
      lpMint: pool.lpMint?.address,
    };
  } catch {
    return null;
  }
}

export async function listRaydiumPoolsSdk(
  connection: Connection,
  filters?: {
    type?: 'CLMM' | 'AMM' | 'CPMM' | 'all';
    tokenMint?: string;
    limit?: number;
  }
): Promise<RaydiumPoolInfoV2[]> {
  const raydium = await initRaydiumSdk(connection);

  const poolType = filters?.type === 'CLMM' ? 'concentrated'
    : filters?.type === 'AMM' ? 'standard'
    : filters?.type === 'CPMM' ? 'cpmm'
    : 'all';

  const response = await raydium.api.getPoolList({
    type: poolType,
    sort: 'volume24h',
    order: 'desc',
    pageSize: filters?.limit || 50,
  });

  let pools = response?.data || [];

  if (filters?.tokenMint) {
    const mint = filters.tokenMint.toLowerCase();
    pools = pools.filter((p: any) =>
      p.mintA?.address?.toLowerCase() === mint ||
      p.mintB?.address?.toLowerCase() === mint
    );
  }

  return pools.map((pool: any) => ({
    id: pool.id,
    type: pool.type === 'Concentrated' ? 'CLMM' : pool.type === 'Standard' ? 'AMM' : 'CPMM',
    mintA: pool.mintA?.address,
    mintB: pool.mintB?.address,
    symbolA: pool.mintA?.symbol,
    symbolB: pool.mintB?.symbol,
    price: pool.price,
    tvl: pool.tvl,
    volume24h: pool.day?.volume,
    feeRate: pool.feeRate,
    lpMint: pool.lpMint?.address,
  }));
}

// ===== SWAP OPERATIONS (SDK) =====

export async function executeRaydiumSwapSdk(
  connection: Connection,
  keypair: Keypair,
  params: RaydiumSwapParams
): Promise<RaydiumSwapResult> {
  // For SDK-based swap, we use the REST API approach which is more reliable
  // The SDK's tradeV2.swap has complex requirements (routeProgram, ownerInfo)
  // that require additional setup. Use the REST API for simplicity.
  return executeRaydiumSwap(connection, keypair, params);
}

// ===== CLMM OPERATIONS =====

export async function getClmmPositions(
  connection: Connection,
  keypair: Keypair,
  poolId?: string
): Promise<ClmmPositionInfo[]> {
  const { Raydium, CLMM_PROGRAM_ID } = await import('@raydium-io/raydium-sdk-v2');

  const raydium = await Raydium.load({
    connection,
    owner: keypair,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });

  const positions = await raydium.clmm.getOwnerPositionInfo({ programId: CLMM_PROGRAM_ID });

  let filtered = positions;
  if (poolId) {
    filtered = positions.filter((p: any) => p.poolId.toBase58() === poolId);
  }

  return filtered.map((p: any) => ({
    nftMint: p.nftMint.toBase58(),
    poolId: p.poolId.toBase58(),
    tickLower: p.tickLower,
    tickUpper: p.tickUpper,
    liquidity: p.liquidity.toString(),
    tokenA: p.tokenFeesOwedA?.toString() || '0',
    tokenB: p.tokenFeesOwedB?.toString() || '0',
    feeOwedA: p.feeGrowthInsideLastX64A?.toString(),
    feeOwedB: p.feeGrowthInsideLastX64B?.toString(),
  }));
}

export async function createClmmPosition(
  connection: Connection,
  keypair: Keypair,
  params: CreateClmmPositionParams
): Promise<CreateClmmPositionResult> {
  const { Raydium, TickUtils, PoolUtils, TxVersion } = await import('@raydium-io/raydium-sdk-v2');

  const raydium = await Raydium.load({
    connection,
    owner: keypair,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });

  const data = await raydium.api.fetchPoolById({ ids: params.poolId });
  const poolInfo = data[0] as any;

  const { tick: lowerTick } = TickUtils.getPriceAndTick({
    poolInfo,
    price: new Decimal(params.priceLower),
    baseIn: params.baseIn !== false,
  });

  const { tick: upperTick } = TickUtils.getPriceAndTick({
    poolInfo,
    price: new Decimal(params.priceUpper),
    baseIn: params.baseIn !== false,
  });

  const epochInfo = await raydium.fetchEpochInfo();
  const baseAmount = new BN(params.baseAmount);

  const res = await PoolUtils.getLiquidityAmountOutFromAmountIn({
    poolInfo,
    slippage: 0,
    inputA: params.baseIn !== false,
    tickUpper: Math.max(lowerTick, upperTick),
    tickLower: Math.min(lowerTick, upperTick),
    amount: baseAmount,
    add: true,
    amountHasFee: true,
    epochInfo,
  });

  const slippage = params.slippage ?? 0.01;

  const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
    poolInfo,
    tickUpper: Math.max(lowerTick, upperTick),
    tickLower: Math.min(lowerTick, upperTick),
    base: params.baseIn !== false ? 'MintA' : 'MintB',
    ownerInfo: {
      useSOLBalance: true,
    },
    baseAmount,
    otherAmountMax: new BN(
      new Decimal(res.amountSlippageB.amount.toString()).mul(1 + slippage).toFixed(0)
    ),
    txVersion: TxVersion.V0,
    computeBudgetConfig: {
      units: 600000,
      microLamports: 100000,
    },
  });

  const { txId } = await execute({ sendAndConfirm: true });

  return {
    signature: txId,
    nftMint: extInfo.nftMint.toBase58(),
  };
}

export async function increaseClmmLiquidity(
  connection: Connection,
  keypair: Keypair,
  params: IncreaseLiquidityParams
): Promise<{ signature: string }> {
  const { Raydium, PoolUtils, TxVersion } = await import('@raydium-io/raydium-sdk-v2');

  const raydium = await Raydium.load({
    connection,
    owner: keypair,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });

  const data = await raydium.api.fetchPoolById({ ids: params.poolId });
  const poolInfo = data[0] as any;

  const positions = await raydium.clmm.getOwnerPositionInfo({ programId: new PublicKey(poolInfo.programId) });
  const position = positions.find((p: any) => p.nftMint.toBase58() === params.positionNftMint);

  if (!position) throw new Error(`Position not found: ${params.positionNftMint}`);

  const slippage = params.slippage ?? 0.05;
  const inputAmount = params.amountA || params.amountB || '0';
  const inputA = !!params.amountA;

  const epochInfo = await raydium.fetchEpochInfo();
  const res = await PoolUtils.getLiquidityAmountOutFromAmountIn({
    poolInfo,
    slippage: 0,
    inputA,
    tickUpper: Math.max(position.tickLower, position.tickUpper),
    tickLower: Math.min(position.tickLower, position.tickUpper),
    amount: new BN(inputAmount),
    add: true,
    amountHasFee: true,
    epochInfo,
  });

  const { execute } = await raydium.clmm.increasePositionFromLiquidity({
    poolInfo,
    ownerPosition: position,
    ownerInfo: {
      useSOLBalance: true,
    },
    liquidity: new BN(new Decimal(res.liquidity.toString()).mul(1 - slippage).toFixed(0)),
    amountMaxA: new BN(new Decimal(inputA ? inputAmount : res.amountSlippageA.amount.toString()).mul(1 + slippage).toFixed(0)),
    amountMaxB: new BN(new Decimal(!inputA ? inputAmount : res.amountSlippageB.amount.toString()).mul(1 + slippage).toFixed(0)),
    checkCreateATAOwner: true,
    txVersion: TxVersion.V0,
  });

  const { txId } = await execute({ sendAndConfirm: true });
  return { signature: txId };
}

export async function decreaseClmmLiquidity(
  connection: Connection,
  keypair: Keypair,
  params: DecreaseLiquidityParams
): Promise<{ signature: string; amountA: string; amountB: string }> {
  const { Raydium, TxVersion } = await import('@raydium-io/raydium-sdk-v2');

  const raydium = await Raydium.load({
    connection,
    owner: keypair,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });

  const data = await raydium.api.fetchPoolById({ ids: params.poolId });
  const poolInfo = data[0] as any;

  const positions = await raydium.clmm.getOwnerPositionInfo({ programId: new PublicKey(poolInfo.programId) });
  const position = positions.find((p: any) => p.nftMint.toBase58() === params.positionNftMint);

  if (!position) throw new Error(`Position not found: ${params.positionNftMint}`);

  let liquidityToRemove = position.liquidity;
  if (params.liquidity) {
    liquidityToRemove = new BN(params.liquidity);
  } else if (params.percentBps) {
    liquidityToRemove = position.liquidity.muln(params.percentBps).divn(10000);
  }

  const closePosition = params.closePosition || liquidityToRemove.eq(position.liquidity);
  const slippage = params.slippage ?? 0.02;

  // Compute expected amounts from liquidity removal for slippage protection
  const { PoolUtils } = await import('@raydium-io/raydium-sdk-v2');
  const epochInfo = await raydium.fetchEpochInfo();
  let amountMinA = new BN(0);
  let amountMinB = new BN(0);
  try {
    const res = await PoolUtils.getLiquidityAmountOutFromAmountIn({
      poolInfo,
      slippage: 0,
      inputA: true,
      tickUpper: Math.max(position.tickLower, position.tickUpper),
      tickLower: Math.min(position.tickLower, position.tickUpper),
      amount: new BN(1), // dummy
      add: false,
      amountHasFee: false,
      epochInfo,
    });
    // Use slippage-adjusted minimums instead of zero
    if (res.amountA?.amount) {
      const estA = liquidityToRemove.mul(res.amountA.amount).div(res.liquidity.isZero() ? new BN(1) : res.liquidity);
      amountMinA = new BN(new Decimal(estA.toString()).mul(1 - slippage).toFixed(0));
    }
    if (res.amountB?.amount) {
      const estB = liquidityToRemove.mul(res.amountB.amount).div(res.liquidity.isZero() ? new BN(1) : res.liquidity);
      amountMinB = new BN(new Decimal(estB.toString()).mul(1 - slippage).toFixed(0));
    }
  } catch {
    // Fallback to zero if estimation fails (better to execute than fail)
  }

  const { execute } = await raydium.clmm.decreaseLiquidity({
    poolInfo,
    ownerPosition: position,
    ownerInfo: {
      useSOLBalance: true,
      closePosition,
    },
    liquidity: liquidityToRemove,
    amountMinA,
    amountMinB,
    txVersion: TxVersion.V0,
  });

  const { txId } = await execute({ sendAndConfirm: true });

  return {
    signature: txId,
    amountA: '0',
    amountB: '0',
  };
}

export async function closeClmmPosition(
  connection: Connection,
  keypair: Keypair,
  poolId: string,
  positionNftMint: string
): Promise<{ signature: string }> {
  const { Raydium, TxVersion } = await import('@raydium-io/raydium-sdk-v2');

  const raydium = await Raydium.load({
    connection,
    owner: keypair,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });

  const data = await raydium.api.fetchPoolById({ ids: poolId });
  const poolInfo = data[0] as any;

  const positions = await raydium.clmm.getOwnerPositionInfo({ programId: new PublicKey(poolInfo.programId) });
  const position = positions.find((p: any) => p.nftMint.toBase58() === positionNftMint);

  if (!position) throw new Error(`Position not found: ${positionNftMint}`);

  const { execute } = await raydium.clmm.closePosition({
    poolInfo,
    ownerPosition: position,
    txVersion: TxVersion.V0,
  });

  const { txId } = await execute({ sendAndConfirm: true });
  return { signature: txId };
}

export async function harvestClmmRewards(
  connection: Connection,
  keypair: Keypair,
  poolId?: string
): Promise<{ signatures: string[] }> {
  const { Raydium, CLMM_PROGRAM_ID, TxVersion } = await import('@raydium-io/raydium-sdk-v2');

  const raydium = await Raydium.load({
    connection,
    owner: keypair,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });

  const allPositions = await raydium.clmm.getOwnerPositionInfo({ programId: CLMM_PROGRAM_ID });
  const nonZeroPositions = allPositions.filter((p: any) => !p.liquidity.isZero());

  if (!nonZeroPositions.length) {
    throw new Error('No positions with liquidity found');
  }

  let positionsToHarvest = nonZeroPositions;
  if (poolId) {
    positionsToHarvest = nonZeroPositions.filter((p: any) => p.poolId.toBase58() === poolId);
  }

  const poolIds = [...new Set(positionsToHarvest.map((p: any) => p.poolId.toBase58()))];
  const poolInfoList = await raydium.api.fetchPoolById({ ids: poolIds.join(',') });

  const allPositionsMap = positionsToHarvest.reduce((acc: any, cur: any) => ({
    ...acc,
    [cur.poolId.toBase58()]: acc[cur.poolId.toBase58()] ? acc[cur.poolId.toBase58()].concat(cur) : [cur],
  }), {});

  const { execute } = await raydium.clmm.harvestAllRewards({
    allPoolInfo: poolInfoList.reduce((acc: any, cur: any) => ({
      ...acc,
      [cur.id]: cur,
    }), {}),
    allPositions: allPositionsMap,
    ownerInfo: {
      useSOLBalance: true,
    },
    programId: CLMM_PROGRAM_ID,
    txVersion: TxVersion.V0,
  });

  const { txIds } = await execute({ sequentially: true });
  return { signatures: txIds };
}

// ===== AMM OPERATIONS =====

export async function addAmmLiquidity(
  connection: Connection,
  keypair: Keypair,
  params: AmmLiquidityParams
): Promise<{ signature: string; lpAmount: string }> {
  const { Raydium, TokenAmount, toToken, Percent, TxVersion } = await import('@raydium-io/raydium-sdk-v2');

  const raydium = await Raydium.load({
    connection,
    owner: keypair,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });

  const data = await raydium.api.fetchPoolById({ ids: params.poolId });
  const poolInfo = data[0] as any;

  const inputAmount = params.amountA || params.amountB || '0';
  const baseIn = !!params.amountA;
  const slippage = params.slippage ?? 0.01;

  const pairAmount = raydium.liquidity.computePairAmount({
    poolInfo,
    amount: new Decimal(inputAmount).div(10 ** (baseIn ? poolInfo.mintA.decimals : poolInfo.mintB.decimals)).toString(),
    baseIn,
    slippage: new Percent(Math.floor(slippage * 100), 100),
  });

  const { execute } = await raydium.liquidity.addLiquidity({
    poolInfo,
    amountInA: new TokenAmount(
      toToken(poolInfo.mintA),
      baseIn ? inputAmount : new Decimal(pairAmount.maxAnotherAmount.toExact()).mul(10 ** poolInfo.mintA.decimals).toFixed(0)
    ),
    amountInB: new TokenAmount(
      toToken(poolInfo.mintB),
      !baseIn ? inputAmount : new Decimal(pairAmount.maxAnotherAmount.toExact()).mul(10 ** poolInfo.mintB.decimals).toFixed(0)
    ),
    otherAmountMin: pairAmount.minAnotherAmount,
    fixedSide: params.fixedSide || (baseIn ? 'a' : 'b'),
    txVersion: TxVersion.V0,
  });

  const { txId } = await execute({ sendAndConfirm: true });

  return {
    signature: txId,
    lpAmount: '0',
  };
}

export async function removeAmmLiquidity(
  connection: Connection,
  keypair: Keypair,
  params: AmmWithdrawParams
): Promise<{ signature: string; amountA: string; amountB: string }> {
  const { Raydium, TxVersion } = await import('@raydium-io/raydium-sdk-v2');

  const raydium = await Raydium.load({
    connection,
    owner: keypair,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });

  const data = await raydium.api.fetchPoolById({ ids: params.poolId });
  const poolInfo = data[0] as any;

  const lpAmount = new BN(params.lpAmount);
  const slippage = params.slippage ?? 0.1;

  const lpMintDecimals = poolInfo.lpMint?.decimals ?? 9;
  const mintAmountA = poolInfo.mintAmountA ?? poolInfo.baseReserve ?? 0;
  const mintAmountB = poolInfo.mintAmountB ?? poolInfo.quoteReserve ?? 0;
  const lpTotalAmount = poolInfo.lpAmount || poolInfo.lpSupply;
  if (!lpTotalAmount || Number(lpTotalAmount) === 0) {
    throw new Error('Cannot remove liquidity: LP total supply is zero');
  }

  const [baseRatio, quoteRatio] = [
    new Decimal(mintAmountA).div(lpTotalAmount),
    new Decimal(mintAmountB).div(lpTotalAmount),
  ];

  const withdrawAmountDe = new Decimal(lpAmount.toString()).div(10 ** lpMintDecimals);
  const [withdrawAmountA, withdrawAmountB] = [
    withdrawAmountDe.mul(baseRatio).mul(10 ** poolInfo.mintA.decimals),
    withdrawAmountDe.mul(quoteRatio).mul(10 ** poolInfo.mintB.decimals),
  ];

  const { execute } = await raydium.liquidity.removeLiquidity({
    poolInfo,
    lpAmount,
    baseAmountMin: new BN(withdrawAmountA.mul(1 - slippage).toFixed(0)),
    quoteAmountMin: new BN(withdrawAmountB.mul(1 - slippage).toFixed(0)),
    txVersion: TxVersion.V0,
  });

  const { txId } = await execute({ sendAndConfirm: true });

  return {
    signature: txId,
    amountA: withdrawAmountA.toFixed(0),
    amountB: withdrawAmountB.toFixed(0),
  };
}

// ===== CLMM SWAP (DIRECT) =====

export async function swapClmm(
  connection: Connection,
  keypair: Keypair,
  params: {
    poolId: string;
    inputMint: string;
    amountIn: string;
    slippage?: number;
  }
): Promise<RaydiumSwapResult> {
  const { Raydium, PoolUtils, TxVersion } = await import('@raydium-io/raydium-sdk-v2');

  const raydium = await Raydium.load({
    connection,
    owner: keypair,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });

  const data = await raydium.api.fetchPoolById({ ids: params.poolId });
  const poolInfo = data[0] as any;

  const clmmPoolInfo = await PoolUtils.fetchComputeClmmInfo({
    connection,
    poolInfo,
  });

  const tickCache = await PoolUtils.fetchMultiplePoolTickArrays({
    connection,
    poolKeys: [clmmPoolInfo],
  });

  const baseIn = params.inputMint === poolInfo.mintA.address;
  const inputAmount = new BN(params.amountIn);
  const slippage = params.slippage ?? 0.01;

  const { minAmountOut, remainingAccounts } = await PoolUtils.computeAmountOutFormat({
    poolInfo: clmmPoolInfo,
    tickArrayCache: tickCache[params.poolId],
    amountIn: inputAmount,
    tokenOut: poolInfo[baseIn ? 'mintB' : 'mintA'],
    slippage,
    epochInfo: await raydium.fetchEpochInfo(),
  });

  const { execute } = await raydium.clmm.swap({
    poolInfo,
    inputMint: params.inputMint,
    amountIn: inputAmount,
    amountOutMin: minAmountOut.amount.raw,
    observationId: clmmPoolInfo.observationId,
    ownerInfo: {
      useSOLBalance: true,
    },
    remainingAccounts,
    txVersion: TxVersion.V0,
  });

  const { txId } = await execute({ sendAndConfirm: true });

  return {
    signature: txId,
    txId,
    inputAmount: params.amountIn,
    outputAmount: minAmountOut.amount.raw.toString(),
  };
}

// ===== CREATE CLMM POOL =====

export async function createClmmPool(
  connection: Connection,
  keypair: Keypair,
  params: CreateClmmPoolParams
): Promise<{ signature: string; poolId: string }> {
  const { Raydium, CLMM_PROGRAM_ID, TxVersion } = await import('@raydium-io/raydium-sdk-v2');

  const raydium = await Raydium.load({
    connection,
    owner: keypair,
    cluster: 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'finalized',
  });

  // Load token info
  const mint1 = await raydium.token.getTokenInfo(params.mintA);
  const mint2 = await raydium.token.getTokenInfo(params.mintB);

  const clmmConfigs = await raydium.api.getClmmConfigs();
  const configIndex = params.configIndex ?? 0;
  const config = clmmConfigs[configIndex];

  const { execute, extInfo } = await raydium.clmm.createPool({
    programId: CLMM_PROGRAM_ID,
    mint1,
    mint2,
    ammConfig: {
      ...config,
      id: new PublicKey(config.id),
      fundOwner: '',
      description: '',
    },
    initialPrice: new Decimal(params.initialPrice),
    txVersion: TxVersion.V0,
  });

  const { txId } = await execute({ sendAndConfirm: true });

  // extInfo.address is ClmmKeys object - try to get pool ID from it
  let poolIdStr = '';
  if (extInfo?.address) {
    const addr = extInfo.address as any;
    poolIdStr = addr.poolId?.toBase58?.() || addr.id?.toBase58?.() || '';
  }

  return {
    signature: txId,
    poolId: poolIdStr,
  };
}

// ===== GET CLMM CONFIGS =====

export async function getClmmConfigs(
  connection: Connection
): Promise<Array<{ id: string; index: number; tickSpacing: number; tradeFeeRate: number }>> {
  const raydium = await initRaydiumSdk(connection);
  const configs = await raydium.api.getClmmConfigs();

  return configs.map((c: any) => ({
    id: c.id,
    index: c.index,
    tickSpacing: c.tickSpacing,
    tradeFeeRate: c.tradeFeeRate,
  }));
}
