/**
 * Live Tennis API Feed Tests
 *
 * Unit tests for the pure logic: break-point derivation and response mapping.
 * No network calls.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBreakPoint, mapScore } from '../../../src/feeds/livetennis/index';

// =============================================================================
// BREAK-POINT DERIVATION
// =============================================================================

describe('livetennis isBreakPoint', () => {
  it('receiver at AD against serve is a break point', () => {
    // p1 serving, p2 (receiver) at AD
    assert.equal(isBreakPoint(1, ['40', 'AD'], false), true);
    // p2 serving, p1 (receiver) at AD
    assert.equal(isBreakPoint(2, ['AD', '40'], false), true);
  });

  it('receiver at 40 with server at 0/15/30 is a break point', () => {
    assert.equal(isBreakPoint(1, ['0', '40'], false), true);
    assert.equal(isBreakPoint(1, ['15', '40'], false), true);
    assert.equal(isBreakPoint(1, ['30', '40'], false), true);
    assert.equal(isBreakPoint(2, ['40', '30'], false), true);
  });

  it('deuce (40-40) is not a break point', () => {
    assert.equal(isBreakPoint(1, ['40', '40'], false), false);
  });

  it('server at AD is not a break point', () => {
    assert.equal(isBreakPoint(1, ['AD', '40'], false), false);
  });

  it('receiver below 40 is not a break point', () => {
    assert.equal(isBreakPoint(1, ['0', '30'], false), false);
    assert.equal(isBreakPoint(1, ['40', '15'], false), false);
  });

  it('never a break point during a tiebreak', () => {
    assert.equal(isBreakPoint(1, ['0', '40'], true), false);
  });

  it('false when server is unknown', () => {
    assert.equal(isBreakPoint(null, ['0', '40'], false), false);
  });

  it('false when either points entry is null', () => {
    assert.equal(isBreakPoint(1, [null, '40'], false), false);
    assert.equal(isBreakPoint(1, ['30', null], false), false);
    assert.equal(isBreakPoint(1, [], false), false);
  });
});

// =============================================================================
// RESPONSE MAPPING
// =============================================================================

describe('livetennis mapScore', () => {
  it('maps a live score and derives the break-point flag', () => {
    const score = mapScore({
      sets: [1, 0],
      games: [[6, 3], [4, 5]],
      points: ['15', '40'],
      server: 1,
      is_tiebreak: false,
      timestamp: '2026-08-18T12:00:00Z',
    });

    assert.ok(score);
    assert.deepEqual(score.sets, [1, 0]);
    assert.equal(score.server, 1);
    assert.equal(score.isTiebreak, false);
    assert.equal(score.isBreakPoint, true);
    assert.ok(score.timestamp instanceof Date);
  });

  it('returns null for a missing score (upcoming match)', () => {
    assert.equal(mapScore(null), null);
    assert.equal(mapScore(undefined), null);
  });

  it('tolerates null points entries observed on completed matches', () => {
    const score = mapScore({
      sets: [2, 0],
      games: [],
      points: [null, null],
      server: null,
      is_tiebreak: false,
      timestamp: null,
    });

    assert.ok(score);
    assert.equal(score.isBreakPoint, false);
    assert.equal(score.timestamp, null);
  });
});
