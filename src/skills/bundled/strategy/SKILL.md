---
name: strategy
description: "Build and manage custom trading strategies with natural language"
emoji: "🎯"
---

# Strategy - Complete API Reference

Create custom trading strategies using natural language or templates, then deploy to live trading.

---

## Chat Commands

### Create Strategy

```
/strategy create "Buy when price drops 5% in 1 hour"
/strategy create momentum --lookback 14 --threshold 2%
/strategy from-template mean-reversion
```

### Manage Strategies

```
/strategies                         List all strategies
/strategy <name>                    View strategy details
/strategy edit <name>               Modify strategy
/strategy delete <name>             Remove strategy
```

### Activate/Deactivate

```
/strategy activate <name>           Start running strategy
/strategy deactivate <name>         Stop strategy
/strategy pause <name>              Pause temporarily
/strategy resume <name>             Resume paused strategy
```

### Test & Validate

```
/strategy test <name> --dry-run     Test without real trades
/strategy backtest <name>           Run backtest
/strategy validate <name>           Check for errors
```

---

## TypeScript API Reference

### Create Strategy Builder

```typescript
import { createStrategyBuilder } from 'clodds/strategy';

const builder = createStrategyBuilder({
  // Validation
  requireDryRun: true,
  validateParameters: true,

  // Storage
  storage: 'sqlite',
  dbPath: './strategies.db',
});
```

### Natural Language Strategy

```typescript
// Create from natural language
const strategy = await builder.fromNaturalLanguage({
  description: `
    Buy YES on any market when:
    - Price drops more than 5% in the last hour
    - Volume is above average
    - Spread is less than 2%

    Sell when:
    - Price recovers 3% from entry
    - Or after 24 hours (timeout)

    Risk: Max 5% of portfolio per trade
  `,
  name: 'dip-buyer',
});

console.log(`Created: ${strategy.name}`);
console.log(`Conditions: ${strategy.conditions.length}`);
```

### Template-Based Strategy

```typescript
// Momentum strategy
const momentum = await builder.fromTemplate('momentum', {
  lookbackPeriod: 14,
  entryThreshold: 0.02,
  exitThreshold: 0.01,
  stopLoss: 0.05,
  takeProfit: 0.10,
  maxPositionPct: 10,
});

// Mean reversion strategy
const meanReversion = await builder.fromTemplate('mean-reversion', {
  lookbackPeriod: 20,
  deviationThreshold: 2,  // Standard deviations
  exitOnMean: true,
  stopLoss: 0.08,
});

// Arbitrage strategy
const arbitrage = await builder.fromTemplate('arbitrage', {
  minSpread: 0.02,
  platforms: ['polymarket', 'kalshi'],
  maxSlippage: 0.01,
});

// Breakout strategy
const breakout = await builder.fromTemplate('breakout', {
  rangePeriod: '7d',
  breakoutThreshold: 0.05,
  confirmationVolume: 1.5,  // 1.5x average volume
});
```

### Custom Strategy Code

```typescript
// Full custom strategy
const custom = await builder.create({
  name: 'my-custom-strategy',
  description: 'Buy low-priced markets with high volume',

  // Entry conditions (all must be true)
  entryConditions: [
    { type: 'price', operator: '<', value: 0.30 },
    { type: 'volume24h', operator: '>', value: 50000 },
    { type: 'spread', operator: '<', value: 0.02 },
  ],

  // Exit conditions (any triggers exit)
  exitConditions: [
    { type: 'profit', operator: '>=', value: 0.15 },
    { type: 'loss', operator: '>=', value: 0.10 },
    { type: 'holdTime', operator: '>=', value: '48h' },
  ],

  // Risk management
  risk: {
    maxPositionPct: 5,
    stopLoss: 0.10,
    takeProfit: 0.20,
    maxConcurrentPositions: 5,
  },

  // Execution
  execution: {
    orderType: 'limit',
    limitBuffer: 0.005,
    retries: 3,
  },
});
```

### Validate Strategy

```typescript
const validation = await builder.validate(strategy);

if (validation.valid) {
  console.log('✅ Strategy is valid');
} else {
  console.log('❌ Validation errors:');
  for (const error of validation.errors) {
    console.log(`  - ${error}`);
  }
}

// Warnings (not blocking)
for (const warning of validation.warnings) {
  console.log(`⚠️ ${warning}`);
}
```

### Activate Strategy

```typescript
// Start with dry-run first (required)
await builder.activate(strategy.name, {
  dryRun: true,
  notifyOnTrade: true,
});

// After validation, go live
await builder.activate(strategy.name, {
  dryRun: false,
  capital: 5000,  // Allocate $5000
});
```

### Monitor Strategy

```typescript
const status = await builder.getStatus(strategy.name);

console.log(`Status: ${status.status}`);  // 'active' | 'paused' | 'stopped'
console.log(`Trades: ${status.trades}`);
console.log(`P&L: $${status.pnl}`);
console.log(`Win Rate: ${status.winRate}%`);
console.log(`Active Positions: ${status.activePositions}`);
console.log(`Last Signal: ${status.lastSignal}`);
```

### List Strategies

```typescript
const strategies = await builder.list();

for (const s of strategies) {
  console.log(`${s.name}: ${s.status}`);
  console.log(`  Type: ${s.template || 'custom'}`);
  console.log(`  P&L: $${s.pnl}`);
  console.log(`  Trades: ${s.trades}`);
}
```

---

## Built-in Templates

| Template | Description |
|----------|-------------|
| `momentum` | Follow price trends |
| `mean-reversion` | Buy dips, sell rallies |
| `arbitrage` | Cross-platform spreads |
| `breakout` | Range breakout entries |
| `pairs` | Correlated market pairs |
| `news-reactive` | React to news events |
| `volume-spike` | Trade on volume surges |

---

## Condition Types

| Type | Description | Example |
|------|-------------|---------|
| `price` | Current price | `< 0.30` |
| `volume24h` | 24h volume | `> 50000` |
| `spread` | Bid-ask spread | `< 0.02` |
| `profit` | Unrealized profit | `>= 0.15` |
| `loss` | Unrealized loss | `>= 0.10` |
| `holdTime` | Time in position | `>= 48h` |
| `priceChange` | Price change % | `< -0.05` (5% drop) |

---

## Best Practices

1. **Always dry-run first** — Test before real money
2. **Start small** — Low capital until proven
3. **Set stop-losses** — Protect against bad trades
4. **Monitor actively** — Check strategy performance
5. **Iterate** — Improve based on results
