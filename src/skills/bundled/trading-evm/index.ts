/**
 * Trading EVM CLI Skill
 *
 * Commands:
 * /trading-evm swap <token> <amount> - Swap via DEX aggregator
 * /trading-evm balance [chain] - Check balances
 * /trading-evm transfer <to> <amount> <token> - Transfer tokens
 * /trading-evm wallet - Wallet info
 * /trading-evm chains - Supported chains
 * /trading-evm approve <token> <spender> - Token approval
 */

import { formatHelp } from '../../help.js';
import { wrapSkillError } from '../../errors.js';

function helpText(): string {
  return formatHelp({
    name: 'EVM Trading',
    description: 'DEX swaps, transfers, and multi-chain balances on EVM chains.',
    sections: [
      {
        title: 'Trading',
        commands: [
          { cmd: '/trading-evm swap <token> <amount> [--chain <chain>]', description: 'DEX swap (Odos/1inch/Uniswap)' },
          { cmd: '/trading-evm approve <token> <spender>', description: 'Token approval' },
        ],
      },
      {
        title: 'Account',
        commands: [
          { cmd: '/trading-evm balance [chain]', description: 'Check balances (single chain or all)' },
          { cmd: '/trading-evm transfer <to> <amount> [token]', description: 'Transfer tokens' },
          { cmd: '/trading-evm wallet', description: 'Wallet info' },
          { cmd: '/trading-evm chains', description: 'Supported chains' },
        ],
      },
    ],
    examples: [
      '/trading-evm swap 0xA0b8...3E8 1.5 --chain polygon',
      '/trading-evm balance all',
      '/trading-evm transfer 0xDEAD...BEEF 0.1 ETH',
    ],
    envVars: [
      { name: 'EVM_PRIVATE_KEY', description: 'Private key for signing transactions', required: true },
    ],
    seeAlso: [
      { cmd: '/cake', description: 'PancakeSwap trading' },
      { cmd: '/bridge', description: 'Cross-chain bridging' },
      { cmd: '/bags', description: 'Portfolio overview' },
    ],
    notes: [
      'Shortcuts: /evm-trade',
      'Supported chains: ethereum, polygon, arbitrum, optimism, base, avalanche, bsc',
    ],
  });
}

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const evmMod = await import('../../../evm/index');

    switch (cmd) {
      case 'swap': {
        const token = parts[1];
        const amount = parts[2];
        if (!token || !amount) return 'Usage: /trading-evm swap <token> <amount> [--chain <chain>]';

        // Parse --chain flag
        const chainIdx = parts.indexOf('--chain');
        const chainInput = chainIdx !== -1 ? parts[chainIdx + 1] : 'ethereum';
        const chain = evmMod.resolveChain(chainInput);
        if (!chain) return `Unknown chain: ${chainInput}. Use /trading-evm chains to see supported chains.`;

        const wallet = evmMod.getCurrentWallet();
        if (!wallet) return 'No wallet configured. Set EVM_PRIVATE_KEY env var or use wallet management.';

        // Try Odos first (best aggregator), fall back to Uniswap
        try {
          const quote = await evmMod.getOdosQuote({
            chain: chain as any,
            inputToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // native
            outputToken: token,
            amount: amount,
            userAddress: wallet.address,
          });

          const result = await evmMod.executeOdosSwap({
            chain: chain as any,
            inputToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            outputToken: token,
            amount: amount,
            userAddress: wallet.address,
            privateKey: process.env.EVM_PRIVATE_KEY || '',
            maxSlippageBps: 100,
          });

          return `**Swap Executed via Odos**

Input: ${amount} (native)
Output: ${result.outputAmount}
Tx: ${result.txHash || 'N/A'}`;
        } catch {
          // Fallback to Uniswap
          try {
            const resolved = evmMod.resolveToken(token, chain as any);
            const uniQuote = await evmMod.getUniswapQuote({
              chain: chain as any,
              inputToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
              outputToken: resolved || token,
              amount: amount,
            });

            return `**Uniswap Quote**

Input: ${amount} (native)
Output: ~${uniQuote.outputAmount}
Price Impact: ${uniQuote.priceImpact}%
Route: ${uniQuote.route?.join(' -> ') || 'direct'}

To execute, confirm swap parameters.`;
          } catch (uniErr: any) {
            return `Swap routing failed. Odos and Uniswap both errored.\n\nError: ${uniErr?.message || 'Unknown error'}`;
          }
        }
      }

      case 'balance':
      case 'balances': {
        const chainInput = parts[1] || 'all';
        const wallet = evmMod.getCurrentWallet();
        if (!wallet) return 'No wallet configured. Set EVM_PRIVATE_KEY env var.';

        if (chainInput === 'all') {
          const multiBalance = await evmMod.getMultiChainBalances(wallet.address);
          const lines: string[] = ['**Multi-Chain Balances**', `Wallet: ${wallet.address}`, ''];

          for (const cb of multiBalance.balances) {
            if (cb.native && parseFloat(cb.native.balance) > 0) {
              lines.push(`**${cb.chainName}**: ${cb.native.balance} ${cb.native.symbol}`);
            }
            for (const tok of cb.tokens) {
              if (parseFloat(tok.balance) > 0) {
                lines.push(`  ${tok.symbol}: ${tok.balance}`);
              }
            }
          }

          if (lines.length <= 3) lines.push('No balances found across any chain.');
          return lines.join('\n');
        }

        const chain = evmMod.resolveChain(chainInput);
        if (!chain) return `Unknown chain: ${chainInput}. Use /trading-evm chains to see supported chains.`;

        const chainBal = await evmMod.getChainBalances(chain, wallet.address);
        const lines: string[] = [
          `**${chain} Balances**`,
          `Wallet: ${wallet.address}`,
          '',
          `Native: ${chainBal.native.balance} ${chainBal.native.symbol}`,
        ];

        if (chainBal.tokens.length > 0) {
          lines.push('', '**Tokens:**');
          for (const tok of chainBal.tokens) {
            if (parseFloat(tok.balance) > 0) {
              lines.push(`  ${tok.symbol}: ${tok.balance}`);
            }
          }
        }

        return lines.join('\n');
      }

      case 'transfer':
      case 'send': {
        const to = parts[1];
        const amount = parts[2];
        const token = parts[3];
        if (!to || !amount) return 'Usage: /trading-evm transfer <to-address> <amount> [token]';

        if (!evmMod.validateAddress(to)) return `Invalid address: ${to}`;
        if (!evmMod.validateAmount(amount)) return `Invalid amount: ${amount}`;

        const wallet = evmMod.getCurrentWallet();
        if (!wallet) return 'No wallet configured. Set EVM_PRIVATE_KEY env var.';

        // Parse --chain flag
        const chainIdx = parts.indexOf('--chain');
        const chainInput = chainIdx !== -1 ? parts[chainIdx + 1] : 'ethereum';
        const chain = evmMod.resolveChain(chainInput);
        if (!chain) return `Unknown chain: ${chainInput}`;

        if (!token || token.toLowerCase() === 'eth' || token.toLowerCase() === 'native') {
          // Native transfer
          const result = await evmMod.sendNative({
            chain: chain as any,
            to,
            amount,
            privateKey: process.env.EVM_PRIVATE_KEY || '',
          });

          return `**Transfer ${result.success ? 'Sent' : 'Failed'}**

From: ${result.from}
To: ${result.to}
Amount: ${result.amount} (native)
Tx: ${result.txHash || 'N/A'}${result.error ? `\nError: ${result.error}` : ''}`;
        } else {
          // Token transfer
          const result = await evmMod.sendToken({
            chain: chain as any,
            to,
            amount,
            privateKey: process.env.EVM_PRIVATE_KEY || '',
            tokenAddress: token,
          });

          return `**Token Transfer ${result.success ? 'Sent' : 'Failed'}**

From: ${result.from}
To: ${result.to}
Token: ${result.token || token}
Amount: ${result.amount}
Tx: ${result.txHash || 'N/A'}${result.error ? `\nError: ${result.error}` : ''}`;
        }
      }

      case 'wallet': {
        const wallet = evmMod.getCurrentWallet();
        if (!wallet) return 'No wallet configured. Set EVM_PRIVATE_KEY env var or generate one.';

        const savedWallets = evmMod.listWallets();
        const lines = [
          '**EVM Wallet Info**',
          '',
          `Address: ${wallet.address}`,
          '',
        ];

        if (savedWallets.length > 0) {
          lines.push('**Saved Wallets:**');
          for (const w of savedWallets) {
            const marker = w.address.toLowerCase() === wallet.address.toLowerCase() ? ' (active)' : '';
            lines.push(`  ${w.name}: ${w.address}${marker}`);
          }
        }

        return lines.join('\n');
      }

      case 'chains': {
        const supported = evmMod.getSupportedChains();
        const lines = ['**Supported Chains**', ''];
        for (const chain of supported) {
          const config = evmMod.getChainConfig(chain);
          lines.push(`  ${chain} (chainId: ${config.chainId}) - ${config.name}`);
          lines.push(`    Explorer: ${config.explorer}`);
        }
        return lines.join('\n');
      }

      case 'approve': {
        const tokenAddress = parts[1];
        const spender = parts[2];
        if (!tokenAddress || !spender) return 'Usage: /trading-evm approve <token-address> <spender-address>';

        if (!evmMod.validateAddress(tokenAddress)) return `Invalid token address: ${tokenAddress}`;
        if (!evmMod.validateAddress(spender)) return `Invalid spender address: ${spender}`;

        const wallet = evmMod.getCurrentWallet();
        if (!wallet) return 'No wallet configured. Set EVM_PRIVATE_KEY env var.';

        const chainIdx = parts.indexOf('--chain');
        const chainInput = chainIdx !== -1 ? parts[chainIdx + 1] : 'ethereum';
        const chain = evmMod.resolveChain(chainInput);
        if (!chain) return `Unknown chain: ${chainInput}`;

        const maxUint256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

        const result = await evmMod.writeContract({
          chain: chain as any,
          contractAddress: tokenAddress,
          abi: evmMod.COMMON_ABIS.erc20,
          method: 'approve',
          args: [spender, maxUint256],
          privateKey: process.env.EVM_PRIVATE_KEY || '',
        });

        return `**Approval ${result.success ? 'Sent' : 'Failed'}**

Token: ${tokenAddress}
Spender: ${spender}
Amount: MAX (unlimited)
Tx: ${result.txHash || 'N/A'}${result.error ? `\nError: ${result.error}` : ''}`;
      }

      default:
        return helpText();
    }
  } catch (err: any) {
    if (cmd === 'help' || cmd === '') return helpText();
    return wrapSkillError('EVM Trading', cmd || 'command', err);
  }
}

export default {
  name: 'trading-evm',
  description: 'EVM trading - DEX swaps, transfers, multi-chain balances',
  commands: ['/trading-evm', '/evm-trade'],
  handle: execute,
};
