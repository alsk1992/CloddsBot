/**
 * API Key Manager - Authentication and rate limiting
 *
 * Features:
 * - API key generation and validation
 * - Subscription tier management
 * - Daily prompt limits
 * - Referral tracking
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import type {
  ApiKeyData,
  SubscriptionTier,
  SUBSCRIPTION_TIERS,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface ApiKeyManager {
  /** Create new API key */
  create(owner: string, name: string, tier?: SubscriptionTier, referredBy?: string): ApiKeyResult;
  /** Validate API key and return data */
  validate(keyId: string, secret: string): ApiKeyData | null;
  /** Get key by ID */
  get(keyId: string): ApiKeyData | null;
  /** Get keys by owner */
  getByOwner(owner: string): ApiKeyData[];
  /** Update subscription tier */
  updateTier(keyId: string, tier: SubscriptionTier): boolean;
  /** Revoke key */
  revoke(keyId: string): boolean;
  /** Check and increment daily prompt count */
  checkPromptLimit(keyId: string): { allowed: boolean; remaining: number; resetAt: number };
  /** Record prompt usage */
  recordPrompt(keyId: string): void;
  /** Get referral stats */
  getReferralStats(referralCode: string): ReferralStats;
  /** Get all keys (admin) */
  listAll(): ApiKeyData[];
}

export interface ApiKeyResult {
  /** Key ID (public, include in requests) */
  keyId: string;
  /** Secret (show once, user must save) */
  secret: string;
  /** Full key for convenience (keyId.secret) */
  fullKey: string;
  /** Key data */
  data: ApiKeyData;
}

export interface ReferralStats {
  referralCode: string;
  totalReferred: number;
  activeReferred: number;
  totalEarnings: number;
}

export interface ApiKeyManagerConfig {
  /** Storage directory */
  storageDir?: string;
  /** Enable persistence */
  persist?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG = {
  storageDir: join(homedir(), '.clodds', 'api', 'keys'),
  persist: true,
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createApiKeyManager(config: ApiKeyManagerConfig = {}): ApiKeyManager {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Storage
  const keys = new Map<string, ApiKeyData>();

  // Ensure storage directory
  if (cfg.persist) {
    mkdirSync(cfg.storageDir, { recursive: true });
    loadKeys();
  }

  function loadKeys(): void {
    try {
      const indexPath = join(cfg.storageDir, 'keys.json');
      if (existsSync(indexPath)) {
        const data = JSON.parse(readFileSync(indexPath, 'utf-8')) as ApiKeyData[];
        for (const key of data) {
          keys.set(key.id, key);
        }
        logger.info({ count: keys.size }, 'Loaded API keys');
      }
    } catch (e) {
      logger.warn('Failed to load API keys');
    }
  }

  function saveKeys(): void {
    if (!cfg.persist) return;
    try {
      const indexPath = join(cfg.storageDir, 'keys.json');
      writeFileSync(indexPath, JSON.stringify(Array.from(keys.values()), null, 2));
    } catch (e) {
      logger.error({ error: e }, 'Failed to save API keys');
    }
  }

  function generateKeyId(): string {
    return `clodds_${randomBytes(8).toString('hex')}`;
  }

  function generateSecret(): string {
    return randomBytes(24).toString('base64url');
  }

  function generateReferralCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  function hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  function create(owner: string, name: string, tier: SubscriptionTier = 'free', referredBy?: string): ApiKeyResult {
    const keyId = generateKeyId();
    const secret = generateSecret();
    const now = Date.now();

    const data: ApiKeyData = {
      id: keyId,
      secretHash: hashSecret(secret),
      owner: owner.toLowerCase(),
      name,
      tier,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: 0,
      active: true,
      dailyPrompts: 0,
      dailyResetAt: now + 86400000,
      referredBy,
      referralCode: generateReferralCode(),
    };

    keys.set(keyId, data);
    saveKeys();

    logger.info({ keyId, owner, tier }, 'API key created');

    return {
      keyId,
      secret,
      fullKey: `${keyId}.${secret}`,
      data,
    };
  }

  function validate(keyId: string, secret: string): ApiKeyData | null {
    const data = keys.get(keyId);
    if (!data) return null;

    // Check if active
    if (!data.active) return null;

    // Check expiry
    if (data.expiresAt > 0 && Date.now() > data.expiresAt) {
      data.active = false;
      saveKeys();
      return null;
    }

    // Verify secret (timing-safe comparison)
    const providedHash = hashSecret(secret);
    const storedHash = data.secretHash;

    try {
      const match = timingSafeEqual(
        Buffer.from(providedHash, 'hex'),
        Buffer.from(storedHash, 'hex')
      );
      if (!match) return null;
    } catch {
      return null;
    }

    // Update last used
    data.lastUsedAt = Date.now();
    saveKeys();

    return data;
  }

  function get(keyId: string): ApiKeyData | null {
    return keys.get(keyId) || null;
  }

  function getByOwner(owner: string): ApiKeyData[] {
    const ownerLower = owner.toLowerCase();
    return Array.from(keys.values()).filter(k => k.owner === ownerLower);
  }

  function updateTier(keyId: string, tier: SubscriptionTier): boolean {
    const data = keys.get(keyId);
    if (!data) return false;

    data.tier = tier;
    saveKeys();

    logger.info({ keyId, tier }, 'API key tier updated');
    return true;
  }

  function revoke(keyId: string): boolean {
    const data = keys.get(keyId);
    if (!data) return false;

    data.active = false;
    saveKeys();

    logger.info({ keyId }, 'API key revoked');
    return true;
  }

  function checkPromptLimit(keyId: string): { allowed: boolean; remaining: number; resetAt: number } {
    const data = keys.get(keyId);
    if (!data) {
      return { allowed: false, remaining: 0, resetAt: 0 };
    }

    // Import subscription tiers
    const tierConfig = require('./types').SUBSCRIPTION_TIERS[data.tier];
    const limit = tierConfig?.promptsPerDay || 5;

    // Reset daily count if needed
    const now = Date.now();
    if (now > data.dailyResetAt) {
      data.dailyPrompts = 0;
      data.dailyResetAt = now + 86400000;
      saveKeys();
    }

    // Unlimited (-1) or under limit
    if (limit === -1 || data.dailyPrompts < limit) {
      const remaining = limit === -1 ? -1 : limit - data.dailyPrompts;
      return { allowed: true, remaining, resetAt: data.dailyResetAt };
    }

    return { allowed: false, remaining: 0, resetAt: data.dailyResetAt };
  }

  function recordPrompt(keyId: string): void {
    const data = keys.get(keyId);
    if (!data) return;

    data.dailyPrompts++;
    data.lastUsedAt = Date.now();
    saveKeys();
  }

  function getReferralStats(referralCode: string): ReferralStats {
    let totalReferred = 0;
    let activeReferred = 0;

    for (const key of keys.values()) {
      if (key.referredBy === referralCode) {
        totalReferred++;
        if (key.active) activeReferred++;
      }
    }

    return {
      referralCode,
      totalReferred,
      activeReferred,
      totalEarnings: 0, // TODO: Track actual earnings
    };
  }

  function listAll(): ApiKeyData[] {
    return Array.from(keys.values());
  }

  return {
    create,
    validate,
    get,
    getByOwner,
    updateTier,
    revoke,
    checkPromptLimit,
    recordPrompt,
    getReferralStats,
    listAll,
  };
}

/**
 * Parse API key from Authorization header
 * Supports: "Bearer keyId.secret" or "Basic base64(keyId:secret)"
 */
export function parseApiKey(authHeader: string): { keyId: string; secret: string } | null {
  if (!authHeader) return null;

  // Bearer token: "Bearer keyId.secret"
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const [keyId, secret] = token.split('.');
    if (keyId && secret) {
      return { keyId, secret };
    }
  }

  // Basic auth: "Basic base64(keyId:secret)"
  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const [keyId, secret] = decoded.split(':');
      if (keyId && secret) {
        return { keyId, secret };
      }
    } catch {
      return null;
    }
  }

  return null;
}
