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
  // ERC-8004 Identity Verification (recommended)
  requireVerifiedIdentity: true,  // Only copy verified traders
  minReputationScore: 50,         // Minimum reputation (0-100)
  identityNetwork: 'base-sepolia',
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
// HYPERLIQUID_PRIVATE_KEY, HYPERLIQUID_WALLET_ADDRESS
// MEXC_API_KEY, MEXC_API_SECRET
// DATABASE_URL (PostgreSQL for trade tracking)
```

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

## API Reference

See individual module docs:
- [Opportunity Finder](./OPPORTUNITY_FINDER.md)
- [Bot Manager](./BOTS.md)
- [Safety Controls](./SAFETY.md)
- [Execution Service](./EXECUTION.md)
