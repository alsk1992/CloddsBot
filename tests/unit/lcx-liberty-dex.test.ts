import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { buildLcxSwap, requestLcxQuote, verifyLcxCalldata } from '../../src/evm/lcx';
import { pickBestRoute } from '../../src/evm/oneinch';

const NATIVE = '0x0000000000000000000000000000000000000000';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_ROUTER = '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0';
const ONE_ETH = 10n ** 18n;
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const BEBOP_SETTLEMENT = '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F';
const MIN_OUT = 2985000000n;
const DEADLINE = 4102444800n; // 2100-01-01

// Router ABI written out separately from src/evm/lcx.ts, so the tests also check its decoding
const LEGS = 'tuple(uint256 amountIn, tuple(uint8 family, address pool, address tokenIn, address tokenOut, uint256 aux)[] hops)[]';
const FEE_ARGS = 'tuple(address tokenIn, address tokenOut, uint256 totalIn, uint256 minAmountOut, address recipient, uint256 deadline, address integrator)';
const ROUTER = new Interface([
  `function swapSplit(address tokenIn, address tokenOut, uint256 totalIn, uint256 minAmountOut, address recipient, uint256 deadline, ${LEGS} legs)`,
  `function swapSplitWithFee(${FEE_ARGS} a, ${LEGS} legs)`,
  `function swapSplitViaPropAMM(${FEE_ARGS} a, ${LEGS} legs, address venue, uint256 coreNetOut)`,
  `function swapSplitWithPropAMMSplit(${FEE_ARGS} a, ${LEGS} splitLegs, ${LEGS} fullLegs, tuple(address venue, uint256 venueIn, uint256 venueMinOut) s)`,
  `function makerSwap(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient, uint256 deadline) a, ${LEGS} poolLegs, tuple(address target, address spender, uint256 amountIn, uint256 minOut, bytes data) m, ${LEGS} fallbackLegs)`,
]);
const ROUTE = [{ amountIn: ONE_ETH, hops: [{ family: 1, pool: OTHER, tokenIn: NATIVE, tokenOut: USDC_BASE, aux: 0n }] }];

type Trade = { tokenIn: string; tokenOut: string; totalIn: bigint; minAmountOut: bigint; recipient: string; deadline: bigint };

function trade(overrides: Partial<Trade> = {}): Trade {
  return { tokenIn: NATIVE, tokenOut: USDC_BASE, totalIn: ONE_ETH, minAmountOut: MIN_OUT, recipient: RECIPIENT, deadline: DEADLINE, ...overrides };
}

function swapSplitData(overrides: Partial<Trade> = {}): string {
  const t = trade(overrides);
  return ROUTER.encodeFunctionData('swapSplit', [t.tokenIn, t.tokenOut, t.totalIn, t.minAmountOut, t.recipient, t.deadline, ROUTE]);
}

function feeArgs({ integrator = NATIVE, ...overrides }: Partial<Trade> & { integrator?: string } = {}) {
  return { ...trade(overrides), integrator };
}

function propAmmSplitData(venueIn = 0n, overrides: Partial<Trade> & { integrator?: string } = {}): string {
  return ROUTER.encodeFunctionData('swapSplitWithPropAMMSplit', [
    feeArgs(overrides),
    ROUTE,
    ROUTE,
    { venue: OTHER, venueIn, venueMinOut: 0n },
  ]);
}

function makerSwapData(maker: { target?: string; spender?: string; amountIn?: bigint; data?: string } = {}): string {
  const { totalIn, ...t } = trade();
  return ROUTER.encodeFunctionData('makerSwap', [
    { ...t, amountIn: totalIn },
    [],
    { target: BEBOP_SETTLEMENT, spender: BEBOP_SETTLEMENT, amountIn: ONE_ETH, minOut: MIN_OUT, data: '0x', ...maker },
    [],
  ]);
}

const EXPECTED = { tokenIn: NATIVE, tokenOut: USDC_BASE, amountIn: ONE_ETH, minAmountOut: MIN_OUT, recipient: RECIPIENT };

function routerTx(data: string, value = ONE_ETH) {
  return { to: BASE_ROUTER, data, value };
}

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
    swap: { chainId: 8453, to: BASE_ROUTER.toLowerCase(), data: swapSplitData(), value: ONE_ETH.toString(), ...swap },
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

    assert.deepEqual(tx, { to: BASE_ROUTER.toLowerCase(), data: swapSplitData(), value: ONE_ETH });
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
      [buildFixture({ data: swapSplitData({ recipient: OTHER }) }), /calldata pays/],
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

    const data = swapSplitData({ tokenIn: USDC_BASE, tokenOut: NATIVE, totalIn: 3000000000n });

    mockFetch(ok(buildFixture({ data, value: '3000000000' })));
    await assert.rejects(buildLcxSwap('base', quote, RECIPIENT, 50), /value/);

    mockFetch(ok(buildFixture({ data, value: '0' })));
    const tx = await buildLcxSwap('base', quote, RECIPIENT, 50);
    assert.equal(tx.value, 0n);
  });
});

describe('verifyLcxCalldata', () => {
  it('uses the published router selectors', () => {
    const names = ['swapSplit', 'swapSplitWithFee', 'swapSplitViaPropAMM', 'swapSplitWithPropAMMSplit', 'makerSwap'];
    assert.deepEqual(
      names.map((name) => ROUTER.getFunction(name)?.selector),
      ['0xfc54261d', '0x5e98574a', '0x195e648e', '0x31ab353b', '0xa565fdcc']
    );
  });

  it('accepts each entrypoint when it matches the trade', () => {
    const calls = [
      swapSplitData(),
      swapSplitData({ minAmountOut: MIN_OUT + 1n }), // a higher floor is fine
      ROUTER.encodeFunctionData('swapSplitWithFee', [feeArgs(), ROUTE]),
      ROUTER.encodeFunctionData('swapSplitViaPropAMM', [feeArgs(), ROUTE, OTHER, 0n]),
      propAmmSplitData(),
      propAmmSplitData(ONE_ETH), // the venue may take the whole amount
      makerSwapData(),
    ];

    for (const data of calls) {
      assert.doesNotThrow(() => verifyLcxCalldata('base', routerTx(data), EXPECTED));
    }
  });

  it('refuses calldata that does not do what was asked', () => {
    const cases: Array<[string, ReturnType<typeof routerTx>, RegExp]> = [
      ['wrong router', { ...routerTx(swapSplitData()), to: OTHER }, /published router/],
      ['wrong recipient', routerTx(swapSplitData({ recipient: OTHER })), /calldata pays/],
      ['lower minAmountOut', routerTx(swapSplitData({ minAmountOut: MIN_OUT - 1n })), /minAmountOut/],
      ['wrong totalIn', routerTx(swapSplitData({ totalIn: ONE_ETH - 1n })), /different amount/],
      ['swapped tokens', routerTx(swapSplitData({ tokenIn: USDC_BASE, tokenOut: NATIVE })), /tokens differ/],
      ['unknown selector', routerTx(`0xdeadbeef${swapSplitData().slice(10)}`), /known router entrypoint/],
      ['malformed calldata', routerTx(swapSplitData().slice(0, 100)), /known router entrypoint/],
      ['wrong value', routerTx(swapSplitData(), 0n), /value/],
      ['expired deadline', routerTx(swapSplitData({ deadline: 1_000_000n })), /deadline/],
      ['wrapper with lower minAmountOut', routerTx(ROUTER.encodeFunctionData('swapSplitWithFee', [feeArgs({ minAmountOut: 1n }), ROUTE])), /minAmountOut/],
      ['makerSwap to a non-Bebop target', routerTx(makerSwapData({ target: OTHER })), /Bebop/],
      ['makerSwap with a non-Bebop spender', routerTx(makerSwapData({ spender: OTHER })), /Bebop/],
      ['maker leg above the total', routerTx(makerSwapData({ amountIn: ONE_ETH + 1n })), /more than the total/],
    ];

    for (const [name, tx, expected] of cases) {
      assert.throws(() => verifyLcxCalldata('base', tx, EXPECTED), expected, name);
    }
  });

  it('refuses a maker leg to a non-Bebop contract even when it sells nothing', () => {
    for (const leg of [{ target: OTHER }, { spender: OTHER }, { target: NATIVE, spender: NATIVE, data: '0x01' }]) {
      const data = makerSwapData({ ...leg, amountIn: 0n });
      assert.throws(() => verifyLcxCalldata('base', routerTx(data), EXPECTED), /neither a Bebop fill nor empty/);
    }
  });

  it('accepts an empty maker leg', () => {
    const data = makerSwapData({ target: NATIVE, spender: NATIVE, amountIn: 0n, data: '0x' });
    assert.doesNotThrow(() => verifyLcxCalldata('base', routerTx(data), EXPECTED));
  });

  it('refuses a non-zero integrator on every wrapper', () => {
    const fee = feeArgs({ integrator: OTHER });
    const calls = [
      ROUTER.encodeFunctionData('swapSplitWithFee', [fee, ROUTE]),
      ROUTER.encodeFunctionData('swapSplitViaPropAMM', [fee, ROUTE, OTHER, 0n]),
      propAmmSplitData(0n, { integrator: OTHER }),
    ];

    for (const data of calls) {
      assert.throws(() => verifyLcxCalldata('base', routerTx(data), EXPECTED), /integrator fee/);
    }
  });

  it('refuses a prop-AMM leg that sells more than the total', () => {
    const data = propAmmSplitData(ONE_ETH + 1n);
    assert.throws(() => verifyLcxCalldata('base', routerTx(data), EXPECTED), /prop-AMM leg sells more/);
  });
});
