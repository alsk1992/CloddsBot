---
name: router
description: "Smart order routing for best price, liquidity, and execution"
emoji: "🔀"
---

# Router - Complete API Reference

Route orders to the best platform based on price, liquidity, fees, and execution quality.

---

## Chat Commands

### Route Order

```
/route "Trump 2028" YES 1000        Find best route for $1000
/route BTCUSDT long 0.5             Route futures order
/route --mode best-price "Fed" YES  Optimize for price
/route --mode best-liquidity ...    Optimize for fills
```

### Compare Routes

```
/route compare "Trump" YES 1000     Compare all platforms
/route fees "Trump"                 Compare fee structures
/route liquidity "Trump"            Compare orderbook depth
```

### Execution

```
/route execute <route-id>           Execute routed order
/route split "Trump" YES 5000       Split across platforms
```

---

## TypeScript API Reference

### Create Smart Router

```typescript
import { createSmartRouter } from 'clodds/router';

const router = createSmartRouter({
  // Supported platforms
  platforms: ['polymarket', 'kalshi', 'manifold'],

  // Default mode
  defaultMode: 'balanced',

  // Fee structures
  fees: {
    polymarket: { maker: -0.005, taker: 0.01 },
    kalshi: { maker: 0, taker: 0.01 },
    manifold: { maker: 0, taker: 0 },
  },
});
```

### Find Best Route

```typescript
const route = await router.findBestRoute({
  market: 'trump-win-2028',
  side: 'YES',
  size: 1000,
  mode: 'best-price',  // 'best-price' | 'best-liquidity' | 'lowest-fee' | 'balanced'
});

console.log(`Best platform: ${route.platform}`);
console.log(`Expected price: ${route.expectedPrice}`);
console.log(`Expected slippage: ${route.expectedSlippage}%`);
console.log(`Fees: $${route.fees}`);
console.log(`Net cost: $${route.netCost}`);
console.log(`Fill probability: ${route.fillProbability}%`);
```

### Compare All Platforms

```typescript
const comparison = await router.compare({
  market: 'trump-win-2028',
  side: 'YES',
  size: 1000,
});

console.log('Platform Comparison:');
for (const platform of comparison) {
  console.log(`\n${platform.name}:`);
  console.log(`  Price: ${platform.price}`);
  console.log(`  Liquidity: $${platform.liquidity}`);
  console.log(`  Slippage: ${platform.slippage}%`);
  console.log(`  Fees: $${platform.fees}`);
  console.log(`  Net cost: $${platform.netCost}`);
  console.log(`  Score: ${platform.score}`);
}
```

### Split Order Across Platforms

```typescript
// Large orders split for better execution
const split = await router.splitOrder({
  market: 'trump-win-2028',
  side: 'YES',
  size: 10000,
  maxSlippage: 0.02,
});

console.log('Order Split:');
for (const leg of split.legs) {
  console.log(`  ${leg.platform}: $${leg.size} @ ${leg.price}`);
}
console.log(`Total slippage: ${split.totalSlippage}%`);
console.log(`Avg price: ${split.avgPrice}`);
```

### Execute Route

```typescript
// Execute the routed order
const result = await router.execute(route);

console.log(`Order ID: ${result.orderId}`);
console.log(`Platform: ${result.platform}`);
console.log(`Fill price: ${result.fillPrice}`);
console.log(`Slippage: ${result.actualSlippage}%`);
console.log(`Fees: $${result.fees}`);
```

### Routing Modes

```typescript
// Best price - minimize price paid
const priceRoute = await router.findBestRoute({
  ...order,
  mode: 'best-price',
});

// Best liquidity - maximize fill probability
const liquidityRoute = await router.findBestRoute({
  ...order,
  mode: 'best-liquidity',
});

// Lowest fees - minimize transaction costs
const feeRoute = await router.findBestRoute({
  ...order,
  mode: 'lowest-fee',
});

// Balanced - weighted optimization
const balancedRoute = await router.findBestRoute({
  ...order,
  mode: 'balanced',
  weights: {
    price: 0.4,
    liquidity: 0.3,
    fees: 0.3,
  },
});
```

### Fee Analysis

```typescript
const fees = await router.analyzeFees({
  market: 'trump-win-2028',
  side: 'YES',
  size: 1000,
});

for (const platform of fees) {
  console.log(`${platform.name}:`);
  console.log(`  Maker fee: ${platform.makerFee}%`);
  console.log(`  Taker fee: ${platform.takerFee}%`);
  console.log(`  For this order: $${platform.totalFee}`);
  console.log(`  Rebate available: ${platform.hasRebate}`);
}
```

### Liquidity Analysis

```typescript
const liquidity = await router.analyzeLiquidity({
  market: 'trump-win-2028',
  side: 'YES',
});

for (const platform of liquidity) {
  console.log(`${platform.name}:`);
  console.log(`  Best bid: ${platform.bestBid}`);
  console.log(`  Best ask: ${platform.bestAsk}`);
  console.log(`  Spread: ${platform.spread}%`);
  console.log(`  Depth at 1%: $${platform.depth1Pct}`);
  console.log(`  Depth at 2%: $${platform.depth2Pct}`);
}
```

---

## Routing Modes

| Mode | Optimizes For | Best When |
|------|---------------|-----------|
| `best-price` | Lowest price | Small orders |
| `best-liquidity` | Fill probability | Large orders |
| `lowest-fee` | Minimize fees | High frequency |
| `balanced` | Weighted combo | Default choice |

---

## Platform Comparison

| Platform | Maker Fee | Taker Fee | Notes |
|----------|-----------|-----------|-------|
| **Polymarket** | -0.5% rebate | 1% | Best for makers |
| **Kalshi** | 0% | 1% | Regulated |
| **Manifold** | 0% | 0% | Play money |

---

## Best Practices

1. **Compare before trading** — Always check alternatives
2. **Use maker orders** — Get rebates on Polymarket
3. **Split large orders** — Reduce slippage
4. **Check liquidity** — Don't trade thin markets
5. **Account for fees** — Include in edge calculations
