import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// =============================================================================
// KELLY CRITERION TESTS
// =============================================================================

describe('Kelly Criterion', () => {
  // Import the module
  const kellyModule = require('../src/utils/kelly');
  const { calculateKelly, calculatePredictionMarketKelly, calculateSafePositionSize } = kellyModule;

  describe('calculateKelly', () => {
    it('should return zero for negative EV bets', () => {
      const result = calculateKelly({
        winProb: 0.4,
        odds: 2.0,
        bankroll: 1000,
      });

      assert.strictEqual(result.hasPositiveEV, false);
      assert.strictEqual(result.fullKelly, 0);
      assert.strictEqual(result.recommendedSize, 0);
    });

    it('should calculate correct Kelly for positive EV bet', () => {
      // 60% win prob, 2:1 odds = positive EV
      const result = calculateKelly({
        winProb: 0.6,
        odds: 2.0,
        bankroll: 1000,
      });

      assert.strictEqual(result.hasPositiveEV, true);
      assert.ok(result.fullKelly > 0);
      assert.ok(result.halfKelly < result.fullKelly);
      assert.ok(result.quarterKelly < result.halfKelly);
    });

    it('should reduce Kelly when confidence is low', () => {
      const highConfidence = calculateKelly({
        winProb: 0.6,
        odds: 2.0,
        bankroll: 1000,
        confidence: 1.0,
      });

      const lowConfidence = calculateKelly({
        winProb: 0.6,
        odds: 2.0,
        bankroll: 1000,
        confidence: 0.5,
      });

      assert.ok(lowConfidence.fullKelly < highConfidence.fullKelly);
    });
  });

  describe('calculatePredictionMarketKelly', () => {
    it('should recommend buying YES when estimated prob > market price', () => {
      const result = calculatePredictionMarketKelly(
        0.40,  // market price
        0.55,  // estimated probability (higher = buy YES)
        1000   // bankroll
      );

      assert.ok(result.hasPositiveEV);
      assert.ok(result.fullKelly > 0);
    });

    it('should return zero when no edge', () => {
      const result = calculatePredictionMarketKelly(
        0.50,  // market price
        0.50,  // same as market = no edge
        1000
      );

      assert.strictEqual(result.hasPositiveEV, false);
    });
  });

  describe('calculateSafePositionSize', () => {
    it('should cap position at max percentage', () => {
      const kellyResult = {
        fullKelly: 500,
        halfKelly: 250,
        quarterKelly: 125,
        kellyFraction: 0.5,
        expectedValue: 0.1,
        hasPositiveEV: true,
        recommendedFraction: 0.25,
        recommendedSize: 250,
      };

      const size = calculateSafePositionSize(kellyResult, 0.1, 1, 10000);
      assert.ok(size <= 100); // 10% of 1000 bankroll
    });

    it('should enforce minimum position size', () => {
      const kellyResult = {
        fullKelly: 0.5,
        halfKelly: 0.25,
        quarterKelly: 0.125,
        kellyFraction: 0.0005,
        expectedValue: 0.001,
        hasPositiveEV: true,
        recommendedFraction: 0.00025,
        recommendedSize: 0.25,
      };

      const size = calculateSafePositionSize(kellyResult, 0.1, 5, 10000);
      assert.ok(size >= 5); // Min $5
    });
  });
});

// =============================================================================
// CIRCUIT BREAKER TESTS
// =============================================================================

describe('Circuit Breaker', () => {
  const { createCircuitBreaker } = require('../src/execution/circuit-breaker');

  it('should allow trading when not tripped', () => {
    const cb = createCircuitBreaker({
      maxLossUsd: 1000,
      maxConsecutiveLosses: 5,
    }, 10000);

    assert.strictEqual(cb.canTrade(), true);
    assert.strictEqual(cb.getState().isTripped, false);
  });

  it('should trip on max loss threshold', () => {
    const cb = createCircuitBreaker({
      maxLossUsd: 100,
    }, 10000);

    // Record a big loss
    cb.recordTrade({ pnlUsd: -150, success: true, sizeUsd: 200 });

    const state = cb.getState();
    assert.strictEqual(state.isTripped, true);
    assert.strictEqual(state.tripReason, 'max_loss');
    assert.strictEqual(cb.canTrade(), false);
  });

  it('should trip on consecutive losses', () => {
    const cb = createCircuitBreaker({
      maxConsecutiveLosses: 3,
      maxLossUsd: 10000, // High so it doesn't trip first
    }, 10000);

    cb.recordTrade({ pnlUsd: -10, success: true, sizeUsd: 50 });
    cb.recordTrade({ pnlUsd: -10, success: true, sizeUsd: 50 });
    assert.strictEqual(cb.canTrade(), true);

    cb.recordTrade({ pnlUsd: -10, success: true, sizeUsd: 50 });
    assert.strictEqual(cb.getState().tripReason, 'consecutive_losses');
    assert.strictEqual(cb.canTrade(), false);
  });

  it('should reset consecutive losses on win', () => {
    const cb = createCircuitBreaker({
      maxConsecutiveLosses: 3,
    }, 10000);

    cb.recordTrade({ pnlUsd: -10, success: true, sizeUsd: 50 });
    cb.recordTrade({ pnlUsd: -10, success: true, sizeUsd: 50 });
    cb.recordTrade({ pnlUsd: 20, success: true, sizeUsd: 50 }); // Win resets counter

    assert.strictEqual(cb.getState().consecutiveLosses, 0);
    assert.strictEqual(cb.canTrade(), true);
  });

  it('should allow manual reset', () => {
    const cb = createCircuitBreaker({ maxLossUsd: 50 }, 10000);

    cb.recordTrade({ pnlUsd: -100, success: true, sizeUsd: 100 });
    assert.strictEqual(cb.canTrade(), false);

    cb.reset();
    assert.strictEqual(cb.canTrade(), true);
    assert.strictEqual(cb.getState().isTripped, false);
  });
});

// =============================================================================
// RATE LIMITER TESTS
// =============================================================================

describe('Rate Limiter', () => {
  const { createRateLimiter } = require('../src/utils/rate-limiter');

  it('should allow requests within limit', () => {
    const limiter = createRateLimiter({
      maxRequests: 10,
      windowMs: 1000,
    });

    // Should allow first few requests
    for (let i = 0; i < 5; i++) {
      const allowed = limiter.recordRequest('test-endpoint');
      assert.strictEqual(allowed, true);
    }

    const status = limiter.getStatus('test-endpoint');
    assert.ok(status.remaining > 0);
  });

  it('should track different endpoints separately', () => {
    const limiter = createRateLimiter({
      maxRequests: 5,
      windowMs: 1000,
    });

    // Make requests to two different endpoints
    limiter.recordRequest('/a');
    limiter.recordRequest('/b');

    const statsA = limiter.getStats('/a');
    const statsB = limiter.getStats('/b');

    // Each should have their own count (windowRequests = requests in current window)
    assert.strictEqual(statsA.windowRequests, 1);
    assert.strictEqual(statsB.windowRequests, 1);
  });

  it('should block when limit exceeded', () => {
    const limiter = createRateLimiter({
      maxRequests: 2,
      windowMs: 60000, // Long window so it doesn't reset
    });

    assert.strictEqual(limiter.recordRequest('test'), true);
    assert.strictEqual(limiter.recordRequest('test'), true);
    assert.strictEqual(limiter.recordRequest('test'), false); // Should be blocked
    assert.strictEqual(limiter.canRequest('test'), false);
  });
});

// =============================================================================
// SEMANTIC MATCHING VERIFICATION TESTS
// =============================================================================

describe('Semantic Match Verification', () => {
  // Test entity extraction patterns
  it('should extract years correctly', () => {
    const text = 'Will Trump win in 2024 or 2028?';
    const yearMatches = text.match(/\b(20[2-3]\d)\b/g);

    assert.deepStrictEqual(yearMatches, ['2024', '2028']);
  });

  it('should extract dollar amounts', () => {
    const text = 'BTC above $100k by EOY';
    const dollarRegex = /\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|b|trillion|billion|million|thousand)?/gi;
    const matches = [...text.matchAll(dollarRegex)];

    assert.ok(matches.length > 0);
    assert.strictEqual(matches[0][1], '100');
    assert.strictEqual(matches[0][2], 'k');
  });

  it('should extract person names', () => {
    const text = 'Will Biden or Trump win?';
    const personPatterns = /\b(trump|biden|harris|obama)\b/gi;
    const matches = text.match(personPatterns);

    assert.ok(matches);
    assert.ok(matches.includes('Biden'));
    assert.ok(matches.includes('Trump'));
  });

  it('should detect year mismatch between questions', () => {
    const questionA = 'Will Trump win in 2024?';
    const questionB = 'Will Trump win in 2028?';

    const yearsA = questionA.match(/\b(20[2-3]\d)\b/g) || [];
    const yearsB = questionB.match(/\b(20[2-3]\d)\b/g) || [];

    // Years don't match = should NOT be considered same market
    const yearsMatch = yearsA.length > 0 && yearsB.length > 0 &&
      yearsA.every(y => yearsB.includes(y));

    assert.strictEqual(yearsMatch, false);
  });
});

// =============================================================================
// PORTFOLIO CORRELATION TESTS
// =============================================================================

describe('Portfolio Correlation', () => {
  it('should classify positions by category', () => {
    const classifyPosition = (question: string) => {
      const q = question.toLowerCase();
      if (/trump|biden|election|president/i.test(q)) return 'politics';
      if (/bitcoin|btc|ethereum|crypto/i.test(q)) return 'crypto';
      if (/nfl|nba|super\s*bowl/i.test(q)) return 'sports';
      return 'other';
    };

    assert.strictEqual(classifyPosition('Will Trump win 2024?'), 'politics');
    assert.strictEqual(classifyPosition('Bitcoin above $100k?'), 'crypto');
    assert.strictEqual(classifyPosition('Chiefs win Super Bowl?'), 'sports');
    assert.strictEqual(classifyPosition('Aliens contact?'), 'other');
  });

  it('should calculate HHI concentration', () => {
    // HHI = sum of squared market shares
    const calculateHHI = (values: number[]) => {
      const total = values.reduce((a, b) => a + b, 0);
      if (total === 0) return 0;

      const shares = values.map(v => (v / total) * 100);
      return shares.reduce((sum, s) => sum + s * s, 0);
    };

    // Single position = max concentration
    assert.strictEqual(calculateHHI([100]), 10000);

    // Equal split = low concentration
    const equalHHI = calculateHHI([25, 25, 25, 25]);
    assert.ok(equalHHI < 3000); // Should be 2500

    // Concentrated = high
    const concentratedHHI = calculateHHI([80, 10, 10]);
    assert.ok(concentratedHHI > 5000);
  });
});

console.log('All tests defined. Run with: npm test');
