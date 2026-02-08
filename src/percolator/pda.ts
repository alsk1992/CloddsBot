/**
 * Percolator PDA derivation.
 * Adapted from percolator-cli/src/solana/pda.ts
 */

import { PublicKey } from '@solana/web3.js';

/**
 * Derive vault authority PDA.
 * Seeds: ["vault", slab_key]
 */
export function deriveVaultAuthority(
  programId: PublicKey,
  slab: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), slab.toBuffer()],
    programId,
  );
}

/**
 * Derive LP PDA for TradeCpi.
 * Seeds: ["lp", slab_key, lp_idx as u16 LE]
 */
export function deriveLpPda(
  programId: PublicKey,
  slab: PublicKey,
  lpIdx: number,
): [PublicKey, number] {
  const idxBuf = Buffer.alloc(2);
  idxBuf.writeUInt16LE(lpIdx, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lp'), slab.toBuffer(), idxBuf],
    programId,
  );
}
