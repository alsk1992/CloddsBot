/**
 * Percolator type definitions — config, market state, positions.
 */

import type { PublicKey } from '@solana/web3.js';

export interface PercolatorConfig {
  enabled?: boolean;                    // default: false
  rpcUrl?: string;                      // default: env SOLANA_RPC_URL
  programId?: string;                   // devnet: 2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp
  slabAddress?: string;                 // market slab pubkey
  matcherProgram?: string;              // matcher program pubkey
  matcherContext?: string;              // matcher context account
  oracleAddress?: string;               // Chainlink/Pyth oracle pubkey
  lpIndex?: number;                     // preferred LP index for trading
  pollIntervalMs?: number;              // default: 2000 (2s)
  keeperEnabled?: boolean;              // default: false
  keeperIntervalMs?: number;            // default: 5000 (5s)
  dryRun?: boolean;                     // default: true
  spreadBps?: number;                   // LP spread in bps, default: 50
}

/** Default RPC URL when none configured (devnet) */
export const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';

export interface PercolatorMarketState {
  oraclePrice: bigint;
  oraclePriceUsd: number;
  oracleDecimals: number;
  totalOpenInterest: bigint;
  vault: bigint;
  insuranceFund: bigint;
  fundingRate: bigint;
  bestBid: { lpIndex: number; price: bigint; priceUsd: number } | null;
  bestAsk: { lpIndex: number; price: bigint; priceUsd: number } | null;
  spreadBps: number;
  lastCrankSlot: bigint;
}

export interface PercolatorPosition {
  accountIndex: number;
  capital: bigint;
  positionSize: bigint;     // positive = long, negative = short
  entryPrice: bigint;
  pnl: bigint;
  fundingIndex: bigint;
  owner: PublicKey;
}
