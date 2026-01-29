# Trading System

Complete trading infrastructure for prediction markets.

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Trading System                        │
├─────────────┬─────────────┬─────────────┬───────────────┤
│  Execution  │    Bots     │   Safety    │  Opportunity  │
│  Service    │   Manager   │   Manager   │    Finder     │
├─────────────┼─────────────┼─────────────┼───────────────┤
│ • Orders    │ • Strategies│ • Breakers  │ • Arbitrage   │
│ • Fills     │ • Signals   │ • Drawdown  │ • Matching    │
│ • Tracking  │ • Execution │ • Kill      │ • Scoring     │
└─────────────┴─────────────┴─────────────┴───────────────┘
         │              │            │              │
         └──────────────┴────────────┴──────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Trade Logger    │
                    │   (Auto-capture)  │
                    └───────────────────┘
```

## Quick Start

```typescript
import { createTradingSystem } from './trading';

const trading = createTradingSystem(db, {
  execution: {
    polymarket: { apiKey: '...', apiSecret: '...' },
    dryRun: false,
  },
  portfolioValue: 10000,
  autoLog: true,
});

// Execute trades (auto-logged)
await trading.execution.buyLimit({
  platform: 'polymarket',
  marketId: 'abc123',
  outcome: 'YES',
  price: 0.45,
  size: 100,
});

// View stats
const stats = trading.getStats();
console.log(`Win rate: ${stats.winRate}%`);
```

## Commands

| Command | Description |
|---------|-------------|
| `/bot list` | Show all bots |
| `/bot start <id>` | Start a bot |
| `/bot stop <id>` | Stop a bot |
| `/trades stats` | Trade statistics |
| `/trades recent` | Recent trades |
| `/safety status` | Safety controls |
| `/safety kill` | Emergency stop |
| `/backtest <strategy>` | Backtest a strategy |
| `/account list` | List accounts |
| `/abtest create` | Create A/B test |

## Modules

### 1. Trade Logger
Auto-captures all trades to SQLite.

```typescript
// Trades are logged automatically
await trading.execution.buyLimit(order);

// Query trades
const trades = trading.logger.getTrades({ platform: 'polymarket' });
const stats = trading.logger.getStats();
const dailyPnL = trading.logger.getDailyPnL(30);
```

### 2. Bot Manager
Run automated trading strategies.

```typescript
// Register a strategy
trading.bots.registerStrategy(createMeanReversionStrategy({
  platforms: ['polymarket'],
  threshold: 0.05,
  stopLoss: 0.1,
}));

// Start/stop
await trading.bots.startBot('mean-reversion');
await trading.bots.stopBot('mean-reversion');

// Monitor
const status = trading.bots.getBotStatus('mean-reversion');
```

### 3. Safety Manager
Circuit breakers and risk controls.

```typescript
// Check before trading
if (!trading.safety.canTrade()) {
  console.log('Trading disabled:', trading.safety.getState().disabledReason);
  return;
}

// Manual kill switch
trading.safety.killSwitch('Manual stop');

// Resume after cooldown
trading.safety.resumeTrading();
```

### 4. Opportunity Finder
Cross-platform arbitrage detection.

```typescript
const opps = await trading.opportunity.scan({ minEdge: 1 });

for (const opp of opps) {
  console.log(`${opp.edgePct}% edge on ${opp.markets[0].question}`);
}
```

## Built-in Strategies

### Mean Reversion
Buys dips, sells rallies.

```typescript
createMeanReversionStrategy({
  platforms: ['polymarket'],
  lookbackPeriods: 20,
  threshold: 0.05,      // 5% deviation
  takeProfitPct: 0.03,
  stopLossPct: 0.10,
});
```

### Momentum
Follows trends.

```typescript
createMomentumStrategy({
  platforms: ['kalshi'],
  trendPeriods: 10,
  minMomentum: 0.02,
  holdPeriods: 5,
});
```

### Arbitrage
Cross-platform price differences.

```typescript
createArbitrageStrategy({
  platforms: ['polymarket', 'kalshi'],
  minSpread: 0.02,
  maxPositionSize: 500,
});
```

## Creating Custom Strategies

```typescript
import { Strategy, StrategyConfig, Signal } from './trading';

const myStrategy: Strategy = {
  config: {
    id: 'my-strategy',
    name: 'My Custom Strategy',
    platforms: ['polymarket'],
    marketTypes: ['binary'],
    intervalMs: 60000,
    dryRun: true,
  },

  async evaluate(context) {
    const signals: Signal[] = [];

    // Your logic here
    const price = context.prices.get('polymarket:market123');

    if (price && price < 0.3) {
      signals.push({
        type: 'buy',
        platform: 'polymarket',
        marketId: 'market123',
        outcome: 'YES',
        price: price,
        sizePct: 5,
        reason: 'Undervalued',
        confidence: 0.8,
      });
    }

    return signals;
  },

  async onSignal(signal, trade) {
    console.log('Trade executed:', trade);
  },
};

trading.bots.registerStrategy(myStrategy);
```

## Natural Language Strategy Builder

Create strategies from descriptions:

```bash
/strategy create buy when price drops 5% on polymarket with 10% stop loss
```

Generates:
```typescript
{
  name: "price-drop-buyer",
  template: "mean_reversion",
  platforms: ["polymarket"],
  entry: [{ type: "price_drop", value: 5 }],
  exit: [{ type: "stop_loss", value: 10 }],
  risk: { maxPositionSize: 100, stopLossPct: 10 }
}
```

## Multi-Account & A/B Testing

Run same strategy on multiple accounts to test variations.

```typescript
// Add accounts
trading.accounts.addAccount({
  name: 'Main',
  platform: 'polymarket',
  type: 'live',
  credentials: { apiKey: '...' },
});

trading.accounts.addAccount({
  name: 'Test',
  platform: 'polymarket',
  type: 'test_a',
  credentials: { apiKey: '...' },
});

// Create A/B test
const test = createQuickABTest(trading.accounts, {
  name: 'Stop Loss Test',
  strategyId: 'mean-reversion',
  accountA: 'main-id',
  accountB: 'test-id',
  varyParam: 'stopLossPct',
  valueA: 5,
  valueB: 10,
});

// Start and monitor
await trading.accounts.startABTest(test.id);
const results = trading.accounts.calculateResults(test.id);
```

## Safety Controls

### Circuit Breakers

| Breaker | Default | Description |
|---------|---------|-------------|
| Daily Loss | $500 | Max loss per day |
| Max Drawdown | 20% | From peak equity |
| Position Limit | 25% | Single position max |
| Correlation | 3 | Max same-direction bets |

### Configuration

```typescript
createSafetyManager(db, {
  dailyLossLimit: 500,
  maxDrawdownPct: 20,
  maxPositionPct: 25,
  maxCorrelatedPositions: 3,
  cooldownMs: 3600000, // 1 hour
});
```

### Kill Switch

```bash
/safety kill "Market volatility"
```

Immediately stops all bots and blocks new trades.

## Resilient Execution

Built-in retry and rate limiting.

```typescript
import { withRetry, withRateLimit } from './trading';

// Exponential backoff
const result = await withRetry(
  () => execution.buyLimit(order),
  { maxRetries: 3, baseDelayMs: 1000 }
);

// Rate limiting per platform
const rateLimitedBuy = withRateLimit(
  execution.buyLimit,
  'polymarket',
  { requestsPerMinute: 60 }
);
```

## Credential Security

Encrypted credential storage with AES-256-GCM.

```typescript
import { createSecretStore } from './trading';

const secrets = createSecretStore(db, 'your-master-password');

// Store credentials
secrets.store('polymarket_api_key', 'pk_live_xxx');

// Retrieve
const apiKey = secrets.retrieve('polymarket_api_key');

// Rotate
secrets.rotateKey('new-master-password');
```

## Custom Tracking

Add custom columns to track additional data.

```typescript
// Define column
trading.tracking.defineColumn({
  name: 'sentiment_score',
  type: 'number',
  category: 'signal',
  description: 'News sentiment at entry',
  showInSummary: true,
  aggregation: 'avg',
});

// Track values
trading.tracking.track({
  entityType: 'trade',
  entityId: trade.id,
  column: 'sentiment_score',
  value: 0.72,
});

// Query
const avgSentiment = trading.tracking.getSummary('sentiment_score');
```

## DevTools (Optional)

Debug and monitor in development.

```typescript
import { createDevTools, measure } from './trading';

const devtools = createDevTools({
  console: { enabled: true, level: 'debug' },
  websocket: { enabled: true, port: 9229 },
});

// Profile operations
const result = await measure(devtools, 'order_execution', async () => {
  return await execution.buyLimit(order);
});
```

## Backtesting

Test strategies on historical data.

```typescript
const engine = createBacktestEngine(db, {
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-12-31'),
  initialCapital: 10000,
});

const result = await engine.run(myStrategy, historicalPrices);

console.log('Sharpe:', result.metrics.sharpeRatio);
console.log('Max DD:', result.metrics.maxDrawdownPct);
console.log('Win Rate:', result.metrics.winRate);
```

## Bot State Persistence

Save and restore bot state across restarts.

```typescript
// Auto-saved
trading.bots.startBot('mean-reversion');

// After restart, restore
const checkpoint = trading.state.loadCheckpoint('mean-reversion');
if (checkpoint) {
  trading.bots.restoreState('mean-reversion', checkpoint);
}
```

## Streaming

Broadcast trading activity (privacy-safe).

```typescript
trading.stream.configure({
  privacy: 'obscured',
  showPlatforms: true,
  showExactPrices: false,
});

trading.stream.addChannel({
  type: 'discord',
  webhookUrl: 'https://discord.com/api/webhooks/...',
});
```

## Configuration Reference

```json
{
  "trading": {
    "execution": {
      "polymarket": {
        "apiKey": "...",
        "apiSecret": "...",
        "funderAddress": "0x..."
      },
      "kalshi": {
        "apiKey": "...",
        "apiSecret": "..."
      },
      "dryRun": false
    },
    "portfolioValue": 10000,
    "autoLog": true,
    "botIntervalMs": 60000
  },
  "safety": {
    "dailyLossLimit": 500,
    "maxDrawdownPct": 20,
    "maxPositionPct": 25
  },
  "opportunityFinder": {
    "enabled": true,
    "minEdge": 0.5,
    "semanticMatching": true
  }
}
```

## API Reference

See individual module docs:
- [Opportunity Finder](./OPPORTUNITY_FINDER.md)
- [Bot Manager](./BOTS.md)
- [Safety Controls](./SAFETY.md)
- [Execution Service](./EXECUTION.md)
