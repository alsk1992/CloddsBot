---
name: slippage
description: "Slippage estimation, optimization, and protection for trade execution"
emoji: "📉"
---

# Slippage - Complete API Reference

Estimate, minimize, and protect against slippage across all trading platforms.

---

## Chat Commands

### Estimate Slippage

```
/slippage estimate "Trump" YES 5000    Estimate for $5000 order
/slippage BTCUSDT 1.5 BTC              Estimate for futures
/slippage ETH 50 --dex uniswap         Estimate DEX slippage
```

### Analyze Orderbook

```
/slippage depth "Trump"                Show orderbook depth
/slippage impact 10000                 Price impact for size
/slippage levels "Trump"               Show slippage at sizes
```

### Optimize Execution

```
/slippage optimize "Trump" YES 10000   Find best execution
/slippage split 50000                  Optimal order splitting
/slippage timing "Trump"               Best times for low slippage
```

### Protection Settings

```
/slippage max 1%                       Set max slippage tolerance
/slippage protect on                   Enable slippage protection
/slippage revert-threshold 2%          Cancel if slippage exceeds
```

---

## TypeScript API Reference

### Create Slippage Manager

```typescript
import { createSlippageManager } from 'clodds/slippage';

const slippage = createSlippageManager({
  // Default tolerance
  defaultMaxSlippage: 0.01,  // 1%

  // Protection
  enableProtection: true,
  revertThreshold: 0.02,  // Cancel if > 2%

  // Data sources
  orderbookDepth: 20,  // Levels to analyze
  refreshInterval: 1000,  // ms
});
```

### Estimate Slippage

```typescript
const estimate = await slippage.estimate({
  platform: 'polymarket',
  market: 'trump-win-2028',
  side: 'YES',
  size: 5000,
});

console.log(`Expected slippage: ${estimate.slippage}%`);
console.log(`Price impact: ${estimate.priceImpact}%`);
console.log(`Effective price: ${estimate.effectivePrice}`);
console.log(`Best price: ${estimate.bestPrice}`);
console.log(`Worst price: ${estimate.worstPrice}`);
console.log(`Confidence: ${estimate.confidence}%`);
```

### Analyze Orderbook Depth

```typescript
const depth = await slippage.analyzeDepth({
  platform: 'polymarket',
  market: 'trump-win-2028',
  side: 'YES',
});

console.log('Orderbook Depth:');
console.log(`  Liquidity at 0.5%: $${depth.liquidityAt05Pct}`);
console.log(`  Liquidity at 1%: $${depth.liquidityAt1Pct}`);
console.log(`  Liquidity at 2%: $${depth.liquidityAt2Pct}`);
console.log(`  Total depth: $${depth.totalDepth}`);

console.log('\nSlippage by Size:');
for (const level of depth.slippageLevels) {
  console.log(`  $${level.size}: ${level.slippage}% slippage`);
}
```

### Price Impact Analysis

```typescript
const impact = await slippage.priceImpact({
  platform: 'polymarket',
  market: 'trump-win-2028',
  side: 'YES',
  sizes: [1000, 5000, 10000, 25000, 50000],
});

console.log('Price Impact Analysis:');
for (const level of impact.levels) {
  console.log(`  $${level.size}:`);
  console.log(`    Slippage: ${level.slippage}%`);
  console.log(`    Impact: ${level.impact}%`);
  console.log(`    Effective: ${level.effectivePrice}`);
}
```

### Optimize Execution

```typescript
const optimized = await slippage.optimize({
  platform: 'polymarket',
  market: 'trump-win-2028',
  side: 'YES',
  size: 25000,
  maxSlippage: 0.01,
});

console.log('Optimized Execution:');
console.log(`  Strategy: ${optimized.strategy}`);  // 'single' | 'split' | 'twap'
console.log(`  Expected slippage: ${optimized.expectedSlippage}%`);
console.log(`  vs naive: ${optimized.naiveSlippage}%`);
console.log(`  Savings: $${optimized.savings}`);

if (optimized.strategy === 'split') {
  console.log('\nOrder Split:');
  for (const order of optimized.orders) {
    console.log(`  ${order.size} @ ${order.limitPrice} (${order.delay}s delay)`);
  }
}
```

### Order Splitting

```typescript
const split = await slippage.splitOrder({
  platform: 'polymarket',
  market: 'trump-win-2028',
  side: 'YES',
  totalSize: 50000,
  maxSlippagePerOrder: 0.005,  // 0.5% max per order
  minOrderSize: 1000,
});

console.log(`Split into ${split.orders.length} orders:`);
for (const order of split.orders) {
  console.log(`  $${order.size} - expected ${order.expectedSlippage}%`);
}
console.log(`Total expected slippage: ${split.totalSlippage}%`);
console.log(`Execution time: ${split.estimatedTime}s`);
```

### TWAP Execution

```typescript
const twap = await slippage.twapSchedule({
  platform: 'polymarket',
  market: 'trump-win-2028',
  side: 'YES',
  totalSize: 100000,
  duration: 3600,  // 1 hour
  intervals: 12,   // 12 orders
});

console.log('TWAP Schedule:');
for (const order of twap.orders) {
  console.log(`  ${order.time}: $${order.size}`);
}
console.log(`Expected avg slippage: ${twap.expectedSlippage}%`);
```

### Best Timing Analysis

```typescript
const timing = await slippage.analyzeTiming({
  platform: 'polymarket',
  market: 'trump-win-2028',
  side: 'YES',
  size: 10000,
});

console.log('Best Times for Low Slippage:');
for (const window of timing.bestWindows) {
  console.log(`  ${window.time}: avg ${window.avgSlippage}% slippage`);
  console.log(`    Liquidity: $${window.avgLiquidity}`);
}

console.log('\nWorst Times:');
for (const window of timing.worstWindows) {
  console.log(`  ${window.time}: avg ${window.avgSlippage}% slippage`);
}
```

### Slippage Protection

```typescript
// Set protection parameters
slippage.setProtection({
  maxSlippage: 0.01,           // 1% max
  revertThreshold: 0.02,       // Cancel if > 2%
  notifyThreshold: 0.005,      // Alert at 0.5%
  retryOnRevert: true,         // Retry with lower size
  retryReductionPct: 50,       // Reduce size by 50%
});

// Execute with protection
const result = await slippage.executeProtected({
  platform: 'polymarket',
  market: 'trump-win-2028',
  side: 'YES',
  size: 10000,
});

console.log(`Executed: ${result.executed}`);
console.log(`Actual slippage: ${result.actualSlippage}%`);
console.log(`Protected: ${result.protected}`);
if (result.reverted) {
  console.log(`Reverted: ${result.revertReason}`);
}
```

### DEX Slippage (Crypto)

```typescript
const dexSlippage = await slippage.estimateDex({
  chain: 'ethereum',
  dex: 'uniswap',
  tokenIn: 'USDC',
  tokenOut: 'ETH',
  amountIn: 50000,
});

console.log('DEX Slippage Estimate:');
console.log(`  Expected out: ${dexSlippage.expectedOut}`);
console.log(`  Min out (1% slip): ${dexSlippage.minOut1Pct}`);
console.log(`  Price impact: ${dexSlippage.priceImpact}%`);
console.log(`  Route: ${dexSlippage.route.join(' → ')}`);
```

### Historical Slippage

```typescript
const history = await slippage.getHistory({
  platform: 'polymarket',
  period: '30d',
});

console.log('Historical Slippage:');
console.log(`  Avg slippage: ${history.avgSlippage}%`);
console.log(`  Max slippage: ${history.maxSlippage}%`);
console.log(`  Trades with > 1%: ${history.tradesOver1Pct}`);
console.log(`  Total slippage cost: $${history.totalCost}`);
```

---

## Slippage Factors

| Factor | Impact | Mitigation |
|--------|--------|------------|
| **Order size** | Larger = more slip | Split orders |
| **Liquidity** | Thin = more slip | Check depth first |
| **Volatility** | High = more slip | Use limit orders |
| **Time of day** | Off-hours = more slip | Trade peak hours |
| **Market type** | New = more slip | Avoid illiquid markets |

---

## Protection Modes

| Mode | Behavior |
|------|----------|
| `warn` | Alert but execute |
| `confirm` | Require confirmation |
| `block` | Cancel if exceeds |
| `retry` | Retry with smaller size |

---

## Best Practices

1. **Always estimate first** — Check slippage before trading
2. **Split large orders** — Reduce impact on thin orderbooks
3. **Use limit orders** — Protect against unexpected slippage
4. **Trade liquid markets** — Higher volume = lower slippage
5. **Monitor execution** — Track actual vs expected slippage
