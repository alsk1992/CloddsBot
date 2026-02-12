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
  BinanceCredentials,
  BybitCredentials,
  HyperliquidCredentials,
  MexcCredentials,
  BetfairCredentials,
  PredictFunCredentials,
  DriftCredentials,
  SmarketsCredentials,
  OpinionCredentials,
  VirtualsCredentials,
  HedgehogCredentials,
} from '../types.js';
import { Database } from '../db/index.js';
import { logger } from '../utils/logger.js';

// Encryption key from environment (lazy — read at call time so startup can auto-generate)
function getEncryptionKey(): string | undefined {
  return process.env.CLODDS_CREDENTIAL_KEY;
}
function hasEncryptionKey(): boolean {
  const k = getEncryptionKey();
  return Boolean(k && k.trim().length > 0);
}

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const LEGACY_ALGORITHM = 'aes-256-cbc';
const LEGACY_SALT = 'salt';
const VERSION_PREFIX = 'v2';

/**
 * Encrypt credentials for storage
 */
function encrypt(data: string): string {
  const encKey = getEncryptionKey();
  if (!encKey) {
    throw new Error('CLODDS_CREDENTIAL_KEY is required to encrypt credentials');
  }

  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(encKey, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return [
    VERSION_PREFIX,
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted,
  ].join(':');
}

/**
 * Decrypt credentials from storage
 */
function decrypt(encryptedData: string): string {
  const encKey = getEncryptionKey();
  if (!encKey) {
    throw new Error('CLODDS_CREDENTIAL_KEY is required to decrypt credentials');
  }

  const parts = encryptedData.split(':');
  if (parts[0] === VERSION_PREFIX && parts.length >= 5) {
    const [, saltHex, ivHex, authTagHex, encrypted] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = crypto.scryptSync(encKey, salt, 32);
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Legacy v1 (aes-256-cbc)
  const [ivHex, encrypted] = parts;
  if (!ivHex || !encrypted) {
    throw new Error('Invalid encrypted credential payload');
  }
  const key = crypto.scryptSync(encKey, LEGACY_SALT, 32);
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, key, iv);
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
    credentials: PolymarketCredentials | KalshiCredentials | ManifoldCredentials | BinanceCredentials | BybitCredentials | HyperliquidCredentials | MexcCredentials | BetfairCredentials | PredictFunCredentials | DriftCredentials | SmarketsCredentials | OpinionCredentials | VirtualsCredentials | HedgehogCredentials
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
  if (!hasEncryptionKey()) {
    logger.warn('CLODDS_CREDENTIAL_KEY is not set. Credential encryption is disabled and operations will fail.');
  }
  return {
    async setCredentials(userId, platform, credentials) {
      const encryptedData = encrypt(JSON.stringify(credentials));

      const existing = db.getTradingCredentials(userId, platform);
      const isKalshiLegacy = platform === 'kalshi'
        && 'email' in credentials
        && Boolean(credentials.email && (credentials as KalshiCredentials).password)
        && !('apiKeyId' in credentials && (credentials as KalshiCredentials).apiKeyId);
      const mode = platform === 'polymarket'
        ? 'wallet'
        : isKalshiLegacy
          ? 'legacy_login'
          : 'api_key';

      if (existing) {
        db.updateTradingCredentials({
          ...existing,
          mode,
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
          mode,
          encryptedData,
          enabled: true,
          failedAttempts: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      logger.info({ userId, platform }, 'Stored credentials');
    },

    async getCredentials<T>(userId: string, platform: Platform): Promise<T | null> {
      const creds = db.getTradingCredentials(userId, platform);
      if (!creds || !creds.enabled) return null;

      // Check cooldown
      if (creds.cooldownUntil && new Date() < creds.cooldownUntil) {
        logger.warn({ userId, platform }, 'Credentials in cooldown');
        return null;
      }

      try {
        const decrypted = decrypt(creds.encryptedData);
        const parsed = JSON.parse(decrypted) as T;

        if (platform === 'kalshi') {
          const kalshi = parsed as unknown as KalshiCredentials;
          const hasApiKey = Boolean(kalshi.apiKeyId && kalshi.privateKeyPem);
          const hasLegacy = Boolean(kalshi.email && kalshi.password) && !kalshi.apiKeyId;
          const desiredMode = hasLegacy ? 'legacy_login' : hasApiKey ? 'api_key' : creds.mode;

          if (desiredMode !== creds.mode) {
            db.updateTradingCredentials({
              ...creds,
              mode: desiredMode,
              updatedAt: new Date(),
            });

            if (hasLegacy) {
              logger.warn(`Kalshi credentials for ${userId} use legacy login; migrate to API key auth.`);
            }
          }
        }

        return parsed as T;
      } catch (err) {
        logger.error({ userId, platform }, 'Failed to decrypt credentials');
        return null;
      }
    },

    async hasCredentials(userId, platform) {
      const creds = db.getTradingCredentials(userId, platform);
      return creds !== null && creds.enabled;
    },

    async deleteCredentials(userId, platform) {
      db.deleteTradingCredentials(userId, platform);
      logger.info({ userId, platform }, 'Deleted credentials');
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

        logger.warn({ userId, platform }, 'Auth failure, cooldown applied');
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
      const raw = user?.settings?.maxOrderSize;
      const maxOrderSize = (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) ? raw : 100;

      return {
        userId,
        sessionKey,
        credentials,
        maxOrderSize,
        dryRun: process.env.DRY_RUN === 'true',
      };
    },

    async listUserPlatforms(userId) {
      return db.listUserTradingPlatforms(userId);
    },
  };
}
