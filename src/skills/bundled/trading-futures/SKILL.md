---
name: trading-futures
description: "Trade perpetual futures on Binance, Bybit, Hyperliquid, MEXC with up to 200x leverage"
emoji: "📈"
gates:
  envs:
    anyOf:
      - BINANCE_API_KEY
      - BYBIT_API_KEY
      - HYPERLIQUID_PRIVATE_KEY
      - MEXC_API_KEY
---

# Perpetual Futures Trading - Complete API Reference

Trade leveraged perpetual futures across 4 exchanges with database tracking, custom strategies, and A/B testing.

**200+ methods across 4 exchanges. This is the complete reference.**

## Supported Exchanges

| Exchange | Type | Max Leverage | KYC | API Methods |
|----------|------|--------------|-----|-------------|
| Binance Futures | CEX | 125x | Yes | 55+ |
| Bybit | CEX | 100x | Yes | 50+ |
| MEXC | CEX | 200x | No (small) | 35+ |
| Hyperliquid | DEX | 50x | No | 60+ |

## Required Environment Variables

```bash
# Binance Futures
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret

# Bybit
BYBIT_API_KEY=your_api_key
BYBIT_API_SECRET=your_api_secret

# MEXC (No KYC for small amounts)
MEXC_API_KEY=your_api_key
MEXC_API_SECRET=your_api_secret

# Hyperliquid (Fully decentralized, No KYC)
HYPERLIQUID_PRIVATE_KEY=your_private_key
HYPERLIQUID_WALLET_ADDRESS=0x...

# Optional: Database for trade tracking
DATABASE_URL=postgres://user:pass@localhost:5432/clodds
```

---

## Chat Commands

### Account & Balance

```
/futures balance [exchange]        # Check margin balance (all or specific)
/futures positions                 # View all open positions
/futures positions <exchange>      # View positions on specific exchange
```

### Opening Positions

```
/futures long <symbol> <size> [leverage]x    # Open long position
/futures short <symbol> <size> [leverage]x   # Open short position

# Examples:
/futures long BTCUSDT 0.1 10x      # Open 0.1 BTC long at 10x
/futures short ETHUSDT 1 20x       # Open 1 ETH short at 20x
/futures long BTCUSDT 0.01         # Use default leverage
```

### Take-Profit & Stop-Loss

```
/futures tp <symbol> <price>       # Set take-profit
/futures sl <symbol> <price>       # Set stop-loss
/futures tpsl <symbol> <tp> <sl>   # Set both at once

# Examples:
/futures tp BTCUSDT 105000         # Take profit at $105k
/futures sl BTCUSDT 95000          # Stop loss at $95k
/futures tpsl BTCUSDT 105000 95000 # Both
```

### Closing Positions

```
/futures close <symbol>            # Close specific position
/futures close-all                 # Close ALL positions (all exchanges)
/futures close-all <exchange>      # Close all on specific exchange
```

### Market Data

```
/futures markets [exchange]        # List available markets
/futures price <symbol>            # Get current price
/futures funding <symbol>          # Check funding rate
/futures orderbook <symbol>        # View orderbook depth
```

### Account Info

```
/futures stats                     # Trade statistics from database
/futures history [symbol]          # Trade history
/futures pnl [period]              # P&L summary (day/week/month)
```

### Leverage & Margin

```
/futures leverage <symbol> <value> # Set leverage
/futures margin <symbol> <mode>    # Set margin mode (cross/isolated)
```

---

## TypeScript API Reference

### Quick Setup

```typescript
import { setupFromEnv } from 'clodds/trading/futures';

// Auto-configure from environment variables
const { clients, database, strategyEngine } = await setupFromEnv();

// Access individual clients
const binance = clients.binance;
const bybit = clients.bybit;
const mexc = clients.mexc;
const hyperliquid = clients.hyperliquid;
```

### Manual Client Setup

```typescript
import {
  BinanceFuturesClient,
  BybitFuturesClient,
  MexcFuturesClient,
  HyperliquidClient,
  FuturesDatabase,
  StrategyEngine,
} from 'clodds/trading/futures';

// Binance
const binance = new BinanceFuturesClient({
  apiKey: process.env.BINANCE_API_KEY!,
  apiSecret: process.env.BINANCE_API_SECRET!,
  testnet: false,  // true for testnet
});

// Bybit
const bybit = new BybitFuturesClient({
  apiKey: process.env.BYBIT_API_KEY!,
  apiSecret: process.env.BYBIT_API_SECRET!,
  testnet: false,
});

// MEXC (No KYC)
const mexc = new MexcFuturesClient({
  apiKey: process.env.MEXC_API_KEY!,
  apiSecret: process.env.MEXC_API_SECRET!,
});

// Hyperliquid (Decentralized, No KYC)
const hyperliquid = new HyperliquidClient({
  privateKey: process.env.HYPERLIQUID_PRIVATE_KEY!,
  walletAddress: process.env.HYPERLIQUID_WALLET_ADDRESS!,
  testnet: false,
});
```

---

## Binance Futures API (55+ Methods)

### Market Data

```typescript
// Prices & Tickers
await binance.getMarkPrice('BTCUSDT');
await binance.getTicker24h('BTCUSDT');
await binance.getAllTickers();
await binance.getBookTicker('BTCUSDT');

// Orderbook & Trades
await binance.getOrderBook('BTCUSDT', 100);
await binance.getRecentTrades('BTCUSDT', 500);
await binance.getHistoricalTrades('BTCUSDT', 500);
await binance.getAggTrades('BTCUSDT');

// Klines (Candlesticks)
await binance.getKlines('BTCUSDT', '1h', 100);
await binance.getContinuousKlines('BTCUSDT', '1h', 'PERPETUAL');
await binance.getIndexPriceKlines('BTCUSDT', '1h');
await binance.getMarkPriceKlines('BTCUSDT', '1h');
await binance.getPremiumIndexKlines('BTCUSDT', '1h');

// Funding Rates
await binance.getFundingRate('BTCUSDT');
await binance.getFundingRateHistory('BTCUSDT', 100);

// Market Info
await binance.getExchangeInfo();
await binance.getOpenInterest('BTCUSDT');
await binance.getOpenInterestHistory('BTCUSDT', '1h');
```

### Trading

```typescript
// Place Orders
await binance.placeOrder({
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: 0.01,
});

await binance.placeOrder({
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'LIMIT',
  quantity: 0.01,
  price: 95000,
  timeInForce: 'GTC',
});

// With TP/SL
await binance.placeOrder({
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: 0.01,
  takeProfit: 105000,
  stopLoss: 95000,
});

// Batch Orders
await binance.placeBatchOrders([
  { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 0.01, price: 94000 },
  { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: 0.01, price: 93000 },
]);

// Modify & Cancel
await binance.modifyOrder('BTCUSDT', orderId, { quantity: 0.02 });
await binance.cancelOrder('BTCUSDT', orderId);
await binance.cancelAllOrders('BTCUSDT');
await binance.cancelBatchOrders('BTCUSDT', [orderId1, orderId2]);

// Auto-cancel
await binance.setAutoCancel(60000);  // Cancel all after 60s
await binance.cancelAutoCancel();
```

### Account & Positions

```typescript
// Account Info
await binance.getAccountInfo();
await binance.getBalance();
await binance.getPositions();
await binance.getPositionRisk();

// Orders & History
await binance.getOpenOrders();
await binance.getOpenOrders('BTCUSDT');
await binance.getAllOrders('BTCUSDT');
await binance.getOrder('BTCUSDT', orderId);
await binance.getTradeHistory('BTCUSDT');
await binance.getIncomeHistory();
await binance.getIncomeHistory('BTCUSDT', 'REALIZED_PNL');

// Commission
await binance.getCommissionRate('BTCUSDT');
```

### Risk Management

```typescript
// Leverage
await binance.setLeverage('BTCUSDT', 10);
await binance.getLeverageBrackets();
await binance.getLeverageBrackets('BTCUSDT');

// Margin Mode
await binance.setMarginType('BTCUSDT', 'ISOLATED');
await binance.modifyIsolatedMargin('BTCUSDT', 100, 'ADD');
await binance.modifyIsolatedMargin('BTCUSDT', 50, 'REDUCE');

// Position Mode
await binance.getPositionMode();
await binance.setPositionMode(true);  // Hedge mode
await binance.setPositionMode(false); // One-way mode

// Multi-Asset Mode
await binance.getMultiAssetMode();
await binance.setMultiAssetMode(true);
```

### Analytics

```typescript
// Market Analytics
await binance.getLongShortRatio('BTCUSDT', '1h');
await binance.getTopTraderLongShortRatio('BTCUSDT', '1h');
await binance.getTopTraderPositions('BTCUSDT', '1h');
await binance.getGlobalLongShortRatio('BTCUSDT', '1h');
await binance.getTakerBuySellVolume('BTCUSDT', '1h');
```

### Staking & Earn

```typescript
// Staking
await binance.getStakingProducts();
await binance.stake('BNB', 10);
await binance.unstake('BNB', 5);
await binance.getStakingHistory();
await binance.getStakingPositions();
```

### Convert

```typescript
// Convert between assets
await binance.getConvertPairs('USDT', 'BTC');
await binance.sendQuote('USDT', 'BTC', 100);
await binance.acceptQuote(quoteId);
await binance.getConvertHistory();
```

### Portfolio Margin

```typescript
await binance.getPortfolioMarginAccount();
await binance.getPortfolioMarginBankruptcyLoan();
await binance.repayPortfolioMarginLoan();
```

---

## Bybit API (50+ Methods)

### Market Data

```typescript
await bybit.getTickers('linear');
await bybit.getTickers('linear', 'BTCUSDT');
await bybit.getOrderbook('BTCUSDT', 'linear');
await bybit.getKline('BTCUSDT', '1h', 'linear');
await bybit.getMarkPriceKline('BTCUSDT', '1h', 'linear');
await bybit.getIndexPriceKline('BTCUSDT', '1h', 'linear');
await bybit.getPremiumIndexPriceKline('BTCUSDT', '1h', 'linear');
await bybit.getInstrumentsInfo('linear');
await bybit.getFundingHistory('BTCUSDT', 'linear');
await bybit.getPublicTradingHistory('BTCUSDT', 'linear');
await bybit.getOpenInterest('BTCUSDT', 'linear', '1h');
await bybit.getHistoricalVolatility();
await bybit.getInsurance();
await bybit.getRiskLimit('linear');
```

### Trading

```typescript
// Place Order
await bybit.placeOrder({
  category: 'linear',
  symbol: 'BTCUSDT',
  side: 'Buy',
  orderType: 'Market',
  qty: '0.01',
});

await bybit.placeOrder({
  category: 'linear',
  symbol: 'BTCUSDT',
  side: 'Buy',
  orderType: 'Limit',
  qty: '0.01',
  price: '95000',
  timeInForce: 'GTC',
});

// Batch Orders
await bybit.placeBatchOrders('linear', [
  { symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: '0.01', price: '94000' },
  { symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: '0.01', price: '93000' },
]);

// Modify & Cancel
await bybit.amendOrder({ category: 'linear', symbol: 'BTCUSDT', orderId, qty: '0.02' });
await bybit.cancelOrder({ category: 'linear', symbol: 'BTCUSDT', orderId });
await bybit.cancelAllOrders({ category: 'linear', symbol: 'BTCUSDT' });
await bybit.cancelBatchOrders('linear', [{ symbol: 'BTCUSDT', orderId }]);
```

### Account & Positions

```typescript
await bybit.getWalletBalance('UNIFIED');
await bybit.getPositionInfo('linear');
await bybit.getPositionInfo('linear', 'BTCUSDT');
await bybit.getOpenOrders('linear');
await bybit.getOrderHistory('linear');
await bybit.getExecutionList('linear');
await bybit.getClosedPnl('linear');
await bybit.getBorrowHistory();
await bybit.getCollateralInfo();
await bybit.getCoinGreeks();
await bybit.getFeeRate('linear', 'BTCUSDT');
await bybit.getAccountInfo();
await bybit.getTransactionLog();
await bybit.getMMPState('linear');
await bybit.setMMP({ baseCoin: 'BTC', window: '5000', frozenPeriod: '100', qtyLimit: '10', deltaLimit: '100' });
await bybit.resetMMP('BTC');
```

### Risk Management

```typescript
await bybit.setLeverage({ category: 'linear', symbol: 'BTCUSDT', buyLeverage: '10', sellLeverage: '10' });
await bybit.setMarginMode('ISOLATED_MARGIN');
await bybit.setPositionMode({ category: 'linear', mode: 0 });  // 0=one-way, 3=hedge
await bybit.setRiskLimit({ category: 'linear', symbol: 'BTCUSDT', riskId: 1 });
await bybit.setTradingStop({ category: 'linear', symbol: 'BTCUSDT', takeProfit: '105000', stopLoss: '95000' });
await bybit.setTpSlMode({ category: 'linear', symbol: 'BTCUSDT', tpSlMode: 'Full' });
await bybit.addOrReduceMargin({ category: 'linear', symbol: 'BTCUSDT', margin: '100' });
await bybit.switchCrossIsolatedMargin({ category: 'linear', symbol: 'BTCUSDT', tradeMode: 1, buyLeverage: '10', sellLeverage: '10' });
```

### Copy Trading

```typescript
await bybit.getCopyTradingLeaders();
await bybit.followLeader(leaderId);
await bybit.unfollowLeader(leaderId);
await bybit.getCopyPositions();
await bybit.closeCopyPosition(symbol);
```

### Lending & Earn

```typescript
await bybit.getLendingProducts();
await bybit.depositToLending(productId, amount);
await bybit.redeemFromLending(productId, amount);
await bybit.getLendingOrders();
await bybit.getEarnProducts();
await bybit.getEarnOrders();
```

---

## Hyperliquid API (60+ Methods)

### Market Data

```typescript
await hyperliquid.getMeta();
await hyperliquid.getMetaAndAssetCtxs();
await hyperliquid.getAssetCtxs();
await hyperliquid.getAllMids();
await hyperliquid.getCandleSnapshot('BTC', '1h', startTime, endTime);
await hyperliquid.getL2Snapshot('BTC');
await hyperliquid.getFundingHistory('BTC', startTime, endTime);
await hyperliquid.getRecentTrades('BTC');
await hyperliquid.getPredictedFunding();
```

### Trading

```typescript
// Place Order
await hyperliquid.placeOrder({
  asset: 'BTC',
  isBuy: true,
  sz: 0.01,
  limitPx: 95000,
  orderType: { limit: { tif: 'Gtc' } },
  reduceOnly: false,
});

// Market Order
await hyperliquid.placeOrder({
  asset: 'BTC',
  isBuy: true,
  sz: 0.01,
  limitPx: null,
  orderType: { market: {} },
});

// TWAP Order
await hyperliquid.placeTwapOrder({
  asset: 'BTC',
  isBuy: true,
  sz: 1.0,
  duration: 3600,  // 1 hour
  randomize: true,
});

// Modify & Cancel
await hyperliquid.modifyOrder(orderId, { sz: 0.02 });
await hyperliquid.cancelOrder('BTC', orderId);
await hyperliquid.cancelAllOrders();
await hyperliquid.cancelOrdersByCloid(['cloid1', 'cloid2']);

// Batch Operations
await hyperliquid.batchModifyOrders([{ oid: orderId1, sz: 0.02 }, { oid: orderId2, sz: 0.03 }]);
```

### Account & Positions

```typescript
await hyperliquid.getUserState(walletAddress);
await hyperliquid.getClearinghouseState(walletAddress);
await hyperliquid.getOpenOrders(walletAddress);
await hyperliquid.getFrontendOpenOrders(walletAddress);
await hyperliquid.getUserFills(walletAddress);
await hyperliquid.getUserFillsByTime(walletAddress, startTime, endTime);
await hyperliquid.getUserFunding(walletAddress);
await hyperliquid.getUserFundingHistory(walletAddress, startTime, endTime);
await hyperliquid.getHistoricalOrders(walletAddress);
await hyperliquid.getOrderStatus(walletAddress, orderId);
await hyperliquid.getTwapHistory(walletAddress);
await hyperliquid.getSubaccounts(walletAddress);
```

### Leverage & Margin

```typescript
await hyperliquid.updateLeverage('BTC', 10, false);  // false = cross
await hyperliquid.updateLeverage('BTC', 10, true);   // true = isolated
await hyperliquid.updateIsolatedMargin('BTC', 100);
```

### Transfers

```typescript
await hyperliquid.usdTransfer(toAddress, amount);
await hyperliquid.spotTransfer(toAddress, token, amount);
await hyperliquid.withdraw(amount);
await hyperliquid.classTransfer(amount, toPerp);
```

### Spot Trading

```typescript
await hyperliquid.getSpotMeta();
await hyperliquid.getSpotMetaAndAssetCtxs();
await hyperliquid.getSpotClearinghouseState(walletAddress);
await hyperliquid.placeSpotOrder({
  asset: 'HYPE',
  isBuy: true,
  sz: 10,
  limitPx: 25,
});
```

### Vaults

```typescript
await hyperliquid.getVaultDetails(vaultAddress);
await hyperliquid.getUserVaultEquities(walletAddress);
await hyperliquid.depositToVault(vaultAddress, amount);
await hyperliquid.withdrawFromVault(vaultAddress, amount);
await hyperliquid.getAllVaults();
```

### Staking

```typescript
await hyperliquid.getValidatorSummaries();
await hyperliquid.getUserStakingSummary(walletAddress);
await hyperliquid.stakeHype(amount, validatorAddress);
await hyperliquid.unstakeHype(amount, validatorAddress);
await hyperliquid.claimStakingRewards();
```

### Delegations

```typescript
await hyperliquid.getDelegatorSummary(walletAddress);
await hyperliquid.getDelegatorHistory(walletAddress);
await hyperliquid.delegate(amount, agentAddress);
await hyperliquid.undelegate(amount, agentAddress);
```

### Referrals & Analytics

```typescript
await hyperliquid.getReferralState(walletAddress);
await hyperliquid.createReferralCode(code);
await hyperliquid.getReferredUsers(walletAddress);
await hyperliquid.getUserAnalytics(walletAddress);
await hyperliquid.getLeaderboard();
await hyperliquid.getMaxBuilderFee();
```

---

## MEXC API (35+ Methods)

### Market Data

```typescript
await mexc.getContractDetail('BTC_USDT');
await mexc.getAllContractDetails();
await mexc.getOrderbook('BTC_USDT');
await mexc.getKlines('BTC_USDT', '1h');
await mexc.getTicker('BTC_USDT');
await mexc.getAllTickers();
await mexc.getFundingRate('BTC_USDT');
await mexc.getFundingRateHistory('BTC_USDT');
await mexc.getOpenInterest('BTC_USDT');
await mexc.getRecentTrades('BTC_USDT');
await mexc.getIndexPrice('BTC_USDT');
await mexc.getFairPrice('BTC_USDT');
```

### Trading

```typescript
// Place Order
await mexc.placeOrder({
  symbol: 'BTC_USDT',
  side: 1,  // 1=Open Long, 2=Close Short, 3=Open Short, 4=Close Long
  type: 5,  // 1=Limit, 2=Post Only, 3=IOC, 4=FOK, 5=Market
  vol: 1,   // Contracts
  leverage: 10,
});

// With TP/SL
await mexc.placeOrder({
  symbol: 'BTC_USDT',
  side: 1,
  type: 5,
  vol: 1,
  leverage: 10,
  takeProfit: 105000,
  stopLoss: 95000,
});

// Batch Orders
await mexc.placeBatchOrders([
  { symbol: 'BTC_USDT', side: 1, type: 1, vol: 1, price: 94000, leverage: 10 },
  { symbol: 'BTC_USDT', side: 1, type: 1, vol: 1, price: 93000, leverage: 10 },
]);

// Trigger Order
await mexc.placeTriggerOrder({
  symbol: 'BTC_USDT',
  side: 1,
  type: 1,
  vol: 1,
  triggerPrice: 96000,
  triggerType: 1,  // 1=Last Price, 2=Fair Price, 3=Index Price
  executionPrice: 96100,
  leverage: 10,
});

// Cancel
await mexc.cancelOrder('BTC_USDT', orderId);
await mexc.cancelAllOrders('BTC_USDT');
await mexc.cancelBatchOrders([orderId1, orderId2]);
```

### Account & Positions

```typescript
await mexc.getAccountInfo();
await mexc.getPositions();
await mexc.getPositions('BTC_USDT');
await mexc.getOpenOrders();
await mexc.getOpenOrders('BTC_USDT');
await mexc.getOrderHistory('BTC_USDT');
await mexc.getTradeHistory('BTC_USDT');
await mexc.getTriggerOrders();
await mexc.getStopOrders();
await mexc.getRiskLimit('BTC_USDT');
await mexc.getAssets();
await mexc.getAssetRecords();
```

### Risk Management

```typescript
await mexc.setLeverage('BTC_USDT', 10);
await mexc.changeMarginMode('BTC_USDT', 1);  // 1=Isolated, 2=Cross
await mexc.changePositionMode(1);  // 1=Hedge, 2=One-way
await mexc.autoAddMargin('BTC_USDT', true);
```

---

## Database Tracking

### Initialize Database

```typescript
import { FuturesDatabase } from 'clodds/trading/futures';

const db = new FuturesDatabase(process.env.DATABASE_URL!);
await db.initialize();  // Creates tables if not exist
```

### Log Trades

```typescript
await db.logTrade({
  exchange: 'binance',
  symbol: 'BTCUSDT',
  orderId: '12345',
  side: 'BUY',
  price: 95000,
  quantity: 0.01,
  realizedPnl: 50.25,
  commission: 0.95,
  commissionAsset: 'USDT',
  timestamp: Date.now(),
  isMaker: false,
  strategy: 'momentum',
  variant: 'aggressive',
});
```

### Query Trades

```typescript
// Get trades
const trades = await db.getTrades({ exchange: 'binance' });
const btcTrades = await db.getTrades({ exchange: 'binance', symbol: 'BTCUSDT' });
const recentTrades = await db.getTrades({ limit: 100 });

// Get statistics
const stats = await db.getTradeStats('binance');
// { totalTrades, winRate, totalPnl, avgPnl, bestTrade, worstTrade }

// Get variant performance
const results = await db.getVariantPerformance('momentum');
// { aggressive: { trades, pnl, winRate }, conservative: { ... } }
```

---

## Custom Strategies

### Strategy Interface

```typescript
import { FuturesStrategy, StrategySignal } from 'clodds/trading/futures';

interface FuturesStrategy {
  name: string;
  analyze(data: MarketData): Promise<StrategySignal | null>;
}

interface StrategySignal {
  action: 'BUY' | 'SELL' | 'CLOSE';
  symbol: string;
  confidence: number;  // 0-1
  reason: string;
  metadata?: Record<string, unknown>;
}
```

### Example Strategy

```typescript
class RSIStrategy implements FuturesStrategy {
  name = 'rsi-strategy';

  constructor(private config: { period: number; oversold: number; overbought: number }) {}

  async analyze(data: MarketData): Promise<StrategySignal | null> {
    const rsi = calculateRSI(data.closes, this.config.period);

    if (rsi < this.config.oversold) {
      return {
        action: 'BUY',
        symbol: data.symbol,
        confidence: (this.config.oversold - rsi) / this.config.oversold,
        reason: `RSI oversold at ${rsi.toFixed(1)}`,
        metadata: { rsi },
      };
    }

    if (rsi > this.config.overbought) {
      return {
        action: 'SELL',
        symbol: data.symbol,
        confidence: (rsi - this.config.overbought) / (100 - this.config.overbought),
        reason: `RSI overbought at ${rsi.toFixed(1)}`,
        metadata: { rsi },
      };
    }

    return null;
  }
}
```

### Register & Run

```typescript
const engine = new StrategyEngine(db);
engine.registerStrategy(new RSIStrategy({ period: 14, oversold: 30, overbought: 70 }));

// A/B Test Variants
engine.registerVariant('rsi-strategy', 'aggressive', { oversold: 25, overbought: 75 });
engine.registerVariant('rsi-strategy', 'conservative', { oversold: 35, overbought: 65 });
```

---

## Built-in Strategies

| Strategy | Logic | Config |
|----------|-------|--------|
| MomentumStrategy | Follow price trends | `lookbackPeriod`, `threshold` |
| MeanReversionStrategy | Buy dips, sell rallies | `maPeriod`, `deviationMultiplier` |
| GridStrategy | Place orders at intervals | `gridSize`, `levels`, `spacing` |

---

## Error Handling

All clients throw typed errors:

```typescript
import { FuturesError, InsufficientBalanceError, InvalidOrderError } from 'clodds/trading/futures';

try {
  await binance.placeOrder({ ... });
} catch (error) {
  if (error instanceof InsufficientBalanceError) {
    console.log('Not enough margin');
  } else if (error instanceof InvalidOrderError) {
    console.log('Invalid order params:', error.message);
  } else if (error instanceof FuturesError) {
    console.log('Exchange error:', error.code, error.message);
  }
}
```

---

## Rate Limits

| Exchange | Limit | Notes |
|----------|-------|-------|
| Binance | 2400/min | Per IP, weight-based |
| Bybit | 120/min | Per endpoint |
| Hyperliquid | 1200/min | Per wallet |
| MEXC | 20/sec | Per IP |

All clients automatically handle rate limiting with exponential backoff.
