/**
 * ACP Database Persistence Layer
 *
 * Provides persistent storage for all ACP commerce modules:
 * - Agent profiles
 * - Service listings
 * - Agreements
 * - Escrows
 * - Ratings
 */

import { Database } from '../db';
import { logger } from '../utils/logger';
import type { AgentProfile, ServiceListing, ServiceRating, ServiceCategory } from './registry';
import type { Agreement, AgreementStatus, AgreementParty, AgreementTerm } from './agreement';
import type { Escrow, EscrowStatus, EscrowCondition } from './escrow';

// Database instance - must be set before use
let db: Database | null = null;

export function initACPPersistence(database: Database): void {
  db = database;
  ensureTablesExist();
  logger.info('ACP persistence initialized');
}

function getDb(): Database {
  if (!db) {
    throw new Error('ACP persistence not initialized. Call initACPPersistence first.');
  }
  return db;
}

function ensureTablesExist(): void {
  const database = getDb();

  // Agents
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_agents (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      avatar TEXT,
      website TEXT,
      capabilities TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      total_transactions INTEGER NOT NULL DEFAULT 0,
      successful_transactions INTEGER NOT NULL DEFAULT 0,
      average_rating REAL NOT NULL DEFAULT 0,
      total_ratings INTEGER NOT NULL DEFAULT 0,
      dispute_rate REAL NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_agents_address ON acp_agents(address)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_agents_status ON acp_agents(status)');

  // Services
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_services (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      capability_name TEXT NOT NULL,
      capability_category TEXT NOT NULL,
      capability_description TEXT,
      pricing_model TEXT NOT NULL,
      pricing_amount TEXT NOT NULL,
      pricing_currency TEXT NOT NULL DEFAULT 'SOL',
      description TEXT NOT NULL,
      endpoint TEXT,
      sla_availability REAL,
      sla_response_time INTEGER,
      sla_throughput INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_services_agent ON acp_services(agent_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_services_category ON acp_services(capability_category)');

  // Agreements
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_agreements (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      parties TEXT NOT NULL,
      terms TEXT NOT NULL,
      total_value TEXT,
      currency TEXT,
      start_date INTEGER,
      end_date INTEGER,
      escrow_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      previous_version_hash TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_agreements_status ON acp_agreements(status)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_agreements_hash ON acp_agreements(hash)');

  // Escrows
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_escrows (
      id TEXT PRIMARY KEY,
      chain TEXT NOT NULL DEFAULT 'solana',
      buyer TEXT NOT NULL,
      seller TEXT NOT NULL,
      arbiter TEXT,
      amount TEXT NOT NULL,
      token_mint TEXT,
      release_conditions TEXT NOT NULL DEFAULT '[]',
      refund_conditions TEXT NOT NULL DEFAULT '[]',
      expires_at INTEGER NOT NULL,
      description TEXT,
      agreement_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      escrow_address TEXT,
      encrypted_keypair TEXT,
      tx_signatures TEXT NOT NULL DEFAULT '[]',
      funded_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_escrows_buyer ON acp_escrows(buyer)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_escrows_seller ON acp_escrows(seller)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_escrows_status ON acp_escrows(status)');

  // Migration: Add encrypted_keypair column if it doesn't exist
  try {
    database.run('ALTER TABLE acp_escrows ADD COLUMN encrypted_keypair TEXT');
    logger.info('Added encrypted_keypair column to acp_escrows');
  } catch {
    // Column already exists, ignore
  }

  // Ratings
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_ratings (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      rater_address TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT,
      agreement_id TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_ratings_service ON acp_ratings(service_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_ratings_rater ON acp_ratings(rater_address)');

  logger.debug('ACP tables ensured');
}

// =============================================================================
// AGENT PERSISTENCE
// =============================================================================

export interface AgentPersistence {
  save(agent: AgentProfile): Promise<void>;
  saveService(agentId: string, service: ServiceListing): Promise<void>;
  get(id: string): Promise<AgentProfile | null>;
  getByAddress(address: string): Promise<AgentProfile | null>;
  getServices(agentId: string): Promise<ServiceListing[]>;
  list(status?: string): Promise<AgentProfile[]>;
  update(id: string, updates: Partial<AgentProfile>): Promise<void>;
  delete(id: string): Promise<void>;
}

export function createAgentPersistence(): AgentPersistence {
  return {
    async save(agent: AgentProfile): Promise<void> {
      const database = getDb();
      database.run(
        `INSERT OR REPLACE INTO acp_agents (
          id, address, name, description, avatar, website, capabilities,
          status, total_transactions, successful_transactions, average_rating,
          total_ratings, dispute_rate, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          agent.id,
          agent.address,
          agent.name,
          agent.description || null,
          agent.avatar || null,
          agent.website || null,
          JSON.stringify(agent.capabilities),
          agent.status,
          agent.reputation.totalTransactions,
          agent.reputation.successfulTransactions,
          agent.reputation.averageRating,
          agent.reputation.totalRatings,
          agent.reputation.disputeRate,
          agent.metadata ? JSON.stringify(agent.metadata) : null,
          agent.createdAt,
          agent.updatedAt,
        ]
      );

      // Save services
      for (const service of agent.services) {
        await this.saveService(agent.id, service);
      }

      logger.debug({ agentId: agent.id }, 'Agent saved to database');
    },

    async saveService(agentId: string, service: ServiceListing): Promise<void> {
      const database = getDb();
      database.run(
        `INSERT OR REPLACE INTO acp_services (
          id, agent_id, capability_name, capability_category, capability_description,
          pricing_model, pricing_amount, pricing_currency, description, endpoint,
          sla_availability, sla_response_time, sla_throughput, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          service.id,
          agentId,
          service.capability.name,
          service.capability.category,
          service.capability.description || null,
          service.pricing.model,
          service.pricing.amount,
          service.pricing.currency,
          service.description,
          service.endpoint || null,
          service.sla?.availabilityPercent || null,
          service.sla?.maxResponseTimeMs || null,
          service.sla?.maxThroughput || null,
          service.enabled ? 1 : 0,
          service.createdAt,
          service.updatedAt,
        ]
      );
    },

    async get(id: string): Promise<AgentProfile | null> {
      const database = getDb();
      const rows = database.query<AgentRow>(
        'SELECT * FROM acp_agents WHERE id = ?',
        [id]
      );
      if (rows.length === 0) return null;

      const agent = rowToAgent(rows[0]);
      agent.services = await this.getServices(id);
      return agent;
    },

    async getByAddress(address: string): Promise<AgentProfile | null> {
      const database = getDb();
      const rows = database.query<AgentRow>(
        'SELECT * FROM acp_agents WHERE address = ?',
        [address]
      );
      if (rows.length === 0) return null;

      const agent = rowToAgent(rows[0]);
      agent.services = await this.getServices(agent.id);
      return agent;
    },

    async getServices(agentId: string): Promise<ServiceListing[]> {
      const database = getDb();
      const rows = database.query<ServiceRow>(
        'SELECT * FROM acp_services WHERE agent_id = ?',
        [agentId]
      );
      return rows.map(rowToService);
    },

    async list(status?: string): Promise<AgentProfile[]> {
      const database = getDb();
      const sql = status
        ? 'SELECT * FROM acp_agents WHERE status = ? ORDER BY average_rating DESC'
        : 'SELECT * FROM acp_agents ORDER BY average_rating DESC';
      const params = status ? [status] : [];
      const rows = database.query<AgentRow>(sql, params);

      const agents: AgentProfile[] = [];
      for (const row of rows) {
        const agent = rowToAgent(row);
        agent.services = await this.getServices(agent.id);
        agents.push(agent);
      }
      return agents;
    },

    async update(id: string, updates: Partial<AgentProfile>): Promise<void> {
      const database = getDb();
      const setClauses: string[] = ['updated_at = ?'];
      const values: unknown[] = [Date.now()];

      if (updates.name !== undefined) {
        setClauses.push('name = ?');
        values.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push('description = ?');
        values.push(updates.description);
      }
      if (updates.status !== undefined) {
        setClauses.push('status = ?');
        values.push(updates.status);
      }
      if (updates.reputation !== undefined) {
        setClauses.push('total_transactions = ?');
        values.push(updates.reputation.totalTransactions);
        setClauses.push('successful_transactions = ?');
        values.push(updates.reputation.successfulTransactions);
        setClauses.push('average_rating = ?');
        values.push(updates.reputation.averageRating);
        setClauses.push('total_ratings = ?');
        values.push(updates.reputation.totalRatings);
        setClauses.push('dispute_rate = ?');
        values.push(updates.reputation.disputeRate);
      }

      values.push(id);
      database.run(`UPDATE acp_agents SET ${setClauses.join(', ')} WHERE id = ?`, values);
    },

    async delete(id: string): Promise<void> {
      const database = getDb();
      database.run('DELETE FROM acp_services WHERE agent_id = ?', [id]);
      database.run('DELETE FROM acp_agents WHERE id = ?', [id]);
    },
  };
}

// =============================================================================
// AGREEMENT PERSISTENCE
// =============================================================================

export interface AgreementPersistence {
  save(agreement: Agreement): Promise<void>;
  get(id: string): Promise<Agreement | null>;
  getByHash(hash: string): Promise<Agreement | null>;
  list(partyAddress: string): Promise<Agreement[]>;
  updateStatus(id: string, status: AgreementStatus): Promise<void>;
  update(id: string, updates: Partial<Agreement>): Promise<void>;
}

export function createAgreementPersistence(): AgreementPersistence {
  return {
    async save(agreement: Agreement): Promise<void> {
      const database = getDb();
      database.run(
        `INSERT OR REPLACE INTO acp_agreements (
          id, hash, title, description, parties, terms, total_value, currency,
          start_date, end_date, escrow_id, status, version, previous_version_hash,
          metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          agreement.id,
          agreement.hash,
          agreement.title,
          agreement.description,
          JSON.stringify(agreement.parties),
          JSON.stringify(agreement.terms),
          agreement.totalValue || null,
          agreement.currency || null,
          agreement.startDate || null,
          agreement.endDate || null,
          agreement.escrowId || null,
          agreement.status,
          agreement.version,
          agreement.previousVersionHash || null,
          agreement.metadata ? JSON.stringify(agreement.metadata) : null,
          agreement.createdAt,
          agreement.updatedAt,
        ]
      );
      logger.debug({ agreementId: agreement.id }, 'Agreement saved to database');
    },

    async get(id: string): Promise<Agreement | null> {
      const database = getDb();
      const rows = database.query<AgreementRow>(
        'SELECT * FROM acp_agreements WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? rowToAgreement(rows[0]) : null;
    },

    async getByHash(hash: string): Promise<Agreement | null> {
      const database = getDb();
      const rows = database.query<AgreementRow>(
        'SELECT * FROM acp_agreements WHERE hash = ?',
        [hash]
      );
      return rows.length > 0 ? rowToAgreement(rows[0]) : null;
    },

    async list(partyAddress: string): Promise<Agreement[]> {
      const database = getDb();
      // Search for agreements where party address is in the JSON parties array
      const rows = database.query<AgreementRow>(
        `SELECT * FROM acp_agreements WHERE parties LIKE ? ORDER BY created_at DESC`,
        [`%"address":"${partyAddress}"%`]
      );
      return rows.map(rowToAgreement);
    },

    async updateStatus(id: string, status: AgreementStatus): Promise<void> {
      const database = getDb();
      database.run(
        'UPDATE acp_agreements SET status = ?, updated_at = ? WHERE id = ?',
        [status, Date.now(), id]
      );
    },

    async update(id: string, updates: Partial<Agreement>): Promise<void> {
      const existing = await this.get(id);
      if (!existing) return;

      const merged = { ...existing, ...updates, updatedAt: Date.now() };
      await this.save(merged);
    },
  };
}

// =============================================================================
// ESCROW PERSISTENCE
// =============================================================================

export interface EscrowPersistence {
  save(escrow: Escrow): Promise<void>;
  get(id: string): Promise<Escrow | null>;
  listByParty(address: string): Promise<Escrow[]>;
  listByStatus(status: EscrowStatus): Promise<Escrow[]>;
  updateStatus(id: string, status: EscrowStatus, signature?: string): Promise<void>;
  /** Save encrypted escrow keypair (survives server restarts) */
  saveEncryptedKeypair(id: string, encryptedKeypair: string): Promise<void>;
  /** Get encrypted escrow keypair for decryption */
  getEncryptedKeypair(id: string): Promise<string | null>;
  /** Clear encrypted keypair after release/refund */
  clearEncryptedKeypair(id: string): Promise<void>;
}

export function createEscrowPersistence(): EscrowPersistence {
  return {
    async save(escrow: Escrow): Promise<void> {
      const database = getDb();
      database.run(
        `INSERT OR REPLACE INTO acp_escrows (
          id, chain, buyer, seller, arbiter, amount, token_mint,
          release_conditions, refund_conditions, expires_at, description,
          agreement_hash, status, escrow_address, tx_signatures, funded_at,
          completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          escrow.id,
          escrow.chain,
          escrow.buyer,
          escrow.seller,
          escrow.arbiter || null,
          escrow.amount,
          escrow.tokenMint || null,
          JSON.stringify(escrow.releaseConditions),
          JSON.stringify(escrow.refundConditions),
          escrow.expiresAt,
          escrow.description || null,
          escrow.agreementHash || null,
          escrow.status,
          escrow.escrowAddress || null,
          JSON.stringify(escrow.txSignatures || []),
          escrow.fundedAt || null,
          escrow.completedAt || null,
          escrow.createdAt,
        ]
      );
      logger.debug({ escrowId: escrow.id }, 'Escrow saved to database');
    },

    async get(id: string): Promise<Escrow | null> {
      const database = getDb();
      const rows = database.query<EscrowRow>(
        'SELECT * FROM acp_escrows WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? rowToEscrow(rows[0]) : null;
    },

    async listByParty(address: string): Promise<Escrow[]> {
      const database = getDb();
      const rows = database.query<EscrowRow>(
        'SELECT * FROM acp_escrows WHERE buyer = ? OR seller = ? OR arbiter = ? ORDER BY created_at DESC',
        [address, address, address]
      );
      return rows.map(rowToEscrow);
    },

    async listByStatus(status: EscrowStatus): Promise<Escrow[]> {
      const database = getDb();
      const rows = database.query<EscrowRow>(
        'SELECT * FROM acp_escrows WHERE status = ? ORDER BY created_at DESC',
        [status]
      );
      return rows.map(rowToEscrow);
    },

    async updateStatus(id: string, status: EscrowStatus, signature?: string): Promise<void> {
      const escrow = await this.get(id);
      if (!escrow) return;

      const txSignatures = escrow.txSignatures || [];
      if (signature) {
        txSignatures.push(signature);
      }

      const completedAt = ['released', 'refunded', 'expired'].includes(status) ? Date.now() : null;

      const database = getDb();
      database.run(
        `UPDATE acp_escrows SET status = ?, tx_signatures = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`,
        [status, JSON.stringify(txSignatures), completedAt, id]
      );
    },

    async saveEncryptedKeypair(id: string, encryptedKeypair: string): Promise<void> {
      const database = getDb();
      database.run(
        'UPDATE acp_escrows SET encrypted_keypair = ? WHERE id = ?',
        [encryptedKeypair, id]
      );
      logger.debug({ escrowId: id }, 'Escrow keypair encrypted and saved to database');
    },

    async getEncryptedKeypair(id: string): Promise<string | null> {
      const database = getDb();
      const rows = database.query<{ encrypted_keypair: string | null }>(
        'SELECT encrypted_keypair FROM acp_escrows WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? rows[0].encrypted_keypair : null;
    },

    async clearEncryptedKeypair(id: string): Promise<void> {
      const database = getDb();
      database.run(
        'UPDATE acp_escrows SET encrypted_keypair = NULL WHERE id = ?',
        [id]
      );
      logger.debug({ escrowId: id }, 'Escrow keypair cleared from database');
    },
  };
}

// =============================================================================
// RATING PERSISTENCE
// =============================================================================

export interface RatingPersistence {
  save(rating: ServiceRating): Promise<void>;
  getForService(serviceId: string): Promise<ServiceRating[]>;
  getByRater(raterAddress: string): Promise<ServiceRating[]>;
}

export function createRatingPersistence(): RatingPersistence {
  return {
    async save(rating: ServiceRating): Promise<void> {
      const database = getDb();
      database.run(
        `INSERT INTO acp_ratings (id, service_id, rater_address, rating, comment, agreement_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          rating.id,
          rating.serviceId,
          rating.raterAddress,
          rating.rating,
          rating.review || null,
          rating.transactionId || null,
          rating.createdAt,
        ]
      );
    },

    async getForService(serviceId: string): Promise<ServiceRating[]> {
      const database = getDb();
      const rows = database.query<RatingRow>(
        'SELECT * FROM acp_ratings WHERE service_id = ? ORDER BY created_at DESC',
        [serviceId]
      );
      return rows.map(rowToRating);
    },

    async getByRater(raterAddress: string): Promise<ServiceRating[]> {
      const database = getDb();
      const rows = database.query<RatingRow>(
        'SELECT * FROM acp_ratings WHERE rater_address = ? ORDER BY created_at DESC',
        [raterAddress]
      );
      return rows.map(rowToRating);
    },
  };
}

// =============================================================================
// ROW TYPES & CONVERTERS
// =============================================================================

interface AgentRow {
  id: string;
  address: string;
  name: string;
  description: string | null;
  avatar: string | null;
  website: string | null;
  capabilities: string;
  status: string;
  total_transactions: number;
  successful_transactions: number;
  average_rating: number;
  total_ratings: number;
  dispute_rate: number;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

interface ServiceRow {
  id: string;
  agent_id: string;
  capability_name: string;
  capability_category: string;
  capability_description: string | null;
  pricing_model: string;
  pricing_amount: string;
  pricing_currency: string;
  description: string;
  endpoint: string | null;
  sla_availability: number | null;
  sla_response_time: number | null;
  sla_throughput: number | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

interface AgreementRow {
  id: string;
  hash: string;
  title: string;
  description: string;
  parties: string;
  terms: string;
  total_value: string | null;
  currency: string | null;
  start_date: number | null;
  end_date: number | null;
  escrow_id: string | null;
  status: string;
  version: number;
  previous_version_hash: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

interface EscrowRow {
  id: string;
  chain: string;
  buyer: string;
  seller: string;
  arbiter: string | null;
  amount: string;
  token_mint: string | null;
  release_conditions: string;
  refund_conditions: string;
  expires_at: number;
  description: string | null;
  agreement_hash: string | null;
  status: string;
  escrow_address: string | null;
  tx_signatures: string;
  funded_at: number | null;
  completed_at: number | null;
  created_at: number;
}

interface RatingRow {
  id: string;
  service_id: string;
  rater_address: string;
  rating: number;
  comment: string | null;
  agreement_id: string | null;
  created_at: number;
}

function rowToAgent(row: AgentRow): AgentProfile {
  return {
    id: row.id,
    address: row.address,
    name: row.name,
    description: row.description || undefined,
    avatar: row.avatar || undefined,
    website: row.website || undefined,
    capabilities: JSON.parse(row.capabilities),
    services: [], // Loaded separately
    status: row.status as 'active' | 'inactive' | 'suspended',
    reputation: {
      totalTransactions: row.total_transactions,
      successfulTransactions: row.successful_transactions,
      averageRating: row.average_rating,
      totalRatings: row.total_ratings,
      responseTimeAvgMs: 0, // Not stored yet
      disputeRate: row.dispute_rate,
    },
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToService(row: ServiceRow): ServiceListing {
  return {
    id: row.id,
    agentId: row.agent_id,
    capability: {
      id: row.id, // Use service id as capability id
      name: row.capability_name,
      category: row.capability_category as ServiceCategory,
      description: row.capability_description || '',
    },
    pricing: {
      model: row.pricing_model as 'per_request' | 'per_minute' | 'per_token' | 'flat' | 'custom',
      amount: row.pricing_amount,
      currency: row.pricing_currency,
    },
    description: row.description,
    endpoint: row.endpoint || undefined,
    sla: row.sla_availability
      ? {
          availabilityPercent: row.sla_availability,
          maxResponseTimeMs: row.sla_response_time || 0,
          maxThroughput: row.sla_throughput || undefined,
        }
      : undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAgreement(row: AgreementRow): Agreement {
  return {
    id: row.id,
    hash: row.hash,
    title: row.title,
    description: row.description,
    parties: JSON.parse(row.parties) as AgreementParty[],
    terms: JSON.parse(row.terms) as AgreementTerm[],
    totalValue: row.total_value || undefined,
    currency: row.currency || undefined,
    startDate: row.start_date || undefined,
    endDate: row.end_date || undefined,
    escrowId: row.escrow_id || undefined,
    status: row.status as AgreementStatus,
    version: row.version,
    previousVersionHash: row.previous_version_hash || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEscrow(row: EscrowRow): Escrow {
  return {
    id: row.id,
    chain: row.chain as 'solana' | 'base',
    buyer: row.buyer,
    seller: row.seller,
    arbiter: row.arbiter || undefined,
    amount: row.amount,
    tokenMint: row.token_mint || undefined,
    releaseConditions: JSON.parse(row.release_conditions) as EscrowCondition[],
    refundConditions: JSON.parse(row.refund_conditions) as EscrowCondition[],
    expiresAt: row.expires_at,
    description: row.description || undefined,
    agreementHash: row.agreement_hash || undefined,
    status: row.status as EscrowStatus,
    escrowAddress: row.escrow_address || '',
    txSignatures: JSON.parse(row.tx_signatures) as string[],
    fundedAt: row.funded_at || undefined,
    completedAt: row.completed_at || undefined,
    createdAt: row.created_at,
  };
}

function rowToRating(row: RatingRow): ServiceRating {
  return {
    id: row.id,
    serviceId: row.service_id,
    raterAddress: row.rater_address,
    rating: row.rating,
    review: row.comment || undefined,
    transactionId: row.agreement_id || undefined,
    createdAt: row.created_at,
  };
}

// =============================================================================
// SINGLETON ACCESS
// =============================================================================

let agentPersistence: AgentPersistence | null = null;
let agreementPersistence: AgreementPersistence | null = null;
let escrowPersistence: EscrowPersistence | null = null;
let ratingPersistence: RatingPersistence | null = null;

export function getAgentPersistence(): AgentPersistence {
  if (!agentPersistence) {
    agentPersistence = createAgentPersistence();
  }
  return agentPersistence;
}

export function getAgreementPersistence(): AgreementPersistence {
  if (!agreementPersistence) {
    agreementPersistence = createAgreementPersistence();
  }
  return agreementPersistence;
}

export function getEscrowPersistence(): EscrowPersistence {
  if (!escrowPersistence) {
    escrowPersistence = createEscrowPersistence();
  }
  return escrowPersistence;
}

export function getRatingPersistence(): RatingPersistence {
  if (!ratingPersistence) {
    ratingPersistence = createRatingPersistence();
  }
  return ratingPersistence;
}
