/**
 * Pairing Service - Clawdbot-style DM access control
 *
 * Features:
 * - 8-char codes, uppercase, no ambiguous chars (0, O, 1, I)
 * - 1 hour expiry
 * - Max 3 pending requests per channel
 * - Persistent storage in DB
 * - Trust levels: owner > paired > stranger
 */

import { Database } from '../db/index';
import { logger } from '../utils/logger';

// Characters that are unambiguous (excludes 0, O, 1, I)
const PAIRING_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const MAX_PENDING_PER_CHANNEL = 3;

/** Trust levels (higher = more trusted) */
export type TrustLevel = 'owner' | 'paired' | 'stranger';

export interface PairingRequest {
  code: string;
  channel: string;
  userId: string;
  username?: string;
  createdAt: Date;
  expiresAt: Date;
}

/** Database row type for pairing requests (SQLite stores dates as strings) */
interface PairingRequestRow {
  code: string;
  channel: string;
  userId: string;
  username?: string;
  createdAt: string;
  expiresAt: string;
}

export interface PairedUser {
  channel: string;
  userId: string;
  username?: string;
  pairedAt: Date;
  pairedBy: 'code' | 'allowlist' | 'auto' | 'owner';
  /** Whether this user is an owner (can approve pairings) */
  isOwner: boolean;
}

/** Database row type (SQLite stores dates as strings, booleans as integers) */
interface PairedUserRow {
  channel: string;
  userId: string;
  username?: string;
  pairedAt: string;
  pairedBy: string;
  isOwner: number;
}

export interface PairingService {
  /** Generate a new pairing code for a pending user */
  createPairingRequest(channel: string, userId: string, username?: string): Promise<string | null>;

  /** Validate and consume a pairing code */
  validateCode(code: string): Promise<PairingRequest | null>;

  /** Approve a pending request (by owner) */
  approveRequest(channel: string, code: string): Promise<boolean>;

  /** Reject a pending request */
  rejectRequest(channel: string, code: string): Promise<boolean>;

  /** Check if a user is paired */
  isPaired(channel: string, userId: string): boolean;

  /** Get user's trust level */
  getTrustLevel(channel: string, userId: string): TrustLevel;

  /** Check if user is an owner */
  isOwner(channel: string, userId: string): boolean;

  /** Add a user to paired list (for allowlist entries) */
  addPairedUser(channel: string, userId: string, username?: string, method?: 'code' | 'allowlist' | 'auto' | 'owner'): void;

  /** Set a user as owner */
  setOwner(channel: string, userId: string, username?: string): void;

  /** Remove owner status */
  removeOwner(channel: string, userId: string): void;

  /** Remove a user from paired list */
  removePairedUser(channel: string, userId: string): void;

  /** List all pending requests for a channel */
  listPendingRequests(channel: string): PairingRequest[];

  /** List all paired users for a channel */
  listPairedUsers(channel: string): PairedUser[];

  /** List all owners for a channel */
  listOwners(channel: string): PairedUser[];

  /** Cleanup expired requests */
  cleanupExpired(): void;
}

/**
 * Generate an 8-character pairing code using unambiguous characters
 */
function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += PAIRING_CHARS[Math.floor(Math.random() * PAIRING_CHARS.length)];
  }
  return code;
}

export function createPairingService(db: Database): PairingService {
  // In-memory cache (also persisted to DB)
  const pendingRequests = new Map<string, PairingRequest>(); // code -> request
  const pairedUsers = new Map<string, PairedUser>(); // `${channel}:${userId}` -> user

  // Load from DB on startup
  const loadFromDb = () => {
    try {
      const requests = db.query<PairingRequestRow>(
        'SELECT * FROM pairing_requests WHERE expiresAt > datetime("now")'
      );
      for (const row of requests) {
        pendingRequests.set(row.code, {
          code: row.code,
          channel: row.channel,
          userId: row.userId,
          username: row.username,
          createdAt: new Date(row.createdAt),
          expiresAt: new Date(row.expiresAt),
        });
      }

      const users = db.query<PairedUserRow>('SELECT * FROM paired_users');
      for (const row of users) {
        const key = `${row.channel}:${row.userId}`;
        pairedUsers.set(key, {
          channel: row.channel,
          userId: row.userId,
          username: row.username,
          pairedAt: new Date(row.pairedAt),
          pairedBy: row.pairedBy as PairedUser['pairedBy'],
          isOwner: Boolean(row.isOwner),
        });
      }

      logger.info({ pending: pendingRequests.size, paired: pairedUsers.size }, 'Loaded pairing data');
    } catch (err) {
      // Tables might not exist yet
      logger.debug('Pairing tables not initialized yet');
    }
  };

  loadFromDb();

  // Cleanup expired requests periodically
  setInterval(() => {
    const now = new Date();
    for (const [code, req] of pendingRequests) {
      if (now > req.expiresAt) {
        pendingRequests.delete(code);
        db.run('DELETE FROM pairing_requests WHERE code = ?', [code]);
      }
    }
  }, 60000); // Check every minute

  return {
    async createPairingRequest(channel, userId, username) {
      // Check if already paired
      const key = `${channel}:${userId}`;
      if (pairedUsers.has(key)) {
        return null; // Already paired
      }

      // Check if user already has a pending request
      for (const [code, req] of pendingRequests) {
        if (req.channel === channel && req.userId === userId) {
          // Return existing code if still valid
          if (new Date() < req.expiresAt) {
            return code;
          }
          // Remove expired
          pendingRequests.delete(code);
        }
      }

      // Check max pending per channel
      let channelPending = 0;
      for (const req of pendingRequests.values()) {
        if (req.channel === channel) channelPending++;
      }
      if (channelPending >= MAX_PENDING_PER_CHANNEL) {
        logger.warn({ channel }, 'Max pending pairing requests reached');
        return null;
      }

      // Generate new code
      let code: string;
      do {
        code = generateCode();
      } while (pendingRequests.has(code));

      const request: PairingRequest = {
        code,
        channel,
        userId,
        username,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + CODE_EXPIRY_MS),
      };

      pendingRequests.set(code, request);

      // Persist to DB
      db.run(`
        INSERT INTO pairing_requests (code, channel, userId, username, createdAt, expiresAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [code, channel, userId, username || null, request.createdAt.toISOString(), request.expiresAt.toISOString()]);

      logger.info({ channel, userId, code }, 'Created pairing request');
      return code;
    },

    async validateCode(code) {
      const upperCode = code.toUpperCase().trim();
      const request = pendingRequests.get(upperCode);

      if (!request) return null;
      if (new Date() > request.expiresAt) {
        pendingRequests.delete(upperCode);
        db.run('DELETE FROM pairing_requests WHERE code = ?', [upperCode]);
        return null;
      }

      // Valid - consume the code and pair the user
      pendingRequests.delete(upperCode);
      db.run('DELETE FROM pairing_requests WHERE code = ?', [upperCode]);

      this.addPairedUser(request.channel, request.userId, request.username, 'code');

      return request;
    },

    async approveRequest(channel, code) {
      const upperCode = code.toUpperCase().trim();
      const request = pendingRequests.get(upperCode);

      if (!request || request.channel !== channel) return false;

      pendingRequests.delete(upperCode);
      db.run('DELETE FROM pairing_requests WHERE code = ?', [upperCode]);

      this.addPairedUser(request.channel, request.userId, request.username, 'code');

      logger.info({ channel, userId: request.userId, code }, 'Approved pairing request');
      return true;
    },

    async rejectRequest(channel, code) {
      const upperCode = code.toUpperCase().trim();
      const request = pendingRequests.get(upperCode);

      if (!request || request.channel !== channel) return false;

      pendingRequests.delete(upperCode);
      db.run('DELETE FROM pairing_requests WHERE code = ?', [upperCode]);

      logger.info({ channel, code }, 'Rejected pairing request');
      return true;
    },

    isPaired(channel, userId) {
      const key = `${channel}:${userId}`;
      return pairedUsers.has(key);
    },

    getTrustLevel(channel, userId): TrustLevel {
      const key = `${channel}:${userId}`;
      const user = pairedUsers.get(key);

      if (!user) return 'stranger';
      if (user.isOwner) return 'owner';
      return 'paired';
    },

    isOwner(channel, userId) {
      const key = `${channel}:${userId}`;
      const user = pairedUsers.get(key);
      return user?.isOwner ?? false;
    },

    addPairedUser(channel, userId, username, method = 'allowlist') {
      const key = `${channel}:${userId}`;
      const existing = pairedUsers.get(key);

      const user: PairedUser = {
        channel,
        userId,
        username,
        pairedAt: existing?.pairedAt || new Date(),
        pairedBy: method,
        isOwner: existing?.isOwner ?? (method === 'owner'),
      };

      pairedUsers.set(key, user);

      // Persist to DB
      db.run(`
        INSERT OR REPLACE INTO paired_users (channel, userId, username, pairedAt, pairedBy, isOwner)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [channel, userId, username || null, user.pairedAt.toISOString(), method, user.isOwner ? 1 : 0]);

      logger.info({ channel, userId, method, isOwner: user.isOwner }, 'User paired');
    },

    setOwner(channel, userId, username) {
      const key = `${channel}:${userId}`;
      const existing = pairedUsers.get(key);

      const user: PairedUser = {
        channel,
        userId,
        username: username || existing?.username,
        pairedAt: existing?.pairedAt || new Date(),
        pairedBy: existing?.pairedBy || 'owner',
        isOwner: true,
      };

      pairedUsers.set(key, user);

      db.run(`
        INSERT OR REPLACE INTO paired_users (channel, userId, username, pairedAt, pairedBy, isOwner)
        VALUES (?, ?, ?, ?, ?, 1)
      `, [channel, userId, user.username || null, user.pairedAt.toISOString(), user.pairedBy]);

      logger.info({ channel, userId }, 'User set as owner');
    },

    removeOwner(channel, userId) {
      const key = `${channel}:${userId}`;
      const user = pairedUsers.get(key);

      if (user) {
        user.isOwner = false;
        pairedUsers.set(key, user);
        db.run('UPDATE paired_users SET isOwner = 0 WHERE channel = ? AND userId = ?', [channel, userId]);
        logger.info({ channel, userId }, 'Owner status removed');
      }
    },

    removePairedUser(channel, userId) {
      const key = `${channel}:${userId}`;
      pairedUsers.delete(key);
      db.run('DELETE FROM paired_users WHERE channel = ? AND userId = ?', [channel, userId]);
      logger.info({ channel, userId }, 'User unpaired');
    },

    listPendingRequests(channel) {
      const requests: PairingRequest[] = [];
      const now = new Date();

      for (const req of pendingRequests.values()) {
        if (req.channel === channel && now < req.expiresAt) {
          requests.push(req);
        }
      }

      return requests.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    listPairedUsers(channel) {
      const users: PairedUser[] = [];

      for (const user of pairedUsers.values()) {
        if (user.channel === channel) {
          users.push(user);
        }
      }

      return users.sort((a, b) => a.pairedAt.getTime() - b.pairedAt.getTime());
    },

    listOwners(channel) {
      const owners: PairedUser[] = [];

      for (const user of pairedUsers.values()) {
        if (user.channel === channel && user.isOwner) {
          owners.push(user);
        }
      }

      return owners;
    },

    cleanupExpired() {
      const now = new Date();
      let cleaned = 0;

      for (const [code, req] of pendingRequests) {
        if (now > req.expiresAt) {
          pendingRequests.delete(code);
          db.run('DELETE FROM pairing_requests WHERE code = ?', [code]);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.info({ cleaned }, 'Cleaned up expired pairing requests');
      }
    },
  };
}
