/**
 * Pump.fun CLI Skill - Complete API Coverage
 *
 * Solana memecoin launchpad with bonding curve trading.
 *
 * Trading API: PumpPortal (pumpportal.fun)
 * Data API: PumpPortal WebSocket + Pump.fun Frontend API
 *
 * Commands:
 *
 * TRADING:
 * /pump buy <mint> <amount> [--pool <pool>] [--slippage <bps>] [--priority <lamports>]
 * /pump sell <mint> <amount|%> [--pool <pool>] [--slippage <bps>]
 * /pump quote <mint> <amount> <action>
 *
 * DISCOVERY:
 * /pump trending - Top tokens by 24h volume (via DexScreener)
 * /pump gainers - Top 24h price gainers
 * /pump losers - Top 24h price losers
 * /pump hot - Most active right now (1h transactions)
 * /pump new-hot - Hottest new tokens by volume
 * /pump new - Recently created tokens
 * /pump live - Currently trading tokens
 * /pump graduated - Tokens migrated to PumpSwap
 * /pump search <query> - Search tokens
 * /pump volatile - High volatility tokens
 * /pump koth - King of the Hill tokens (30-35K mcap)
 *
 * TOKEN DATA:
 * /pump stats <mint> - Volume, txns, liquidity, price change (DexScreener)
 *
 * TOKEN DATA:
 * /pump token <mint> - Full token info (metadata, price, holders, liquidity)
 * /pump price <mint> - Current price and OHLCV
 * /pump holders <mint> - Top holders
 * /pump trades <mint> [--limit N] - Recent trades
 * /pump chart <mint> [--interval 1m|5m|15m|1h|4h|1d] - Price chart data
 *
 * CREATION:
 * /pump create <name> <symbol> <description> [--image <url>] [--twitter <url>]
 * /pump claim <mint> - Claim creator fees
 *
 * MONITORING:
 * /pump watch <mint> - Watch token for trades (WebSocket)
 * /pump snipe <symbol> - Wait for token with symbol to launch
 */

const PUMPPORTAL_API = 'https://pumpportal.fun/api';
const PUMPFUN_FRONTEND_API = 'https://frontend-api-v3.pump.fun';
const PUMPFUN_ADVANCED_API = 'https://advanced-api-v2.pump.fun';

// ============================================================================
// Types
// ============================================================================

interface PumpToken {
  mint: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  creator?: string;
  createdAt?: string;
  marketCap?: number;
  price?: number;
  priceUsd?: number;
  liquidity?: number;
  volume24h?: number;
  holders?: number;
  graduated?: boolean;
  bondingCurveProgress?: number;
}

interface PumpTrade {
  signature: string;
  mint: string;
  type: 'buy' | 'sell';
  solAmount: number;
  tokenAmount: number;
  pricePerToken: number;
  wallet: string;
  timestamp: number;
}

interface PumpHolder {
  wallet: string;
  balance: number;
  percentage: number;
  isCreator?: boolean;
}

interface PumpOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================================================
// Helpers
// ============================================================================

function getSolanaModules() {
  return Promise.all([
    import('../../../solana/wallet'),
    import('../../../solana/pumpapi'),
  ]).then(([wallet, pumpapi]) => ({ wallet, pumpapi }));
}

function isConfigured(): boolean {
  return !!(process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_KEYPAIR_PATH);
}

async function pumpPortalRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const apiKey = process.env.PUMPPORTAL_API_KEY;
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = apiKey ? `${PUMPPORTAL_API}${endpoint}${separator}api-key=${apiKey}` : `${PUMPPORTAL_API}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PumpPortal error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

async function pumpFrontendRequest<T>(endpoint: string, baseUrl: string = PUMPFUN_FRONTEND_API): Promise<T> {
  const jwt = process.env.PUMPFUN_JWT;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Origin': 'https://pump.fun',
  };
  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, { headers });

  if (!response.ok) {
    throw new Error(`Pump.fun API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function pumpAdvancedRequest<T>(endpoint: string): Promise<T> {
  return pumpFrontendRequest<T>(endpoint, PUMPFUN_ADVANCED_API);
}

function intervalToTimeframe(interval: string): number {
  switch (interval) {
    case '1m': return 60;
    case '5m': return 300;
    case '15m': return 900;
    case '1h': return 3600;
    case '4h': return 14400;
    case '1d': return 86400;
    default: return 3600;
  }
}

function formatPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(2);
  if (price < 0.01) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

function formatMarketCap(mcap: number): string {
  if (mcap >= 1_000_000_000) return `$${(mcap / 1_000_000_000).toFixed(2)}B`;
  if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(2)}M`;
  if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
  return `$${mcap.toFixed(0)}`;
}

function formatPriceUsd(priceStr: string): string {
  if (!priceStr || priceStr === '0') return 'N/A';
  const p = parseFloat(priceStr);
  if (isNaN(p) || p === 0) return 'N/A';
  if (p < 0.000001) return `$${p.toExponential(2)}`;
  if (p < 0.01) return `$${p.toFixed(8)}`;
  if (p < 1) return `$${p.toFixed(6)}`;
  return `$${p.toFixed(4)}`;
}

// ============================================================================
// Trading Handlers
// ============================================================================

async function handleBuy(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Pump.fun not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return `Usage: /pump buy <mint> <amount> [options]

Options:
  --pool <pool>       Pool: pump, raydium, pump-amm, launchlab, raydium-cpmm, bonk, auto (default: pump)
  --slippage <bps>    Slippage in bps (default: 500 = 5%)
  --priority <lamps>  Priority fee in lamports

Examples:
  /pump buy ABC123... 0.1
  /pump buy ABC123... 0.5 --pool auto --slippage 1000`;
  }

  const mint = args[0];
  const amount = args[1];

  // Parse options
  let pool = 'pump';
  let slippageBps = 500;
  let priorityFee: number | undefined;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--pool' && args[i + 1]) { pool = args[++i]; }
    else if (args[i] === '--slippage' && args[i + 1]) { slippageBps = parseInt(args[++i], 10); }
    else if (args[i] === '--priority' && args[i + 1]) { priorityFee = parseInt(args[++i], 10); }
  }

  if (isNaN(slippageBps)) slippageBps = 500;
  if (priorityFee !== undefined && isNaN(priorityFee)) priorityFee = undefined;

  try {
    const { wallet, pumpapi } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await pumpapi.executePumpFunTrade(connection, keypair, {
      action: 'buy',
      mint,
      amount,
      denominatedInSol: true,
      slippageBps,
      priorityFeeLamports: priorityFee,
      pool,
    });

    return `**Pump.fun Buy Complete**

Token: \`${mint.slice(0, 20)}...\`
SOL Spent: ${amount}
Pool: ${pool}
Slippage: ${slippageBps / 100}%
TX: \`${result.signature}\``;
  } catch (error) {
    return `Buy failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSell(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Pump.fun not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 2) {
    return `Usage: /pump sell <mint> <amount|%> [options]

Amount can be:
  - Token amount: 1000000
  - Percentage: 50% or 100%

Options:
  --pool <pool>       Pool: pump, raydium, pump-amm, launchlab, raydium-cpmm, bonk, auto (default: pump)
  --slippage <bps>    Slippage in bps (default: 1000 = 10%)

Examples:
  /pump sell ABC123... 1000000
  /pump sell ABC123... 100%
  /pump sell ABC123... 50% --slippage 1500`;
  }

  const mint = args[0];
  let amount = args[1];

  let pool = 'pump';
  let slippageBps = 1000; // Higher default for sells

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--pool' && args[i + 1]) { pool = args[++i]; }
    else if (args[i] === '--slippage' && args[i + 1]) { slippageBps = parseInt(args[++i], 10); }
  }

  if (isNaN(slippageBps)) slippageBps = 1000;

  try {
    const { wallet, pumpapi } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    const result = await pumpapi.executePumpFunTrade(connection, keypair, {
      action: 'sell',
      mint,
      amount,
      denominatedInSol: false,
      slippageBps,
      pool,
    });

    return `**Pump.fun Sell Complete**

Token: \`${mint.slice(0, 20)}...\`
Amount: ${amount}
Pool: ${pool}
TX: \`${result.signature}\``;
  } catch (error) {
    return `Sell failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleQuote(args: string[]): Promise<string> {
  if (args.length < 3) {
    return 'Usage: /pump quote <mint> <amount> <buy|sell>';
  }

  const [mint, amountStr, action] = args;
  const amount = parseFloat(amountStr);

  if (isNaN(amount) || amount <= 0) {
    return 'Invalid amount. Must be a positive number.';
  }

  const actionUpper = action.toUpperCase();

  try {
    const { wallet, pumpapi } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    // Try on-chain quote first (more accurate)
    const state = await pumpapi.getBondingCurveState(connection, mint);

    if (state && !state.complete) {
      // Use on-chain bonding curve calculation
      const BN = (await import('bn.js')).default;
      const currentPrice = pumpapi.calculatePrice(state);

      if (actionUpper === 'BUY') {
        const solLamports = new BN(Math.floor(amount * 1e9));
        const quote = pumpapi.calculateBuyQuote(state, solLamports, 100);
        const tokensOut = quote.tokensOut.toNumber() / 1e6;
        const feeSOL = quote.fee.toNumber() / 1e9;

        return `**Pump.fun Quote (On-Chain)**

Token: \`${mint.slice(0, 20)}...\`
Action: BUY

**Input:** ${amount} SOL
**Output:** ${tokensOut.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens
**Fee (1%):** ${feeSOL.toFixed(6)} SOL
**Price Impact:** ${quote.priceImpact.toFixed(2)}%
**Price After:** ${formatPrice(quote.newPrice)} SOL

Current Price: ${formatPrice(currentPrice)} SOL`;
      } else {
        const tokenLamports = new BN(Math.floor(amount * 1e6));
        const quote = pumpapi.calculateSellQuote(state, tokenLamports, 100);
        const solOut = quote.solOut.toNumber() / 1e9;
        const feeSOL = quote.fee.toNumber() / 1e9;

        return `**Pump.fun Quote (On-Chain)**

Token: \`${mint.slice(0, 20)}...\`
Action: SELL

**Input:** ${amount.toLocaleString()} tokens
**Output:** ${solOut.toFixed(6)} SOL
**Fee (1%):** ${feeSOL.toFixed(6)} SOL
**Price Impact:** ${quote.priceImpact.toFixed(2)}%
**Price After:** ${formatPrice(quote.newPrice)} SOL

Current Price: ${formatPrice(currentPrice)} SOL`;
      }
    }

    // Fallback to API estimate for graduated tokens
    const token = await pumpFrontendRequest<PumpToken>(`/coins/${mint}?sync=true`);

    if (!token?.price) {
      return `Could not get price data for token \`${mint.slice(0, 20)}...\``;
    }

    const pricePerToken = token.price;
    const feeRate = 0.005;

    let inputDesc: string;
    let outputDesc: string;
    let outputAmount: number;
    let fee: number;

    if (actionUpper === 'BUY') {
      fee = amount * feeRate;
      const netSol = amount - fee;
      outputAmount = pricePerToken > 0 ? netSol / pricePerToken : 0;
      inputDesc = `${amount} SOL`;
      outputDesc = `~${outputAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${token.symbol || 'tokens'}`;
    } else {
      const grossSol = amount * pricePerToken;
      fee = grossSol * feeRate;
      outputAmount = grossSol - fee;
      inputDesc = `${amount.toLocaleString()} ${token.symbol || 'tokens'}`;
      outputDesc = `~${outputAmount.toFixed(6)} SOL`;
    }

    return `**Pump.fun Quote (PumpSwap - Graduated)**

Token: **${token.symbol || '?'}** \`${mint.slice(0, 20)}...\`
Action: ${actionUpper}
Price: ${formatPrice(pricePerToken)} SOL${token.priceUsd ? ` ($${formatPrice(token.priceUsd)})` : ''}
MCap: ${formatMarketCap(token.marketCap || 0)}

Input: ${inputDesc}
Output: ${outputDesc}
Fee (0.5%): ${fee.toFixed(6)} SOL

*Token has graduated to PumpSwap. Use Jupiter for best execution.*`;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// DexScreener Enrichment (free, no API key)
// ============================================================================

interface DexPair {
  baseToken: { address: string; symbol: string; name: string };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number; m5?: number };
  txns?: { h24?: { buys: number; sells: number }; h1?: { buys: number; sells: number }; m5?: { buys: number; sells: number } };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  dexId?: string;
  priceUsd?: string;
}

interface EnrichedToken {
  mint: string;
  name: string;
  symbol: string;
  marketCap: number;
  vol24h: number;
  vol1h: number;
  change24h: number;
  change1h: number;
  txns24h: number;
  txns1h: number;
  liquidity: number;
  dex: string;
  priceUsd: string;
}

async function enrichWithDexScreener(mints: string[]): Promise<Map<string, EnrichedToken>> {
  const result = new Map<string, EnrichedToken>();
  if (!mints.length) return result;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let resp: Response;
    try {
      resp = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.join(',')}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) return result;
    const pairs = await resp.json() as DexPair[];
    if (!Array.isArray(pairs)) return result;

    // Keep highest-volume pair per token
    for (const p of pairs) {
      const addr = p.baseToken?.address;
      if (!addr) continue;
      const vol24h = p.volume?.h24 || 0;
      const existing = result.get(addr);
      if (!existing || vol24h > existing.vol24h) {
        const txns24h = p.txns?.h24 ? (p.txns.h24.buys + p.txns.h24.sells) : 0;
        const txns1h = p.txns?.h1 ? (p.txns.h1.buys + p.txns.h1.sells) : 0;
        result.set(addr, {
          mint: addr,
          name: p.baseToken.name,
          symbol: p.baseToken.symbol,
          marketCap: p.marketCap || p.fdv || 0,
          vol24h,
          vol1h: p.volume?.h1 || 0,
          change24h: p.priceChange?.h24 || 0,
          change1h: p.priceChange?.h1 || 0,
          txns24h,
          txns1h,
          liquidity: p.liquidity?.usd || 0,
          dex: p.dexId || 'unknown',
          priceUsd: p.priceUsd || '0',
        });
      }
    }
  } catch { /* best-effort */ }

  return result;
}

async function getTopPumpTokenMints(limit: number = 20, includeActive = true): Promise<string[]> {
  if (!includeActive) {
    // Graduated only
    const tokens = await pumpFrontendRequest<Array<{ mint: string }>>(`/coins?limit=${limit}&offset=0&sort=market_cap&order=DESC&includeNsfw=false&complete=true`);
    return tokens?.map(t => t.mint) || [];
  }

  // Fetch both graduated (by mcap) and active bonding curve tokens for broader coverage
  const [graduated, active] = await Promise.allSettled([
    pumpFrontendRequest<Array<{ mint: string }>>(`/coins?limit=${Math.ceil(limit * 0.6)}&offset=0&sort=market_cap&order=DESC&includeNsfw=false&complete=true`),
    pumpFrontendRequest<Array<{ mint: string }>>(`/coins?limit=${Math.ceil(limit * 0.6)}&offset=0&sort=market_cap&order=DESC&includeNsfw=false&complete=false`),
  ]);

  const mints = new Set<string>();
  if (graduated.status === 'fulfilled') {
    for (const t of graduated.value || []) mints.add(t.mint);
  }
  if (active.status === 'fulfilled') {
    for (const t of active.value || []) mints.add(t.mint);
  }
  return [...mints].slice(0, limit);
}

// ============================================================================
// Discovery Handlers
// ============================================================================

async function handleTrending(): Promise<string> {
  try {
    const mints = await getTopPumpTokenMints(20);
    if (!mints.length) return 'No trending tokens found.';

    const dex = await enrichWithDexScreener(mints);
    const tokens = [...dex.values()].sort((a, b) => b.vol24h - a.vol24h).slice(0, 15);

    if (!tokens.length) return 'No trending tokens found.';

    let output = '**Trending on Pump.fun (24h Volume)**\n\n';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const changeStr = t.change24h ? ` | 24h: ${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(1)}%` : '';
      output += `${i + 1}. **${t.symbol}** - ${t.name}\n`;
      output += `   MCap: ${formatMarketCap(t.marketCap)}`;
      if (t.vol24h > 0) output += ` | Vol: ${formatMarketCap(t.vol24h)}`;
      output += `${changeStr}\n   \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleGainers(): Promise<string> {
  try {
    const mints = await getTopPumpTokenMints(20);
    if (!mints.length) return 'No tokens found.';

    const dex = await enrichWithDexScreener(mints);
    const tokens = [...dex.values()].sort((a, b) => b.change24h - a.change24h).slice(0, 15);

    if (!tokens.length) return 'No gainer data available.';

    let output = '**Top Gainers on Pump.fun (24h)**\n\n';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const arrow = t.change24h >= 0 ? '📈' : '📉';
      output += `${i + 1}. ${arrow} **${t.symbol}** ${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(1)}%\n`;
      output += `   MCap: ${formatMarketCap(t.marketCap)} | Vol: ${formatMarketCap(t.vol24h)}`;
      output += ` | ${formatPriceUsd(t.priceUsd)}\n`;
      output += `   \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleLosers(): Promise<string> {
  try {
    const mints = await getTopPumpTokenMints(20);
    if (!mints.length) return 'No tokens found.';

    const dex = await enrichWithDexScreener(mints);
    const tokens = [...dex.values()].sort((a, b) => a.change24h - b.change24h).slice(0, 15);

    if (!tokens.length) return 'No loser data available.';

    let output = '**Top Losers on Pump.fun (24h)**\n\n';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const arrow = t.change24h < 0 ? '📉' : '📈';
      output += `${i + 1}. ${arrow} **${t.symbol}** ${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(1)}%\n`;
      output += `   MCap: ${formatMarketCap(t.marketCap)} | Vol: ${formatMarketCap(t.vol24h)}`;
      output += ` | ${formatPriceUsd(t.priceUsd)}\n`;
      output += `   \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleHot(): Promise<string> {
  try {
    const mints = await getTopPumpTokenMints(20);
    if (!mints.length) return 'No tokens found.';

    const dex = await enrichWithDexScreener(mints);
    const tokens = [...dex.values()].sort((a, b) => b.txns1h - a.txns1h).slice(0, 15);

    if (!tokens.length) return 'No activity data available.';

    let output = '**Hottest Right Now on Pump.fun (1h Activity)**\n\n';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const changeStr = t.change1h ? ` | 1h: ${t.change1h >= 0 ? '+' : ''}${t.change1h.toFixed(1)}%` : '';
      output += `${i + 1}. **${t.symbol}** - ${t.txns1h.toLocaleString()} txns/1h\n`;
      output += `   MCap: ${formatMarketCap(t.marketCap)} | 1h Vol: ${formatMarketCap(t.vol1h)}${changeStr}\n`;
      output += `   \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleNewHot(): Promise<string> {
  try {
    // Get recently created tokens from pump.fun
    const tokens = await pumpFrontendRequest<Array<{ mint: string; name: string; symbol: string; created_timestamp?: number }>>('/coins/currently-live?limit=20&offset=0&includeNsfw=false&order=DESC');

    if (!tokens?.length) return 'No new tokens found.';

    const mints = tokens.map(t => t.mint);
    const dex = await enrichWithDexScreener(mints);

    // Merge and sort by volume
    const enriched = tokens
      .map(t => ({ ...t, dex: dex.get(t.mint) }))
      .filter(t => t.dex && t.dex.vol24h > 0)
      .sort((a, b) => (b.dex?.vol24h || 0) - (a.dex?.vol24h || 0))
      .slice(0, 15);

    if (!enriched.length) return 'No new tokens with volume found.';

    let output = '**Hottest New Tokens on Pump.fun**\n\n';
    for (let i = 0; i < enriched.length; i++) {
      const t = enriched[i];
      const d = t.dex!;
      const age = t.created_timestamp ? Math.round((Date.now() - t.created_timestamp) / 3600000) : 0;
      const ageStr = age < 1 ? '<1h' : age < 24 ? `${age}h` : `${Math.round(age / 24)}d`;
      output += `${i + 1}. **${d.symbol}** - ${d.name} (${ageStr} old)\n`;
      output += `   MCap: ${formatMarketCap(d.marketCap)} | Vol: ${formatMarketCap(d.vol24h)}`;
      output += ` | 24h: ${d.change24h >= 0 ? '+' : ''}${d.change24h.toFixed(1)}%\n`;
      output += `   Txns: ${d.txns24h.toLocaleString()} | Liq: ${formatMarketCap(d.liquidity)}\n`;
      output += `   \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleStats(mint: string): Promise<string> {
  if (!mint) return 'Usage: /pump stats <mint>';

  try {
    const dex = await enrichWithDexScreener([mint]);
    const t = dex.get(mint);

    if (!t) return `No market data found for \`${mint.slice(0, 20)}...\``;

    return `**${t.symbol} - Market Stats**

Price: ${formatPriceUsd(t.priceUsd)}
Market Cap: ${formatMarketCap(t.marketCap)}
Liquidity: ${formatMarketCap(t.liquidity)}
DEX: ${t.dex}

**Volume:**
  24h: ${formatMarketCap(t.vol24h)}
  1h: ${formatMarketCap(t.vol1h)}

**Price Change:**
  24h: ${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}%
  1h: ${t.change1h >= 0 ? '+' : ''}${t.change1h.toFixed(2)}%

**Transactions:**
  24h: ${t.txns24h.toLocaleString()}
  1h: ${t.txns1h.toLocaleString()}

\`${mint}\``;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleGraduating(): Promise<string> {
  try {
    // Fetch active bonding curve tokens sorted by market cap (highest = closest to graduating)
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins?limit=50&offset=0&sort=market_cap&order=DESC&includeNsfw=false&complete=false');

    if (!tokens?.length) return 'No active tokens found.';

    // Filter for tokens with high bonding curve progress (>60%)
    const nearGrad = tokens.filter(t =>
      t.bondingCurveProgress !== undefined && t.bondingCurveProgress > 0.6
    );

    if (!nearGrad.length) return 'No tokens near graduation found (>60% bonding curve).';

    // Sort by progress descending
    nearGrad.sort((a, b) => (b.bondingCurveProgress || 0) - (a.bondingCurveProgress || 0));

    let output = '**Near Graduation (Bonding Curve >60%)**\n\n';
    for (const t of nearGrad.slice(0, 15)) {
      const pct = ((t.bondingCurveProgress || 0) * 100).toFixed(1);
      output += `**${t.symbol}** - ${t.name}\n`;
      output += `  Progress: **${pct}%** | MCap: ${formatMarketCap(t.marketCap || 0)}`;
      if (t.holders) output += ` | Holders: ${t.holders}`;
      output += `\n  \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleNew(): Promise<string> {
  try {
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/currently-live?limit=20&offset=0&includeNsfw=false&order=DESC');

    if (!tokens?.length) return 'No new tokens found.';

    let output = '**New Pump.fun Tokens**\n\n';
    for (const t of tokens.slice(0, 15)) {
      output += `**${t.symbol}** - ${t.name}\n`;
      output += `  MCap: ${formatMarketCap(t.marketCap || 0)}`;
      if (t.bondingCurveProgress !== undefined) {
        output += ` | Bonding: ${(t.bondingCurveProgress * 100).toFixed(1)}%`;
      }
      output += `\n  \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleLive(): Promise<string> {
  try {
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/currently-live?limit=20&offset=0&includeNsfw=false');

    if (!tokens?.length) return 'No live tokens found.';

    let output = '**Live on Pump.fun**\n\n';
    for (const t of tokens.slice(0, 15)) {
      output += `**${t.symbol}** - ${t.name}\n`;
      output += `  MCap: ${formatMarketCap(t.marketCap || 0)}`;
      if (t.holders) output += ` | Holders: ${t.holders}`;
      output += `\n  \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleGraduated(): Promise<string> {
  try {
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/graduated?limit=20&offset=0&includeNsfw=false');

    if (!tokens?.length) return 'No graduated tokens found.';

    let output = '**Graduated to PumpSwap**\n\n';
    for (const t of tokens.slice(0, 15)) {
      output += `**${t.symbol}** - ${t.name}\n`;
      output += `  MCap: ${formatMarketCap(t.marketCap || 0)}`;
      if (t.liquidity) output += ` | Liq: ${formatMarketCap(t.liquidity)}`;
      output += `\n  \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSearch(query: string): Promise<string> {
  if (!query) {
    return 'Usage: /pump search <query>';
  }

  try {
    const tokens = await pumpFrontendRequest<PumpToken[]>(`/coins/search?query=${encodeURIComponent(query)}&limit=15&offset=0&includeNsfw=false`);

    if (!tokens?.length) return `No tokens found for "${query}".`;

    let output = `**Search: "${query}"**\n\n`;
    for (const t of tokens) {
      output += `**${t.symbol}** - ${t.name}\n`;
      output += `  MCap: ${formatMarketCap(t.marketCap || 0)}`;
      if (t.graduated) output += ' ✓ Graduated';
      output += `\n  \`${t.mint}\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleVolatile(): Promise<string> {
  try {
    // Volatile endpoint may be on frontend API or advanced API — try both
    let tokens: PumpToken[] | null = null;
    try {
      tokens = await pumpFrontendRequest<PumpToken[]>('/coins/volatile?limit=15');
    } catch {
      // Fall back to advanced API
      try {
        tokens = await pumpAdvancedRequest<PumpToken[]>('/coins/volatile?limit=15');
      } catch { /* ignore */ }
    }

    if (!tokens?.length) return 'No volatile tokens found.';

    let output = '**High Volatility Tokens**\n\n';
    for (const t of tokens) {
      output += `**${t.symbol}** - ${t.name}\n`;
      output += `  MCap: ${formatMarketCap(t.marketCap || 0)}`;
      output += `\n  \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleKOTH(): Promise<string> {
  try {
    const token = await pumpFrontendRequest<PumpToken | PumpToken[]>('/coins/king-of-the-hill?includeNsfw=false');

    // Endpoint may return a single token or an array
    const tokens = Array.isArray(token) ? token : [token];
    if (!tokens?.length || !tokens[0]?.mint) return 'No KOTH tokens found.';

    let output = '**King of the Hill**\n\n';
    for (const t of tokens) {
      output += `**${t.symbol}** - ${t.name}\n`;
      output += `  MCap: ${formatMarketCap(t.marketCap || 0)}`;
      if (t.bondingCurveProgress !== undefined) {
        output += ` | Progress: ${(t.bondingCurveProgress * 100).toFixed(1)}%`;
      }
      output += `\n  \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Token Data Handlers
// ============================================================================

async function handleToken(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /pump token <mint>';
  }

  try {
    const token = await pumpFrontendRequest<PumpToken>(`/coins/${mint}?sync=true`);

    let output = `**${token.symbol}** - ${token.name}\n\n`;
    output += `Mint: \`${token.mint}\`\n`;
    if (token.description) output += `Description: ${token.description.slice(0, 150)}${token.description.length > 150 ? '...' : ''}\n`;

    output += `\n**Market Data:**\n`;
    if (token.price) output += `  Price: ${formatPrice(token.price)} SOL`;
    if (token.priceUsd) output += ` ($${formatPrice(token.priceUsd)})`;
    output += '\n';
    if (token.marketCap) output += `  Market Cap: ${formatMarketCap(token.marketCap)}\n`;
    if (token.liquidity) output += `  Liquidity: ${formatMarketCap(token.liquidity)}\n`;
    if (token.volume24h) output += `  24h Volume: ${formatMarketCap(token.volume24h)}\n`;
    if (token.holders) output += `  Holders: ${token.holders.toLocaleString()}\n`;

    if (token.bondingCurveProgress !== undefined) {
      output += `\n**Bonding Curve:** ${(token.bondingCurveProgress * 100).toFixed(1)}%`;
      if (token.graduated) output += ' ✓ Graduated to PumpSwap';
      output += '\n';
    }

    if (token.creator) output += `\nCreator: \`${token.creator.slice(0, 12)}...\`\n`;

    if (token.twitter || token.telegram || token.website) {
      output += '\n**Links:**\n';
      if (token.twitter) output += `  Twitter: ${token.twitter}\n`;
      if (token.telegram) output += `  Telegram: ${token.telegram}\n`;
      if (token.website) output += `  Website: ${token.website}\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePrice(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /pump price <mint>';
  }

  try {
    const [token, ohlcv] = await Promise.all([
      pumpFrontendRequest<PumpToken>(`/coins/${mint}?sync=true`),
      pumpFrontendRequest<PumpOHLCV[]>(`/candlesticks/${mint}?offset=0&limit=24&timeframe=${intervalToTimeframe('1h')}`).catch(() => null),
    ]);

    let output = `**${token.symbol} Price**\n\n`;
    output += `Current: ${formatPrice(token.price || 0)} SOL`;
    if (token.priceUsd) output += ` ($${formatPrice(token.priceUsd)})`;
    output += '\n';
    output += `Market Cap: ${formatMarketCap(token.marketCap || 0)}\n`;

    if (ohlcv?.length) {
      const first = ohlcv[0];
      const last = ohlcv[ohlcv.length - 1];
      const change = first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0;
      const high = Math.max(...ohlcv.map(c => c.high));
      const low = Math.min(...ohlcv.map(c => c.low));

      output += `\n**24h Stats:**\n`;
      output += `  Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n`;
      output += `  High: ${formatPrice(high)} SOL\n`;
      output += `  Low: ${formatPrice(low)} SOL\n`;
      output += `  Volume: ${formatMarketCap(ohlcv.reduce((sum, c) => sum + c.volume, 0))}\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleHolders(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /pump holders <mint>';
  }

  try {
    const holders = await pumpAdvancedRequest<PumpHolder[]>(`/coins/top-holders-and-sol-balance/${mint}`);

    if (!holders?.length) return 'No holder data available.';

    let output = `**Top Holders**\n\nMint: \`${mint.slice(0, 20)}...\`\n\n`;
    let totalPct = 0;

    for (let i = 0; i < holders.length; i++) {
      const h = holders[i];
      output += `${i + 1}. \`${h.wallet.slice(0, 12)}...\` - ${h.percentage.toFixed(2)}%`;
      if (h.isCreator) output += ' (Creator)';
      output += `\n   ${h.balance.toLocaleString()} tokens\n`;
      totalPct += h.percentage;
    }

    output += `\n**Top ${holders.length} hold ${totalPct.toFixed(1)}%**`;
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleTrades(args: string[]): Promise<string> {
  if (!args[0]) {
    return 'Usage: /pump trades <mint> [--limit N]';
  }

  const mint = args[0];
  let limit = 20;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) { limit = parseInt(args[++i], 10); }
  }

  try {
    const trades = await pumpFrontendRequest<PumpTrade[]>(`/trades/all/${mint}?limit=${limit}&offset=0&minimumSize=0`);

    if (!trades?.length) return 'No trades found.';

    let output = `**Recent Trades**\n\nMint: \`${mint.slice(0, 20)}...\`\n\n`;

    for (const t of trades.slice(0, 15)) {
      const action = t.type === 'buy' ? '🟢 BUY' : '🔴 SELL';
      const time = new Date(t.timestamp * 1000).toLocaleTimeString();
      output += `${action} ${t.solAmount.toFixed(4)} SOL @ ${formatPrice(t.pricePerToken)}\n`;
      output += `  ${time} | \`${t.wallet.slice(0, 8)}...\`\n`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleChart(args: string[]): Promise<string> {
  if (!args[0]) {
    return 'Usage: /pump chart <mint> [--interval 1m|5m|15m|1h|4h|1d]';
  }

  const mint = args[0];
  let interval = '1h';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--interval' && args[i + 1]) { interval = args[++i]; }
  }

  try {
    const ohlcv = await pumpFrontendRequest<PumpOHLCV[]>(`/candlesticks/${mint}?offset=0&limit=24&timeframe=${intervalToTimeframe(interval)}`);

    if (!ohlcv?.length) return 'No chart data available.';

    let output = `**Price Chart (${interval})**\n\nMint: \`${mint.slice(0, 20)}...\`\n\n`;
    output += '```\n';
    output += 'Time       | Open     | High     | Low      | Close    | Vol\n';
    output += '-----------+----------+----------+----------+----------+--------\n';

    for (const c of ohlcv.slice(-12)) {
      const time = new Date(c.timestamp * 1000).toLocaleTimeString().slice(0, 5);
      output += `${time.padEnd(10)} | ${formatPrice(c.open).padEnd(8)} | ${formatPrice(c.high).padEnd(8)} | ${formatPrice(c.low).padEnd(8)} | ${formatPrice(c.close).padEnd(8)} | ${formatMarketCap(c.volume)}\n`;
    }
    output += '```';

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// On-Chain Data Handlers
// ============================================================================

async function handleBalance(args: string[]): Promise<string> {
  if (!args[0]) {
    return 'Usage: /pump balance <mint> [wallet]';
  }

  const mint = args[0];
  const owner = args[1]; // Optional, defaults to user's wallet

  try {
    const { wallet, pumpapi } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();
    const ownerAddress = owner || (isConfigured() ? wallet.loadSolanaKeypair().publicKey.toBase58() : null);

    if (!ownerAddress) {
      return 'Wallet address required. Set SOLANA_PRIVATE_KEY or provide wallet address.';
    }

    const balance = await pumpapi.getTokenBalance(connection, ownerAddress, mint);

    if (!balance || balance.balance === 0) {
      return `**Token Balance**

Mint: \`${mint.slice(0, 20)}...\`
Wallet: \`${ownerAddress.slice(0, 12)}...\`
Balance: 0 tokens`;
    }

    // Get token info for symbol
    const token = await pumpFrontendRequest<PumpToken>(`/coins/${mint}?sync=true`).catch(() => null);
    const priceInfo = await pumpapi.getTokenPriceInfo(connection, mint).catch(() => null);

    let output = `**Token Balance**

Token: ${token?.symbol || '?'} \`${mint.slice(0, 20)}...\`
Wallet: \`${ownerAddress.slice(0, 12)}...\`
Balance: **${balance.balance.toLocaleString()}** tokens`;

    if (priceInfo) {
      const valueSOL = balance.balance * priceInfo.priceInSol;
      output += `\nValue: ~${valueSOL.toFixed(4)} SOL`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleHoldings(args: string[]): Promise<string> {
  const owner = args[0]; // Optional

  try {
    const { wallet, pumpapi } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();
    const ownerAddress = owner || (isConfigured() ? wallet.loadSolanaKeypair().publicKey.toBase58() : null);

    if (!ownerAddress) {
      return 'Wallet address required. Set SOLANA_PRIVATE_KEY or provide wallet address.';
    }

    const holdings = await pumpapi.getUserPumpTokens(connection, ownerAddress);

    if (!holdings.length) {
      return `**Pump.fun Holdings**

Wallet: \`${ownerAddress.slice(0, 12)}...\`
No Pump.fun tokens found.`;
    }

    let output = `**Pump.fun Holdings**

Wallet: \`${ownerAddress.slice(0, 12)}...\`
Tokens: ${holdings.length}

`;

    for (const h of holdings.slice(0, 15)) {
      const token = await pumpFrontendRequest<PumpToken>(`/coins/${h.mint}?sync=true`).catch(() => null);
      const symbol = token?.symbol || '???';
      output += `**${symbol}** - ${h.balance.toLocaleString()} tokens\n`;
      output += `  \`${h.mint.slice(0, 20)}...\`\n`;
    }

    if (holdings.length > 15) {
      output += `\n... and ${holdings.length - 15} more`;
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBonding(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /pump bonding <mint>';
  }

  try {
    const { wallet, pumpapi } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const state = await pumpapi.getBondingCurveState(connection, mint);

    if (!state) {
      return `Bonding curve not found for \`${mint.slice(0, 20)}...\`

Token may not exist or has already graduated to PumpSwap.`;
    }

    const price = pumpapi.calculatePrice(state);
    const progress = pumpapi.calculateBondingProgress(state);
    const liquiditySOL = state.realSolReserves.toNumber() / 1e9;
    const tokensRemaining = state.realTokenReserves.toNumber() / 1e6;

    // Get token info for context
    const token = await pumpFrontendRequest<PumpToken>(`/coins/${mint}?sync=true`).catch(() => null);

    let output = `**Bonding Curve State** ${state.complete ? '✅ GRADUATED' : '📈 ACTIVE'}

Token: ${token?.symbol || '?'} \`${mint.slice(0, 20)}...\`
${state.isMayhemMode ? '⚡ Mayhem Mode (Token2022)\n' : ''}
**Reserves:**
  Virtual SOL: ${(state.virtualSolReserves.toNumber() / 1e9).toFixed(4)}
  Virtual Tokens: ${(state.virtualTokenReserves.toNumber() / 1e6).toLocaleString()}
  Real SOL: ${liquiditySOL.toFixed(4)} SOL
  Real Tokens: ${tokensRemaining.toLocaleString()}

**Metrics:**
  Price: ${formatPrice(price)} SOL
  Progress: ${(progress * 100).toFixed(1)}%
  Liquidity: ${liquiditySOL.toFixed(2)} SOL`;

    if (state.complete) {
      output += '\n\n*Token has graduated to PumpSwap. Use Jupiter for trading.*';
    }

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBestPool(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /pump best-pool <mint>';
  }

  try {
    const { wallet, pumpapi } = await getSolanaModules();
    const connection = wallet.getSolanaConnection();

    const result = await pumpapi.getBestPool(connection, mint);

    if (result.pool === 'pump-amm') {
      return `**Best Execution Venue**

Token: \`${mint.slice(0, 20)}...\`
Status: ✅ Graduated
Venue: **PumpSwap**
${result.pumpswapPool ? `Pool: \`${result.pumpswapPool}\`` : ''}

Use Jupiter aggregator for best execution on graduated tokens.`;
    }

    return `**Best Execution Venue**

Token: \`${mint.slice(0, 20)}...\`
Status: 📈 Active Bonding
Venue: **Pump.fun**

Trade directly on pump.fun bonding curve for best execution.`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Additional Discovery Handlers
// ============================================================================

async function handleForYou(): Promise<string> {
  try {
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/for-you?limit=20&offset=0&includeNsfw=false');
    if (!tokens?.length) return 'No personalized recommendations available.';

    let output = '**For You - Personalized Recommendations**\n\n';
    for (const t of tokens.slice(0, 10)) {
      output += `**${t.name}** (${t.symbol})\n`;
      output += `  Mint: \`${t.mint.slice(0, 20)}...\`\n`;
      if (t.marketCap) output += `  MCap: ${formatMarketCap(t.marketCap)}`;
      if (t.volume24h) output += ` | Vol: ${formatMarketCap(t.volume24h)}`;
      output += '\n\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleMetas(): Promise<string> {
  try {
    const metas = await pumpFrontendRequest<Array<{ word: string; count: number; trending?: boolean }>>('/metas/current');
    if (!metas?.length) return 'No trending metas available.';

    let output = '**Trending Metas/Narratives**\n\n';
    for (const m of metas.slice(0, 20)) {
      const trendIcon = m.trending ? '🔥 ' : '';
      output += `${trendIcon}**${m.word}** - ${m.count} tokens\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSimilar(mint: string): Promise<string> {
  if (!mint) return 'Usage: /pump similar <mint>';

  try {
    const tokens = await pumpFrontendRequest<PumpToken[]>(`/coins/similar?mint=${mint}&limit=10`);
    if (!tokens?.length) return 'No similar tokens found.';

    let output = `**Similar Tokens**\n\nSource: \`${mint.slice(0, 20)}...\`\n\n`;
    for (const t of tokens) {
      output += `**${t.name}** (${t.symbol})\n`;
      output += `  Mint: \`${t.mint.slice(0, 20)}...\`\n`;
      if (t.marketCap) output += `  MCap: ${formatMarketCap(t.marketCap)}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleUserCoins(address: string): Promise<string> {
  if (!address) return 'Usage: /pump user-coins <wallet-address>';

  try {
    const coins = await pumpFrontendRequest<PumpToken[]>(`/coins/user-created-coins/${address}`);
    if (!coins?.length) return 'No tokens created by this wallet.';

    let output = `**Tokens Created by Wallet**\n\nWallet: \`${address.slice(0, 20)}...\`\n\n`;
    for (const t of coins.slice(0, 15)) {
      const status = t.graduated ? '🎓' : '📈';
      output += `${status} **${t.name}** (${t.symbol})\n`;
      output += `  Mint: \`${t.mint.slice(0, 20)}...\`\n`;
      if (t.marketCap) output += `  MCap: ${formatMarketCap(t.marketCap)}\n`;
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleIpfsUpload(args: string[]): Promise<string> {
  if (args.length < 3) {
    return `Usage: /pump ipfs-upload <name> <symbol> <description> [options]

Options:
  --image <url>      Image URL to upload
  --twitter <url>    Twitter link
  --telegram <url>   Telegram link
  --website <url>    Website link

Returns: metadataUri for use in token creation`;
  }

  const name = args[0];
  const symbol = args[1];
  const description = args.slice(2).join(' ').split('--')[0].trim();

  let imageUrl: string | undefined;
  let twitter: string | undefined;
  let telegram: string | undefined;
  let website: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--image' && args[i + 1]) { imageUrl = args[++i]; }
    if (args[i] === '--twitter' && args[i + 1]) { twitter = args[++i]; }
    if (args[i] === '--telegram' && args[i + 1]) { telegram = args[++i]; }
    if (args[i] === '--website' && args[i + 1]) { website = args[++i]; }
  }

  try {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('symbol', symbol);
    formData.append('description', description);
    if (twitter) formData.append('twitter', twitter);
    if (telegram) formData.append('telegram', telegram);
    if (website) formData.append('website', website);
    formData.append('showName', 'true');

    if (imageUrl) {
      const imgResponse = await fetch(imageUrl);
      if (imgResponse.ok) {
        const blob = await imgResponse.blob();
        formData.append('file', blob, 'image.png');
      }
    }

    const response = await fetch('https://pump.fun/api/ipfs', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) throw new Error(`IPFS upload failed: ${response.status}`);
    const result = await response.json() as { metadata: Record<string, unknown>; metadataUri: string };

    return `**IPFS Upload Successful**

Name: ${name}
Symbol: ${symbol}
Description: ${description.slice(0, 50)}...

**Metadata URI:** \`${result.metadataUri}\`

Use this URI when creating your token.`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Platform Data Handlers
// ============================================================================

async function handleLatestTrades(args: string[]): Promise<string> {
  let limit = 20;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) { limit = parseInt(args[++i], 10); }
  }

  try {
    const trades = await pumpFrontendRequest<Array<PumpTrade & { name?: string; symbol?: string }>>(`/trades/latest?limit=${limit}&offset=0`);
    if (!trades?.length) return 'No recent trades.';

    let output = '**Latest Trades (Platform-wide)**\n\n';
    for (const t of trades.slice(0, 15)) {
      const action = t.type === 'buy' ? '🟢' : '🔴';
      const time = new Date(t.timestamp * 1000).toLocaleTimeString();
      output += `${action} ${t.solAmount.toFixed(3)} SOL | \`${t.mint.slice(0, 12)}...\`\n`;
      output += `   ${time} | \`${t.wallet.slice(0, 8)}...\`\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSolPrice(): Promise<string> {
  try {
    const result = await pumpFrontendRequest<{ price: number; priceUsd: number }>('/sol-price');
    return `**SOL Price**

Price: $${result.priceUsd?.toFixed(2) || result.price?.toFixed(2) || 'N/A'}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Creation Handlers
// ============================================================================

async function handleCreate(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Pump.fun not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (args.length < 3) {
    return `Usage: /pump create <name> <symbol> <description> [options]

Options:
  --image <url>      Token image URL
  --twitter <url>    Twitter link
  --telegram <url>   Telegram link
  --website <url>    Website link
  --initial <SOL>    Initial buy amount (default: 0)
  --slippage <pct>   Slippage percent (default: 10)
  --priority <SOL>   Priority fee in SOL (default: 0.0005)

Example:
  /pump create "Moon Dog" MDOG "The moon-bound dog" --image https://i.imgur.com/abc.png --initial 0.5`;
  }

  const name = args[0];
  const symbol = args[1];
  const description = args[2];

  let imageUrl: string | undefined;
  let twitter: string | undefined;
  let telegram: string | undefined;
  let website: string | undefined;
  let initialBuy = 0;
  let slippage = 10;
  let priorityFee = 0.0005;

  for (let i = 3; i < args.length; i++) {
    if (args[i] === '--image' && args[i + 1]) { imageUrl = args[++i]; }
    else if (args[i] === '--twitter' && args[i + 1]) { twitter = args[++i]; }
    else if (args[i] === '--telegram' && args[i + 1]) { telegram = args[++i]; }
    else if (args[i] === '--website' && args[i + 1]) { website = args[++i]; }
    else if (args[i] === '--initial' && args[i + 1]) { initialBuy = parseFloat(args[++i]); }
    else if (args[i] === '--slippage' && args[i + 1]) { slippage = parseInt(args[++i], 10); }
    else if (args[i] === '--priority' && args[i + 1]) { priorityFee = parseFloat(args[++i]); }
  }

  try {
    const { wallet } = await getSolanaModules();
    const walletKeypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();
    const { Keypair, VersionedTransaction } = await import('@solana/web3.js');

    // Step 1: Upload metadata to IPFS
    const formData = new FormData();
    formData.append('name', name);
    formData.append('symbol', symbol);
    formData.append('description', description);
    if (twitter) formData.append('twitter', twitter);
    if (telegram) formData.append('telegram', telegram);
    if (website) formData.append('website', website);
    formData.append('showName', 'true');

    if (imageUrl) {
      const imgResponse = await fetch(imageUrl);
      if (imgResponse.ok) {
        const blob = await imgResponse.blob();
        formData.append('file', blob, 'image.png');
      } else {
        return `Failed to download image from ${imageUrl}`;
      }
    }

    const ipfsResponse = await fetch('https://pump.fun/api/ipfs', {
      method: 'POST',
      body: formData,
    });

    if (!ipfsResponse.ok) {
      throw new Error(`IPFS upload failed: ${ipfsResponse.status} - ${await ipfsResponse.text()}`);
    }

    const ipfsResult = await ipfsResponse.json() as { metadataUri: string };
    if (!ipfsResult.metadataUri) {
      throw new Error('IPFS upload returned no metadataUri');
    }

    // Step 2: Generate a new mint keypair
    const mintKeypair = Keypair.generate();

    // Step 3: Create token via PumpPortal trade-local endpoint
    const endpoint = process.env.PUMPFUN_LOCAL_TX_URL || 'https://pumpportal.fun/api/trade-local';

    const createBody = {
      publicKey: walletKeypair.publicKey.toBase58(),
      action: 'create',
      tokenMetadata: {
        name,
        symbol,
        uri: ipfsResult.metadataUri,
      },
      mint: mintKeypair.publicKey.toBase58(),
      denominatedInSol: 'true',
      amount: initialBuy,
      slippage,
      priorityFee,
      pool: 'pump',
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PumpPortal create error: ${response.status} - ${errorText}`);
    }

    // Step 4: Deserialize, sign with BOTH keypairs, and send
    const txBytes = new Uint8Array(await response.arrayBuffer());
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([mintKeypair, walletKeypair]);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return `**Token Created!**

Name: ${name}
Symbol: ${symbol}
Mint: \`${mintKeypair.publicKey.toBase58()}\`
Metadata: \`${ipfsResult.metadataUri}\`
TX: \`${signature}\`

Your token is now live on pump.fun!
${initialBuy > 0 ? `Initial buy: ${initialBuy} SOL` : 'No initial buy.'}`;
  } catch (error) {
    return `Creation failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleClaim(mint: string): Promise<string> {
  if (!isConfigured()) {
    return 'Pump.fun not configured. Set SOLANA_PRIVATE_KEY.';
  }

  if (!mint) {
    return 'Usage: /pump claim <mint>';
  }

  try {
    const { wallet } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    // Try PumpPortal claim-fees endpoint (undocumented — may not exist)
    const endpoint = process.env.PUMPFUN_LOCAL_TX_URL || 'https://pumpportal.fun/api/trade-local';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: keypair.publicKey.toBase58(),
        action: 'claim',
        mint,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // If endpoint doesn't support claim action, provide guidance
      if (response.status === 400 || response.status === 404) {
        return `**Claim Fees**

Creator fee claiming may not be supported via API.
Visit https://pump.fun to claim fees for token:
\`${mint}\`

Alternatively, use the Pump.fun program directly via Solana CLI.`;
      }
      throw new Error(`Claim error: ${response.status} - ${errorText}`);
    }

    const txBytes = new Uint8Array(await response.arrayBuffer());
    const { VersionedTransaction } = await import('@solana/web3.js');
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([keypair]);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return `**Fees Claimed**

Token: \`${mint.slice(0, 20)}...\`
TX: \`${signature}\``;
  } catch (error) {
    return `Claim failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Monitoring Handlers
// ============================================================================

async function handleWatch(mint: string): Promise<string> {
  if (!mint) {
    return 'Usage: /pump watch <mint>\n\nStarts WebSocket subscription for real-time trades.';
  }

  return `**Watching Token**

Mint: \`${mint}\`

To monitor trades in real-time, connect to:
\`wss://pumpportal.fun/api/data\`

Subscribe with:
\`{"method": "subscribeTokenTrade", "keys": ["${mint}"]}\`

Trade events will stream in real-time.`;
}

async function handleSnipe(symbol: string): Promise<string> {
  if (!symbol) {
    return 'Usage: /pump snipe <symbol>\n\nWaits for a token with this symbol to launch.';
  }

  return `**Snipe Mode**

Watching for: ${symbol.toUpperCase()}

To snipe new tokens, connect to:
\`wss://pumpportal.fun/api/data\`

Subscribe with:
\`{"method": "subscribeNewToken"}\`

When a token with symbol "${symbol.toUpperCase()}" is detected, execute buy immediately.

**Note:** Sniping is competitive. Use priority fees and fast RPC.`;
}

// ============================================================================
// Main Execute Function
// ============================================================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    // Trading
    case 'buy':
      return handleBuy(rest);
    case 'sell':
      return handleSell(rest);
    case 'quote':
      return handleQuote(rest);

    // Discovery
    case 'trending':
      return handleTrending();
    case 'new':
      return handleNew();
    case 'live':
      return handleLive();
    case 'graduated':
      return handleGraduated();
    case 'search':
      return handleSearch(rest.join(' '));
    case 'volatile':
      return handleVolatile();
    case 'koth':
      return handleKOTH();
    case 'graduating':
    case 'near-grad':
      return handleGraduating();
    case 'gainers':
      return handleGainers();
    case 'losers':
      return handleLosers();
    case 'hot':
      return handleHot();
    case 'new-hot':
      return handleNewHot();
    case 'stats':
      return handleStats(rest[0]);

    // Token Data
    case 'token':
      return handleToken(rest[0]);
    case 'price':
      return handlePrice(rest[0]);
    case 'holders':
      return handleHolders(rest[0]);
    case 'trades':
      return handleTrades(rest);
    case 'chart':
      return handleChart(rest);

    // On-Chain Data
    case 'balance':
      return handleBalance(rest);
    case 'holdings':
      return handleHoldings(rest);
    case 'bonding':
      return handleBonding(rest[0]);
    case 'best-pool':
      return handleBestPool(rest[0]);

    // Creation
    case 'create':
      return handleCreate(rest);
    case 'claim':
      return handleClaim(rest[0]);

    // Monitoring
    case 'watch':
      return handleWatch(rest[0]);
    case 'snipe':
      return handleSnipe(rest[0]);

    // Additional Discovery
    case 'for-you':
      return handleForYou();
    case 'metas':
      return handleMetas();
    case 'similar':
      return handleSimilar(rest[0]);

    // Creator Tools
    case 'user-coins':
      return handleUserCoins(rest[0]);
    case 'ipfs-upload':
      return handleIpfsUpload(rest);

    // Platform Data
    case 'latest-trades':
      return handleLatestTrades(rest);
    case 'sol-price':
      return handleSolPrice();

    case 'help':
    default:
      return `**Pump.fun - Complete API (32 Commands)**

**Trading:**
  /pump buy <mint> <SOL> [--pool X] [--slippage X]
  /pump sell <mint> <amount|%> [--pool X]
  /pump quote <mint> <amount> <buy|sell>  (on-chain accurate)

**Discovery:**
  /pump trending                    Top tokens by 24h volume
  /pump gainers                     Top 24h price gainers
  /pump losers                      Top 24h price losers
  /pump hot                         Most active right now (1h txns)
  /pump new-hot                     Hottest new tokens by volume
  /pump new                         Recently created
  /pump live                        Currently trading
  /pump graduated                   Migrated to PumpSwap
  /pump graduating                  Near graduation (>60% bonding)
  /pump search <query>              Search tokens
  /pump volatile                    High volatility
  /pump koth                        King of the Hill (30-35K)
  /pump for-you                     Personalized recommendations
  /pump metas                       Trending narratives

**Token Data:**
  /pump token <mint>                Full token info
  /pump stats <mint>                Volume, txns, liquidity, price change
  /pump price <mint>                Price + 24h stats
  /pump holders <mint>              Top holders
  /pump trades <mint> [--limit N]   Recent trades
  /pump chart <mint> [--interval]   OHLCV chart
  /pump similar <mint>              Find similar tokens

**On-Chain Data:**
  /pump balance <mint> [wallet]     Token balance
  /pump holdings [wallet]           All pump.fun tokens held
  /pump bonding <mint>              Bonding curve state
  /pump best-pool <mint>            Best execution venue

**Creator Tools:**
  /pump user-coins <address>        Tokens created by wallet
  /pump create <name> <symbol> <desc> [options]
  /pump claim <mint>                Claim creator fees
  /pump ipfs-upload <name> <sym> <desc>  Upload metadata

**Platform:**
  /pump latest-trades [--limit N]   Platform-wide trades
  /pump sol-price                   Current SOL price

**Monitoring:**
  /pump watch <mint>                Watch for trades (WS info)
  /pump snipe <symbol>              Wait for token launch (WS info)

**Pools:** pump, raydium, pump-amm, launchlab, raydium-cpmm, bonk, auto

**Setup:**
  export SOLANA_PRIVATE_KEY="your-key"
  export PUMPPORTAL_API_KEY="your-key"  # Optional
  export PUMPFUN_JWT="your-jwt"         # Optional`;
  }
}

export default {
  name: 'pumpfun',
  description: 'Pump.fun Solana memecoin launchpad - trade, launch, and monitor tokens',
  commands: ['/pumpfun', '/pump'],
  handle: execute,
};
