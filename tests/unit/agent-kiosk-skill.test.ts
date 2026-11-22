import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import skill, { executeAgentKiosk } from '../../src/skills/bundled/agent-kiosk/index.js';

describe('agent-kiosk bundled skill', () => {
  it('exports valid skill metadata and help text', async () => {
    assert.equal(skill.name, 'agent-kiosk');
    assert.deepEqual(skill.commands, ['/kiosk', '/agent-kiosk']);
    const help = await executeAgentKiosk('help');
    assert.ok(help.includes('/kiosk swap'));
    assert.ok(help.includes('/kiosk gate'));
  });

  it('formats executable EVM swap quote from /v1/free-swap', async () => {
    const mockFetch: typeof fetch = async (input) => {
      assert.equal(String(input), 'https://agent-kiosk.vercel.app/v1/free-swap');
      return new Response(
        JSON.stringify({
          ok: true,
          attestation: { attested: true },
          data: {
            aggregator: 'relay',
            from_chain: 'base',
            from_token: { symbol: 'USDC' },
            to_token: { symbol: 'WETH', estimated_amount_human: '0.0581' },
            transaction_request: {
              to: '0xf70da97812CB96acDF810712Aa562db8dfA3dbEF',
              data: '0x12345678',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const out = await executeAgentKiosk('swap 100 USDC WETH base', { fetchImpl: mockFetch });
    assert.ok(out.includes('100 USDC -> ~0.0581 WETH'));
    assert.ok(out.includes('0xf70da97812CB96acDF810712Aa562db8dfA3dbEF'));
    assert.ok(out.includes('HMAC-SHA256'));
  });

  it('evaluates pre-swap token safety gate via MCP tools/call', async () => {
    let capturedHeaders: Record<string, string> = {};
    const mockFetch: typeof fetch = async (_input, init) => {
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  tier: 'FREE_DAILY_MCP_TRIAL_1_OF_2',
                  data: {
                    decision: 'go',
                    verdict: 'SAFE',
                    risk_score: 20,
                    liquidity_usd: 48500000,
                    reason: 'token passes safety checks',
                    flags: [],
                    token_meta: { symbol: 'AERO' },
                  },
                }),
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const out = await executeAgentKiosk(
      'gate 0x940181a94A35A4569E4529A3CDfB74e38FD98631 250',
      { fetchImpl: mockFetch, apiKey: 'ak_live_test' },
    );
    assert.equal(capturedHeaders['X-API-KEY'], 'ak_live_test');
    assert.ok(out.includes('AERO'));
    assert.ok(out.includes('Decision: GO'));
    assert.ok(out.includes('$48,500,000'));
  });

  it('validates input addresses on gate and compliance subcommands', async () => {
    const badGate = await executeAgentKiosk('gate not-an-address');
    assert.ok(badGate.startsWith('Usage: /kiosk gate'));

    const badCompliance = await executeAgentKiosk('compliance invalid');
    assert.ok(badCompliance.startsWith('Usage: /kiosk compliance'));
  });
});
