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
