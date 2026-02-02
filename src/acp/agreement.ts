/**
 * Proof-of-Agreement for Agent Commerce Protocol
 *
 * Cryptographically signed agreements between agents:
 * - Terms and conditions
 * - Pricing and deliverables
 * - Deadlines and milestones
 * - Signatures from both parties
 *
 * Supports multi-party agreements and amendment tracking
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash, randomBytes } from 'crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { logger } from '../utils/logger';
import { createAgreementPersistence, type AgreementPersistence } from './persistence';

// =============================================================================
// TYPES
// =============================================================================

export type AgreementStatus = 'draft' | 'proposed' | 'signed' | 'executed' | 'completed' | 'cancelled' | 'disputed';

export interface AgreementParty {
  address: string;
  role: string;
  name?: string;
  signature?: string;
  signedAt?: number;
}

export interface AgreementTerm {
  id: string;
  type: 'payment' | 'deliverable' | 'deadline' | 'condition' | 'custom';
  description: string;
  value?: string | number;
  dueDate?: number;
  completed?: boolean;
  completedAt?: number;
}

export interface AgreementConfig {
  /** Agreement title */
  title: string;
  /** Detailed description */
  description: string;
  /** Parties involved */
  parties: AgreementParty[];
  /** Agreement terms */
  terms: AgreementTerm[];
  /** Total value (optional) */
  totalValue?: string;
  /** Currency/token */
  currency?: string;
  /** Start date */
  startDate?: number;
  /** End date */
  endDate?: number;
  /** Linked escrow ID */
  escrowId?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

export interface Agreement extends AgreementConfig {
  id: string;
  status: AgreementStatus;
  hash: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  previousVersionHash?: string;
}

export interface SignaturePayload {
  agreementId: string;
  agreementHash: string;
  signerAddress: string;
  timestamp: number;
  nonce: string;
}

export interface AgreementService {
  /** Create a new agreement */
  create(config: AgreementConfig): Promise<Agreement>;

  /** Get agreement by ID */
  get(agreementId: string): Promise<Agreement | null>;

  /** Get agreement by hash */
  getByHash(hash: string): Promise<Agreement | null>;

  /** Sign an agreement */
  sign(agreementId: string, signer: Keypair): Promise<Agreement>;

  /** Verify a signature */
  verifySignature(agreement: Agreement, partyAddress: string): boolean;

  /** Verify all signatures */
  verifyAllSignatures(agreement: Agreement): boolean;

  /** Check if agreement is fully signed */
  isFullySigned(agreement: Agreement): boolean;

  /** Update agreement status */
  updateStatus(agreementId: string, status: AgreementStatus): Promise<Agreement>;

  /** Mark a term as completed */
  completeTerm(agreementId: string, termId: string): Promise<Agreement>;

  /** Create an amendment */
  amend(agreementId: string, changes: Partial<AgreementConfig>, signer: Keypair): Promise<Agreement>;

  /** List agreements for an address */
  list(address: string): Promise<Agreement[]>;

  /** Generate agreement hash */
  hashAgreement(agreement: Agreement): string;

  /** Export agreement for sharing */
  export(agreementId: string): Promise<string>;

  /** Import agreement from export */
  import(data: string): Promise<Agreement>;
}

// =============================================================================
// STORAGE (in-memory cache backed by database)
// =============================================================================

const agreementStore = new Map<string, Agreement>();
const hashIndex = new Map<string, string>(); // hash -> id

// Database persistence (lazy-loaded)
let persistence: AgreementPersistence | null = null;
let cacheLoaded = false;

function getPersistence(): AgreementPersistence {
  if (!persistence) {
    persistence = createAgreementPersistence();
  }
  return persistence;
}

async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) return;

  // Load from database on first access
  try {
    // Note: We don't have a listAll method, so cache loads lazily per access
    cacheLoaded = true;
    logger.debug('Agreement cache initialized');
  } catch {
    cacheLoaded = true;
    logger.debug('Agreement using in-memory only (persistence not initialized)');
  }
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Generate unique agreement ID
 */
function generateAgreementId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(6).toString('hex');
  return `agmt_${timestamp}_${random}`;
}

/**
 * Generate term ID
 */
function generateTermId(): string {
  return `term_${randomBytes(4).toString('hex')}`;
}

/**
 * Hash agreement content for signing
 */
function computeAgreementHash(agreement: Omit<Agreement, 'hash'>): string {
  const content = {
    id: agreement.id,
    title: agreement.title,
    description: agreement.description,
    parties: agreement.parties.map(p => ({ address: p.address, role: p.role })),
    terms: agreement.terms,
    totalValue: agreement.totalValue,
    currency: agreement.currency,
    startDate: agreement.startDate,
    endDate: agreement.endDate,
    escrowId: agreement.escrowId,
    version: agreement.version,
    previousVersionHash: agreement.previousVersionHash,
  };

  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * Create signature payload
 */
function createSignaturePayload(agreementId: string, agreementHash: string, signerAddress: string): SignaturePayload {
  return {
    agreementId,
    agreementHash,
    signerAddress,
    timestamp: Date.now(),
    nonce: randomBytes(16).toString('hex'),
  };
}

/**
 * Sign payload with Solana keypair
 */
function signPayload(payload: SignaturePayload, keypair: Keypair): string {
  const message = JSON.stringify(payload);
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  return bs58.encode(signature);
}

/**
 * Verify signature
 */
function verifyPayloadSignature(payload: SignaturePayload, signature: string, publicKey: string): boolean {
  try {
    const message = JSON.stringify(payload);
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const pubkeyBytes = new PublicKey(publicKey).toBytes();
    return nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

/**
 * Create Agreement Service
 */
export function createAgreementService(): AgreementService {
  return {
    async create(config: AgreementConfig): Promise<Agreement> {
      await ensureCacheLoaded();
      const id = generateAgreementId();

      // Ensure all terms have IDs
      const terms = config.terms.map(t => ({
        ...t,
        id: t.id || generateTermId(),
      }));

      const agreement: Agreement = {
        ...config,
        id,
        terms,
        status: 'draft',
        hash: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      };

      // Compute and set hash
      agreement.hash = computeAgreementHash(agreement);

      // Store in cache
      agreementStore.set(id, agreement);
      hashIndex.set(agreement.hash, id);

      // Persist to database
      try {
        await getPersistence().save(agreement);
      } catch (error) {
        logger.debug({ error }, 'Could not persist agreement');
      }

      logger.info({
        agreementId: id,
        title: config.title,
        parties: config.parties.length,
      }, 'Agreement created');

      return agreement;
    },

    async get(agreementId: string): Promise<Agreement | null> {
      await ensureCacheLoaded();

      // Check cache first
      const cached = agreementStore.get(agreementId);
      if (cached) return cached;

      // Try database
      try {
        const fromDb = await getPersistence().get(agreementId);
        if (fromDb) {
          agreementStore.set(agreementId, fromDb);
          hashIndex.set(fromDb.hash, fromDb.id);
          return fromDb;
        }
      } catch {
        // Fall through
      }

      return null;
    },

    async getByHash(hash: string): Promise<Agreement | null> {
      await ensureCacheLoaded();

      // Check cache first
      const id = hashIndex.get(hash);
      if (id) {
        return agreementStore.get(id) || null;
      }

      // Try database
      try {
        const fromDb = await getPersistence().getByHash(hash);
        if (fromDb) {
          agreementStore.set(fromDb.id, fromDb);
          hashIndex.set(fromDb.hash, fromDb.id);
          return fromDb;
        }
      } catch {
        // Fall through
      }

      return null;
    },

    async sign(agreementId: string, signer: Keypair): Promise<Agreement> {
      await ensureCacheLoaded();

      // Get agreement (from cache or DB)
      const agreement = await this.get(agreementId);
      if (!agreement) {
        throw new Error('Agreement not found');
      }

      const signerAddress = signer.publicKey.toBase58();
      const party = agreement.parties.find(p => p.address === signerAddress);

      if (!party) {
        throw new Error('Signer is not a party to this agreement');
      }

      if (party.signature) {
        throw new Error('Party has already signed this agreement');
      }

      // Create and sign payload
      const payload = createSignaturePayload(agreementId, agreement.hash, signerAddress);
      const signature = signPayload(payload, signer);

      // Update party signature
      party.signature = JSON.stringify({ payload, signature });
      party.signedAt = Date.now();

      // Update agreement status
      const allSigned = agreement.parties.every(p => p.signature);
      if (allSigned) {
        agreement.status = 'signed';
      } else if (agreement.status === 'draft') {
        agreement.status = 'proposed';
      }

      agreement.updatedAt = Date.now();

      // Update cache
      agreementStore.set(agreementId, agreement);

      // Persist to database
      try {
        await getPersistence().save(agreement);
      } catch (error) {
        logger.debug({ error }, 'Could not persist agreement signature');
      }

      logger.info({
        agreementId,
        signer: signerAddress,
        allSigned,
      }, 'Agreement signed');

      return agreement;
    },

    verifySignature(agreement: Agreement, partyAddress: string): boolean {
      const party = agreement.parties.find(p => p.address === partyAddress);
      if (!party?.signature) return false;

      try {
        const { payload, signature } = JSON.parse(party.signature) as { payload: SignaturePayload; signature: string };

        // Verify payload matches agreement
        if (payload.agreementId !== agreement.id || payload.agreementHash !== agreement.hash) {
          return false;
        }

        // Verify cryptographic signature
        return verifyPayloadSignature(payload, signature, partyAddress);
      } catch {
        return false;
      }
    },

    verifyAllSignatures(agreement: Agreement): boolean {
      return agreement.parties.every(party => {
        if (!party.signature) return false;
        return this.verifySignature(agreement, party.address);
      });
    },

    isFullySigned(agreement: Agreement): boolean {
      return agreement.parties.every(p => !!p.signature);
    },

    async updateStatus(agreementId: string, status: AgreementStatus): Promise<Agreement> {
      await ensureCacheLoaded();
      const agreement = await this.get(agreementId);
      if (!agreement) {
        throw new Error('Agreement not found');
      }

      agreement.status = status;
      agreement.updatedAt = Date.now();
      agreementStore.set(agreementId, agreement);

      // Persist to database
      try {
        await getPersistence().updateStatus(agreementId, status);
      } catch (error) {
        logger.debug({ error }, 'Could not persist agreement status update');
      }

      logger.info({ agreementId, status }, 'Agreement status updated');

      return agreement;
    },

    async completeTerm(agreementId: string, termId: string): Promise<Agreement> {
      await ensureCacheLoaded();
      const agreement = await this.get(agreementId);
      if (!agreement) {
        throw new Error('Agreement not found');
      }

      const term = agreement.terms.find(t => t.id === termId);
      if (!term) {
        throw new Error('Term not found');
      }

      term.completed = true;
      term.completedAt = Date.now();

      // Check if all terms completed
      const allComplete = agreement.terms.every(t => t.completed);
      if (allComplete) {
        agreement.status = 'completed';
      }

      agreement.updatedAt = Date.now();
      agreementStore.set(agreementId, agreement);

      // Persist to database
      try {
        await getPersistence().save(agreement);
      } catch (error) {
        logger.debug({ error }, 'Could not persist term completion');
      }

      logger.info({ agreementId, termId, allComplete }, 'Agreement term completed');

      return agreement;
    },

    async amend(agreementId: string, changes: Partial<AgreementConfig>, signer: Keypair): Promise<Agreement> {
      await ensureCacheLoaded();
      const original = await this.get(agreementId);
      if (!original) {
        throw new Error('Agreement not found');
      }

      const signerAddress = signer.publicKey.toBase58();
      if (!original.parties.some(p => p.address === signerAddress)) {
        throw new Error('Only parties can amend agreement');
      }

      // Create new version
      const newId = generateAgreementId();
      const amended: Agreement = {
        ...original,
        ...changes,
        id: newId,
        status: 'draft',
        hash: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: original.version + 1,
        previousVersionHash: original.hash,
        // Reset signatures
        parties: (changes.parties || original.parties).map(p => ({
          ...p,
          signature: undefined,
          signedAt: undefined,
        })),
      };

      // Compute new hash
      amended.hash = computeAgreementHash(amended);

      // Update cache
      agreementStore.set(newId, amended);
      hashIndex.set(amended.hash, newId);

      // Persist to database
      try {
        await getPersistence().save(amended);
      } catch (error) {
        logger.debug({ error }, 'Could not persist amended agreement');
      }

      logger.info({
        originalId: agreementId,
        newId,
        version: amended.version,
      }, 'Agreement amended');

      return amended;
    },

    async list(address: string): Promise<Agreement[]> {
      await ensureCacheLoaded();

      // Try database first for complete results
      try {
        const dbResults = await getPersistence().list(address);
        // Update cache with DB results
        for (const agreement of dbResults) {
          agreementStore.set(agreement.id, agreement);
          hashIndex.set(agreement.hash, agreement.id);
        }
        return dbResults.sort((a, b) => b.createdAt - a.createdAt);
      } catch {
        // Fall back to cache
      }

      const results: Agreement[] = [];
      for (const agreement of agreementStore.values()) {
        if (agreement.parties.some(p => p.address === address)) {
          results.push(agreement);
        }
      }

      return results.sort((a, b) => b.createdAt - a.createdAt);
    },

    hashAgreement(agreement: Agreement): string {
      return computeAgreementHash(agreement);
    },

    async export(agreementId: string): Promise<string> {
      const agreement = await this.get(agreementId);
      if (!agreement) {
        throw new Error('Agreement not found');
      }

      const data = {
        version: '1.0',
        type: 'acp_agreement',
        agreement,
        exportedAt: Date.now(),
      };

      return Buffer.from(JSON.stringify(data)).toString('base64');
    },

    async import(data: string): Promise<Agreement> {
      await ensureCacheLoaded();

      try {
        const decoded = JSON.parse(Buffer.from(data, 'base64').toString());

        if (decoded.type !== 'acp_agreement') {
          throw new Error('Invalid agreement format');
        }

        const agreement = decoded.agreement as Agreement;

        // Verify hash
        const computedHash = computeAgreementHash(agreement);
        if (computedHash !== agreement.hash) {
          throw new Error('Agreement hash mismatch - data may be corrupted');
        }

        // Store in cache
        agreementStore.set(agreement.id, agreement);
        hashIndex.set(agreement.hash, agreement.id);

        // Persist to database
        try {
          await getPersistence().save(agreement);
        } catch (error) {
          logger.debug({ error }, 'Could not persist imported agreement');
        }

        logger.info({ agreementId: agreement.id }, 'Agreement imported');

        return agreement;
      } catch (error) {
        throw new Error(`Failed to import agreement: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

// =============================================================================
// SINGLETON & EXPORTS
// =============================================================================

let agreementService: AgreementService | null = null;

export function getAgreementService(): AgreementService {
  if (!agreementService) {
    agreementService = createAgreementService();
  }
  return agreementService;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a simple two-party service agreement
 */
export function createServiceAgreement(
  buyer: string,
  seller: string,
  serviceDescription: string,
  price: string,
  currency: string,
  deliveryDate: number
): AgreementConfig {
  return {
    title: 'Service Agreement',
    description: serviceDescription,
    parties: [
      { address: buyer, role: 'buyer' },
      { address: seller, role: 'seller' },
    ],
    terms: [
      {
        id: generateTermId(),
        type: 'payment',
        description: `Payment of ${price} ${currency}`,
        value: price,
      },
      {
        id: generateTermId(),
        type: 'deliverable',
        description: serviceDescription,
      },
      {
        id: generateTermId(),
        type: 'deadline',
        description: 'Delivery deadline',
        dueDate: deliveryDate,
      },
    ],
    totalValue: price,
    currency,
    endDate: deliveryDate,
  };
}

/**
 * Verify agreement chain (for amendments)
 */
export async function verifyAgreementChain(agreement: Agreement): Promise<boolean> {
  const service = getAgreementService();
  let current = agreement;

  while (current.previousVersionHash) {
    const previous = await service.getByHash(current.previousVersionHash);
    if (!previous) {
      return false; // Broken chain
    }
    current = previous;
  }

  return true;
}
