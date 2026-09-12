import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateSwapNotionalUsd } from '../../src/agents/handlers/solana';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('Solana swap notional valuation', () => {
  it('values USDC inputs directly from base units', async () => {
    const quote = async () => {
      throw new Error('quote should not be called');
    };

    const notional = await estimateSwapNotionalUsd(quote, {
      inputMint: USDC_MINT,
      amount: '501000000',
    });

    assert.equal(notional, 501);
  });

  it('values non-USDC inputs through a Jupiter USDC quote', async () => {
    const quote = async () => ({ inAmount: '1000000000', outAmount: '125500000' });

    const notional = await estimateSwapNotionalUsd(quote, {
      inputMint: 'So11111111111111111111111111111111111111112',
      amount: '1000000000',
    });

    assert.equal(notional, 125.5);
  });

  it('resolves the required input before valuing exact-output swaps', async () => {
    const calls: Array<{ swapMode?: 'ExactIn' | 'ExactOut'; amount: string }> = [];
    const quote = async (params: { swapMode?: 'ExactIn' | 'ExactOut'; amount: string }) => {
      calls.push(params);
      return params.swapMode === 'ExactOut'
        ? { inAmount: '2000000000', outAmount: params.amount }
        : { inAmount: params.amount, outAmount: '250000000' };
    };

    const notional = await estimateSwapNotionalUsd(quote, {
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'output-mint',
      amount: '5000000',
      exactOutput: true,
    });

    assert.equal(notional, 250);
    assert.deepEqual(calls.map(call => call.swapMode), ['ExactOut', 'ExactIn']);
    assert.equal(calls[1].amount, '2000000000');
  });
});
