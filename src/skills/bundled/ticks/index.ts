/**
 * Ticks Skill - Query historical tick and OHLC data
 *
 * Commands:
 * /ticks <platform> <marketId>              Get recent ticks
 * /ticks ohlc <platform> <marketId>         Get OHLC candles
 * /ticks spread <platform> <marketId>       Get spread history
 * /ticks stats                              Get recorder stats
 */

const GATEWAY_URL = process.env.CLODDS_GATEWAY_URL || 'http://localhost:3000';

interface TicksResponse {
  ticks: Array<{
    time: string;
    platform: string;
    marketId: string;
    outcomeId: string;
    price: number;
    prevPrice: number | null;
  }>;
}

interface OHLCResponse {
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    tickCount: number;
  }>;
}

interface OrderbookHistoryResponse {
  snapshots: Array<{
    time: string;
    platform: string;
    marketId: string;
    outcomeId: string;
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    spread: number | null;
    midPrice: number | null;
  }>;
}

interface StatsResponse {
  stats: {
    ticksRecorded: number;
    orderbooksRecorded: number;
    ticksInBuffer: number;
    orderbooksInBuffer: number;
    lastFlushTime: number | null;
    dbConnected: boolean;
    platforms: string[];
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

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

async function handleTicks(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /ticks <platform> <marketId> [--outcome <id>] [--limit <n>]

Example: /ticks polymarket 0x1234abcd --limit 50`;
  }

  const platform = args[0];
  const marketId = args[1];

  // Parse optional args
  let outcomeId: string | undefined;
  let limit = 20;
  const now = Date.now();
  const startTime = now - 24 * 60 * 60 * 1000; // Last 24h

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--outcome' && args[i + 1]) {
      outcomeId = args[++i];
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    }
  }

  try {
    let endpoint = `/api/ticks/${platform}/${marketId}?startTime=${startTime}&endTime=${now}&limit=${limit}`;
    if (outcomeId) {
      endpoint += `&outcomeId=${encodeURIComponent(outcomeId)}`;
    }

    const data = await fetchApi<TicksResponse>(endpoint);

    if (data.ticks.length === 0) {
      return `No ticks found for ${platform}/${marketId} in the last 24 hours.`;
    }

    let output = `**Recent Ticks: ${platform}/${marketId.slice(0, 12)}...**\n\n`;
    output += `Found ${data.ticks.length} ticks\n\n`;

    output += '```\n';
    output += 'Time                     Price    Change\n';
    output += '─'.repeat(45) + '\n';

    for (const tick of data.ticks.slice(0, limit)) {
      const time = formatTime(tick.time).padEnd(22);
      const price = formatPrice(tick.price).padStart(8);
      const change = tick.prevPrice !== null
        ? ((tick.price - tick.prevPrice) * 100).toFixed(3) + '%'
        : '-';

      output += `${time} ${price}  ${change}\n`;
    }

    output += '```';

    return output;
  } catch (error) {
    return `Failed to fetch ticks: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleOHLC(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /ticks ohlc <platform> <marketId> --outcome <id> [--interval 1h]

Intervals: 1m, 5m, 15m, 1h, 4h, 1d

Example: /ticks ohlc polymarket 0x1234 --outcome 0x5678 --interval 1h`;
  }

  const platform = args[0];
  const marketId = args[1];

  // Parse args
  let outcomeId: string | undefined;
  let interval = '1h';
  const now = Date.now();
  const startTime = now - 7 * 24 * 60 * 60 * 1000; // Last 7 days

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--outcome' && args[i + 1]) {
      outcomeId = args[++i];
    } else if (args[i] === '--interval' && args[i + 1]) {
      interval = args[++i];
    }
  }

  if (!outcomeId) {
    return 'Error: --outcome <id> is required for OHLC queries';
  }

  try {
    const endpoint = `/api/ohlc/${platform}/${marketId}?outcomeId=${encodeURIComponent(outcomeId)}&interval=${interval}&startTime=${startTime}&endTime=${now}`;
    const data = await fetchApi<OHLCResponse>(endpoint);

    if (data.candles.length === 0) {
      return `No OHLC data found for ${platform}/${marketId} in the last 7 days.`;
    }

    let output = `**OHLC (${interval}): ${platform}/${marketId.slice(0, 12)}...**\n\n`;
    output += `${data.candles.length} candles\n\n`;

    output += '```\n';
    output += 'Time                 Open    High     Low   Close  Ticks\n';
    output += '─'.repeat(58) + '\n';

    for (const candle of data.candles.slice(-20)) {
      const time = formatTimestamp(candle.time).slice(0, 18).padEnd(18);
      const open = formatPrice(candle.open).padStart(7);
      const high = formatPrice(candle.high).padStart(7);
      const low = formatPrice(candle.low).padStart(7);
      const close = formatPrice(candle.close).padStart(7);
      const ticks = String(candle.tickCount).padStart(6);

      output += `${time} ${open} ${high} ${low} ${close} ${ticks}\n`;
    }

    output += '```';

    // Summary
    const latest = data.candles[data.candles.length - 1];
    const first = data.candles[0];
    const change = ((latest.close - first.open) / first.open * 100).toFixed(2);
    const direction = parseFloat(change) >= 0 ? '📈' : '📉';

    output += `\n\n${direction} Period change: ${change}%`;

    return output;
  } catch (error) {
    return `Failed to fetch OHLC: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSpread(args: string[]): Promise<string> {
  if (args.length < 2) {
    return `Usage: /ticks spread <platform> <marketId> [--outcome <id>] [--limit <n>]

Example: /ticks spread polymarket 0x1234 --limit 20`;
  }

  const platform = args[0];
  const marketId = args[1];

  // Parse args
  let outcomeId: string | undefined;
  let limit = 20;
  const now = Date.now();
  const startTime = now - 60 * 60 * 1000; // Last hour

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--outcome' && args[i + 1]) {
      outcomeId = args[++i];
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    }
  }

  try {
    let endpoint = `/api/orderbook-history/${platform}/${marketId}?startTime=${startTime}&endTime=${now}&limit=${limit}`;
    if (outcomeId) {
      endpoint += `&outcomeId=${encodeURIComponent(outcomeId)}`;
    }

    const data = await fetchApi<OrderbookHistoryResponse>(endpoint);

    if (data.snapshots.length === 0) {
      return `No orderbook history found for ${platform}/${marketId} in the last hour.`;
    }

    let output = `**Spread History: ${platform}/${marketId.slice(0, 12)}...**\n\n`;
    output += `${data.snapshots.length} snapshots (last hour)\n\n`;

    output += '```\n';
    output += 'Time                 Mid Price  Spread   Depth\n';
    output += '─'.repeat(50) + '\n';

    for (const snapshot of data.snapshots.slice(0, limit)) {
      const time = formatTime(snapshot.time).slice(0, 18).padEnd(18);
      const mid = snapshot.midPrice !== null ? formatPrice(snapshot.midPrice).padStart(9) : '    -    ';
      const spread = snapshot.spread !== null ? (snapshot.spread * 100).toFixed(3).padStart(7) + '%' : '   -   ';
      const depth = `${snapshot.bids.length}/${snapshot.asks.length}`;

      output += `${time} ${mid}  ${spread}  ${depth}\n`;
    }

    output += '```';

    // Spread stats
    const spreads = data.snapshots.filter(s => s.spread !== null).map(s => s.spread!);
    if (spreads.length > 0) {
      const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
      const minSpread = Math.min(...spreads);
      const maxSpread = Math.max(...spreads);

      output += `\n\n**Spread Stats:**`;
      output += `\n  Avg: ${(avgSpread * 100).toFixed(3)}%`;
      output += `\n  Min: ${(minSpread * 100).toFixed(3)}%`;
      output += `\n  Max: ${(maxSpread * 100).toFixed(3)}%`;
    }

    return output;
  } catch (error) {
    return `Failed to fetch spread history: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleStats(): Promise<string> {
  try {
    const data = await fetchApi<StatsResponse>('/api/tick-recorder/stats');
    const stats = data.stats;

    let output = `**Tick Recorder Stats**\n\n`;

    output += `**Database:** ${stats.dbConnected ? '🟢 Connected' : '🔴 Disconnected'}\n\n`;

    output += `**Recorded:**\n`;
    output += `  Ticks: ${stats.ticksRecorded.toLocaleString()}\n`;
    output += `  Orderbooks: ${stats.orderbooksRecorded.toLocaleString()}\n\n`;

    output += `**Buffer:**\n`;
    output += `  Ticks pending: ${stats.ticksInBuffer}\n`;
    output += `  Orderbooks pending: ${stats.orderbooksInBuffer}\n`;

    if (stats.lastFlushTime) {
      output += `  Last flush: ${formatTimestamp(stats.lastFlushTime)}\n`;
    }

    if (stats.platforms.length > 0) {
      output += `\n**Platforms:** ${stats.platforms.join(', ')}`;
    } else {
      output += `\n**Platforms:** All enabled`;
    }

    return output;
  } catch (error) {
    return `Failed to fetch stats: ${error instanceof Error ? error.message : String(error)}

Make sure tick recorder is enabled with:
\`\`\`
TICK_RECORDER_ENABLED=true
TICK_RECORDER_CONNECTION_STRING=postgres://...
\`\`\``;
  }
}

export async function handle(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'ohlc':
      return handleOHLC(rest);

    case 'spread':
    case 'orderbook':
    case 'ob':
      return handleSpread(rest);

    case 'stats':
    case 'status':
      return handleStats();

    case 'help':
      return `**Tick Data Query**

Query historical tick and OHLC data from TimescaleDB.

**Commands:**
\`\`\`
/ticks <platform> <marketId>              Recent ticks (24h)
/ticks ohlc <platform> <marketId> ...     OHLC candles
/ticks spread <platform> <marketId>       Spread history
/ticks stats                              Recorder stats
\`\`\`

**Options:**
\`\`\`
--outcome <id>      Filter by outcome ID
--interval <int>    OHLC interval (1m,5m,15m,1h,4h,1d)
--limit <n>         Limit results
\`\`\`

**Examples:**
\`\`\`
/ticks polymarket 0x1234abcd
/ticks ohlc polymarket 0x1234 --outcome 0x5678 --interval 1h
/ticks spread polymarket 0x1234 --limit 50
/ticks stats
\`\`\``;

    default:
      // Default: treat as ticks query
      return handleTicks([command, ...rest]);
  }
}

export default {
  name: 'Tick Data',
  description: 'Query historical tick, OHLC, and orderbook data from TimescaleDB',
  commands: ['/ticks'],
  handle,
};
