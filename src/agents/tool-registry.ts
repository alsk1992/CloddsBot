/**
 * Tool Registry - Dynamic tool management for cost-optimized tool loading.
 *
 * Instead of sending all 630+ tools on every API call (~50k tokens),
 * the registry enables sending only ~20 core tools + a `tool_search` meta-tool.
 * When the LLM needs specialized tools, it calls `tool_search` to discover them.
 *
 * Expected savings: ~90% reduction in tool token costs per message.
 */

export interface ToolMetadata {
  platform?: string;
  /** Primary category (first/best match). Use `categories` for multi-category tools. */
  category?: string;
  /** All matching categories for this tool (supports intersection queries). */
  categories?: string[];
  tags?: string[];
  core?: boolean;
}

/** Minimal shape required by the registry — compatible with any ToolDefinition */
export interface RegistryTool {
  name: string;
  description: string;
  input_schema: unknown;
  metadata?: ToolMetadata;
}

export interface SearchQuery {
  platform?: string;
  category?: string;
  query?: string;
}

export class ToolRegistry<T extends RegistryTool = RegistryTool> {
  private tools: Map<string, T> = new Map();
  private byPlatform: Map<string, Set<string>> = new Map();
  private byCategory: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();

  register(tool: T): void {
    this.tools.set(tool.name, tool);

    const meta = tool.metadata;
    if (meta?.platform) {
      let set = this.byPlatform.get(meta.platform);
      if (!set) {
        set = new Set();
        this.byPlatform.set(meta.platform, set);
      }
      set.add(tool.name);
    }

    // Index by ALL categories (multi-category support)
    const cats = meta?.categories ?? (meta?.category ? [meta.category] : []);
    for (const cat of cats) {
      let set = this.byCategory.get(cat);
      if (!set) {
        set = new Set();
        this.byCategory.set(cat, set);
      }
      set.add(tool.name);
    }

    if (meta?.tags) {
      for (const tag of meta.tags) {
        const lower = tag.toLowerCase();
        let set = this.tagIndex.get(lower);
        if (!set) {
          set = new Set();
          this.tagIndex.set(lower, set);
        }
        set.add(tool.name);
      }
    }
  }

  registerAll(tools: T[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): T | undefined {
    return this.tools.get(name);
  }

  size(): number {
    return this.tools.size;
  }

  searchByPlatform(platform: string): T[] {
    const names = this.byPlatform.get(platform.toLowerCase());
    if (!names) return [];
    return Array.from(names)
      .map(n => this.tools.get(n)!)
      .filter(Boolean);
  }

  searchByCategory(category: string): T[] {
    const names = this.byCategory.get(category.toLowerCase());
    if (!names) return [];
    return Array.from(names)
      .map(n => this.tools.get(n)!)
      .filter(Boolean);
  }

  /**
   * Search tools by platform AND category intersection.
   * Returns only tools that match BOTH criteria.
   */
  searchByPlatformAndCategory(platform: string, category: string): T[] {
    const platformTools = this.byPlatform.get(platform.toLowerCase());
    const categoryTools = this.byCategory.get(category.toLowerCase());

    if (!platformTools || !categoryTools) return [];

    const result: T[] = [];
    for (const name of platformTools) {
      if (categoryTools.has(name)) {
        const tool = this.tools.get(name);
        if (tool) result.push(tool);
      }
    }
    return result;
  }

  searchByText(query: string): T[] {
    const lower = query.toLowerCase();
    const terms = lower.split(/\s+/).filter(Boolean);
    const scored = new Map<string, number>();

    // Score by tag matches
    for (const term of terms) {
      const tagHits = this.tagIndex.get(term);
      if (tagHits) {
        for (const name of tagHits) {
          scored.set(name, (scored.get(name) ?? 0) + 3);
        }
      }
    }

    // Score by name/description substring matches
    for (const [name, tool] of this.tools) {
      let score = scored.get(name) ?? 0;
      const nameLower = name.toLowerCase();
      const descLower = tool.description.toLowerCase();

      for (const term of terms) {
        if (nameLower.includes(term)) score += 2;
        if (descLower.includes(term)) score += 1;
      }

      // Platform match via metadata
      const meta = tool.metadata;
      if (meta?.platform) {
        for (const term of terms) {
          if (meta.platform.includes(term)) score += 2;
        }
      }

      if (score > 0) {
        scored.set(name, score);
      }
    }

    return Array.from(scored.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => this.tools.get(name)!)
      .filter(Boolean);
  }

  search(q: SearchQuery): T[] {
    // When both platform and category provided, use intersection
    if (q.platform && q.category) return this.searchByPlatformAndCategory(q.platform, q.category);
    if (q.platform) return this.searchByPlatform(q.platform);
    if (q.category) return this.searchByCategory(q.category);
    if (q.query) return this.searchByText(q.query);
    return [];
  }

  getCoreTools(): T[] {
    return Array.from(this.tools.values()).filter(t => t.metadata?.core === true);
  }

  getAvailablePlatforms(): string[] {
    return Array.from(this.byPlatform.keys());
  }

  getAvailableCategories(): string[] {
    return Array.from(this.byCategory.keys());
  }
}

/**
 * Infer metadata from tool name using prefix conventions.
 * Falls back to reasonable defaults when metadata isn't explicitly set.
 * Assigns MULTIPLE categories when a tool matches more than one.
 */
export function inferToolMetadata(toolName: string, description: string): ToolMetadata {
  const meta: ToolMetadata = {};

  // Platform inference from prefix (longest prefixes first to match correctly)
  const platformPrefixes: [string, string][] = [
    ['binance_futures_', 'binance'],
    ['solana_jupiter_', 'solana'],
    ['solana_auto_', 'solana'],
    ['solana_best_', 'solana'],
    ['meteora_dlmm_', 'meteora'],
    ['orca_whirlpool_', 'orca'],
    ['raydium_clmm_', 'raydium'],
    ['raydium_amm_', 'raydium'],
    ['drift_direct_', 'drift'],
    ['pumpfun_', 'pumpfun'],
    ['polymarket_', 'polymarket'],
    ['kalshi_', 'kalshi'],
    ['manifold_', 'manifold'],
    ['metaculus_', 'metaculus'],
    ['predictit_', 'predictit'],
    ['predictfun_', 'predictfun'],
    ['drift_', 'drift'],
    ['opinion_', 'opinion'],
    ['bybit_', 'bybit'],
    ['mexc_', 'mexc'],
    ['hyperliquid_', 'hyperliquid'],
    ['solana_', 'solana'],
    ['bags_', 'bags'],
    ['raydium_', 'raydium'],
    ['orca_', 'orca'],
    ['meteora_', 'meteora'],
    ['coingecko_', 'coingecko'],
    ['yahoo_', 'yahoo'],
    ['acp_', 'acp'],
    ['swarm_', 'swarm'],
    ['evm_', 'evm'],
    ['wormhole_', 'wormhole'],
    ['usdc_', 'usdc_bridge'],
    ['qmd_', 'qmd'],
    ['docker_', 'docker'],
    ['git_', 'git'],
    ['shell_history_', 'shell'],
    ['exec_', 'exec'],
    ['paper_', 'paper'],
    ['email_', 'email'],
    ['sms_', 'sms'],
    ['sql_', 'sql'],
    ['subagent_', 'subagent'],
  ];

  for (const [prefix, platform] of platformPrefixes) {
    if (toolName.startsWith(prefix)) {
      meta.platform = platform;
      break;
    }
  }

  // Exact name matches for tools without prefix convention
  const exactMatches: Record<string, string> = {
    bittensor: 'bittensor',
    orderbook_imbalance: 'polymarket',
    setup_polymarket_credentials: 'polymarket',
    setup_kalshi_credentials: 'kalshi',
    setup_manifold_credentials: 'manifold',
  };
  if (!meta.platform && exactMatches[toolName]) {
    meta.platform = exactMatches[toolName];
  }

  // Multi-category inference: collect ALL matching categories
  // Order matters for primary category (first match = meta.category)
  const combined = (toolName + ' ' + description).toLowerCase();
  const categories: string[] = [];

  // Trading uses strict action verbs only (no "trade"/"trading"/"order" — too generic in descriptions).
  // market_data catches data nouns like "orderbook", "trades", "price".
  // Order: trading first so action tools get trading as primary, but strict enough
  // that data tools (orderbook, trades) fall through to market_data.
  const CATEGORY_REGEXES: [RegExp, string][] = [
    [/\b(buy|sell|swap|long|short|close|cancel|limit|dca|bridge|bet|arb|arbitrage|execute)\b/, 'trading'],
    [/\b(prices?|quote|chart|orderbook|ticker|candlestick|volume|spread|midpoint|trades)\b/, 'market_data'],
    [/\b(positions?|balances?|portfolio|pnl|collateral|margin|leverage|profit)\b/, 'portfolio'],
    [/\b(pool|liquidity|farm|reward|fee|claim|harvest|stake|lp)\b/, 'defi'],
    [/\b(credentials?|api[\s._-]?key|config(?:ure)?|connect|login)\b/, 'admin'],
    [/\b(file|shell|git|docker|email|sms|sql|webhook|transcrib|deploy)\b/, 'infrastructure'],
    [/\b(alert|watch|whale|notification|news|monitor|track)\b/, 'alerts'],
  ];

  for (const [regex, cat] of CATEGORY_REGEXES) {
    if (regex.test(combined)) {
      categories.push(cat);
    }
  }

  // Discovery: only check tool name (too generic for description matching)
  if (categories.length === 0 && /\b(search|list|get|info|status|stats)\b/.test(toolName.toLowerCase())) {
    categories.push('discovery');
  }

  // Fallback
  if (categories.length === 0) {
    categories.push('general');
  }

  meta.category = categories[0]; // Primary category (backward compat)
  meta.categories = categories;  // All matching categories

  // Tag inference from name parts
  const tags: string[] = [];
  const parts = toolName.split('_');
  for (const part of parts) {
    if (part.length > 2) tags.push(part);
  }
  // Add description-derived tags
  const descLower = description.toLowerCase();
  if (descLower.includes('order')) tags.push('order');
  if (descLower.includes('market')) tags.push('market');
  if (descLower.includes('position')) tags.push('position');
  if (descLower.includes('balance')) tags.push('balance');
  meta.tags = tags;

  return meta;
}

/**
 * Keyword → platform mapping for preloading tools from user messages.
 * Matches common ways users refer to platforms, including typos and abbreviations.
 */
const PLATFORM_KEYWORDS: [RegExp, string][] = [
  // Polymarket: polymarkt, polymaket, pollymarket, ploymarket, polimarket
  // Requires "market" suffix when standalone "poly" to avoid false positives
  [/\bp(?:o?ly|oli|olly|loy)[\s._-]?ma?r?ke?t?\b|\bpolymarket\b/i, 'polymarket'],
  // Kalshi: kashi, kalhi, klashi
  [/\bk(?:a?lshi|ashi|alhi|lashi)\b/i, 'kalshi'],
  // Manifold: maniflod, manfiold, manifodl
  [/\bmanif(?:o?ld|lod|odl)\b|\bmanfi(?:old|lod)\b/i, 'manifold'],
  // Metaculus: metaculus, metaculis, metaculas
  [/\bmetacul[uia]s\b/i, 'metaculus'],
  [/\bpredictit\b/i, 'predictit'],
  [/\bpredict[\s._-]?fun\b/i, 'predictfun'],
  [/\bdrift(?:\s+protocol|\s+dex)?\b/i, 'drift'],
  [/\bopinion[\s._-]?(?:market|\.com|\.xyz)\b/i, 'opinion'],
  // Binance: bianance, binanace, binnance, bnb
  [/\bb(?:i(?:na?n(?:a?ce|ace)|ana(?:n?ce))|inna?nce)\b|\bbnb\b/i, 'binance'],
  // Bybit: bybi, bibit
  [/\bb(?:y?bit|ibit|ybi)\b/i, 'bybit'],
  [/\bmexc\b/i, 'mexc'],
  // Hyperliquid: hyperliqiud, hyperliuid, hperliquid, hl
  [/\bh(?:y?per)?[\s._-]?li(?:qu?i[du]{0,2}|uid|qiud)\b|\bhl\b/i, 'hyperliquid'],
  // Solana: solona, soalana, soalna
  [/\bs(?:ol(?:a?na|ona)?|oala?na)\b/i, 'solana'],
  // Jupiter: jupter, jupitor, jup
  [/\bjup(?:i?ter|itor)?\b/i, 'solana'],
  // PumpFun: pumfun, pumpfn, pump.fun, pump fun
  [/\bpump?[\s._-]?fu?n\b/i, 'pumpfun'],
  [/\bbags(?:\.fm)?\b/i, 'bags'],
  [/\bmeteora\b/i, 'meteora'],
  // Raydium: raydim, radyium
  [/\br(?:ay?di?u?m|adyium)\b/i, 'raydium'],
  [/\borca\b/i, 'orca'],
  // CoinGecko: coingeeko, coingeko, coin gecko, cg
  [/\bcoin[\s._-]?ge{0,2}c?k[eo]?\b|\bcg\b/i, 'coingecko'],
  [/\byahoo\b/i, 'yahoo'],
  [/\bacp\b|\bmarketplace\b/i, 'acp'],
  [/\bswarm\b/i, 'swarm'],
  [/\bwormhole\b/i, 'wormhole'],
  [/\bdocker\b/i, 'docker'],
  [/\bgit\b/i, 'git'],
  // EVM: ethereum, eth
  [/\b(?:evm|ethereum|eth)\b/i, 'evm'],
  [/\busdc[\s._-]?bridge\b|\bcross[\s._-]?chain\b/i, 'usdc_bridge'],
  // Bittensor: bitensor, bittnesor, btcli, tao
  [/\bbit?t?(?:en?|ne)?sor\b|\btao\b|\bbtcli\b/i, 'bittensor'],
  [/\bqmd\b/i, 'qmd'],
  [/\bshell\b/i, 'shell'],
  [/\b(?:python|script|exec)\b/i, 'exec'],
  [/\bpaper[\s._-]?trad/i, 'paper'],
  [/\bemail\b/i, 'email'],
  [/\bsms\b|\btext\s+message\b/i, 'sms'],
  [/\bsql\b|\bquery\s+db\b|\bdatabase\b/i, 'sql'],
  [/\bsubagent\b|\bagent\s+task\b/i, 'subagent'],
  // perps/futures are generic — load the most common perps platforms
  [/\bperps\b/i, 'binance'],
  [/\bperps\b/i, 'hyperliquid'],
  [/\bperps\b/i, 'drift'],
  [/\bfutures\b/i, 'binance'],
  [/\bfutures\b/i, 'bybit'],
  // Generic CEX/DEX keywords → preload binance (most common) + solana (most common DEX)
  [/\bcex\b/i, 'binance'],
  [/\bdex\b/i, 'solana'],
];

/**
 * Category keywords for preloading tools from user messages.
 * Synced with CATEGORY_REGEXES in inferToolMetadata — keep in sync!
 */
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/\b(?:buy|sell|orders?|trades?|trading|swap|long|short|close|execute|cancel|bridge|bet|dca|limit|arb|arbitrage)\b/i, 'trading'],
  [/\b(?:pool|liquidity|farm|lp|harvest|stake|reward|fee|claim)\b/i, 'defi'],
  [/\b(?:positions?|balances?|portfolio|pnl|profit|margin|leverage|collateral)\b|how much (?:do i|did i|am i|have)\b/i, 'portfolio'],
  [/\b(?:prices?|quote|chart|orderbook|ticker|volume|spread|candlestick|midpoint|worth)\b/i, 'market_data'],
  [/\b(?:credentials?|api[\s._-]?key|setup|login|connect|config(?:ure)?)\b/i, 'admin'],
  [/\b(?:file|shell|docker|email|sms|sql|webhook|deploy)\b/i, 'infrastructure'],
  [/\b(?:alerts?|watch|whale|notifications?|news|monitor(?:ing)?|track(?:ing)?)\b/i, 'alerts'],
];

/**
 * Analyze a user message and return platform/category hints for tool preloading.
 * Returns the detected platforms and categories to preload tools for.
 */
export function detectToolHints(message: string): { platforms: string[]; categories: string[]; hasIntent: boolean } {
  const platforms = new Set<string>();
  const categories = new Set<string>();

  for (const [pattern, platform] of PLATFORM_KEYWORDS) {
    if (pattern.test(message)) {
      platforms.add(platform);
    }
  }

  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(message)) {
      categories.add(category);
    }
  }

  return {
    platforms: Array.from(platforms),
    categories: Array.from(categories),
    hasIntent: categories.size > 0,
  };
}

/**
 * Core tool names that are always sent with every API call.
 * These cover the most common use cases without needing tool_search.
 */
export const CORE_TOOL_NAMES = new Set([
  // Market discovery (6)
  'search_markets',
  'get_market',
  'market_index_search',
  'market_index_stats',
  'find_arbitrage',
  'compare_prices',

  // Portfolio (3)
  'get_portfolio',
  'get_portfolio_history',
  'add_position',

  // Alerts (3)
  'create_alert',
  'list_alerts',
  'delete_alert',

  // News (2)
  'get_recent_news',
  'search_news',

  // Wallet tracking (2)
  'get_wallet_trades',
  'watch_wallet',

  // Session (2)
  'save_session_checkpoint',
  'restore_session_checkpoint',

  // Quick price checks (3)
  'polymarket_price',
  'coingecko_price',
  'solana_address',

  // Meta (1)
  'tool_search',
]);
