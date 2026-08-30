import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Connection } from '@solana/web3.js';
import {
  computeWeightedAverageFill,
  formatVenueArbitrageScanResult,
  scanVenueArbitrage,
} from '../../src/trading/venue-arbitrage-scanner';
import type { LighterMarket, LighterOrderbook } from '../../src/exchanges/lighter/index';

const FAKE_CONNECTION = {} as Connection;

describe('computeWeightedAverageFill', () => {
  it('fills fully within a single level', () => {
    const fill = computeWeightedAverageFill([{ price: 100, size: 5 }], 2);
    assert.ok(fill);
    assert.equal(fill!.averagePrice, 100);
    assert.equal(fill!.filledSize, 2);
    assert.equal(fill!.complete, true);
  });

  it('walks multiple levels and reports partial fills when depth runs out', () => {
    const fill = computeWeightedAverageFill(
      [
        { price: 100, size: 1 },
        { price: 101, size: 1 },
      ],
      5
    );
    assert.ok(fill);
    assert.equal(fill!.filledSize, 2);
    assert.equal(fill!.complete, false);
    assert.equal(fill!.notional, 100 * 1 + 101 * 1);
  });

  it('returns null for empty or invalid book depth', () => {
    assert.equal(computeWeightedAverageFill([], 5), null);
    assert.equal(computeWeightedAverageFill([{ price: 100, size: 5 }], 0), null);
  });
});

describe('scanVenueArbitrage (solana)', () => {
  const solanaOverrides = {
    getTokenList: async () => [{ address: 'USDC_MINT', symbol: 'USDC', decimals: 6 }],
    getSolanaConnection: () => FAKE_CONNECTION,
    getJupiterQuote: async ({ inputMint, amount }: { inputMint: string; amount: string }) => {
      const isBuyLeg = inputMint === 'USDC_MINT';
      const amt = Number(amount) / 10 ** (isBuyLeg ? 6 : 9);
      const out = isBuyLeg ? amt / 150 : amt * 149.5; // ask ~150, bid ~149.5
      return {
        inputMint,
        outputMint: isBuyLeg ? 'SOL' : 'USDC_MINT',
        inAmount: amount,
        outAmount: String(Math.floor(out * 10 ** (isBuyLeg ? 9 : 6))),
        priceImpactPct: '0.01',
        routePlan: [{ swapInfo: { label: 'Jupiter' } }],
        otherAmountThreshold: amount,
        swapMode: 'ExactIn',
        slippageBps: 50,
      };
    },
    getRaydiumQuote: async ({ inputMint, amount }: { inputMint: string; amount: string }) => {
      const isBuyLeg = inputMint === 'USDC_MINT';
      const amt = Number(amount) / 10 ** (isBuyLeg ? 6 : 9);
      const out = isBuyLeg ? amt / 148 : amt * 147.5; // ask ~148, bid ~147.5 (cheaper venue)
      return {
        outAmount: String(Math.floor(out * 10 ** (isBuyLeg ? 9 : 6))),
        minOutAmount: '0',
        priceImpact: 0.01,
      };
    },
    selectBestPool: async () => null,
    getPumpSwapQuote: async ({ side, amountIn }: { side: 'buy' | 'sell'; amountIn: string }) => {
      const amt = Number(amountIn) / 10 ** (side === 'buy' ? 6 : 9);
      const out = side === 'buy' ? amt / 146 : amt * 145.5; // ask ~146, bid ~145.5 (cheapest venue)
      return {
        poolAddress: 'pumpswap-pool-1',
        side,
        amountIn,
        amountOut: String(Math.floor(out * 10 ** (side === 'buy' ? 9 : 6))),
        amountLimit: '0',
        poolBaseReserve: '1000000000000',
        poolQuoteReserve: '50000000000',
      };
    },
  };

  it('finds a crossed plan between two solana venues and prices it sanely', async () => {
    const result = await scanVenueArbitrage(
      {
        family: 'solana',
        baseToken: 'SOL',
        quoteToken: 'USDC',
        quoteSize: 1000,
        venues: ['jupiter', 'raydium'],
      },
      solanaOverrides
    );

    assert.equal(result.quotes.length, 2);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.plans.length, 1);
    assert.equal(result.plans[0].buyPlatform, 'raydium');
    assert.equal(result.plans[0].sellPlatform, 'jupiter');
    assert.ok(result.plans[0].expectedNetUsd > 0);

    const formatted = formatVenueArbitrageScanResult(result);
    assert.ok(formatted.includes('Buy raydium'));
    assert.ok(formatted.includes('Sell jupiter'));
    assert.ok(!formatted.includes('NaN'));
    assert.ok(!formatted.includes('undefined'));
  });

  it('picks pumpswap as the cheapest venue among three solana AMMs', async () => {
    const result = await scanVenueArbitrage(
      {
        family: 'solana',
        baseToken: 'SOL',
        quoteToken: 'USDC',
        quoteSize: 1000,
        venues: ['jupiter', 'raydium', 'pumpswap'],
      },
      solanaOverrides
    );

    assert.equal(result.quotes.length, 3);
    assert.equal(result.skipped.length, 0);
    assert.ok(result.plans.length >= 1);
    assert.equal(result.plans[0].buyPlatform, 'pumpswap');
    assert.equal(result.plans[0].sellPlatform, 'jupiter');

    const formatted = formatVenueArbitrageScanResult(result);
    assert.ok(formatted.includes('pumpswap'));
    assert.ok(!formatted.includes('NaN'));
  });

  it('routes a failing venue into skipped without dropping the rest', async () => {
    const result = await scanVenueArbitrage(
      {
        family: 'solana',
        baseToken: 'SOL',
        quoteToken: 'USDC',
        quoteSize: 1000,
        venues: ['jupiter', 'orca'],
      },
      solanaOverrides // selectBestPool resolves null -> orca quote throws
    );

    assert.equal(result.quotes.length, 1);
    assert.equal(result.quotes[0].quote.platform, 'jupiter');
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].venue, 'orca');
    assert.match(result.skipped[0].reason, /No Orca pool found/);
  });
});

describe('scanVenueArbitrage (evm)', () => {
  const evmOverrides = {
    getUniswapQuote: async ({ inputToken, amount }: { inputToken: string; amount: string }) => {
      const isBuyLeg = inputToken === 'USDC';
      const amt = Number(amount);
      const out = isBuyLeg ? amt / 3000 : amt * 2990; // ask ~3000, bid ~2990
      return {
        inputToken,
        outputToken: isBuyLeg ? 'WETH' : 'USDC',
        inputAmount: amount,
        outputAmount: String(out),
        outputAmountMin: String(out),
        priceImpact: 0.1,
        route: [inputToken, isBuyLeg ? 'WETH' : 'USDC'],
        gasEstimate: '150000',
        feeTier: 3000,
      };
    },
    getLighterMarkets: async (): Promise<LighterMarket[]> => [
      {
        id: 'WETH-USDC',
        name: 'WETH-USDC',
        baseToken: 'WETH',
        quoteToken: 'USDC',
        basePrecision: 6,
        quotePrecision: 2,
        minOrderSize: '0.001',
        status: 'active',
        marketType: 'spot',
      },
    ],
    getLighterOrderbook: async (): Promise<LighterOrderbook> => ({
      market: 'WETH-USDC',
      bids: [{ price: 3050, size: 5 }],
      asks: [{ price: 3060, size: 5 }], // richer venue: ask 3060, bid 3050
    }),
  };

  it('finds a crossed plan between uniswap and lighter on arbitrum', async () => {
    const result = await scanVenueArbitrage(
      {
        family: 'evm',
        chain: 'arbitrum',
        baseToken: 'WETH',
        quoteToken: 'USDC',
        quoteSize: 2000,
        venues: ['uniswap', 'lighter'],
      },
      evmOverrides
    );

    assert.equal(result.quotes.length, 2);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.plans.length, 1);
    assert.equal(result.plans[0].buyPlatform, 'uniswap');
    assert.equal(result.plans[0].sellPlatform, 'lighter');
  });

  it('rejects lighter quoting outside arbitrum', async () => {
    const result = await scanVenueArbitrage(
      {
        family: 'evm',
        chain: 'base',
        baseToken: 'WETH',
        quoteToken: 'USDC',
        quoteSize: 2000,
        venues: ['lighter'],
      },
      evmOverrides
    );

    assert.equal(result.quotes.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0].reason, /only available on Arbitrum/);
  });
});

describe('scanVenueArbitrage (cross-chain)', () => {
  it('combines solana and evm legs and flags the pre-positioned inventory assumption', async () => {
    const result = await scanVenueArbitrage(
      {
        family: 'cross',
        chain: 'base',
        baseToken: 'SOL',
        quoteToken: 'USDC',
        quoteSize: 500,
        solanaVenues: ['jupiter'],
        evmVenues: ['uniswap'],
      },
      {
        getTokenList: async () => [{ address: 'USDC_MINT', symbol: 'USDC', decimals: 6 }],
        getSolanaConnection: () => FAKE_CONNECTION,
        getJupiterQuote: async ({ inputMint, amount }: { inputMint: string; amount: string }) => {
          const isBuyLeg = inputMint === 'USDC_MINT';
          const amt = Number(amount) / 10 ** (isBuyLeg ? 6 : 9);
          const out = isBuyLeg ? amt / 150 : amt * 149.5;
          return {
            inputMint,
            outputMint: isBuyLeg ? 'SOL' : 'USDC_MINT',
            inAmount: amount,
            outAmount: String(Math.floor(out * 10 ** (isBuyLeg ? 9 : 6))),
            priceImpactPct: '0.01',
            routePlan: [{ swapInfo: { label: 'Jupiter' } }],
            otherAmountThreshold: amount,
            swapMode: 'ExactIn',
            slippageBps: 50,
          };
        },
        getUniswapQuote: async ({ inputToken, amount }: { inputToken: string; amount: string }) => {
          const isBuyLeg = inputToken === 'USDC';
          const amt = Number(amount);
          const out = isBuyLeg ? amt / 150 : amt * 149.5;
          return {
            inputToken,
            outputToken: isBuyLeg ? 'SOL' : 'USDC',
            inputAmount: amount,
            outputAmount: String(out),
            outputAmountMin: String(out),
            priceImpact: 0.1,
            route: [inputToken],
            gasEstimate: '100000',
            feeTier: 500,
          };
        },
      }
    );

    assert.equal(result.quotes.length, 2);
    assert.equal(result.skipped.length, 0);
    assert.ok(result.warnings.some((w) => w.includes('pre-positioned inventory')));
  });
});
