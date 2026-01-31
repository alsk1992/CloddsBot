/**
 * EVM Wallet Management
 *
 * Self-custody wallet generation and management.
 * Keys stay local - no cloud custody.
 */

import { Wallet, HDNodeWallet, Mnemonic, randomBytes, keccak256, getBytes } from 'ethers';
import { createCipheriv, createDecipheriv, scryptSync, randomBytes as cryptoRandomBytes } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface WalletInfo {
  address: string;
  publicKey: string;
  hasPrivateKey: boolean;
}

export interface GeneratedWallet {
  address: string;
  privateKey: string;
  mnemonic?: string;
  publicKey: string;
}

export interface EncryptedKeystore {
  version: number;
  address: string;
  crypto: {
    cipher: string;
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: string;
    kdfparams: { n: number; r: number; p: number; dklen: number; salt: string };
    mac: string;
  };
}

// =============================================================================
// WALLET DIRECTORY
// =============================================================================

const WALLET_DIR = join(homedir(), '.clodds', 'wallets');

function ensureWalletDir(): void {
  if (!existsSync(WALLET_DIR)) {
    mkdirSync(WALLET_DIR, { recursive: true, mode: 0o700 });
  }
}

// =============================================================================
// WALLET GENERATION
// =============================================================================

/**
 * Generate a new random wallet
 */
export function generateWallet(): GeneratedWallet {
  const wallet = Wallet.createRandom();

  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase,
    publicKey: wallet.publicKey,
  };
}

/**
 * Generate wallet from mnemonic phrase
 */
export function walletFromMnemonic(phrase: string, index = 0): GeneratedWallet {
  const mnemonic = Mnemonic.fromPhrase(phrase);
  const path = `m/44'/60'/0'/0/${index}`;
  const wallet = HDNodeWallet.fromMnemonic(mnemonic, path);

  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: phrase,
    publicKey: wallet.publicKey,
  };
}

/**
 * Import wallet from private key
 */
export function walletFromPrivateKey(privateKey: string): WalletInfo {
  const wallet = new Wallet(privateKey);

  return {
    address: wallet.address,
    publicKey: wallet.signingKey.publicKey,
    hasPrivateKey: true,
  };
}

/**
 * Get current wallet from environment
 */
export function getCurrentWallet(): WalletInfo | null {
  const privateKey = process.env.EVM_PRIVATE_KEY;
  if (!privateKey) return null;

  try {
    return walletFromPrivateKey(privateKey);
  } catch {
    return null;
  }
}

// =============================================================================
// KEYSTORE ENCRYPTION
// =============================================================================

/**
 * Encrypt private key to keystore format
 */
export function encryptKeystore(privateKey: string, password: string): EncryptedKeystore {
  const wallet = new Wallet(privateKey);

  // Generate random salt and IV
  const salt = cryptoRandomBytes(32);
  const iv = cryptoRandomBytes(16);

  // Derive key using scrypt
  const derivedKey = scryptSync(password, salt, 32, { N: 262144, r: 8, p: 1 });

  // Encrypt private key (remove 0x prefix)
  const cipher = createCipheriv('aes-256-ctr', derivedKey.slice(0, 32), iv);
  const keyBytes = getBytes(privateKey);
  const ciphertext = Buffer.concat([cipher.update(keyBytes), cipher.final()]);

  // Calculate MAC
  const mac = keccak256(Buffer.concat([derivedKey.slice(16, 32), ciphertext]));

  return {
    version: 3,
    address: wallet.address.toLowerCase().replace('0x', ''),
    crypto: {
      cipher: 'aes-256-ctr',
      ciphertext: ciphertext.toString('hex'),
      cipherparams: { iv: iv.toString('hex') },
      kdf: 'scrypt',
      kdfparams: {
        n: 262144,
        r: 8,
        p: 1,
        dklen: 32,
        salt: salt.toString('hex'),
      },
      mac: mac.replace('0x', ''),
    },
  };
}

/**
 * Decrypt keystore to get private key
 */
export function decryptKeystore(keystore: EncryptedKeystore, password: string): string {
  const { crypto } = keystore;

  // Derive key using scrypt
  const salt = Buffer.from(crypto.kdfparams.salt, 'hex');
  const derivedKey = scryptSync(password, salt, 32, {
    N: crypto.kdfparams.n,
    r: crypto.kdfparams.r,
    p: crypto.kdfparams.p,
  });

  // Verify MAC
  const ciphertext = Buffer.from(crypto.ciphertext, 'hex');
  const mac = keccak256(Buffer.concat([derivedKey.slice(16, 32), ciphertext]));

  if (mac.replace('0x', '').toLowerCase() !== crypto.mac.toLowerCase()) {
    throw new Error('Invalid password or corrupted keystore');
  }

  // Decrypt
  const iv = Buffer.from(crypto.cipherparams.iv, 'hex');
  const decipher = createDecipheriv('aes-256-ctr', derivedKey.slice(0, 32), iv);
  const privateKeyBytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return '0x' + privateKeyBytes.toString('hex');
}

// =============================================================================
// KEYSTORE FILE OPERATIONS
// =============================================================================

/**
 * Save wallet to encrypted keystore file
 */
export function saveWallet(privateKey: string, password: string, name?: string): string {
  ensureWalletDir();

  const keystore = encryptKeystore(privateKey, password);
  const filename = name || `wallet-${keystore.address.slice(0, 8)}`;
  const filepath = join(WALLET_DIR, `${filename}.json`);

  writeFileSync(filepath, JSON.stringify(keystore, null, 2), { mode: 0o600 });
  logger.info({ address: '0x' + keystore.address, filepath }, 'Wallet saved');

  return filepath;
}

/**
 * Load wallet from keystore file
 */
export function loadWallet(filenameOrPath: string, password: string): GeneratedWallet {
  let filepath = filenameOrPath;

  // Check if it's just a filename
  if (!filenameOrPath.includes('/') && !filenameOrPath.includes('\\')) {
    filepath = join(WALLET_DIR, filenameOrPath.endsWith('.json') ? filenameOrPath : `${filenameOrPath}.json`);
  }

  if (!existsSync(filepath)) {
    throw new Error(`Keystore not found: ${filepath}`);
  }

  const keystore = JSON.parse(readFileSync(filepath, 'utf-8')) as EncryptedKeystore;
  const privateKey = decryptKeystore(keystore, password);
  const wallet = new Wallet(privateKey);

  return {
    address: wallet.address,
    privateKey,
    publicKey: wallet.signingKey.publicKey,
  };
}

/**
 * List saved wallets
 */
export function listWallets(): { name: string; address: string }[] {
  ensureWalletDir();

  const { readdirSync } = require('fs');
  const files = readdirSync(WALLET_DIR).filter((f: string) => f.endsWith('.json'));

  return files.map((file: string) => {
    try {
      const keystore = JSON.parse(readFileSync(join(WALLET_DIR, file), 'utf-8')) as EncryptedKeystore;
      return {
        name: file.replace('.json', ''),
        address: '0x' + keystore.address,
      };
    } catch {
      return null;
    }
  }).filter(Boolean) as { name: string; address: string }[];
}

/**
 * Delete a saved wallet
 */
export function deleteWallet(name: string): boolean {
  const filepath = join(WALLET_DIR, name.endsWith('.json') ? name : `${name}.json`);

  if (!existsSync(filepath)) {
    return false;
  }

  const { unlinkSync } = require('fs');
  unlinkSync(filepath);
  logger.info({ name }, 'Wallet deleted');
  return true;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Validate an Ethereum address
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate a private key
 */
export function isValidPrivateKey(key: string): boolean {
  try {
    new Wallet(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive address from private key without creating full wallet
 */
export function privateKeyToAddress(privateKey: string): string {
  const wallet = new Wallet(privateKey);
  return wallet.address;
}

/**
 * Generate a random mnemonic phrase
 */
export function generateMnemonic(strength: 128 | 256 = 128): string {
  const entropy = randomBytes(strength / 8);
  return Mnemonic.fromEntropy(entropy).phrase;
}
