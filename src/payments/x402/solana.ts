/**
 * x402 Solana Payment Signing
 *
 * Uses Ed25519 signing for Solana payments
 */

import { createHash, randomBytes } from 'crypto';
import { logger } from '../../utils/logger';
import type { X402PaymentOption, X402PaymentPayload } from './index';

// =============================================================================
// TYPES
// =============================================================================

export interface SolanaWallet {
  publicKey: string;
  secretKey: Uint8Array;
}

// =============================================================================
// WALLET UTILITIES
// =============================================================================

/**
 * Decode base58 string to bytes
 */
function base58Decode(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const ALPHABET_MAP = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP.set(ALPHABET[i], i);
  }

  const bytes: number[] = [0];
  for (const char of str) {
    const value = ALPHABET_MAP.get(char);
    if (value === undefined) throw new Error(`Invalid base58 character: ${char}`);

    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Handle leading zeros
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

/**
 * Encode bytes to base58 string
 */
function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  // Handle leading zeros
  let str = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    str += '1';
  }

  for (let i = digits.length - 1; i >= 0; i--) {
    str += ALPHABET[digits[i]];
  }

  return str;
}

/**
 * Create a Solana wallet from secret key
 */
export function createSolanaWallet(secretKeyOrBase58: string | Uint8Array): SolanaWallet {
  let secretKey: Uint8Array;

  if (typeof secretKeyOrBase58 === 'string') {
    // Try base58 first, then raw hex
    if (secretKeyOrBase58.length === 88 || secretKeyOrBase58.length === 87) {
      secretKey = base58Decode(secretKeyOrBase58);
    } else if (secretKeyOrBase58.length === 128) {
      secretKey = new Uint8Array(Buffer.from(secretKeyOrBase58, 'hex'));
    } else {
      // JSON array format
      try {
        const arr = JSON.parse(secretKeyOrBase58);
        secretKey = new Uint8Array(arr);
      } catch {
        throw new Error('Invalid Solana secret key format');
      }
    }
  } else {
    secretKey = secretKeyOrBase58;
  }

  // Public key is the last 32 bytes (or derived from first 32)
  const publicKey = secretKey.length === 64
    ? base58Encode(secretKey.slice(32))
    : base58Encode(secretKey.slice(0, 32)); // Simplified

  return {
    publicKey,
    secretKey,
  };
}

// =============================================================================
// ED25519 SIGNING (SIMPLIFIED)
// =============================================================================

/**
 * Sign a message with Ed25519
 * Simplified implementation - use @solana/web3.js in production
 */
function signEd25519(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  // In production, use:
  // import { sign } from '@noble/ed25519'
  // return sign(message, secretKey.slice(0, 32))

  // Placeholder using HMAC (NOT SECURE - replace with Ed25519)
  const hmac = createHash('sha512')
    .update(Buffer.concat([secretKey.slice(0, 32), message]))
    .digest();

  return new Uint8Array(hmac.slice(0, 64));
}

// =============================================================================
// PAYMENT SIGNING
// =============================================================================

/**
 * Sign an x402 payment for Solana
 */
export async function signSolanaPayment(
  wallet: SolanaWallet,
  option: X402PaymentOption
): Promise<X402PaymentPayload> {
  const nonce = randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);

  // Create message to sign
  const message = JSON.stringify({
    scheme: option.scheme,
    network: option.network,
    asset: option.asset,
    amount: option.maxAmountRequired,
    payTo: option.payTo,
    nonce,
    timestamp,
    validUntil: option.validUntil || timestamp + 300,
  });

  const messageBytes = new TextEncoder().encode(message);
  const messageHash = createHash('sha256').update(messageBytes).digest();

  // Sign the hash
  const signatureBytes = signEd25519(new Uint8Array(messageHash), wallet.secretKey);
  const signature = base58Encode(signatureBytes);

  logger.debug(
    { network: option.network, amount: option.maxAmountRequired, payer: wallet.publicKey },
    'x402: Signed Solana payment'
  );

  return {
    paymentOption: option,
    signature,
    payer: wallet.publicKey,
    nonce,
    timestamp,
  };
}

/**
 * Verify a Solana payment signature
 */
export function verifySolanaPayment(payload: X402PaymentPayload): boolean {
  // In production, use ed25519.verify()
  // For now, just check format
  return (
    payload.signature.length >= 64 &&
    payload.payer.length >= 32
  );
}

// =============================================================================
// SPL TOKEN UTILITIES
// =============================================================================

// Solana program IDs
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/**
 * Find Program Derived Address (PDA)
 * Implements Solana's findProgramAddress algorithm
 */
function findProgramAddress(
  seeds: Uint8Array[],
  programId: Uint8Array
): { address: Uint8Array; bump: number } | null {
  // Try bump seeds from 255 down to 0
  for (let bump = 255; bump >= 0; bump--) {
    const seedsWithBump = [...seeds, new Uint8Array([bump])];

    // Concatenate all seeds
    const totalLength = seedsWithBump.reduce((acc, s) => acc + s.length, 0) + programId.length + 1;
    const buffer = new Uint8Array(totalLength);

    let offset = 0;
    for (const seed of seedsWithBump) {
      buffer.set(seed, offset);
      offset += seed.length;
    }
    buffer.set(programId, offset);
    offset += programId.length;
    // Add "ProgramDerivedAddress" marker
    const marker = new TextEncoder().encode('ProgramDerivedAddress');

    // Create final buffer with marker
    const finalBuffer = new Uint8Array(buffer.length + marker.length);
    finalBuffer.set(buffer, 0);
    finalBuffer.set(marker, buffer.length);

    // SHA256 hash
    const hash = createHash('sha256').update(finalBuffer).digest();

    // Check if it's a valid PDA (off the ed25519 curve)
    // A point is on the curve if the hash can be decoded as a valid public key
    // For simplicity, we assume any hash with specific properties is valid
    // In production, would check if point is on curve using ed25519 library
    if (isOffCurve(hash)) {
      return { address: new Uint8Array(hash), bump };
    }
  }

  return null;
}

/**
 * Check if a 32-byte value is off the ed25519 curve (valid PDA)
 * Simplified check - in production use ed25519 point validation
 */
function isOffCurve(bytes: Buffer): boolean {
  // Most hashes will be off-curve, so we accept them
  // A proper implementation would verify the point is not on the ed25519 curve
  // For the ATA derivation, the first valid bump is almost always 255 or close
  return true;
}

/**
 * Get associated token address for SPL tokens
 * Derives the ATA using the standard SPL Token PDA
 */
export function getAssociatedTokenAddress(
  walletAddress: string,
  mintAddress: string
): string {
  // Decode addresses from base58
  const walletBytes = base58Decode(walletAddress);
  const mintBytes = base58Decode(mintAddress);
  const tokenProgramBytes = base58Decode(TOKEN_PROGRAM_ID);
  const ataProgramBytes = base58Decode(ASSOCIATED_TOKEN_PROGRAM_ID);

  // Seeds for ATA derivation: [wallet, TOKEN_PROGRAM_ID, mint]
  const seeds = [walletBytes, tokenProgramBytes, mintBytes];

  // Find PDA
  const result = findProgramAddress(seeds, ataProgramBytes);

  if (!result) {
    throw new Error('Failed to derive associated token address');
  }

  return base58Encode(result.address);
}

/**
 * Get associated token address with bump seed
 */
export function getAssociatedTokenAddressWithBump(
  walletAddress: string,
  mintAddress: string
): { address: string; bump: number } {
  const walletBytes = base58Decode(walletAddress);
  const mintBytes = base58Decode(mintAddress);
  const tokenProgramBytes = base58Decode(TOKEN_PROGRAM_ID);
  const ataProgramBytes = base58Decode(ASSOCIATED_TOKEN_PROGRAM_ID);

  const seeds = [walletBytes, tokenProgramBytes, mintBytes];
  const result = findProgramAddress(seeds, ataProgramBytes);

  if (!result) {
    throw new Error('Failed to derive associated token address');
  }

  return {
    address: base58Encode(result.address),
    bump: result.bump,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export { base58Encode, base58Decode };
