/**
 * Virtuals Protocol CLI Skill
 *
 * Commands:
 * /virt search [query] - Search agents
 * /virt agent <id> - Get agent details
 * /virt agents - List all agents
 * /virt trending - Trending agents by volume
 * /virt new - Recently launched agents
 * /virt price <tokenAddress> - Get bonding curve price
 * /virt graduation <tokenAddress> - Check graduation progress
 */

import { createVirtualsFeed, VirtualsFeed, VirtualsAgent } from '../../../feeds/virtuals/index';
import { logger } from '../../../utils/logger';

let feed: VirtualsFeed | null = null;

async function getFeed(): Promise<VirtualsFeed> {
  if (feed) return feed;

  try {
    const rpcUrl = process.env.BASE_RPC_URL;
    feed = await createVirtualsFeed({ rpcUrl });
    await feed.connect();
    return feed;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Virtuals feed');
    throw error;
  }
}

function formatAgent(agent: VirtualsAgent): string {
  let output = `**${agent.name}** (${agent.symbol})\n`;
  output += `  ID: \`${agent.id}\`\n`;
  output += `  Token: \`${agent.tokenAddress.slice(0, 10)}...${agent.tokenAddress.slice(-8)}\`\n`;
  output += `  Price: $${agent.stats.price.toFixed(6)}`;
  if (agent.stats.priceChange24h !== undefined) {
    const change = agent.stats.priceChange24h >= 0 ? `+${agent.stats.priceChange24h.toFixed(2)}%` : `${agent.stats.priceChange24h.toFixed(2)}%`;
    output += ` (${change})`;
  }
  output += '\n';
  output += `  Market Cap: $${agent.stats.marketCap.toLocaleString()}\n`;
  output += `  Volume 24h: $${agent.stats.volume24h.toLocaleString()}\n`;
  output += `  Holders: ${agent.stats.holders.toLocaleString()}\n`;
  if (agent.status) {
    output += `  Status: ${agent.status}\n`;
  }
  if (agent.category) {
    output += `  Category: ${agent.category}\n`;
  }
  return output;
}

async function handleSearch(query: string): Promise<string> {
  const f = await getFeed();

  try {
    const markets = await f.searchMarkets(query || 'AI');
    if (markets.length === 0) {
      return 'No agents found.';
    }

    let output = `**Virtuals Agents** (${markets.length} results)\n\n`;
    for (const market of markets.slice(0, 15)) {
      const outcome = market.outcomes[0];
      output += `**${market.question}** (${outcome?.name || '-'})\n`;
      output += `  ID: \`${market.id}\`\n`;
      output += `  Price: $${(outcome?.price || 0).toFixed(6)}\n`;
      output += `  Volume: $${market.volume24h.toLocaleString()}\n\n`;
    }
    return output;
  } catch (error) {
    return `Error searching agents: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleAgent(agentId: string): Promise<string> {
  const f = await getFeed();

  try {
    const agent = await f.getAgent(agentId);
    if (!agent) {
      return `Agent ${agentId} not found.`;
    }

    let output = formatAgent(agent);
    output += '\n';

    if (agent.description) {
      output += `**Description:**\n${agent.description.slice(0, 300)}${agent.description.length > 300 ? '...' : ''}\n\n`;
    }

    if (agent.personality) {
      output += `**Personality:**\n${agent.personality.slice(0, 200)}${agent.personality.length > 200 ? '...' : ''}\n\n`;
    }

    if (agent.capabilities && agent.capabilities.length > 0) {
      output += `**Capabilities:** ${agent.capabilities.join(', ')}\n\n`;
    }

    if (agent.socials) {
      output += `**Socials:**\n`;
      if (agent.socials.twitter) output += `  Twitter: ${agent.socials.twitter}\n`;
      if (agent.socials.telegram) output += `  Telegram: ${agent.socials.telegram}\n`;
      if (agent.socials.website) output += `  Website: ${agent.socials.website}\n`;
    }

    output += `\nURL: https://app.virtuals.io/agents/${agent.id}`;

    return output;
  } catch (error) {
    return `Error fetching agent: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleAgents(): Promise<string> {
  const f = await getFeed();

  try {
    const result = await f.getAgents({ sortBy: 'marketCap', sortOrder: 'desc', pageSize: 20 });
    if (result.agents.length === 0) {
      return 'No agents found.';
    }

    let output = `**All Agents** (${result.total} total)\n\n`;
    for (const agent of result.agents) {
      output += `**${agent.name}** (${agent.symbol}) - $${agent.stats.marketCap.toLocaleString()} mcap\n`;
      output += `  ID: \`${agent.id}\` | Price: $${agent.stats.price.toFixed(6)}\n\n`;
    }
    return output;
  } catch (error) {
    return `Error fetching agents: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleTrending(): Promise<string> {
  const f = await getFeed();

  try {
    const agents = await f.getTrendingAgents(15);
    if (agents.length === 0) {
      return 'No trending agents found.';
    }

    let output = `**Trending Agents** (by 24h volume)\n\n`;
    for (const agent of agents) {
      output += formatAgent(agent) + '\n';
    }
    return output;
  } catch (error) {
    return `Error fetching trending: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleNew(): Promise<string> {
  const f = await getFeed();

  try {
    const agents = await f.getNewAgents(15);
    if (agents.length === 0) {
      return 'No new agents found.';
    }

    let output = `**New Agents** (recently launched)\n\n`;
    for (const agent of agents) {
      output += formatAgent(agent);
      output += `  Created: ${new Date(agent.createdAt).toLocaleString()}\n\n`;
    }
    return output;
  } catch (error) {
    return `Error fetching new agents: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePrice(tokenAddress: string): Promise<string> {
  const f = await getFeed();

  try {
    const price = await f.getBondingCurvePrice(tokenAddress);
    if (price === null) {
      return `Could not fetch price for ${tokenAddress}. May be graduated or invalid address.`;
    }
    return `**Bonding Curve Price**\nToken: \`${tokenAddress}\`\nPrice: ${price.toFixed(8)} VIRTUAL`;
  } catch (error) {
    return `Error fetching price: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleGraduation(tokenAddress: string): Promise<string> {
  const f = await getFeed();

  try {
    const [isGraduated, progress] = await Promise.all([
      f.isAgentGraduated(tokenAddress),
      f.getGraduationProgress(tokenAddress),
    ]);

    let output = `**Graduation Status**\nToken: \`${tokenAddress}\`\n`;
    output += `Graduated: ${isGraduated ? 'Yes (on Uniswap)' : 'No (on bonding curve)'}\n`;
    output += `Progress: ${progress.toFixed(1)}%`;

    if (!isGraduated && progress < 100) {
      output += ` (need ~${(42000 * (1 - progress / 100)).toFixed(0)} more VIRTUAL)`;
    }

    return output;
  } catch (error) {
    return `Error checking graduation: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'search':
      return handleSearch(rest.join(' '));

    case 'agent':
    case 'a':
      if (!rest[0]) return 'Usage: /virt agent <id>';
      return handleAgent(rest[0]);

    case 'agents':
    case 'list':
    case 'all':
      return handleAgents();

    case 'trending':
    case 'top':
    case 'hot':
      return handleTrending();

    case 'new':
    case 'latest':
    case 'recent':
      return handleNew();

    case 'price':
    case 'p':
      if (!rest[0]) return 'Usage: /virt price <tokenAddress>';
      return handlePrice(rest[0]);

    case 'graduation':
    case 'grad':
    case 'status':
      if (!rest[0]) return 'Usage: /virt graduation <tokenAddress>';
      return handleGraduation(rest[0]);

    case 'help':
    default:
      return `**Virtuals Protocol Commands**

  /virt search [query]      - Search agents
  /virt agent <id>          - Get agent details
  /virt agents              - List all agents
  /virt trending            - Trending by volume
  /virt new                 - Recently launched

**On-chain Data:**
  /virt price <addr>        - Bonding curve price
  /virt graduation <addr>   - Graduation progress

**Examples:**
  /virt search gaming
  /virt trending
  /virt graduation 0x1234...`;
  }
}

export default { execute };
