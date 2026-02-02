/**
 * x402 Solana Payment Signing
 *
 * Uses Ed25519 signing for Solana payments
 */

import { createHash, randomBytes } from 'crypto';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { logger } from '../../utils/logger';
import type { X402PaymentOption, X402PaymentPayload } from './index';

// Configure noble/ed25519 to use sha512 (required for sync operations)
ed25519.etc.sha512Sync = (...messages: Uint8Array[]): Uint8Array => {
  const combined = new Uint8Array(messages.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of messages) {
    combined.set(m, offset);
    offset += m.length;
  }
  return sha512(combined);
};

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
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
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
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) break;
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

  // For 64-byte keys, public key is in last 32 bytes
  // For 32-byte seed, derive public key using Ed25519
  let publicKeyBytes: Uint8Array;
  if (secretKey.length === 64) {
    publicKeyBytes = secretKey.slice(32);
  } else if (secretKey.length === 32) {
    // Derive public key from seed using Ed25519
    publicKeyBytes = ed25519.getPublicKey(secretKey);
  } else {
    throw new Error(`Invalid secret key length: ${secretKey.length}, expected 32 or 64`);
  }

  return {
    publicKey: base58Encode(publicKeyBytes),
    secretKey,
  };
}

// =============================================================================
// ED25519 SIGNING
// =============================================================================

/**
 * Sign a message with Ed25519
 * Uses @noble/ed25519 for cryptographic signing
 */
async function signEd25519(message: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
  // Extract the 32-byte seed from the secret key
  const seed = secretKey.slice(0, 32);

  // Sign using Ed25519
  const signature = await ed25519.signAsync(message, seed);
  return signature;
}

/**
 * Sign a message with Ed25519 (synchronous version)
 */
function signEd25519Sync(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  // Extract the 32-byte seed from the secret key
  const seed = secretKey.slice(0, 32);

  // Sign using Ed25519 (sync)
  const signature = ed25519.sign(message, seed);
  return signature;
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

  // Sign the hash using Ed25519
  const signatureBytes = await signEd25519(new Uint8Array(messageHash), wallet.secretKey);
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
export async function verifySolanaPayment(payload: X402PaymentPayload): Promise<boolean> {
  try {
    // Decode the signature and public key from base58
    const signatureBytes = base58Decode(payload.signature);
    const publicKeyBytes = base58Decode(payload.payer);

    // Validate lengths
    if (signatureBytes.length !== 64) {
      logger.debug({ length: signatureBytes.length }, 'Invalid signature length');
      return false;
    }
    if (publicKeyBytes.length !== 32) {
      logger.debug({ length: publicKeyBytes.length }, 'Invalid public key length');
      return false;
    }

    // Reconstruct the message that was signed
    const message = JSON.stringify({
      scheme: payload.paymentOption.scheme,
      network: payload.paymentOption.network,
      asset: payload.paymentOption.asset,
      amount: payload.paymentOption.maxAmountRequired,
      payTo: payload.paymentOption.payTo,
      nonce: payload.nonce,
      timestamp: payload.timestamp,
      validUntil: payload.paymentOption.validUntil || payload.timestamp + 300,
    });

    const messageBytes = new TextEncoder().encode(message);
    const messageHash = createHash('sha256').update(messageBytes).digest();

    // Verify the signature using Ed25519
    const isValid = await ed25519.verifyAsync(
      signatureBytes,
      new Uint8Array(messageHash),
      publicKeyBytes
    );

    return isValid;
  } catch (error) {
    logger.debug({ error }, 'Failed to verify Solana payment signature');
    return false;
  }
}

/**
 * Verify a Solana payment signature (synchronous version)
 */
export function verifySolanaPaymentSync(payload: X402PaymentPayload): boolean {
  try {
    const signatureBytes = base58Decode(payload.signature);
    const publicKeyBytes = base58Decode(payload.payer);

    if (signatureBytes.length !== 64 || publicKeyBytes.length !== 32) {
      return false;
    }

    const message = JSON.stringify({
      scheme: payload.paymentOption.scheme,
      network: payload.paymentOption.network,
      asset: payload.paymentOption.asset,
      amount: payload.paymentOption.maxAmountRequired,
      payTo: payload.paymentOption.payTo,
      nonce: payload.nonce,
      timestamp: payload.timestamp,
      validUntil: payload.paymentOption.validUntil || payload.timestamp + 300,
    });

    const messageBytes = new TextEncoder().encode(message);
    const messageHash = createHash('sha256').update(messageBytes).digest();

    return ed25519.verify(signatureBytes, new Uint8Array(messageHash), publicKeyBytes);
  } catch {
    return false;
  }
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
 * Uses Ed25519 point validation - a valid PDA must NOT be a valid public key
 */
function isOffCurve(bytes: Buffer): boolean {
  try {
    // Attempt to use this as a public key point
    // If it's a valid Ed25519 point (on curve), this will succeed
    // For PDAs, we want points that are NOT on the curve
    const point = ed25519.ExtendedPoint.fromHex(bytes);
    // If we get here, the point is ON the curve, so NOT a valid PDA
    return false;
  } catch {
    // Error means the point is NOT on the curve - valid for PDA
    return true;
  }
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

export {
  base58Encode,
  base58Decode,
  signEd25519Sync,
};
