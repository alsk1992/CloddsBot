import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { signAndSendVersionedTransaction } from './wallet';

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
  computeUrl.searchParams.set(swapMode === 'BaseOut' ? 'outputAmount' : 'inputAmount', params.amount);
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
  computeUrl.searchParams.set(swapMode === 'BaseOut' ? 'outputAmount' : 'inputAmount', params.amount);
  computeUrl.searchParams.set('slippageBps', slippageBps.toString());
  computeUrl.searchParams.set('txVersion', 'V0');

  const response = await fetch(computeUrl.toString());
  if (!response.ok) {
    throw new Error(`Raydium compute error: ${response.status}`);
  }

  const data = await response.json() as any;
  const summary = data?.data ?? data;

  return {
    outAmount: summary?.outAmount?.toString?.() ?? summary?.outAmount,
    minOutAmount: summary?.minOutAmount?.toString?.() ?? summary?.minOutAmount,
    priceImpact: summary?.priceImpact ? Number(summary.priceImpact) : undefined,
    raw: summary,
  };
}

export async function listRaydiumPools(filters?: {
  tokenMints?: string[];
  limit?: number;
}): Promise<RaydiumPoolInfo[]> {
  const baseUrl = process.env.RAYDIUM_POOL_LIST_URL || 'https://api.raydium.io/v2/sdk/liquidity/mainnet.json';
  const response = await fetch(baseUrl);
  if (!response.ok) {
    throw new Error(`Raydium pool list error: ${response.status}`);
  }

  const data = await response.json() as any;
  const pools: any[] = [];

  if (Array.isArray(data)) {
    pools.push(...data);
  } else if (data?.official || data?.unOfficial) {
    if (Array.isArray(data.official)) pools.push(...data.official);
    if (Array.isArray(data.unOfficial)) pools.push(...data.unOfficial);
  } else if (data?.data?.pools) {
    pools.push(...data.data.pools);
  } else if (data?.data?.poolList) {
    pools.push(...data.data.poolList);
  }

  const tokenMints = (filters?.tokenMints || []).map((m) => m.toLowerCase());
  const limit = filters?.limit && filters.limit > 0 ? filters.limit : 50;
  const results: RaydiumPoolInfo[] = [];

  for (const pool of pools) {
    const baseMint = pool.baseMint || pool.baseMintAddress || pool.baseMintId || pool.baseMintMint || pool.mintA;
    const quoteMint = pool.quoteMint || pool.quoteMintAddress || pool.quoteMintId || pool.mintB;
    if (!baseMint || !quoteMint) continue;

    if (tokenMints.length > 0) {
      const matches = tokenMints.every((mint) =>
        [String(baseMint).toLowerCase(), String(quoteMint).toLowerCase()].includes(mint)
      );
      if (!matches) continue;
    }

    results.push({
      id: pool.id || pool.ammId || pool.poolId,
      name: pool.name || pool.symbol,
      baseMint: String(baseMint),
      quoteMint: String(quoteMint),
      lpMint: pool.lpMint || pool.lpMintAddress,
      marketId: pool.marketId || pool.market,
      type: pool.version ? `v${pool.version}` : pool.type,
      liquidity: Number(pool.liquidity ?? pool.tvl ?? pool.reserve ?? 0) || undefined,
      volume24h: Number(pool.volume24h ?? pool.volume ?? pool.day?.volume ?? 0) || undefined,
    });

    if (results.length >= limit) break;
  }

  return results;
}
