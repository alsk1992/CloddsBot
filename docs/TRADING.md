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
Cross-platform price differences with semantic entity matching.

```typescript
createArbitrageStrategy({
  platforms: ['polymarket', 'kalshi'],
  minSpread: 0.02,
  maxPositionSize: 500,
  // Entity matching for accurate cross-platform comparison
  matchEntities: true,  // Extract year, person, threshold from market titles
});
```

**Entity Extraction:**
The arbitrage strategy extracts entities from market titles for accurate matching:
- **Year**: "2024 Election" vs "2025 Election" - prevents false matches
- **Person**: "Trump" vs "Biden" - ensures same subject
- **Threshold**: "50%" vs "60%" - prevents threshold mismatches

Canonical IDs are generated for cross-platform matching:
```
polymarket:trump-2024-president → canonical:election:trump:2024
kalshi:POTUS-24-DJT → canonical:election:trump:2024
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
import { createBacktestEngine } from './trading';

const engine = createBacktestEngine(db);

const result = await engine.run(myStrategy, {
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-12-31'),
  initialCapital: 10000,
  commissionPct: 0.1,
  slippagePct: 0.05,
  riskFreeRate: 5,
});

console.log('Sharpe:', result.metrics.sharpeRatio);
console.log('Sortino:', result.metrics.sortinoRatio);
console.log('Calmar:', result.metrics.calmarRatio);
console.log('Max DD:', result.metrics.maxDrawdownPct);
console.log('Win Rate:', result.metrics.winRate);
console.log('Profit Factor:', result.metrics.profitFactor);
```

### Backtest Metrics

| Metric | Description |
|--------|-------------|
| totalReturnPct | Total return over period |
| annualizedReturnPct | Annualized return |
| sharpeRatio | Risk-adjusted return (vs risk-free rate) |
| sortinoRatio | Downside risk-adjusted return |
| calmarRatio | Return / max drawdown |
| maxDrawdownPct | Maximum peak-to-trough decline |
| profitFactor | Gross profit / gross loss |
| winRate | Percentage of winning trades |

### Monte Carlo Simulation

```typescript
const monte = engine.monteCarlo(result, 10000);

console.log('Prob of Profit:', monte.probabilityOfProfit);
console.log('5th percentile:', monte.percentiles.p5);
console.log('Expected value:', monte.expectedValue);
```

### Compare Strategies

```typescript
const comparison = await engine.compare(
  [strategy1, strategy2, strategy3],
  config
);

console.log('Ranking:', comparison.ranking); // Best to worst by Sharpe
```

### API Endpoint

```bash
POST /api/backtest
Content-Type: application/json

{
  "strategyId": "mean-reversion",
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "initialCapital": 10000
}
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
  },
  "whaleTracking": {
    "enabled": false,
    "minTradeSize": 10000,
    "minPositionSize": 50000,
    "platforms": ["polymarket"],
    "realtime": true
  },
  "copyTrading": {
    "enabled": false,
    "dryRun": true,
    "followedAddresses": [],
    "sizingMode": "fixed",
    "fixedSize": 100,
    "maxPositionSize": 500,
    "copyDelayMs": 5000
  },
  "smartRouting": {
    "enabled": true,
    "mode": "balanced",
    "platforms": ["polymarket", "kalshi"],
    "maxSlippage": 1,
    "preferMaker": true
  },
  "evmDex": {
    "enabled": false,
    "defaultChain": "ethereum",
    "slippageBps": 50,
    "mevProtection": "basic",
    "maxPriceImpact": 3
  },
  "realtimeAlerts": {
    "enabled": false,
    "targets": [
      { "platform": "telegram", "chatId": "123456789" }
    ],
    "whaleTrades": { "enabled": true, "minSize": 50000, "cooldownMs": 300000 },
    "arbitrage": { "enabled": true, "minEdge": 2, "cooldownMs": 600000 },
    "priceMovement": { "enabled": true, "minChangePct": 5, "windowMs": 300000 },
    "copyTrading": { "enabled": true, "onCopied": true, "onFailed": true }
  },
  "arbitrageExecution": {
    "enabled": false,
    "dryRun": true,
    "minEdge": 1.0,
    "minLiquidity": 500,
    "maxPositionSize": 100,
    "maxDailyLoss": 500,
    "maxConcurrentPositions": 3,
    "platforms": ["polymarket", "kalshi"],
    "preferMakerOrders": true,
    "confirmationDelayMs": 0
  }
}
```

## Advanced Features

### Whale Tracking

Monitor large trades on Polymarket to identify market-moving activity.

```typescript
import { createWhaleTracker } from './feeds/polymarket/whale-tracker';

const tracker = createWhaleTracker({
  minTradeSize: 10000,    // Track trades > $10k
  minPositionSize: 50000, // Track positions > $50k
});

tracker.on('trade', (trade) => {
  console.log(`Whale ${trade.side}: $${trade.usdValue} on "${trade.marketQuestion}"`);
});

tracker.on('positionOpened', (position) => {
  console.log(`New whale position: ${position.address}`);
});

await tracker.start();
```

### Copy Trading

Automatically mirror trades from successful wallets with automatic stop-loss and take-profit monitoring.

```typescript
import { createCopyTradingService } from './trading/copy-trading';

const copier = createCopyTradingService(whaleTracker, execution, {
  followedAddresses: ['0x...', '0x...'],
  sizingMode: 'fixed',  // 'fixed' | 'proportional' | 'percentage'
  fixedSize: 100,       // $100 per copied trade
  maxPositionSize: 500,
  copyDelayMs: 5000,    // Wait 5s before copying
  dryRun: true,
  // Stop-loss / Take-profit
  stopLossPct: 10,      // Exit at 10% loss
  takeProfitPct: 20,    // Exit at 20% profit
});

copier.on('tradeCopied', (trade) => console.log('Copied:', trade.id));
copier.on('positionClosed', (trade, reason) => {
  console.log(`Closed ${trade.id}: ${reason} at ${trade.exitPrice}`);
});
copier.start();
```

**SL/TP Monitoring:**
- 5-second price polling interval
- Automatic position exit when thresholds hit
- Events: `positionClosed` with reason ('stop_loss', 'take_profit', 'manual')

### Smart Order Routing

Route orders to the platform with best price/liquidity.

```typescript
import { createSmartRouter } from './execution/smart-router';

const router = createSmartRouter(feeds, {
  mode: 'balanced',  // 'best_price' | 'best_liquidity' | 'lowest_fee' | 'balanced'
  enabledPlatforms: ['polymarket', 'kalshi'],
  preferMaker: true,
});

const result = await router.findBestRoute({
  marketId: 'trump-2024',
  side: 'buy',
  size: 1000,
});

console.log(`Best: ${result.bestRoute.platform} @ ${result.bestRoute.netPrice}`);
console.log(`Savings: $${result.totalSavings}`);
```

### Auto-Arbitrage Execution

Automatically execute detected arbitrage opportunities.

```typescript
import { createOpportunityExecutor } from './opportunity/executor';

const executor = createOpportunityExecutor(finder, execution, {
  minEdge: 1.0,              // Min 1% edge
  maxPositionSize: 100,      // Max $100/trade
  maxDailyLoss: 500,         // Stop at $500 loss
  maxConcurrentPositions: 3,
  dryRun: true,              // Test mode
});

executor.on('executed', (opp, result) => {
  console.log(`Executed ${opp.id}: profit $${result.actualProfit}`);
});

executor.start();
```

### EVM DEX Trading

Trade on Uniswap V3 and 1inch across EVM chains.

```typescript
import { executeUniswapSwap, compareDexRoutes } from './evm';

// Compare Uniswap vs 1inch
const comparison = await compareDexRoutes({
  chain: 'ethereum',
  fromToken: 'USDC',
  toToken: 'WETH',
  amount: '1000',
});

console.log(`Best route: ${comparison.best}, saves ${comparison.savings}`);

// Execute with MEV protection
const result = await executeUniswapSwap({
  chain: 'ethereum',
  inputToken: 'USDC',
  outputToken: 'WETH',
  amount: '1000',
});
```

### MEV Protection

Protect swaps from sandwich attacks and front-running.

```typescript
import { createMevProtectionService } from './execution/mev-protection';

const mev = createMevProtectionService({
  level: 'aggressive',  // 'none' | 'basic' | 'aggressive'
  maxPriceImpact: 3,
});

// EVM: uses Flashbots Protect / MEV Blocker
await mev.sendEvmTransaction('ethereum', signedTx);

// Solana: uses Jito bundles
const bundle = await mev.createSolanaBundle(transactions, payer);
await mev.submitSolanaBundle(bundle);
```

### Crypto Whale Tracking

Monitor whale activity across multiple blockchains.

```typescript
import { createCryptoWhaleTracker } from './feeds/crypto/whale-tracker';

const tracker = createCryptoWhaleTracker({
  chains: ['solana', 'ethereum', 'polygon', 'arbitrum'],
  thresholds: {
    solana: 10000,     // $10k+ on Solana
    ethereum: 50000,   // $50k+ on ETH
    polygon: 5000,     // $5k+ on Polygon
  },
  // API keys
  birdeyeApiKey: process.env.BIRDEYE_API_KEY,  // For Solana
  alchemyApiKey: process.env.ALCHEMY_API_KEY,  // For EVM chains
});

// Real-time transaction events
tracker.on('transaction', (tx) => {
  console.log(`${tx.chain}: ${tx.type} $${tx.usdValue} by ${tx.wallet}`);
});

// Whale alerts (above threshold)
tracker.on('alert', (alert) => {
  console.log(`WHALE ALERT: ${alert.message}`);
});

// Watch specific wallets
tracker.watchWallet('solana', 'ABC123...', { label: 'Whale 1' });

await tracker.start();

// Query methods
const topWhales = tracker.getTopWhales('solana', 10);
const recent = tracker.getRecentTransactions('ethereum', 100);
```

**Supported Chains:**
| Chain | Provider | WebSocket | Features |
|-------|----------|-----------|----------|
| Solana | Birdeye | Yes | Token transfers, swaps, NFTs |
| Ethereum | Alchemy | Yes | ERC-20, ETH transfers |
| Polygon | Alchemy | Yes | MATIC, tokens |
| Arbitrum | Alchemy | Yes | L2 activity |
| Base | Alchemy | Yes | Coinbase L2 |
| Optimism | Alchemy | Yes | OP ecosystem |

**Transaction Types:**
- `transfer` - Token/native transfers
- `swap` - DEX swaps
- `nft` - NFT purchases/sales
- `stake` - Staking operations
- `unknown` - Other transactions

### Slippage Estimation

Real orderbook-based slippage calculation for accurate execution estimates.

```typescript
import { estimateSlippage } from './execution';

const estimate = await estimateSlippage('polymarket', 'market-id', 'buy', 1000);
console.log(`Expected slippage: ${estimate.slippagePct}%`);
console.log(`Average fill price: ${estimate.avgFillPrice}`);
console.log(`Total filled: ${estimate.totalFilled}`);
```

The system fetches live orderbook data and simulates walking the book to calculate realistic fill prices.

## API Reference

See individual module docs:
- [Opportunity Finder](./OPPORTUNITY_FINDER.md)
- [Bot Manager](./BOTS.md)
- [Safety Controls](./SAFETY.md)
- [Execution Service](./EXECUTION.md)
