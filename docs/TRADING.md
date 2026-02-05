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

### 1. Configure credentials in `~/.clodds/clodds.json`:

```json
{
  "trading": {
    "enabled": true,
    "dryRun": false,
    "maxOrderSize": 100,
    "polymarket": {
      "address": "0xYOUR_WALLET",
      "apiKey": "your-api-key",
      "apiSecret": "your-api-secret",
      "apiPassphrase": "your-passphrase"
    }
  }
}
```

Or use environment variables with `${VAR}` substitution:
```json
{
  "trading": {
    "enabled": true,
    "dryRun": false,
    "polymarket": {
      "address": "${POLY_ADDRESS}",
      "apiKey": "${POLY_API_KEY}",
      "apiSecret": "${POLY_API_SECRET}",
      "apiPassphrase": "${POLY_API_PASSPHRASE}"
    }
  }
}
```

### 2. Get Polymarket Credentials

1. Go to https://polymarket.com → Settings → API Keys
2. Create new API key (you'll get key, secret, passphrase)
3. Your connected wallet address is the `address` field

### 3. Get Kalshi Credentials

1. Go to https://kalshi.com → Settings → API Keys
2. Generate RSA key pair locally
3. Upload public key to Kalshi
4. Use the `apiKeyId` from Kalshi and your local `privateKeyPem`

### 4. Execute trades

```typescript
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

### 5. Orderbook Imbalance Detector
Analyze orderbook to detect directional pressure and optimal entry timing.

```typescript
import { getOrderbookImbalance } from './execution';

// Get imbalance for a Polymarket token
const imbalance = await getOrderbookImbalance('polymarket', 'token-id-here');

if (imbalance) {
  console.log(`Signal: ${imbalance.signal}`);        // 'bullish', 'bearish', 'neutral'
  console.log(`Score: ${imbalance.imbalanceScore}`); // -1 to +1
  console.log(`Bid/Ask Ratio: ${imbalance.bidAskRatio}`);
  console.log(`Confidence: ${imbalance.confidence}`);

  // Trading decision
  if (imbalance.signal === 'bullish' && imbalance.confidence > 0.6) {
    console.log('Strong buy pressure - favorable for BUY orders');
  } else if (imbalance.signal === 'bearish' && imbalance.confidence > 0.6) {
    console.log('Strong sell pressure - favorable for SELL orders');
  }
}

// Use with opportunity scoring for better entry timing
const scorer = createOpportunityScorer();
const enhancedScore = await scorer.scoreWithImbalance(opportunity);
console.log(`Timing: ${enhancedScore.timingRecommendation}`); // 'execute_now', 'wait', 'monitor'
```

**Imbalance Metrics:**
- `imbalanceScore`: -1 (all asks) to +1 (all bids) - indicates directional pressure
- `bidAskRatio`: Bid volume / Ask volume - >1 means more buying pressure
- `signal`: 'bullish' (score > 0.15), 'bearish' (score < -0.15), 'neutral'
- `confidence`: 0-1 based on volume, spread, and imbalance magnitude

**Agent Tool:**
```
orderbook_imbalance platform=polymarket market_id=<token_id>
```

### 6. Dynamic Kelly Criterion Sizing
Adaptive position sizing that adjusts based on recent performance, drawdown, and volatility.

```typescript
import { createDynamicKellyCalculator } from './trading/kelly';

const kelly = createDynamicKellyCalculator(10000, {  // $10k initial bankroll
  baseMultiplier: 0.25,    // Quarter Kelly (conservative)
  maxKelly: 0.25,          // Never more than 25% of bankroll
  maxDrawdown: 0.15,       // Reduce size at 15% drawdown
  volatilityScaling: true, // Adjust for return volatility
});

// Calculate position size
const result = kelly.calculate(0.05, 0.8, { category: 'crypto' });
console.log(`Kelly: ${result.kelly * 100}%`);
console.log(`Position: $${result.positionSize}`);
console.log(`Timing: ${result.timingRecommendation}`);

// Record trade outcomes to improve sizing
kelly.recordTrade({ id: 'trade-1', pnlPct: 0.08, won: true, category: 'crypto' });
kelly.recordTrade({ id: 'trade-2', pnlPct: -0.05, won: false, category: 'politics' });

// Update bankroll
kelly.updateBankroll(10500);  // After wins

// Check state
const state = kelly.getState();
console.log(`Drawdown: ${state.currentDrawdown * 100}%`);
console.log(`Win streak: ${state.winStreak}`);
console.log(`Recent win rate: ${state.recentWinRate * 100}%`);
```

**Dynamic Adjustments:**
- **Drawdown Reduction**: Automatically reduces size when losing
- **Win Streak Boost**: Increases size after consecutive wins
- **Volatility Scaling**: Adjusts for return volatility vs target
- **Category Performance**: Tracks win rates by market category
- **Sample Size**: More conservative with fewer trades

### 7. ML Signal Model
Machine learning signal model for trade entry/exit decisions.

```typescript
import { createMLSignalModel, extractFeatures } from './trading/ml-signals';

// Create model
const model = createMLSignalModel({
  type: 'simple',        // 'simple' | 'ensemble' | 'xgboost_python'
  horizon: '24h',        // Prediction horizon
  minConfidence: 0.6,    // Minimum confidence for signals
});

// Extract features from market data
const features = extractFeatures(priceHistory, orderbookSnapshot, { category: 'crypto' });

// Get prediction
const signal = await model.predict(features);
console.log(`Direction: ${signal.direction}`);   // 1 (buy), -1 (sell), 0 (hold)
console.log(`Confidence: ${signal.confidence}`);
console.log(`Prob Up: ${signal.probUp}`);

// Train on historical data
await model.train(trainingData);
model.save();

// Record outcomes for continuous improvement
model.addTrainingData({ features, outcome: { direction: 1, return: 0.05, horizon: '24h' }, timestamp: new Date() });
await model.retrain();
```

**Features Used:**
- Price: change1h, change24h, volatility, RSI, momentum
- Volume: current vs average, buy ratio
- Orderbook: bid/ask ratio, imbalance, spread, depth
- Market: days to expiry, total volume, category

### 8. Cross-Asset Correlation Arbitrage
Find arbitrage from correlated but mispriced markets.

```typescript
import { createCorrelationFinder } from './opportunity/correlation';

const finder = createCorrelationFinder(feeds, db, {
  minCorrelation: 0.7,
  minMispricing: 0.02,  // 2%
});

// Find all correlated pairs with mispricing
const pairs = await finder.findCorrelatedPairs();

// Find actionable arbitrage opportunities
const arbs = await finder.findArbitrage();
for (const arb of arbs) {
  console.log(`Edge: ${arb.edgePct}%`);
  console.log(`Type: ${arb.pair.correlationType}`);
  console.log(`Trades: ${arb.trades.map(t => `${t.action} ${t.outcome} on ${t.platform}`)}`);
}

// Add custom correlation rules
finder.addCorrelationRule({
  id: 'custom_rule',
  patternA: /bitcoin.*100k.*jan/i,
  patternB: /bitcoin.*100k.*feb/i,
  type: 'implies',
  correlation: 1.0,
  description: 'If BTC hits $100k by Jan, it will also hit by Feb',
});
```

**Correlation Types:**
- `identical`: Same event on different platforms
- `implies`: A happening means B must happen (P(B) >= P(A))
- `mutually_exclusive`: A and B cannot both happen (P(A) + P(B) <= 1)
- `time_shifted`: Earlier deadline implies later deadline
- `partial`: Statistical correlation (0-1)

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

### Market Making
Two-sided quoting with inventory management and volatility-adjusted spreads.

```typescript
import { createMMStrategy } from './trading/market-making';

const strategy = createMMStrategy({
  id: 'btc-yes',
  platform: 'polymarket',
  marketId: '0x...',
  tokenId: '12345',
  outcomeName: 'BTC > 100k',
  baseSpreadCents: 2,       // Quote +-$0.02 from fair value
  minSpreadCents: 1,
  maxSpreadCents: 10,
  orderSize: 50,             // 50 shares per side
  maxInventory: 500,         // Skew aggressively beyond this
  skewFactor: 0.5,           // 0 = no skew, 1 = full skew
  volatilityMultiplier: 10,  // Widen spread in volatile markets
  fairValueAlpha: 0.3,       // EMA smoothing
  fairValueMethod: 'weighted_mid',
  requoteIntervalMs: 5000,
  requoteThresholdCents: 1,
  maxPositionValueUsd: 1000,
  maxLossUsd: 100,
  maxOrdersPerSide: 1,
}, { execution, feeds });

botManager.registerStrategy(strategy);
```

Key features:
- **Pure calculation engine** — all pricing/quoting logic is side-effect-free and testable
- **Inventory skew** — asymmetric spreads to reduce directional exposure
- **Volatility adjustment** — wider spreads in volatile markets to avoid adverse selection
- **Cancel-then-place** — requotes on each tick (no amendment in prediction market APIs)
- **Post-only orders** — uses `makerBuy`/`makerSell` for zero taker fees on Polymarket
- **Auto-halt** — stops quoting when max loss is exceeded
- **CLI control** — `/mm start`, `/mm stop`, `/mm status`, `/mm config`

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

> **Enable Real Trading:** Set `trading.enabled: true` and `trading.dryRun: false` with valid credentials.

```json
{
  "trading": {
    "enabled": true,
    "dryRun": false,
    "maxOrderSize": 100,
    "maxDailyLoss": 200,
    "polymarket": {
      "address": "0xYOUR_WALLET_ADDRESS",
      "apiKey": "your-polymarket-api-key",
      "apiSecret": "your-polymarket-api-secret",
      "apiPassphrase": "your-polymarket-api-passphrase",
      "privateKey": "0xYOUR_PRIVATE_KEY"
    },
    "kalshi": {
      "apiKeyId": "your-kalshi-api-key-id",
      "privateKeyPem": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
    }
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
  // ERC-8004 Identity Verification (recommended)
  requireVerifiedIdentity: true,  // Only copy verified traders
  minReputationScore: 50,         // Minimum reputation (0-100)
  identityNetwork: 'base',        // Mainnet (live Jan 29, 2026)
});

copier.on('tradeCopied', (trade) => console.log('Copied:', trade.id));
copier.on('tradeSkipped', (trade, reason) => {
  if (reason === 'unverified_identity') {
    console.log('Skipped unverified trader:', trade.maker);
  }
});
copier.on('positionClosed', (trade, reason) => {
  console.log(`Closed ${trade.id}: ${reason} at ${trade.exitPrice}`);
});
copier.start();
```

**ERC-8004 Identity Verification:**

Prevents impersonation attacks where malicious actors pose as successful traders.

```typescript
import { verifyAgent, hasIdentity } from './identity/erc8004';

// Check if trader has verified identity before following
const isVerified = await hasIdentity('0x742d35Cc...');
if (!isVerified) {
  console.warn('WARNING: Trader has no verified identity');
}

// Get full verification details
const result = await verifyAgent(1234);  // by agent ID
console.log(`Name: ${result.name}`);
console.log(`Reputation: ${result.reputation?.averageScore}/100`);
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

### Perpetual Futures Trading

Trade leveraged perpetual futures across centralized and decentralized exchanges with comprehensive API coverage, database tracking, custom strategies, and A/B testing.

**Supported Exchanges:**

| Exchange | Type | Max Leverage | KYC | Settlement | API Methods |
|----------|------|--------------|-----|------------|-------------|
| Binance Futures | CEX | 125x | Yes | USDT | 55+ |
| Bybit | CEX | 100x | Yes | USDT | 50+ |
| Hyperliquid | DEX | 50x | No | USDC (Arbitrum) | 60+ |
| MEXC | CEX | 200x | No* | USDT | 35+ |

*MEXC allows trading without KYC for smaller amounts.

#### Quick Setup

```typescript
import { setupFromEnv } from './trading/futures';

// Auto-configure from environment variables
const { clients, database, strategyEngine } = await setupFromEnv();

// Required env vars:
// BINANCE_API_KEY, BINANCE_API_SECRET
// BYBIT_API_KEY, BYBIT_API_SECRET
// HYPERLIQUID_PRIVATE_KEY, HYPERLIQUID_WALLET (Note: HYPERLIQUID_WALLET not WALLET_ADDRESS)
// MEXC_API_KEY, MEXC_API_SECRET
// DATABASE_URL (PostgreSQL for trade tracking)
```

#### Skill Commands

Each exchange has a dedicated skill with slash commands:

**Binance Futures (`/bf`):**
| Command | Description |
|---------|-------------|
| `/bf balance` | Margin balance |
| `/bf positions` | Open positions |
| `/bf orders` | Open orders |
| `/bf long <sym> <size> [lev]x` | Open long position |
| `/bf short <sym> <size> [lev]x` | Open short position |
| `/bf close <symbol>` | Close position |
| `/bf closeall` | Close all positions |
| `/bf leverage <sym> <value>` | Set leverage |
| `/bf price <symbol>` | Current price |
| `/bf funding <symbol>` | Funding rate |
| `/bf markets [query]` | List markets |

**Bybit (`/by`):**
| Command | Description |
|---------|-------------|
| `/by balance` | Wallet balance |
| `/by positions` | Open positions |
| `/by orders` | Open orders |
| `/by long <sym> <qty> [lev]x` | Open long |
| `/by short <sym> <qty> [lev]x` | Open short |
| `/by close <symbol>` | Close position |
| `/by closeall` | Close all |
| `/by leverage <sym> <value>` | Set leverage |
| `/by price <symbol>` | Current price |
| `/by funding <symbol>` | Funding rate |
| `/by markets [query]` | List markets |

**MEXC (`/mx`):**
| Command | Description |
|---------|-------------|
| `/mx balance` | Account balance |
| `/mx positions` | Open positions |
| `/mx orders` | Open orders |
| `/mx long <sym> <vol> [lev]x` | Open long |
| `/mx short <sym> <vol> [lev]x` | Open short |
| `/mx close <symbol>` | Close position |
| `/mx closeall` | Close all |
| `/mx leverage <sym> <value>` | Set leverage |
| `/mx price <symbol>` | Current price |
| `/mx funding <symbol>` | Funding rate |
| `/mx markets [query]` | List markets |

**Hyperliquid (`/hl`):** See dedicated section below.

#### Agent Tools

The agent also has direct tool access for programmatic trading:

| Exchange | Tools |
|----------|-------|
| Binance | `binance_balance`, `binance_positions`, `binance_orders`, `binance_long`, `binance_short`, `binance_close`, `binance_cancel`, `binance_cancel_all`, `binance_price`, `binance_funding` |
| Bybit | `bybit_balance`, `bybit_positions`, `bybit_orders`, `bybit_long`, `bybit_short`, `bybit_close`, `bybit_cancel`, `bybit_cancel_all`, `bybit_price`, `bybit_funding` |
| MEXC | `mexc_balance`, `mexc_positions`, `mexc_orders`, `mexc_long`, `mexc_short`, `mexc_close`, `mexc_cancel`, `mexc_cancel_all`, `mexc_price`, `mexc_funding` |
| Hyperliquid | `hyperliquid_balance`, `hyperliquid_positions`, `hyperliquid_orders`, `hyperliquid_long`, `hyperliquid_short`, `hyperliquid_close`, `hyperliquid_cancel`, `hyperliquid_cancel_all`, `hyperliquid_price`, `hyperliquid_funding`, `hyperliquid_leverage` |

All trading tools automatically log to the database when `DATABASE_URL` is set.

#### Database Integration

All trades are automatically logged to PostgreSQL for analysis:

```sql
-- Tables created automatically:
-- futures_trades: All executed trades with P&L
-- futures_strategy_variants: A/B test configurations

-- Query your performance
SELECT
  exchange,
  symbol,
  COUNT(*) as trades,
  SUM(realized_pnl) as total_pnl,
  AVG(realized_pnl) as avg_pnl
FROM futures_trades
GROUP BY exchange, symbol
ORDER BY total_pnl DESC;
```

```typescript
import { FuturesDatabase } from './trading/futures';

const db = new FuturesDatabase(process.env.DATABASE_URL!);
await db.initialize();

// Log a trade
await db.logTrade({
  exchange: 'binance',
  symbol: 'BTCUSDT',
  orderId: '12345',
  side: 'BUY',
  price: 95000,
  quantity: 0.01,
  realizedPnl: 50.25,
  commission: 0.95,
  timestamp: Date.now(),
});

// Query trades
const trades = await db.getTrades({ exchange: 'binance', symbol: 'BTCUSDT' });
const stats = await db.getTradeStats('binance');
```

#### Custom Strategies

Build your own trading strategies with the `FuturesStrategy` interface:

```typescript
import { FuturesStrategy, StrategyEngine, StrategySignal } from './trading/futures';

class MyStrategy implements FuturesStrategy {
  name = 'my-strategy';

  constructor(private config: { threshold: number }) {}

  async analyze(data: MarketData): Promise<StrategySignal | null> {
    // Your logic here
    if (data.priceChange > this.config.threshold) {
      return {
        action: 'BUY',
        symbol: data.symbol,
        confidence: 0.8,
        reason: 'Strong upward momentum',
        metadata: { priceChange: data.priceChange },
      };
    }
    return null;
  }
}

// Register and run
const engine = new StrategyEngine(db);
engine.registerStrategy(new MyStrategy({ threshold: 0.02 }));
```

#### A/B Testing Strategies

Test multiple strategy variants simultaneously:

```typescript
// Register strategy variants
engine.registerVariant('momentum', 'aggressive', { threshold: 0.02, leverage: 10 });
engine.registerVariant('momentum', 'conservative', { threshold: 0.05, leverage: 3 });
engine.registerVariant('momentum', 'control', { threshold: 0.03, leverage: 5 });

// Variants are logged to futures_strategy_variants table
// Query results:
const results = await db.getVariantPerformance('momentum');
// { aggressive: { trades: 45, pnl: 1250 }, conservative: { trades: 23, pnl: 890 }, ... }
```

#### Comprehensive API Methods

**Binance Futures (55+ methods):**
- Market data: `getKlines`, `getOrderBook`, `getTrades`, `getTicker24h`, `getMarkPrice`, `getFundingRate`
- Trading: `placeOrder`, `cancelOrder`, `cancelAllOrders`, `placeBatchOrders`, `modifyOrder`
- Account: `getAccountInfo`, `getPositions`, `getBalance`, `getIncomeHistory`, `getTradeHistory`
- Risk: `setLeverage`, `setMarginType`, `modifyIsolatedMargin`, `getLeverageBrackets`
- Advanced: `getPositionRisk`, `getCommissionRate`, `getMultiAssetMode`, `setMultiAssetMode`
- Analytics: `getLongShortRatio`, `getOpenInterest`, `getTakerBuySellVolume`, `getTopTraderPositions`
- Staking: `getStakingProducts`, `stake`, `unstake`, `getStakingHistory`
- Convert: `getConvertPairs`, `sendQuote`, `acceptQuote`, `getConvertHistory`
- Portfolio Margin: `getPortfolioMarginAccount`, `getPortfolioMarginBankruptcyLoan`

**Bybit (50+ methods):**
- Market data: `getKline`, `getOrderbook`, `getTickers`, `getFundingHistory`, `getOpenInterest`
- Trading: `placeOrder`, `cancelOrder`, `amendOrder`, `placeBatchOrders`, `cancelBatchOrders`
- Account: `getWalletBalance`, `getPositionInfo`, `getExecutionList`, `getClosedPnl`
- Risk: `setLeverage`, `setMarginMode`, `setPositionMode`, `setTpSlMode`
- Copy Trading: `getCopyTradingLeaders`, `followLeader`, `unfollowLeader`, `getCopyPositions`
- Lending: `getLendingProducts`, `deposit`, `redeem`, `getLendingOrders`
- Earn: `getEarnProducts`, `getEarnOrders`

**Hyperliquid (60+ methods):**
- Trading: `placeOrder`, `cancelOrder`, `cancelAllOrders`, `placeTwapOrder`, `modifyOrder`
- Market data: `getMeta`, `getAssetCtxs`, `getAllMids`, `getCandleSnapshot`, `getL2Snapshot`
- Account: `getUserState`, `getUserFills`, `getUserFunding`, `getOpenOrders`, `getOrderStatus`
- Spot: `getSpotMeta`, `getSpotClearinghouseState`, `placeSpotOrder`
- Vaults: `getVaultDetails`, `getUserVaultEquities`, `depositToVault`, `withdrawFromVault`
- Staking: `getValidatorSummaries`, `getUserStakingSummary`, `stakeHype`, `unstakeHype`
- Delegations: `getDelegatorSummary`, `getDelegatorHistory`, `delegate`, `undelegate`
- Referrals: `getReferralState`, `createReferralCode`, `getReferredUsers`
- Analytics: `getUserAnalytics`, `getLeaderboard`, `getSubaccounts`

**MEXC (35+ methods):**
- Market data: `getContractDetail`, `getOrderbook`, `getKlines`, `getFundingRate`, `getOpenInterest`
- Trading: `placeOrder`, `cancelOrder`, `cancelAllOrders`, `placeBatchOrders`, `placeTriggerOrder`
- Account: `getAccountInfo`, `getPositions`, `getOpenOrders`, `getOrderHistory`, `getTradeHistory`
- Risk: `setLeverage`, `changeMarginMode`, `changePositionMode`, `autoAddMargin`

#### Basic Usage

```typescript
import { BinanceFuturesClient, BybitFuturesClient, HyperliquidClient, MexcFuturesClient } from './trading/futures';

// Initialize clients
const binance = new BinanceFuturesClient({
  apiKey: process.env.BINANCE_API_KEY!,
  apiSecret: process.env.BINANCE_API_SECRET!,
});

const bybit = new BybitFuturesClient({
  apiKey: process.env.BYBIT_API_KEY!,
  apiSecret: process.env.BYBIT_API_SECRET!,
});

const hyperliquid = new HyperliquidClient({
  privateKey: process.env.HYPERLIQUID_PRIVATE_KEY!,
  walletAddress: process.env.HYPERLIQUID_WALLET_ADDRESS!,
});

const mexc = new MexcFuturesClient({
  apiKey: process.env.MEXC_API_KEY!,
  apiSecret: process.env.MEXC_API_SECRET!,
});

// Check balances
const balance = await binance.getBalance();
console.log(`Available: $${balance.availableBalance}`);

// Open a long position
const order = await binance.placeOrder({
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: 0.01,
});

// Set leverage
await binance.setLeverage('BTCUSDT', 10);

// View positions
const positions = await binance.getPositions();
for (const pos of positions) {
  console.log(`${pos.symbol}: ${pos.positionAmt} @ ${pos.entryPrice}`);
  console.log(`  P&L: $${pos.unrealizedProfit}`);
}

// Close position
await binance.placeOrder({
  symbol: 'BTCUSDT',
  side: 'SELL',
  type: 'MARKET',
  quantity: 0.01,
  reduceOnly: true,
});
```

**Chat Commands:**

```
/futures balance binance           # Check margin balance
/futures positions                 # View all open positions
/futures long BTCUSDT 0.1 10x      # Open 0.1 BTC long at 10x leverage
/futures short ETHUSDT 1 20x       # Open 1 ETH short at 20x leverage
/futures tp BTCUSDT 105000         # Set take-profit for BTC
/futures sl BTCUSDT 95000          # Set stop-loss for BTC
/futures close BTCUSDT             # Close BTC position
/futures close-all                 # Close all positions
/futures markets binance           # List available markets
/futures funding BTCUSDT           # Check funding rate
/futures stats                     # View trade statistics from database
```

**Configuration:**

```json
{
  "futures": {
    "exchanges": {
      "binance": {
        "enabled": true,
        "testnet": false,
        "maxLeverage": 20,
        "defaultMarginType": "ISOLATED"
      },
      "bybit": {
        "enabled": true
      },
      "hyperliquid": {
        "enabled": true
      },
      "mexc": {
        "enabled": true,
        "maxLeverage": 50
      }
    },
    "database": {
      "enabled": true,
      "url": "postgres://user:pass@localhost:5432/clodds"
    },
    "riskManagement": {
      "maxPositionSize": 10000,
      "maxTotalExposure": 50000,
      "liquidationAlertThreshold": 5
    }
  }
}
```

## Hyperliquid DEX

Full integration with Hyperliquid, the dominant perpetual futures DEX (69% market share). Trade 130+ perp markets, spot trading, HLP vault, and TWAP orders.

### Quick Start

```bash
# Set credentials
export HYPERLIQUID_WALLET="0x..."
export HYPERLIQUID_PRIVATE_KEY="0x..."

# Check balance
/hl balance

# Open a position
/hl long BTC 0.1
/hl short ETH 1 3000

# Close position
/hl close BTC
```

### Commands

**Trading:**
| Command | Description |
|---------|-------------|
| `/hl long <coin> <size> [price]` | Open long position |
| `/hl short <coin> <size> [price]` | Open short position |
| `/hl close <coin>` | Close position at market |
| `/hl closeall` | Close all positions |
| `/hl leverage <coin> <1-50>` | Set leverage |
| `/hl margin <coin> <amount>` | Add/remove isolated margin |

**Account:**
| Command | Description |
|---------|-------------|
| `/hl balance` | Positions, balances, margin |
| `/hl portfolio` | PnL breakdown (day/week/month/all) |
| `/hl orders` | List open orders |
| `/hl orders cancel <coin> [orderId]` | Cancel orders |
| `/hl orders cancelall` | Cancel all orders |
| `/hl fills [coin]` | Recent trade fills |
| `/hl history` | Order history |

**Market Data:**
| Command | Description |
|---------|-------------|
| `/hl stats` | HLP TVL, APR, top funding rates |
| `/hl markets [query]` | List perp/spot markets |
| `/hl price <coin>` | Get current price |
| `/hl book <coin>` | Show orderbook depth |
| `/hl candles <coin> [1m\|5m\|15m\|1h\|4h\|1d]` | OHLCV candle data |
| `/hl funding [coin]` | Funding rates (current + predicted) |

**TWAP Orders:**
| Command | Description |
|---------|-------------|
| `/hl twap buy <coin> <size> <minutes>` | Start TWAP buy |
| `/hl twap sell <coin> <size> <minutes>` | Start TWAP sell |
| `/hl twap cancel <coin> <twapId>` | Cancel TWAP |
| `/hl twap status` | Show active TWAP fills |

**Spot Trading:**
| Command | Description |
|---------|-------------|
| `/hl spot markets` | List spot markets |
| `/hl spot book <coin>` | Spot orderbook |
| `/hl spot buy <coin> <amount> [price]` | Buy spot |
| `/hl spot sell <coin> <amount> [price]` | Sell spot |

**HLP Vault:**
| Command | Description |
|---------|-------------|
| `/hl hlp` | Show vault stats (TVL, APR) |
| `/hl hlp deposit <amount>` | Deposit USDC to vault |
| `/hl hlp withdraw <amount>` | Withdraw from vault |
| `/hl vaults` | Your vault positions |

**Transfers:**
| Command | Description |
|---------|-------------|
| `/hl transfer spot2perp <amount>` | Move USDC to perps |
| `/hl transfer perp2spot <amount>` | Move USDC to spot |
| `/hl transfer send <address> <amount>` | Send USDC on Hyperliquid |
| `/hl transfer withdraw <address> <amount>` | Withdraw to L1 (Arbitrum) |

**Account Info:**
| Command | Description |
|---------|-------------|
| `/hl fees` | Your fee tier & rate limits |
| `/hl points` | Points balance |
| `/hl referral` | Referral info & rewards |
| `/hl claim` | Claim referral rewards |
| `/hl leaderboard [day\|week\|month\|allTime]` | Top traders |
| `/hl sub` | List subaccounts |
| `/hl sub create <name>` | Create subaccount |
| `/hl lend` | Borrow/lend rates |

### Shortcuts

| Full | Short |
|------|-------|
| `/hl balance` | `/hl b` |
| `/hl markets` | `/hl m` |
| `/hl price` | `/hl p` |
| `/hl book` | `/hl ob` |
| `/hl candles` | `/hl c` |
| `/hl funding` | `/hl f` |
| `/hl orders` | `/hl o` |
| `/hl history` | `/hl h` |
| `/hl long` | `/hl l` |
| `/hl short` | `/hl s` |
| `/hl leverage` | `/hl lev` |
| `/hl portfolio` | `/hl pf` |
| `/hl leaderboard` | `/hl lb` |
| `/hl referral` | `/hl ref` |

### Configuration

```bash
# Required for trading
export HYPERLIQUID_WALLET="0x..."
export HYPERLIQUID_PRIVATE_KEY="0x..."

# Optional: dry run mode (no real trades)
export DRY_RUN=true
```

### Database Tracking

All trades are automatically logged to SQLite for performance tracking.

| Command | Description |
|---------|-------------|
| `/hl trades [coin] [limit]` | Trade history from database |
| `/hl dbstats [coin] [period]` | Win rate, PnL, profit factor |
| `/hl dbfunding [coin]` | Funding payments history |
| `/hl dbpositions [all]` | Position history (open/closed) |

**Stats periods:** `day`, `week`, `month`

**Database Tables:**
- `hyperliquid_trades` - All executed trades with PnL
- `hyperliquid_positions` - Position history with entry/exit
- `hyperliquid_funding` - Funding payment records

### All Futures Exchanges Database

Database tracking is available for all 4 futures exchanges:

| Exchange | Trades Table | Positions Table | Funding Table |
|----------|-------------|-----------------|---------------|
| Hyperliquid | `hyperliquid_trades` | `hyperliquid_positions` | `hyperliquid_funding` |
| Binance | `binance_futures_trades` | `binance_futures_positions` | `binance_futures_funding` |
| Bybit | `bybit_futures_trades` | `bybit_futures_positions` | `bybit_futures_funding` |
| MEXC | `mexc_futures_trades` | `mexc_futures_positions` | `mexc_futures_funding` |

**Programmatic Usage:**

```typescript
import { initDatabase } from 'clodds/db';

const db = await initDatabase();

// Log a Binance trade
db.logBinanceFuturesTrade({
  userId: 'user123',
  symbol: 'BTCUSDT',
  side: 'BUY',
  size: 0.01,
  price: 95000,
  realizedPnl: 50.25,
  leverage: 10,
  timestamp: new Date(),
});

// Get Bybit stats
const stats = db.getBybitFuturesStats('user123', { symbol: 'ETHUSDT' });
console.log(`Win rate: ${stats.winRate}%, PnL: $${stats.totalPnl}`);

// Get MEXC positions
const positions = db.getMexcFuturesPositions('user123', { openOnly: true });

// Get all funding payments
const binanceFunding = db.getBinanceFuturesFundingTotal('user123');
const bybitFunding = db.getBybitFuturesFundingTotal('user123');
```

**Available Methods (per exchange):**

| Method | Description |
|--------|-------------|
| `log{Exchange}FuturesTrade()` | Log a trade |
| `get{Exchange}FuturesTrades()` | Query trade history |
| `get{Exchange}FuturesStats()` | Win rate, PnL, profit factor |
| `upsert{Exchange}FuturesPosition()` | Track position |
| `get{Exchange}FuturesPositions()` | Query positions |
| `close{Exchange}FuturesPosition()` | Mark position closed |
| `log{Exchange}FuturesFunding()` | Log funding payment |
| `get{Exchange}FuturesFunding()` | Query funding history |
| `get{Exchange}FuturesFundingTotal()` | Sum of funding payments |

### Features

- **130+ Perp Markets** with up to 50x leverage
- **Spot Trading** with native HYPE token
- **HLP Vault** - Earn yield providing liquidity
- **TWAP Orders** - Execute large orders over time
- **Points System** - Earn rewards for activity
- **Subaccounts** - Manage multiple strategies
- **Real-time WebSocket** - Live orderbook and fills
- **Full Trade Logging** - SQLite database tracking

---

## Jupiter Aggregator (Solana)

Jupiter is Solana's leading DEX aggregator, finding the best swap routes across all DEXes.

### CLI Commands

```
/jup swap <amount> <from> to <to>    Execute swap via Jupiter
/jup quote <amount> <from> to <to>   Get quote without executing
/jup route <from> <to> [amount]      Show detailed route info
```

### Examples

```
/jup swap 1 SOL to USDC
/jup quote 100 USDC to JUP
/jup route SOL BONK 1000000000
```

### Configuration

```bash
export SOLANA_PRIVATE_KEY="your-private-key"
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"  # Optional
```

### API Usage

```typescript
import { executeJupiterSwap } from 'clodds/solana/jupiter';

const result = await executeJupiterSwap(connection, keypair, {
  inputMint: 'So11111111111111111111111111111111111111112',  // SOL
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount: '1000000000',  // 1 SOL in lamports
  slippageBps: 50,       // 0.5% slippage
});

console.log(`TX: ${result.signature}`);
```

---

## Raydium DEX (Solana)

Raydium is a high-volume AMM on Solana with concentrated liquidity pools.

### CLI Commands

```
/ray swap <amount> <from> to <to>    Execute swap on Raydium
/ray quote <amount> <from> to <to>   Get quote
/ray pools <token>                   List pools for token
```

### Examples

```
/ray swap 1 SOL to USDC
/ray quote 100 USDC to RAY
/ray pools SOL
```

### API Usage

```typescript
import { executeRaydiumSwap, listRaydiumPools } from 'clodds/solana/raydium';

// Swap
const result = await executeRaydiumSwap(connection, keypair, {
  inputMint: 'SOL',
  outputMint: 'USDC',
  amount: '1000000000',
  slippageBps: 50,
});

// List pools
const pools = await listRaydiumPools({ tokenMints: [solMint], limit: 10 });
```

---

## Orca Whirlpools (Solana)

Orca provides concentrated liquidity pools (Whirlpools) on Solana.

### CLI Commands

```
/orca swap <amount> <from> to <to>   Execute swap
/orca quote <amount> <from> to <to>  Get quote
/orca pools <token>                  List Whirlpools
```

### Examples

```
/orca swap 1 SOL to USDC
/orca pools ORCA
```

### API Usage

```typescript
import { executeOrcaWhirlpoolSwap, listOrcaWhirlpoolPools } from 'clodds/solana/orca';

// Find pool and swap
const pools = await listOrcaWhirlpoolPools({ tokenMints: [solMint, usdcMint] });
const result = await executeOrcaWhirlpoolSwap(connection, keypair, {
  poolAddress: pools[0].address,
  inputMint: solMint,
  amount: '1000000000',
  slippageBps: 50,
});
```

---

## Meteora DLMM (Solana)

Meteora uses Dynamic Liquidity Market Maker (DLMM) pools with bin-based pricing.

### CLI Commands

```
/met swap <amount> <from> to <to>    Execute swap
/met quote <amount> <from> to <to>   Get quote
/met pools <token>                   List DLMM pools
```

### Examples

```
/met swap 1 SOL to USDC
/met pools SOL
```

### API Usage

```typescript
import { executeMeteoraDlmmSwap, listMeteoraDlmmPools } from 'clodds/solana/meteora';

// Find pool
const pools = await listMeteoraDlmmPools(connection, { tokenMints: [solMint] });

// Swap
const result = await executeMeteoraDlmmSwap(connection, keypair, {
  poolAddress: pools[0].address,
  inputMint: solMint,
  outputMint: usdcMint,
  inAmount: '1000000000',
  slippageBps: 50,
});
```

---

## Kamino Finance (Solana)

Kamino Finance is Solana's largest lending protocol and liquidity vault provider. It offers lending/borrowing with health monitoring and automated liquidity vaults.

### CLI Commands (15 total)

**Lending:**
```
/kamino deposit <amount> <token>          Deposit collateral
/kamino withdraw <amount|all> <token>     Withdraw collateral
/kamino borrow <amount> <token>           Borrow assets
/kamino repay <amount|all> <token>        Repay borrowed assets
/kamino obligation                        View your positions
/kamino health                            Check health factor & liquidation risk
/kamino reserves                          List available reserves with rates
/kamino rates                             View supply/borrow APYs
```

**Liquidity Vaults:**
```
/kamino strategies                        List all vault strategies
/kamino strategy <address>                Get strategy details
/kamino vault-deposit <strat> <amtA> [amtB]  Deposit to vault
/kamino vault-withdraw <strat> [shares|all]  Withdraw from vault
/kamino shares                            View your vault shares
/kamino share-price <strategy>            Get strategy share price
```

**Info:**
```
/kamino markets                           List lending markets
```

### Examples

```
/kamino deposit 100 USDC           Deposit 100 USDC as collateral
/kamino borrow 50 SOL              Borrow 50 SOL against collateral
/kamino health                     Check liquidation risk
/kamino repay all SOL              Repay all borrowed SOL
/kamino rates                      View current APYs
```

### SDK Usage

```typescript
import {
  depositToKamino,
  borrowFromKamino,
  getKaminoObligation,
  getKaminoReserves,
} from 'clodds/solana/kamino';

// Deposit collateral
const deposit = await depositToKamino(connection, keypair, {
  reserveMint: usdcMint,
  amount: '100000000', // 100 USDC (6 decimals)
});

// Borrow against collateral
const borrow = await borrowFromKamino(connection, keypair, {
  reserveMint: solMint,
  amount: '1000000000', // 1 SOL (9 decimals)
});

// Check health factor
const obligation = await getKaminoObligation(connection, keypair);
console.log(`Health: ${obligation.healthFactor}`);
console.log(`LTV: ${obligation.ltv}%`);

// Get reserve rates
const reserves = await getKaminoReserves(connection);
for (const r of reserves) {
  console.log(`${r.symbol}: Supply ${r.depositRate}% / Borrow ${r.borrowRate}%`);
}
```

### Liquidity Vaults SDK

```typescript
import {
  getKaminoStrategies,
  depositToKaminoVault,
  withdrawFromKaminoVault,
  getKaminoUserShares,
} from 'clodds/solana/kamino';

// List strategies
const strategies = await getKaminoStrategies(connection);

// Deposit to vault
const result = await depositToKaminoVault(connection, keypair, {
  strategyAddress: 'ABC123...',
  tokenAAmount: '1000000',
  tokenBAmount: '1000000',
});

// Withdraw all shares
const withdraw = await withdrawFromKaminoVault(connection, keypair, {
  strategyAddress: 'ABC123...',
  withdrawAll: true,
});

// Check your shares
const shares = await getKaminoUserShares(connection, keypair);
```

---

## Pump.fun (Solana)

Pump.fun is a token launchpad on Solana for trading new memecoins.

### CLI Commands

```
/pump buy <mint> <amount>           Buy tokens (amount in SOL)
/pump sell <mint> <amount>          Sell tokens
```

### Examples

```
/pump buy ABC123mintaddress... 0.1    Buy with 0.1 SOL
/pump sell ABC123mintaddress... 1000  Sell 1000 tokens
```

### Notes

- Use full mint address (not symbol)
- High slippage (5-10%) recommended for volatile tokens
- Amount for buy is in SOL
- Amount for sell is in tokens

### API Usage

```typescript
import { executePumpFunTrade } from 'clodds/solana/pumpapi';

// Buy token
const result = await executePumpFunTrade(connection, keypair, {
  action: 'buy',
  mint: 'token_mint_address',
  amount: '0.1',
  denominatedInSol: true,
  slippageBps: 500,  // 5% for volatile tokens
});
```

---

## Bags.fm (Solana) - Complete Integration

Bags.fm is a Solana token launchpad and trading platform with creator monetization. Creators earn 1% royalties on all trades of their tokens.

### Quick Start

```bash
# Set credentials
export BAGS_API_KEY="your-api-key"           # From dev.bags.fm
export SOLANA_PRIVATE_KEY="your-private-key" # For signing transactions
```

### CLI Commands

**Trading:**
```
/bags quote <amount> <from> to <to>      Get swap quote
/bags swap <amount> <from> to <to>       Execute swap
```

**Discovery:**
```
/bags pools                              List all pools
/bags trending                           Show trending by volume
/bags token <mint>                       Full token info
/bags creators <mint>                    Get token creators
/bags lifetime-fees <mint>               Total fees collected
```

**Fee Claiming:**
```
/bags fees [wallet]                      Check claimable fees
/bags claim [wallet]                     Claim all fees
/bags claim-events <mint> [--from/--to]  Claim history
/bags stats <mint>                       Per-claimer statistics
```

**Token Launch:**
```
/bags launch <name> <symbol> <desc> [options]  Launch new token
/bags launch-info                              Launch requirements
```

**Fee Share Config:**
```
/bags fee-config <mint> <wallet:bps>...  Create fee distribution (bps sum to 10000)
```

**Wallet Lookup:**
```
/bags wallet <provider> <username>       Lookup by social
/bags wallets <provider> <user1,user2>   Bulk lookup
```

**Providers:** twitter, github, kick, tiktok, instagram, onlyfans, solana, apple, google, email, moltbook

**Partner System:**
```
/bags partner-config <mint>              Create partner key
/bags partner-claim [wallet]             Claim partner fees
/bags partner-stats <key>                View partner stats
```

### Agent Tools

| Tool | Description |
|------|-------------|
| `bags_quote` | Get swap quote for token pair |
| `bags_swap` | Execute token swap |
| `bags_pools` | List all Bags pools |
| `bags_trending` | Get trending tokens by volume |
| `bags_token` | Get full token info (metadata, creators, fees, market) |
| `bags_creators` | Get token creators and fee shares |
| `bags_lifetime_fees` | Get total fees collected for token |
| `bags_fees` | Check claimable fees (all positions) |
| `bags_claim` | Claim accumulated fees |
| `bags_claim_events` | Get claim history with time filters |
| `bags_claim_stats` | Get per-claimer statistics |
| `bags_launch` | Launch new token with metadata |
| `bags_fee_config` | Create fee share configuration |
| `bags_wallet_lookup` | Lookup wallet by social handle |
| `bags_bulk_wallet_lookup` | Bulk wallet lookup |
| `bags_partner_config` | Create partner referral key |
| `bags_partner_claim` | Claim partner fees |
| `bags_partner_stats` | Get partner statistics |

### Programmatic Usage

Use via the agent handlers or swarm builders:

```typescript
// Via agent handlers (src/agents/handlers/solana.ts)
import { solanaHandlers } from './agents/handlers/solana';

const quote = await solanaHandlers.bags_quote({
  input_mint: 'So11111111111111111111111111111111111111112',
  output_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount: '1000000000', // 1 SOL in lamports
});

// Via swarm builder for multi-wallet trading (src/solana/swarm-builders.ts)
import { BagsBuilder } from './solana/swarm-builders';

const builder = new BagsBuilder();
const tx = await builder.buildBuyTransaction(connection, wallet, mint, 0.1, { slippageBps: 100 });
```

### Features

- Token launching with 1% creator fees
- Up to 100 fee claimers per token
- Meteora DAMM v2 pool integration
- Virtual pool and custom vault fee claiming
- Partner referral system
- Social wallet lookup (11 providers: Twitter, GitHub, Kick, TikTok, Instagram, OnlyFans, Solana, Apple, Google, Email, Moltbook)
- Jito bundle support for launches

### API Details

- Base URL: `https://public-api-v2.bags.fm/api/v1/`
- Auth: `x-api-key` header
- Rate limit: 1000 requests/hour
- Get your API key at [dev.bags.fm](https://dev.bags.fm)

---

## Unified Solana Trading

The `/sol` command provides a unified interface to all Solana DEXes.

### CLI Commands

```
/sol swap <amount> <from> to <to>   Execute swap (uses Jupiter)
/sol quote <amount> <from> to <to>  Get quotes from all DEXes
/sol pools <token>                  List all pools
/sol route <from> <to>              Find best route
/sol balance                        Check SOL balance
/sol address                        Show wallet address
```

### Examples

```
/sol swap 1 SOL to USDC
/sol quote 100 USDC to JUP
/sol pools BONK
/sol route SOL USDC
```

---

## Drift Protocol (Solana)

Direct SDK-based trading on Drift Protocol, Solana's leading perpetual futures DEX. Bypass the gateway requirement with native SDK integration.

### Quick Start

```bash
# Set credentials
export DRIFT_PRIVATE_KEY="your-solana-private-key"
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
```

### Agent Tools

| Tool | Description |
|------|-------------|
| `drift_direct_order` | Place perp/spot orders via SDK |
| `drift_direct_cancel_order` | Cancel orders by ID, market, or all |
| `drift_direct_orders` | Get open orders |
| `drift_direct_positions` | Get positions with PnL |
| `drift_direct_balance` | Get collateral, margin, health factor |
| `drift_direct_modify_order` | Modify existing orders |
| `drift_direct_set_leverage` | Set leverage per market |

### Place Orders

```typescript
import { executeDriftDirectOrder } from './solana/drift';

// Market buy
const result = await executeDriftDirectOrder(connection, keypair, {
  marketIndex: 0,       // BTC-PERP
  marketType: 'perp',
  direction: 'long',
  baseAmount: 0.1,      // 0.1 BTC
  orderType: 'market',
});

// Limit sell
const result = await executeDriftDirectOrder(connection, keypair, {
  marketIndex: 0,
  marketType: 'perp',
  direction: 'short',
  baseAmount: 0.1,
  price: 100000,        // Limit price
  orderType: 'limit',
});
```

### Manage Orders

```typescript
import { cancelDriftOrder, getDriftOrders, modifyDriftOrder } from './solana/drift';

// Get open orders
const orders = await getDriftOrders(connection, keypair);
const perpOrders = await getDriftOrders(connection, keypair, 0, 'perp');

// Cancel by ID
await cancelDriftOrder(connection, keypair, { orderId: 12345 });

// Cancel all for a market
await cancelDriftOrder(connection, keypair, { marketIndex: 0, marketType: 'perp' });

// Cancel all orders
await cancelDriftOrder(connection, keypair, { all: true });

// Modify an order
await modifyDriftOrder(connection, keypair, {
  orderId: 12345,
  newPrice: 99000,
  newBaseAmount: 0.2,
});
```

### Positions & Balance

```typescript
import { getDriftPositions, getDriftBalance, setDriftLeverage } from './solana/drift';

// Get all positions
const positions = await getDriftPositions(connection, keypair);
for (const pos of positions) {
  console.log(`${pos.marketSymbol}: ${pos.baseAssetAmount} @ ${pos.entryPrice}`);
  console.log(`  Unrealized PnL: $${pos.unrealizedPnl}`);
}

// Get account balance
const balance = await getDriftBalance(connection, keypair);
console.log(`Collateral: $${balance.totalCollateral}`);
console.log(`Margin Used: $${balance.marginUsed}`);
console.log(`Health: ${balance.healthFactor}%`);

// Set leverage
await setDriftLeverage(connection, keypair, {
  marketIndex: 0,
  leverage: 5,
});
```

### Features

- **Direct SDK** - No gateway server required
- **Perp & Spot** - Trade both market types
- **Order Types** - Market, limit, post-only, IOC, FOK
- **Position Management** - Track unrealized PnL, entry prices
- **Risk Metrics** - Health factor, margin usage, liquidation prices
- **Leverage Control** - Set per-market leverage

---

## Predict.fun (BNB Chain)

Full integration with Predict.fun, a BNB Chain prediction market with binary and categorical outcomes.

### Quick Start

```bash
# Set credentials
export PREDICTFUN_API_KEY="your-api-key"
export PREDICTFUN_PRIVATE_KEY="0x..."
```

Or in `~/.clodds/clodds.json`:

```json
{
  "trading": {
    "predictfun": {
      "apiKey": "${PREDICTFUN_API_KEY}",
      "privateKey": "${PREDICTFUN_PRIVATE_KEY}"
    }
  }
}
```

### Agent Tools

| Tool | Description |
|------|-------------|
| `predictfun_markets` | List available markets |
| `predictfun_market` | Get market details |
| `predictfun_orderbook` | Get orderbook |
| `predictfun_create_order` | Place an order |
| `predictfun_cancel_order` | Cancel an order |
| `predictfun_cancel_all_orders` | Cancel all orders |
| `predictfun_orders` | Get open orders |
| `predictfun_positions` | Get positions |
| `predictfun_balance` | Get account balance |
| `predictfun_merge_positions` | Merge outcome tokens |
| `predictfun_redeem` | Redeem settled positions |

### Programmatic Usage

```typescript
import * as predictfun from './exchanges/predictfun';

const config = {
  apiKey: process.env.PREDICTFUN_API_KEY!,
  privateKey: process.env.PREDICTFUN_PRIVATE_KEY!,
};

// Search markets
const markets = await predictfun.getMarkets();

// Place order
const order = await predictfun.createOrder(config, {
  marketId: 'market-123',
  outcomeIndex: 0,     // YES = 0, NO = 1
  side: 'BUY',
  price: 0.55,
  size: 100,
});

// Get positions
const positions = await predictfun.getPositions(config);

// Merge positions (convert YES + NO back to collateral)
await predictfun.mergePositions(config, {
  conditionId: '0x...',
  amount: 100,
});

// Redeem after settlement
await predictfun.redeemPositions(config, {
  conditionId: '0x...',
  indexSets: [1, 2],  // Which outcomes to redeem
});
```

### Trading Notes

1. **Chain**: BNB Chain (chainId 56)
2. **Order Signing**: Uses wallet signatures via `@predictdotfun/sdk`
3. **Index Sets**: Binary markets use `indexSet = 1` for YES, `indexSet = 2` for NO
4. **Merging**: Requires equal amounts of all outcome tokens
5. **Fees**: Check platform for current fee structure

---

## Betfair Exchange

Sports betting exchange with back/lay trading.

### Configuration

```bash
export BETFAIR_APP_KEY="your-app-key"
export BETFAIR_SESSION_TOKEN="your-session-token"
# Or use username/password
export BETFAIR_USERNAME="your-username"
export BETFAIR_PASSWORD="your-password"
```

### CLI Commands (`/bf`)

| Command | Description |
|---------|-------------|
| `/bf markets [query]` | Search markets |
| `/bf market <id>` | Get market details |
| `/bf prices <id>` | Current prices |
| `/bf book <id> <sel>` | Show orderbook |
| `/bf back <id> <sel> <odds> <stake>` | Place back order |
| `/bf lay <id> <sel> <odds> <stake>` | Place lay order |
| `/bf orders [id]` | List open orders |
| `/bf cancel <id> <betId>` | Cancel order |
| `/bf balance` | Account balance |
| `/bf positions` | Open positions |

### API Usage

```typescript
import { createBetfairFeed } from './feeds/betfair';

const feed = await createBetfairFeed({
  appKey: process.env.BETFAIR_APP_KEY!,
  sessionToken: process.env.BETFAIR_SESSION_TOKEN,
});
await feed.start();

// Search markets
const markets = await feed.searchMarkets('premier league');

// Place back order (bet FOR outcome)
const order = await feed.placeBackOrder(
  marketId,      // '1.234567890'
  selectionId,   // 12345678
  2.5,           // Odds (decimal)
  10             // Stake (GBP)
);

// Place lay order (bet AGAINST outcome)
const layOrder = await feed.placeLayOrder(marketId, selectionId, 2.6, 10);

// Get account funds
const funds = await feed.getAccountFunds();
```

### Trading Notes

1. **Odds Format**: Decimal odds (2.0 = evens, 3.0 = 2/1)
2. **Back vs Lay**: Back = betting FOR, Lay = betting AGAINST
3. **Liability**: Lay stake = liability / (odds - 1)
4. **Commission**: 2-5% on net winnings

---

## Smarkets Exchange

Betting exchange with lower fees (2% vs Betfair's 5%).

### Configuration

```bash
export SMARKETS_SESSION_TOKEN="your-session-token"
# Or API token for read-only access
export SMARKETS_API_TOKEN="your-api-token"
```

### CLI Commands (`/sm`)

| Command | Description |
|---------|-------------|
| `/sm markets [query]` | Search markets |
| `/sm market <id>` | Get market details |
| `/sm prices <id>` | Current prices |
| `/sm book <id> <contract>` | Show orderbook |
| `/sm buy <id> <cont> <price> <qty>` | Place buy order |
| `/sm sell <id> <cont> <price> <qty>` | Place sell order |
| `/sm orders [id]` | List open orders |
| `/sm cancel <orderId>` | Cancel order |
| `/sm balance` | Account balance |

### API Usage

```typescript
import { createSmarketsFeed } from './feeds/smarkets';

const feed = await createSmarketsFeed({
  sessionToken: process.env.SMARKETS_SESSION_TOKEN,
});
await feed.start();

// Search markets
const markets = await feed.searchMarkets('election');

// Place buy order
const order = await feed.placeBuyOrder(
  marketId,      // '12345'
  contractId,    // '67890'
  0.55,          // Price (0-1 probability)
  10             // Quantity (GBP)
);

// Get balance
const balance = await feed.getBalance();
```

### Trading Notes

1. **Prices**: Expressed as probabilities (0.55 = 55%)
2. **Low Fees**: 2% commission vs Betfair's 5%
3. **Markets**: Politics, sports, entertainment

---

## Metaculus (Read-Only)

Forecasting platform integration.

### CLI Commands (`/mc`)

| Command | Description |
|---------|-------------|
| `/mc search [query]` | Search questions |
| `/mc question <id>` | Get question details |
| `/mc tournaments` | List tournaments |
| `/mc tournament <id>` | Tournament questions |

### API Usage

```typescript
import { createMetaculusFeed } from './feeds/metaculus';

const feed = await createMetaculusFeed();
await feed.connect();

// Search questions
const markets = await feed.searchMarkets('AI safety');

// Get question
const question = await feed.getMarket('12345');
console.log(`Probability: ${question.outcomes[0].price * 100}%`);

// Get tournaments
const tournaments = await feed.getTournaments();
```

### Notes

- Read-only platform (no trading)
- Shows community prediction probabilities
- Volume = number of predictions

---

## PredictIt (Read-Only)

US political prediction market.

### CLI Commands (`/pi`)

| Command | Description |
|---------|-------------|
| `/pi search [query]` | Search markets |
| `/pi market <id>` | Get market details |
| `/pi all` | List all markets |

### API Usage

```typescript
import { createPredictItFeed } from './feeds/predictit';

const feed = await createPredictItFeed();
await feed.connect();

// Search markets
const markets = await feed.searchMarkets('president');

// Get all markets
const allMarkets = await feed.getAllMarkets();
```

### Notes

- Read-only (no public trading API)
- Prices shown in cents (55¢ = 55% probability)
- US politics focused

---

## Virtuals Protocol

AI Agent marketplace on Base chain.

### Configuration

```bash
# Optional - custom RPC
export BASE_RPC_URL="https://mainnet.base.org"
```

### CLI Commands (`/virt`)

| Command | Description |
|---------|-------------|
| `/virt search [query]` | Search agents |
| `/virt agent <id>` | Get agent details |
| `/virt agents` | List all agents |
| `/virt trending` | Trending by volume |
| `/virt new` | Recently launched |
| `/virt price <addr>` | Bonding curve price |
| `/virt graduation <addr>` | Graduation progress |

### API Usage

```typescript
import { createVirtualsFeed } from './feeds/virtuals';

const feed = await createVirtualsFeed({
  rpcUrl: process.env.BASE_RPC_URL,
});
await feed.connect();

// Search agents
const markets = await feed.searchMarkets('gaming');

// Get trending agents
const trending = await feed.getTrendingAgents(10);

// Check graduation status
const isGraduated = await feed.isAgentGraduated('0x...');
const progress = await feed.getGraduationProgress('0x...');

// Get bonding curve price
const price = await feed.getBondingCurvePrice('0x...');
```

### Agent Lifecycle

| Status | Description |
|--------|-------------|
| prototype | New, on bonding curve |
| sentient | Active, growing |
| graduated | Migrated to Uniswap |

### Notes

1. **Bonding Curves**: Price increases with demand
2. **Graduation**: ~42K VIRTUAL triggers migration to Uniswap
3. **Chain**: Base (chainId 8453)

---

## API Reference

See individual module docs:
- [Opportunity Finder](./OPPORTUNITY_FINDER.md)
- [Bot Manager](./BOTS.md)
- [Safety Controls](./SAFETY.md)
- [Execution Service](./EXECUTION.md)
