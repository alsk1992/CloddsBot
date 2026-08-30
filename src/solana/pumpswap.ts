/**
 * PumpSwap — the AMM pump.fun tokens graduate to after their bonding curve
 * completes (distinct from the bonding-curve program in pumpapi.ts).
 *
 * Built on the official @pump-fun/pump-swap-sdk rather than hand-rolled
 * instruction encoding, so swap output is computed from the pool's actual
 * on-chain reserves and fee config, not guessed constants.
 *
 * PumpSwap is permissionless (like Raydium) — anyone can create a pool for
 * any mint pair, so a given token can have many pools. There is a
 * `canonicalPumpPoolPda` deterministic-derivation helper in the SDK, but it
 * only resolves the pool auto-created by bonding-curve graduation; verified
 * against live mainnet data that many real, liquid pools exist outside that
 * derivation (e.g. PUMP itself — pump.fun's own token — was never
 * bonding-curve-graduated and has 63 real pools, none at the canonical
 * address). So pool selection here searches on-chain by mint pair and picks
 * the highest-liquidity match, the same pattern used for Orca/Raydium/
 * Meteora in pools.ts.
 */
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';
import {
  OnlinePumpAmmSdk,
  buyQuoteInput,
  sellBaseInput,
  PUMP_AMM_PROGRAM_ID,
} from '@pump-fun/pump-swap-sdk';

export { PUMP_AMM_PROGRAM_ID };

// Anchor account discriminator for the Pool struct — first 8 bytes,
// base58-encoded for the memcmp filter. Verified against
// PUMP_AMM_SDK.offlineProgram.account.pool.discriminator on the installed SDK.
const POOL_DISCRIMINATOR_BASE58 = 'hQrXeCntzbV';
// Byte offsets of Pool struct fields after the 8-byte discriminator:
// pool_bump: u8 (1) + index: u16 (2) + creator: Pubkey (32) = 35, then base_mint.
const BASE_MINT_OFFSET = 8 + 1 + 2 + 32;
const QUOTE_MINT_OFFSET = BASE_MINT_OFFSET + 32;
// Cap how many candidate pools we'll fetch full state for for a single quote —
// generous for anything but the smallest handful of tokens (PUMP itself, an
// extreme outlier, has 63 pools against all sorts of quote mints; a typical
// graduated token paired against WSOL specifically has far fewer).
const MAX_POOL_CANDIDATES = 10;

// A quote-only call still needs *a* user pubkey to derive associated token
// account addresses, but those accounts don't need to exist — swapSolanaState
// tolerates missing user accounts and we never read them for a quote.
const QUOTE_ONLY_USER = SystemProgram.programId;

export interface PumpSwapQuoteParams {
  connection: Connection;
  /** The pump.fun token mint. */
  mint: string;
  /** Defaults to wrapped SOL, which is what most liquid pools are paired against. */
  quoteMint?: string;
  /** 'buy' spends quoteMint to receive mint; 'sell' spends mint to receive quoteMint. */
  side: 'buy' | 'sell';
  /** Raw amount in, in the input token's smallest unit. */
  amountIn: string;
  slippageBps?: number;
}

export interface PumpSwapQuote {
  poolAddress: string;
  side: 'buy' | 'sell';
  amountIn: string;
  /** Expected output before slippage, in the output token's smallest unit. */
  amountOut: string;
  /** Worst-case output/input bound after applying slippageBps. */
  amountLimit: string;
  poolBaseReserve: string;
  poolQuoteReserve: string;
}

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** Find every PumpSwap pool for a given (base, quote) mint pair. */
export async function findPumpSwapPools(
  connection: Connection,
  baseMint: PublicKey,
  quoteMint: PublicKey
): Promise<PublicKey[]> {
  const accounts = await connection.getProgramAccounts(PUMP_AMM_PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: POOL_DISCRIMINATOR_BASE58 } },
      { memcmp: { offset: BASE_MINT_OFFSET, bytes: baseMint.toBase58() } },
      { memcmp: { offset: QUOTE_MINT_OFFSET, bytes: quoteMint.toBase58() } },
    ],
    dataSlice: { offset: 0, length: 0 }, // we only need the addresses here
  });
  return accounts.map((a) => a.pubkey);
}

/**
 * Quote a PumpSwap trade using real on-chain reserves and fee config,
 * searching for the highest-liquidity pool for the mint pair.
 */
export async function getPumpSwapQuote(params: PumpSwapQuoteParams): Promise<PumpSwapQuote> {
  const { connection, mint, quoteMint, side, amountIn, slippageBps = 50 } = params;
  const baseMint = new PublicKey(mint);
  const quoteMintKey = new PublicKey(quoteMint ?? WSOL_MINT);

  const candidates = await findPumpSwapPools(connection, baseMint, quoteMintKey);
  if (candidates.length === 0) {
    throw new Error(`No PumpSwap pool found for ${baseMint.toBase58()}/${quoteMintKey.toBase58()}`);
  }

  const onlineSdk = new OnlinePumpAmmSdk(connection);
  const states = await Promise.all(
    candidates.slice(0, MAX_POOL_CANDIDATES).map(async (poolKey) => {
      try {
        return { poolKey, state: await onlineSdk.swapSolanaState(poolKey, QUOTE_ONLY_USER) };
      } catch {
        return null; // a stale/malformed pool account shouldn't fail the whole quote
      }
    })
  );

  const best = states
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.state.poolQuoteAmount.cmp(a.state.poolQuoteAmount))[0];
  if (!best) {
    throw new Error(`All ${candidates.length} PumpSwap pool candidates for ${baseMint.toBase58()} failed to load`);
  }

  const { poolKey, state } = best;
  const slippagePercent = slippageBps / 100;

  if (side === 'buy') {
    const result = buyQuoteInput({
      quote: new BN(amountIn),
      slippage: slippagePercent,
      baseReserve: state.poolBaseAmount,
      quoteReserve: state.poolQuoteAmount,
      globalConfig: state.globalConfig,
      baseMintAccount: state.baseMintAccount,
      baseMint: state.baseMint,
      coinCreator: state.pool.coinCreator,
      creator: state.pool.coinCreator,
      feeConfig: state.feeConfig,
    });
    return {
      poolAddress: poolKey.toBase58(),
      side,
      amountIn,
      amountOut: result.base.toString(),
      amountLimit: result.maxQuote.toString(),
      poolBaseReserve: state.poolBaseAmount.toString(),
      poolQuoteReserve: state.poolQuoteAmount.toString(),
    };
  }

  const result = sellBaseInput({
    base: new BN(amountIn),
    slippage: slippagePercent,
    baseReserve: state.poolBaseAmount,
    quoteReserve: state.poolQuoteAmount,
    globalConfig: state.globalConfig,
    baseMintAccount: state.baseMintAccount,
    baseMint: state.baseMint,
    coinCreator: state.pool.coinCreator,
    creator: state.pool.coinCreator,
    feeConfig: state.feeConfig,
  });
  return {
    poolAddress: poolKey.toBase58(),
    side,
    amountIn,
    amountOut: result.uiQuote.toString(),
    amountLimit: result.minQuote.toString(),
    poolBaseReserve: state.poolBaseAmount.toString(),
    poolQuoteReserve: state.poolQuoteAmount.toString(),
  };
}
