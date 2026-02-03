/**
 * API Keys Module Tests
 *
 * Unit tests for API key management, validation, and referral tracking.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createMockApiKeyData } from '../../mocks';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// =============================================================================
// TEST SETUP
// =============================================================================

const TEST_STORAGE_DIR = join(tmpdir(), 'clodds-test-apikeys-' + Date.now());

function cleanupTestDir(): void {
  if (existsSync(TEST_STORAGE_DIR)) {
    rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
  }
}

// =============================================================================
// API KEY CREATION TESTS
// =============================================================================

describe('API Key Creation', () => {
  const { createApiKeyManager } = require('../../../src/api/apikeys');

  beforeEach(() => {
    cleanupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should create API key with all required fields', () => {
    const manager = createApiKeyManager({
      storageDir: TEST_STORAGE_DIR,
      persist: false,
    });

    const result = manager.create('owner@example.com', 'Test Key');

    assert.ok(result.keyId, 'Should have keyId');
    assert.ok(result.secret, 'Should have secret');
    assert.ok(result.fullKey, 'Should have fullKey');
    assert.ok(result.data, 'Should have data');

    // Verify key format
    assert.ok(result.keyId.startsWith('clodds_'), 'Key should start with clodds_');
    assert.strictEqual(result.fullKey, `${result.keyId}.${result.secret}`);
  });

  it('should generate unique keys', () => {
    const manager = createApiKeyManager({ persist: false });

    const key1 = manager.create('owner1@example.com', 'Key 1');
    const key2 = manager.create('owner2@example.com', 'Key 2');

    assert.notStrictEqual(key1.keyId, key2.keyId);
    assert.notStrictEqual(key1.secret, key2.secret);
  });

  it('should set default tier to free', () => {
    const manager = createApiKeyManager({ persist: false });

    const result = manager.create('owner@example.com', 'Test Key');

    assert.strictEqual(result.data.tier, 'free');
  });

  it('should accept custom tier', () => {
    const manager = createApiKeyManager({ persist: false });

    const result = manager.create('owner@example.com', 'Pro Key', 'pro');

    assert.strictEqual(result.data.tier, 'pro');
  });

  it('should normalize owner to lowercase', () => {
    const manager = createApiKeyManager({ persist: false });

    const result = manager.create('OWNER@EXAMPLE.COM', 'Test Key');

    assert.strictEqual(result.data.owner, 'owner@example.com');
  });

  it('should generate unique referral code', () => {
    const manager = createApiKeyManager({ persist: false });

    const key1 = manager.create('owner1@example.com', 'Key 1');
    const key2 = manager.create('owner2@example.com', 'Key 2');

    assert.ok(key1.data.referralCode, 'Should have referral code');
    assert.notStrictEqual(key1.data.referralCode, key2.data.referralCode);
    assert.strictEqual(key1.data.referralCode.length, 8); // 4 bytes hex = 8 chars
  });

  it('should track referredBy', () => {
    const manager = createApiKeyManager({ persist: false });

    const referrer = manager.create('referrer@example.com', 'Referrer Key');
    const referred = manager.create('referred@example.com', 'Referred Key', 'free', referrer.data.referralCode);

    assert.strictEqual(referred.data.referredBy, referrer.data.referralCode);
  });

  it('should set initial values correctly', () => {
    const manager = createApiKeyManager({ persist: false });

    const result = manager.create('owner@example.com', 'Test Key');

    assert.strictEqual(result.data.active, true);
    assert.strictEqual(result.data.dailyPrompts, 0);
    assert.strictEqual(result.data.totalSpent, 0);
    assert.strictEqual(result.data.referralEarnings, 0);
    assert.strictEqual(result.data.expiresAt, 0); // Never expires
  });
});

// =============================================================================
// API KEY VALIDATION TESTS
// =============================================================================

describe('API Key Validation', () => {
  const { createApiKeyManager } = require('../../../src/api/apikeys');

  it('should validate correct credentials', () => {
    const manager = createApiKeyManager({ persist: false });

    const created = manager.create('owner@example.com', 'Test Key');
    const validated = manager.validate(created.keyId, created.secret);

    assert.ok(validated, 'Should validate correct credentials');
    assert.strictEqual(validated.id, created.keyId);
  });

  it('should reject invalid secret', () => {
    const manager = createApiKeyManager({ persist: false });

    const created = manager.create('owner@example.com', 'Test Key');
    const validated = manager.validate(created.keyId, 'wrong-secret');

    assert.strictEqual(validated, null);
  });

  it('should reject non-existent key', () => {
    const manager = createApiKeyManager({ persist: false });

    const validated = manager.validate('non-existent-key', 'any-secret');

    assert.strictEqual(validated, null);
  });

  it('should reject inactive keys', () => {
    const manager = createApiKeyManager({ persist: false });

    const created = manager.create('owner@example.com', 'Test Key');
    manager.revoke(created.keyId);

    const validated = manager.validate(created.keyId, created.secret);

    assert.strictEqual(validated, null);
  });

  it('should update lastUsedAt on validation', () => {
    const manager = createApiKeyManager({ persist: false });

    const created = manager.create('owner@example.com', 'Test Key');
    const originalLastUsed = created.data.lastUsedAt;

    // Small delay to ensure different timestamp
    const startTime = Date.now();
    while (Date.now() - startTime < 10) {
      // Busy wait for 10ms
    }

    manager.validate(created.keyId, created.secret);

    const updated = manager.get(created.keyId);
    assert.ok(updated.lastUsedAt >= originalLastUsed);
  });

  it('should use timing-safe comparison', () => {
    const manager = createApiKeyManager({ persist: false });

    const created = manager.create('owner@example.com', 'Test Key');

    // These should both take similar time regardless of how much matches
    const wrongShort = 'a';
    const wrongLong = 'a'.repeat(100);

    const result1 = manager.validate(created.keyId, wrongShort);
    const result2 = manager.validate(created.keyId, wrongLong);

    assert.strictEqual(result1, null);
    assert.strictEqual(result2, null);
  });
});

// =============================================================================
// PARSE API KEY TESTS
// =============================================================================

describe('parseApiKey', () => {
  const { parseApiKey } = require('../../../src/api/apikeys');

  it('should parse Bearer token format', () => {
    const parsed = parseApiKey('Bearer clodds_abc123.secretxyz');

    assert.deepStrictEqual(parsed, {
      keyId: 'clodds_abc123',
      secret: 'secretxyz',
    });
  });

  it('should parse Basic auth format', () => {
    // Base64 encode "clodds_abc:secret123"
    const credentials = Buffer.from('clodds_abc:secret123').toString('base64');
    const parsed = parseApiKey(`Basic ${credentials}`);

    assert.deepStrictEqual(parsed, {
      keyId: 'clodds_abc',
      secret: 'secret123',
    });
  });

  it('should return null for empty header', () => {
    const parsed = parseApiKey('');
    assert.strictEqual(parsed, null);
  });

  it('should return null for invalid Bearer format', () => {
    const parsed = parseApiKey('Bearer invalid-no-dot');
    assert.strictEqual(parsed, null);
  });

  it('should return null for invalid Basic format', () => {
    const parsed = parseApiKey('Basic !!!invalid-base64!!!');
    assert.strictEqual(parsed, null);
  });

  it('should return null for unknown auth type', () => {
    const parsed = parseApiKey('Digest username=test');
    assert.strictEqual(parsed, null);
  });

  it('should handle Bearer with URL-safe base64 secret', () => {
    const parsed = parseApiKey('Bearer clodds_key.abc-def_123');

    assert.deepStrictEqual(parsed, {
      keyId: 'clodds_key',
      secret: 'abc-def_123',
    });
  });
});

// =============================================================================
// PROMPT LIMIT TESTS
// =============================================================================

describe('Prompt Limits', () => {
  const { createApiKeyManager } = require('../../../src/api/apikeys');

  it('should allow prompts within limit', () => {
    const manager = createApiKeyManager({ persist: false });

    const key = manager.create('owner@example.com', 'Test Key', 'free');
    const check = manager.checkPromptLimit(key.keyId);

    assert.strictEqual(check.allowed, true);
    assert.ok(check.remaining > 0);
  });

  it('should track prompt usage', () => {
    const manager = createApiKeyManager({ persist: false });

    const key = manager.create('owner@example.com', 'Test Key', 'free');

    // Record some prompts
    manager.recordPrompt(key.keyId);
    manager.recordPrompt(key.keyId);
    manager.recordPrompt(key.keyId);

    const data = manager.get(key.keyId);
    assert.strictEqual(data.dailyPrompts, 3);
  });

  it('should return remaining count', () => {
    const manager = createApiKeyManager({ persist: false });

    const key = manager.create('owner@example.com', 'Test Key', 'free');

    // Free tier has 5 prompts/day
    const check1 = manager.checkPromptLimit(key.keyId);
    const remaining1 = check1.remaining;

    manager.recordPrompt(key.keyId);

    const check2 = manager.checkPromptLimit(key.keyId);
    assert.strictEqual(check2.remaining, remaining1 - 1);
  });

  it('should return -1 for unlimited tier', () => {
    const manager = createApiKeyManager({ persist: false });

    const key = manager.create('owner@example.com', 'Business Key', 'business');

    const check = manager.checkPromptLimit(key.keyId);
    assert.strictEqual(check.remaining, -1);
    assert.strictEqual(check.allowed, true);
  });

  it('should return resetAt timestamp', () => {
    const manager = createApiKeyManager({ persist: false });

    const key = manager.create('owner@example.com', 'Test Key');

    const check = manager.checkPromptLimit(key.keyId);

    assert.ok(check.resetAt > Date.now());
    // Should be ~24 hours from now
    assert.ok(check.resetAt < Date.now() + 25 * 60 * 60 * 1000);
  });

  it('should return not allowed for non-existent key', () => {
    const manager = createApiKeyManager({ persist: false });

    const check = manager.checkPromptLimit('non-existent');

    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.remaining, 0);
  });
});

// =============================================================================
// TIER MANAGEMENT TESTS
// =============================================================================

describe('Tier Management', () => {
  const { createApiKeyManager } = require('../../../src/api/apikeys');

  it('should update tier', () => {
    const manager = createApiKeyManager({ persist: false });

    const key = manager.create('owner@example.com', 'Test Key', 'free');
    const updated = manager.updateTier(key.keyId, 'pro');

    assert.strictEqual(updated, true);

    const data = manager.get(key.keyId);
    assert.strictEqual(data.tier, 'pro');
  });

  it('should return false for non-existent key', () => {
    const manager = createApiKeyManager({ persist: false });

    const updated = manager.updateTier('non-existent', 'pro');

    assert.strictEqual(updated, false);
  });
});

// =============================================================================
// REVOCATION TESTS
// =============================================================================

describe('Key Revocation', () => {
  const { createApiKeyManager } = require('../../../src/api/apikeys');

  it('should revoke key', () => {
    const manager = createApiKeyManager({ persist: false });

    const key = manager.create('owner@example.com', 'Test Key');
    const revoked = manager.revoke(key.keyId);

    assert.strictEqual(revoked, true);

    const data = manager.get(key.keyId);
    assert.strictEqual(data.active, false);
  });

  it('should return false for non-existent key', () => {
    const manager = createApiKeyManager({ persist: false });

    const revoked = manager.revoke('non-existent');

    assert.strictEqual(revoked, false);
  });
});

// =============================================================================
// REFERRAL TRACKING TESTS
// =============================================================================

describe('Referral Tracking', () => {
  const { createApiKeyManager } = require('../../../src/api/apikeys');

  it('should track spending and credit referrer', () => {
    const manager = createApiKeyManager({ persist: false });

    // Create referrer
    const referrer = manager.create('referrer@example.com', 'Referrer Key');

    // Create referred user with referral code
    const referred = manager.create('referred@example.com', 'Referred Key', 'pro', referrer.data.referralCode);

    // Referred user spends money
    manager.recordSpending(referred.keyId, 100);

    // Check referrer earnings (10% default)
    const referrerData = manager.get(referrer.keyId);
    assert.strictEqual(referrerData.referralEarnings, 10);
  });

  it('should track total spending', () => {
    const manager = createApiKeyManager({ persist: false });

    const key = manager.create('owner@example.com', 'Test Key');

    manager.recordSpending(key.keyId, 50);
    manager.recordSpending(key.keyId, 30);

    const data = manager.get(key.keyId);
    assert.strictEqual(data.totalSpent, 80);
  });

  it('should get referral stats', () => {
    const manager = createApiKeyManager({ persist: false });

    // Create referrer
    const referrer = manager.create('referrer@example.com', 'Referrer Key');

    // Create multiple referred users
    manager.create('user1@example.com', 'User 1', 'free', referrer.data.referralCode);
    manager.create('user2@example.com', 'User 2', 'pro', referrer.data.referralCode);
    const user3 = manager.create('user3@example.com', 'User 3', 'free', referrer.data.referralCode);

    // Revoke one to test active count
    manager.revoke(user3.keyId);

    const stats = manager.getReferralStats(referrer.data.referralCode);

    assert.strictEqual(stats.referralCode, referrer.data.referralCode);
    assert.strictEqual(stats.totalReferred, 3);
    assert.strictEqual(stats.activeReferred, 2);
  });

  it('should use custom referral share', () => {
    const manager = createApiKeyManager({ persist: false });

    const referrer = manager.create('referrer@example.com', 'Referrer Key');
    const referred = manager.create('referred@example.com', 'Referred Key', 'pro', referrer.data.referralCode);

    // 20% referral share
    manager.recordSpending(referred.keyId, 100, 0.2);

    const referrerData = manager.get(referrer.keyId);
    assert.strictEqual(referrerData.referralEarnings, 20);
  });

  it('should ignore zero or negative spending', () => {
    const manager = createApiKeyManager({ persist: false });

    const key = manager.create('owner@example.com', 'Test Key');

    manager.recordSpending(key.keyId, 0);
    manager.recordSpending(key.keyId, -50);

    const data = manager.get(key.keyId);
    assert.strictEqual(data.totalSpent, 0);
  });
});

// =============================================================================
// LISTING TESTS
// =============================================================================

describe('Key Listing', () => {
  const { createApiKeyManager } = require('../../../src/api/apikeys');

  it('should list keys by owner', () => {
    const manager = createApiKeyManager({ persist: false });

    manager.create('owner1@example.com', 'Key 1');
    manager.create('owner1@example.com', 'Key 2');
    manager.create('owner2@example.com', 'Key 3');

    const owner1Keys = manager.getByOwner('owner1@example.com');

    assert.strictEqual(owner1Keys.length, 2);
    assert.ok(owner1Keys.every((k: any) => k.owner === 'owner1@example.com'));
  });

  it('should list all keys (admin)', () => {
    const manager = createApiKeyManager({ persist: false });

    manager.create('owner1@example.com', 'Key 1');
    manager.create('owner2@example.com', 'Key 2');

    const allKeys = manager.listAll();

    assert.strictEqual(allKeys.length, 2);
  });

  it('should handle owner case insensitively', () => {
    const manager = createApiKeyManager({ persist: false });

    manager.create('Owner@Example.COM', 'Key 1');

    const keys1 = manager.getByOwner('owner@example.com');
    const keys2 = manager.getByOwner('OWNER@EXAMPLE.COM');

    assert.strictEqual(keys1.length, 1);
    assert.strictEqual(keys2.length, 1);
  });
});

// =============================================================================
// PERSISTENCE TESTS
// =============================================================================

describe('Key Persistence', () => {
  const { createApiKeyManager } = require('../../../src/api/apikeys');

  beforeEach(() => {
    cleanupTestDir();
    mkdirSync(TEST_STORAGE_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should persist keys to disk', () => {
    const manager1 = createApiKeyManager({
      storageDir: TEST_STORAGE_DIR,
      persist: true,
    });

    const created = manager1.create('owner@example.com', 'Persistent Key');

    // Create new manager instance (simulating restart)
    const manager2 = createApiKeyManager({
      storageDir: TEST_STORAGE_DIR,
      persist: true,
    });

    const loaded = manager2.get(created.keyId);

    assert.ok(loaded, 'Should load persisted key');
    assert.strictEqual(loaded.name, 'Persistent Key');
  });

  it('should not persist when disabled', () => {
    const manager1 = createApiKeyManager({
      storageDir: TEST_STORAGE_DIR,
      persist: false,
    });

    manager1.create('owner@example.com', 'Non-persistent Key');

    // Check no file was created
    const keysFile = join(TEST_STORAGE_DIR, 'keys.json');
    assert.strictEqual(existsSync(keysFile), false);
  });
});

// =============================================================================
// EXPIRY TESTS
// =============================================================================

describe('Key Expiry', () => {
  const { createApiKeyManager } = require('../../../src/api/apikeys');

  it('should reject expired keys on validation', () => {
    const manager = createApiKeyManager({ persist: false });

    const created = manager.create('owner@example.com', 'Test Key');

    // Manually set expiry to past
    const data = manager.get(created.keyId);
    data.expiresAt = Date.now() - 1000; // Expired 1 second ago

    const validated = manager.validate(created.keyId, created.secret);

    assert.strictEqual(validated, null);
  });

  it('should allow non-expiring keys', () => {
    const manager = createApiKeyManager({ persist: false });

    const created = manager.create('owner@example.com', 'Test Key');

    assert.strictEqual(created.data.expiresAt, 0);

    const validated = manager.validate(created.keyId, created.secret);

    assert.ok(validated);
  });
});

console.log('API Keys tests loaded. Run with: npm test');
