/**
 * Swarm Transaction Builders
 *
 * DEX-specific transaction builders for the multi-wallet swarm trading system.
 * Each builder knows how to construct buy/sell transactions for its DEX.
 *
 * The swarm execution layer (pump-swarm.ts) is DEX-agnostic - it only needs
 * VersionedTransaction objects. These builders provide that abstraction.
 */

import {
  Connection,
  VersionedTransaction,
  Keypair,
  ComputeBudgetProgram,
  TransactionMessage,
} from '@solana/web3.js';
import { buildPumpFunTradeInstructions, assertSupportedPumpPool } from './pumpapi';
import { findBestPumpSwapState } from './pumpswap';
import { PUMP_AMM_SDK } from '@pump-fun/pump-swap-sdk';

// ============================================================================
// Types
// ============================================================================

export interface SwarmWallet {
  id: string;
  keypair: Keypair;
  publicKey: string;
  solBalance: number;
  positions: Map<string, number>;
  lastTradeAt: number;
  enabled: boolean;
}

export interface BuilderOptions {
  slippageBps: number;
  priorityFeeLamports?: number;
  poolAddress?: string; // For Meteora - specific pool
  pool?: string; // For PumpFun - pump/raydium/auto
}

export interface SwarmQuote {
  inputAmount: number;
  outputAmount: number;
  priceImpact?: number;
  route?: string;
}

export interface SwarmTransactionBuilder {
  name: string;
  supportedPools: string[];

  buildBuyTransaction(
    connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    amountSol: number,
    options: BuilderOptions
  ): Promise<VersionedTransaction>;

  buildSellTransaction(
    connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    tokenAmount: number,
    options: BuilderOptions
  ): Promise<VersionedTransaction>;

  getQuote?(
    connection: Connection,
    mint: string,
    amount: number,
    isBuy: boolean,
    options?: Partial<BuilderOptions>
  ): Promise<SwarmQuote>;
}

// ============================================================================
// Constants
// ============================================================================

const BAGS_API = 'https://public-api-v2.bags.fm/api/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ============================================================================
// PumpFun Builder (official @pump-fun/pump-sdk — built and signed locally,
// no third-party relay round-trip. See buildPumpFunTradeInstructions in
// pumpapi.ts, which this shares with the single-wallet trading path.)
// ============================================================================

export class PumpFunBuilder implements SwarmTransactionBuilder {
  name = 'pumpfun';
  supportedPools = ['pump', 'auto'];

  private async buildTransaction(
    connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    amount: number,
    action: 'buy' | 'sell',
    denominatedInSol: boolean,
    options: BuilderOptions
  ): Promise<VersionedTransaction> {
    assertSupportedPumpPool(options.pool);

    // See pumpapi.ts's executePumpFunTrade for why this runs concurrently
    // with instruction-building rather than after it.
    const [{ instructions }, { blockhash }] = await Promise.all([
      buildPumpFunTradeInstructions(connection, wallet.keypair.publicKey, {
        mint,
        action,
        amount,
        denominatedInSol,
        slippagePercent: options.slippageBps / 100,
      }),
      connection.getLatestBlockhash('confirmed'),
    ]);

    const allInstructions = [...instructions];
    if (options.priorityFeeLamports) {
      const computeUnitLimit = 200_000;
      const microLamports = Math.max(1, Math.floor((options.priorityFeeLamports * 1_000_000) / computeUnitLimit));
      allInstructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
      );
    }

    const message = new TransactionMessage({
      payerKey: wallet.keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message();

    return new VersionedTransaction(message);
  }

  async buildBuyTransaction(
    connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    amountSol: number,
    options: BuilderOptions
  ): Promise<VersionedTransaction> {
    return this.buildTransaction(connection, wallet, mint, amountSol, 'buy', true, options);
  }

  async buildSellTransaction(
    connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    tokenAmount: number,
    options: BuilderOptions
  ): Promise<VersionedTransaction> {
    return this.buildTransaction(connection, wallet, mint, tokenAmount, 'sell', false, options);
  }

  async getQuote(
    connection: Connection,
    mint: string,
    amount: number,
    isBuy: boolean,
    _options?: Partial<BuilderOptions>
  ): Promise<SwarmQuote> {
    const { getPumpFunQuote } = await import('./pumpapi');
    const quote = await getPumpFunQuote({
      mint,
      action: isBuy ? 'buy' : 'sell',
      amount: amount.toString(), // human-readable units (SOL for buy, tokens for sell) — getPumpFunQuote scales internally
      connection,
    });

    if (!quote) {
      return { inputAmount: amount, outputAmount: 0, route: 'pumpfun' };
    }

    const outputAmount = isBuy
      ? Number(quote.outputAmount) / 1e6 // tokens, 6dp
      : Number(quote.outputAmount) / 1e9; // lamports -> SOL

    return { inputAmount: amount, outputAmount, route: 'pumpfun' };
  }
}

// ============================================================================
// PumpSwap Builder — for tokens that have graduated off the bonding curve.
// Built locally via the official @pump-fun/pump-swap-sdk (PUMP_AMM_SDK),
// same pool-selection logic (findBestPumpSwapState in pumpswap.ts) used by
// getPumpSwapQuote, so a quote and the trade it's for hit the same pool.
// ============================================================================

const PUMPSWAP_WSOL_MINT = 'So11111111111111111111111111111111111111112';

export class PumpSwapBuilder implements SwarmTransactionBuilder {
  name = 'pumpswap';
  supportedPools = ['pumpswap'];

  private async buildTransaction(
    connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    amount: number,
    side: 'buy' | 'sell',
    options: BuilderOptions
  ): Promise<VersionedTransaction> {
    const { PublicKey } = await import('@solana/web3.js');
    const BN = (await import('bn.js')).default;

    const baseMint = new PublicKey(mint);
    const quoteMint = new PublicKey(PUMPSWAP_WSOL_MINT);
    const slippagePercent = options.slippageBps / 100;

    // getLatestBlockhash doesn't depend on pool state (or vice versa) — fire
    // both concurrently rather than paying for this RPC round-trip only
    // after pool discovery/state-fetch finishes.
    const [{ state }, { blockhash }] = await Promise.all([
      findBestPumpSwapState(connection, baseMint, quoteMint, wallet.keypair.publicKey),
      connection.getLatestBlockhash('confirmed'),
    ]);

    // buy is quote-denominated (SOL, 9dp), sell is base-denominated (pump.fun token, 6dp) —
    // same convention as PumpFunBuilder and getPumpSwapQuote.
    const amountIn = side === 'buy'
      ? new BN(Math.floor(amount * 1e9))
      : new BN(Math.floor(amount * 1e6));

    const instructions = side === 'buy'
      ? await PUMP_AMM_SDK.buyQuoteInput(state, amountIn, slippagePercent)
      : await PUMP_AMM_SDK.sellBaseInput(state, amountIn, slippagePercent);

    const allInstructions = [...instructions];
    if (options.priorityFeeLamports) {
      // See executePumpSwapTrade in pumpswap.ts for the full rationale —
      // PumpSwap's worst-case instruction bundle (extendAccount + ATA +
      // WSOL wrap/close + boost accounts) can exceed a plain 200k CU
      // budget; raising this doesn't change actual lamports spent on
      // priority fee, since microLamports is derived from
      // priorityFeeLamports/computeUnitLimit below.
      const computeUnitLimit = 400_000;
      const microLamports = Math.max(1, Math.floor((options.priorityFeeLamports * 1_000_000) / computeUnitLimit));
      allInstructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
      );
    }

    const message = new TransactionMessage({
      payerKey: wallet.keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message();

    return new VersionedTransaction(message);
  }

  async buildBuyTransaction(
    connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    amountSol: number,
    options: BuilderOptions
  ): Promise<VersionedTransaction> {
    return this.buildTransaction(connection, wallet, mint, amountSol, 'buy', options);
  }

  async buildSellTransaction(
    connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    tokenAmount: number,
    options: BuilderOptions
  ): Promise<VersionedTransaction> {
    return this.buildTransaction(connection, wallet, mint, tokenAmount, 'sell', options);
  }

  async getQuote(
    connection: Connection,
    mint: string,
    amount: number,
    isBuy: boolean,
    _options?: Partial<BuilderOptions>
  ): Promise<SwarmQuote> {
    const { getPumpSwapQuote } = await import('./pumpswap');
    const BN = (await import('bn.js')).default;
    const rawAmountIn = isBuy ? Math.floor(amount * 1e9) : Math.floor(amount * 1e6);

    const quote = await getPumpSwapQuote({
      connection,
      mint,
      side: isBuy ? 'buy' : 'sell',
      amountIn: new BN(rawAmountIn).toString(),
    });

    const outputAmount = isBuy
      ? Number(quote.amountOut) / 1e6 // tokens, 6dp
      : Number(quote.amountOut) / 1e9; // lamports -> SOL

    return { inputAmount: amount, outputAmount, route: 'pumpswap' };
  }
}

// ============================================================================
// Bags Builder (Bags.fm API)
// ============================================================================

export class BagsBuilder implements SwarmTransactionBuilder {
  name = 'bags';
  supportedPools = ['bags'];

  private async bagsRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const apiKey = process.env.BAGS_API_KEY;
    if (!apiKey) {
      throw new Error('BAGS_API_KEY not configured. Get one at dev.bags.fm');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${BAGS_API}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bags API error: ${response.status} - ${error}`);
    }
    const json = await response.json() as { success?: boolean; response?: T; error?: string };
    if (json.success === false) {
      throw new Error(`Bags API error: ${json.error || 'Unknown error'}`);
    }
    return (json.response !== undefined ? json.response : json) as T;
  }

  async buildBuyTransaction(
    _connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    amountSol: number,
    _options: BuilderOptions
  ): Promise<VersionedTransaction> {
    const amountLamports = Math.floor(amountSol * 1e9);

    // Step 1: Get quote
    const quote = await this.bagsRequest<Record<string, unknown>>(
      `/trade/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=${amountLamports}&slippageMode=auto`
    );

    // Step 2: Create swap from quote
    const txResponse = await this.bagsRequest<{ swapTransaction: string }>('/trade/swap', {
      method: 'POST',
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey,
      }),
    });

    // Base58 encoded
    const { bs58 } = await import('@coral-xyz/anchor/dist/cjs/utils/bytes');
    return VersionedTransaction.deserialize(bs58.decode(txResponse.swapTransaction));
  }

  async buildSellTransaction(
    _connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    tokenAmount: number,
    _options: BuilderOptions
  ): Promise<VersionedTransaction> {
    // Step 1: Get quote
    const quote = await this.bagsRequest<Record<string, unknown>>(
      `/trade/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${Math.floor(tokenAmount)}&slippageMode=auto`
    );

    // Step 2: Create swap from quote
    const txResponse = await this.bagsRequest<{ swapTransaction: string }>('/trade/swap', {
      method: 'POST',
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey,
      }),
    });

    // Base58 encoded
    const { bs58 } = await import('@coral-xyz/anchor/dist/cjs/utils/bytes');
    return VersionedTransaction.deserialize(bs58.decode(txResponse.swapTransaction));
  }

  async getQuote(
    _connection: Connection,
    mint: string,
    amount: number,
    isBuy: boolean,
    _options?: Partial<BuilderOptions>
  ): Promise<SwarmQuote> {
    const inputMint = isBuy ? SOL_MINT : mint;
    const outputMint = isBuy ? mint : SOL_MINT;
    const amountStr = isBuy ? Math.floor(amount * 1e9).toString() : Math.floor(amount).toString();

    const quote = await this.bagsRequest<{
      inAmount: string;
      outAmount: string;
      priceImpactPct: string;
    }>(`/trade/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountStr}&slippageMode=auto`);

    const inAmt = parseFloat(quote.inAmount);
    const outAmt = parseFloat(quote.outAmount);
    const impact = parseFloat(quote.priceImpactPct);

    return {
      inputAmount: Number.isFinite(inAmt) ? inAmt : 0,
      outputAmount: Number.isFinite(outAmt) ? outAmt : 0,
      priceImpact: Number.isFinite(impact) ? impact / 100 : undefined,
      route: 'bags',
    };
  }
}

// ============================================================================
// Meteora Builder (DLMM SDK)
// ============================================================================

export class MeteoraBuilder implements SwarmTransactionBuilder {
  name = 'meteora';
  supportedPools = ['meteora', 'dlmm'];

  // Cache for pool lookups
  private poolCache: Map<string, { address: string; timestamp: number }> = new Map();
  private CACHE_TTL_MS = 60000; // 1 minute

  /**
   * Convert a legacy Transaction to VersionedTransaction
   */
  private async toVersionedTransaction(
    connection: Connection,
    tx: import('@solana/web3.js').Transaction,
    payer: import('@solana/web3.js').PublicKey
  ): Promise<VersionedTransaction> {
    const { TransactionMessage } = await import('@solana/web3.js');

    // Get recent blockhash if not set
    if (!tx.recentBlockhash) {
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
    }
    if (!tx.feePayer) {
      tx.feePayer = payer;
    }

    // Compile to V0 message
    const messageV0 = new TransactionMessage({
      payerKey: tx.feePayer,
      recentBlockhash: tx.recentBlockhash,
      instructions: tx.instructions,
    }).compileToV0Message();

    return new VersionedTransaction(messageV0);
  }

  async buildBuyTransaction(
    connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    amountSol: number,
    options: BuilderOptions
  ): Promise<VersionedTransaction> {
    const dlmm = await import('@meteora-ag/dlmm');
    const DLMM = dlmm.default || (dlmm as unknown as { DLMM: typeof dlmm.default }).DLMM;
    const { PublicKey } = await import('@solana/web3.js');
    const { BN } = await import('@coral-xyz/anchor');

    // Get or find pool
    const poolAddress = options.poolAddress || await this.findPoolAddress(connection, mint);
    if (!poolAddress) {
      throw new Error(`No Meteora DLMM pool found for ${mint}`);
    }

    const pool = await DLMM.create(connection, new PublicKey(poolAddress));

    // Determine swap direction (SOL → Token)
    const tokenXMint = pool.tokenX.publicKey.toBase58();
    const swapForY = tokenXMint === SOL_MINT;

    const swapAmount = new BN(Math.floor(amountSol * 1e9));
    const binArrays = await pool.getBinArrayForSwap(swapForY);
    const quote = await pool.swapQuote(swapAmount, swapForY, new BN(options.slippageBps), binArrays);

    const swapTx = await pool.swap({
      inToken: swapForY ? pool.tokenX.publicKey : pool.tokenY.publicKey,
      outToken: swapForY ? pool.tokenY.publicKey : pool.tokenX.publicKey,
      inAmount: swapAmount,
      minOutAmount: quote.minOutAmount,
      lbPair: pool.pubkey,
      user: wallet.keypair.publicKey,
      binArraysPubkey: quote.binArraysPubkey,
    });

    // Convert legacy Transaction to VersionedTransaction
    return this.toVersionedTransaction(connection, swapTx, wallet.keypair.publicKey);
  }

  async buildSellTransaction(
    connection: Connection,
    wallet: SwarmWallet,
    mint: string,
    tokenAmount: number,
    options: BuilderOptions
  ): Promise<VersionedTransaction> {
    const dlmm = await import('@meteora-ag/dlmm');
    const DLMM = dlmm.default || (dlmm as unknown as { DLMM: typeof dlmm.default }).DLMM;
    const { PublicKey } = await import('@solana/web3.js');
    const { BN } = await import('@coral-xyz/anchor');

    // Get or find pool
    const poolAddress = options.poolAddress || await this.findPoolAddress(connection, mint);
    if (!poolAddress) {
      throw new Error(`No Meteora DLMM pool found for ${mint}`);
    }

    const pool = await DLMM.create(connection, new PublicKey(poolAddress));

    // Determine swap direction (Token → SOL)
    const tokenXMint = pool.tokenX.publicKey.toBase58();
    const swapForY = tokenXMint !== SOL_MINT; // If X is not SOL, we're swapping X for Y (SOL)

    const swapAmount = new BN(Math.floor(tokenAmount));
    const binArrays = await pool.getBinArrayForSwap(swapForY);
    const quote = await pool.swapQuote(swapAmount, swapForY, new BN(options.slippageBps), binArrays);

    const swapTx = await pool.swap({
      inToken: swapForY ? pool.tokenX.publicKey : pool.tokenY.publicKey,
      outToken: swapForY ? pool.tokenY.publicKey : pool.tokenX.publicKey,
      inAmount: swapAmount,
      minOutAmount: quote.minOutAmount,
      lbPair: pool.pubkey,
      user: wallet.keypair.publicKey,
      binArraysPubkey: quote.binArraysPubkey,
    });

    // Convert legacy Transaction to VersionedTransaction
    return this.toVersionedTransaction(connection, swapTx, wallet.keypair.publicKey);
  }

  async getQuote(
    connection: Connection,
    mint: string,
    amount: number,
    isBuy: boolean,
    options?: Partial<BuilderOptions>
  ): Promise<SwarmQuote> {
    const dlmm = await import('@meteora-ag/dlmm');
    const DLMM = dlmm.default || (dlmm as unknown as { DLMM: typeof dlmm.default }).DLMM;
    const { PublicKey } = await import('@solana/web3.js');
    const { BN } = await import('@coral-xyz/anchor');

    const poolAddress = options?.poolAddress || await this.findPoolAddress(connection, mint);
    if (!poolAddress) {
      throw new Error(`No Meteora DLMM pool found for ${mint}`);
    }

    const pool = await DLMM.create(connection, new PublicKey(poolAddress));
    const tokenXMint = pool.tokenX.publicKey.toBase58();

    let swapForY: boolean;
    let swapAmount: InstanceType<typeof BN>;

    if (isBuy) {
      // SOL → Token
      swapForY = tokenXMint === SOL_MINT;
      swapAmount = new BN(Math.floor(amount * 1e9));
    } else {
      // Token → SOL
      swapForY = tokenXMint !== SOL_MINT;
      swapAmount = new BN(Math.floor(amount));
    }

    const binArrays = await pool.getBinArrayForSwap(swapForY);
    const quote = await pool.swapQuote(swapAmount, swapForY, new BN(options?.slippageBps ?? 500), binArrays);

    return {
      inputAmount: Number(swapAmount.toString()),
      outputAmount: Number(quote.outAmount.toString()),
      priceImpact: quote.priceImpact ? Number(quote.priceImpact.toString()) / 100 : undefined,
      route: 'meteora',
    };
  }

  private async findPoolAddress(connection: Connection, mint: string): Promise<string | null> {
    // Check cache first
    const cached = this.poolCache.get(mint);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.address;
    }

    try {
      // Use Meteora API to find pools for the token
      const response = await fetch(
        `https://dlmm-api.meteora.ag/pair/all_by_groups?token_mints=${mint},${SOL_MINT}`
      );

      if (!response.ok) return null;

      const pools = await response.json() as Array<{
        address: string;
        mint_x: string;
        mint_y: string;
        liquidity?: number;
        trade_volume_24h?: number;
      }>;

      if (!pools || pools.length === 0) return null;

      // Sort by liquidity and pick the best one
      const sorted = pools.sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0));
      const bestPool = sorted[0];

      // Cache the result
      this.poolCache.set(mint, { address: bestPool.address, timestamp: Date.now() });

      return bestPool.address;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Builder Registry
// ============================================================================

export type DexType = 'pumpfun' | 'pumpswap' | 'bags' | 'meteora' | 'auto';

const builders = new Map<string, SwarmTransactionBuilder>();

// Initialize default builders
builders.set('pumpfun', new PumpFunBuilder());
builders.set('pumpswap', new PumpSwapBuilder());
builders.set('bags', new BagsBuilder());
builders.set('meteora', new MeteoraBuilder());

export function getBuilder(dex: DexType): SwarmTransactionBuilder {
  if (dex === 'auto') {
    // Default to pumpfun for auto
    return builders.get('pumpfun')!;
  }

  const builder = builders.get(dex);
  if (!builder) {
    throw new Error(`Unknown DEX: ${dex}. Supported: pumpfun, pumpswap, bags, meteora`);
  }
  return builder;
}

export function registerBuilder(name: string, builder: SwarmTransactionBuilder): void {
  builders.set(name, builder);
}

export function getAvailableBuilders(): string[] {
  return Array.from(builders.keys());
}
