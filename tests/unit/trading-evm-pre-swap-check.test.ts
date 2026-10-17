import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TokenSecurityResult } from '../../src/token-security/index';
import { preSwapCheck, type AuditFn } from '../../src/skills/bundled/trading-evm/pre-swap-check';

const TOKEN = '0x1111111111111111111111111111111111111111';

function result(over: Partial<TokenSecurityResult> = {}): TokenSecurityResult {
  return {
    address: TOKEN, chain: 'base', symbol: 'TEST',
    isHoneypot: false, hasProxyContract: false, hasMintFunction: false, hasBlacklist: false, isOpenSource: true,
    buyTax: 0, sellTax: 0, holderCount: 100, top10HolderPct: 20, creatorHolderPct: 0,
    totalLiquidity: 100000, liquidityLocked: true, riskScore: 90, riskLevel: 'safe', riskFlags: [],
    ...over,
  };
}
const auditReturning = (r: TokenSecurityResult): AuditFn => async () => r;
const noAudit: AuditFn = async () => { throw new Error('must not be called'); };

test('blocks a token GoPlus flags as a honeypot', async () => {
  const v = await preSwapCheck(TOKEN, 'base', auditReturning(result({ isHoneypot: true })));
  assert.match(v.block ?? '', /honeypot/);
});

test('blocks a prohibitive sell tax', async () => {
  const v = await preSwapCheck(TOKEN, 'base', auditReturning(result({ sellTax: 99 })));
  assert.match(v.block ?? '', /99% sell tax/);
});

test('warns, without blocking, on a high composite risk score', async () => {
  const v = await preSwapCheck(TOKEN, 'base', auditReturning(result({ riskLevel: 'critical', riskScore: 10, riskFlags: ['Has mint function'] })));
  assert.equal(v.block, undefined);
  assert.match(v.warnings[0], /critical.*Has mint function/);
});

test('a clean token passes silently', async () => {
  assert.deepEqual(await preSwapCheck(TOKEN, 'base', auditReturning(result())), { warnings: [] });
});

test('fails open with a warning when the check errors', async () => {
  const v = await preSwapCheck(TOKEN, 'base', async () => { throw new Error('GoPlus API error: 429'); });
  assert.equal(v.block, undefined);
  assert.match(v.warnings[0], /NOT checked/);
});

test('skips symbols, the native placeholder and --force without calling GoPlus', async () => {
  assert.deepEqual(await preSwapCheck('USDC', 'base', noAudit), { warnings: [] });
  assert.deepEqual(await preSwapCheck('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', 'base', noAudit), { warnings: [] });
  assert.deepEqual(await preSwapCheck(TOKEN, 'base', noAudit, true), { warnings: [] });
});
