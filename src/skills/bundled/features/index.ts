/**
 * Features Skill - View real-time market features and signals
 *
 * Commands:
 * /features <platform> <marketId>        Get features for a market
 * /features all                          Get all tracked markets
 * /features stats                        Get feature engine stats
 * /features signals <platform> <marketId> Get trading signals
 */

const GATEWAY_URL = process.env.CLODDS_GATEWAY_URL || 'http://localhost:3000';

interface TickFeatures {
  timestamp: number;
  platform: string;
  marketId: string;
  outcomeId: string;
  price: number;
  priceChange: number;
  priceChangePct: number;
  momentum: number;
  velocity: number;
  volatility: number;
  volatilityPct: number;
  tickCount: number;
  tickIntensity: number;
  vwap: number | null;
}

interface OrderbookFeatures {
  timestamp: number;
  platform: string;
  marketId: string;
  outcomeId: string;
  spread: number;
  spreadPct: number;
  midPrice: number;
  bidDepth: number;
  askDepth: number;
  totalDepth: number;
  imbalance: number;
  imbalanceRatio: number;
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;
  weightedBidPrice: number;
  weightedAskPrice: number;
  bidDepthAt1Pct: number;
  askDepthAt1Pct: number;
  bidDepthAt5Pct: number;
  askDepthAt5Pct: number;
}

interface CombinedFeatures {
  timestamp: number;
  platform: string;
  marketId: string;
  outcomeId: string;
  tick: TickFeatures | null;
  orderbook: OrderbookFeatures | null;
  signals: {
    buyPressure: number;
    sellPressure: number;
    trendStrength: number;
    liquidityScore: number;
  };
}

interface FeaturesResponse {
  features: CombinedFeatures;
}

interface AllFeaturesResponse {
  features: Array<{
    timestamp: number;
    platform: string;
    marketId: string;
    outcomeId: string;
    features: CombinedFeatures;
  }>;
}

interface StatsResponse {
  stats: {
    marketsTracked: number;
    ticksProcessed: number;
    orderbooksProcessed: number;
  };
}

async function fetchApi<T>(endpoint: string): Promise<T> {
  const url = `${GATEWAY_URL}${endpoint}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function formatPrice(price: number): string {
  return (price * 100).toFixed(2) + '%';
}

function formatNumber(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function formatSignal(value: number, name: string): string {
  const bar = getBar(value);
  const percent = (value * 100).toFixed(1);
  return `${name.padEnd(16)} ${bar} ${percent}%`;
}

function getBar(value: number, width = 10): string {
  const filled = Math.round(Math.abs(value) * width);
  const empty = width - filled;
  if (value >= 0) {
    return '[' + '+'.repeat(filled) + '-'.repeat(empty) + ']';
  }
  return '[' + '-'.repeat(empty) + '+'.repeat(filled) + ']';
}

function getTrendEmoji(trend: number): string {
  if (trend >= 0.3) return '📈';
  if (trend <= -0.3) return '📉';
  return '➡️';
}

function getLiquidityEmoji(score: number): string {
  if (score >= 0.7) return '🟢';
  if (score >= 0.4) return '🟡';
  return '🔴';
}

async function handleGet(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /features get <platform> <marketId> [--outcome <id>]

Example: /features get polymarket 0x1234abcd`;
  }

  const platform = args[0];
  const marketId = args[1];

  let outcomeId: string | undefined;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--outcome' && args[i + 1]) {
      outcomeId = args[++i];
    }
  }

  try {
    let endpoint = `/api/features/${platform}/${marketId}`;
    if (outcomeId) {
      endpoint += `?outcomeId=${encodeURIComponent(outcomeId)}`;
    }

    const data = await fetchApi<FeaturesResponse>(endpoint);
    const f = data.features;

    if (!f) {
      return `No features available for ${platform}/${marketId}. Make sure the market has recent tick/orderbook data.`;
    }

    let output = `**Market Features: ${platform}/${marketId.slice(0, 12)}...**\n\n`;

    // Signals section
    output += `**Signals:**\n`;
    output += '```\n';
    output += formatSignal(f.signals.buyPressure, 'Buy Pressure') + '\n';
    output += formatSignal(f.signals.sellPressure, 'Sell Pressure') + '\n';
    output += formatSignal((f.signals.trendStrength + 1) / 2, 'Trend Strength') + ` ${getTrendEmoji(f.signals.trendStrength)}\n`;
    output += formatSignal(f.signals.liquidityScore, 'Liquidity') + ` ${getLiquidityEmoji(f.signals.liquidityScore)}\n`;
    output += '```\n\n';

    // Tick features
    if (f.tick) {
      output += `**Tick Features:**\n`;
      output += '```\n';
      output += `Price:        ${formatPrice(f.tick.price)}\n`;
      output += `Change:       ${f.tick.priceChangePct >= 0 ? '+' : ''}${formatNumber(f.tick.priceChangePct)}%\n`;
      output += `Momentum:     ${formatNumber(f.tick.momentum, 4)}\n`;
      output += `Volatility:   ${formatNumber(f.tick.volatilityPct)}%\n`;
      output += `Tick Count:   ${f.tick.tickCount}\n`;
      output += `Tick Rate:    ${formatNumber(f.tick.tickIntensity, 3)}/sec\n`;
      output += '```\n\n';
    }

    // Orderbook features
    if (f.orderbook) {
      output += `**Orderbook Features:**\n`;
      output += '```\n';
      output += `Spread:       ${formatNumber(f.orderbook.spreadPct)}%\n`;
      output += `Mid Price:    ${formatPrice(f.orderbook.midPrice)}\n`;
      output += `Best Bid:     ${formatPrice(f.orderbook.bestBid)} (${formatNumber(f.orderbook.bestBidSize)})\n`;
      output += `Best Ask:     ${formatPrice(f.orderbook.bestAsk)} (${formatNumber(f.orderbook.bestAskSize)})\n`;
      output += `Bid Depth:    $${formatNumber(f.orderbook.bidDepth)}\n`;
      output += `Ask Depth:    $${formatNumber(f.orderbook.askDepth)}\n`;
      output += `Imbalance:    ${formatNumber(f.orderbook.imbalance, 3)} (${formatNumber(f.orderbook.imbalanceRatio, 2)}x)\n`;
      output += '```';
    }

    return output;
  } catch (error) {
    return `Failed to fetch features: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleAll(): Promise<string> {
  try {
    const data = await fetchApi<AllFeaturesResponse>('/api/features');

    if (data.features.length === 0) {
      return `No markets are currently being tracked. Features are computed from live feed data.`;
    }

    let output = `**All Tracked Markets (${data.features.length})**\n\n`;
    output += '```\n';
    output += 'Platform     Market            Liq   Vol%  Trend\n';
    output += '─'.repeat(55) + '\n';

    // Sort by liquidity score descending
    const sorted = [...data.features].sort((a, b) =>
      b.features.signals.liquidityScore - a.features.signals.liquidityScore
    );

    for (const item of sorted.slice(0, 25)) {
      const f = item.features;
      const platform = item.platform.slice(0, 12).padEnd(12);
      const market = item.marketId.slice(0, 16).padEnd(16);
      const liq = getLiquidityEmoji(f.signals.liquidityScore) + formatNumber(f.signals.liquidityScore * 100, 0).padStart(3) + '%';
      const vol = f.tick?.volatilityPct ? formatNumber(f.tick.volatilityPct, 1).padStart(5) : '    -';
      const trend = getTrendEmoji(f.signals.trendStrength);

      output += `${platform} ${market}  ${liq}  ${vol}  ${trend}\n`;
    }

    output += '```';

    if (data.features.length > 25) {
      output += `\n\n_Showing 25 of ${data.features.length} markets_`;
    }

    return output;
  } catch (error) {
    return `Failed to fetch features: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleStats(): Promise<string> {
  try {
    const data = await fetchApi<StatsResponse>('/api/features/stats');
    const stats = data.stats;

    let output = `**Feature Engineering Stats**\n\n`;
    output += `**Tracking:**\n`;
    output += `  Markets: ${stats.marketsTracked}\n\n`;
    output += `**Processed:**\n`;
    output += `  Ticks: ${stats.ticksProcessed.toLocaleString()}\n`;
    output += `  Orderbooks: ${stats.orderbooksProcessed.toLocaleString()}\n`;

    return output;
  } catch (error) {
    return `Failed to fetch stats: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSignals(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /features signals <platform> <marketId> [--outcome <id>]

Example: /features signals polymarket 0x1234abcd`;
  }

  const platform = args[0];
  const marketId = args[1];

  let outcomeId: string | undefined;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--outcome' && args[i + 1]) {
      outcomeId = args[++i];
    }
  }

  try {
    let endpoint = `/api/features/${platform}/${marketId}`;
    if (outcomeId) {
      endpoint += `?outcomeId=${encodeURIComponent(outcomeId)}`;
    }

    const data = await fetchApi<FeaturesResponse>(endpoint);
    const f = data.features;

    if (!f) {
      return `No features available for ${platform}/${marketId}.`;
    }

    const signals = f.signals;
    let output = `**Trading Signals: ${platform}/${marketId.slice(0, 12)}...**\n\n`;

    // Determine overall signal
    const buyScore = signals.buyPressure + (signals.trendStrength > 0 ? signals.trendStrength : 0);
    const sellScore = signals.sellPressure + (signals.trendStrength < 0 ? -signals.trendStrength : 0);

    let overall: string;
    if (signals.liquidityScore < 0.3) {
      overall = '**LOW LIQUIDITY** - Trade with caution';
    } else if (buyScore > sellScore + 0.3) {
      overall = '**BULLISH** - Buy pressure dominant';
    } else if (sellScore > buyScore + 0.3) {
      overall = '**BEARISH** - Sell pressure dominant';
    } else {
      overall = '**NEUTRAL** - No clear direction';
    }

    output += `${overall}\n\n`;

    output += '```\n';
    output += `Buy Pressure:    ${(signals.buyPressure * 100).toFixed(1).padStart(5)}%\n`;
    output += `Sell Pressure:   ${(signals.sellPressure * 100).toFixed(1).padStart(5)}%\n`;
    output += `Trend Strength:  ${(signals.trendStrength * 100).toFixed(1).padStart(5)}%\n`;
    output += `Liquidity Score: ${(signals.liquidityScore * 100).toFixed(1).padStart(5)}%\n`;
    output += '```\n\n';

    // Recommendations
    output += `**Conditions:**\n`;
    const conditions: string[] = [];

    if (signals.liquidityScore >= 0.5) {
      conditions.push('Good liquidity for trading');
    } else if (signals.liquidityScore >= 0.3) {
      conditions.push('Moderate liquidity - use limit orders');
    } else {
      conditions.push('Low liquidity - avoid large orders');
    }

    if (f.tick?.volatilityPct) {
      if (f.tick.volatilityPct > 5) {
        conditions.push('High volatility - use wider stops');
      } else if (f.tick.volatilityPct < 0.5) {
        conditions.push('Low volatility - range-bound');
      }
    }

    if (f.orderbook?.spreadPct) {
      if (f.orderbook.spreadPct > 2) {
        conditions.push('Wide spread - execution cost high');
      }
    }

    for (const c of conditions) {
      output += `- ${c}\n`;
    }

    return output;
  } catch (error) {
    return `Failed to fetch signals: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function handle(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'get':
      return handleGet(rest);

    case 'all':
    case 'list':
      return handleAll();

    case 'stats':
    case 'status':
      return handleStats();

    case 'signals':
    case 'signal':
      return handleSignals(rest);

    case 'help':
      return `**Feature Engineering**

View real-time market features and trading signals computed from tick and orderbook data.

**Commands:**
\`\`\`
/features get <platform> <marketId>     Get features for a market
/features all                           List all tracked markets
/features signals <platform> <marketId> Get trading signals
/features stats                         Feature engine stats
\`\`\`

**Features Computed:**
- Tick: price, momentum, volatility, tick intensity
- Orderbook: spread, depth, imbalance
- Signals: buy/sell pressure, trend strength, liquidity score

**Examples:**
\`\`\`
/features get polymarket 0x1234abcd
/features signals kalshi INX-24
/features all
/features stats
\`\`\``;

    default:
      // Default: treat as get query if it looks like platform/marketId
      if (rest.length > 0 || (command && !['help', 'get', 'all', 'stats', 'signals'].includes(command))) {
        return handleGet([command, ...rest]);
      }
      return handle('help');
  }
}

export default {
  name: 'Features',
  description: 'View real-time market features and trading signals',
  commands: ['/features'],
  handle,
};
