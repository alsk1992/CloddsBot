/**
 * Token Security Tests
 *
 * Solana parsing against the real GoPlus Solana response shape (authorities as { status } objects).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;
const MINT = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

function goplusSolana(overrides: Record<string, any> = {}) {
  return {
    mintable: { authority: [], status: '0' },
    freezable: { authority: [], status: '0' },
    balance_mutable_authority: { authority: [], status: '0' },
    non_transferable: '0',
    transfer_fee: {},
    transfer_hook: [],
    holder_count: '262738',
    holders: [{ percent: '0.1372' }, { percent: '0.05' }],
    dex: [{ dex_name: 'raydium', tvl: '4973858.45' }],
    metadata: { name: 'dogwifhat', symbol: '$WIF' },
    ...overrides,
  };
}

function mockFetch(result: Record<string, any>) {
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 1, message: 'ok', result: { [MINT]: result } }))) as typeof fetch;
}

describe('token security: Solana', () => {
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.TOKENGUARD_PARTNER_ID; });

  it('rates a clean, liquid token as safe', async () => {
    mockFetch(goplusSolana());
    const { createTokenSecurityService } = await import('../../src/token-security/index.js');
    const r = await createTokenSecurityService().auditSolanaToken(MINT);
    assert.deepEqual(r.riskFlags, []);
    assert.equal(r.riskLevel, 'safe');
    assert.equal(r.symbol, '$WIF');
    assert.ok(r.totalLiquidity > 4_000_000);
  });

  it('flags live freeze and mint authorities', async () => {
    mockFetch(goplusSolana({ mintable: { authority: ['x'], status: '1' }, freezable: { authority: ['x'], status: '1' } }));
    const { createTokenSecurityService } = await import('../../src/token-security/index.js');
    const r = await createTokenSecurityService().auditSolanaToken(MINT);
    assert.ok(r.riskFlags.includes('Freeze authority active'));
    assert.ok(r.riskFlags.includes('Has mint function'));
    assert.equal(r.isHoneypot, true);
    assert.ok(r.riskScore < 60);
  });

  it('flags Token-2022 transfer fees and hooks', async () => {
    mockFetch(goplusSolana({ transfer_fee: { current_fee_rate: '0.1' }, transfer_hook: [{ address: 'x' }] }));
    const { createTokenSecurityService } = await import('../../src/token-security/index.js');
    const r = await createTokenSecurityService().auditSolanaToken(MINT);
    assert.ok(r.riskFlags.includes('Has transfer fee'));
    assert.ok(r.riskFlags.includes('Has transfer hook'));
  });
});
