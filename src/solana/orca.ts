import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { signAndSendTransaction, getSolanaConnection } from './wallet';

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
    tokenAmount: new BN(params.amount),
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
  connection?: Connection;
}): Promise<OrcaWhirlpoolQuote> {
  const sdk = await import('@orca-so/whirlpool-sdk') as any;
  // Without an explicit connection, the SDK's own default for MAINNET is
  // https://ssc-dao.genesysgo.net — a GenesysGo RPC that has been
  // discontinued; every call fails there. Always supply a working connection.
  const orca = new sdk.OrcaWhirlpoolClient({
    connection: params.connection ?? getSolanaConnection(),
    network: sdk.OrcaNetwork.MAINNET,
  });

  const swapQuote = await orca.pool.getSwapQuote({
    poolAddress: params.poolAddress,
    tokenMint: params.inputMint,
    tokenAmount: new BN(params.amount),
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
// V2 SDK SHARED HELPERS
//
// Everything below was verified live against @orca-so/whirlpools@6.0.0's
// actual shipped dist/index.d.ts and runtime behavior (not just assumed from
// naming conventions), after discovering the whole v2 SDK failed to import
// at all — see the @solana/kit override in package.json. Four confirmed,
// distinct bug classes, all present before this fix:
//  1. Wrong function names (sdk.openPosition/sdk.increaseLiquidity don't
//     exist; real names are openConcentratedPosition/increasePosLiquidity).
//  2. Wrong argument types — @solana/kit's `Address` is a plain base58
//     string, never a legacy web3.js PublicKey object; wrapping addresses in
//     `new PublicKey(...)` broke every call (confirmed live: e.g.
//     fetchPositionsForOwner(new PublicKey(x)) throws "rpc.getTokenAccounts
//     ByOwner is not a function" because the PublicKey lands in the `rpc`
//     argument slot).
//  3. Wrong result shape — SDK read/list functions return
//     Account<T> = { data: T, address, ... }, not a flat T (same class of
//     bug as Meteora DBC's poolState wrapper).
//  4. Missing execution — every write function
//     (open/increase/decrease/harvest/close/create) returns
//     { instructions, quote, callback } and does NOT send anything until
//     `.callback()` is called. The old code read a nonexistent
//     `result.signature` field and never called `.callback()` at all, so
//     these functions built valid instructions but never actually
//     transacted, while still reporting back an (empty) "signature".
// ============================================

/**
 * @orca-so/whirlpools' IncreaseLiquidityQuoteParam/DecreaseLiquidityQuoteParam
 * are discriminated unions accepting EXACTLY ONE of liquidity/tokenA/tokenB.
 * Building an object with an extra key present (even set to `undefined`)
 * risks breaking the SDK's internal narrowing depending on how it checks
 * for the field.
 */
function buildOrcaLiquidityParam(params: {
  liquidityAmount?: string;
  tokenAmountA?: string;
  tokenAmountB?: string;
}): { liquidity: bigint } | { tokenA: bigint } | { tokenB: bigint } {
  if (params.liquidityAmount) return { liquidity: BigInt(params.liquidityAmount) };
  if (params.tokenAmountB) return { tokenB: BigInt(params.tokenAmountB) };
  if (params.tokenAmountA) return { tokenA: BigInt(params.tokenAmountA) };
  throw new Error('One of liquidityAmount, tokenAmountA, or tokenAmountB is required.');
}

/**
 * Position list/fetch results are Account<Position> (fields under `.data`)
 * or, for bundles, Account<PositionBundle> & { positions: Account<Position>[] }.
 * Flattens both shapes to a plain list of Account<Position>-like entries.
 */
function flattenOrcaPositions(positions: any[]): any[] {
  return (positions || []).flatMap((p) => (p?.isPositionBundle ? p.positions : [p]));
}

function mapOrcaPositionData(pos: any): OrcaPositionInfo {
  const data = pos?.data ?? pos ?? {};
  return {
    address: data.positionMint ?? pos?.address ?? '',
    whirlpool: data.whirlpool ?? '',
    tickLowerIndex: data.tickLowerIndex ?? 0,
    tickUpperIndex: data.tickUpperIndex ?? 0,
    liquidity: data.liquidity?.toString?.() ?? '0',
    feeOwedA: data.feeOwedA?.toString?.() ?? '0',
    feeOwedB: data.feeOwedB?.toString?.() ?? '0',
    rewardOwed0: data.rewardInfos?.[0]?.amountOwed?.toString?.(),
    rewardOwed1: data.rewardInfos?.[1]?.amountOwed?.toString?.(),
    rewardOwed2: data.rewardInfos?.[2]?.amountOwed?.toString?.(),
  };
}

/**
 * Builds a @solana/kit RPC client from the same endpoint the caller's legacy
 * Connection points at — required for the "fetch"-family v2 SDK functions,
 * which (unlike the write/"action" functions) take `rpc` as an explicit
 * first argument rather than reading it from sdk.setRpc()'s internal config.
 */
async function getOrcaKitRpc(sdk: any, connection: Connection): Promise<any> {
  await sdk.setRpc(connection.rpcEndpoint);
  const kit = await import('@solana/kit');
  const { rpcUrl } = sdk.getRpcConfig();
  return (kit as any).createSolanaRpc(rpcUrl);
}

/**
 * openConcentratedPosition()'s .d.ts types the range as ticks-shaped but the
 * real signature takes nominal (lowerPrice, upperPrice) — verified live via
 * dist/index.d.ts and tickIndexToPrice()'s actual output. Converts using the
 * pool's real on-chain token decimals.
 */
async function orcaTickRangeToPrices(
  connection: Connection,
  rpc: any,
  poolAddress: string,
  tickLowerIndex: number,
  tickUpperIndex: number
): Promise<{ lowerPrice: number; upperPrice: number }> {
  const client = await import('@orca-so/whirlpools-client') as any;
  const core = await import('@orca-so/whirlpools-core') as any;
  const { getMint } = await import('@solana/spl-token');

  const pool = await client.fetchWhirlpool(rpc, poolAddress);
  const [mintA, mintB] = await Promise.all([
    getMint(connection, new PublicKey(String(pool.data.tokenMintA))),
    getMint(connection, new PublicKey(String(pool.data.tokenMintB))),
  ]);

  return {
    lowerPrice: core.tickIndexToPrice(tickLowerIndex, mintA.decimals, mintB.decimals),
    upperPrice: core.tickIndexToPrice(tickUpperIndex, mintA.decimals, mintB.decimals),
  };
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
    params.poolAddress,
    buildOrcaLiquidityParam(params),
    params.slippageBps ?? 50
  );
  const signature = await result.callback();

  return {
    signature,
    positionAddress: result.positionMint,
    positionMint: result.positionMint,
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
  const rpc = await getOrcaKitRpc(sdk, connection);

  const { lowerPrice, upperPrice } = await orcaTickRangeToPrices(
    connection,
    rpc,
    params.poolAddress,
    params.tickLowerIndex,
    params.tickUpperIndex
  );

  const result = await sdk.openConcentratedPosition(
    params.poolAddress,
    buildOrcaLiquidityParam(params),
    lowerPrice,
    upperPrice,
    params.slippageBps ?? 50
  );
  const signature = await result.callback();

  return {
    signature,
    positionAddress: result.positionMint,
    positionMint: result.positionMint,
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
  const rpc = await getOrcaKitRpc(sdk, connection);

  const positions = await sdk.fetchPositionsForOwner(rpc, ownerAddress);
  return flattenOrcaPositions(positions).map(mapOrcaPositionData);
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
  const rpc = await getOrcaKitRpc(sdk, connection);

  const positions = await sdk.fetchPositionsInWhirlpool(rpc, poolAddress);
  return flattenOrcaPositions(positions).map(mapOrcaPositionData);
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

  const result = await sdk.increasePosLiquidity(
    params.positionAddress,
    buildOrcaLiquidityParam(params),
    params.slippageBps ?? 50
  );
  const signature = await result.callback();

  return {
    signature,
    positionAddress: params.positionAddress,
    liquidityDelta: result.quote?.liquidityDelta?.toString?.(),
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

  const result = await sdk.decreaseLiquidity(
    params.positionAddress,
    buildOrcaLiquidityParam(params),
    params.slippageBps ?? 50
  );
  const signature = await result.callback();

  return {
    signature,
    positionAddress: params.positionAddress,
    liquidityDelta: result.quote?.liquidityDelta?.toString?.(),
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

  const result = await sdk.harvestPosition(positionAddress);
  const signature = await result.callback();

  return {
    signature,
    positionAddress,
    feesCollectedA: result.feesQuote?.feeOwedA?.toString?.(),
    feesCollectedB: result.feesQuote?.feeOwedB?.toString?.(),
    rewardsCollected: result.rewardsQuote?.rewards?.map((r: any) => r?.rewardsOwed?.toString?.() ?? '0'),
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

  const result = await sdk.closePosition(positionAddress);
  const signature = await result.callback();

  return {
    signature,
    positionAddress,
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
    params.tokenMintA,
    params.tokenMintB,
    params.initialPrice ?? 1.0
  );
  const signature = await result.callback();

  return {
    signature,
    poolAddress: result.poolAddress,
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
    params.tokenMintA,
    params.tokenMintB,
    tickSpacing,
    params.initialPrice ?? 1.0
  );
  const signature = await result.callback();

  return {
    signature,
    poolAddress: result.poolAddress,
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
  const rpc = await getOrcaKitRpc(sdk, connection);

  const pools = await sdk.fetchWhirlpoolsByTokenPair(rpc, tokenMintA, tokenMintB);

  return (pools || []).map((pool: any) => ({
    address: pool.address || '',
    tokenMintA: pool.tokenMintA || tokenMintA,
    tokenMintB: pool.tokenMintB || tokenMintB,
    stable: false,
    price: pool.price ? Number(pool.price) : undefined,
    liquidity: pool.liquidity ? Number(pool.liquidity) : undefined,
    tickSpacing: pool.tickSpacing,
  }));
}
