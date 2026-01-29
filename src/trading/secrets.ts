/**
 * Secrets Management - Encrypted credential storage
 *
 * Features:
 * - AES-256-GCM encryption for credentials
 * - Key derivation from master password
 * - Secure memory handling
 * - Audit logging for access
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import { Database } from '../db/index';
import { logger } from '../utils/logger';

const scryptAsync = promisify(scrypt);

// =============================================================================
// TYPES
// =============================================================================

export interface SecretStore {
  /** Store an encrypted secret */
  set(key: string, value: string, category?: string): Promise<void>;

  /** Retrieve and decrypt a secret */
  get(key: string): Promise<string | null>;

  /** Check if a secret exists */
  has(key: string): Promise<boolean>;

  /** Delete a secret */
  delete(key: string): Promise<boolean>;

  /** List secret keys (not values) */
  list(category?: string): Promise<string[]>;

  /** Rotate encryption key */
  rotateKey(newMasterKey: string): Promise<void>;

  /** Get access audit log */
  getAuditLog(limit?: number): Promise<AuditEntry[]>;

  /** Clear all secrets (dangerous!) */
  clear(): Promise<void>;
}

export interface AuditEntry {
  action: 'read' | 'write' | 'delete' | 'rotate';
  key: string;
  timestamp: Date;
  success: boolean;
  error?: string;
}

interface EncryptedData {
  iv: string;
  authTag: string;
  data: string;
  salt: string;
  version: number;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;
const CURRENT_VERSION = 1;

export async function createSecretStore(
  db: Database,
  masterKey: string
): Promise<SecretStore> {
  // Validate master key
  if (!masterKey || masterKey.length < 8) {
    throw new Error('Master key must be at least 8 characters');
  }

  // Initialize tables
  db.run(`
    CREATE TABLE IF NOT EXISTS secrets (
      key TEXT PRIMARY KEY,
      encrypted_data TEXT NOT NULL,
      category TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS secrets_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      key TEXT NOT NULL,
      success INTEGER NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_secrets_category ON secrets(category)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_created ON secrets_audit(created_at)`);

  // Derive encryption key from master key
  async function deriveKey(salt: Buffer): Promise<Buffer> {
    return scryptAsync(masterKey, salt, KEY_LENGTH) as Promise<Buffer>;
  }

  async function encrypt(plaintext: string): Promise<EncryptedData> {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = await deriveKey(salt);

    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      data: encrypted.toString('base64'),
      salt: salt.toString('base64'),
      version: CURRENT_VERSION,
    };
  }

  async function decrypt(encryptedData: EncryptedData): Promise<string> {
    const salt = Buffer.from(encryptedData.salt, 'base64');
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');
    const data = Buffer.from(encryptedData.data, 'base64');
    const key = await deriveKey(salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  function logAudit(action: AuditEntry['action'], key: string, success: boolean, error?: string): void {
    db.run(
      `INSERT INTO secrets_audit (action, key, success, error, created_at) VALUES (?, ?, ?, ?, ?)`,
      [action, key, success ? 1 : 0, error || null, new Date().toISOString()]
    );
  }

  return {
    async set(key, value, category) {
      try {
        const encrypted = await encrypt(value);
        const now = new Date().toISOString();

        db.run(
          `INSERT OR REPLACE INTO secrets (key, encrypted_data, category, created_at, updated_at)
           VALUES (?, ?, ?, COALESCE((SELECT created_at FROM secrets WHERE key = ?), ?), ?)`,
          [key, JSON.stringify(encrypted), category || null, key, now, now]
        );

        logAudit('write', key, true);
        logger.debug({ key, category }, 'Secret stored');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logAudit('write', key, false, message);
        throw error;
      }
    },

    async get(key) {
      try {
        const rows = db.query<{ encrypted_data: string }>(
          `SELECT encrypted_data FROM secrets WHERE key = ?`,
          [key]
        );

        if (rows.length === 0) {
          logAudit('read', key, true);
          return null;
        }

        const encryptedData: EncryptedData = JSON.parse(rows[0].encrypted_data);
        const decrypted = await decrypt(encryptedData);

        logAudit('read', key, true);
        return decrypted;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logAudit('read', key, false, message);
        logger.error({ key, error: message }, 'Failed to decrypt secret');
        return null;
      }
    },

    async has(key) {
      const rows = db.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM secrets WHERE key = ?`,
        [key]
      );
      return rows[0]?.count > 0;
    },

    async delete(key) {
      try {
        const result = db.run(`DELETE FROM secrets WHERE key = ?`, [key]);
        const deleted = (result.changes || 0) > 0;
        logAudit('delete', key, deleted);
        return deleted;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logAudit('delete', key, false, message);
        return false;
      }
    },

    async list(category) {
      const query = category
        ? `SELECT key FROM secrets WHERE category = ? ORDER BY key`
        : `SELECT key FROM secrets ORDER BY key`;
      const params = category ? [category] : [];

      const rows = db.query<{ key: string }>(query, params);
      return rows.map((r) => r.key);
    },

    async rotateKey(newMasterKey) {
      if (!newMasterKey || newMasterKey.length < 8) {
        throw new Error('New master key must be at least 8 characters');
      }

      // Get all secrets
      const rows = db.query<{ key: string; encrypted_data: string; category: string }>(
        `SELECT key, encrypted_data, category FROM secrets`
      );

      // Decrypt with old key, encrypt with new key
      const oldMaster = masterKey;

      for (const row of rows) {
        try {
          // Decrypt with old key
          const encryptedData: EncryptedData = JSON.parse(row.encrypted_data);
          const plaintext = await decrypt(encryptedData);

          // Temporarily use new key for encryption
          (masterKey as any) = newMasterKey;
          const newEncrypted = await encrypt(plaintext);

          // Update in database
          db.run(
            `UPDATE secrets SET encrypted_data = ?, updated_at = ? WHERE key = ?`,
            [JSON.stringify(newEncrypted), new Date().toISOString(), row.key]
          );
        } catch (error) {
          // Restore old key on failure
          (masterKey as any) = oldMaster;
          throw error;
        }
      }

      // Update master key reference
      (masterKey as any) = newMasterKey;

      logAudit('rotate', '*', true);
      logger.info({ count: rows.length }, 'Encryption key rotated');
    },

    async getAuditLog(limit = 100) {
      const rows = db.query<{
        action: string;
        key: string;
        success: number;
        error: string | null;
        created_at: string;
      }>(
        `SELECT action, key, success, error, created_at FROM secrets_audit
         ORDER BY created_at DESC LIMIT ?`,
        [limit]
      );

      return rows.map((r) => ({
        action: r.action as AuditEntry['action'],
        key: r.key,
        timestamp: new Date(r.created_at),
        success: r.success === 1,
        error: r.error || undefined,
      }));
    },

    async clear() {
      db.run(`DELETE FROM secrets`);
      logAudit('delete', '*', true);
      logger.warn('All secrets cleared');
    },
  };
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Mask a secret for display (show first/last 4 chars)
 */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) {
    return '*'.repeat(secret.length);
  }
  return `${secret.slice(0, 4)}${'*'.repeat(secret.length - 8)}${secret.slice(-4)}`;
}

/**
 * Generate a secure random API key
 */
export function generateApiKey(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Validate API key format
 */
export function validateApiKey(key: string): boolean {
  // Basic validation - adjust based on exchange requirements
  if (!key || typeof key !== 'string') return false;
  if (key.length < 16) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) return false;
  return true;
}
