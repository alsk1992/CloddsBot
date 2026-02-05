import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { u64 } from '@solana/spl-token';
import { signAndSendTransaction } from './wallet';

// ============================================
// SWAP INTERFACES
// ============================================

export interface OrcaWhirlpoolSwapParams {
  poolAddress: string;
  inputMint: string;
  amount: string;
  slippageBps?: number;
}

export interface OrcaWhirlpoolSwapResult {
  signature: string;
  poolAddress: string;
  inputAmount?: string;
  outputAmount?: string;
  txId?: string;
}

export interface OrcaWhirlpoolPoolInfo {
  address: string;
  tokenMintA: string;
  tokenMintB: string;
  stable: boolean;
  price?: number;
  tvl?: number;
  volume24h?: number;
  liquidity?: number;
  tickSpacing?: number;
}

export interface OrcaWhirlpoolQuote {
  amountOut: string;
  amountIn: string;
  otherAmountThreshold: string;
  outAmount?: string;
}

// ============================================
// POSITION INTERFACES
// ============================================

export interface OrcaPositionInfo {
  address: string;
  whirlpool: string;
  tickLowerIndex: number;
  tickUpperIndex: number;
  liquidity: string;
  feeOwedA: string;
  feeOwedB: string;
  rewardOwed0?: string;
  rewardOwed1?: string;
  rewardOwed2?: string;
}

export interface OrcaOpenPositionParams {
  poolAddress: string;
  tickLowerIndex?: number;
  tickUpperIndex?: number;
  tokenAmountA: string;
  tokenAmountB?: string;
  slippageBps?: number;
}

export interface OrcaOpenPositionResult {
  signature: string;
  positionAddress: string;
  positionMint: string;
}

export interface OrcaLiquidityParams {
  positionAddress: string;
  tokenAmountA?: string;
  tokenAmountB?: string;
  liquidityAmount?: string;
  slippageBps?: number;
}

export interface OrcaLiquidityResult {
  signature: string;
  positionAddress: string;
  liquidityDelta?: string;
}

export interface OrcaHarvestResult {
  signature: string;
  positionAddress: string;
  feesCollectedA?: string;
  feesCollectedB?: string;
  rewardsCollected?: string[];
}

export interface OrcaClosePositionResult {
  signature: string;
  positionAddress: string;
  rentReclaimed?: string;
}

// ============================================
// POOL CREATION INTERFACES
// ============================================

export interface OrcaCreatePoolParams {
  tokenMintA: string;
  tokenMintB: string;
  tickSpacing?: number;
  initialPrice?: number;
  feeTierBps?: number;
}

export interface OrcaCreatePoolResult {
  signature: string;
  poolAddress: string;
  tokenMintA: string;
  tokenMintB: string;
}

export async function executeOrcaWhirlpoolSwap(
  connection: Connection,
  keypair: Keypair,
  params: OrcaWhirlpoolSwapParams
): Promise<OrcaWhirlpoolSwapResult> {
  const sdk = await import('@orca-so/whirlpool-sdk') as any;
  const anchor = await import('@project-serum/anchor');

  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const orca = new sdk.OrcaWhirlpoolClient({ connection, network: sdk.OrcaNetwork.MAINNET });

  const swapQuote = await orca.pool.getSwapQuote({
    poolAddress: params.poolAddress,
    tokenMint: params.inputMint,
    tokenAmount: new u64(params.amount),
    isInput: true,
    slippageTolerance: sdk.Percentage.fromFraction(params.slippageBps ?? 50, 10_000),
    refresh: true,
  });

  const swapTx = await orca.pool.getSwapTx({
    provider,
    quote: swapQuote,
  });

  const signatures = await swapTx.buildAndExecute();
  const signature = signatures[0];

  return { signature, poolAddress: params.poolAddress };
}

export async function getOrcaWhirlpoolQuote(params: {
  poolAddress: string;
  inputMint: string;
  amount: string;
  slippageBps?: number;
}): Promise<OrcaWhirlpoolQuote> {
  const sdk = await import('@orca-so/whirlpool-sdk') as any;
  const orca = new sdk.OrcaWhirlpoolClient({ network: sdk.OrcaNetwork.MAINNET });

  const swapQuote = await orca.pool.getSwapQuote({
    poolAddress: params.poolAddress,
    tokenMint: params.inputMint,
    tokenAmount: new u64(params.amount),
    isInput: true,
    slippageTolerance: sdk.Percentage.fromFraction(params.slippageBps ?? 50, 10_000),
    refresh: true,
  });

  return {
    amountOut: swapQuote.amountOut.toString(),
    amountIn: swapQuote.amountIn.toString(),
    otherAmountThreshold: swapQuote.otherAmountThreshold.toString(),
  };
}

export async function listOrcaWhirlpoolPools(filters?: {
  tokenMints?: string[];
  limit?: number;
}): Promise<OrcaWhirlpoolPoolInfo[]> {
  const sdk = await import('@orca-so/whirlpool-sdk') as any;
  const client = new sdk.OrcaWhirlpoolClient({ network: sdk.OrcaNetwork.MAINNET });
  const pools = await client.offchain.getPools();
  if (!pools) return [];

  const tokenMints = (filters?.tokenMints || []).map((m) => m.toLowerCase());
  const limit = filters?.limit && filters.limit > 0 ? filters.limit : 50;
  const results: OrcaWhirlpoolPoolInfo[] = [];

  for (const pool of Object.values(pools) as any[]) {
    const tokenMintA = pool.tokenMintA;
    const tokenMintB = pool.tokenMintB;
    if (!tokenMintA || !tokenMintB) continue;

    if (tokenMints.length > 0) {
      const matches = tokenMints.every((mint) =>
        [String(tokenMintA).toLowerCase(), String(tokenMintB).toLowerCase()].includes(mint)
      );
      if (!matches) continue;
    }

    results.push({
      address: pool.address,
      tokenMintA,
      tokenMintB,
      stable: Boolean(pool.stable),
      price: pool.price,
      tvl: pool.tvl,
      volume24h: pool.volume?.day,
    });

    if (results.length >= limit) break;
  }

  return results;
}

// ============================================
// POSITION MANAGEMENT (v2 SDK)
// ============================================

/**
 * Open a full-range position in a Whirlpool
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function openOrcaFullRangePosition(
  connection: Connection,
  keypair: Keypair,
  params: OrcaOpenPositionParams
): Promise<OrcaOpenPositionResult> {
  const sdk = await import('@orca-so/whirlpools') as any;

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setPayerFromBytes(keypair.secretKey);
  await sdk.setRpc(connection.rpcEndpoint);

  const result = await sdk.openFullRangePosition(
    new PublicKey(params.poolAddress),
    {
      tokenA: BigInt(params.tokenAmountA),
      tokenB: params.tokenAmountB ? BigInt(params.tokenAmountB) : undefined,
    },
    params.slippageBps ?? 50
  );

  return {
    signature: result.signature || result.signatures?.[0] || '',
    positionAddress: result.positionMint?.toBase58?.() || result.positionAddress?.toBase58?.() || '',
    positionMint: result.positionMint?.toBase58?.() || '',
  };
}

/**
 * Open a concentrated position in a Whirlpool with custom tick range
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function openOrcaConcentratedPosition(
  connection: Connection,
  keypair: Keypair,
  params: OrcaOpenPositionParams
): Promise<OrcaOpenPositionResult> {
  const sdk = await import('@orca-so/whirlpools') as any;

  if (params.tickLowerIndex === undefined || params.tickUpperIndex === undefined) {
    throw new Error('tickLowerIndex and tickUpperIndex required for concentrated position');
  }

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setPayerFromBytes(keypair.secretKey);
  await sdk.setRpc(connection.rpcEndpoint);

  const result = await sdk.openPosition(
    new PublicKey(params.poolAddress),
    {
      tokenA: BigInt(params.tokenAmountA),
      tokenB: params.tokenAmountB ? BigInt(params.tokenAmountB) : undefined,
    },
    params.tickLowerIndex,
    params.tickUpperIndex,
    params.slippageBps ?? 50
  );

  return {
    signature: result.signature || result.signatures?.[0] || '',
    positionAddress: result.positionMint?.toBase58?.() || result.positionAddress?.toBase58?.() || '',
    positionMint: result.positionMint?.toBase58?.() || '',
  };
}

/**
 * Fetch all positions owned by a wallet
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function fetchOrcaPositionsForOwner(
  connection: Connection,
  ownerAddress: string
): Promise<OrcaPositionInfo[]> {
  const sdk = await import('@orca-so/whirlpools') as any;

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setRpc(connection.rpcEndpoint);

  const positions = await sdk.fetchPositionsForOwner(new PublicKey(ownerAddress));

  return (positions || []).map((pos: any) => ({
    address: pos.address?.toBase58?.() || pos.positionMint?.toBase58?.() || '',
    whirlpool: pos.whirlpool?.toBase58?.() || pos.whirlpool || '',
    tickLowerIndex: pos.tickLowerIndex ?? 0,
    tickUpperIndex: pos.tickUpperIndex ?? 0,
    liquidity: pos.liquidity?.toString?.() || '0',
    feeOwedA: pos.feeOwedA?.toString?.() || '0',
    feeOwedB: pos.feeOwedB?.toString?.() || '0',
    rewardOwed0: pos.rewardInfos?.[0]?.amountOwed?.toString?.(),
    rewardOwed1: pos.rewardInfos?.[1]?.amountOwed?.toString?.(),
    rewardOwed2: pos.rewardInfos?.[2]?.amountOwed?.toString?.(),
  }));
}

/**
 * Fetch all positions in a specific Whirlpool
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function fetchOrcaPositionsInWhirlpool(
  connection: Connection,
  poolAddress: string
): Promise<OrcaPositionInfo[]> {
  const sdk = await import('@orca-so/whirlpools') as any;

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setRpc(connection.rpcEndpoint);

  const positions = await sdk.fetchPositionsInWhirlpool(new PublicKey(poolAddress));

  return (positions || []).map((pos: any) => ({
    address: pos.address?.toBase58?.() || pos.positionMint?.toBase58?.() || '',
    whirlpool: poolAddress,
    tickLowerIndex: pos.tickLowerIndex ?? 0,
    tickUpperIndex: pos.tickUpperIndex ?? 0,
    liquidity: pos.liquidity?.toString?.() || '0',
    feeOwedA: pos.feeOwedA?.toString?.() || '0',
    feeOwedB: pos.feeOwedB?.toString?.() || '0',
    rewardOwed0: pos.rewardInfos?.[0]?.amountOwed?.toString?.(),
    rewardOwed1: pos.rewardInfos?.[1]?.amountOwed?.toString?.(),
    rewardOwed2: pos.rewardInfos?.[2]?.amountOwed?.toString?.(),
  }));
}

// ============================================
// LIQUIDITY MANAGEMENT (v2 SDK)
// ============================================

/**
 * Increase liquidity in an existing position
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function increaseOrcaLiquidity(
  connection: Connection,
  keypair: Keypair,
  params: OrcaLiquidityParams
): Promise<OrcaLiquidityResult> {
  const sdk = await import('@orca-so/whirlpools') as any;

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setPayerFromBytes(keypair.secretKey);
  await sdk.setRpc(connection.rpcEndpoint);

  const param = params.liquidityAmount
    ? { liquidity: BigInt(params.liquidityAmount) }
    : {
        tokenA: params.tokenAmountA ? BigInt(params.tokenAmountA) : undefined,
        tokenB: params.tokenAmountB ? BigInt(params.tokenAmountB) : undefined,
      };

  const result = await sdk.increaseLiquidity(
    new PublicKey(params.positionAddress),
    param,
    params.slippageBps ?? 50
  );

  return {
    signature: result.signature || result.signatures?.[0] || '',
    positionAddress: params.positionAddress,
    liquidityDelta: result.liquidityDelta?.toString?.() || result.quote?.liquidityDelta?.toString?.(),
  };
}

/**
 * Decrease liquidity from an existing position
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function decreaseOrcaLiquidity(
  connection: Connection,
  keypair: Keypair,
  params: OrcaLiquidityParams
): Promise<OrcaLiquidityResult> {
  const sdk = await import('@orca-so/whirlpools') as any;

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setPayerFromBytes(keypair.secretKey);
  await sdk.setRpc(connection.rpcEndpoint);

  const param = params.liquidityAmount
    ? { liquidity: BigInt(params.liquidityAmount) }
    : {
        tokenA: params.tokenAmountA ? BigInt(params.tokenAmountA) : undefined,
        tokenB: params.tokenAmountB ? BigInt(params.tokenAmountB) : undefined,
      };

  const result = await sdk.decreaseLiquidity(
    new PublicKey(params.positionAddress),
    param,
    params.slippageBps ?? 50
  );

  return {
    signature: result.signature || result.signatures?.[0] || '',
    positionAddress: params.positionAddress,
    liquidityDelta: result.liquidityDelta?.toString?.() || result.quote?.liquidityDelta?.toString?.(),
  };
}

// ============================================
// FEES & REWARDS (v2 SDK)
// ============================================

/**
 * Harvest fees and rewards from a position
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function harvestOrcaPosition(
  connection: Connection,
  keypair: Keypair,
  positionAddress: string
): Promise<OrcaHarvestResult> {
  const sdk = await import('@orca-so/whirlpools') as any;

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setPayerFromBytes(keypair.secretKey);
  await sdk.setRpc(connection.rpcEndpoint);

  const result = await sdk.harvestPosition(new PublicKey(positionAddress));

  return {
    signature: result.signature || result.signatures?.[0] || '',
    positionAddress,
    feesCollectedA: result.feesCollectedA?.toString?.(),
    feesCollectedB: result.feesCollectedB?.toString?.(),
    rewardsCollected: result.rewardsCollected?.map((r: any) => r?.toString?.() || '0'),
  };
}

/**
 * Harvest all fees from multiple positions
 */
export async function harvestAllOrcaPositionFees(
  connection: Connection,
  keypair: Keypair,
  positionAddresses: string[]
): Promise<OrcaHarvestResult[]> {
  const results: OrcaHarvestResult[] = [];
  for (const addr of positionAddresses) {
    try {
      const result = await harvestOrcaPosition(connection, keypair, addr);
      results.push(result);
    } catch (err) {
      results.push({
        signature: '',
        positionAddress: addr,
      });
    }
  }
  return results;
}

/**
 * Close a position and reclaim rent
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function closeOrcaPosition(
  connection: Connection,
  keypair: Keypair,
  positionAddress: string
): Promise<OrcaClosePositionResult> {
  const sdk = await import('@orca-so/whirlpools') as any;

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setPayerFromBytes(keypair.secretKey);
  await sdk.setRpc(connection.rpcEndpoint);

  const result = await sdk.closePosition(new PublicKey(positionAddress));

  return {
    signature: result.signature || result.signatures?.[0] || '',
    positionAddress,
    rentReclaimed: result.rentReclaimed?.toString?.(),
  };
}

// ============================================
// POOL CREATION (v2 SDK)
// ============================================

/**
 * Create a new Splash Pool (full-range, simplified)
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function createOrcaSplashPool(
  connection: Connection,
  keypair: Keypair,
  params: OrcaCreatePoolParams
): Promise<OrcaCreatePoolResult> {
  const sdk = await import('@orca-so/whirlpools') as any;

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setPayerFromBytes(keypair.secretKey);
  await sdk.setRpc(connection.rpcEndpoint);

  const result = await sdk.createSplashPool(
    new PublicKey(params.tokenMintA),
    new PublicKey(params.tokenMintB),
    params.initialPrice ?? 1.0
  );

  return {
    signature: result.signature || result.signatures?.[0] || '',
    poolAddress: result.poolAddress?.toBase58?.() || result.whirlpool?.toBase58?.() || '',
    tokenMintA: params.tokenMintA,
    tokenMintB: params.tokenMintB,
  };
}

/**
 * Create a new Concentrated Liquidity Pool
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function createOrcaConcentratedLiquidityPool(
  connection: Connection,
  keypair: Keypair,
  params: OrcaCreatePoolParams
): Promise<OrcaCreatePoolResult> {
  const sdk = await import('@orca-so/whirlpools') as any;

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setPayerFromBytes(keypair.secretKey);
  await sdk.setRpc(connection.rpcEndpoint);

  // Map fee tier to tick spacing (common mappings)
  const tickSpacing = params.tickSpacing ?? (params.feeTierBps === 1 ? 1 : params.feeTierBps === 5 ? 8 : params.feeTierBps === 30 ? 64 : 128);

  const result = await sdk.createConcentratedLiquidityPool(
    new PublicKey(params.tokenMintA),
    new PublicKey(params.tokenMintB),
    tickSpacing,
    params.initialPrice ?? 1.0
  );

  return {
    signature: result.signature || result.signatures?.[0] || '',
    poolAddress: result.poolAddress?.toBase58?.() || result.whirlpool?.toBase58?.() || '',
    tokenMintA: params.tokenMintA,
    tokenMintB: params.tokenMintB,
  };
}

// ============================================
// POOL QUERIES (v2 SDK)
// ============================================

/**
 * Fetch pools for a specific token pair
 * Uses @orca-so/whirlpools v2 SDK
 */
export async function fetchOrcaWhirlpoolsByTokenPair(
  connection: Connection,
  tokenMintA: string,
  tokenMintB: string
): Promise<OrcaWhirlpoolPoolInfo[]> {
  const sdk = await import('@orca-so/whirlpools') as any;

  await sdk.setWhirlpoolsConfig('solanaMainnet');
  await sdk.setRpc(connection.rpcEndpoint);

  const pools = await sdk.fetchWhirlpoolsByTokenPair(
    new PublicKey(tokenMintA),
    new PublicKey(tokenMintB)
  );

  return (pools || []).map((pool: any) => ({
    address: pool.address?.toBase58?.() || pool.address || '',
    tokenMintA: pool.tokenMintA?.toBase58?.() || tokenMintA,
    tokenMintB: pool.tokenMintB?.toBase58?.() || tokenMintB,
    stable: false,
    price: pool.price ? Number(pool.price) : undefined,
    tvl: pool.tvl ? Number(pool.tvl) : undefined,
    liquidity: pool.liquidity ? Number(pool.liquidity) : undefined,
    tickSpacing: pool.tickSpacing,
  }));
}
