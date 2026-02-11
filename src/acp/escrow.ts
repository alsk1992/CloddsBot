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

// =============================================================================
// SPL TOKEN HELPERS (Dynamic import to handle ESM/CJS compatibility)
// =============================================================================

interface TokenAccount {
  address: PublicKey;
  amount: bigint;
}

interface SplTokenModule {
  getOrCreateAssociatedTokenAccount: (
    connection: Connection,
    payer: Keypair,
    mint: PublicKey,
    owner: PublicKey,
    allowOwnerOffCurve?: boolean
  ) => Promise<TokenAccount>;
  transfer: (
    connection: Connection,
    payer: Keypair,
    source: PublicKey,
    destination: PublicKey,
    owner: Keypair,
    amount: bigint
  ) => Promise<string>;
  getAccount: (
    connection: Connection,
    address: PublicKey
  ) => Promise<TokenAccount>;
}

let splTokenModule: SplTokenModule | null = null;

async function getSplToken(): Promise<SplTokenModule> {
  if (!splTokenModule) {
    // Dynamic import for ESM compatibility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spl: any = await import('@solana/spl-token');
    splTokenModule = {
      getOrCreateAssociatedTokenAccount: spl.getOrCreateAssociatedTokenAccount,
      transfer: spl.transfer,
      getAccount: spl.getAccount,
    };
  }
  return splTokenModule;
}

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
// ORACLE CONDITION SUPPORT
// =============================================================================

/**
 * Oracle configuration for condition checks
 * Supports: Pyth Network, HTTP endpoints, Switchboard
 */
export interface OracleConfig {
  /** Oracle type */
  type: 'pyth' | 'http' | 'switchboard';
  /** Feed ID (Pyth price feed or Switchboard feed) or HTTP URL */
  feedId: string;
  /** Comparison operator */
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  /** Target value to compare against */
  targetValue: number;
  /** JSON path for HTTP oracle response (e.g., "data.price") */
  jsonPath?: string;
}

/**
 * Parse oracle condition value
 * Format: "pyth:BTC/USD:gt:50000" or "http:https://api.example.com/price:lt:100:data.price"
 */
function parseOracleCondition(value: string): OracleConfig | null {
  const parts = value.split(':');
  if (parts.length < 4) return null;

  const [type, feedId, operator, targetStr, jsonPath] = parts;

  if (!['pyth', 'http', 'switchboard'].includes(type)) return null;
  if (!['gt', 'lt', 'gte', 'lte', 'eq'].includes(operator)) return null;

  const targetValue = parseFloat(targetStr);
  if (isNaN(targetValue)) return null;

  return {
    type: type as OracleConfig['type'],
    feedId,
    operator: operator as OracleConfig['operator'],
    targetValue,
    jsonPath,
  };
}

/**
 * Compare values based on operator
 */
function compareValues(actual: number, operator: OracleConfig['operator'], target: number): boolean {
  switch (operator) {
    case 'gt': return actual > target;
    case 'lt': return actual < target;
    case 'gte': return actual >= target;
    case 'lte': return actual <= target;
    case 'eq': return Math.abs(actual - target) < 0.000001;
    default: return false;
  }
}

/**
 * Get value from nested JSON path (e.g., "data.price" -> obj.data.price)
 */
function getJsonPathValue(obj: unknown, path: string): number | null {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return null;
    if (typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === 'number') return current;
  if (typeof current === 'string') {
    const parsed = parseFloat(current);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Fetch price from Pyth Network (Solana)
 * Uses Pyth's price feed accounts
 */
async function fetchPythPrice(connection: Connection, feedId: string): Promise<number | null> {
  try {
    // Pyth price feed accounts on Solana mainnet
    // feedId format: either full public key or known pairs like "BTC/USD"
    const knownFeeds: Record<string, string> = {
      'BTC/USD': 'GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU',
      'ETH/USD': 'JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB',
      'SOL/USD': 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG',
      'USDC/USD': 'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD',
      'MATIC/USD': '7KVswB9vkCgeM3SHP7aGDijvdRAHK8P5wi9JXViCrtYh',
    };

    const feedPubkey = knownFeeds[feedId] || feedId;
    const accountPubkey = new PublicKey(feedPubkey);
    const accountInfo = await connection.getAccountInfo(accountPubkey);

    if (!accountInfo?.data) {
      logger.warn({ feedId }, 'Pyth price feed account not found');
      return null;
    }

    // Parse Pyth price account (simplified - real impl would use @pythnetwork/client)
    // Price is stored at offset 208, exponent at 212
    const data = accountInfo.data;
    if (data.length < 220) return null;

    const priceRaw = data.readBigInt64LE(208);
    const expo = data.readInt32LE(216);
    const price = Number(priceRaw) * Math.pow(10, expo);

    logger.debug({ feedId, price }, 'Fetched Pyth price');
    return price;
  } catch (error) {
    logger.error({ feedId, error }, 'Failed to fetch Pyth price');
    return null;
  }
}

/**
 * Fetch price from HTTP oracle endpoint
 */
async function fetchHttpOraclePrice(url: string, jsonPath?: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'HTTP oracle request failed');
      return null;
    }

    const data: unknown = await response.json();

    if (jsonPath) {
      const value = getJsonPathValue(data, jsonPath);
      if (value !== null) {
        logger.debug({ url, jsonPath, value }, 'Fetched HTTP oracle price');
        return value;
      }
      logger.warn({ url, jsonPath }, 'JSON path not found in response');
      return null;
    }

    // If no path, try common patterns with type narrowing
    if (typeof data === 'number') return data;

    if (data !== null && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (typeof obj.price === 'number') return obj.price;
      if (typeof obj.result === 'number') return obj.result;
      if (typeof obj.value === 'number') return obj.value;
      if (obj.data !== null && typeof obj.data === 'object') {
        const nested = obj.data as Record<string, unknown>;
        if (typeof nested.price === 'number') return nested.price;
      }
    }

    logger.warn({ url }, 'Could not extract price from HTTP oracle response');
    return null;
  } catch (error) {
    logger.error({ url, error }, 'Failed to fetch HTTP oracle price');
    return null;
  }
}

/**
 * Check oracle condition against live data
 */
async function checkOracleCondition(
  connection: Connection,
  config: OracleConfig
): Promise<boolean> {
  let actualValue: number | null = null;

  switch (config.type) {
    case 'pyth':
      actualValue = await fetchPythPrice(connection, config.feedId);
      break;
    case 'http':
      actualValue = await fetchHttpOraclePrice(config.feedId, config.jsonPath);
      break;
    case 'switchboard': {
      // Switchboard V2 AggregatorAccountData (packed, 8-byte Anchor discriminator):
      // latestConfirmedRound starts at offset 341, result (SwitchboardDecimal) at +25 = 366
      // SwitchboardDecimal = mantissa: i128 (16 bytes LE) + scale: u32 (4 bytes LE)
      const SB_RESULT_OFFSET = 366;
      const SB_MIN_ACCOUNT_SIZE = SB_RESULT_OFFSET + 20; // mantissa(16) + scale(4)
      try {
        const feedPubkey = new PublicKey(config.feedId);
        const accountInfo = await connection.getAccountInfo(feedPubkey);
        if (!accountInfo?.data || accountInfo.data.length < SB_MIN_ACCOUNT_SIZE) {
          logger.warn({ feedId: config.feedId }, 'Switchboard feed account not found or too small');
          return false;
        }
        const data = accountInfo.data;
        const lo = data.readBigUInt64LE(SB_RESULT_OFFSET);
        const hi = data.readBigInt64LE(SB_RESULT_OFFSET + 8);
        const mantissa = (hi << 64n) | lo;
        const scale = data.readUInt32LE(SB_RESULT_OFFSET + 16);
        const divisor = 10n ** BigInt(scale);
        const wholePart = mantissa / divisor;
        const remainder = mantissa % divisor;
        actualValue = Number(wholePart) + Number(remainder) / Number(divisor);
        logger.debug({ feedId: config.feedId, value: actualValue, scale }, 'Fetched Switchboard price');
      } catch (error) {
        logger.error({ feedId: config.feedId, error }, 'Failed to fetch Switchboard price');
        return false;
      }
      break;
    }
  }

  if (actualValue === null) {
    logger.warn({ config }, 'Could not fetch oracle value, treating condition as not met');
    return false;
  }

  const result = compareValues(actualValue, config.operator, config.targetValue);
  logger.debug({ config, actualValue, result }, 'Oracle condition check result');
  return result;
}

// =============================================================================
// CUSTOM CONDITION REGISTRY
// =============================================================================

/**
 * Custom condition handler function type
 * Receives the escrow and condition, returns whether the condition is met
 */
export type CustomConditionHandler = (
  escrow: Escrow,
  condition: EscrowCondition
) => Promise<boolean>;

/**
 * Registry for custom condition handlers
 * Key is the condition name (from condition.value)
 */
const customConditionHandlers = new Map<string, CustomConditionHandler>();

/**
 * Register a custom condition handler
 * @param name - Unique name for the condition (e.g., "delivery_confirmed")
 * @param handler - Async function that checks if condition is met
 */
export function registerCustomCondition(name: string, handler: CustomConditionHandler): void {
  if (customConditionHandlers.has(name)) {
    logger.warn({ name }, 'Overwriting existing custom condition handler');
  }
  customConditionHandlers.set(name, handler);
  logger.info({ name }, 'Custom condition handler registered');
}

/**
 * Unregister a custom condition handler
 */
export function unregisterCustomCondition(name: string): boolean {
  return customConditionHandlers.delete(name);
}

/**
 * List all registered custom condition handlers
 */
export function listCustomConditions(): string[] {
  return Array.from(customConditionHandlers.keys());
}

/**
 * Check a custom condition using the registered handler
 */
async function checkCustomCondition(escrow: Escrow, condition: EscrowCondition): Promise<boolean> {
  const conditionName = typeof condition.value === 'string' ? condition.value : String(condition.value);

  // Check if there's a registered handler
  const handler = customConditionHandlers.get(conditionName);
  if (!handler) {
    logger.warn({ conditionName, escrowId: escrow.id }, 'No handler registered for custom condition');
    return false;
  }

  try {
    const result = await handler(escrow, condition);
    logger.debug({ conditionName, escrowId: escrow.id, result }, 'Custom condition check result');
    return result;
  } catch (error) {
    logger.error({ conditionName, escrowId: escrow.id, error }, 'Custom condition handler threw error');
    return false;
  }
}

// =============================================================================
// BUILT-IN CUSTOM CONDITIONS
// =============================================================================

// Register some commonly useful built-in conditions
registerCustomCondition('always_true', async () => true);
registerCustomCondition('always_false', async () => false);

// Time-window condition: "time_window:START_TS:END_TS"
registerCustomCondition('time_window', async (_escrow, condition) => {
  const [, startStr, endStr] = String(condition.value).split(':');
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  if (isNaN(start) || isNaN(end)) return false;
  const now = Date.now();
  return now >= start && now <= end;
});

// Escrow age condition: "min_age:MILLISECONDS" - escrow must be at least this old
registerCustomCondition('min_age', async (escrow, condition) => {
  const [, msStr] = String(condition.value).split(':');
  const minAge = parseInt(msStr, 10);
  if (isNaN(minAge)) return false;
  return Date.now() - escrow.createdAt >= minAge;
});

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
          // SPL Token transfer using high-level helpers
          const spl = await getSplToken();
          const mintPubkey = new PublicKey(escrow.tokenMint);

          // Get or create escrow's associated token account
          const escrowAta = await spl.getOrCreateAssociatedTokenAccount(
            connection,
            payer,
            mintPubkey,
            escrowPubkey,
            true // allowOwnerOffCurve - escrow keypair may not be on curve
          );

          // Get payer's token account
          const payerAta = await spl.getOrCreateAssociatedTokenAccount(
            connection,
            payer,
            mintPubkey,
            payer.publicKey
          );

          // Transfer SPL tokens to escrow
          const signature = await spl.transfer(
            connection,
            payer,
            payerAta.address,
            escrowAta.address,
            payer,
            amount
          );

          // Update escrow status
          escrow.status = 'funded';
          escrow.fundedAt = Date.now();
          escrow.txSignatures.push(signature);
          await persistence.save(escrow);

          logger.info({ escrowId, signature, token: escrow.tokenMint }, 'SPL token escrow funded');

          return { success: true, escrowId, signature };
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

        const sellerPubkey = new PublicKey(escrow.seller);

        if (escrow.tokenMint) {
          // SPL Token release using high-level helpers
          const spl = await getSplToken();
          const mintPubkey = new PublicKey(escrow.tokenMint);

          // Get escrow's token account
          const escrowAta = await spl.getOrCreateAssociatedTokenAccount(
            connection,
            escrowKeypair,
            mintPubkey,
            escrowKeypair.publicKey,
            true
          );

          // Get escrow token balance
          const tokenBalance = escrowAta.amount;
          if (tokenBalance <= BigInt(0)) {
            return { success: false, escrowId, error: 'Escrow token account is empty' };
          }

          // Get or create seller's token account
          const sellerAta = await spl.getOrCreateAssociatedTokenAccount(
            connection,
            escrowKeypair, // escrow pays for account creation
            mintPubkey,
            sellerPubkey
          );

          // Transfer tokens from escrow to seller
          const signature = await spl.transfer(
            connection,
            escrowKeypair,
            escrowAta.address,
            sellerAta.address,
            escrowKeypair,
            tokenBalance
          );

          // Update escrow
          escrow.status = 'released';
          escrow.completedAt = Date.now();
          escrow.txSignatures.push(signature);
          await persistence.save(escrow);

          await clearEscrowKeypair(escrowId);

          logger.info({ escrowId, signature, seller: escrow.seller, token: escrow.tokenMint }, 'SPL token escrow released');

          return { success: true, escrowId, signature };
        }

        // Native SOL release
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

        if (escrow.tokenMint) {
          // SPL Token refund using high-level helpers
          const spl = await getSplToken();
          const mintPubkey = new PublicKey(escrow.tokenMint);

          // Get escrow's token account
          const escrowAta = await spl.getOrCreateAssociatedTokenAccount(
            connection,
            escrowKeypair,
            mintPubkey,
            escrowKeypair.publicKey,
            true
          );

          // Get escrow token balance
          const tokenBalance = escrowAta.amount;
          if (tokenBalance <= BigInt(0)) {
            return { success: false, escrowId, error: 'Escrow token account is empty' };
          }

          // Get or create buyer's token account (should exist since they funded)
          const buyerAta = await spl.getOrCreateAssociatedTokenAccount(
            connection,
            escrowKeypair,
            mintPubkey,
            buyerPubkey
          );

          // Transfer tokens back to buyer
          const signature = await spl.transfer(
            connection,
            escrowKeypair,
            escrowAta.address,
            buyerAta.address,
            escrowKeypair,
            tokenBalance
          );

          // Update escrow
          escrow.status = 'refunded';
          escrow.completedAt = Date.now();
          escrow.txSignatures.push(signature);
          await persistence.save(escrow);

          await clearEscrowKeypair(escrowId);

          logger.info({ escrowId, signature, buyer: escrow.buyer, token: escrow.tokenMint }, 'SPL token escrow refunded');

          return { success: true, escrowId, signature };
        }

        // Native SOL refund
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
              logger.debug({ escrowId, condition, now: Date.now() }, 'Time condition not met');
              return false;
            }
            break;

          case 'signature':
            // Signature condition: check if tx with required signature exists
            // Value should be the signature to look for
            if (typeof condition.value === 'string') {
              const hasSignature = escrow.txSignatures.some(sig => sig === condition.value);
              if (!hasSignature) {
                logger.debug({ escrowId, condition }, 'Signature condition not met');
                return false;
              }
            }
            break;

          case 'oracle': {
            // Oracle condition: query external data source
            // Format: "pyth:BTC/USD:gt:50000" or "http:https://api.example.com:lt:100:data.price"
            const oracleConfig = parseOracleCondition(String(condition.value));
            if (!oracleConfig) {
              logger.warn({ escrowId, condition }, 'Invalid oracle condition format');
              return false;
            }
            const oracleMet = await checkOracleCondition(connection, oracleConfig);
            if (!oracleMet) {
              logger.debug({ escrowId, condition }, 'Oracle condition not met');
              return false;
            }
            break;
          }

          case 'custom': {
            // Custom condition: use registered handler
            const customMet = await checkCustomCondition(escrow, condition);
            if (!customMet) {
              logger.debug({ escrowId, condition }, 'Custom condition not met');
              return false;
            }
            break;
          }
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

/**
 * Create an oracle condition string
 * @example createOracleCondition('pyth', 'BTC/USD', 'gt', 50000)
 * @example createOracleCondition('http', 'https://api.example.com/price', 'lt', 100, 'data.price')
 */
export function createOracleCondition(
  type: OracleConfig['type'],
  feedId: string,
  operator: OracleConfig['operator'],
  targetValue: number,
  jsonPath?: string
): string {
  const parts = [type, feedId, operator, targetValue.toString()];
  if (jsonPath) parts.push(jsonPath);
  return parts.join(':');
}

/**
 * Validate an oracle condition string format
 */
export function isValidOracleCondition(value: string): boolean {
  return parseOracleCondition(value) !== null;
}
