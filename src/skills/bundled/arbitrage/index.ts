/**
 * Arbitrage CLI Skill
 *
 * Commands:
 * /arb start - Start arbitrage monitoring
 * /arb stop - Stop monitoring
 * /arb status - Check monitoring status
 * /arb check [query] - Run one-time scan
 * /arb compare <market-a> <market-b> - Compare two markets
 * /arb opportunities - List current opportunities
 * /arb link <market-a> <market-b> - Manually link markets
 * /arb unlink <match-id> - Remove link
 * /arb links - View all links
 * /arb auto-match <query> - Auto-detect matches
 * /arb stats - Arbitrage statistics
 */

import {
  createArbitrageService,
  type ArbitrageService,
  type PriceProvider,
} from '../../../arbitrage/index';
import { logger } from '../../../utils/logger';
import type { Platform } from '../../../types';
import { formatHelp } from '../../help.js';
import { wrapSkillError } from '../../errors.js';

let arbService: ArbitrageService | null = null;

function getService(): ArbitrageService {
  if (!arbService) {
    const providers = new Map() as Map<any, PriceProvider>;
    // Providers are registered dynamically by the arbitrage service
    // based on available feed configurations
    arbService = createArbitrageService(providers);
    logger.info({ providerCount: providers.size }, 'Arbitrage service initialized');
  }
  return arbService;
}

async function handleStart(): Promise<string> {
  const service = getService();
  service.start();
  return 'Arbitrage monitoring started.';
}

async function handleStop(): Promise<string> {
  const service = getService();
  service.stop();
  return 'Arbitrage monitoring stopped.';
}

async function handleStatus(): Promise<string> {
  const service = getService();
  const stats = service.getStats();
  return `**Arbitrage Status**\n\n` +
    `Matched market pairs: ${stats.matchCount}\n` +
    `Active opportunities: ${stats.activeOpportunities}\n` +
    `Average spread: ${stats.avgSpread.toFixed(2)}%\n` +
    `Platforms: ${stats.platforms.join(', ')}`;
}

async function handleCheck(query: string): Promise<string> {
  const service = getService();
  try {
    const opps = await service.checkArbitrage();
    if (opps.length === 0) {
      return 'No new arbitrage opportunities found.';
    }

    let output = `**Found ${opps.length} Arbitrage Opportunities**\n\n`;
    for (const opp of opps.slice(0, 10)) {
      output += `**${opp.spreadPct.toFixed(1)}% spread**\n`;
      output += `  Buy on ${opp.buyPlatform}: $${opp.buyPrice.toFixed(3)}\n`;
      output += `  Sell on ${opp.sellPlatform}: $${opp.sellPrice.toFixed(3)}\n`;
      output += `  Profit per $100: $${opp.profitPer100.toFixed(2)}\n\n`;
    }
    return output;
  } catch (error) {
    return `Error checking arbitrage: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCompare(marketA: string, marketB: string): Promise<string> {
  const service = getService();

  // Parse platform:id format
  const VALID_PLATFORMS: Platform[] = ['polymarket', 'kalshi', 'manifold', 'metaculus', 'drift', 'predictit', 'predictfun', 'betfair', 'smarkets', 'opinion', 'virtuals', 'hedgehog', 'hyperliquid', 'binance', 'bybit', 'mexc'];
  const parseMarket = (m: string): { platform: Platform; id: string } | null => {
    const parts = m.split(':');
    if (parts.length === 2) {
      if (!VALID_PLATFORMS.includes(parts[0] as Platform)) return null;
      return { platform: parts[0] as Platform, id: parts[1] };
    }
    return { platform: 'polymarket', id: m };
  };

  const a = parseMarket(marketA);
  const b = parseMarket(marketB);
  if (!a) return `Unknown platform in "${marketA}". Use format: platform:id (e.g., kalshi:MARKET_ID)`;
  if (!b) return `Unknown platform in "${marketB}". Use format: platform:id (e.g., polymarket:MARKET_ID)`;

  try {
    const result = await service.compareMarkets(a.platform, a.id, b.platform, b.id);
    if (!result) {
      return 'No arbitrage found between these markets.';
    }

    return `**Market Comparison**\n\n` +
      `Spread: ${result.spreadPct.toFixed(2)}%\n` +
      `Buy on ${result.buyPlatform}: $${result.buyPrice.toFixed(3)}\n` +
      `Sell on ${result.sellPlatform}: $${result.sellPrice.toFixed(3)}\n` +
      `Profit per $100: $${result.profitPer100.toFixed(2)}\n` +
      `Confidence: ${(result.confidence * 100).toFixed(0)}%`;
  } catch (error) {
    return `Error comparing markets: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOpportunities(): Promise<string> {
  const service = getService();
  return service.formatOpportunities();
}

async function handleLinks(): Promise<string> {
  const service = getService();
  const matches = service.getMatches();

  if (matches.length === 0) {
    return 'No linked market pairs.';
  }

  let output = `**Linked Markets** (${matches.length})\n\n`;
  for (const match of matches) {
    output += `ID: \`${match.id}\`\n`;
    output += `  Similarity: ${(match.similarity * 100).toFixed(0)}%\n`;
    output += `  Matched by: ${match.matchedBy}\n`;
    for (const m of match.markets) {
      output += `  - ${m.platform}: ${m.question}\n`;
    }
    output += '\n';
  }
  return output;
}

async function handleLink(marketA: string, marketB: string): Promise<string> {
  const service = getService();

  const parseMarket = (m: string) => {
    const parts = m.split(':');
    if (parts.length === 2) {
      return { platform: parts[0] as Platform, marketId: parts[1], question: parts[1] };
    }
    return { platform: 'polymarket' as Platform, marketId: m, question: m };
  };

  const a = parseMarket(marketA);
  const b = parseMarket(marketB);

  const match = service.addMatch({
    markets: [a, b],
    similarity: 1.0,
    matchedBy: 'manual',
  });

  return `Markets linked. Match ID: \`${match.id}\``;
}

async function handleUnlink(matchId: string): Promise<string> {
  const service = getService();
  const success = service.removeMatch(matchId);
  return success
    ? `Match \`${matchId}\` removed.`
    : `Match \`${matchId}\` not found.`;
}

async function handleAutoMatch(query: string): Promise<string> {
  const service = getService();
  try {
    const matches = await service.autoMatchMarkets(query);
    if (matches.length === 0) {
      return 'No matching markets found across platforms.';
    }

    let output = `**Auto-Matched ${matches.length} Market Pairs**\n\n`;
    for (const match of matches) {
      output += `Similarity: ${(match.similarity * 100).toFixed(0)}%\n`;
      for (const m of match.markets) {
        output += `  - ${m.platform}: ${m.question}\n`;
      }
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error auto-matching: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleStats(): Promise<string> {
  const service = getService();
  const stats = service.getStats();

  return `**Arbitrage Statistics**\n\n` +
    `Linked market pairs: ${stats.matchCount}\n` +
    `Active opportunities: ${stats.activeOpportunities}\n` +
    `Average spread: ${stats.avgSpread.toFixed(2)}%\n` +
    `Monitored platforms: ${stats.platforms.join(', ')}`;
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  try {
    switch (cmd) {
      case 'start':
        return handleStart();

      case 'stop':
        return handleStop();

      case 'status':
        return handleStatus();

      case 'check':
      case 'scan':
        return handleCheck(rest.join(' '));

      case 'compare':
        if (rest.length < 2) return 'Usage: /arb compare <market-a> <market-b>';
        return handleCompare(rest[0], rest[1]);

      case 'opportunities':
      case 'opps':
        return handleOpportunities();

      case 'link':
        if (rest.length < 2) return 'Usage: /arb link <market-a> <market-b>';
        return handleLink(rest[0], rest[1]);

      case 'unlink':
        if (!rest[0]) return 'Usage: /arb unlink <match-id>';
        return handleUnlink(rest[0]);

      case 'links':
      case 'matches':
        return handleLinks();

      case 'auto-match':
      case 'automatch':
        if (!rest[0]) return 'Usage: /arb auto-match <query>';
        return handleAutoMatch(rest.join(' '));

      case 'stats':
        return handleStats();

      case 'help':
      default:
        return formatHelp({
          name: 'Arbitrage',
          description: 'Automated cross-platform arbitrage detection and monitoring',
          sections: [
            {
              title: 'Monitoring',
              commands: [
                { cmd: '/arb start', description: 'Start monitoring' },
                { cmd: '/arb stop', description: 'Stop monitoring' },
                { cmd: '/arb status', description: 'Check status' },
              ],
            },
            {
              title: 'Scanning',
              commands: [
                { cmd: '/arb check [query]', description: 'One-time scan' },
                { cmd: '/arb compare <market-a> <market-b>', description: 'Compare two markets' },
                { cmd: '/arb opportunities', description: 'List opportunities' },
              ],
            },
            {
              title: 'Market Linking',
              commands: [
                { cmd: '/arb link <market-a> <market-b>', description: 'Link markets manually' },
                { cmd: '/arb unlink <match-id>', description: 'Remove link' },
                { cmd: '/arb links', description: 'View all links' },
                { cmd: '/arb auto-match <query>', description: 'Auto-detect matches' },
              ],
            },
            {
              title: 'Statistics',
              commands: [
                { cmd: '/arb stats', description: 'View statistics' },
              ],
            },
          ],
          examples: [
            '/arb check "trump election"',
            '/arb compare poly:12345 kalshi:TRUMP',
            '/arb link poly:abc123 kalshi:XYZ',
          ],
          seeAlso: [
            { cmd: '/poly', description: 'Polymarket trading' },
            { cmd: '/bf', description: 'Betfair trading' },
            { cmd: '/feeds', description: 'Market data feeds' },
            { cmd: '/signals', description: 'Trading signals' },
          ],
          notes: [
            'Shortcuts: scan = check, opps = opportunities, matches = links, automatch = auto-match',
          ],
        });
    }
  } catch (error) {
    return wrapSkillError('Arbitrage', cmd || 'command', error);
  }
}

export default {
  name: 'arbitrage',
  description: 'Automated cross-platform arbitrage detection and monitoring',
  commands: ['/arbitrage', '/arb'],
  handle: execute,
};
