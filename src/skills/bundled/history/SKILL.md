---
name: history
description: "Trade history tracking, sync, and performance analytics"
emoji: "📊"
gates:
  envs:
    anyOf:
      - POLY_API_KEY
      - KALSHI_API_KEY
---

# Trade History - Complete API Reference

Fetch, sync, and analyze trade history from Polymarket and Kalshi with detailed performance metrics.

---

## Chat Commands

### Fetch & Sync

```
/history fetch                              # Fetch all trades from APIs
/history fetch poly                         # Fetch Polymarket only
/history fetch --from 2024-01-01            # From specific date
/history sync                               # Sync to local database
```

### View History

```
/history list                               # Recent trades
/history list --limit 50                    # Last 50 trades
/history list --platform poly               # Polymarket only
/history list --market <id>                 # Specific market
```

### Statistics

```
/history stats                              # Overall statistics
/history stats --period 30d                 # Last 30 days
/history stats --platform kalshi            # Platform-specific
```

### P&L Analysis

```
/history daily-pnl                          # Daily P&L
/history weekly-pnl                         # Weekly P&L
/history monthly-pnl                        # Monthly P&L
/history by-market                          # P&L by market category
```

### Export

```
/history export                             # Export to CSV
/history export --format json               # Export as JSON
/history export --from 2024-01-01           # Date range
```

### Filtering

```
/history filter --side buy                  # Only buys
/history filter --pnl positive              # Only winners
/history filter --pnl negative              # Only losers
/history filter --min-size 100              # Min $100 trades
```

---

## TypeScript API Reference

### Create History Service

```typescript
import { createTradeHistoryService } from 'clodds/history';

const history = createTradeHistoryService({
  polymarket: {
    apiKey: process.env.POLY_API_KEY,
    address: process.env.POLY_ADDRESS,
  },
  kalshi: {
    apiKey: process.env.KALSHI_API_KEY,
  },

  // Local storage
  dbPath: './trade-history.db',
});
```

### Fetch Trades from APIs

```typescript
// Fetch all trades from exchange APIs
const trades = await history.fetchTrades({
  platforms: ['polymarket', 'kalshi'],
  from: '2024-01-01',
});

console.log(`Fetched ${trades.length} trades`);

// Fetch from specific platform
const polyTrades = await history.fetchTrades({
  platforms: ['polymarket'],
  limit: 100,
});
```

### Sync to Database

```typescript
// Sync fetched trades to local database
await history.syncToDatabase();

console.log('Trades synced to database');
```

### Get Trades

```typescript
// Get trades from local storage
const trades = await history.getTrades({
  platform: 'polymarket',
  from: '2024-01-01',
  to: '2024-12-31',
  limit: 100,
});

for (const trade of trades) {
  console.log(`${trade.timestamp}: ${trade.side} ${trade.market}`);
  console.log(`  Size: $${trade.size}`);
  console.log(`  Price: ${trade.price}`);
  console.log(`  P&L: $${trade.pnl?.toFixed(2) || 'open'}`);
}
```

### Statistics

```typescript
// Get comprehensive statistics
const stats = await history.getStats({
  period: '30d',
  platform: 'polymarket',
});

console.log(`=== Trading Statistics (30d) ===`);
console.log(`Total trades: ${stats.totalTrades}`);
console.log(`Winning trades: ${stats.winningTrades}`);
console.log(`Losing trades: ${stats.losingTrades}`);
console.log(`Win rate: ${(stats.winRate * 100).toFixed(1)}%`);
console.log(`\nP&L:`);
console.log(`  Total: $${stats.totalPnl.toLocaleString()}`);
console.log(`  Gross profit: $${stats.grossProfit.toLocaleString()}`);
console.log(`  Gross loss: $${stats.grossLoss.toLocaleString()}`);
console.log(`  Profit factor: ${stats.profitFactor.toFixed(2)}`);
console.log(`\nTrade sizes:`);
console.log(`  Average: $${stats.avgTradeSize.toFixed(2)}`);
console.log(`  Largest win: $${stats.largestWin.toFixed(2)}`);
console.log(`  Largest loss: $${stats.largestLoss.toFixed(2)}`);
console.log(`\nRisk metrics:`);
console.log(`  Sharpe ratio: ${stats.sharpeRatio.toFixed(2)}`);
console.log(`  Max drawdown: ${(stats.maxDrawdown * 100).toFixed(1)}%`);
```

### Daily P&L

```typescript
// Get daily P&L breakdown
const dailyPnl = await history.getDailyPnL({
  days: 30,
  platform: 'polymarket',
});

console.log('=== Daily P&L ===');
for (const day of dailyPnl) {
  const sign = day.pnl >= 0 ? '+' : '';
  const bar = day.pnl >= 0
    ? '█'.repeat(Math.min(Math.floor(day.pnl / 10), 20))
    : '▓'.repeat(Math.min(Math.floor(Math.abs(day.pnl) / 10), 20));

  console.log(`${day.date} | ${sign}$${day.pnl.toFixed(2).padStart(8)} | ${bar}`);
}
```

### Performance by Market

```typescript
// Get performance breakdown by market category
const byMarket = await history.getPerformanceByMarket({
  period: '30d',
});

console.log('=== Performance by Market Category ===');
for (const [category, data] of Object.entries(byMarket)) {
  console.log(`\n${category}:`);
  console.log(`  Trades: ${data.trades}`);
  console.log(`  Win rate: ${(data.winRate * 100).toFixed(1)}%`);
  console.log(`  P&L: $${data.pnl.toLocaleString()}`);
  console.log(`  Avg trade: $${data.avgTrade.toFixed(2)}`);
}
```

### Export

```typescript
// Export to CSV
await history.exportCsv({
  path: './trades.csv',
  from: '2024-01-01',
  to: '2024-12-31',
  columns: ['timestamp', 'platform', 'market', 'side', 'size', 'price', 'pnl'],
});

// Export to JSON
const json = await history.exportJson({
  from: '2024-01-01',
});
```

---

## Database Schema

```sql
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  market_id TEXT NOT NULL,
  market_question TEXT,
  side TEXT NOT NULL,  -- 'buy' or 'sell'
  outcome TEXT,        -- 'YES' or 'NO'
  size REAL NOT NULL,
  price REAL NOT NULL,
  fee REAL DEFAULT 0,
  pnl REAL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_trades_platform ON trades(platform);
CREATE INDEX idx_trades_timestamp ON trades(timestamp);
CREATE INDEX idx_trades_market ON trades(market_id);
```

---

## Best Practices

1. **Sync regularly** - Keep local database up to date
2. **Export backups** - Periodically export to CSV
3. **Review weekly** - Analyze performance patterns
4. **Track by category** - Identify strong/weak areas
5. **Monitor drawdown** - Set alerts for max drawdown
