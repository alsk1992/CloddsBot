/**
 * Hyperliquid Skill
 *
 * CLI commands for the dominant perps DEX.
 */

import * as hl from '../../../exchanges/hyperliquid';
import { logger } from '../../../utils/logger';

// =============================================================================
// HELPERS
// =============================================================================

function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  return n.toFixed(decimals);
}

function formatPct(n: number): string {
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
}

function getConfig(): hl.HyperliquidConfig | null {
  const wallet = process.env.HYPERLIQUID_WALLET;
  const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY;

  if (!wallet || !privateKey) return null;

  return {
    walletAddress: wallet,
    privateKey,
    dryRun: process.env.DRY_RUN === 'true',
  };
}

// =============================================================================
// HANDLERS
// =============================================================================

async function handleStats(): Promise<string> {
  const [hlpStats, funding, meta] = await Promise.all([
    hl.getHlpStats(),
    hl.getFundingRates(),
    hl.getPerpMeta(),
  ]);

  const lines = [
    '**Hyperliquid Stats**',
    '',
    `HLP TVL: $${formatNumber(hlpStats.tvl)}`,
    `HLP APR: ${hlpStats.apr24h.toFixed(2)}%`,
    `24h Volume: $${formatNumber(hlpStats.volume24h)}`,
    `24h PnL: $${formatNumber(hlpStats.pnl24h)}`,
    '',
    `Markets: ${meta.universe.length} perps`,
    '',
    '**Top Funding Rates:**',
  ];

  // Sort by absolute funding
  const sorted = [...funding]
    .sort((a, b) => Math.abs(parseFloat(b.funding)) - Math.abs(parseFloat(a.funding)))
    .slice(0, 5);

  for (const f of sorted) {
    const rate = parseFloat(f.funding) * 100;
    const oi = parseFloat(f.openInterest);
    lines.push(`  ${f.coin}: ${rate >= 0 ? '+' : ''}${rate.toFixed(4)}% (OI: $${formatNumber(oi)})`);
  }

  return lines.join('\n');
}

async function handleMarkets(query?: string): Promise<string> {
  const [perpMeta, spotMeta, mids] = await Promise.all([
    hl.getPerpMeta(),
    hl.getSpotMeta(),
    hl.getAllMids(),
  ]);

  const lines = ['**Hyperliquid Markets**', ''];

  // Filter if query provided
  let perps = perpMeta.universe;
  if (query) {
    const q = query.toLowerCase();
    perps = perps.filter(p => p.name.toLowerCase().includes(q));
  }

  lines.push(`**Perpetuals (${perps.length}):**`);
  for (const p of perps.slice(0, 15)) {
    const price = parseFloat(mids[p.name] || '0');
    lines.push(`  ${p.name}: $${price.toFixed(2)} (${p.maxLeverage}x max)`);
  }

  if (perps.length > 15) {
    lines.push(`  ...and ${perps.length - 15} more`);
  }

  // Spot markets
  let spots = spotMeta.universe;
  if (query) {
    const q = query.toLowerCase();
    spots = spots.filter(s => s.name.toLowerCase().includes(q));
  }

  if (spots.length > 0) {
    lines.push('');
    lines.push(`**Spot (${spots.length}):**`);
    for (const s of spots.slice(0, 10)) {
      const price = parseFloat(mids[s.name] || '0');
      lines.push(`  ${s.name}: $${price.toFixed(4)}`);
    }
  }

  return lines.join('\n');
}

async function handleOrderbook(coin: string): Promise<string> {
  const ob = await hl.getOrderbook(coin.toUpperCase());

  const lines = [
    `**${coin.toUpperCase()} Orderbook**`,
    '',
    'Asks:',
  ];

  // Top 5 asks (reversed for display)
  for (const ask of ob.levels[1].slice(0, 5).reverse()) {
    lines.push(`  $${ask.price.toFixed(2)} | ${formatNumber(ask.size)} (${ask.numOrders})`);
  }

  lines.push('---');

  // Top 5 bids
  for (const bid of ob.levels[0].slice(0, 5)) {
    lines.push(`  $${bid.price.toFixed(2)} | ${formatNumber(bid.size)} (${bid.numOrders})`);
  }

  const spread = ob.levels[1][0]?.price && ob.levels[0][0]?.price
    ? ((ob.levels[1][0].price - ob.levels[0][0].price) / ob.levels[0][0].price * 100).toFixed(4)
    : '0';

  lines.push('');
  lines.push(`Spread: ${spread}%`);

  return lines.join('\n');
}

async function handleBalance(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY required';
  }

  const [state, spotBalances, points] = await Promise.all([
    hl.getUserState(config.walletAddress),
    hl.getSpotBalances(config.walletAddress),
    hl.getUserPoints(config.walletAddress),
  ]);

  const margin = state.marginSummary;
  const total = parseFloat(margin.accountValue);
  const used = parseFloat(margin.totalMarginUsed);

  const lines = [
    `**Hyperliquid Balance** (${config.walletAddress.slice(0, 6)}...${config.walletAddress.slice(-4)})`,
    '',
    '**Perps Account:**',
    `  Total: $${formatNumber(total)}`,
    `  Available: $${formatNumber(total - used)}`,
    `  Margin Used: $${formatNumber(used)}`,
  ];

  // Positions
  const positions = state.assetPositions.filter(ap => parseFloat(ap.position.szi) !== 0);
  if (positions.length > 0) {
    lines.push('');
    lines.push('**Positions:**');
    for (const ap of positions) {
      const p = ap.position;
      const size = parseFloat(p.szi);
      const pnl = parseFloat(p.unrealizedPnl);
      const side = size > 0 ? 'LONG' : 'SHORT';
      lines.push(`  ${p.coin} ${side}: ${Math.abs(size)} @ $${parseFloat(p.entryPx).toFixed(2)} (${pnl >= 0 ? '+' : ''}$${formatNumber(pnl)})`);
    }
  }

  // Spot balances
  const nonZeroSpot = spotBalances.filter(b => parseFloat(b.total) > 0);
  if (nonZeroSpot.length > 0) {
    lines.push('');
    lines.push('**Spot Balances:**');
    for (const b of nonZeroSpot) {
      lines.push(`  ${b.coin}: ${formatNumber(parseFloat(b.total))}`);
    }
  }

  // Points
  if (points.total > 0) {
    lines.push('');
    lines.push('**Points:**');
    lines.push(`  Total: ${formatNumber(points.total)} (Rank #${points.rank || 'N/A'})`);
    lines.push(`  Today: ${formatNumber(points.daily)}`);
  }

  return lines.join('\n');
}

async function handleHlp(action?: string, amount?: string): Promise<string> {
  const config = getConfig();

  // Info only - no auth needed
  if (!action || action === 'info') {
    const stats = await hl.getHlpStats();
    return [
      '**HLP Vault**',
      '',
      `TVL: $${formatNumber(stats.tvl)}`,
      `APR (24h): ${stats.apr24h.toFixed(2)}%`,
      `24h PnL: $${formatNumber(stats.pnl24h)}`,
      '',
      'Use `/hl hlp deposit <amount>` to deposit',
      'Use `/hl hlp withdraw <amount>` to withdraw',
    ].join('\n');
  }

  if (!config) {
    return 'HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY required';
  }

  const amountNum = parseFloat(amount || '0');
  if (amountNum <= 0) {
    return 'Invalid amount';
  }

  if (action === 'deposit') {
    const result = await hl.depositToHlp(config, amountNum);
    if (result.success) {
      return `Deposited $${formatNumber(amountNum)} to HLP vault`;
    }
    return `Deposit failed: ${result.error}`;
  }

  if (action === 'withdraw') {
    const result = await hl.withdrawFromHlp(config, amountNum);
    if (result.success) {
      return `Withdrew $${formatNumber(amountNum)} from HLP vault`;
    }
    return `Withdraw failed: ${result.error}`;
  }

  return 'Unknown action. Use: info, deposit, withdraw';
}

async function handleLeaderboard(timeframe?: string): Promise<string> {
  const tf = (timeframe as 'day' | 'week' | 'month' | 'allTime') || 'day';
  const leaders = await hl.getLeaderboard(tf);

  const lines = [
    `**Hyperliquid Leaderboard (${tf})**`,
    '',
  ];

  for (let i = 0; i < Math.min(10, leaders.length); i++) {
    const l = leaders[i];
    lines.push(`${i + 1}. ${l.address.slice(0, 8)}... PnL: $${formatNumber(l.pnl)} (${formatPct(l.roi)})`);
  }

  return lines.join('\n');
}

async function handleSpot(subcommand?: string, ...args: string[]): Promise<string> {
  const config = getConfig();

  if (subcommand === 'markets') {
    const meta = await hl.getSpotMeta();
    const mids = await hl.getAllMids();

    const lines = ['**Hyperliquid Spot Markets**', ''];
    for (const m of meta.universe.slice(0, 20)) {
      const price = parseFloat(mids[m.name] || '0');
      lines.push(`  ${m.name}: $${price.toFixed(4)}`);
    }
    return lines.join('\n');
  }

  if (subcommand === 'book' && args[0]) {
    return handleOrderbook(args[0]);
  }

  if (subcommand === 'buy' || subcommand === 'sell') {
    if (!config) {
      return 'HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY required';
    }

    const [coin, amount, price] = args;
    if (!coin || !amount) {
      return `Usage: /hl spot ${subcommand} <coin> <amount> [price]`;
    }

    const result = await hl.placeSpotOrder(config, {
      coin: coin.toUpperCase(),
      side: subcommand === 'buy' ? 'BUY' : 'SELL',
      size: parseFloat(amount),
      price: price ? parseFloat(price) : 0,
      type: price ? 'LIMIT' : 'MARKET',
    });

    if (result.success) {
      return `Spot ${subcommand} order placed (ID: ${result.orderId})`;
    }
    return `Order failed: ${result.error}`;
  }

  return [
    '**Hyperliquid Spot Commands**',
    '',
    '/hl spot markets       - List spot markets',
    '/hl spot book <coin>   - Show orderbook',
    '/hl spot buy <coin> <amount> [price]',
    '/hl spot sell <coin> <amount> [price]',
  ].join('\n');
}

async function handleTwap(action?: string, ...args: string[]): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY required';
  }

  if (action === 'buy' || action === 'sell') {
    const [coin, size, duration] = args;
    if (!coin || !size || !duration) {
      return `Usage: /hl twap ${action} <coin> <size> <duration_minutes>`;
    }

    const result = await hl.placeTwapOrder(config, {
      coin: coin.toUpperCase(),
      side: action === 'buy' ? 'BUY' : 'SELL',
      size: parseFloat(size),
      durationMinutes: parseInt(duration),
    });

    if (result.success) {
      return `TWAP order started (ID: ${result.twapId})`;
    }
    return `TWAP failed: ${result.error}`;
  }

  if (action === 'cancel' && args[0] && args[1]) {
    const [coin, twapId] = args;
    const result = await hl.cancelTwap(config, coin.toUpperCase(), twapId);
    if (result.success) {
      return `TWAP ${twapId} for ${coin.toUpperCase()} cancelled`;
    }
    return `Cancel failed: ${result.error}`;
  }

  return [
    '**Hyperliquid TWAP Commands**',
    '',
    '/hl twap buy <coin> <size> <minutes>   - Start TWAP buy',
    '/hl twap sell <coin> <size> <minutes>  - Start TWAP sell',
    '/hl twap cancel <coin> <id>            - Cancel TWAP',
  ].join('\n');
}

async function handlePoints(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY required';
  }

  const points = await hl.getUserPoints(config.walletAddress);

  return [
    '**Hyperliquid Points**',
    '',
    `Total: ${formatNumber(points.total)}`,
    `Today: ${formatNumber(points.daily)}`,
    `Rank: #${points.rank || 'N/A'}`,
    '',
    '**Breakdown:**',
    `  Trading: ${formatNumber(points.breakdown.trading)}`,
    `  Referrals: ${formatNumber(points.breakdown.referrals)}`,
    `  HLP: ${formatNumber(points.breakdown.hlp)}`,
    `  Staking: ${formatNumber(points.breakdown.staking)}`,
  ].join('\n');
}

// =============================================================================
// NEW HANDLERS
// =============================================================================

async function handleCandles(coin: string, interval?: string): Promise<string> {
  const tf = (interval as '1m' | '5m' | '15m' | '1h' | '4h' | '1d') || '1h';
  const candles = await hl.getCandles(coin.toUpperCase(), tf);

  if (candles.length === 0) {
    return `No candle data for ${coin}`;
  }

  const lines = [
    `**${coin.toUpperCase()} Candles (${tf})**`,
    '',
    'Time | Open | High | Low | Close | Vol',
    '--- | --- | --- | --- | --- | ---',
  ];

  for (const c of candles.slice(-10)) {
    const time = new Date(c.time).toLocaleTimeString();
    lines.push(`${time} | ${c.open.toFixed(2)} | ${c.high.toFixed(2)} | ${c.low.toFixed(2)} | ${c.close.toFixed(2)} | ${formatNumber(c.volume)}`);
  }

  return lines.join('\n');
}

async function handlePerp(action?: string, ...args: string[]): Promise<string> {
  const config = getConfig();

  if (action === 'buy' || action === 'sell' || action === 'long' || action === 'short') {
    if (!config) {
      return 'HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY required';
    }

    const [coin, size, price] = args;
    if (!coin || !size) {
      return `Usage: /hl perp ${action} <coin> <size> [price]`;
    }

    const side = (action === 'buy' || action === 'long') ? 'BUY' : 'SELL';
    const result = await hl.placePerpOrder(config, {
      coin: coin.toUpperCase(),
      side,
      size: parseFloat(size),
      price: price ? parseFloat(price) : undefined,
      type: price ? 'LIMIT' : 'MARKET',
    });

    if (result.success) {
      return `Perp ${action} order placed (ID: ${result.orderId})`;
    }
    return `Order failed: ${result.error}`;
  }

  if (action === 'cancel') {
    if (!config) {
      return 'HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY required';
    }

    const [coin, oid] = args;
    if (!coin || !oid) {
      return 'Usage: /hl perp cancel <coin> <orderId>';
    }

    const result = await hl.cancelOrder(config, coin.toUpperCase(), parseInt(oid));
    if (result.success) {
      return `Order ${oid} cancelled`;
    }
    return `Cancel failed: ${result.error}`;
  }

  return [
    '**Hyperliquid Perp Commands**',
    '',
    '/hl perp long <coin> <size> [price]   - Open long',
    '/hl perp short <coin> <size> [price]  - Open short',
    '/hl perp cancel <coin> <orderId>      - Cancel order',
  ].join('\n');
}

async function handleLeverage(coin?: string, leverage?: string): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY required';
  }

  if (!coin || !leverage) {
    return 'Usage: /hl leverage <coin> <leverage>\nExample: /hl leverage BTC 10';
  }

  const lev = parseInt(leverage);
  if (lev < 1 || lev > 50) {
    return 'Leverage must be between 1 and 50';
  }

  const result = await hl.updateLeverage(config, coin.toUpperCase(), lev);
  if (result.success) {
    return `Leverage for ${coin.toUpperCase()} set to ${lev}x`;
  }
  return `Failed: ${result.error}`;
}

async function handleBorrowLend(): Promise<string> {
  const config = getConfig();
  if (!config) {
    // Show reserves without auth
    const reserves = await hl.getAllBorrowLendReserves();

    if (!reserves || reserves.length === 0) {
      return 'Borrow/Lend not available or no reserves found';
    }

    const lines = ['**Hyperliquid Borrow/Lend Reserves**', ''];
    for (const r of reserves) {
      lines.push(`**${r.token}**`);
      lines.push(`  Deposit APY: ${parseFloat(r.depositApy).toFixed(2)}%`);
      lines.push(`  Borrow APY: ${parseFloat(r.borrowApy).toFixed(2)}%`);
      lines.push(`  Utilization: ${(parseFloat(r.utilizationRate) * 100).toFixed(1)}%`);
      lines.push('');
    }
    return lines.join('\n');
  }

  const [reserves, userState] = await Promise.all([
    hl.getAllBorrowLendReserves(),
    hl.getBorrowLendState(config.walletAddress),
  ]);

  const lines = ['**Hyperliquid Borrow/Lend**', ''];

  if (userState.deposits.length > 0) {
    lines.push('**Your Deposits:**');
    for (const d of userState.deposits) {
      lines.push(`  ${d.token}: ${d.amount} (${d.apy}% APY)`);
    }
    lines.push('');
  }

  if (userState.borrows.length > 0) {
    lines.push('**Your Borrows:**');
    for (const b of userState.borrows) {
      lines.push(`  ${b.token}: ${b.amount} (${b.apy}% APY)`);
    }
    lines.push(`Health Factor: ${userState.healthFactor.toFixed(2)}`);
    lines.push('');
  }

  if (reserves && reserves.length > 0) {
    lines.push('**Available Reserves:**');
    for (const r of reserves.slice(0, 5)) {
      lines.push(`  ${r.token}: Deposit ${parseFloat(r.depositApy).toFixed(2)}% / Borrow ${parseFloat(r.borrowApy).toFixed(2)}%`);
    }
  }

  return lines.join('\n');
}

async function handleFees(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY required';
  }

  const [fees, rateLimit] = await Promise.all([
    hl.getUserFees(config.walletAddress),
    hl.getUserRateLimit(config.walletAddress),
  ]);

  return [
    '**Your Hyperliquid Fees & Limits**',
    '',
    `Maker Fee: ${(fees.makerRate * 100).toFixed(4)}%`,
    `Taker Fee: ${(fees.takerRate * 100).toFixed(4)}%`,
    `30d Volume: $${formatNumber(fees.volume30d)}`,
    '',
    '**Rate Limits:**',
    `  Requests Used: ${rateLimit.nRequestsUsed}/${rateLimit.nRequestsCap}`,
    `  Cumulative Volume: $${formatNumber(rateLimit.cumVlm)}`,
  ].join('\n');
}

async function handleHistory(): Promise<string> {
  const config = getConfig();
  if (!config) {
    return 'HYPERLIQUID_WALLET and HYPERLIQUID_PRIVATE_KEY required';
  }

  const orders = await hl.getHistoricalOrders(config.walletAddress);

  if (orders.length === 0) {
    return 'No order history found';
  }

  const lines = ['**Recent Orders**', ''];
  for (const o of orders.slice(0, 10)) {
    const time = new Date(o.timestamp).toLocaleString();
    lines.push(`${o.coin} ${o.side} ${o.sz} @ $${o.limitPx} - ${o.status} (${time})`);
  }

  return lines.join('\n');
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export const skill = {
  name: 'hyperliquid',
  description: 'Hyperliquid perps DEX (69% market share)',
  commands: [
    {
      name: 'hl',
      description: 'Hyperliquid commands',
      usage: '/hl <stats|markets|book|balance|hlp|leaderboard|spot|twap|points>',
    },
  ],

  async handler(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    try {
      switch (subcommand) {
        case 'stats':
        case '':
        case undefined:
          return handleStats();

        case 'markets':
          return handleMarkets(parts[1]);

        case 'book':
        case 'orderbook':
          if (!parts[1]) return 'Usage: /hl book <coin>';
          return handleOrderbook(parts[1]);

        case 'balance':
        case 'bal':
          return handleBalance();

        case 'hlp':
        case 'vault':
          return handleHlp(parts[1], parts[2]);

        case 'leaderboard':
        case 'lb':
          return handleLeaderboard(parts[1]);

        case 'spot':
          return handleSpot(parts[1], ...parts.slice(2));

        case 'twap':
          return handleTwap(parts[1], ...parts.slice(2));

        case 'points':
          return handlePoints();

        case 'candles':
        case 'chart':
          if (!parts[1]) return 'Usage: /hl candles <coin> [1m|5m|15m|1h|4h|1d]';
          return handleCandles(parts[1], parts[2]);

        case 'perp':
        case 'trade':
          return handlePerp(parts[1], ...parts.slice(2));

        case 'leverage':
        case 'lev':
          return handleLeverage(parts[1], parts[2]);

        case 'lend':
        case 'borrow':
          return handleBorrowLend();

        case 'fees':
          return handleFees();

        case 'history':
        case 'orders':
          return handleHistory();

        case 'help':
        default:
          return [
            '**Hyperliquid Commands**',
            '',
            '/hl stats              - HLP TVL, APR, funding rates',
            '/hl markets [query]    - List perp/spot markets',
            '/hl book <coin>        - Show orderbook',
            '/hl candles <coin>     - OHLCV candle data',
            '/hl balance            - Your positions & balances',
            '/hl perp [long|short]  - Place perp orders',
            '/hl leverage <coin> <x> - Set leverage',
            '/hl hlp [deposit|withdraw] - HLP vault',
            '/hl spot [buy|sell]    - Spot trading',
            '/hl twap [buy|sell]    - TWAP orders',
            '/hl lend               - Borrow/lend rates',
            '/hl fees               - Your fee tier',
            '/hl history            - Order history',
            '/hl leaderboard        - Top traders',
            '/hl points             - Points breakdown',
          ].join('\n');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, args }, 'Hyperliquid command failed');
      return `Error: ${message}`;
    }
  },
};

export default skill;
