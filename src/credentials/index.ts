/**
 * Credentials Manager - Per-User Trading Credentials
 *
 * Based on Clawdbot's auth-profiles architecture:
 * - Credentials stored encrypted in DB per user
 * - Resolved at runtime for tool execution
 * - Cooldown tracking for failed auth attempts
 * - Factory pattern: tools receive TradingContext, not raw credentials
 */

import * as crypto from 'crypto';
import {
  Platform,
  TradingCredentials,
  TradingContext,
  PlatformCredentials,
  PolymarketCredentials,
  KalshiCredentials,
  ManifoldCredentials,
} from '../types.js';
import { Database } from '../db/index.js';
import { logger } from '../utils/logger.js';

// Encryption key from environment (32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.CLODDS_CREDENTIAL_KEY ||
  'default-key-change-me-in-production';

/**
 * Encrypt credentials for storage
 */
function encrypt(data: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt credentials from storage
 */
function decrypt(encryptedData: string): string {
  const [ivHex, encrypted] = encryptedData.split(':');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export interface CredentialsManager {
  /**
   * Store credentials for a user/platform
   */
  setCredentials: (
    userId: string,
    platform: Platform,
    credentials: PolymarketCredentials | KalshiCredentials | ManifoldCredentials
  ) => Promise<void>;

  /**
   * Get decrypted credentials for a user/platform
   */
  getCredentials: <T>(userId: string, platform: Platform) => Promise<T | null>;

  /**
   * Check if user has credentials for a platform
   */
  hasCredentials: (userId: string, platform: Platform) => Promise<boolean>;

  /**
   * Delete credentials for a user/platform
   */
  deleteCredentials: (userId: string, platform: Platform) => Promise<void>;

  /**
   * Mark credentials as used successfully (reset cooldown)
   */
  markSuccess: (userId: string, platform: Platform) => Promise<void>;

  /**
   * Mark credentials as failed (increment cooldown)
   */
  markFailure: (userId: string, platform: Platform) => Promise<void>;

  /**
   * Check if credentials are in cooldown
   */
  isInCooldown: (userId: string, platform: Platform) => Promise<boolean>;

  /**
   * Build TradingContext for tool execution
   * (Clawdbot-style factory pattern)
   */
  buildTradingContext: (userId: string, sessionKey: string) => Promise<TradingContext>;

  /**
   * List all platforms user has credentials for
   */
  listUserPlatforms: (userId: string) => Promise<Platform[]>;
}

// Cooldown constants (matching Clawdbot's billingBackoff pattern)
const BASE_COOLDOWN_MS = 5 * 60 * 1000;  // 5 minutes
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;  // 24 hours
const MAX_FAILED_ATTEMPTS = 5;

export function createCredentialsManager(db: Database): CredentialsManager {
  return {
    async setCredentials(userId, platform, credentials) {
      const encryptedData = encrypt(JSON.stringify(credentials));

      const existing = db.getTradingCredentials(userId, platform);

      if (existing) {
        db.updateTradingCredentials({
          ...existing,
          encryptedData,
          enabled: true,
          failedAttempts: 0,
          cooldownUntil: undefined,
          updatedAt: new Date(),
        });
      } else {
        db.createTradingCredentials({
          userId,
          platform,
          mode: platform === 'polymarket' ? 'wallet' : 'api_key',
          encryptedData,
          enabled: true,
          failedAttempts: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      logger.info(`Stored credentials for user ${userId} on ${platform}`);
    },

    async getCredentials<T>(userId: string, platform: Platform): Promise<T | null> {
      const creds = db.getTradingCredentials(userId, platform);
      if (!creds || !creds.enabled) return null;

      // Check cooldown
      if (creds.cooldownUntil && new Date() < creds.cooldownUntil) {
        logger.warn(`Credentials for ${userId}/${platform} in cooldown until ${creds.cooldownUntil}`);
        return null;
      }

      try {
        const decrypted = decrypt(creds.encryptedData);
        return JSON.parse(decrypted) as T;
      } catch (err) {
        logger.error(`Failed to decrypt credentials for ${userId}/${platform}: ${err}`);
        return null;
      }
    },

    async hasCredentials(userId, platform) {
      const creds = db.getTradingCredentials(userId, platform);
      return creds !== null && creds.enabled;
    },

    async deleteCredentials(userId, platform) {
      db.deleteTradingCredentials(userId, platform);
      logger.info(`Deleted credentials for user ${userId} on ${platform}`);
    },

    async markSuccess(userId, platform) {
      const creds = db.getTradingCredentials(userId, platform);
      if (creds) {
        db.updateTradingCredentials({
          ...creds,
          lastUsedAt: new Date(),
          failedAttempts: 0,
          cooldownUntil: undefined,
          updatedAt: new Date(),
        });
      }
    },

    async markFailure(userId, platform) {
      const creds = db.getTradingCredentials(userId, platform);
      if (creds) {
        const newFailedAttempts = Math.min(creds.failedAttempts + 1, MAX_FAILED_ATTEMPTS);

        // Exponential backoff: 5min, 10min, 20min, 40min, 80min, then 24h
        const cooldownMs = Math.min(
          BASE_COOLDOWN_MS * Math.pow(2, newFailedAttempts - 1),
          MAX_COOLDOWN_MS
        );

        const cooldownUntil = new Date(Date.now() + cooldownMs);

        db.updateTradingCredentials({
          ...creds,
          failedAttempts: newFailedAttempts,
          cooldownUntil,
          updatedAt: new Date(),
        });

        logger.warn(`Auth failure for ${userId}/${platform}, cooldown until ${cooldownUntil}`);
      }
    },

    async isInCooldown(userId, platform) {
      const creds = db.getTradingCredentials(userId, platform);
      if (!creds || !creds.cooldownUntil) return false;
      return new Date() < creds.cooldownUntil;
    },

    async buildTradingContext(userId, sessionKey): Promise<TradingContext> {
      const platforms: Platform[] = ['polymarket', 'kalshi', 'manifold'];
      const credentials = new Map<Platform, PlatformCredentials>();

      for (const platform of platforms) {
        if (await this.isInCooldown(userId, platform)) continue;

        if (platform === 'polymarket') {
          const data = await this.getCredentials<PolymarketCredentials>(userId, platform);
          if (data) credentials.set(platform, { platform, data });
        } else if (platform === 'kalshi') {
          const data = await this.getCredentials<KalshiCredentials>(userId, platform);
          if (data) credentials.set(platform, { platform, data });
        } else if (platform === 'manifold') {
          const data = await this.getCredentials<ManifoldCredentials>(userId, platform);
          if (data) credentials.set(platform, { platform, data });
        }
      }

      // Get user settings for limits
      const user = db.getUser(userId);
      const maxOrderSize = user?.settings?.maxOrderSize ?? 100; // Default $100

      return {
        userId,
        sessionKey,
        credentials,
        maxOrderSize,
        dryRun: process.env.DRY_RUN !== 'false',
      };
    },

    async listUserPlatforms(userId) {
      return db.listUserTradingPlatforms(userId);
    },
  };
}
