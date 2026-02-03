/**
 * Ledger Hash Module Tests
 *
 * Unit tests for SHA-256 hashing and integrity verification.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMockDecisionRecord, assertValidHash } from '../../mocks';

// =============================================================================
// HASH FUNCTION TESTS
// =============================================================================

describe('hashDecision', () => {
  const { hashDecision, verifyHash, createCommitment, shortHash } = require('../../../src/ledger/hash');

  it('should generate a valid SHA-256 hash', () => {
    const record = createMockDecisionRecord();
    const hash = hashDecision(record);

    assert.strictEqual(typeof hash, 'string');
    assert.strictEqual(hash.length, 64);
    assertValidHash(hash);
  });

  it('should generate deterministic hashes for same input', () => {
    const record = createMockDecisionRecord({
      timestamp: 1704067200000, // Fixed timestamp
      userId: 'user-abc',
      category: 'trade',
      action: 'buy_shares',
      decision: 'executed',
      reason: 'Test reason',
    });

    const hash1 = hashDecision(record);
    const hash2 = hashDecision(record);

    assert.strictEqual(hash1, hash2, 'Same input should produce same hash');
  });

  it('should generate different hashes for different inputs', () => {
    const record1 = createMockDecisionRecord({
      timestamp: 1704067200000,
      decision: 'executed',
    });
    const record2 = createMockDecisionRecord({
      timestamp: 1704067200000,
      decision: 'rejected',
    });

    const hash1 = hashDecision(record1);
    const hash2 = hashDecision(record2);

    assert.notStrictEqual(hash1, hash2, 'Different inputs should produce different hashes');
  });

  it('should handle partial records', () => {
    const partialRecord = {
      userId: 'user-123',
      timestamp: Date.now(),
      category: 'trade',
      action: 'buy',
      decision: 'executed',
      reason: 'Test',
    };

    const hash = hashDecision(partialRecord);
    assert.strictEqual(hash.length, 64);
  });

  it('should only include designated fields in hash', () => {
    // Fields NOT in HASH_FIELDS should not affect hash
    const baseRecord = createMockDecisionRecord({
      timestamp: 1704067200000,
      userId: 'user-hash-test',
    });

    // Add extra fields that shouldn't be hashed
    const recordWithExtras = {
      ...baseRecord,
      randomField: 'should-not-affect-hash',
      anotherField: 12345,
    };

    const hash1 = hashDecision(baseRecord);
    const hash2 = hashDecision(recordWithExtras);

    // Since randomField and anotherField are not in HASH_FIELDS,
    // hashes should be the same
    assert.strictEqual(hash1, hash2);
  });

  it('should handle undefined fields gracefully', () => {
    const record = {
      userId: 'user-123',
      timestamp: Date.now(),
      category: 'trade',
      action: 'buy',
      decision: 'executed',
      reason: 'Test',
      // Optional fields intentionally undefined
      sessionId: undefined,
      platform: undefined,
      marketId: undefined,
    };

    const hash = hashDecision(record);
    assert.strictEqual(hash.length, 64);
  });

  it('should produce consistent hash ordering', () => {
    // JSON key order shouldn't matter due to sorted serialization
    const record1 = {
      userId: 'user-1',
      action: 'buy',
      category: 'trade',
      timestamp: 1000,
    };

    const record2 = {
      timestamp: 1000,
      category: 'trade',
      userId: 'user-1',
      action: 'buy',
    };

    const hash1 = hashDecision(record1);
    const hash2 = hashDecision(record2);

    assert.strictEqual(hash1, hash2, 'Hash should be independent of key order');
  });
});

// =============================================================================
// HASH VERIFICATION TESTS
// =============================================================================

describe('verifyHash', () => {
  const { hashDecision, verifyHash } = require('../../../src/ledger/hash');

  it('should verify correct hash', () => {
    const record = createMockDecisionRecord();
    const hash = hashDecision(record);

    const isValid = verifyHash(record, hash);
    assert.strictEqual(isValid, true);
  });

  it('should reject incorrect hash', () => {
    const record = createMockDecisionRecord();
    const wrongHash = 'a'.repeat(64);

    const isValid = verifyHash(record, wrongHash);
    assert.strictEqual(isValid, false);
  });

  it('should detect tampering', () => {
    const record = createMockDecisionRecord();
    const originalHash = hashDecision(record);

    // Tamper with the record
    record.decision = 'rejected' as any;

    const isValid = verifyHash(record, originalHash);
    assert.strictEqual(isValid, false, 'Tampered record should fail verification');
  });

  it('should handle hash with different casing', () => {
    const record = createMockDecisionRecord();
    const hash = hashDecision(record);
    const upperHash = hash.toUpperCase();

    // Our implementation uses lowercase, so uppercase should fail
    const isValid = verifyHash(record, upperHash);
    assert.strictEqual(isValid, false);
  });
});

// =============================================================================
// COMMITMENT TESTS
// =============================================================================

describe('createCommitment', () => {
  const { createCommitment, hashDecision } = require('../../../src/ledger/hash');

  it('should create valid commitment object', () => {
    const record = createMockDecisionRecord();
    const commitment = createCommitment(record);

    assert.ok(commitment.hash, 'Commitment should have hash');
    assert.ok(commitment.timestamp, 'Commitment should have timestamp');
    assert.ok(commitment.dataHash, 'Commitment should have dataHash');

    assert.strictEqual(commitment.hash.length, 64);
    assert.strictEqual(commitment.dataHash.length, 64);
    assert.strictEqual(typeof commitment.timestamp, 'number');
  });

  it('should generate unique commitments over time', async () => {
    const record = createMockDecisionRecord();

    const commitment1 = createCommitment(record);
    await new Promise(r => setTimeout(r, 10)); // Small delay
    const commitment2 = createCommitment(record);

    // dataHash should be same (same record data)
    assert.strictEqual(commitment1.dataHash, commitment2.dataHash);

    // But commitment hash includes timestamp, so they differ
    assert.notStrictEqual(commitment1.hash, commitment2.hash);
    assert.notStrictEqual(commitment1.timestamp, commitment2.timestamp);
  });

  it('should link dataHash to record hash', () => {
    const record = createMockDecisionRecord();
    const recordHash = hashDecision(record);
    const commitment = createCommitment(record);

    assert.strictEqual(commitment.dataHash, recordHash);
  });
});

// =============================================================================
// SHORT HASH TESTS
// =============================================================================

describe('shortHash', () => {
  const { shortHash, hashDecision } = require('../../../src/ledger/hash');

  it('should return first 8 characters', () => {
    const fullHash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const short = shortHash(fullHash);

    assert.strictEqual(short, 'abcdef12');
    assert.strictEqual(short.length, 8);
  });

  it('should work with generated hashes', () => {
    const record = createMockDecisionRecord();
    const hash = hashDecision(record);
    const short = shortHash(hash);

    assert.strictEqual(short, hash.slice(0, 8));
    assert.strictEqual(short.length, 8);
  });

  it('should handle short input strings', () => {
    const shortInput = 'abc';
    const result = shortHash(shortInput);

    assert.strictEqual(result, 'abc');
  });

  it('should handle empty string', () => {
    const result = shortHash('');
    assert.strictEqual(result, '');
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Hash Edge Cases', () => {
  const { hashDecision } = require('../../../src/ledger/hash');

  it('should handle empty object', () => {
    const hash = hashDecision({});
    assert.strictEqual(hash.length, 64);
  });

  it('should handle nested objects in inputs', () => {
    const record = createMockDecisionRecord({
      inputs: {
        nested: {
          deep: {
            value: 123,
          },
        },
        array: [1, 2, 3],
      },
    });

    const hash = hashDecision(record);
    assert.strictEqual(hash.length, 64);
  });

  it('should handle special characters', () => {
    const record = createMockDecisionRecord({
      reason: 'Test with special chars: <>&"\' and unicode',
    });

    const hash = hashDecision(record);
    assert.strictEqual(hash.length, 64);
  });

  it('should handle very long strings', () => {
    const record = createMockDecisionRecord({
      reason: 'x'.repeat(10000),
    });

    const hash = hashDecision(record);
    assert.strictEqual(hash.length, 64);
  });

  it('should handle numeric values correctly', () => {
    const record1 = createMockDecisionRecord({ confidence: 50 });
    const record2 = createMockDecisionRecord({ confidence: 50.0 });
    const record3 = createMockDecisionRecord({ confidence: 51 });

    const hash1 = hashDecision(record1);
    const hash2 = hashDecision(record2);
    const hash3 = hashDecision(record3);

    // 50 and 50.0 should be treated the same in JSON
    assert.strictEqual(hash1, hash2);
    assert.notStrictEqual(hash1, hash3);
  });
});

console.log('Hash tests loaded. Run with: npm test');
