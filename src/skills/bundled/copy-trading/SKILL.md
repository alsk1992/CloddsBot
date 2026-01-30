---
name: copy-trading
description: "Automatically copy trades from successful wallets on Polymarket and crypto"
emoji: "📋"
gates:
  envs:
    anyOf:
      - POLY_API_KEY
      - SOLANA_PRIVATE_KEY
      - EVM_PRIVATE_KEY
---

# Copy Trading - Complete API Reference

Automatically mirror trades from successful wallets with configurable sizing, delays, and risk controls.

## Features

- **Follow whale wallets** on Polymarket and crypto chains
- **Configurable sizing**: Fixed, proportional, or % of portfolio
- **Trade delay** to avoid detection and front-running
- **Risk limits**: Max position, daily loss limits
- **Stop-loss / Take-profit** monitoring with auto-exit

---

## Chat Commands

### Following Wallets

```
/copy follow <address>                      # Start following a wallet
/copy follow 0x1234... --size 100           # Follow with $100 fixed size
/copy follow 0x1234... --size 50%           # Follow with 50% of their size
/copy follow 0x1234... --delay 30           # 30 second delay before copying

/copy unfollow <address>                    # Stop following
/copy list                                  # List followed wallets
/copy status                                # Show copy trading status
```

### Sizing Modes

```
/copy size <address> fixed 100              # Always trade $100
/copy size <address> proportional 0.5       # 50% of their size
/copy size <address> portfolio 5%           # 5% of your portfolio
```

### Risk Controls

```
/copy limits --max-position 1000            # Max $1000 per position
/copy limits --daily-loss 500               # Stop after $500 daily loss
/copy limits --max-trades 20                # Max 20 trades per day

/copy sl <address> 10%                      # 10% stop-loss on copies
/copy tp <address> 20%                      # 20% take-profit on copies
```

### Discovery

```
/copy top 10                                # Top 10 traders to copy
/copy top 10 --min-winrate 60               # Min 60% win rate
/copy top 10 --min-volume 100000            # Min $100k volume
/copy analyze <address>                     # Analyze a trader's performance
```

---

## TypeScript API Reference

### Create Copy Trading Service

```typescript
import { createCopyTradingService } from 'clodds/trading/copy-trading';

const copyTrader = createCopyTradingService({
  // Polymarket credentials
  polymarket: {
    apiKey: process.env.POLY_API_KEY,
    apiSecret: process.env.POLY_API_SECRET,
    passphrase: process.env.POLY_API_PASSPHRASE,
    privateKey: process.env.PRIVATE_KEY,
  },

  // Default settings
  defaults: {
    sizingMode: 'proportional',
    sizingValue: 0.5,           // 50% of their size
    delaySeconds: 15,           // 15s delay
    maxPositionSize: 1000,      // $1000 max
    stopLossPct: 10,            // 10% stop-loss
    takeProfitPct: 25,          // 25% take-profit
  },

  // Risk limits
  limits: {
    maxDailyLoss: 500,
    maxDailyTrades: 20,
    maxTotalExposure: 5000,
  },
});
```

### Follow Wallets

```typescript
// Follow a wallet with default settings
await copyTrader.follow('0x1234...');

// Follow with custom settings
await copyTrader.follow('0x1234...', {
  sizingMode: 'fixed',
  sizingValue: 100,            // $100 per trade
  delaySeconds: 30,            // 30s delay
  stopLossPct: 15,             // 15% stop-loss
  takeProfitPct: 30,           // 30% take-profit

  // Filters
  minTradeSize: 50,            // Only copy trades > $50
  maxTradeSize: 5000,          // Skip trades > $5000
  markets: ['politics'],       // Only copy politics markets
});

// Unfollow
await copyTrader.unfollow('0x1234...');

// List followed
const followed = await copyTrader.listFollowed();
```

### Sizing Modes

```typescript
// Fixed: Always trade same dollar amount
await copyTrader.follow(address, {
  sizingMode: 'fixed',
  sizingValue: 100,  // Always $100
});

// Proportional: Percentage of their trade size
await copyTrader.follow(address, {
  sizingMode: 'proportional',
  sizingValue: 0.5,  // 50% of their size
});

// Portfolio: Percentage of your portfolio
await copyTrader.follow(address, {
  sizingMode: 'portfolio',
  sizingValue: 0.05,  // 5% of portfolio per trade
});
```

### Event Handling

```typescript
copyTrader.on('trade_copied', (event) => {
  console.log(`Copied ${event.side} on ${event.market}`);
  console.log(`Original: $${event.originalSize}, Copied: $${event.copiedSize}`);
});

copyTrader.on('stop_loss_triggered', (event) => {
  console.log(`Stop-loss hit on ${event.market}`);
  console.log(`Loss: $${event.loss}`);
});

copyTrader.on('take_profit_triggered', (event) => {
  console.log(`Take-profit hit on ${event.market}`);
  console.log(`Profit: $${event.profit}`);
});

copyTrader.on('limit_reached', (event) => {
  console.log(`Limit reached: ${event.type}`);
});
```

### Start/Stop

```typescript
// Start copy trading (monitors followed wallets)
await copyTrader.start();

// Stop copy trading
await copyTrader.stop();

// Get status
const status = copyTrader.getStatus();
console.log(`Following: ${status.followedCount} wallets`);
console.log(`Today's P&L: $${status.dailyPnl}`);
console.log(`Active positions: ${status.activePositions}`);
```

### Find Best Traders

```typescript
import { findBestAddressesToCopy } from 'clodds/trading/copy-trading';

// Find top traders
const topTraders = await findBestAddressesToCopy({
  minWinRate: 0.6,           // 60%+ win rate
  minVolume: 100000,         // $100k+ volume
  minTrades: 50,             // 50+ trades
  timeframeDays: 30,         // Last 30 days
  limit: 10,                 // Top 10
});

for (const trader of topTraders) {
  console.log(`${trader.address}`);
  console.log(`  Win rate: ${(trader.winRate * 100).toFixed(1)}%`);
  console.log(`  Volume: $${trader.totalVolume.toLocaleString()}`);
  console.log(`  P&L: $${trader.pnl.toLocaleString()}`);
  console.log(`  Trades: ${trader.tradeCount}`);
}
```

### Analyze Trader

```typescript
const analysis = await copyTrader.analyzeTrader('0x1234...');

console.log(`Win rate: ${analysis.winRate}%`);
console.log(`Avg trade size: $${analysis.avgTradeSize}`);
console.log(`Best market: ${analysis.bestMarket}`);
console.log(`Worst market: ${analysis.worstMarket}`);
console.log(`Avg hold time: ${analysis.avgHoldTime} hours`);
console.log(`Sharpe ratio: ${analysis.sharpeRatio}`);
```

---

## Risk Management

### Stop-Loss Monitoring

Copy trading includes automatic stop-loss monitoring with 5-second price polling:

```typescript
// Configure stop-loss per followed wallet
await copyTrader.follow(address, {
  stopLossPct: 10,  // Exit at 10% loss
});

// Or set global stop-loss
copyTrader.setGlobalStopLoss(15);  // 15% for all positions
```

### Take-Profit Monitoring

```typescript
// Configure take-profit per followed wallet
await copyTrader.follow(address, {
  takeProfitPct: 25,  // Exit at 25% profit
});

// Trailing take-profit
await copyTrader.follow(address, {
  trailingTakeProfit: true,
  trailingPct: 5,  // Trail by 5%
});
```

### Daily Limits

```typescript
const copyTrader = createCopyTradingService({
  limits: {
    maxDailyLoss: 500,      // Stop after $500 loss
    maxDailyTrades: 20,     // Max 20 trades
    maxTotalExposure: 5000, // Max $5k total exposure
  },
});
```

---

## Best Practices

1. **Start with small sizes** - Test with 10-25% proportional sizing
2. **Use delays** - 15-30 second delays reduce front-running risk
3. **Set stop-losses** - Always use 10-15% stop-loss
4. **Diversify** - Follow 3-5 wallets, not just one
5. **Monitor regularly** - Check performance daily
6. **Filter markets** - Focus on categories you understand
