import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLcxSwap, requestLcxQuote } from '../../src/evm/lcx';
import { pickBestRoute } from '../../src/evm/oneinch';

const NATIVE = '0x0000000000000000000000000000000000000000';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_ROUTER = '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0';
const ONE_ETH = 10n ** 18n;
const RECIPIENT = '0x1111111111111111111111111111111111111111';

type FetchCall = { url: string; init: RequestInit };

const originalFetch = globalThis.fetch;
const originalKey = process.env.LCX_API_KEY;

function mockFetch(...responses: Array<{ status?: number; body: unknown }>): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function ok(data: unknown) {
  return { body: { success: true, data } };
}

// Response addresses are lowercased on purpose: matching must be case-insensitive
function quoteFixture(overrides: Record<string, unknown> = {}) {
  return {
    quoteId: 'q_8453_1',
    chainId: 8453,
    input: { token: NATIVE, amount: ONE_ETH.toString(), decimals: 18 },
    output: { token: USDC_BASE.toLowerCase(), amount: '3000000000', decimals: 6, minimumAmount: '2985000000' },
    spender: BASE_ROUTER.toLowerCase(),
    venues: ['uniswap-v3'],
    expiresAt: 1790000000,
    ...overrides,
  };
}

function buildFixture(swap: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  return {
    swap: { chainId: 8453, to: BASE_ROUTER.toLowerCase(), data: '0xabcdef', value: ONE_ETH.toString(), ...swap },
    minAmountOut: '2985000000',
    deadline: '1790000300',
    routerDeployed: true,
    simulation: { status: 'ok' },
    ...overrides,
  };
}

describe('pickBestRoute', () => {
  it('keeps the existing Uniswap vs 1inch choice', () => {
    assert.deepEqual(
      pickBestRoute({
        uniswapQuote: { outputAmount: '100', priceImpact: 0.1 },
        oneInchQuote: { outputAmount: '101', protocols: [] },
      }),
      { best: '1inch', savings: '1.00%' }
    );
    assert.deepEqual(
      pickBestRoute({
        uniswapQuote: { outputAmount: '100', priceImpact: 0.1 },
        oneInchQuote: { outputAmount: '100', protocols: [] },
      }),
      { best: 'uniswap', savings: '0.00%' }
    );
    assert.deepEqual(pickBestRoute({ oneInchQuote: { outputAmount: '5', protocols: [] } }), { best: '1inch' });
    assert.deepEqual(pickBestRoute({}), { best: 'uniswap' });
  });

  it('routes to LCX Liberty DEX only when it returns more', () => {
    assert.deepEqual(
      pickBestRoute({
        uniswapQuote: { outputAmount: '100', priceImpact: 0.1 },
        oneInchQuote: { outputAmount: '101', protocols: [] },
        lcxQuote: { outputAmount: '102.01', protocols: [] },
      }),
      { best: 'lcx', savings: '1.00%' }
    );
    assert.deepEqual(
      pickBestRoute({
        oneInchQuote: { outputAmount: '101', protocols: [] },
        lcxQuote: { outputAmount: '101', protocols: [] },
      }),
      { best: '1inch', savings: '0.00%' }
    );
  });
});

describe('LCX Liberty DEX client', () => {
  beforeEach(() => {
    process.env.LCX_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LCX_API_KEY;
    else process.env.LCX_API_KEY = originalKey;
  });

  it('sends a base-unit quote request with the bearer key', async () => {
    const calls = mockFetch(ok({ quote: quoteFixture() }));

    const quote = await requestLcxQuote('base', NATIVE, USDC_BASE, ONE_ETH, 50);

    assert.equal(quote.quoteId, 'q_8453_1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://swap-api.lcx.com/v1/quote');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal((calls[0].init.headers as Record<string, string>)['Authorization'], 'Bearer test-key');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      chainId: 8453,
      tokenIn: NATIVE,
      tokenOut: USDC_BASE,
      amountIn: ONE_ETH.toString(),
      slippageBps: 50,
    });
  });

  it('makes no request without LCX_API_KEY', async () => {
    delete process.env.LCX_API_KEY;
    const calls = mockFetch();

    await assert.rejects(requestLcxQuote('base', NATIVE, USDC_BASE, ONE_ETH), /LCX_API_KEY/);
    assert.equal(calls.length, 0);
  });

  it('surfaces the API error code', async () => {
    mockFetch({ status: 400, body: { success: false, code: 'no_route', error: 'no_route', message: 'No route found' } });

    await assert.rejects(requestLcxQuote('base', NATIVE, USDC_BASE, ONE_ETH), /\(400\): no_route: No route found/);
  });

  it('rejects a quote that does not match the request', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ spender: '0x2222222222222222222222222222222222222222' }, /spender/],
      [{ chainId: 1 }, /chain 1/],
      [{ input: { token: NATIVE, amount: '1', decimals: 18 } }, /input amount/],
      [{ input: { token: USDC_BASE, amount: ONE_ETH.toString(), decimals: 6 } }, /input token/],
      [{ output: { token: NATIVE, amount: '1', decimals: 18, minimumAmount: '1' } }, /output token/],
    ];

    for (const [override, expected] of cases) {
      mockFetch(ok({ quote: quoteFixture(override) }));
      await assert.rejects(requestLcxQuote('base', NATIVE, USDC_BASE, ONE_ETH), expected);
    }
  });

  it('builds a native sell for the recipient and passes the checks', async () => {
    const calls = mockFetch(ok({ quote: quoteFixture() }), ok(buildFixture()));

    const quote = await requestLcxQuote('base', NATIVE, USDC_BASE, ONE_ETH, 50);
    const tx = await buildLcxSwap('base', quote, RECIPIENT, 50);

    assert.deepEqual(tx, { to: BASE_ROUTER.toLowerCase(), data: '0xabcdef', value: ONE_ETH });
    assert.equal(calls[1].url, 'https://swap-api.lcx.com/v1/build');
    assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
      quoteId: 'q_8453_1',
      recipient: RECIPIENT,
      slippageBps: 50,
    });
  });

  it('rejects a build that does not match the quote', async () => {
    const quote = quoteFixture();
    const cases: Array<[ReturnType<typeof buildFixture>, RegExp]> = [
      [buildFixture({ to: '0x2222222222222222222222222222222222222222' }), /swap target/],
      [buildFixture({ chainId: 1 }), /chain 1/],
      [buildFixture({}, { routerDeployed: false }), /not deployed/],
      [buildFixture({}, { minAmountOut: '1' }), /minAmountOut/],
      [buildFixture({ value: '0' }), /value/],
    ];

    for (const [build, expected] of cases) {
      mockFetch(ok(build));
      await assert.rejects(buildLcxSwap('base', quote, RECIPIENT, 50), expected);
    }
  });

  it('requires zero value when selling an ERC-20', async () => {
    const quote = quoteFixture({
      input: { token: USDC_BASE.toLowerCase(), amount: '3000000000', decimals: 6 },
      output: { token: NATIVE, amount: ONE_ETH.toString(), decimals: 18, minimumAmount: '2985000000' },
    });

    mockFetch(ok(buildFixture({ value: '3000000000' })));
    await assert.rejects(buildLcxSwap('base', quote, RECIPIENT, 50), /value/);

    mockFetch(ok(buildFixture({ value: '0' })));
    const tx = await buildLcxSwap('base', quote, RECIPIENT, 50);
    assert.equal(tx.value, 0n);
  });
});
