/**
 * Feeds CLI Skill
 *
 * Commands:
 * /feeds list [category]               - List all registered feeds
 * /feeds info <id>                     - Detailed feed info
 * /feeds capabilities                  - Group feeds by capability
 * /feeds categories                    - Group feeds by category
 * /feeds search <query>               - Search feeds by name/description/capability
 * /feeds status                        - Active feeds + cache stats
 * /feeds ready                         - Feeds ready to activate (env vars present)
 * /feeds env <id>                      - Show required/optional env vars for a feed
 * /feeds subscribe <platform> <market> - Subscribe to price updates
 * /feeds unsubscribe <platform> <market> - Unsubscribe from updates
 * /feeds search-markets <query> [platform] - Search markets across feeds
 * /feeds price <platform> <market>     - Get current price
 * /feeds cache [clear]                 - View or clear cache
 */

import {
  getGlobalFeedRegistry,
  FeedCapability,
  type FeedSummary,
  type FeedCategory,
} from '../../../feeds/registry';
import { registerAllFeeds } from '../../../feeds/descriptors';

// Ensure feeds are registered on first use
let registered = false;
function ensureRegistered(): void {
  if (!registered) {
    registerAllFeeds();
    registered = true;
  }
}

// Track active subscriptions
const activeSubscriptions = new Map<string, () => void>();

// Lazy FeedManager singleton — avoids recreating on every command
import type { FeedManager } from '../../../feeds/index';

let _feedManager: FeedManager | null = null;
let _feedManagerPromise: Promise<FeedManager | null> | null = null;

async function getFeedManager(): Promise<FeedManager | null> {
  if (_feedManager) return _feedManager;
  if (_feedManagerPromise) return _feedManagerPromise;

  _feedManagerPromise = (async () => {
    try {
      const feedsMod = await import('../../../feeds/index');
      const configMod = await import('../../../config/index');
      let config;
      try { config = configMod.loadConfig(); } catch { config = configMod.DEFAULT_CONFIG; }
      _feedManager = await feedsMod.createFeedManager(config.feeds ?? {} as any);
      return _feedManager;
    } catch {
      _feedManagerPromise = null;
      return null;
    }
  })();

  return _feedManagerPromise;
}

// Capability labels for display
const capLabels: Record<string, string> = {
  [FeedCapability.MARKET_DATA]: 'Market Data',
  [FeedCapability.ORDERBOOK]: 'Orderbook',
  [FeedCapability.REALTIME_PRICES]: 'Real-time Prices',
  [FeedCapability.TRADING]: 'Trading',
  [FeedCapability.NEWS]: 'News',
  [FeedCapability.CRYPTO_PRICES]: 'Crypto Prices',
  [FeedCapability.WEATHER]: 'Weather',
  [FeedCapability.SPORTS]: 'Sports',
  [FeedCapability.POLITICS]: 'Politics',
  [FeedCapability.ECONOMICS]: 'Economics',
  [FeedCapability.GEOPOLITICAL]: 'Geopolitical',
  [FeedCapability.EDGE_DETECTION]: 'Edge Detection',
  [FeedCapability.HISTORICAL]: 'Historical Data',
};

const categoryLabels: Record<FeedCategory, string> = {
  prediction_market: 'Prediction Markets',
  crypto: 'Crypto',
  news: 'News & Social',
  weather: 'Weather',
  sports: 'Sports',
  politics: 'Politics',
  economics: 'Economics',
  geopolitical: 'Geopolitical',
  data: 'Data',
  custom: 'Custom',
};

function statusIcon(s: FeedSummary): string {
  if (s.status === 'planned') return '[~~]';
  if (s.status === 'deprecated') return '[XX]';
  if (s.active) return '[ON]';
  if (s.ready) return '[--]';
  return '[!!]';
}

function feedLine(s: FeedSummary): string {
  let line = `  ${statusIcon(s)} **${s.name}** (\`${s.id}\`)`;
  if (s.skillCommand) line += ` \`${s.skillCommand}\``;
  line += ` — ${s.description}`;
  return line;
}

async function execute(args: string): Promise<string> {
  ensureRegistered();
  const registry = getGlobalFeedRegistry();

  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'list';

  switch (cmd) {
    // =========================================================================
    // DISCOVERY
    // =========================================================================

    case 'list':
    case 'ls': {
      const filterCat = parts[1]?.toLowerCase() as FeedCategory | undefined;
      const groups = registry.groupByCategory();
      const stats = registry.stats();

      let output = `**Feed Registry** — ${stats.total} feeds (${stats.active} active, ${stats.ready} ready)\n`;
      output += `Legend: [ON] active  [--] ready  [!!] missing env  [~~] planned\n\n`;

      const cats = Object.keys(groups).sort() as FeedCategory[];
      for (const cat of cats) {
        if (filterCat && cat !== filterCat) continue;
        const feeds = groups[cat];
        output += `### ${categoryLabels[cat] || cat} (${feeds.length})\n`;
        for (const s of feeds) {
          output += feedLine(s) + '\n';
        }
        output += '\n';
      }

      if (filterCat && !groups[filterCat]) {
        output += `No feeds in category "${filterCat}".\n`;
        output += `Available: ${cats.join(', ')}`;
      }

      return output;
    }

    case 'info':
    case 'i': {
      if (!parts[1]) return 'Usage: /feeds info <feed-id>';
      const desc = registry.get(parts[1]);
      if (!desc) return `Feed "${parts[1]}" not found. Use \`/feeds list\` to see all.`;

      const { ready, missing } = registry.canActivate(desc.id);
      const active = registry.isActive(desc.id);

      const isPlanned = desc.status === 'planned';
      let output = `**${desc.name}** (\`${desc.id}\`)${isPlanned ? ' — PLANNED' : ''}\n\n`;
      output += `${desc.description}\n\n`;
      output += `Category: ${categoryLabels[desc.category] || desc.category}\n`;
      output += `Connection: ${desc.connectionType}\n`;
      if (isPlanned) {
        output += `Status: Planned (not yet implemented)\n`;
      } else {
        output += `Status: ${active ? 'Active' : ready ? 'Ready' : 'Missing env vars'}\n`;
      }
      if (desc.skillCommand) output += `CLI: \`${desc.skillCommand} help\`\n`;
      if (desc.version) output += `Version: ${desc.version}\n`;
      if (desc.docsUrl) output += `Docs: ${desc.docsUrl}\n`;
      output += '\n';

      output += `**Capabilities:**\n`;
      for (const cap of desc.capabilities) {
        output += `  - ${capLabels[cap] || cap}\n`;
      }

      output += `\n**Data Types:** ${desc.dataTypes.join(', ')}\n`;

      if (desc.requiredEnv?.length) {
        output += `\n**Required Env Vars:**\n`;
        for (const v of desc.requiredEnv) {
          const set = !!process.env[v];
          output += `  ${set ? '[x]' : '[ ]'} ${v}\n`;
        }
      }

      if (desc.optionalEnv?.length) {
        output += `\n**Optional Env Vars:**\n`;
        for (const v of desc.optionalEnv) {
          const set = !!process.env[v];
          output += `  ${set ? '[x]' : '[ ]'} ${v}\n`;
        }
      }

      if (missing.length > 0) {
        output += `\n**Missing:** Set these to activate: ${missing.join(', ')}`;
      }

      return output;
    }

    case 'capabilities':
    case 'caps': {
      const groups = registry.groupByCapability();
      let output = '**Feeds by Capability**\n\n';
      const caps = Object.keys(groups).sort();
      for (const cap of caps) {
        const feeds = groups[cap as FeedCapability];
        output += `**${capLabels[cap] || cap}** (${feeds.length})\n`;
        for (const s of feeds) {
          output += `  ${statusIcon(s)} ${s.name}\n`;
        }
        output += '\n';
      }
      return output;
    }

    case 'categories':
    case 'cats': {
      const groups = registry.groupByCategory();
      let output = '**Feeds by Category**\n\n';
      for (const [cat, feeds] of Object.entries(groups)) {
        output += `**${categoryLabels[cat as FeedCategory] || cat}** (${feeds.length}): `;
        output += feeds.map(s => s.name).join(', ') + '\n';
      }
      return output;
    }

    case 'search':
    case 'find': {
      if (!parts[1]) return 'Usage: /feeds search <query>';
      const query = parts.slice(1).join(' ');
      const results = registry.search(query);
      if (results.length === 0) return `No feeds matching "${query}".`;

      let output = `**Feed Search: "${query}"** (${results.length} results)\n\n`;
      for (const desc of results) {
        const { ready } = registry.canActivate(desc.id);
        const active = registry.isActive(desc.id);
        const icon = active ? '[ON]' : ready ? '[--]' : '[!!]';
        output += `${icon} **${desc.name}** (\`${desc.id}\`) — ${desc.description}\n`;
        output += `    Caps: ${desc.capabilities.map(c => capLabels[c] || c).join(', ')}\n\n`;
      }
      return output;
    }

    case 'ready': {
      const ready = registry.listReady();
      if (ready.length === 0) return 'No feeds ready to activate. Check env vars with `/feeds list`.';

      let output = `**Ready Feeds** (${ready.length})\n\n`;
      for (const s of ready) {
        output += `${s.active ? '[ON]' : '[--]'} **${s.name}** — ${s.description}\n`;
      }
      return output;
    }

    case 'env': {
      if (!parts[1]) return 'Usage: /feeds env <feed-id>';
      const desc = registry.get(parts[1]);
      if (!desc) return `Feed "${parts[1]}" not found.`;

      let output = `**Env Vars for ${desc.name}**\n\n`;
      if (desc.requiredEnv?.length) {
        output += '**Required:**\n';
        for (const v of desc.requiredEnv) {
          output += `  ${process.env[v] ? '[x]' : '[ ]'} \`${v}\`\n`;
        }
      } else {
        output += 'No required env vars (works out of the box).\n';
      }
      if (desc.optionalEnv?.length) {
        output += '\n**Optional:**\n';
        for (const v of desc.optionalEnv) {
          output += `  ${process.env[v] ? '[x]' : '[ ]'} \`${v}\`\n`;
        }
      }
      return output;
    }

    case 'active': {
      const active = registry.listActive();
      if (active.length === 0) return 'No feeds currently active.';

      let output = `**Active Feeds** (${active.length})\n\n`;
      for (const s of active) {
        output += `  **${s.name}** — ${s.connectionType} — ${s.capabilities.map(c => capLabels[c] || c).join(', ')}\n`;
      }
      return output;
    }

    // =========================================================================
    // MARKET DATA (preserved from original skill)
    // =========================================================================

    case 'status': {
      const stats = registry.stats();
      let output = `**Feed Status**\n\n`;
      output += `Registered: ${stats.total} feeds\n`;
      output += `Active: ${stats.active}\n`;
      output += `Ready: ${stats.ready}\n`;
      output += `Categories: ${stats.categories}\n\n`;

      try {
        const fm = await getFeedManager();
        if (fm) {
          const cache = fm.getCacheStats();
          output += `**Cache:** ${cache.size} entries | Hit rate: ${(cache.hitRate * 100).toFixed(1)}% (${cache.hits}/${cache.hits + cache.misses})`;
        }
      } catch { /* cache stats optional */ }

      return output;
    }

    case 'subscribe':
    case 'sub': {
      if (parts.length < 3) return 'Usage: /feeds subscribe <platform> <market-id>';
      const platform = parts[1].toLowerCase();
      const marketId = parts[2];

      try {
        const fm = await getFeedManager();
        if (!fm) return 'Error: Could not initialize feed manager.';

        const market = await fm.getMarket(marketId, platform);
        if (!market) return `Market \`${marketId}\` not found on **${platform}**.`;

        const subKey = `${platform}:${marketId}`;
        const unsub = fm.subscribePrice(platform, marketId, () => {});
        activeSubscriptions.set(subKey, unsub);

        const price = market.outcomes?.[0]?.price;
        let output = `Subscribed to **${platform}** market \`${marketId}\`\n\n`;
        output += `**${market.question ?? market.id}**\n`;
        if (price != null) output += `Current price: $${price.toFixed(3)}`;
        return output;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case 'unsubscribe':
    case 'unsub': {
      if (parts.length < 3) return 'Usage: /feeds unsubscribe <platform> <market-id>';
      const subKey = `${parts[1].toLowerCase()}:${parts[2]}`;
      const unsub = activeSubscriptions.get(subKey);
      if (!unsub) return `No active subscription for \`${subKey}\`.`;
      unsub();
      activeSubscriptions.delete(subKey);
      return `Unsubscribed from \`${subKey}\`.`;
    }

    case 'search-markets':
    case 'sm': {
      if (parts.length < 2) return 'Usage: /feeds search-markets <query> [platform]';
      const query = parts.slice(1, parts.length > 2 ? -1 : undefined).join(' ');
      const platform = parts.length > 2 ? parts[parts.length - 1].toLowerCase() : undefined;

      try {
        const fm = await getFeedManager();
        if (!fm) return 'Error: Could not initialize feed manager.';
        const markets = await fm.searchMarkets(query, platform);

        if (!markets.length) return `No markets found for "${query}".`;

        let output = `**Market Search** (${markets.length})\n\n`;
        for (const m of markets.slice(0, 10)) {
          const price = m.outcomes?.[0]?.price;
          output += `[${m.platform}] **${m.question ?? m.id}**\n`;
          if (price != null) output += `  Price: $${price.toFixed(3)}`;
          if (m.volume24h) output += ` | Vol: $${m.volume24h.toLocaleString()}`;
          output += `\n  ID: \`${m.id}\`\n\n`;
        }
        return output;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case 'price': {
      if (parts.length < 3) return 'Usage: /feeds price <platform> <market-id>';
      try {
        const fm = await getFeedManager();
        if (!fm) return 'Error: Could not initialize feed manager.';
        const price = await fm.getPrice(parts[1].toLowerCase(), parts[2]);
        if (price == null) return `Could not fetch price for \`${parts[2]}\` on **${parts[1]}**.`;
        return `**${parts[1]}** \`${parts[2]}\`: $${price.toFixed(4)}`;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case 'cache': {
      try {
        const fm = await getFeedManager();
        if (!fm) return 'Error: Could not initialize feed manager.';
        if (parts[1]?.toLowerCase() === 'clear') {
          fm.clearCache();
          return 'Market cache cleared.';
        }
        const stats = fm.getCacheStats();
        return `**Cache:** ${stats.size} entries | ${(stats.hitRate * 100).toFixed(1)}% hit rate (${stats.hits}/${stats.hits + stats.misses})`;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case 'help':
    default:
      return `**Feed Registry Commands**

**Discovery:**
  /feeds list [category]        - Browse all feeds (or filter: weather, crypto, ...)
  /feeds info <id>              - Detailed info, env vars, CLI command
  /feeds search <query>         - Search by name, description, or capability
  /feeds caps                   - Group feeds by capability
  /feeds cats                   - Group feeds by category
  /feeds ready                  - Feeds ready to activate now
  /feeds active                 - Currently running feeds
  /feeds env <id>               - Required/optional env vars for a feed

**Market Data:**
  /feeds status                 - Registry stats + cache
  /feeds search-markets <query> - Search markets across platforms
  /feeds price <platform> <id>  - Get current price
  /feeds sub <platform> <id>    - Subscribe to price updates
  /feeds unsub <platform> <id>  - Unsubscribe

**Categories:** prediction_market, crypto, news, weather, economics, geopolitical
**Legend:** [ON] active  [--] ready  [!!] missing env  [~~] planned`;
  }
}

export default {
  name: 'feeds',
  description: 'Feed registry — discover, browse, and connect to data sources',
  commands: ['/feeds', '/feed'],
  handle: execute,
};
