/**
 * PancakeSwap Skill
 *
 * CLI commands for PancakeSwap V3 multi-chain DEX.
 */

import type { PancakeChain } from '../../../evm/pancakeswap.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// HELPERS
// =============================================================================

function formatNumber(n: number, decimals = 4): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(decimals);
}

function parseChainFlag(args: string[]): { chain: PancakeChain; cleanArgs: string[] } {
  const chainIdx = args.indexOf('--chain');
  if (chainIdx === -1) {
    return { chain: 'bsc', cleanArgs: args };
  }

  const chainMap: Record<string, PancakeChain> = {
    bsc: 'bsc',
    bnb: 'bsc',
    eth: 'ethereum',
    ethereum: 'ethereum',
    arb: 'arbitrum',
    arbitrum: 'arbitrum',
    base: 'base',
  };

  const chainArg = args[chainIdx + 1]?.toLowerCase() || 'bsc';
  const chain = chainMap[chainArg] || 'bsc';
  const cleanArgs = [...args.slice(0, chainIdx), ...args.slice(chainIdx + 2)];

  return { chain, cleanArgs };
}

// =============================================================================
// HANDLERS
// =============================================================================

async function handleSwap(args: string[]): Promise<string> {
  const { chain, cleanArgs } = parseChainFlag(args);
  const [from, to, amount] = cleanArgs;

  if (!from || !to || !amount) {
    return 'Usage: /cake swap <from> <to> <amount> [--chain bsc]\nExample: /cake swap BNB USDT 1';
  }

  try {
    const { pancakeSwap } = await import('../../../evm/pancakeswap.js');
    const result = await pancakeSwap({
      chain,
      inputToken: from,
      outputToken: to,
      amount,
    });

    if (result.success) {
      return [
        `**PancakeSwap Swap (${chain})**`,
        '',
        `Swapped: ${amount} ${from.toUpperCase()}`,
        `Received: ${result.outputAmount} ${to.toUpperCase()}`,
        `TX: ${result.txHash}`,
        `Gas: ${result.gasUsed}`,
      ].join('\n');
    }

    return `Swap failed: ${result.error}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Swap failed: ${message}`;
  }
}

async function handleQuote(args: string[]): Promise<string> {
  const { chain, cleanArgs } = parseChainFlag(args);
  const [from, to, amount] = cleanArgs;

  if (!from || !to || !amount) {
    return 'Usage: /cake quote <from> <to> <amount> [--chain bsc]\nExample: /cake quote BNB USDT 1';
  }

  try {
    const { pancakeQuote } = await import('../../../evm/pancakeswap.js');
    const quote = await pancakeQuote({
      chain,
      inputToken: from,
      outputToken: to,
      amount,
    });

    return [
      `**PancakeSwap Quote (${chain})**`,
      '',
      `Input: ${amount} ${from.toUpperCase()}`,
      `Output: ${formatNumber(parseFloat(quote.outputAmount))} ${to.toUpperCase()}`,
      `Min Output: ${formatNumber(parseFloat(quote.outputAmountMin))} (0.5% slippage)`,
      `Fee Tier: ${(quote.feeTier || 0) / 10000}%`,
      quote.gasEstimate ? `Gas Est: ${quote.gasEstimate}` : '',
    ].filter(Boolean).join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Quote failed: ${message}`;
  }
}

async function handlePrice(args: string[]): Promise<string> {
  const { chain, cleanArgs } = parseChainFlag(args);
  const [tokenA, tokenB] = cleanArgs;

  if (!tokenA || !tokenB) {
    return 'Usage: /cake price <tokenA> <tokenB> [--chain bsc]\nExample: /cake price CAKE USDT';
  }

  try {
    const { pancakeGetPrice } = await import('../../../evm/pancakeswap.js');
    const result = await pancakeGetPrice(chain, tokenA, tokenB);

    return [
      `**${tokenA.toUpperCase()}/${tokenB.toUpperCase()} (${chain})**`,
      '',
      `1 ${tokenA.toUpperCase()} = ${formatNumber(result.price)} ${tokenB.toUpperCase()}`,
      `1 ${tokenB.toUpperCase()} = ${formatNumber(result.invertedPrice)} ${tokenA.toUpperCase()}`,
    ].join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Price lookup failed: ${message}`;
  }
}

async function handleBalance(args: string[]): Promise<string> {
  const { chain, cleanArgs } = parseChainFlag(args);
  const [token] = cleanArgs;

  if (!token) {
    return 'Usage: /cake balance <token> [--chain bsc]\nExample: /cake balance CAKE';
  }

  try {
    const { pancakeGetBalance } = await import('../../../evm/pancakeswap.js');
    const balance = await pancakeGetBalance(token, chain);

    return `**${token.toUpperCase()} Balance (${chain}):** ${formatNumber(parseFloat(balance))}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Balance check failed: ${message}`;
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const skill = {
  name: 'pancakeswap',
  description: 'PancakeSwap multi-chain DEX (BNB Chain, ETH, ARB, Base)',
  commands: [
    {
      name: 'cake',
      description: 'PancakeSwap commands',
      usage: '/cake <command>',
    },
  ],
  requires: { env: ['EVM_PRIVATE_KEY'] },

  async handler(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    try {
      switch (cmd) {
        case 'swap':
          return handleSwap(parts.slice(1));
        case 'quote':
        case 'q':
          return handleQuote(parts.slice(1));
        case 'price':
        case 'p':
          return handlePrice(parts.slice(1));
        case 'balance':
        case 'bal':
        case 'b':
          return handleBalance(parts.slice(1));

        case 'help':
        case '':
        case undefined:
        default:
          return [
            '**PancakeSwap Commands**',
            '',
            '  /cake swap <from> <to> <amt> [--chain bsc]',
            '  /cake quote <from> <to> <amt> [--chain bsc]',
            '  /cake price <tokenA> <tokenB> [--chain bsc]',
            '  /cake balance <token> [--chain bsc]',
            '',
            '**Chains:** bsc (default), eth, arb, base',
            '',
            '**Examples:**',
            '  /cake swap BNB USDT 1',
            '  /cake quote CAKE USDT 100 --chain eth',
            '  /cake price WETH USDC --chain arb',
          ].join('\n');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, args }, 'PancakeSwap command failed');
      return `Error: ${message}`;
    }
  },
};

export default skill;
