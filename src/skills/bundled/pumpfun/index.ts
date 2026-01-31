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
 * /pump trending - Top performing tokens
 * /pump new - Recently created tokens
 * /pump live - Currently trading tokens
 * /pump graduated - Tokens migrated to Raydium
 * /pump search <query> - Search tokens
 * /pump volatile - High volatility tokens
 * /pump koth - King of the Hill tokens (30-35K mcap)
 *
 * TOKEN DATA:
 * /pump token <mint> - Full token info (metadata, price, holders, liquidity)
 * /pump price <mint> - Current price and OHLCV
 * /pump holders <mint> - Top holders
 * /pump trades <mint> [--limit N] - Recent trades
 * /pump chart <mint> [--interval 1m|5m|1h] - Price chart data
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
  const url = apiKey ? `${PUMPPORTAL_API}${endpoint}?api-key=${apiKey}` : `${PUMPPORTAL_API}${endpoint}`;

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

async function pumpFrontendRequest<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${PUMPFUN_FRONTEND_API}${endpoint}`, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Pump.fun API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function formatPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(2);
  if (price < 0.01) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

function formatMarketCap(mcap: number): string {
  if (mcap >= 1_000_000) return `$${(mcap / 1_000_000).toFixed(2)}M`;
  if (mcap >= 1_000) return `$${(mcap / 1_000).toFixed(1)}K`;
  return `$${mcap.toFixed(0)}`;
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
  --pool <pool>       Pool: pump, raydium, pump-amm, auto (default: pump)
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
    else if (args[i] === '--slippage' && args[i + 1]) { slippageBps = parseInt(args[++i]); }
    else if (args[i] === '--priority' && args[i + 1]) { priorityFee = parseInt(args[++i]); }
  }

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
  --pool <pool>       Pool: pump, raydium, auto (default: pump)
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
    else if (args[i] === '--slippage' && args[i + 1]) { slippageBps = parseInt(args[++i]); }
  }

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

  const [mint, amount, action] = args;

  try {
    // Use bloXroute or PumpPortal quote endpoint
    const quote = await pumpPortalRequest<{
      inputAmount: number;
      outputAmount: number;
      priceImpact: number;
      fee: number;
    }>(`/quote?mint=${mint}&amount=${amount}&action=${action}`);

    return `**Pump.fun Quote**

Token: \`${mint.slice(0, 20)}...\`
Action: ${action.toUpperCase()}
Input: ${quote.inputAmount}
Output: ${quote.outputAmount}
Price Impact: ${(quote.priceImpact * 100).toFixed(2)}%
Fee: ${quote.fee}`;
  } catch (error) {
    return `Quote failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ============================================================================
// Discovery Handlers
// ============================================================================

async function handleTrending(): Promise<string> {
  try {
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/top-runners');

    if (!tokens?.length) return 'No trending tokens found.';

    let output = '**Trending on Pump.fun**\n\n';
    for (let i = 0; i < Math.min(tokens.length, 15); i++) {
      const t = tokens[i];
      output += `${i + 1}. **${t.symbol}** - ${t.name}\n`;
      output += `   MCap: ${formatMarketCap(t.marketCap || 0)}`;
      if (t.volume24h) output += ` | Vol: ${formatMarketCap(t.volume24h)}`;
      output += `\n   \`${t.mint.slice(0, 20)}...\`\n\n`;
    }
    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleNew(): Promise<string> {
  try {
    // WebSocket subscription for new tokens, or poll API
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/currently-live?limit=20&sort=created_timestamp&order=desc');

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
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/currently-live?limit=20');

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
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/graduated?limit=20');

    if (!tokens?.length) return 'No graduated tokens found.';

    let output = '**Graduated to Raydium**\n\n';
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
    const tokens = await pumpFrontendRequest<PumpToken[]>(`/coins/search?query=${encodeURIComponent(query)}&limit=15`);

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
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/volatile?limit=15');

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
    // King of the Hill: 30-35K market cap range
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/list?minMarketCap=30000&maxMarketCap=35000&limit=15');

    if (!tokens?.length) return 'No KOTH tokens found.';

    let output = '**King of the Hill (30-35K MCap)**\n\n';
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
    const token = await pumpFrontendRequest<PumpToken>(`/coins/${mint}`);

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
      if (token.graduated) output += ' ✓ Graduated to Raydium';
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
      pumpFrontendRequest<PumpToken>(`/coins/${mint}`),
      pumpFrontendRequest<PumpOHLCV[]>(`/coins/${mint}/ohlcv?interval=1h&limit=24`).catch(() => null),
    ]);

    let output = `**${token.symbol} Price**\n\n`;
    output += `Current: ${formatPrice(token.price || 0)} SOL`;
    if (token.priceUsd) output += ` ($${formatPrice(token.priceUsd)})`;
    output += '\n';
    output += `Market Cap: ${formatMarketCap(token.marketCap || 0)}\n`;

    if (ohlcv?.length) {
      const first = ohlcv[0];
      const last = ohlcv[ohlcv.length - 1];
      const change = ((last.close - first.open) / first.open) * 100;
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
    const holders = await pumpFrontendRequest<PumpHolder[]>(`/coins/${mint}/holders?limit=20`);

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
    if (args[i] === '--limit' && args[i + 1]) { limit = parseInt(args[++i]); }
  }

  try {
    const trades = await pumpFrontendRequest<PumpTrade[]>(`/coins/${mint}/trades?limit=${limit}`);

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
    return 'Usage: /pump chart <mint> [--interval 1m|5m|1h|1d]';
  }

  const mint = args[0];
  let interval = '1h';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--interval' && args[i + 1]) { interval = args[++i]; }
  }

  try {
    const ohlcv = await pumpFrontendRequest<PumpOHLCV[]>(`/coins/${mint}/ohlcv?interval=${interval}&limit=24`);

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
// Additional Discovery Handlers
// ============================================================================

async function handleForYou(): Promise<string> {
  try {
    const tokens = await pumpFrontendRequest<PumpToken[]>('/coins/for-you?limit=20');
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
    if (args[i] === '--limit' && args[i + 1]) { limit = parseInt(args[++i]); }
  }

  try {
    const trades = await pumpFrontendRequest<Array<PumpTrade & { name?: string; symbol?: string }>>(`/trades/latest?limit=${limit}`);
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
  --initial <SOL>    Initial buy amount

Example:
  /pump create "Moon Dog" MDOG "The moon-bound dog" --twitter https://x.com/mdog --initial 0.5`;
  }

  const name = args[0];
  const symbol = args[1];
  const description = args[2];

  let imageUrl: string | undefined;
  let twitter: string | undefined;
  let telegram: string | undefined;
  let website: string | undefined;
  let initialBuy: number | undefined;

  for (let i = 3; i < args.length; i++) {
    if (args[i] === '--image' && args[i + 1]) { imageUrl = args[++i]; }
    else if (args[i] === '--twitter' && args[i + 1]) { twitter = args[++i]; }
    else if (args[i] === '--telegram' && args[i + 1]) { telegram = args[++i]; }
    else if (args[i] === '--website' && args[i + 1]) { website = args[++i]; }
    else if (args[i] === '--initial' && args[i + 1]) { initialBuy = parseFloat(args[++i]); }
  }

  try {
    const { wallet } = await getSolanaModules();
    const keypair = wallet.loadSolanaKeypair();
    const connection = wallet.getSolanaConnection();

    // Use PumpPortal creation endpoint
    const createResult = await pumpPortalRequest<{ mint: string; transaction: string }>('/create', {
      method: 'POST',
      body: JSON.stringify({
        publicKey: keypair.publicKey.toBase58(),
        name,
        symbol,
        description,
        imageUrl,
        twitter,
        telegram,
        website,
        initialBuyLamports: initialBuy ? Math.floor(initialBuy * 1e9) : undefined,
      }),
    });

    // Sign and send
    const { VersionedTransaction } = await import('@solana/web3.js');
    const txBuffer = Buffer.from(createResult.transaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([keypair]);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return `**Token Created!**

Name: ${name}
Symbol: ${symbol}
Mint: \`${createResult.mint}\`
TX: \`${signature}\`

Your token is now live on pump.fun!
${initialBuy ? `Initial buy: ${initialBuy} SOL` : ''}`;
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

    const claimResult = await pumpPortalRequest<{ transaction: string; amount: number }>('/claim-fees', {
      method: 'POST',
      body: JSON.stringify({
        publicKey: keypair.publicKey.toBase58(),
        mint,
      }),
    });

    if (!claimResult.transaction) {
      return `No fees to claim for token ${mint.slice(0, 12)}...`;
    }

    const { VersionedTransaction } = await import('@solana/web3.js');
    const txBuffer = Buffer.from(claimResult.transaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([keypair]);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return `**Fees Claimed**

Token: \`${mint.slice(0, 20)}...\`
Amount: ${claimResult.amount} SOL
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
      return `**Pump.fun - Complete API (22 Commands)**

**Trading:**
  /pump buy <mint> <SOL> [--pool X] [--slippage X]
  /pump sell <mint> <amount|%> [--pool X]
  /pump quote <mint> <amount> <buy|sell>

**Discovery:**
  /pump trending                    Top performing tokens
  /pump new                         Recently created
  /pump live                        Currently trading
  /pump graduated                   Migrated to Raydium
  /pump search <query>              Search tokens
  /pump volatile                    High volatility
  /pump koth                        King of the Hill (30-35K)
  /pump for-you                     Personalized recommendations
  /pump metas                       Trending narratives

**Token Data:**
  /pump token <mint>                Full token info
  /pump price <mint>                Price + 24h stats
  /pump holders <mint>              Top holders
  /pump trades <mint> [--limit N]   Recent trades
  /pump chart <mint> [--interval X] OHLCV chart
  /pump similar <mint>              Find similar tokens

**Creator Tools:**
  /pump user-coins <address>        Tokens created by wallet
  /pump create <name> <symbol> <desc> [options]
  /pump claim <mint>                Claim creator fees
  /pump ipfs-upload <name> <sym> <desc>  Upload metadata

**Platform:**
  /pump latest-trades [--limit N]   Platform-wide trades
  /pump sol-price                   Current SOL price

**Monitoring:**
  /pump watch <mint>                Watch for trades
  /pump snipe <symbol>              Wait for token launch

**Pools:** pump, raydium, pump-amm, launchlab, raydium-cpmm, bonk, auto

**Setup:**
  export SOLANA_PRIVATE_KEY="your-key"
  export PUMPPORTAL_API_KEY="your-key"  # Optional`;
  }
}

export default { execute };
