/**
 * ACP Identity System
 *
 * Provides agent identity features:
 * - Unique handles (@name.clodds)
 * - Takeover/acquisition via escrow
 * - Referral tracking with fee sharing
 * - Public agent profiles
 * - Leaderboard rankings
 */

import { randomBytes, createHash } from 'crypto';
import { Database } from '../db';
import { logger } from '../utils/logger';
// Note: Escrow integration is handled at the handler level where keys are available

// =============================================================================
// TYPES
// =============================================================================

export interface Handle {
  handle: string;
  agentId: string;
  ownerAddress: string;
  createdAt: number;
  transferredAt?: number;
  previousOwner?: string;
}

export interface TakeoverBid {
  id: string;
  handle: string;
  bidderAddress: string;
  amount: string;
  currency: string;
  escrowId?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
  expiresAt: number;
  createdAt: number;
  resolvedAt?: number;
}

export interface Referral {
  id: string;
  referrerAddress: string;
  referredAgentId: string;
  referralCode: string;
  feeShareBps: number; // Basis points (500 = 5%)
  totalEarned: string;
  createdAt: number;
}

export interface AgentProfile {
  agentId: string;
  handle?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  websiteUrl?: string;
  twitterHandle?: string;
  githubHandle?: string;
  featured: boolean;
  verified: boolean;
  totalRevenue: string;
  totalTransactions: number;
  createdAt: number;
  updatedAt: number;
}

export interface LeaderboardEntry {
  agentId: string;
  handle?: string;
  rankRevenue?: number;
  rankTransactions?: number;
  rankRating?: number;
  score: number;
  period: 'all_time' | 'monthly' | 'weekly';
  updatedAt: number;
}

// =============================================================================
// DATABASE LAYER
// =============================================================================

let db: Database | null = null;

export function initIdentityPersistence(database: Database): void {
  db = database;
  ensureTablesExist();
  logger.info('ACP Identity persistence initialized');
}

function getDb(): Database {
  if (!db) {
    throw new Error('ACP Identity persistence not initialized');
  }
  return db;
}

function ensureTablesExist(): void {
  const database = getDb();

  // Handles - unique @name identifiers
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_handles (
      handle TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_address TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      transferred_at INTEGER,
      previous_owner TEXT
    )
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_handles_owner ON acp_handles(owner_address)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_handles_agent ON acp_handles(agent_id)');

  // Takeover bids
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_takeover_bids (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      bidder_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'SOL',
      escrow_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    )
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_bids_handle ON acp_takeover_bids(handle)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_bids_bidder ON acp_takeover_bids(bidder_address)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_bids_status ON acp_takeover_bids(status)');

  // Referrals
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_referrals (
      id TEXT PRIMARY KEY,
      referrer_address TEXT NOT NULL,
      referred_agent_id TEXT NOT NULL,
      referral_code TEXT NOT NULL,
      fee_share_bps INTEGER NOT NULL DEFAULT 500,
      total_earned TEXT NOT NULL DEFAULT '0',
      created_at INTEGER NOT NULL,
      UNIQUE(referred_agent_id)
    )
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_referrals_referrer ON acp_referrals(referrer_address)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_referrals_code ON acp_referrals(referral_code)');

  // Profiles
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_profiles (
      agent_id TEXT PRIMARY KEY,
      handle TEXT,
      display_name TEXT,
      bio TEXT,
      avatar_url TEXT,
      website_url TEXT,
      twitter_handle TEXT,
      github_handle TEXT,
      featured INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      total_revenue TEXT NOT NULL DEFAULT '0',
      total_transactions INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_profiles_handle ON acp_profiles(handle)');
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_profiles_featured ON acp_profiles(featured)');

  // Leaderboard cache
  database.run(`
    CREATE TABLE IF NOT EXISTS acp_leaderboard (
      agent_id TEXT PRIMARY KEY,
      handle TEXT,
      rank_revenue INTEGER,
      rank_transactions INTEGER,
      rank_rating INTEGER,
      score REAL NOT NULL DEFAULT 0,
      period TEXT NOT NULL DEFAULT 'all_time',
      updated_at INTEGER NOT NULL
    )
  `);
  database.run('CREATE INDEX IF NOT EXISTS idx_acp_leaderboard_score ON acp_leaderboard(score DESC)');

  logger.debug('Identity tables ensured');
}

// =============================================================================
// HANDLE VALIDATION
// =============================================================================

const HANDLE_MIN_LENGTH = 3;
const HANDLE_MAX_LENGTH = 20;
const HANDLE_REGEX = /^[a-z0-9_]+$/;
const RESERVED_HANDLES = new Set([
  'admin', 'clodds', 'system', 'api', 'help', 'support',
  'official', 'verified', 'bot', 'agent', 'null', 'undefined',
  'root', 'mod', 'moderator', 'staff', 'team',
]);

export function validateHandle(handle: string): { valid: boolean; error?: string } {
  const normalized = handle.toLowerCase().replace(/^@/, '');

  if (normalized.length < HANDLE_MIN_LENGTH) {
    return { valid: false, error: `Handle must be at least ${HANDLE_MIN_LENGTH} characters` };
  }

  if (normalized.length > HANDLE_MAX_LENGTH) {
    return { valid: false, error: `Handle must be at most ${HANDLE_MAX_LENGTH} characters` };
  }

  if (!HANDLE_REGEX.test(normalized)) {
    return { valid: false, error: 'Handle can only contain lowercase letters, numbers, and underscores' };
  }

  if (RESERVED_HANDLES.has(normalized)) {
    return { valid: false, error: 'This handle is reserved' };
  }

  return { valid: true };
}

function normalizeHandle(handle: string): string {
  return handle.toLowerCase().replace(/^@/, '');
}

// =============================================================================
// HANDLE SERVICE
// =============================================================================

export interface HandleService {
  register(handle: string, agentId: string, ownerAddress: string): Promise<Handle>;
  get(handle: string): Promise<Handle | null>;
  getByAgent(agentId: string): Promise<Handle | null>;
  getByOwner(ownerAddress: string): Promise<Handle[]>;
  transfer(handle: string, fromAddress: string, toAddress: string): Promise<Handle>;
  isAvailable(handle: string): Promise<boolean>;
}

export function createHandleService(): HandleService {
  return {
    async register(handle: string, agentId: string, ownerAddress: string): Promise<Handle> {
      const normalized = normalizeHandle(handle);
      const validation = validateHandle(normalized);

      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Check availability
      const existing = await this.get(normalized);
      if (existing) {
        throw new Error(`Handle @${normalized} is already taken`);
      }

      const database = getDb();
      const now = Date.now();

      database.run(
        `INSERT INTO acp_handles (handle, agent_id, owner_address, created_at)
         VALUES (?, ?, ?, ?)`,
        [normalized, agentId, ownerAddress, now]
      );

      logger.info({ handle: normalized, agentId }, 'Handle registered');

      return {
        handle: normalized,
        agentId,
        ownerAddress,
        createdAt: now,
      };
    },

    async get(handle: string): Promise<Handle | null> {
      const normalized = normalizeHandle(handle);
      const database = getDb();
      const rows = database.query<HandleRow>(
        'SELECT * FROM acp_handles WHERE handle = ?',
        [normalized]
      );
      return rows.length > 0 ? rowToHandle(rows[0]) : null;
    },

    async getByAgent(agentId: string): Promise<Handle | null> {
      const database = getDb();
      const rows = database.query<HandleRow>(
        'SELECT * FROM acp_handles WHERE agent_id = ?',
        [agentId]
      );
      return rows.length > 0 ? rowToHandle(rows[0]) : null;
    },

    async getByOwner(ownerAddress: string): Promise<Handle[]> {
      const database = getDb();
      const rows = database.query<HandleRow>(
        'SELECT * FROM acp_handles WHERE owner_address = ?',
        [ownerAddress]
      );
      return rows.map(rowToHandle);
    },

    async transfer(handle: string, fromAddress: string, toAddress: string): Promise<Handle> {
      const normalized = normalizeHandle(handle);
      const existing = await this.get(normalized);

      if (!existing) {
        throw new Error(`Handle @${normalized} does not exist`);
      }

      if (existing.ownerAddress !== fromAddress) {
        throw new Error('Only the owner can transfer this handle');
      }

      const database = getDb();
      const now = Date.now();

      database.run(
        `UPDATE acp_handles SET owner_address = ?, transferred_at = ?, previous_owner = ? WHERE handle = ?`,
        [toAddress, now, fromAddress, normalized]
      );

      logger.info({ handle: normalized, from: fromAddress, to: toAddress }, 'Handle transferred');

      return {
        ...existing,
        ownerAddress: toAddress,
        transferredAt: now,
        previousOwner: fromAddress,
      };
    },

    async isAvailable(handle: string): Promise<boolean> {
      const normalized = normalizeHandle(handle);
      const validation = validateHandle(normalized);
      if (!validation.valid) return false;

      const existing = await this.get(normalized);
      return existing === null;
    },
  };
}

// =============================================================================
// TAKEOVER BID SERVICE
// =============================================================================

const DEFAULT_BID_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface TakeoverService {
  createBid(handle: string, bidderAddress: string, amount: string, currency?: string): Promise<TakeoverBid>;
  setEscrowId(bidId: string, escrowId: string): Promise<void>;
  getBid(bidId: string): Promise<TakeoverBid | null>;
  getBidsForHandle(handle: string): Promise<TakeoverBid[]>;
  getBidsByBidder(bidderAddress: string): Promise<TakeoverBid[]>;
  acceptBid(bidId: string, ownerAddress: string): Promise<{ bid: TakeoverBid; handle: Handle }>;
  rejectBid(bidId: string, ownerAddress: string): Promise<TakeoverBid>;
  cancelBid(bidId: string, bidderAddress: string): Promise<TakeoverBid>;
  expireStale(): Promise<number>;
}

export function createTakeoverService(): TakeoverService {
  const handleService = createHandleService();

  return {
    async createBid(
      handle: string,
      bidderAddress: string,
      amount: string,
      currency = 'SOL'
    ): Promise<TakeoverBid> {
      const normalized = normalizeHandle(handle);
      const existingHandle = await handleService.get(normalized);

      if (!existingHandle) {
        throw new Error(`Handle @${normalized} does not exist`);
      }

      if (existingHandle.ownerAddress === bidderAddress) {
        throw new Error('Cannot bid on your own handle');
      }

      const database = getDb();
      const now = Date.now();
      const bidId = `bid_${randomBytes(12).toString('hex')}`;
      const expiresAt = now + DEFAULT_BID_EXPIRY_MS;

      // Create bid record (escrow should be created separately at handler level)
      database.run(
        `INSERT INTO acp_takeover_bids (id, handle, bidder_address, amount, currency, escrow_id, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?, ?)`,
        [bidId, normalized, bidderAddress, amount, currency, expiresAt, now]
      );

      logger.info({ bidId, handle: normalized, amount, currency }, 'Takeover bid created');

      return {
        id: bidId,
        handle: normalized,
        bidderAddress,
        amount,
        currency,
        escrowId: undefined,
        status: 'pending',
        expiresAt,
        createdAt: now,
      };
    },

    async setEscrowId(bidId: string, escrowId: string): Promise<void> {
      const database = getDb();
      database.run('UPDATE acp_takeover_bids SET escrow_id = ? WHERE id = ?', [escrowId, bidId]);
    },

    async getBid(bidId: string): Promise<TakeoverBid | null> {
      const database = getDb();
      const rows = database.query<BidRow>(
        'SELECT * FROM acp_takeover_bids WHERE id = ?',
        [bidId]
      );
      return rows.length > 0 ? rowToBid(rows[0]) : null;
    },

    async getBidsForHandle(handle: string): Promise<TakeoverBid[]> {
      const normalized = normalizeHandle(handle);
      const database = getDb();
      const rows = database.query<BidRow>(
        'SELECT * FROM acp_takeover_bids WHERE handle = ? AND status = "pending" ORDER BY amount DESC',
        [normalized]
      );
      return rows.map(rowToBid);
    },

    async getBidsByBidder(bidderAddress: string): Promise<TakeoverBid[]> {
      const database = getDb();
      const rows = database.query<BidRow>(
        'SELECT * FROM acp_takeover_bids WHERE bidder_address = ? ORDER BY created_at DESC',
        [bidderAddress]
      );
      return rows.map(rowToBid);
    },

    async acceptBid(bidId: string, ownerAddress: string): Promise<{ bid: TakeoverBid; handle: Handle }> {
      const bid = await this.getBid(bidId);
      if (!bid) {
        throw new Error('Bid not found');
      }

      if (bid.status !== 'pending') {
        throw new Error(`Bid is ${bid.status}, cannot accept`);
      }

      const existingHandle = await handleService.get(bid.handle);
      if (!existingHandle || existingHandle.ownerAddress !== ownerAddress) {
        throw new Error('Only the handle owner can accept bids');
      }

      // Note: Escrow release should be handled at handler level with proper Keypair

      // Transfer handle to bidder
      const newHandle = await handleService.transfer(bid.handle, ownerAddress, bid.bidderAddress);

      // Update bid status
      const database = getDb();
      const now = Date.now();
      database.run(
        'UPDATE acp_takeover_bids SET status = "accepted", resolved_at = ? WHERE id = ?',
        [now, bidId]
      );

      // Reject all other pending bids for this handle
      database.run(
        'UPDATE acp_takeover_bids SET status = "rejected", resolved_at = ? WHERE handle = ? AND id != ? AND status = "pending"',
        [now, bid.handle, bidId]
      );

      logger.info({ bidId, handle: bid.handle, newOwner: bid.bidderAddress }, 'Takeover bid accepted');

      return {
        bid: { ...bid, status: 'accepted', resolvedAt: now },
        handle: newHandle,
      };
    },

    async rejectBid(bidId: string, ownerAddress: string): Promise<TakeoverBid> {
      const bid = await this.getBid(bidId);
      if (!bid) {
        throw new Error('Bid not found');
      }

      if (bid.status !== 'pending') {
        throw new Error(`Bid is ${bid.status}, cannot reject`);
      }

      const existingHandle = await handleService.get(bid.handle);
      if (!existingHandle || existingHandle.ownerAddress !== ownerAddress) {
        throw new Error('Only the handle owner can reject bids');
      }

      // Note: Escrow refund should be handled at handler level with proper Keypair

      const database = getDb();
      const now = Date.now();
      database.run(
        'UPDATE acp_takeover_bids SET status = "rejected", resolved_at = ? WHERE id = ?',
        [now, bidId]
      );

      logger.info({ bidId, handle: bid.handle }, 'Takeover bid rejected');

      return { ...bid, status: 'rejected', resolvedAt: now };
    },

    async cancelBid(bidId: string, bidderAddress: string): Promise<TakeoverBid> {
      const bid = await this.getBid(bidId);
      if (!bid) {
        throw new Error('Bid not found');
      }

      if (bid.status !== 'pending') {
        throw new Error(`Bid is ${bid.status}, cannot cancel`);
      }

      if (bid.bidderAddress !== bidderAddress) {
        throw new Error('Only the bidder can cancel their bid');
      }

      // Note: Escrow refund should be handled at handler level with proper Keypair

      const database = getDb();
      const now = Date.now();
      database.run(
        'UPDATE acp_takeover_bids SET status = "cancelled", resolved_at = ? WHERE id = ?',
        [now, bidId]
      );

      logger.info({ bidId, handle: bid.handle }, 'Takeover bid cancelled');

      return { ...bid, status: 'cancelled', resolvedAt: now };
    },

    async expireStale(): Promise<number> {
      const database = getDb();
      const now = Date.now();

      // Note: Escrow refunds for expired bids should be handled separately
      // This just marks them as expired in the database

      database.run(
        'UPDATE acp_takeover_bids SET status = "expired", resolved_at = ? WHERE status = "pending" AND expires_at < ?',
        [now, now]
      );

      const result = database.query<{ count: number }>(
        'SELECT changes() as count'
      );
      const count = result[0]?.count || 0;

      if (count > 0) {
        logger.info({ count }, 'Expired stale takeover bids');
      }

      return count;
    },
  };
}

// =============================================================================
// REFERRAL SERVICE
// =============================================================================

const DEFAULT_FEE_SHARE_BPS = 500; // 5%

export interface ReferralService {
  createCode(referrerAddress: string): Promise<string>;
  getByCode(code: string): Promise<Referral | null>;
  getByReferrer(referrerAddress: string): Promise<Referral[]>;
  useCode(code: string, agentId: string): Promise<Referral>;
  getReferrerForAgent(agentId: string): Promise<Referral | null>;
  addEarnings(agentId: string, amount: string): Promise<void>;
  getReferralStats(referrerAddress: string): Promise<{ totalReferred: number; totalEarned: string }>;
}

export function createReferralService(): ReferralService {
  return {
    async createCode(referrerAddress: string): Promise<string> {
      // Generate a short, memorable code
      const hash = createHash('sha256').update(referrerAddress + Date.now()).digest('hex');
      const code = hash.substring(0, 8).toUpperCase();
      return code;
    },

    async getByCode(code: string): Promise<Referral | null> {
      const database = getDb();
      const rows = database.query<ReferralRow>(
        'SELECT * FROM acp_referrals WHERE referral_code = ?',
        [code.toUpperCase()]
      );
      return rows.length > 0 ? rowToReferral(rows[0]) : null;
    },

    async getByReferrer(referrerAddress: string): Promise<Referral[]> {
      const database = getDb();
      const rows = database.query<ReferralRow>(
        'SELECT * FROM acp_referrals WHERE referrer_address = ? ORDER BY created_at DESC',
        [referrerAddress]
      );
      return rows.map(rowToReferral);
    },

    async useCode(code: string, agentId: string): Promise<Referral> {
      const database = getDb();

      // Check if agent already has a referrer
      const existing = database.query<ReferralRow>(
        'SELECT * FROM acp_referrals WHERE referred_agent_id = ?',
        [agentId]
      );
      if (existing.length > 0) {
        throw new Error('Agent already has a referrer');
      }

      // For first use, we need to find the referrer by code from existing referrals
      // or create the referrer's first entry
      const codeRows = database.query<ReferralRow>(
        'SELECT referrer_address FROM acp_referrals WHERE referral_code = ? LIMIT 1',
        [code.toUpperCase()]
      );

      let referrerAddress: string;
      if (codeRows.length > 0) {
        referrerAddress = codeRows[0].referrer_address;
      } else {
        // Code doesn't exist yet - this shouldn't happen if codes are pre-generated
        // But we handle it gracefully by using the code as a placeholder
        throw new Error('Invalid referral code');
      }

      const now = Date.now();
      const id = `ref_${randomBytes(12).toString('hex')}`;

      database.run(
        `INSERT INTO acp_referrals (id, referrer_address, referred_agent_id, referral_code, fee_share_bps, total_earned, created_at)
         VALUES (?, ?, ?, ?, ?, '0', ?)`,
        [id, referrerAddress, agentId, code.toUpperCase(), DEFAULT_FEE_SHARE_BPS, now]
      );

      logger.info({ referrerAddress, agentId, code }, 'Referral code used');

      return {
        id,
        referrerAddress,
        referredAgentId: agentId,
        referralCode: code.toUpperCase(),
        feeShareBps: DEFAULT_FEE_SHARE_BPS,
        totalEarned: '0',
        createdAt: now,
      };
    },

    async getReferrerForAgent(agentId: string): Promise<Referral | null> {
      const database = getDb();
      const rows = database.query<ReferralRow>(
        'SELECT * FROM acp_referrals WHERE referred_agent_id = ?',
        [agentId]
      );
      return rows.length > 0 ? rowToReferral(rows[0]) : null;
    },

    async addEarnings(agentId: string, amount: string): Promise<void> {
      const referral = await this.getReferrerForAgent(agentId);
      if (!referral) return;

      // Calculate referrer's share
      const amountNum = parseFloat(amount);
      const shareNum = (amountNum * referral.feeShareBps) / 10000;
      const currentEarned = parseFloat(referral.totalEarned);
      const newTotal = (currentEarned + shareNum).toString();

      const database = getDb();
      database.run(
        'UPDATE acp_referrals SET total_earned = ? WHERE id = ?',
        [newTotal, referral.id]
      );

      logger.debug({ referrerAddress: referral.referrerAddress, share: shareNum }, 'Added referral earnings');
    },

    async getReferralStats(referrerAddress: string): Promise<{ totalReferred: number; totalEarned: string }> {
      const database = getDb();
      const rows = database.query<{ count: number; total: string }>(
        `SELECT COUNT(*) as count, COALESCE(SUM(CAST(total_earned AS REAL)), 0) as total
         FROM acp_referrals WHERE referrer_address = ?`,
        [referrerAddress]
      );

      if (rows.length === 0) {
        return { totalReferred: 0, totalEarned: '0' };
      }

      return {
        totalReferred: rows[0].count,
        totalEarned: rows[0].total?.toString() || '0',
      };
    },
  };
}

// =============================================================================
// PROFILE SERVICE
// =============================================================================

export interface ProfileService {
  create(agentId: string, data?: Partial<AgentProfile>): Promise<AgentProfile>;
  get(agentId: string): Promise<AgentProfile | null>;
  getByHandle(handle: string): Promise<AgentProfile | null>;
  update(agentId: string, updates: Partial<AgentProfile>): Promise<AgentProfile>;
  setVerified(agentId: string, verified: boolean): Promise<void>;
  setFeatured(agentId: string, featured: boolean): Promise<void>;
  updateRevenue(agentId: string, addAmount: string): Promise<void>;
  incrementTransactions(agentId: string): Promise<void>;
  listFeatured(limit?: number): Promise<AgentProfile[]>;
  listVerified(limit?: number): Promise<AgentProfile[]>;
}

export function createProfileService(): ProfileService {
  const handleService = createHandleService();

  return {
    async create(agentId: string, data?: Partial<AgentProfile>): Promise<AgentProfile> {
      const database = getDb();
      const now = Date.now();

      const profile: AgentProfile = {
        agentId,
        handle: data?.handle,
        displayName: data?.displayName,
        bio: data?.bio,
        avatarUrl: data?.avatarUrl,
        websiteUrl: data?.websiteUrl,
        twitterHandle: data?.twitterHandle,
        githubHandle: data?.githubHandle,
        featured: false,
        verified: false,
        totalRevenue: '0',
        totalTransactions: 0,
        createdAt: now,
        updatedAt: now,
      };

      database.run(
        `INSERT INTO acp_profiles (
          agent_id, handle, display_name, bio, avatar_url, website_url,
          twitter_handle, github_handle, featured, verified,
          total_revenue, total_transactions, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '0', 0, ?, ?)`,
        [
          agentId,
          profile.handle || null,
          profile.displayName || null,
          profile.bio || null,
          profile.avatarUrl || null,
          profile.websiteUrl || null,
          profile.twitterHandle || null,
          profile.githubHandle || null,
          now,
          now,
        ]
      );

      logger.info({ agentId }, 'Profile created');

      return profile;
    },

    async get(agentId: string): Promise<AgentProfile | null> {
      const database = getDb();
      const rows = database.query<ProfileRow>(
        'SELECT * FROM acp_profiles WHERE agent_id = ?',
        [agentId]
      );
      return rows.length > 0 ? rowToProfile(rows[0]) : null;
    },

    async getByHandle(handle: string): Promise<AgentProfile | null> {
      const normalized = normalizeHandle(handle);
      const database = getDb();
      const rows = database.query<ProfileRow>(
        'SELECT * FROM acp_profiles WHERE handle = ?',
        [normalized]
      );
      return rows.length > 0 ? rowToProfile(rows[0]) : null;
    },

    async update(agentId: string, updates: Partial<AgentProfile>): Promise<AgentProfile> {
      const existing = await this.get(agentId);
      if (!existing) {
        throw new Error('Profile not found');
      }

      const database = getDb();
      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const values: unknown[] = [now];

      if (updates.handle !== undefined) {
        setClauses.push('handle = ?');
        values.push(updates.handle ? normalizeHandle(updates.handle) : null);
      }
      if (updates.displayName !== undefined) {
        setClauses.push('display_name = ?');
        values.push(updates.displayName);
      }
      if (updates.bio !== undefined) {
        setClauses.push('bio = ?');
        values.push(updates.bio);
      }
      if (updates.avatarUrl !== undefined) {
        setClauses.push('avatar_url = ?');
        values.push(updates.avatarUrl);
      }
      if (updates.websiteUrl !== undefined) {
        setClauses.push('website_url = ?');
        values.push(updates.websiteUrl);
      }
      if (updates.twitterHandle !== undefined) {
        setClauses.push('twitter_handle = ?');
        values.push(updates.twitterHandle);
      }
      if (updates.githubHandle !== undefined) {
        setClauses.push('github_handle = ?');
        values.push(updates.githubHandle);
      }

      values.push(agentId);
      database.run(`UPDATE acp_profiles SET ${setClauses.join(', ')} WHERE agent_id = ?`, values);

      const updated = await this.get(agentId);
      return updated!;
    },

    async setVerified(agentId: string, verified: boolean): Promise<void> {
      const database = getDb();
      database.run(
        'UPDATE acp_profiles SET verified = ?, updated_at = ? WHERE agent_id = ?',
        [verified ? 1 : 0, Date.now(), agentId]
      );
    },

    async setFeatured(agentId: string, featured: boolean): Promise<void> {
      const database = getDb();
      database.run(
        'UPDATE acp_profiles SET featured = ?, updated_at = ? WHERE agent_id = ?',
        [featured ? 1 : 0, Date.now(), agentId]
      );
    },

    async updateRevenue(agentId: string, addAmount: string): Promise<void> {
      const existing = await this.get(agentId);
      if (!existing) return;

      const current = parseFloat(existing.totalRevenue);
      const add = parseFloat(addAmount);
      const newTotal = (current + add).toString();

      const database = getDb();
      database.run(
        'UPDATE acp_profiles SET total_revenue = ?, updated_at = ? WHERE agent_id = ?',
        [newTotal, Date.now(), agentId]
      );
    },

    async incrementTransactions(agentId: string): Promise<void> {
      const database = getDb();
      database.run(
        'UPDATE acp_profiles SET total_transactions = total_transactions + 1, updated_at = ? WHERE agent_id = ?',
        [Date.now(), agentId]
      );
    },

    async listFeatured(limit = 10): Promise<AgentProfile[]> {
      const database = getDb();
      const rows = database.query<ProfileRow>(
        'SELECT * FROM acp_profiles WHERE featured = 1 ORDER BY total_revenue DESC LIMIT ?',
        [limit]
      );
      return rows.map(rowToProfile);
    },

    async listVerified(limit = 50): Promise<AgentProfile[]> {
      const database = getDb();
      const rows = database.query<ProfileRow>(
        'SELECT * FROM acp_profiles WHERE verified = 1 ORDER BY total_transactions DESC LIMIT ?',
        [limit]
      );
      return rows.map(rowToProfile);
    },
  };
}

// =============================================================================
// LEADERBOARD SERVICE
// =============================================================================

export interface LeaderboardService {
  computeRankings(period?: 'all_time' | 'monthly' | 'weekly'): Promise<void>;
  getTop(count: number, period?: string): Promise<LeaderboardEntry[]>;
  getRank(agentId: string, period?: string): Promise<LeaderboardEntry | null>;
}

export function createLeaderboardService(): LeaderboardService {
  return {
    async computeRankings(period = 'all_time'): Promise<void> {
      const database = getDb();
      const now = Date.now();

      // Get all profiles with their stats
      const profiles = database.query<ProfileRow & { average_rating?: number }>(
        `SELECT p.*, a.average_rating
         FROM acp_profiles p
         LEFT JOIN acp_agents a ON p.agent_id = a.id
         ORDER BY CAST(p.total_revenue AS REAL) DESC`
      );

      // Clear existing leaderboard for this period
      database.run('DELETE FROM acp_leaderboard WHERE period = ?', [period]);

      // Compute rankings
      let revenueRank = 0;
      let lastRevenue = '';
      const entries: Array<{
        agentId: string;
        handle?: string;
        revenue: number;
        transactions: number;
        rating: number;
      }> = [];

      for (const profile of profiles) {
        const entry = {
          agentId: profile.agent_id,
          handle: profile.handle || undefined,
          revenue: parseFloat(profile.total_revenue),
          transactions: profile.total_transactions,
          rating: profile.average_rating || 0,
        };
        entries.push(entry);
      }

      // Sort and assign ranks
      const byRevenue = [...entries].sort((a, b) => b.revenue - a.revenue);
      const byTx = [...entries].sort((a, b) => b.transactions - a.transactions);
      const byRating = [...entries].sort((a, b) => b.rating - a.rating);

      const revenueRanks = new Map<string, number>();
      const txRanks = new Map<string, number>();
      const ratingRanks = new Map<string, number>();

      byRevenue.forEach((e, i) => revenueRanks.set(e.agentId, i + 1));
      byTx.forEach((e, i) => txRanks.set(e.agentId, i + 1));
      byRating.forEach((e, i) => ratingRanks.set(e.agentId, i + 1));

      // Compute composite score and insert
      for (const entry of entries) {
        const rRev = revenueRanks.get(entry.agentId) || entries.length;
        const rTx = txRanks.get(entry.agentId) || entries.length;
        const rRat = ratingRanks.get(entry.agentId) || entries.length;

        // Score: weighted average of inverse ranks (lower rank = higher score)
        const maxRank = entries.length || 1;
        const score =
          0.5 * (1 - (rRev - 1) / maxRank) +
          0.3 * (1 - (rTx - 1) / maxRank) +
          0.2 * (1 - (rRat - 1) / maxRank);

        database.run(
          `INSERT INTO acp_leaderboard (agent_id, handle, rank_revenue, rank_transactions, rank_rating, score, period, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [entry.agentId, entry.handle || null, rRev, rTx, rRat, score, period, now]
        );
      }

      logger.info({ count: entries.length, period }, 'Leaderboard computed');
    },

    async getTop(count: number, period = 'all_time'): Promise<LeaderboardEntry[]> {
      const database = getDb();
      const rows = database.query<LeaderboardRow>(
        'SELECT * FROM acp_leaderboard WHERE period = ? ORDER BY score DESC LIMIT ?',
        [period, count]
      );
      return rows.map(rowToLeaderboard);
    },

    async getRank(agentId: string, period = 'all_time'): Promise<LeaderboardEntry | null> {
      const database = getDb();
      const rows = database.query<LeaderboardRow>(
        'SELECT * FROM acp_leaderboard WHERE agent_id = ? AND period = ?',
        [agentId, period]
      );
      return rows.length > 0 ? rowToLeaderboard(rows[0]) : null;
    },
  };
}

// =============================================================================
// ROW TYPES & CONVERTERS
// =============================================================================

interface HandleRow {
  handle: string;
  agent_id: string;
  owner_address: string;
  created_at: number;
  transferred_at: number | null;
  previous_owner: string | null;
}

interface BidRow {
  id: string;
  handle: string;
  bidder_address: string;
  amount: string;
  currency: string;
  escrow_id: string | null;
  status: string;
  expires_at: number;
  created_at: number;
  resolved_at: number | null;
}

interface ReferralRow {
  id: string;
  referrer_address: string;
  referred_agent_id: string;
  referral_code: string;
  fee_share_bps: number;
  total_earned: string;
  created_at: number;
}

interface ProfileRow {
  agent_id: string;
  handle: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  website_url: string | null;
  twitter_handle: string | null;
  github_handle: string | null;
  featured: number;
  verified: number;
  total_revenue: string;
  total_transactions: number;
  created_at: number;
  updated_at: number;
}

interface LeaderboardRow {
  agent_id: string;
  handle: string | null;
  rank_revenue: number | null;
  rank_transactions: number | null;
  rank_rating: number | null;
  score: number;
  period: string;
  updated_at: number;
}

function rowToHandle(row: HandleRow): Handle {
  return {
    handle: row.handle,
    agentId: row.agent_id,
    ownerAddress: row.owner_address,
    createdAt: row.created_at,
    transferredAt: row.transferred_at || undefined,
    previousOwner: row.previous_owner || undefined,
  };
}

function rowToBid(row: BidRow): TakeoverBid {
  return {
    id: row.id,
    handle: row.handle,
    bidderAddress: row.bidder_address,
    amount: row.amount,
    currency: row.currency,
    escrowId: row.escrow_id || undefined,
    status: row.status as TakeoverBid['status'],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
  };
}

function rowToReferral(row: ReferralRow): Referral {
  return {
    id: row.id,
    referrerAddress: row.referrer_address,
    referredAgentId: row.referred_agent_id,
    referralCode: row.referral_code,
    feeShareBps: row.fee_share_bps,
    totalEarned: row.total_earned,
    createdAt: row.created_at,
  };
}

function rowToProfile(row: ProfileRow): AgentProfile {
  return {
    agentId: row.agent_id,
    handle: row.handle || undefined,
    displayName: row.display_name || undefined,
    bio: row.bio || undefined,
    avatarUrl: row.avatar_url || undefined,
    websiteUrl: row.website_url || undefined,
    twitterHandle: row.twitter_handle || undefined,
    githubHandle: row.github_handle || undefined,
    featured: row.featured === 1,
    verified: row.verified === 1,
    totalRevenue: row.total_revenue,
    totalTransactions: row.total_transactions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLeaderboard(row: LeaderboardRow): LeaderboardEntry {
  return {
    agentId: row.agent_id,
    handle: row.handle || undefined,
    rankRevenue: row.rank_revenue || undefined,
    rankTransactions: row.rank_transactions || undefined,
    rankRating: row.rank_rating || undefined,
    score: row.score,
    period: row.period as LeaderboardEntry['period'],
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// UNIFIED IDENTITY SERVICE
// =============================================================================

export interface IdentityService {
  handles: HandleService;
  takeovers: TakeoverService;
  referrals: ReferralService;
  profiles: ProfileService;
  leaderboard: LeaderboardService;
}

let identityService: IdentityService | null = null;

export function getIdentityService(): IdentityService {
  if (!identityService) {
    identityService = {
      handles: createHandleService(),
      takeovers: createTakeoverService(),
      referrals: createReferralService(),
      profiles: createProfileService(),
      leaderboard: createLeaderboardService(),
    };
  }
  return identityService;
}
