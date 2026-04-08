---
name: backtest
description: "Backtest trading strategies on historical prediction market data with walk-forward analysis and Monte Carlo simulation. Use when users want to validate strategies, compare performance, or stress-test trading approaches."
emoji: "📈"
---

# Backtest - Complete API Reference

Validate trading strategies using historical data, walk-forward analysis, and Monte Carlo simulation.

---

## Chat Commands

### Run Backtest

```
/backtest momentum --from 2024-01-01 --to 2024-12-31
/backtest mean-reversion --market "Trump 2028" --days 90
/backtest my-strategy --capital 10000
```

### Quick Stats

```
/backtest stats momentum           Show strategy metrics
/backtest compare momentum arb     Compare two strategies
/backtest monte-carlo momentum     Run Monte Carlo simulation
```

### Results

```
/backtest results                  Show recent results
/backtest stats                    Alias for results
/backtest results <id> --detailed  Detailed breakdown
/backtest export                   Export last results as CSV
```

---

## TypeScript API Reference

### Create Backtest Engine

```typescript
import { createBacktestEngine } from 'clodds/backtest';

const backtest = createBacktestEngine({
  // Data source
  dataSource: 'polymarket',  // or custom data provider

  // Capital
  initialCapital: 10000,

  // Fees (Polymarket: 0% on most markets; Kalshi: ~1.2% avg)
  fees: {
    maker: 0,       // 0% maker fee (Polymarket most markets)
    taker: 0,       // 0% taker fee (Polymarket most markets)
    // For 15-min crypto markets or Kalshi, use: taker: 0.012
  },

  // Slippage model
  slippageModel: 'realistic',  // 'none' | 'fixed' | 'realistic'
  slippageBps: 10,
});
```

### Run Basic Backtest

```typescript
const result = await backtest.run({
  strategy: 'momentum',
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  parameters: {
    lookbackPeriod: 14,
    entryThreshold: 0.02,
    exitThreshold: 0.01,
  },
});

console.log(`Total Return: ${result.totalReturn}%`);
console.log(`Sharpe Ratio: ${result.sharpeRatio}`);
console.log(`Max Drawdown: ${result.maxDrawdown}%`);
console.log(`Win Rate: ${result.winRate}%`);
console.log(`Profit Factor: ${result.profitFactor}`);
```

### Walk-Forward Analysis

```typescript
// Out-of-sample validation
const wf = await backtest.walkForward({
  strategy: 'momentum',
  startDate: '2023-01-01',
  endDate: '2024-12-31',

  // Train/test split
  trainPeriod: '6M',
  testPeriod: '1M',
  step: '1M',

  // Optimization
  optimize: ['lookbackPeriod', 'entryThreshold'],
  optimizationMetric: 'sharpe',
});

console.log(`In-Sample Sharpe: ${wf.inSampleSharpe}`);
console.log(`Out-of-Sample Sharpe: ${wf.outOfSampleSharpe}`);
console.log(`Overfitting Ratio: ${wf.overfitRatio}`);
```

### Monte Carlo Simulation

```typescript
// Stress test with randomization
const mc = await backtest.monteCarlo({
  strategy: 'momentum',
  trades: historicalTrades,

  // Simulation settings
  simulations: 10000,
  confidenceLevel: 0.95,

  // Randomization
  shuffleTrades: true,
  randomizeReturns: true,
});

console.log(`Expected Return: ${mc.expectedReturn}%`);
console.log(`95% VaR: ${mc.valueAtRisk}%`);
console.log(`Worst Case: ${mc.worstCase}%`);
console.log(`Best Case: ${mc.bestCase}%`);
console.log(`Probability of Profit: ${mc.probProfit}%`);
```

### Performance Metrics

```typescript
const metrics = await backtest.getMetrics(result);

console.log('=== Performance ===');
console.log(`Total Return: ${metrics.totalReturn}%`);
console.log(`CAGR: ${metrics.cagr}%`);
console.log(`Volatility: ${metrics.volatility}%`);

console.log('=== Risk ===');
console.log(`Sharpe Ratio: ${metrics.sharpeRatio}`);
console.log(`Sortino Ratio: ${metrics.sortinoRatio}`);
console.log(`Max Drawdown: ${metrics.maxDrawdown}%`);
console.log(`Max Drawdown Duration: ${metrics.maxDrawdownDuration} days`);

console.log('=== Trading ===');
console.log(`Total Trades: ${metrics.totalTrades}`);
console.log(`Win Rate: ${metrics.winRate}%`);
console.log(`Profit Factor: ${metrics.profitFactor}`);
console.log(`Avg Win: ${metrics.avgWin}%`);
console.log(`Avg Loss: ${metrics.avgLoss}%`);
console.log(`Expectancy: ${metrics.expectancy}%`);
```

### Custom Strategy

```typescript
// Define custom strategy
const myStrategy = {
  name: 'my-strategy',

  onData: async (data, context) => {
    const price = data.price;
    const sma = data.indicators.sma(20);

    if (price < sma * 0.95 && !context.hasPosition) {
      return { action: 'buy', size: context.availableCapital * 0.1 };
    }

    if (price > sma * 1.05 && context.hasPosition) {
      return { action: 'sell', size: 'all' };
    }

    return { action: 'hold' };
  },
};

const result = await backtest.run({
  strategy: myStrategy,
  startDate: '2024-01-01',
  endDate: '2024-12-31',
});
```

---

## Built-in Strategies

| Strategy | Description |
|----------|-------------|
| `momentum` | Follow price trends |
| `mean-reversion` | Buy dips, sell rallies |
| `arbitrage` | Cross-platform price differences |
| `breakout` | Enter on range breakouts |
| `pairs` | Correlated market pairs |

---

## Metrics Explained

| Metric | Good Value | Description |
|--------|------------|-------------|
| **Sharpe Ratio** | > 1.0 | Risk-adjusted return |
| **Sortino Ratio** | > 1.5 | Downside-adjusted return |
| **Max Drawdown** | < 20% | Worst peak-to-trough |
| **Win Rate** | > 50% | Winning trades % |
| **Profit Factor** | > 1.5 | Gross profit / gross loss |
| **Expectancy** | > 0 | Expected $ per trade |

---

## Best Practices

1. **Use walk-forward** — Avoid overfitting
2. **Include fees** — Realistic cost modeling
3. **Test multiple periods** — Don't cherry-pick dates
4. **Monte Carlo** — Understand variance
5. **Out-of-sample** — Always validate on unseen data
