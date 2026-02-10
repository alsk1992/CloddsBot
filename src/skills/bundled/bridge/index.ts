/**
 * Bridge CLI Skill
 *
 * Commands:
 * /bridge <amount> <token> from <chain> to <chain> - Bridge tokens
 * /bridge quote <amount> <token> from <chain> to <chain> - Get quote
 * /bridge status <txHash> - Check bridge status
 * /bridge routes <token> - Show available routes
 */

import { formatHelp } from '../../help.js';
import { wrapSkillError } from '../../errors.js';

// Resolve destination address from env (same wallet as source)
function getDestinationAddress(): string {
  // For EVM chains, use EVM_PRIVATE_KEY-derived address
  const evmKey = process.env.EVM_PRIVATE_KEY;
  if (evmKey) {
    try {
      const { Wallet } = require('ethers') as typeof import('ethers');
      return new Wallet(evmKey).address;
    } catch { /* fall through */ }
  }
  // For Solana, use SOLANA_WALLET_ADDRESS or derive from key
  const solAddr = process.env.SOLANA_WALLET_ADDRESS;
  if (solAddr) return solAddr;
  return '';
}

// Map common token symbols to wormhole token addresses per chain
function resolveTokenForBridge(symbol: string, chain: string): string | undefined {
  const tokens: Record<string, Record<string, string>> = {
    USDC: {
      ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    },
    USDT: {
      ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    },
    WETH: {
      ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      optimism: '0x4200000000000000000000000000000000000006',
      base: '0x4200000000000000000000000000000000000006',
    },
  };
  return tokens[symbol.toUpperCase()]?.[chain.toLowerCase()];
}

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const wormhole = await import('../../../bridge/wormhole');

    switch (cmd) {
      case 'quote': {
        // /bridge quote 100 USDC from ethereum to base
        const amount = parseFloat(parts[1] || '');
        if (isNaN(amount) || parts.length < 7) {
          return 'Usage: /bridge quote <amount> <token> from <chain> to <chain>';
        }
        const token = parts[2]?.toUpperCase();
        const fromChain = parts[4];
        const toChain = parts[6];

        const destAddr = getDestinationAddress();
        if (!destAddr) return 'No wallet configured. Set EVM_PRIVATE_KEY or SOLANA_WALLET_ADDRESS.';
        const tokenAddress = resolveTokenForBridge(token, fromChain);
        if (!tokenAddress) {
          return `Token ${token} not found on ${fromChain}. Supported: USDC, USDT, WETH`;
        }

        const quote: any = await wormhole.wormholeQuote({
          source_chain: fromChain,
          destination_chain: toChain,
          destination_address: destAddr,
          token_address: tokenAddress,
          amount: amount.toString(),
          amount_units: 'human',
        });

        let output = `**Bridge Quote: ${amount} ${token}**\n\n`;
        output += `From: ${fromChain}\nTo: ${toChain}\n`;
        output += `Protocol: ${quote.protocol || 'Wormhole'}\n`;
        if (quote.relayerFee) output += `Relayer fee: ${quote.relayerFee}\n`;
        if (quote.estimatedTime) output += `Estimated time: ${quote.estimatedTime}\n`;
        return output;
      }

      case 'usdc': {
        // /bridge usdc 100 from ethereum to base
        const amount = parseFloat(parts[1] || '');
        if (isNaN(amount) || parts.length < 6) {
          return 'Usage: /bridge usdc <amount> from <chain> to <chain>';
        }
        const fromChain = parts[3];
        const toChain = parts[5];

        const destAddr = getDestinationAddress();
        if (!destAddr) return 'No wallet configured. Set EVM_PRIVATE_KEY or SOLANA_WALLET_ADDRESS.';

        const quote: any = await wormhole.usdcQuoteAuto({
          source_chain: fromChain,
          destination_chain: toChain,
          destination_address: destAddr,
          amount: amount.toString(),
          amount_units: 'human',
        });

        let output = `**USDC Bridge Quote (CCTP)**\n\n`;
        output += `Amount: ${amount} USDC\n`;
        output += `From: ${fromChain}\nTo: ${toChain}\n`;
        output += `Protocol: CCTP (Circle)\n`;
        if (quote.relayerFee) output += `Fee: ${quote.relayerFee}\n`;
        return output;
      }

      case 'redeem': {
        if (!parts[1]) return 'Usage: /bridge redeem <source-txid> --from <chain> --to <chain>';
        const txid = parts[1];
        const fromIdx = parts.indexOf('--from');
        const toIdx = parts.indexOf('--to');
        const fromChain = fromIdx >= 0 ? parts[fromIdx + 1] : '';
        const toChain = toIdx >= 0 ? parts[toIdx + 1] : '';
        if (!fromChain || !toChain) return 'Usage: /bridge redeem <source-txid> --from <chain> --to <chain>';

        const result: any = await wormhole.wormholeRedeem({
          source_chain: fromChain,
          destination_chain: toChain,
          source_txid: txid,
        });

        return `**Bridge Redeem**\n\nSource TX: \`${txid}\`\nFrom: ${fromChain}\nTo: ${toChain}\nStatus: ${result.status || 'submitted'}`;
      }

      case 'status': {
        if (!parts[1]) return 'Usage: /bridge status <txHash>';
        const txHash = parts[1];

        // Query Wormholescan public API for transfer status
        const resp = await fetch(`https://api.wormholescan.io/api/v1/operations?txHash=${txHash}`);
        if (!resp.ok) {
          return `**Bridge Status**\n\nTx: \`${txHash}\`\nCould not fetch status (HTTP ${resp.status}). Check manually: https://wormholescan.io/#/tx/${txHash}`;
        }
        const statusData: any = await resp.json();
        const ops = statusData.operations || [];
        if (ops.length === 0) {
          return `**Bridge Status**\n\nTx: \`${txHash}\`\nNo transfer found yet. It may still be processing.\nTrack: https://wormholescan.io/#/tx/${txHash}`;
        }
        const op = ops[0];
        let statusOutput = `**Bridge Status**\n\nTx: \`${txHash}\`\n`;
        statusOutput += `Status: ${op.status || 'unknown'}\n`;
        if (op.sourceChain) statusOutput += `Source: ${op.sourceChain.chainName || op.sourceChain.chainId || 'unknown'}\n`;
        if (op.targetChain) statusOutput += `Destination: ${op.targetChain.chainName || op.targetChain.chainId || 'unknown'}\n`;
        if (op.data?.tokenAmount) statusOutput += `Amount: ${op.data.tokenAmount}\n`;
        if (op.data?.symbol) statusOutput += `Token: ${op.data.symbol}\n`;
        if (op.vaa?.timestamp) statusOutput += `Timestamp: ${new Date(op.vaa.timestamp).toLocaleString()}\n`;
        statusOutput += `\nExplorer: https://wormholescan.io/#/tx/${txHash}`;
        return statusOutput;
      }

      case 'routes': {
        const token = (parts[1] || 'USDC').toUpperCase();
        // Query Wormholescan for supported chains
        try {
          const chainsResp = await fetch('https://api.wormholescan.io/api/v1/governor/available-notional-by-chain');
          if (chainsResp.ok) {
            const chainsData: any = await chainsResp.json();
            const entries = chainsData.entries || [];
            if (entries.length > 0) {
              let routeOutput = `**Bridge Routes for ${token}**\n\n`;
              routeOutput += `| Chain | Chain ID | Available Notional |\n`;
              routeOutput += `|-------|----------|--------------------|\n`;
              for (const entry of entries.slice(0, 20)) {
                const chainName = entry.chainName || `Chain ${entry.chainId}`;
                const notional = entry.remainingAvailableNotional
                  ? `$${parseFloat(entry.remainingAvailableNotional).toLocaleString()}`
                  : 'N/A';
                routeOutput += `| ${chainName} | ${entry.chainId} | ${notional} |\n`;
              }
              routeOutput += `\nProtocols: Wormhole Token Bridge, Circle CCTP (USDC)`;
              return routeOutput;
            }
          }
        } catch { /* fall through to static */ }

        // Fallback static routes if API fails
        return `**Bridge Routes for ${token}**\n\n` +
          `| From | To | Protocol | Type |\n` +
          `|------|----|----------|------|\n` +
          `| Ethereum | Base | CCTP | Native USDC |\n` +
          `| Ethereum | Polygon | Wormhole | Token Bridge |\n` +
          `| Ethereum | Solana | Wormhole | Token Bridge |\n` +
          `| Polygon | Base | CCTP | Native USDC |\n` +
          `| Solana | Ethereum | Wormhole | Token Bridge |\n` +
          `| Base | Ethereum | CCTP | Native USDC |`;
      }

      case 'help':
        return helpText();

      default: {
        // Parse: <amount> <token> from <chain> to <chain>
        const amount = parseFloat(parts[0] || '');
        if (!isNaN(amount) && parts.length >= 5) {
          const token = parts[1]?.toUpperCase();
          const fromChain = parts[3];
          const toChain = parts[5];

          const destAddr = getDestinationAddress();
          if (!destAddr) return 'No wallet configured. Set EVM_PRIVATE_KEY or SOLANA_WALLET_ADDRESS.';

          if (token === 'USDC') {
            const result: any = await wormhole.usdcBridgeAuto({
              source_chain: fromChain,
              destination_chain: toChain,
              destination_address: destAddr,
              amount: amount.toString(),
              amount_units: 'human',
            });

            return `**USDC Bridge Initiated (CCTP)**\n\n` +
              `Amount: ${amount} USDC\nFrom: ${fromChain}\nTo: ${toChain}\n` +
              `Status: ${result.status || 'submitted'}\n` +
              `TX: \`${result.sourceTxHash || 'pending'}\``;
          }

          const tokenAddress = resolveTokenForBridge(token, fromChain);
          if (!tokenAddress) {
            return `Token ${token} not found on ${fromChain}. Supported: USDC, USDT, WETH`;
          }
          const result: any = await wormhole.wormholeBridge({
            source_chain: fromChain,
            destination_chain: toChain,
            destination_address: destAddr,
            token_address: tokenAddress,
            amount: amount.toString(),
            amount_units: 'human',
          });

          return `**Bridge Initiated**\n\n` +
            `Amount: ${amount} ${token}\nFrom: ${fromChain}\nTo: ${toChain}\n` +
            `Protocol: Wormhole Token Bridge\n` +
            `Status: ${result.status || 'submitted'}`;
        }
        return helpText();
      }
    }
  } catch (error) {
    return wrapSkillError('Bridge', cmd || 'command', error);
  }
}

function helpText(): string {
  return formatHelp({
    name: 'Bridge',
    emoji: '\u{1F309}',
    description: 'Cross-chain token transfers using Wormhole and CCTP',
    sections: [
      {
        title: 'Commands',
        commands: [
          { cmd: '/bridge <amount> <token> from <chain> to <chain>', description: 'Bridge tokens' },
          { cmd: '/bridge quote <amount> <token> from <chain> to <chain>', description: 'Get quote without executing' },
          { cmd: '/bridge usdc <amount> from <chain> to <chain>', description: 'USDC via CCTP (Circle)' },
          { cmd: '/bridge redeem <txid> --from <chain> --to <chain>', description: 'Redeem a pending transfer' },
          { cmd: '/bridge status <txHash>', description: 'Check bridge transfer status' },
          { cmd: '/bridge routes [token]', description: 'Show available routes' },
        ],
      },
    ],
    examples: [
      '/bridge 100 USDC from ethereum to base',
      '/bridge quote 0.5 WETH from ethereum to arbitrum',
      '/bridge usdc 500 from polygon to base',
      '/bridge status 0xabc123...',
    ],
    envVars: [
      { name: 'EVM_PRIVATE_KEY', description: 'EVM wallet private key for signing bridge transactions', required: true },
      { name: 'SOLANA_WALLET_ADDRESS', description: 'Solana wallet address (for Solana bridging)', required: false },
    ],
    seeAlso: [
      { cmd: '/cake', description: 'DEX trading on PancakeSwap' },
      { cmd: '/trading-evm', description: 'EVM chain trading' },
      { cmd: '/bags', description: 'View token balances across chains' },
    ],
    notes: [
      'Supported chains: Ethereum, Polygon, Base, Solana, Arbitrum, Optimism',
      'Protocols: Wormhole Token Bridge, Circle CCTP',
      'Shortcut: /bridge usdc — skips token arg for USDC-specific CCTP bridging',
    ],
  });
}

export default {
  name: 'bridge',
  description: 'Cross-chain token transfers using Wormhole and CCTP',
  commands: ['/bridge'],
  handle: execute,
};
