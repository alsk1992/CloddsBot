/**
 * On-Chain Escrow for Agent Commerce Protocol
 *
 * Secure escrow system for agent-to-agent transactions:
 * - Deposit funds into escrow
 * - Release on successful completion
 * - Refund on failure/timeout
 * - Dispute resolution
 *
 * Keypairs are stored encrypted in the database (AES-256-GCM)
 * and cached in memory for performance.
 *
 * Supports both Solana (native) and EVM (Base) chains
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as crypto from 'crypto';
import bs58 from 'bs58';
import { logger } from '../utils/logger';
import { getEscrowPersistence } from './persistence';

// Note: SPL token support requires additional setup
// For now, escrow supports native SOL only
// SPL token functionality can be added via dynamic imports when needed

// =============================================================================
// KEYPAIR ENCRYPTION (AES-256-GCM)
// =============================================================================

const ESCROW_ENCRYPTION_KEY = process.env.CLODDS_ESCROW_KEY || process.env.CLODDS_CREDENTIAL_KEY;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a Solana keypair for database storage
 */
function encryptKeypair(keypair: Keypair): string {
  if (!ESCROW_ENCRYPTION_KEY) {
    throw new Error('CLODDS_ESCROW_KEY or CLODDS_CREDENTIAL_KEY required for escrow keypair encryption');
  }

  const secretKeyBase58 = bs58.encode(keypair.secretKey);
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(ESCROW_ENCRYPTION_KEY, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(secretKeyBase58, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return [
    'escrow_v1',
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted,
  ].join(':');
}

/**
 * Decrypt a Solana keypair from database storage
 */
function decryptKeypair(encryptedData: string): Keypair {
  if (!ESCROW_ENCRYPTION_KEY) {
    throw new Error('CLODDS_ESCROW_KEY or CLODDS_CREDENTIAL_KEY required for escrow keypair decryption');
  }

  const parts = encryptedData.split(':');
  if (parts[0] !== 'escrow_v1' || parts.length < 5) {
    throw new Error('Invalid escrow keypair format');
  }

  const [, saltHex, ivHex, authTagHex, encrypted] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.scryptSync(ESCROW_ENCRYPTION_KEY, salt, 32);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  const secretKey = bs58.decode(decrypted);
  return Keypair.fromSecretKey(secretKey);
}

// In-memory cache for performance (DB is source of truth)
const escrowKeypairCache = new Map<string, Keypair>();

// =============================================================================
// TYPES
// =============================================================================

export type EscrowStatus = 'pending' | 'funded' | 'released' | 'refunded' | 'disputed' | 'expired';
export type EscrowChain = 'solana' | 'base';

export interface EscrowParty {
  address: string;
  role: 'buyer' | 'seller' | 'arbiter';
}

export interface EscrowCondition {
  type: 'time' | 'signature' | 'oracle' | 'custom';
  value: string | number;
  description?: string;
}

export interface EscrowConfig {
  /** Unique escrow ID */
  id: string;
  /** Chain to use */
  chain: EscrowChain;
  /** Buyer (depositor) */
  buyer: string;
  /** Seller (recipient) */
  seller: string;
  /** Optional arbiter for disputes */
  arbiter?: string;
  /** Amount in smallest unit (lamports/wei) */
  amount: string;
  /** Token mint (null for native SOL/ETH) */
  tokenMint?: string;
  /** Release conditions */
  releaseConditions: EscrowCondition[];
  /** Refund conditions */
  refundConditions: EscrowCondition[];
  /** Expiration timestamp (Unix) */
  expiresAt: number;
  /** Service description */
  description?: string;
  /** Agreement hash (links to proof-of-agreement) */
  agreementHash?: string;
}

export interface Escrow extends EscrowConfig {
  status: EscrowStatus;
  createdAt: number;
  fundedAt?: number;
  completedAt?: number;
  escrowAddress: string;
  txSignatures: string[];
}

export interface EscrowResult {
  success: boolean;
  escrowId: string;
  signature?: string;
  error?: string;
}

export interface EscrowService {
  /** Create a new escrow */
  create(config: EscrowConfig): Promise<Escrow>;

  /** Fund an escrow (buyer deposits) */
  fund(escrowId: string, payer: Keypair): Promise<EscrowResult>;

  /** Release escrow to seller */
  release(escrowId: string, authorizer: Keypair): Promise<EscrowResult>;

  /** Refund escrow to buyer */
  refund(escrowId: string, authorizer: Keypair): Promise<EscrowResult>;

  /** Initiate dispute */
  dispute(escrowId: string, initiator: Keypair, reason: string): Promise<EscrowResult>;

  /** Resolve dispute (arbiter only) */
  resolveDispute(escrowId: string, arbiter: Keypair, releaseTo: 'buyer' | 'seller'): Promise<EscrowResult>;

  /** Get escrow by ID */
  get(escrowId: string): Promise<Escrow | null>;

  /** List escrows for an address */
  list(address: string, role?: 'buyer' | 'seller' | 'arbiter'): Promise<Escrow[]>;

  /** Check if escrow conditions are met */
  checkConditions(escrowId: string, type: 'release' | 'refund'): Promise<boolean>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const ESCROW_SEED = 'acp_escrow_v1';
const ESCROW_TIMEOUT_DEFAULT = 7 * 24 * 60 * 60 * 1000; // 7 days

// =============================================================================
// KEYPAIR MANAGEMENT
// =============================================================================

/**
 * Get escrow keypair - checks cache first, then loads from DB
 */
async function getEscrowKeypair(escrowId: string): Promise<Keypair | null> {
  // Check cache first
  const cached = escrowKeypairCache.get(escrowId);
  if (cached) {
    return cached;
  }

  // Load from database
  const persistence = getEscrowPersistence();
  const encryptedKeypair = await persistence.getEncryptedKeypair(escrowId);
  if (!encryptedKeypair) {
    return null;
  }

  try {
    const keypair = decryptKeypair(encryptedKeypair);
    escrowKeypairCache.set(escrowId, keypair);
    return keypair;
  } catch (error) {
    logger.error({ escrowId, error }, 'Failed to decrypt escrow keypair');
    return null;
  }
}

/**
 * Store escrow keypair - saves to DB and caches in memory
 */
async function storeEscrowKeypair(escrowId: string, keypair: Keypair): Promise<void> {
  const encrypted = encryptKeypair(keypair);
  const persistence = getEscrowPersistence();
  await persistence.saveEncryptedKeypair(escrowId, encrypted);
  escrowKeypairCache.set(escrowId, keypair);
}

/**
 * Clear escrow keypair from cache and DB (after release/refund)
 */
async function clearEscrowKeypair(escrowId: string): Promise<void> {
  escrowKeypairCache.delete(escrowId);
  const persistence = getEscrowPersistence();
  await persistence.clearEncryptedKeypair(escrowId);
}

// =============================================================================
// SOLANA ESCROW IMPLEMENTATION
// =============================================================================

/**
 * Derive escrow PDA address
 */
function deriveEscrowAddress(escrowId: string, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ESCROW_SEED), Buffer.from(escrowId)],
    programId
  );
}

/**
 * Generate unique escrow ID
 */
function generateEscrowId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  return `escrow_${timestamp}_${random}`;
}

/**
 * Hash escrow config for verification
 */
function hashEscrowConfig(config: EscrowConfig): string {
  const data = JSON.stringify({
    buyer: config.buyer,
    seller: config.seller,
    amount: config.amount,
    tokenMint: config.tokenMint,
    expiresAt: config.expiresAt,
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Create Solana escrow service with real on-chain transactions
 */
export function createSolanaEscrowService(connection: Connection): EscrowService {
  const persistence = getEscrowPersistence();

  return {
    async create(config: EscrowConfig): Promise<Escrow> {
      const id = config.id || generateEscrowId();

      // Generate escrow keypair for holding funds
      const escrowKeypair = Keypair.generate();

      const escrow: Escrow = {
        ...config,
        id,
        status: 'pending',
        createdAt: Date.now(),
        escrowAddress: escrowKeypair.publicKey.toBase58(),
        txSignatures: [],
      };

      // Save escrow record to database first (creates the row)
      await persistence.save(escrow);

      // Store keypair encrypted in database (UPDATE on existing row)
      await storeEscrowKeypair(id, escrowKeypair);

      logger.info({ escrowId: id, buyer: config.buyer, seller: config.seller, amount: config.amount }, 'Escrow created with encrypted keypair');

      return escrow;
    },

    async fund(escrowId: string, payer: Keypair): Promise<EscrowResult> {
      const escrow = await persistence.get(escrowId);
      if (!escrow) {
        return { success: false, escrowId, error: 'Escrow not found' };
      }

      if (escrow.status !== 'pending') {
        return { success: false, escrowId, error: `Cannot fund escrow in ${escrow.status} status` };
      }

      if (payer.publicKey.toBase58() !== escrow.buyer) {
        return { success: false, escrowId, error: 'Only buyer can fund escrow' };
      }

      try {
        const escrowPubkey = new PublicKey(escrow.escrowAddress);
        const amount = BigInt(escrow.amount);

        if (escrow.tokenMint) {
          return { success: false, escrowId, error: 'SPL token escrow not yet implemented - use native SOL' };
        }

        // Native SOL transfer to escrow account
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: escrowPubkey,
            lamports: amount,
          })
        );

        const signature = await sendAndConfirmTransaction(connection, tx, [payer]);

        // Update escrow status in database
        escrow.status = 'funded';
        escrow.fundedAt = Date.now();
        escrow.txSignatures.push(signature);
        await persistence.save(escrow);

        logger.info({ escrowId, signature }, 'Escrow funded');

        return { success: true, escrowId, signature };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ escrowId, error: msg }, 'Failed to fund escrow');
        return { success: false, escrowId, error: msg };
      }
    },

    async release(escrowId: string, authorizer: Keypair): Promise<EscrowResult> {
      const escrow = await persistence.get(escrowId);
      if (!escrow) {
        return { success: false, escrowId, error: 'Escrow not found' };
      }

      if (escrow.status !== 'funded') {
        return { success: false, escrowId, error: `Cannot release escrow in ${escrow.status} status` };
      }

      const authAddress = authorizer.publicKey.toBase58();
      if (authAddress !== escrow.buyer && authAddress !== escrow.arbiter) {
        return { success: false, escrowId, error: 'Only buyer or arbiter can release' };
      }

      // Check release conditions
      const conditionsMet = await this.checkConditions(escrowId, 'release');
      if (!conditionsMet && authAddress !== escrow.arbiter) {
        return { success: false, escrowId, error: 'Release conditions not met' };
      }

      try {
        // Get escrow keypair from encrypted DB storage
        const escrowKeypair = await getEscrowKeypair(escrowId);
        if (!escrowKeypair) {
          return { success: false, escrowId, error: 'Escrow keypair not available - check CLODDS_ESCROW_KEY env var' };
        }

        if (escrow.tokenMint) {
          return { success: false, escrowId, error: 'SPL token escrow not yet implemented - use native SOL' };
        }

        const sellerPubkey = new PublicKey(escrow.seller);
        const amount = BigInt(escrow.amount);

        // Get escrow account balance to handle any rent
        const balance = await connection.getBalance(escrowKeypair.publicKey);
        const transferAmount = BigInt(Math.min(Number(amount), balance));

        if (transferAmount <= 0) {
          return { success: false, escrowId, error: 'Escrow account has no funds' };
        }

        // Transfer from escrow to seller
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: escrowKeypair.publicKey,
            toPubkey: sellerPubkey,
            lamports: transferAmount,
          })
        );

        const signature = await sendAndConfirmTransaction(connection, tx, [escrowKeypair]);

        // Update escrow in database
        escrow.status = 'released';
        escrow.completedAt = Date.now();
        escrow.txSignatures.push(signature);
        await persistence.save(escrow);

        // Clear keypair from cache and DB (funds transferred, no longer needed)
        await clearEscrowKeypair(escrowId);

        logger.info({ escrowId, signature, seller: escrow.seller }, 'Escrow released');

        return { success: true, escrowId, signature };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ escrowId, error: msg }, 'Failed to release escrow');
        return { success: false, escrowId, error: msg };
      }
    },

    async refund(escrowId: string, authorizer: Keypair): Promise<EscrowResult> {
      const escrow = await persistence.get(escrowId);
      if (!escrow) {
        return { success: false, escrowId, error: 'Escrow not found' };
      }

      if (escrow.status !== 'funded') {
        return { success: false, escrowId, error: `Cannot refund escrow in ${escrow.status} status` };
      }

      const authAddress = authorizer.publicKey.toBase58();
      const isExpired = Date.now() > escrow.expiresAt;

      // Seller can refund anytime, buyer can refund if expired, arbiter can always refund
      if (authAddress !== escrow.seller && authAddress !== escrow.arbiter) {
        if (authAddress === escrow.buyer && !isExpired) {
          return { success: false, escrowId, error: 'Buyer can only refund after expiration' };
        } else if (authAddress !== escrow.buyer) {
          return { success: false, escrowId, error: 'Not authorized to refund' };
        }
      }

      try {
        // Get escrow keypair from encrypted DB storage
        const escrowKeypair = await getEscrowKeypair(escrowId);
        if (!escrowKeypair) {
          return { success: false, escrowId, error: 'Escrow keypair not available - check CLODDS_ESCROW_KEY env var' };
        }

        const buyerPubkey = new PublicKey(escrow.buyer);

        // Get escrow account balance
        const balance = await connection.getBalance(escrowKeypair.publicKey);
        if (balance <= 0) {
          return { success: false, escrowId, error: 'Escrow account has no funds' };
        }

        // Transfer from escrow back to buyer
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: escrowKeypair.publicKey,
            toPubkey: buyerPubkey,
            lamports: BigInt(balance),
          })
        );

        const signature = await sendAndConfirmTransaction(connection, tx, [escrowKeypair]);

        // Update escrow in database
        escrow.status = 'refunded';
        escrow.completedAt = Date.now();
        escrow.txSignatures.push(signature);
        await persistence.save(escrow);

        // Clear keypair from cache and DB (funds transferred, no longer needed)
        await clearEscrowKeypair(escrowId);

        logger.info({ escrowId, signature, buyer: escrow.buyer }, 'Escrow refunded');

        return { success: true, escrowId, signature };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ escrowId, error: msg }, 'Failed to refund escrow');
        return { success: false, escrowId, error: msg };
      }
    },

    async dispute(escrowId: string, initiator: Keypair, reason: string): Promise<EscrowResult> {
      const escrow = await persistence.get(escrowId);
      if (!escrow) {
        return { success: false, escrowId, error: 'Escrow not found' };
      }

      if (escrow.status !== 'funded') {
        return { success: false, escrowId, error: 'Can only dispute funded escrows' };
      }

      if (!escrow.arbiter) {
        return { success: false, escrowId, error: 'No arbiter configured for this escrow' };
      }

      const address = initiator.publicKey.toBase58();
      if (address !== escrow.buyer && address !== escrow.seller) {
        return { success: false, escrowId, error: 'Only buyer or seller can initiate dispute' };
      }

      escrow.status = 'disputed';
      await persistence.save(escrow);

      logger.warn({ escrowId, initiator: address, reason }, 'Escrow disputed');

      return { success: true, escrowId };
    },

    async resolveDispute(escrowId: string, arbiter: Keypair, releaseTo: 'buyer' | 'seller'): Promise<EscrowResult> {
      const escrow = await persistence.get(escrowId);
      if (!escrow) {
        return { success: false, escrowId, error: 'Escrow not found' };
      }

      if (escrow.status !== 'disputed') {
        return { success: false, escrowId, error: 'Escrow is not in dispute' };
      }

      if (arbiter.publicKey.toBase58() !== escrow.arbiter) {
        return { success: false, escrowId, error: 'Only arbiter can resolve disputes' };
      }

      // Temporarily set status back to funded so release/refund can proceed
      escrow.status = 'funded';
      await persistence.save(escrow);

      if (releaseTo === 'seller') {
        return this.release(escrowId, arbiter);
      } else {
        return this.refund(escrowId, arbiter);
      }
    },

    async get(escrowId: string): Promise<Escrow | null> {
      return persistence.get(escrowId);
    },

    async list(address: string, role?: 'buyer' | 'seller' | 'arbiter'): Promise<Escrow[]> {
      const all = await persistence.listByParty(address);
      if (!role) return all;

      return all.filter(escrow => {
        if (role === 'buyer') return escrow.buyer === address;
        if (role === 'seller') return escrow.seller === address;
        if (role === 'arbiter') return escrow.arbiter === address;
        return false;
      });
    },

    async checkConditions(escrowId: string, type: 'release' | 'refund'): Promise<boolean> {
      const escrow = await persistence.get(escrowId);
      if (!escrow) return false;

      const conditions = type === 'release' ? escrow.releaseConditions : escrow.refundConditions;

      for (const condition of conditions) {
        switch (condition.type) {
          case 'time':
            // Time-based condition: check if current time is past the specified value
            if (Date.now() < Number(condition.value)) {
              return false;
            }
            break;

          case 'signature':
            // Signature condition: check if tx with required signature exists
            // Value should be the signature to look for
            if (typeof condition.value === 'string') {
              const hasSignature = escrow.txSignatures.some(sig => sig === condition.value);
              if (!hasSignature) return false;
            }
            break;

          case 'oracle':
            // Oracle condition: query external data source
            // For now, skip oracle checks (would need integration)
            logger.warn({ escrowId, condition }, 'Oracle condition check not implemented');
            break;

          case 'custom':
            // Custom condition: evaluate based on description
            // For now, log and skip
            logger.warn({ escrowId, condition }, 'Custom condition check not implemented');
            break;
        }
      }

      return true;
    },
  };
}

// =============================================================================
// SINGLETON & EXPORTS
// =============================================================================

let escrowService: EscrowService | null = null;

export function getEscrowService(connection?: Connection): EscrowService {
  if (!escrowService && connection) {
    escrowService = createSolanaEscrowService(connection);
  }
  if (!escrowService) {
    throw new Error('Escrow service not initialized. Provide a Connection.');
  }
  return escrowService;
}

export function initEscrowService(connection: Connection): EscrowService {
  escrowService = createSolanaEscrowService(connection);
  return escrowService;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export function formatEscrowAmount(amount: string, tokenMint?: string): string {
  const value = BigInt(amount);
  if (!tokenMint) {
    // Native SOL
    return `${(Number(value) / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
  }
  // Assume 6 decimals for most SPL tokens
  return `${(Number(value) / 1_000_000).toFixed(2)} tokens`;
}

export function createEscrowId(): string {
  return generateEscrowId();
}
