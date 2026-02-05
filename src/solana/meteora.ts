import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { signAndSendTransaction } from './wallet';

export interface MeteoraDlmmSwapParams {
  poolAddress: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  slippageBps?: number;
  allowPartialFill?: boolean;
  maxExtraBinArrays?: number;
}

export interface MeteoraDlmmSwapResult {
  signature: string;
  poolAddress: string;
  inAmount?: string;
  outAmount?: string;
  txId?: string;
}

export interface MeteoraDlmmPoolInfo {
  address: string;
  tokenXMint: string;
  tokenYMint: string;
  binStep?: number;
  baseFactor?: number;
  activeId?: number;
  liquidity?: number;
}

export interface MeteoraDlmmQuote {
  outAmount: string;
  minOutAmount: string;
  priceImpact?: number;
  binArraysPubkey?: string[];
}

// ============================================
// POSITION INTERFACES
// ============================================

export interface MeteoraPositionInfo {
  address: string;
  lbPair: string;
  owner: string;
  lowerBinId: number;
  upperBinId: number;
  totalXAmount: string;
  totalYAmount: string;
  feeX: string;
  feeY: string;
  rewardOne?: string;
  rewardTwo?: string;
}

export interface MeteoraOpenPositionParams {
  poolAddress: string;
  totalXAmount: string;
  totalYAmount: string;
  strategyType?: 'Spot' | 'BidAsk' | 'Curve';
  minBinId?: number;
  maxBinId?: number;
  slippageBps?: number;
}

export interface MeteoraOpenPositionResult {
  signature: string;
  positionAddress: string;
}

export interface MeteoraLiquidityParams {
  poolAddress: string;
  positionAddress: string;
  totalXAmount?: string;
  totalYAmount?: string;
  strategyType?: 'Spot' | 'BidAsk' | 'Curve';
  minBinId?: number;
  maxBinId?: number;
  slippageBps?: number;
}

export interface MeteoraRemoveLiquidityParams {
  poolAddress: string;
  positionAddress: string;
  fromBinId: number;
  toBinId: number;
  bps: number; // Percentage in basis points (5000 = 50%)
  shouldClaimAndClose?: boolean;
}

export interface MeteoraLiquidityResult {
  signature: string;
  positionAddress: string;
}

export interface MeteoraClaimResult {
  signatures: string[];
  positionAddresses: string[];
  feesClaimed?: { x: string; y: string };
  rewardsClaimed?: string[];
}

// ============================================
// POOL INFO INTERFACES
// ============================================

export interface MeteoraActiveBinInfo {
  binId: number;
  price: string;
  pricePerToken: string;
  xAmount: string;
  yAmount: string;
}

export interface MeteoraFeeInfo {
  baseFeeRate: string;
  maxFeeRate: string;
  protocolFeeRate: string;
}

export interface MeteoraEmissionRate {
  rewardMint: string;
  rewardPerSecond: string;
  rewardDurationEnd: number;
}

// ============================================
// POOL CREATION INTERFACES
// ============================================

export interface MeteoraCreatePoolParams {
  tokenX: string;
  tokenY: string;
  binStep: number;
  activeId?: number;
  feeBps?: number;
  activationType?: 'Slot' | 'Timestamp';
  hasAlphaVault?: boolean;
}

export interface MeteoraCreatePoolResult {
  signature: string;
  poolAddress: string;
  tokenX: string;
  tokenY: string;
}

export async function executeMeteoraDlmmSwap(
  connection: Connection,
  keypair: Keypair,
  params: MeteoraDlmmSwapParams
): Promise<MeteoraDlmmSwapResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;

  if (!DLMM) {
    throw new Error('Meteora DLMM SDK not available.');
  }

  const pool = await DLMM.create(connection, new PublicKey(params.poolAddress));
  const swapAmount = new BN(params.inAmount);
  const slippageBps = params.slippageBps ?? 50;
  const swapForY = pool.tokenX.publicKey.toBase58() === params.inputMint;

  const binArrays = await pool.getBinArrayForSwap(swapForY, params.maxExtraBinArrays ?? 3);
  const quote = await pool.swapQuote(
    swapAmount,
    swapForY,
    new BN(slippageBps),
    binArrays,
    params.allowPartialFill ?? false,
    params.maxExtraBinArrays ?? 3
  );

  const inToken = swapForY ? pool.tokenX.publicKey : pool.tokenY.publicKey;
  const outToken = swapForY ? pool.tokenY.publicKey : pool.tokenX.publicKey;

  const swapTx = await pool.swap({
    inToken,
    outToken,
    inAmount: swapAmount,
    minOutAmount: quote.minOutAmount,
    lbPair: pool.pubkey,
    user: keypair.publicKey,
    binArraysPubkey: quote.binArraysPubkey,
  });

  const signature = await signAndSendTransaction(connection, keypair, swapTx);
  return { signature, poolAddress: params.poolAddress };
}

export async function getMeteoraDlmmQuote(
  connection: Connection,
  params: {
    poolAddress: string;
    inputMint: string;
    inAmount: string;
    slippageBps?: number;
    allowPartialFill?: boolean;
    maxExtraBinArrays?: number;
  }
): Promise<MeteoraDlmmQuote> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) {
    throw new Error('Meteora DLMM SDK not available.');
  }

  const pool = await DLMM.create(connection, new PublicKey(params.poolAddress));
  const swapAmount = new BN(params.inAmount);
  const slippageBps = params.slippageBps ?? 50;
  const swapForY = pool.tokenX.publicKey.toBase58() === params.inputMint;
  const binArrays = await pool.getBinArrayForSwap(swapForY, params.maxExtraBinArrays ?? 3);
  const quote = await pool.swapQuote(
    swapAmount,
    swapForY,
    new BN(slippageBps),
    binArrays,
    params.allowPartialFill ?? false,
    params.maxExtraBinArrays ?? 3
  );

  return {
    outAmount: quote.outAmount?.toString?.() || quote.outAmount?.toString() || '',
    minOutAmount: quote.minOutAmount?.toString?.() || quote.minOutAmount?.toString() || '',
    priceImpact: quote.priceImpact ? Number(quote.priceImpact) : undefined,
  };
}

export async function listMeteoraDlmmPools(
  connection: Connection,
  filters?: { tokenMints?: string[]; limit?: number; includeLiquidity?: boolean }
): Promise<MeteoraDlmmPoolInfo[]> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) {
    throw new Error('Meteora DLMM SDK not available.');
  }

  const pairs = await DLMM.getLbPairs(connection);
  const tokenMints = (filters?.tokenMints || []).map((m) => m.toLowerCase());
  const limit = filters?.limit && filters.limit > 0 ? filters.limit : 50;
  const includeLiquidity = filters?.includeLiquidity ?? false;

  const results: MeteoraDlmmPoolInfo[] = [];
  for (const pair of pairs as any[]) {
    const account = pair.account || {};
    const tokenXMint = account.tokenXMint?.toBase58?.() || account.tokenXMint?.toString?.() || '';
    const tokenYMint = account.tokenYMint?.toBase58?.() || account.tokenYMint?.toString?.() || '';
    if (!tokenXMint || !tokenYMint) continue;

    if (tokenMints.length > 0) {
      const matches = tokenMints.every((mint) =>
        [tokenXMint.toLowerCase(), tokenYMint.toLowerCase()].includes(mint)
      );
      if (!matches) continue;
    }

    const info: MeteoraDlmmPoolInfo = {
      address: pair.publicKey?.toBase58?.() || pair.publicKey?.toString?.() || '',
      tokenXMint,
      tokenYMint,
      binStep: account.binStep?.toNumber?.() ?? account.binStep,
      baseFactor: account.parameters?.baseFactor ?? account.baseFactor,
      activeId: account.activeId?.toNumber?.() ?? account.activeId,
    };

    if (includeLiquidity) {
      try {
        const pool = await DLMM.create(connection, pair.publicKey);
        const reserveX = Number(pool.tokenX.amount?.toString?.() ?? pool.tokenX.amount ?? 0);
        const reserveY = Number(pool.tokenY.amount?.toString?.() ?? pool.tokenY.amount ?? 0);
        info.liquidity = reserveX + reserveY;
      } catch {
        info.liquidity = undefined;
      }
    }

    results.push(info);

    if (results.length >= limit) break;
  }

  return results;
}

// ============================================
// ADDITIONAL SWAP METHODS (PARTIAL FIX)
// ============================================

/**
 * Swap with exact output amount specified
 */
export async function executeMeteoraDlmmSwapExactOut(
  connection: Connection,
  keypair: Keypair,
  params: MeteoraDlmmSwapParams & { outAmount: string }
): Promise<MeteoraDlmmSwapResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(params.poolAddress));
  const outAmount = new BN(params.outAmount);
  const slippageBps = params.slippageBps ?? 50;
  const swapForY = pool.tokenX.publicKey.toBase58() === params.inputMint;

  const binArrays = await pool.getBinArrayForSwap(swapForY, params.maxExtraBinArrays ?? 3);
  const quote = await pool.swapQuoteExactOut(
    outAmount,
    swapForY,
    new BN(slippageBps),
    binArrays,
    params.maxExtraBinArrays ?? 3
  );

  const inToken = swapForY ? pool.tokenX.publicKey : pool.tokenY.publicKey;
  const outToken = swapForY ? pool.tokenY.publicKey : pool.tokenX.publicKey;

  const swapTx = await pool.swapExactOut({
    inToken,
    outToken,
    outAmount,
    maxInAmount: quote.maxInAmount,
    lbPair: pool.pubkey,
    user: keypair.publicKey,
    binArraysPubkey: quote.binArraysPubkey,
  });

  const signature = await signAndSendTransaction(connection, keypair, swapTx);
  return {
    signature,
    poolAddress: params.poolAddress,
    inAmount: quote.inAmount?.toString?.(),
    outAmount: params.outAmount,
  };
}

/**
 * Swap with price impact constraint
 */
export async function executeMeteoraDlmmSwapWithPriceImpact(
  connection: Connection,
  keypair: Keypair,
  params: MeteoraDlmmSwapParams & { maxPriceImpactBps: number }
): Promise<MeteoraDlmmSwapResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(params.poolAddress));
  const swapAmount = new BN(params.inAmount);
  const swapForY = pool.tokenX.publicKey.toBase58() === params.inputMint;

  const binArrays = await pool.getBinArrayForSwap(swapForY, params.maxExtraBinArrays ?? 3);

  const inToken = swapForY ? pool.tokenX.publicKey : pool.tokenY.publicKey;
  const outToken = swapForY ? pool.tokenY.publicKey : pool.tokenX.publicKey;

  const swapTx = await pool.swapWithPriceImpact({
    inToken,
    outToken,
    inAmount: swapAmount,
    lbPair: pool.pubkey,
    user: keypair.publicKey,
    binArraysPubkey: binArrays.map((b: any) => b.publicKey),
    priceImpact: new BN(params.maxPriceImpactBps),
  });

  const signature = await signAndSendTransaction(connection, keypair, swapTx);
  return { signature, poolAddress: params.poolAddress, inAmount: params.inAmount };
}

/**
 * Get swap quote for exact output
 */
export async function getMeteoraDlmmQuoteExactOut(
  connection: Connection,
  params: {
    poolAddress: string;
    outputMint: string;
    outAmount: string;
    slippageBps?: number;
    maxExtraBinArrays?: number;
  }
): Promise<MeteoraDlmmQuote & { inAmount: string; maxInAmount: string }> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(params.poolAddress));
  const outAmount = new BN(params.outAmount);
  const slippageBps = params.slippageBps ?? 50;
  const swapForY = pool.tokenY.publicKey.toBase58() === params.outputMint;

  const binArrays = await pool.getBinArrayForSwap(swapForY, params.maxExtraBinArrays ?? 3);
  const quote = await pool.swapQuoteExactOut(
    outAmount,
    swapForY,
    new BN(slippageBps),
    binArrays,
    params.maxExtraBinArrays ?? 3
  );

  return {
    outAmount: params.outAmount,
    minOutAmount: params.outAmount,
    inAmount: quote.inAmount?.toString?.() || '',
    maxInAmount: quote.maxInAmount?.toString?.() || '',
    priceImpact: quote.priceImpact ? Number(quote.priceImpact) : undefined,
    binArraysPubkey: quote.binArraysPubkey?.map((p: any) => p.toBase58?.() || p.toString?.()),
  };
}

// ============================================
// POSITION MANAGEMENT
// ============================================

/**
 * Initialize position and add liquidity by strategy
 */
export async function initializeMeteoraDlmmPosition(
  connection: Connection,
  keypair: Keypair,
  params: MeteoraOpenPositionParams
): Promise<MeteoraOpenPositionResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(params.poolAddress));
  const activeBin = await pool.getActiveBin();
  const activeBinId = activeBin.binId;

  // Default to +-10 bins around active if not specified
  const minBinId = params.minBinId ?? activeBinId - 10;
  const maxBinId = params.maxBinId ?? activeBinId + 10;

  // Strategy type mapping
  const strategyTypeMap: Record<string, number> = { Spot: 0, BidAsk: 1, Curve: 2 };
  const strategyType = strategyTypeMap[params.strategyType || 'Spot'] ?? 0;

  const { Keypair: SolKeypair } = await import('@solana/web3.js');
  const positionKeypair = SolKeypair.generate();

  const tx = await pool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: positionKeypair.publicKey,
    totalXAmount: new BN(params.totalXAmount),
    totalYAmount: new BN(params.totalYAmount),
    strategy: {
      maxBinId,
      minBinId,
      strategyType,
    },
    user: keypair.publicKey,
    slippage: params.slippageBps ?? 50,
  });

  // Sign with both keypairs
  if ('partialSign' in tx) {
    tx.partialSign(positionKeypair);
  } else if ('sign' in tx && Array.isArray((tx as any).signatures)) {
    (tx as any).sign([positionKeypair]);
  }
  const signature = await signAndSendTransaction(connection, keypair, tx);

  return {
    signature,
    positionAddress: positionKeypair.publicKey.toBase58(),
  };
}

/**
 * Create an empty position without liquidity
 */
export async function createEmptyMeteoraDlmmPosition(
  connection: Connection,
  keypair: Keypair,
  params: { poolAddress: string; minBinId: number; maxBinId: number }
): Promise<MeteoraOpenPositionResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(params.poolAddress));
  const { Keypair: SolKeypair } = await import('@solana/web3.js');
  const positionKeypair = SolKeypair.generate();

  const tx = await pool.createEmptyPosition({
    positionPubKey: positionKeypair.publicKey,
    minBinId: params.minBinId,
    maxBinId: params.maxBinId,
    user: keypair.publicKey,
  });

  // Sign with both keypairs
  if ('partialSign' in tx) {
    tx.partialSign(positionKeypair);
  } else if ('sign' in tx && Array.isArray((tx as any).signatures)) {
    (tx as any).sign([positionKeypair]);
  }
  const signature = await signAndSendTransaction(connection, keypair, tx);

  return {
    signature,
    positionAddress: positionKeypair.publicKey.toBase58(),
  };
}

/**
 * Get positions by user for a specific pool
 */
export async function getMeteoraDlmmPositionsByUser(
  connection: Connection,
  poolAddress: string,
  userAddress?: string
): Promise<MeteoraPositionInfo[]> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));
  const positions = await pool.getPositionsByUserAndLbPair(
    userAddress ? new PublicKey(userAddress) : undefined
  );

  return (positions?.userPositions || positions || []).map((pos: any) => ({
    address: pos.publicKey?.toBase58?.() || pos.address || '',
    lbPair: poolAddress,
    owner: pos.owner?.toBase58?.() || userAddress || '',
    lowerBinId: pos.positionData?.lowerBinId ?? pos.lowerBinId ?? 0,
    upperBinId: pos.positionData?.upperBinId ?? pos.upperBinId ?? 0,
    totalXAmount: pos.positionData?.totalXAmount?.toString?.() || pos.totalXAmount?.toString?.() || '0',
    totalYAmount: pos.positionData?.totalYAmount?.toString?.() || pos.totalYAmount?.toString?.() || '0',
    feeX: pos.positionData?.feeX?.toString?.() || pos.feeX?.toString?.() || '0',
    feeY: pos.positionData?.feeY?.toString?.() || pos.feeY?.toString?.() || '0',
    rewardOne: pos.positionData?.rewardOne?.toString?.() || pos.rewardOne?.toString?.(),
    rewardTwo: pos.positionData?.rewardTwo?.toString?.() || pos.rewardTwo?.toString?.(),
  }));
}

/**
 * Get all positions across all pools for a user
 */
export async function getAllMeteoraDlmmPositionsByUser(
  connection: Connection,
  userAddress: string
): Promise<MeteoraPositionInfo[]> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const allPositions = await DLMM.getAllLbPairPositionsByUser(
    connection,
    new PublicKey(userAddress)
  );

  const results: MeteoraPositionInfo[] = [];
  for (const [lbPair, positionData] of Object.entries(allPositions || {})) {
    const positions = (positionData as any)?.userPositions || positionData || [];
    for (const pos of Array.isArray(positions) ? positions : [positions]) {
      results.push({
        address: pos.publicKey?.toBase58?.() || pos.address || '',
        lbPair,
        owner: userAddress,
        lowerBinId: pos.positionData?.lowerBinId ?? pos.lowerBinId ?? 0,
        upperBinId: pos.positionData?.upperBinId ?? pos.upperBinId ?? 0,
        totalXAmount: pos.positionData?.totalXAmount?.toString?.() || '0',
        totalYAmount: pos.positionData?.totalYAmount?.toString?.() || '0',
        feeX: pos.positionData?.feeX?.toString?.() || '0',
        feeY: pos.positionData?.feeY?.toString?.() || '0',
        rewardOne: pos.positionData?.rewardOne?.toString?.(),
        rewardTwo: pos.positionData?.rewardTwo?.toString?.(),
      });
    }
  }

  return results;
}

// ============================================
// LIQUIDITY MANAGEMENT
// ============================================

/**
 * Add liquidity to existing position by strategy
 */
export async function addMeteoraDlmmLiquidity(
  connection: Connection,
  keypair: Keypair,
  params: MeteoraLiquidityParams
): Promise<MeteoraLiquidityResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(params.poolAddress));
  const activeBin = await pool.getActiveBin();
  const activeBinId = activeBin.binId;

  const minBinId = params.minBinId ?? activeBinId - 10;
  const maxBinId = params.maxBinId ?? activeBinId + 10;

  const strategyTypeMap: Record<string, number> = { Spot: 0, BidAsk: 1, Curve: 2 };
  const strategyType = strategyTypeMap[params.strategyType || 'Spot'] ?? 0;

  const tx = await pool.addLiquidityByStrategy({
    positionPubKey: new PublicKey(params.positionAddress),
    totalXAmount: new BN(params.totalXAmount || '0'),
    totalYAmount: new BN(params.totalYAmount || '0'),
    strategy: {
      maxBinId,
      minBinId,
      strategyType,
    },
    user: keypair.publicKey,
    slippage: params.slippageBps ?? 50,
  });

  const signature = await signAndSendTransaction(connection, keypair, tx);

  return {
    signature,
    positionAddress: params.positionAddress,
  };
}

/**
 * Remove liquidity from position
 */
export async function removeMeteoraDlmmLiquidity(
  connection: Connection,
  keypair: Keypair,
  params: MeteoraRemoveLiquidityParams
): Promise<MeteoraLiquidityResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(params.poolAddress));

  const tx = await pool.removeLiquidity({
    user: keypair.publicKey,
    position: new PublicKey(params.positionAddress),
    fromBinId: params.fromBinId,
    toBinId: params.toBinId,
    bps: new BN(params.bps),
    shouldClaimAndClose: params.shouldClaimAndClose ?? false,
  });

  // Handle transaction array
  const txToSend = Array.isArray(tx) ? tx[0] : tx;
  const signature = await signAndSendTransaction(connection, keypair, txToSend);

  return {
    signature,
    positionAddress: params.positionAddress,
  };
}

/**
 * Close position and recover rent
 */
export async function closeMeteoraDlmmPosition(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string,
  positionAddress: string
): Promise<MeteoraLiquidityResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));

  // Fetch full position object
  const positions = await pool.getPositionsByUserAndLbPair(keypair.publicKey);
  const position = (positions?.userPositions || positions || []).find(
    (p: any) => (p.publicKey?.toBase58?.() || p.address) === positionAddress
  );
  if (!position) throw new Error(`Position not found: ${positionAddress}`);

  const tx = await pool.closePosition({
    owner: keypair.publicKey,
    position,
  });

  // Handle transaction array
  const txToSend = Array.isArray(tx) ? tx[0] : tx;
  const signature = await signAndSendTransaction(connection, keypair, txToSend);

  return {
    signature,
    positionAddress,
  };
}

// ============================================
// FEE & REWARD CLAIMING
// ============================================

/**
 * Claim swap fees from a position
 */
export async function claimMeteoraDlmmSwapFee(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string,
  positionAddress: string
): Promise<MeteoraClaimResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));

  // Fetch full position object
  const positions = await pool.getPositionsByUserAndLbPair(keypair.publicKey);
  const position = (positions?.userPositions || positions || []).find(
    (p: any) => (p.publicKey?.toBase58?.() || p.address) === positionAddress
  );
  if (!position) throw new Error(`Position not found: ${positionAddress}`);

  const tx = await pool.claimSwapFee({
    owner: keypair.publicKey,
    position,
  });

  // Handle transaction array
  const txToSend = Array.isArray(tx) ? tx[0] : tx;
  const signature = await signAndSendTransaction(connection, keypair, txToSend);

  return {
    signatures: [signature],
    positionAddresses: [positionAddress],
  };
}

/**
 * Claim all swap fees from multiple positions
 */
export async function claimAllMeteoraDlmmSwapFees(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string,
  positionAddresses: string[]
): Promise<MeteoraClaimResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));
  const positions = await pool.getPositionsByUserAndLbPair(keypair.publicKey);

  // Filter to only requested positions
  const filteredPositions = (positions?.userPositions || positions || []).filter((p: any) =>
    positionAddresses.includes(p.publicKey?.toBase58?.() || p.address || '')
  );

  const txs = await pool.claimAllSwapFee({
    owner: keypair.publicKey,
    positions: filteredPositions,
  });

  const signatures: string[] = [];
  for (const tx of Array.isArray(txs) ? txs : [txs]) {
    const sig = await signAndSendTransaction(connection, keypair, tx);
    signatures.push(sig);
  }

  return {
    signatures,
    positionAddresses,
  };
}

/**
 * Claim LM reward from a position
 */
export async function claimMeteoraDlmmLMReward(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string,
  positionAddress: string
): Promise<MeteoraClaimResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));

  // Fetch full position object
  const positions = await pool.getPositionsByUserAndLbPair(keypair.publicKey);
  const position = (positions?.userPositions || positions || []).find(
    (p: any) => (p.publicKey?.toBase58?.() || p.address) === positionAddress
  );
  if (!position) throw new Error(`Position not found: ${positionAddress}`);

  const tx = await pool.claimLMReward({
    owner: keypair.publicKey,
    position,
  });

  // Handle transaction array
  const txToSend = Array.isArray(tx) ? tx[0] : tx;
  const signature = await signAndSendTransaction(connection, keypair, txToSend);

  return {
    signatures: [signature],
    positionAddresses: [positionAddress],
  };
}

/**
 * Claim all rewards (fees + LM) from a position
 */
export async function claimAllMeteoraDlmmRewards(
  connection: Connection,
  keypair: Keypair,
  poolAddress: string,
  positionAddress: string
): Promise<MeteoraClaimResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));

  // Fetch full position object
  const positions = await pool.getPositionsByUserAndLbPair(keypair.publicKey);
  const position = (positions?.userPositions || positions || []).find(
    (p: any) => (p.publicKey?.toBase58?.() || p.address) === positionAddress
  );
  if (!position) throw new Error(`Position not found: ${positionAddress}`);

  const tx = await pool.claimAllRewardsByPosition({
    owner: keypair.publicKey,
    position,
  });

  // Handle transaction array
  const txToSend = Array.isArray(tx) ? tx[0] : tx;
  const signature = await signAndSendTransaction(connection, keypair, txToSend);

  return {
    signatures: [signature],
    positionAddresses: [positionAddress],
  };
}

// ============================================
// POOL INFO QUERIES
// ============================================

/**
 * Get active bin info (current price bin)
 */
export async function getMeteoraDlmmActiveBin(
  connection: Connection,
  poolAddress: string
): Promise<MeteoraActiveBinInfo> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));
  const activeBin = await pool.getActiveBin();

  return {
    binId: activeBin.binId,
    price: activeBin.price?.toString?.() || '',
    pricePerToken: activeBin.pricePerToken?.toString?.() || pool.fromPricePerLamport(Number(activeBin.price))?.toString?.() || '',
    xAmount: activeBin.xAmount?.toString?.() || '0',
    yAmount: activeBin.yAmount?.toString?.() || '0',
  };
}

/**
 * Get fee info for pool
 */
export async function getMeteoraDlmmFeeInfo(
  connection: Connection,
  poolAddress: string
): Promise<MeteoraFeeInfo> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));
  const feeInfo = await pool.getFeeInfo() as any;

  return {
    baseFeeRate: feeInfo?.baseFeeRate?.toString?.() || feeInfo?.baseFeeRatePercentage?.toString?.() || feeInfo?.baseFeeBps?.toString?.() || '',
    maxFeeRate: feeInfo?.maxFeeRate?.toString?.() || feeInfo?.maxFeeRatePercentage?.toString?.() || feeInfo?.maxFeeBps?.toString?.() || '',
    protocolFeeRate: feeInfo?.protocolFeeRate?.toString?.() || feeInfo?.protocolFeePercentage?.toString?.() || feeInfo?.protocolFeeBps?.toString?.() || '',
  };
}

/**
 * Get dynamic fee (volatility-adjusted)
 */
export async function getMeteoraDlmmDynamicFee(
  connection: Connection,
  poolAddress: string
): Promise<string> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));
  const dynamicFee = await pool.getDynamicFee();

  return dynamicFee?.toString?.() || '';
}

/**
 * Get LM reward emission rates
 */
export async function getMeteoraDlmmEmissionRate(
  connection: Connection,
  poolAddress: string
): Promise<MeteoraEmissionRate[]> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const pool = await DLMM.create(connection, new PublicKey(poolAddress));
  const emissionRate = await pool.getEmissionRate();

  if (!emissionRate) return [];

  const rates = Array.isArray(emissionRate) ? emissionRate : [emissionRate];
  return rates.map((r: any) => ({
    rewardMint: r.rewardMint?.toBase58?.() || r.rewardMint || '',
    rewardPerSecond: r.rewardPerSecond?.toString?.() || '0',
    rewardDurationEnd: r.rewardDurationEnd ?? 0,
  }));
}

// ============================================
// POOL CREATION
// ============================================

/**
 * Create new LB pair (standard)
 */
export async function createMeteoraDlmmPool(
  connection: Connection,
  keypair: Keypair,
  params: MeteoraCreatePoolParams
): Promise<MeteoraCreatePoolResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  // Get preset parameters for the bin step
  const presetsResult = await DLMM.getAllPresetParameters(connection);
  // Presets can be an object with presetParameter/presetParameter2 arrays or a direct array
  const presetsArray = Array.isArray(presetsResult)
    ? presetsResult
    : [...(presetsResult?.presetParameter || []), ...(presetsResult?.presetParameter2 || [])];
  const preset = presetsArray.find((p: any) => p.account?.binStep === params.binStep);
  if (!preset) throw new Error(`No preset found for binStep ${params.binStep}`);

  const tx = await DLMM.createLbPair(
    connection,
    keypair.publicKey,
    new PublicKey(params.tokenX),
    new PublicKey(params.tokenY),
    new BN(params.binStep),
    new BN(preset.account.baseFactor),
    preset.publicKey,
    new BN(params.activeId ?? 0)
  );

  const signature = await signAndSendTransaction(connection, keypair, tx);

  // Derive pool address (this is approximate - actual address returned in events)
  const poolAddress = await DLMM.getPairPubkeyIfExists(
    connection,
    new PublicKey(params.tokenX),
    new PublicKey(params.tokenY),
    new BN(params.binStep),
    new BN(preset.account.baseFactor),
    new BN(preset.account.baseFeePowerFactor ?? 0)
  );

  return {
    signature,
    poolAddress: poolAddress?.toBase58?.() || '',
    tokenX: params.tokenX,
    tokenY: params.tokenY,
  };
}

/**
 * Create customizable permissionless LB pair
 */
export async function createCustomizableMeteoraDlmmPool(
  connection: Connection,
  keypair: Keypair,
  params: MeteoraCreatePoolParams
): Promise<MeteoraCreatePoolResult> {
  const dlmm = await import('@meteora-ag/dlmm');
  const DLMM = dlmm.default || (dlmm as any).DLMM;
  if (!DLMM) throw new Error('Meteora DLMM SDK not available.');

  const activationTypeMap: Record<string, number> = { Slot: 0, Timestamp: 1 };
  const activationType = activationTypeMap[params.activationType || 'Slot'] ?? 0;

  const tx = await DLMM.createCustomizablePermissionlessLbPair(
    connection,
    new BN(params.binStep),
    new PublicKey(params.tokenX),
    new PublicKey(params.tokenY),
    new BN(params.activeId ?? 0),
    new BN(params.feeBps ?? 25),
    activationType,
    params.hasAlphaVault ?? false,
    keypair.publicKey
  );

  const signature = await signAndSendTransaction(connection, keypair, tx);

  const poolAddress = await DLMM.getCustomizablePermissionlessLbPairIfExists(
    connection,
    new PublicKey(params.tokenX),
    new PublicKey(params.tokenY)
  );

  return {
    signature,
    poolAddress: poolAddress?.toBase58?.() || '',
    tokenX: params.tokenX,
    tokenY: params.tokenY,
  };
}
