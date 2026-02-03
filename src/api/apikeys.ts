/**
 * API Key Manager - Authentication and rate limiting
 *
 * Features:
 * - API key generation and validation
 * - Subscription tier management
 * - Daily prompt limits
 * - Referral tracking
 * - Validation caching for performance
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createApiKeyCache, type ApiKeyCacheKey } from '../cache/index';
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
  /** Record spending and credit referrer */
  recordSpending(keyId: string, amountUsd: number, referralShare?: number): void;
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
  /** Validation cache TTL in ms (default: 10000 = 10s) */
  validationCacheTtl?: number;
  /** Max cached validations (default: 200) */
  validationCacheSize?: number;
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

  // Validation cache - brief caching to reduce repeated hash comparisons
  const validationCache = createApiKeyCache<ApiKeyData | null>({
    maxSize: config.validationCacheSize ?? 200,
    defaultTtl: config.validationCacheTtl ?? 10000, // 10 seconds
  });

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
      totalSpent: 0,
      referralEarnings: 0,
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
    const providedHash = hashSecret(secret);
    const cacheKey: ApiKeyCacheKey = { keyId, secretHash: providedHash };

    // Check validation cache first
    const cached = validationCache.get(cacheKey);
    if (cached !== undefined) {
      // Return cached result (could be null for invalid keys)
      if (cached) {
        // Update last used timestamp (but don't save frequently)
        cached.lastUsedAt = Date.now();
      }
      return cached;
    }

    const data = keys.get(keyId);
    if (!data) {
      // Cache negative result briefly
      validationCache.set(cacheKey, null);
      return null;
    }

    // Check if active
    if (!data.active) {
      validationCache.set(cacheKey, null);
      return null;
    }

    // Check expiry
    if (data.expiresAt > 0 && Date.now() > data.expiresAt) {
      data.active = false;
      saveKeys();
      validationCache.set(cacheKey, null);
      return null;
    }

    // Verify secret (timing-safe comparison)
    const storedHash = data.secretHash;

    try {
      const match = timingSafeEqual(
        Buffer.from(providedHash, 'hex'),
        Buffer.from(storedHash, 'hex')
      );
      if (!match) {
        validationCache.set(cacheKey, null);
        return null;
      }
    } catch {
      validationCache.set(cacheKey, null);
      return null;
    }

    // Update last used
    data.lastUsedAt = Date.now();
    saveKeys();

    // Cache successful validation
    validationCache.set(cacheKey, data);

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

    // Invalidate any cached validation for this key
    validationCache.clear(); // Simple approach: clear all (keys update rarely)

    logger.info({ keyId, tier }, 'API key tier updated');
    return true;
  }

  function revoke(keyId: string): boolean {
    const data = keys.get(keyId);
    if (!data) return false;

    data.active = false;
    saveKeys();

    // Invalidate any cached validation for this key
    validationCache.clear();

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

  /**
   * Record spending and credit referrer
   * @param keyId - API key that spent money
   * @param amountUsd - Amount spent in USD
   * @param referralShare - Referrer's share (default 10%)
   */
  function recordSpending(keyId: string, amountUsd: number, referralShare = 0.1): void {
    const data = keys.get(keyId);
    if (!data || amountUsd <= 0) return;

    // Track user's total spending
    data.totalSpent = (data.totalSpent || 0) + amountUsd;
    data.lastUsedAt = Date.now();

    // Credit referrer if exists
    if (data.referredBy) {
      for (const key of keys.values()) {
        if (key.referralCode === data.referredBy) {
          const earnings = amountUsd * referralShare;
          key.referralEarnings = (key.referralEarnings || 0) + earnings;
          logger.debug({ referrer: key.id, earnings, from: keyId }, 'Referral earnings credited');
          break;
        }
      }
    }

    saveKeys();
  }

  function getReferralStats(referralCode: string): ReferralStats {
    let totalReferred = 0;
    let activeReferred = 0;
    let totalEarnings = 0;

    // Find the key that owns this referral code
    for (const key of keys.values()) {
      if (key.referralCode === referralCode) {
        totalEarnings = key.referralEarnings || 0;
      }
      if (key.referredBy === referralCode) {
        totalReferred++;
        if (key.active) activeReferred++;
      }
    }

    return {
      referralCode,
      totalReferred,
      activeReferred,
      totalEarnings,
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
    recordSpending,
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
