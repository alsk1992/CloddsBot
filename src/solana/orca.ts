import { Connection, Keypair } from '@solana/web3.js';
import { u64 } from '@solana/spl-token';

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
