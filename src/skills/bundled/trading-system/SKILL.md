---
name: trading-system
description: "Unified trading system with auto-logging, bots, and performance analytics"
emoji: "🤖"
gates:
  envs:
    anyOf:
      - POLY_API_KEY
      - KALSHI_API_KEY
---

# Trading System - Complete API Reference

Unified trading system with auto-logging to SQLite, bot management, and performance analytics.

---

## Chat Commands

### Portfolio

```
/trading portfolio                          # View all positions
/trading portfolio poly                     # Positions on Polymarket
/trading portfolio --value                  # Include current values
```

### Performance

```
/trading stats                              # Overall statistics
/trading stats --period 30d                 # Last 30 days
/trading daily-pnl                          # Daily P&L breakdown
/trading weekly-pnl                         # Weekly P&L
/trading monthly-pnl                        # Monthly P&L
```

### Trade History

```
/trading history                            # Recent trades
/trading history --limit 50                 # Last 50 trades
/trading history --platform poly            # Polymarket only
/trading export                             # Export to CSV
/trading export --format json               # Export as JSON
```

### Bot Management

```
/bot list                                   # List all bots
/bot register <name> <strategy>             # Register new bot
/bot start <name>                           # Start bot
/bot stop <name>                            # Stop bot
/bot status <name>                          # Bot status
/bot delete <name>                          # Delete bot
```

### Bot Strategies

```
/bot strategies                             # List available strategies
/bot create mean-reversion --config {...}   # Create with config
/bot create momentum --lookback 14          # Momentum strategy
/bot create arbitrage --min-spread 1        # Arbitrage strategy
```

---

## TypeScript API Reference

### Create Trading System

```typescript
import { createTradingSystem } from 'clodds/trading';

const trading = createTradingSystem({
  // Execution service
  execution: executionService,

  // Auto-logging
  autoLog: true,
  logPath: './trades.db',

  // Bot configuration
  bots: {
    enabled: true,
    maxConcurrent: 5,
  },
});
```

### Portfolio

```typescript
// Get portfolio
const portfolio = await trading.getPortfolio();

console.log(`Total value: $${portfolio.totalValue.toLocaleString()}`);
console.log(`Unrealized P&L: $${portfolio.unrealizedPnl.toLocaleString()}`);

for (const position of portfolio.positions) {
  console.log(`[${position.platform}] ${position.market}`);
  console.log(`  Side: ${position.side}`);
  console.log(`  Size: ${position.size}`);
  console.log(`  Avg price: ${position.avgPrice}`);
  console.log(`  Current: ${position.currentPrice}`);
  console.log(`  P&L: $${position.unrealizedPnl.toFixed(2)}`);
}
```

### Statistics

```typescript
// Get trading statistics
const stats = await trading.getStats({ period: '30d' });

console.log(`Total trades: ${stats.totalTrades}`);
console.log(`Win rate: ${(stats.winRate * 100).toFixed(1)}%`);
console.log(`Profit factor: ${stats.profitFactor.toFixed(2)}`);
console.log(`Total P&L: $${stats.totalPnl.toLocaleString()}`);
console.log(`Avg trade: $${stats.avgTrade.toFixed(2)}`);
console.log(`Largest win: $${stats.largestWin.toFixed(2)}`);
console.log(`Largest loss: $${stats.largestLoss.toFixed(2)}`);
console.log(`Sharpe ratio: ${stats.sharpeRatio.toFixed(2)}`);
console.log(`Max drawdown: ${(stats.maxDrawdown * 100).toFixed(1)}%`);
```

### Daily P&L

```typescript
// Get daily P&L
const dailyPnl = await trading.getDailyPnL({ days: 30 });

for (const day of dailyPnl) {
  const sign = day.pnl >= 0 ? '+' : '';
  console.log(`${day.date}: ${sign}$${day.pnl.toFixed(2)} (${day.trades} trades)`);
}
```

### Export Trades

```typescript
// Export to CSV
await trading.exportTrades({
  format: 'csv',
  path: './trades.csv',
  from: '2024-01-01',
  to: '2024-12-31',
});

// Export to JSON
const trades = await trading.exportTrades({
  format: 'json',
  from: '2024-01-01',
});
```

### Bot Management

```typescript
// List bots
const bots = trading.bots.list();

// Register a bot
await trading.bots.register({
  name: 'my-arb-bot',
  strategy: 'arbitrage',
  config: {
    minSpread: 1,
    maxPositionSize: 500,
    platforms: ['polymarket', 'kalshi'],
  },
});

// Start bot
await trading.bots.start('my-arb-bot');

// Get status
const status = trading.bots.getStatus('my-arb-bot');
console.log(`Running: ${status.isRunning}`);
console.log(`Trades today: ${status.tradesToday}`);
console.log(`P&L today: $${status.pnlToday}`);

// Stop bot
await trading.bots.stop('my-arb-bot');

// Delete bot
await trading.bots.delete('my-arb-bot');
```

### Built-in Strategies

```typescript
// Mean Reversion
await trading.bots.register({
  name: 'mean-rev',
  strategy: 'mean-reversion',
  config: {
    lookbackPeriod: 20,
    deviationThreshold: 2,
    positionSize: 100,
  },
});

// Momentum
await trading.bots.register({
  name: 'momentum',
  strategy: 'momentum',
  config: {
    lookbackPeriod: 14,
    entryThreshold: 0.6,
    exitThreshold: 0.4,
    positionSize: 100,
  },
});

// Arbitrage
await trading.bots.register({
  name: 'arb',
  strategy: 'arbitrage',
  config: {
    minSpread: 1,
    minLiquidity: 500,
    maxPositionSize: 1000,
  },
});
```

### Custom Strategy

```typescript
// Register custom strategy
trading.bots.registerStrategy('my-strategy', {
  init: async (ctx) => {
    // Initialize state
  },

  evaluate: async (ctx) => {
    // Return signals
    return [
      {
        platform: 'polymarket',
        marketId: 'market-123',
        action: 'buy',
        side: 'YES',
        size: 100,
        reason: 'Signal triggered',
      },
    ];
  },

  onTrade: (trade) => {
    console.log(`Trade executed: ${trade.orderId}`);
  },

  cleanup: async () => {
    // Cleanup
  },
});
```

---

## Auto-Logging

All trades are automatically logged to SQLite:

```sql
-- trades table
SELECT * FROM trades
WHERE platform = 'polymarket'
ORDER BY timestamp DESC
LIMIT 10;

-- Get win rate
SELECT
  COUNT(CASE WHEN pnl > 0 THEN 1 END) * 100.0 / COUNT(*) as win_rate
FROM trades;
```

---

## Best Practices

1. **Start with paper trading** - Use dry-run mode first
2. **Set position limits** - Prevent overexposure
3. **Monitor bots regularly** - Don't set and forget
4. **Review performance weekly** - Adjust strategies
5. **Export data regularly** - Backup your trade history
