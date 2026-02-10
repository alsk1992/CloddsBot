/**
 * AgentBets Skill
 *
 * CLI commands for AgentBets — AI-native prediction markets on Solana.
 * Built for the Colosseum Agent Hackathon.
 * https://github.com/nox-oss/agentbets
 */

import { logger } from '../../../utils/logger.js';

const API_URL = 'https://agentbets-api-production.up.railway.app';

// =============================================================================
// HELPERS
// =============================================================================

function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  return n.toFixed(decimals);
}

interface AgentBetsMarket {
  id: string;
  question: string;
  description?: string;
  outcomes: Array<{ name: string; shares: number }>;
  totalPool: number;
  status: 'open' | 'resolved' | 'disputed';
  resolutionTime: string;
  winningOutcome?: string;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// MARKET DATA
// =============================================================================

async function handleMarkets(query?: string): Promise<string> {
  try {
    const response = await fetch(`${API_URL}/markets`);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json() as { markets: AgentBetsMarket[]; count: number };
    let markets = data.markets || [];

    if (query) {
      const q = query.toLowerCase();
      markets = markets.filter(m =>
        m.question.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q)
      );
    }

    if (markets.length === 0) {
      return query ? `No AgentBets markets found for "${query}"` : 'No AgentBets markets found';
    }

    const lines = [
      '**AgentBets Markets** (Colosseum Agent Hackathon)',
      '',
    ];

    for (const m of markets.slice(0, 20)) {
      const totalShares = m.outcomes.reduce((s, o) => s + o.shares, 0) || 1;
      const priceStr = m.outcomes
        .map(o => `${o.name}: ${((o.shares / totalShares) * 100).toFixed(0)}c`)
        .join(' | ');
      lines.push(`  [${m.id}] ${m.question}`);
      lines.push(`       ${priceStr} | Pool: $${formatNumber(m.totalPool)} | ${m.status}`);
    }

    if (markets.length > 20) {
      lines.push('', `...and ${markets.length - 20} more`);
    }

    return lines.join('\n');
  } catch (err) {
    logger.error({ err }, 'AgentBets: Failed to fetch markets');
    return `Error fetching AgentBets markets: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleMarket(id: string): Promise<string> {
  if (!id) return 'Usage: /agentbets market <id>';

  try {
    const response = await fetch(`${API_URL}/markets/${id}`);
    if (!response.ok) {
      if (response.status === 404) return `Market ${id} not found`;
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as { market: AgentBetsMarket };
    const m = data.market;
    const totalShares = m.outcomes.reduce((s, o) => s + o.shares, 0) || 1;

    const lines = [
      `**${m.question}**`,
      '',
      m.description || '',
      '',
      '**Outcomes:**',
    ];

    for (const o of m.outcomes) {
      const pct = ((o.shares / totalShares) * 100).toFixed(1);
      lines.push(`  ${o.name}: ${pct}% (${o.shares} shares)`);
    }

    lines.push('');
    lines.push(`Pool: $${formatNumber(m.totalPool)}`);
    lines.push(`Status: ${m.status}`);
    lines.push(`Resolves: ${m.resolutionTime ? new Date(m.resolutionTime).toLocaleDateString() : 'TBD'}`);
    if (m.winningOutcome) lines.push(`Winner: ${m.winningOutcome}`);
    lines.push('');
    lines.push(`Platform: AgentBets (Colosseum Agent Hackathon)`);
    lines.push(`https://github.com/nox-oss/agentbets`);

    return lines.join('\n');
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleOpportunities(): Promise<string> {
  try {
    const response = await fetch(`${API_URL}/opportunities`);
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json() as { opportunities?: any[] };
    const opps = data.opportunities || [];

    if (opps.length === 0) return 'No +EV opportunities found on AgentBets right now.';

    const lines = ['**AgentBets Opportunities** (edge detection)', ''];

    for (const opp of opps.slice(0, 10)) {
      lines.push(`  ${opp.marketQuestion || opp.market || opp.id}`);
      if (opp.edge) lines.push(`       Edge: ${(opp.edge * 100).toFixed(1)}%`);
      if (opp.expectedValue) lines.push(`       EV: ${(opp.expectedValue * 100).toFixed(1)}%`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1).join(' ');

  switch (sub) {
    case 'markets':
    case 'list':
    case 'search':
      return handleMarkets(rest || undefined);

    case 'market':
    case 'get':
      return handleMarket(rest);

    case 'opportunities':
    case 'edge':
    case 'opps':
      return handleOpportunities();

    case 'help':
    default:
      return [
        '**AgentBets** — AI-native prediction markets on Solana',
        'Built for the Colosseum Agent Hackathon (https://colosseum.com/agent-hackathon)',
        '',
        'Commands:',
        '  /agentbets markets [query]    Search markets',
        '  /agentbets market <id>        Market details',
        '  /agentbets opportunities      Find +EV edges',
        '  /agentbets help               Show this help',
        '',
        'API: https://agentbets-api-production.up.railway.app',
        'Repo: https://github.com/nox-oss/agentbets',
      ].join('\n');
  }
}

export default {
  name: 'agentbets',
  description: 'AgentBets — AI-native prediction markets on Solana (Colosseum Agent Hackathon)',
  commands: ['/agentbets'],
  handle: execute,
};
