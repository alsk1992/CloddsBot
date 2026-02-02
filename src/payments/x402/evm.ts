/**
 * x402 EVM (Base) Payment Signing
 *
 * Uses EIP-712 typed data signing for secure payments
 * Uses proper Keccak256 (not SHA3-256) for Ethereum compatibility
 */

import { randomBytes } from 'crypto';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import { logger } from '../../utils/logger';
import type { X402PaymentOption, X402PaymentPayload, X402Network } from './index';

// =============================================================================
// TYPES
// =============================================================================

export interface EvmWallet {
  address: string;
  privateKey: string;
}

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export interface X402PaymentMessage {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  nonce: string;
  validUntil: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CHAIN_IDS: Record<X402Network, number> = {
  'base': 8453,
  'base-sepolia': 84532,
  'solana': 0,
  'solana-devnet': 0,
};

const X402_DOMAIN: Omit<EIP712Domain, 'chainId'> = {
  name: 'x402',
  version: '1',
  verifyingContract: '0x0000000000000000000000000000000000000402',
};

const PAYMENT_TYPES = {
  Payment: [
    { name: 'scheme', type: 'string' },
    { name: 'network', type: 'string' },
    { name: 'asset', type: 'string' },
    { name: 'amount', type: 'uint256' },
    { name: 'payTo', type: 'address' },
    { name: 'nonce', type: 'string' },
    { name: 'validUntil', type: 'uint256' },
  ],
};

// =============================================================================
// WALLET UTILITIES
// =============================================================================

/**
 * Derive Ethereum address from private key using secp256k1
 * Uses @noble/curves for reliable key derivation
 */
export function deriveEvmAddress(privateKey: string): string {
  // Remove 0x prefix if present
  const keyHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

  // Get uncompressed public key (65 bytes: 04 || x || y) and skip the 0x04 prefix
  const pubKey = secp256k1.getPublicKey(keyHex, false).slice(1);

  // Ethereum address = last 20 bytes of keccak256(public_key_without_prefix)
  const hash = keccak256(pubKey);

  return '0x' + hash.slice(-40);
}

/**
 * Keccak256 hash function (Ethereum's pre-NIST SHA3 variant)
 * Uses @noble/hashes for proper Ethereum compatibility
 */
function keccak256(data: Buffer | Uint8Array): string {
  return bytesToHex(keccak_256(data));
}

/**
 * Create an EVM wallet from private key
 */
export function createEvmWallet(privateKey: string): EvmWallet {
  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  return {
    address: deriveEvmAddress(key),
    privateKey: key,
  };
}

// =============================================================================
// EIP-712 SIGNING
// =============================================================================

/**
 * Hash EIP-712 domain separator
 */
function hashDomain(domain: EIP712Domain): string {
  const typeHash = Buffer.from(keccak256(
    Buffer.from('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
  ), 'hex');

  const nameHash = Buffer.from(keccak256(Buffer.from(domain.name)), 'hex');
  const versionHash = Buffer.from(keccak256(Buffer.from(domain.version)), 'hex');
  const chainIdHex = domain.chainId.toString(16).padStart(64, '0');
  const contractHex = domain.verifyingContract.slice(2).padStart(64, '0');

  const encoded = Buffer.concat([
    typeHash,
    nameHash,
    versionHash,
    Buffer.from(chainIdHex, 'hex'),
    Buffer.from(contractHex, 'hex'),
  ]);

  return '0x' + keccak256(encoded);
}

/**
 * Hash EIP-712 struct data
 */
function hashStruct(message: X402PaymentMessage): string {
  const typeHash = Buffer.from(keccak256(
    Buffer.from('Payment(string scheme,string network,string asset,uint256 amount,address payTo,string nonce,uint256 validUntil)')
  ), 'hex');

  const schemeHash = Buffer.from(keccak256(Buffer.from(message.scheme)), 'hex');
  const networkHash = Buffer.from(keccak256(Buffer.from(message.network)), 'hex');
  const assetHash = Buffer.from(keccak256(Buffer.from(message.asset)), 'hex');
  const amountHex = BigInt(message.amount).toString(16).padStart(64, '0');
  const payToHex = message.payTo.slice(2).padStart(64, '0');
  const nonceHash = Buffer.from(keccak256(Buffer.from(message.nonce)), 'hex');
  const validUntilHex = message.validUntil.toString(16).padStart(64, '0');

  const encoded = Buffer.concat([
    typeHash,
    schemeHash,
    networkHash,
    assetHash,
    Buffer.from(amountHex, 'hex'),
    Buffer.from(payToHex, 'hex'),
    nonceHash,
    Buffer.from(validUntilHex, 'hex'),
  ]);

  return '0x' + keccak256(encoded);
}

/**
 * Create EIP-712 typed data hash
 */
function createTypedDataHash(domain: EIP712Domain, message: X402PaymentMessage): string {
  const domainSeparator = hashDomain(domain);
  const structHash = hashStruct(message);

  const encoded = Buffer.concat([
    Buffer.from([0x19, 0x01]),
    Buffer.from(domainSeparator.slice(2), 'hex'),
    Buffer.from(structHash.slice(2), 'hex'),
  ]);

  return '0x' + keccak256(encoded);
}

/**
 * Sign a message hash with ECDSA secp256k1
 * Returns Ethereum-style signature (r || s || v) with proper recovery bit
 * Uses @noble/curves for correct signing with recovery
 */
function signMessage(messageHash: string, privateKey: string): string {
  const keyBytes = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  const hashBytes = hexToBytes(messageHash.startsWith('0x') ? messageHash.slice(2) : messageHash);

  // Sign with secp256k1 including recovery bit
  const sig = secp256k1.sign(hashBytes, keyBytes);

  // Get r, s, and recovery bit
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = sig.recovery + 27; // Ethereum uses 27/28 for v

  return '0x' + r + s + v.toString(16).padStart(2, '0');
}

// =============================================================================
// PAYMENT SIGNING
// =============================================================================

/**
 * Sign an x402 payment for EVM networks (Base)
 */
export async function signEvmPayment(
  wallet: EvmWallet,
  option: X402PaymentOption
): Promise<X402PaymentPayload> {
  const nonce = randomBytes(16).toString('hex');
  const validUntil = option.validUntil || Math.floor(Date.now() / 1000) + 300;

  const chainId = CHAIN_IDS[option.network] || 8453;

  const domain: EIP712Domain = {
    ...X402_DOMAIN,
    chainId,
  };

  const message: X402PaymentMessage = {
    scheme: option.scheme,
    network: option.network,
    asset: option.asset,
    amount: option.maxAmountRequired,
    payTo: option.payTo,
    nonce,
    validUntil,
  };

  const hash = createTypedDataHash(domain, message);
  const signature = signMessage(hash, wallet.privateKey);

  logger.debug(
    { network: option.network, amount: option.maxAmountRequired, payer: wallet.address },
    'x402: Signed EVM payment'
  );

  return {
    paymentOption: option,
    signature,
    payer: wallet.address,
    nonce,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Recover Ethereum address from signature using ecrecover
 * Uses @noble/curves/secp256k1 for proper cryptographic verification
 */
function ecrecover(msgHash: string, signature: string): string | null {
  try {
    const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
    const r = sig.slice(0, 64);
    const s = sig.slice(64, 128);
    const v = parseInt(sig.slice(128, 130), 16);

    // Convert v to recovery bit (0 or 1)
    // v is typically 27 or 28, recovery bit = v - 27
    // For EIP-155: recovery bit = (v - chainId * 2 - 35) or (v - 27)
    let recoveryBit: number;
    if (v === 27 || v === 28) {
      recoveryBit = v - 27;
    } else if (v >= 35) {
      // EIP-155: v = chainId * 2 + 35 + recovery
      recoveryBit = (v - 35) % 2;
    } else {
      return null;
    }

    // Parse hash and signature
    const hashBytes = hexToBytes(msgHash.startsWith('0x') ? msgHash.slice(2) : msgHash);
    const sigBytes = hexToBytes(r + s);

    // Create signature object and recover public key
    const sigObj = secp256k1.Signature.fromCompact(sigBytes).addRecoveryBit(recoveryBit);
    const recoveredPubKey = sigObj.recoverPublicKey(hashBytes);

    // Get uncompressed public key (65 bytes) and skip the 0x04 prefix
    const pubKeyBytes = recoveredPubKey.toRawBytes(false).slice(1);

    // Ethereum address = last 20 bytes of keccak256(pubkey)
    const addressHash = keccak256(pubKeyBytes);
    return '0x' + addressHash.slice(-40);
  } catch (error) {
    logger.debug({ error }, 'ecrecover failed');
    return null;
  }
}

/**
 * Verify an EVM payment signature using ecrecover
 * Reconstructs the signed message and verifies the signature matches the payer address
 */
export function verifyEvmPayment(payload: X402PaymentPayload): boolean {
  // Validate signature format
  if (!payload.signature.startsWith('0x') || payload.signature.length < 130) {
    return false;
  }
  if (!payload.payer.startsWith('0x') || payload.payer.length !== 42) {
    return false;
  }

  // Extract signature components for validation
  const sig = payload.signature.slice(2);
  const r = sig.slice(0, 64);
  const s = sig.slice(64, 128);
  const v = parseInt(sig.slice(128, 130), 16);

  // Validate v value (27 or 28, or EIP-155 adjusted)
  if (v !== 27 && v !== 28 && v < 35) {
    return false;
  }

  // Validate r and s are valid hex
  if (!/^[0-9a-fA-F]{64}$/.test(r) || !/^[0-9a-fA-F]{64}$/.test(s)) {
    return false;
  }

  // Reconstruct the message hash
  const option = payload.paymentOption;
  const chainId = CHAIN_IDS[option.network] || 8453;
  const domain: EIP712Domain = { ...X402_DOMAIN, chainId };
  const message: X402PaymentMessage = {
    scheme: option.scheme,
    network: option.network,
    asset: option.asset,
    amount: option.maxAmountRequired,
    payTo: option.payTo,
    nonce: payload.nonce,
    validUntil: option.validUntil || 0,
  };

  const expectedHash = createTypedDataHash(domain, message);
  if (!expectedHash.startsWith('0x') || expectedHash.length !== 66) {
    return false;
  }

  // Recover address from signature and compare to claimed payer
  const recoveredAddress = ecrecover(expectedHash, payload.signature);
  if (!recoveredAddress) {
    logger.debug({ payer: payload.payer }, 'x402: Failed to recover address from signature');
    return false;
  }

  // Compare addresses (case-insensitive)
  const isValid = recoveredAddress.toLowerCase() === payload.payer.toLowerCase();

  logger.debug(
    { payer: payload.payer, recovered: recoveredAddress, valid: isValid },
    'x402: Payment signature verified with ecrecover'
  );

  return isValid;
}

// =============================================================================
// EXPORTS
// =============================================================================

export { CHAIN_IDS, X402_DOMAIN, PAYMENT_TYPES };
