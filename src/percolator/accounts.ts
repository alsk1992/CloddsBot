/**
 * Percolator account specifications for building instruction account metas.
 * Adapted from percolator-cli/src/abi/accounts.ts — subset needed for trading.
 */

import {
  PublicKey,
  AccountMeta,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export interface AccountSpec {
  name: string;
  signer: boolean;
  writable: boolean;
}

// ============================================================================
// Account orderings (match Rust processor)
// ============================================================================

export const ACCOUNTS_INIT_USER: readonly AccountSpec[] = [
  { name: 'user', signer: true, writable: false },
  { name: 'slab', signer: false, writable: true },
  { name: 'userAta', signer: false, writable: true },
  { name: 'vault', signer: false, writable: true },
  { name: 'tokenProgram', signer: false, writable: false },
] as const;

export const ACCOUNTS_DEPOSIT_COLLATERAL: readonly AccountSpec[] = [
  { name: 'user', signer: true, writable: false },
  { name: 'slab', signer: false, writable: true },
  { name: 'userAta', signer: false, writable: true },
  { name: 'vault', signer: false, writable: true },
  { name: 'tokenProgram', signer: false, writable: false },
  { name: 'clock', signer: false, writable: false },
] as const;

export const ACCOUNTS_WITHDRAW_COLLATERAL: readonly AccountSpec[] = [
  { name: 'user', signer: true, writable: false },
  { name: 'slab', signer: false, writable: true },
  { name: 'vault', signer: false, writable: true },
  { name: 'userAta', signer: false, writable: true },
  { name: 'vaultPda', signer: false, writable: false },
  { name: 'tokenProgram', signer: false, writable: false },
  { name: 'clock', signer: false, writable: false },
  { name: 'oracleIdx', signer: false, writable: false },
] as const;

export const ACCOUNTS_KEEPER_CRANK: readonly AccountSpec[] = [
  { name: 'caller', signer: true, writable: false },
  { name: 'slab', signer: false, writable: true },
  { name: 'clock', signer: false, writable: false },
  { name: 'oracle', signer: false, writable: false },
] as const;

export const ACCOUNTS_TRADE_CPI: readonly AccountSpec[] = [
  { name: 'user', signer: true, writable: false },
  { name: 'lpOwner', signer: false, writable: false },
  { name: 'slab', signer: false, writable: true },
  { name: 'clock', signer: false, writable: false },
  { name: 'oracle', signer: false, writable: false },
  { name: 'matcherProg', signer: false, writable: false },
  { name: 'matcherCtx', signer: false, writable: true },
  { name: 'lpPda', signer: false, writable: false },
] as const;

// ============================================================================
// Account meta builder
// ============================================================================

export function buildAccountMetas(
  spec: readonly AccountSpec[],
  keys: PublicKey[],
): AccountMeta[] {
  if (keys.length !== spec.length) {
    throw new Error(
      `Account count mismatch: expected ${spec.length}, got ${keys.length}`,
    );
  }
  return spec.map((s, i) => ({
    pubkey: keys[i],
    isSigner: s.signer,
    isWritable: s.writable,
  }));
}

// ============================================================================
// Well-known keys
// ============================================================================

export const WELL_KNOWN = {
  tokenProgram: TOKEN_PROGRAM_ID,
  clock: SYSVAR_CLOCK_PUBKEY,
  systemProgram: SystemProgram.programId,
} as const;
