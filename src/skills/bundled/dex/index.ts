/**
 * DEX Market Intelligence Skill - Cross-chain, cross-DEX market data
 *
 * Powered by DexScreener (free, no API key required).
 * Works across all chains: Solana, Ethereum, BSC, Base, Arbitrum, etc.
 *
 * Commands:
 *
 * DISCOVERY:
 * /dex trending [chain]           - Top tokens by 24h volume
 * /dex gainers [chain]            - Top 24h price gainers
 * /dex losers [chain]             - Top 24h price losers
 * /dex hot [chain]                - Most active right now (1h transactions)
 * /dex new [chain]                - Newest token profiles
 * /dex boosted                    - DexScreener trending/boosted tokens
 *
 * TOKEN DATA:
 * /dex token <address> [chain]    - Full token stats (price, vol, liq, txns)
 * /dex pairs <address> [chain]    - All trading pairs for a token
 * /dex search <query>             - Search any token across all chains
 *
 * FILTERS (chain OR protocol):
 *   Chains: solana, ethereum, bsc, base, arbitrum, polygon, avalanche, optimism, sui, aptos, ton
 *   Solana DEXes: pumpfun, pumpswap, raydium, orca, meteora
 *   Base protocols: virtuals, clanker, aerodrome
 *   Ethereum: uniswap, sushiswap, curve
 *   BSC: pancakeswap
 */

const DEXSCREENER_API = 'https://api.dexscreener.com';

// ============================================================================
// Types
// ============================================================================

interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd?: string | null;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: { m5: number; h1: number; h6: number; h24: number };
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  liquidity?: { usd: number; base: number; quote: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  labels?: string[];
}

interface TokenBoost {
  url: string;
  chainId: string;
  tokenAddress: string;
  description?: string;
  totalAmount: number;
  icon?: string;
}

interface TokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  description?: string;
  icon?: string;
  links?: Array<{ type?: string; url: string }>;
}

// ============================================================================
// Helpers
// ============================================================================

const CHAIN_ALIASES: Record<string, string> = {
  sol: 'solana', solana: 'solana',
  eth: 'ethereum', ethereum: 'ethereum',
  bsc: 'bsc', bnb: 'bsc',
  base: 'base',
  arb: 'arbitrum', arbitrum: 'arbitrum',
  polygon: 'polygon', matic: 'polygon',
  avax: 'avalanche', avalanche: 'avalanche',
  op: 'optimism', optimism: 'optimism',
  sui: 'sui',
  aptos: 'aptos',
  ton: 'ton',
  near: 'near',
  sei: 'seiv2',
  cronos: 'cronos',
  tron: 'tron',
  pulsechain: 'pulsechain',
  linea: 'linea',
  zksync: 'zksync',
  manta: 'manta',
  ink: 'ink',
};

// DEX/Protocol aliases → { chain, dexId } or search term
// When a user says "/dex trending pumpfun", we filter by dexId
const DEX_ALIASES: Record<string, { chain: string; dexId?: string; search?: string }> = {
  // Solana DEXes
  pumpfun: { chain: 'solana', dexId: 'pumpfun' },
  'pump.fun': { chain: 'solana', dexId: 'pumpfun' },
  pump: { chain: 'solana', dexId: 'pumpfun' },
  pumpswap: { chain: 'solana', dexId: 'pumpswap' },
  raydium: { chain: 'solana', dexId: 'raydium' },
  orca: { chain: 'solana', dexId: 'orca' },
  meteora: { chain: 'solana', dexId: 'meteora' },
  jupiter: { chain: 'solana', search: 'jupiter' }, // Aggregator — routes through multiple DEXes

  // Base DEXes
  aerodrome: { chain: 'base', dexId: 'aerodrome' },
  virtuals: { chain: 'base', search: 'virtuals' },
  clanker: { chain: 'base', search: 'clanker' },

  // Ethereum DEXes
  uniswap: { chain: 'ethereum', dexId: 'uniswap' },
  sushiswap: { chain: 'ethereum', dexId: 'sushiswap' },
  curve: { chain: 'ethereum', dexId: 'curve' },

  // BSC DEXes
  pancakeswap: { chain: 'bsc', dexId: 'pancakeswap' },
  pancake: { chain: 'bsc', dexId: 'pancakeswap' },

  // Other
  velodrome: { chain: 'optimism', dexId: 'velodrome' },
  traderjoe: { chain: 'avalanche', dexId: 'traderjoe' },
};

interface Filter {
  chain?: string;
  dexId?: string;
  search?: string;
  label: string;
}

function resolveFilter(input?: string): Filter {
  if (!input) return { label: 'All Chains' };
  const lower = input.toLowerCase();

  // Check DEX aliases first (more specific)
  const dex = DEX_ALIASES[lower];
  if (dex) {
    return {
      chain: dex.chain,
      dexId: dex.dexId,
      search: dex.search,
      label: input.charAt(0).toUpperCase() + input.slice(1),
    };
  }

  // Then chain aliases
  const chain = CHAIN_ALIASES[lower] || lower;
  return { chain, label: chainEmoji(chain) };
}

function formatUsd(n: number, naIfZero = false): string {
  if (naIfZero && (!n || n === 0)) return 'N/A';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPrice(price: string | number | null | undefined): string {
  if (price == null || price === '') return 'N/A';
  const p = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(p)) return 'N/A';
  if (p === 0) return '$0';
  if (p < 0.000001) return `$${p.toExponential(2)}`;
  if (p < 0.01) return `$${p.toFixed(8)}`;
  if (p < 1) return `$${p.toFixed(6)}`;
  if (p < 1000) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(2)}`;
}

function chainEmoji(chain: string): string {
  const emojis: Record<string, string> = {
    solana: 'SOL', ethereum: 'ETH', bsc: 'BSC', base: 'BASE',
    arbitrum: 'ARB', polygon: 'POLY', avalanche: 'AVAX',
    optimism: 'OP', sui: 'SUI', aptos: 'APT', ton: 'TON',
  };
  return emojis[chain] || chain.toUpperCase();
}

async function dexRequest<T>(endpoint: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(`${DEXSCREENER_API}${endpoint}`, { signal: controller.signal });
    if (!resp.ok) {
      if (resp.status === 429) throw new Error('DexScreener rate limit hit. Try again in a minute.');
      throw new Error(`DexScreener error: ${resp.status}`);
    }
    return resp.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

// Deduplicate pairs — keep highest volume pair per base token
function dedupeByToken(pairs: DexPair[]): DexPair[] {
  const map = new Map<string, DexPair>();
  for (const p of pairs) {
    const key = `${p.chainId}:${p.baseToken.address}`;
    const existing = map.get(key);
    if (!existing || (p.volume?.h24 || 0) > (existing.volume?.h24 || 0)) {
      map.set(key, p);
    }
  }
  return [...map.values()];
}

// ============================================================================
// Discovery Handlers
// ============================================================================

// Fetch enriched pairs for a filter — either from boosted tokens or search
async function fetchFilteredPairs(filter: Filter): Promise<DexPair[]> {
  // If filter has a search term (e.g. "virtuals", "clanker"), use DexScreener search
  if (filter.search) {
    const data = await dexRequest<{ pairs: DexPair[] }>(`/latest/dex/search?q=${encodeURIComponent(filter.search)}`);
    let pairs = data.pairs || [];
    if (filter.chain) pairs = pairs.filter(p => p.chainId === filter.chain);
    if (filter.dexId) pairs = pairs.filter(p => p.dexId === filter.dexId);
    return dedupeByToken(pairs);
  }

  // Otherwise use boosted tokens as the source, then enrich
  const boosts = await dexRequest<TokenBoost[]>('/token-boosts/top/v1');
  let filtered = boosts || [];
  if (filter.chain) filtered = filtered.filter(b => b.chainId === filter.chain);

  if (!filtered.length) return [];

  const topTokens = filtered.slice(0, 15);
  const pairsByChain = new Map<string, string[]>();
  for (const t of topTokens) {
    const list = pairsByChain.get(t.chainId) || [];
    list.push(t.tokenAddress);
    pairsByChain.set(t.chainId, list);
  }

  const allPairs: DexPair[] = [];
  const chainResults = await Promise.allSettled(
    [...pairsByChain.entries()].map(([c, addrs]) =>
      dexRequest<DexPair[]>(`/tokens/v1/${c}/${addrs.join(',')}`)
    )
  );
  for (const r of chainResults) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) allPairs.push(...r.value);
  }

  let result = allPairs;
  if (filter.dexId) result = result.filter(p => p.dexId === filter.dexId);

  return dedupeByToken(result);
}

async function handleTrending(args: string[]): Promise<string> {
  const filter = resolveFilter(args[0]);

  try {
    const deduped = await fetchFilteredPairs(filter);
    deduped.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));

    if (!deduped.length) return `No trending tokens found on ${filter.label}. Try: /dex trending`;

    let output = `**Trending on ${filter.label} (24h Volume)**\n\n`;

    for (let i = 0; i < Math.min(deduped.length, 15); i++) {
      const p = deduped[i];
      const change = p.priceChange?.h24 || 0;
      const changeStr = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
      output += `${i + 1}. **${p.baseToken.symbol}** [${chainEmoji(p.chainId)}]\n`;
      output += `   ${formatPrice(p.priceUsd)} | MCap: ${formatUsd(p.marketCap || p.fdv || 0, true)}`;
      output += ` | Vol: ${formatUsd(p.volume?.h24 || 0)} | ${changeStr}\n`;
      output += `   ${p.dexId} | \`${p.baseToken.address.slice(0, 20)}...\`\n\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleGainers(args: string[]): Promise<string> {
  const filter = resolveFilter(args[0]);

  try {
    const deduped = await fetchFilteredPairs(filter);
    deduped.sort((a, b) => (b.priceChange?.h24 || 0) - (a.priceChange?.h24 || 0));

    if (!deduped.length) return `No gainer data on ${filter.label}.`;

    let output = `**Top Gainers on ${filter.label} (24h)**\n\n`;

    for (let i = 0; i < Math.min(deduped.length, 15); i++) {
      const p = deduped[i];
      const change = p.priceChange?.h24 || 0;
      const arrow = change >= 0 ? '📈' : '📉';
      output += `${i + 1}. ${arrow} **${p.baseToken.symbol}** [${chainEmoji(p.chainId)}] ${change >= 0 ? '+' : ''}${change.toFixed(1)}%\n`;
      output += `   ${formatPrice(p.priceUsd)} | MCap: ${formatUsd(p.marketCap || p.fdv || 0, true)} | Vol: ${formatUsd(p.volume?.h24 || 0)}\n`;
      output += `   ${p.dexId} | \`${p.baseToken.address.slice(0, 20)}...\`\n\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleLosers(args: string[]): Promise<string> {
  const filter = resolveFilter(args[0]);

  try {
    const deduped = await fetchFilteredPairs(filter);
    deduped.sort((a, b) => (a.priceChange?.h24 || 0) - (b.priceChange?.h24 || 0));

    if (!deduped.length) return `No loser data on ${filter.label}.`;

    let output = `**Top Losers on ${filter.label} (24h)**\n\n`;

    for (let i = 0; i < Math.min(deduped.length, 15); i++) {
      const p = deduped[i];
      const change = p.priceChange?.h24 || 0;
      output += `${i + 1}. 📉 **${p.baseToken.symbol}** [${chainEmoji(p.chainId)}] ${change.toFixed(1)}%\n`;
      output += `   ${formatPrice(p.priceUsd)} | MCap: ${formatUsd(p.marketCap || p.fdv || 0, true)} | Vol: ${formatUsd(p.volume?.h24 || 0)}\n`;
      output += `   ${p.dexId} | \`${p.baseToken.address.slice(0, 20)}...\`\n\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleHot(args: string[]): Promise<string> {
  const filter = resolveFilter(args[0]);

  try {
    const deduped = await fetchFilteredPairs(filter);
    deduped.sort((a, b) => {
      const aTxns = (a.txns?.h1?.buys || 0) + (a.txns?.h1?.sells || 0);
      const bTxns = (b.txns?.h1?.buys || 0) + (b.txns?.h1?.sells || 0);
      return bTxns - aTxns;
    });

    if (!deduped.length) return `No activity data on ${filter.label}.`;

    let output = `**Hottest Right Now on ${filter.label} (1h Activity)**\n\n`;

    for (let i = 0; i < Math.min(deduped.length, 15); i++) {
      const p = deduped[i];
      const txns1h = (p.txns?.h1?.buys || 0) + (p.txns?.h1?.sells || 0);
      const change1h = p.priceChange?.h1 || 0;
      output += `${i + 1}. **${p.baseToken.symbol}** [${chainEmoji(p.chainId)}] - ${txns1h.toLocaleString()} txns/1h\n`;
      output += `   ${formatPrice(p.priceUsd)} | 1h Vol: ${formatUsd(p.volume?.h1 || 0)}`;
      output += ` | 1h: ${change1h >= 0 ? '+' : ''}${change1h.toFixed(1)}%\n`;
      output += `   ${p.dexId} | \`${p.baseToken.address.slice(0, 20)}...\`\n\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleNew(args: string[]): Promise<string> {
  const filter = resolveFilter(args[0]);
  const chain = filter.chain;

  try {
    const profiles = await dexRequest<TokenProfile[]>('/token-profiles/latest/v1');

    let filtered = profiles || [];
    if (chain) {
      filtered = filtered.filter(p => p.chainId === chain);
    }

    if (!filtered.length) {
      return chain
        ? `No new token profiles on ${chain}.`
        : 'No new token profiles found.';
    }

    // Get pair data for enrichment
    const topTokens = filtered.slice(0, 12);
    const pairsByChain = new Map<string, string[]>();
    for (const t of topTokens) {
      const list = pairsByChain.get(t.chainId) || [];
      list.push(t.tokenAddress);
      pairsByChain.set(t.chainId, list);
    }

    const allPairs: DexPair[] = [];
    const newChainResults = await Promise.allSettled(
      [...pairsByChain.entries()].map(([c, addrs]) =>
        dexRequest<DexPair[]>(`/tokens/v1/${c}/${addrs.join(',')}`)
      )
    );
    for (const r of newChainResults) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) allPairs.push(...r.value);
    }

    const pairMap = new Map<string, DexPair>();
    for (const p of allPairs) {
      const key = `${p.chainId}:${p.baseToken.address}`;
      const existing = pairMap.get(key);
      if (!existing || (p.volume?.h24 || 0) > (existing.volume?.h24 || 0)) {
        pairMap.set(key, p);
      }
    }

    const title = chain ? `New Tokens on ${chainEmoji(chain)}` : 'Newest Token Profiles (All Chains)';
    let output = `**${title}**\n\n`;

    for (let i = 0; i < Math.min(topTokens.length, 15); i++) {
      const t = topTokens[i];
      const pair = pairMap.get(`${t.chainId}:${t.tokenAddress}`);
      output += `${i + 1}. **${pair?.baseToken.symbol || '???'}** [${chainEmoji(t.chainId)}]`;
      if (pair) {
        output += ` - ${formatPrice(pair.priceUsd)}`;
        output += `\n   MCap: ${formatUsd(pair.marketCap || pair.fdv || 0)} | Vol: ${formatUsd(pair.volume?.h24 || 0)}`;
        const change = pair.priceChange?.h24 || 0;
        output += ` | 24h: ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
      }
      if (t.description) output += `\n   ${t.description.slice(0, 80)}${t.description.length > 80 ? '...' : ''}`;
      output += `\n   \`${t.tokenAddress.slice(0, 20)}...\`\n\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBoosted(): Promise<string> {
  try {
    const boosts = await dexRequest<TokenBoost[]>('/token-boosts/top/v1');

    if (!boosts?.length) return 'No boosted tokens found.';

    let output = '**DexScreener Boosted/Trending**\n\n';
    for (let i = 0; i < Math.min(boosts.length, 15); i++) {
      const b = boosts[i];
      output += `${i + 1}. [${chainEmoji(b.chainId)}] \`${b.tokenAddress.slice(0, 20)}...\`\n`;
      output += `   Boost: ${b.totalAmount}`;
      if (b.description) output += ` | ${b.description.slice(0, 60)}${b.description.length > 60 ? '...' : ''}`;
      output += '\n\n';
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Token Data Handlers
// ============================================================================

function detectChain(address: string): string {
  if (address.startsWith('0x')) return 'ethereum';
  return 'solana';
}

async function handleToken(args: string[]): Promise<string> {
  if (!args[0]) return 'Usage: /dex token <address> [chain]';

  const address = args[0];
  const filter = resolveFilter(args[1]);
  const chain = filter.chain || detectChain(address);

  try {
    const pairs = await dexRequest<DexPair[]>(`/tokens/v1/${chain}/${address}`);

    if (!Array.isArray(pairs) || !pairs.length) {
      return `No data found for \`${address.slice(0, 20)}...\` on ${chain}.`;
    }

    // Use highest volume pair
    pairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
    const p = pairs[0];
    const txns24h = (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0);
    const txns1h = (p.txns?.h1?.buys || 0) + (p.txns?.h1?.sells || 0);

    let output = `**${p.baseToken.symbol} / ${p.quoteToken.symbol}** [${chainEmoji(p.chainId)}]\n\n`;
    output += `**Price:** ${formatPrice(p.priceUsd)}\n`;
    output += `**Market Cap:** ${formatUsd(p.marketCap || p.fdv || 0)}\n`;
    output += `**Liquidity:** ${formatUsd(p.liquidity?.usd || 0)}\n`;
    output += `**DEX:** ${p.dexId}\n\n`;

    output += '**Volume:**\n';
    output += `  24h: ${formatUsd(p.volume?.h24 || 0)}\n`;
    output += `  6h: ${formatUsd(p.volume?.h6 || 0)}\n`;
    output += `  1h: ${formatUsd(p.volume?.h1 || 0)}\n`;
    output += `  5m: ${formatUsd(p.volume?.m5 || 0)}\n\n`;

    output += '**Price Change:**\n';
    output += `  24h: ${(p.priceChange?.h24 || 0) >= 0 ? '+' : ''}${(p.priceChange?.h24 || 0).toFixed(2)}%\n`;
    output += `  6h: ${(p.priceChange?.h6 || 0) >= 0 ? '+' : ''}${(p.priceChange?.h6 || 0).toFixed(2)}%\n`;
    output += `  1h: ${(p.priceChange?.h1 || 0) >= 0 ? '+' : ''}${(p.priceChange?.h1 || 0).toFixed(2)}%\n`;
    output += `  5m: ${(p.priceChange?.m5 || 0) >= 0 ? '+' : ''}${(p.priceChange?.m5 || 0).toFixed(2)}%\n\n`;

    output += '**Transactions:**\n';
    output += `  24h: ${txns24h.toLocaleString()} (${p.txns?.h24?.buys || 0} buys / ${p.txns?.h24?.sells || 0} sells)\n`;
    output += `  1h: ${txns1h.toLocaleString()} (${p.txns?.h1?.buys || 0} buys / ${p.txns?.h1?.sells || 0} sells)\n\n`;

    if (pairs.length > 1) {
      output += `**Other Pairs:** ${pairs.length - 1} more on ${[...new Set(pairs.map(pp => pp.dexId))].join(', ')}\n\n`;
    }

    output += `Pair: \`${p.pairAddress}\`\nToken: \`${address}\``;
    if (p.url) output += `\n\n${p.url}`;

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePairs(args: string[]): Promise<string> {
  if (!args[0]) return 'Usage: /dex pairs <address> [chain]';

  const address = args[0];
  const filter = resolveFilter(args[1]);
  const chain = filter.chain || detectChain(address);

  try {
    const pairs = await dexRequest<DexPair[]>(`/tokens/v1/${chain}/${address}`);

    if (!Array.isArray(pairs) || !pairs.length) {
      return `No pairs found for \`${address.slice(0, 20)}...\` on ${chain}.`;
    }

    pairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));

    let output = `**${pairs[0].baseToken.symbol} Trading Pairs** [${chainEmoji(chain)}]\n\n`;
    output += `Total: ${pairs.length} pairs\n\n`;

    for (let i = 0; i < Math.min(pairs.length, 10); i++) {
      const p = pairs[i];
      output += `${i + 1}. **${p.baseToken.symbol}/${p.quoteToken.symbol}** on ${p.dexId}\n`;
      output += `   ${formatPrice(p.priceUsd)} | Vol: ${formatUsd(p.volume?.h24 || 0)} | Liq: ${formatUsd(p.liquidity?.usd || 0)}\n`;
      output += `   \`${p.pairAddress.slice(0, 20)}...\`\n\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePrice(query: string): Promise<string> {
  if (!query) return 'Usage: /dex price <symbol>\nExample: /dex price SOL';

  try {
    const data = await dexRequest<{ pairs: DexPair[] }>(`/latest/dex/search?q=${encodeURIComponent(query)}`);

    if (!data.pairs?.length) return `No results for "${query}".`;

    // Pick highest-volume pair
    const deduped = dedupeByToken(data.pairs);
    deduped.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
    const p = deduped[0];
    const change = p.priceChange?.h24 || 0;

    let output = `**${p.baseToken.symbol}** (${p.baseToken.name}) [${chainEmoji(p.chainId)}]\n\n`;
    output += `**Price:** ${formatPrice(p.priceUsd)}\n`;
    output += `**Market Cap:** ${formatUsd(p.marketCap || p.fdv || 0, true)}\n`;
    output += `**24h Change:** ${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n`;
    output += `**24h Volume:** ${formatUsd(p.volume?.h24 || 0)}\n`;
    output += `**Liquidity:** ${formatUsd(p.liquidity?.usd || 0)}\n`;
    output += `**DEX:** ${p.dexId}\n`;
    output += `\n\`${p.baseToken.address}\``;
    if (p.url) output += `\n${p.url}`;

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSearch(query: string): Promise<string> {
  if (!query) return 'Usage: /dex search <query>';

  try {
    const data = await dexRequest<{ pairs: DexPair[] }>(`/latest/dex/search?q=${encodeURIComponent(query)}`);

    if (!data.pairs?.length) return `No results for "${query}".`;

    const deduped = dedupeByToken(data.pairs);
    deduped.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));

    let output = `**Search: "${query}"**\n\n`;

    for (let i = 0; i < Math.min(deduped.length, 15); i++) {
      const p = deduped[i];
      const change = p.priceChange?.h24 || 0;
      output += `${i + 1}. **${p.baseToken.symbol}** - ${p.baseToken.name} [${chainEmoji(p.chainId)}]\n`;
      output += `   ${formatPrice(p.priceUsd)} | MCap: ${formatUsd(p.marketCap || p.fdv || 0, true)}`;
      output += ` | Vol: ${formatUsd(p.volume?.h24 || 0)} | ${change >= 0 ? '+' : ''}${change.toFixed(1)}%\n`;
      output += `   DEX: ${p.dexId} | \`${p.baseToken.address.slice(0, 20)}...\`\n\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Main Execute Function
// ============================================================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    // Discovery
    case 'trending':
      return handleTrending(rest);
    case 'gainers':
      return handleGainers(rest);
    case 'losers':
      return handleLosers(rest);
    case 'hot':
      return handleHot(rest);
    case 'new':
      return handleNew(rest);
    case 'boosted':
      return handleBoosted();

    // Token Data
    case 'token':
    case 'info':
      return handleToken(rest);
    case 'pairs':
      return handlePairs(rest);
    case 'price':
      return handlePrice(rest.join(' '));
    case 'search':
      return handleSearch(rest.join(' '));

    case 'help':
    default:
      return `**DEX Market Intelligence (10 Commands)**

Powered by DexScreener - works across all chains and DEXes, no API key.

**Discovery:**
  /dex trending [filter]          Top tokens by 24h volume
  /dex gainers [filter]           Top 24h price gainers
  /dex losers [filter]            Top 24h price losers
  /dex hot [filter]               Most active right now (1h txns)
  /dex new [filter]               Newest token profiles
  /dex boosted                    DexScreener trending tokens

**Token Data:**
  /dex price <symbol>             Quick price lookup by name/symbol
  /dex token <address> [chain]    Full stats (price, vol, liq, txns)
  /dex pairs <address> [chain]    All trading pairs for a token
  /dex search <query>             Search any token across all chains

**Filter = chain OR protocol:**
  Chains: solana, ethereum, bsc, base, arbitrum, polygon, avalanche, optimism, sui, aptos, ton
  Solana DEXes: pumpfun, pumpswap, raydium, orca, meteora, jupiter
  Base: virtuals, clanker, aerodrome
  Ethereum: uniswap, sushiswap, curve
  BSC: pancakeswap

**Examples:**
  /dex price SOL
  /dex trending solana
  /dex trending pumpfun
  /dex gainers virtuals
  /dex hot base
  /dex token <address> eth
  /dex search PEPE`;
  }
}

export default {
  name: 'dex',
  description: 'Cross-chain DEX market intelligence - trending, gainers, losers, volume, stats via DexScreener',
  commands: ['/dex', '/dexscreener'],
  handle: execute,
};
