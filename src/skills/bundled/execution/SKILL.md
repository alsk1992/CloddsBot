---
name: execution
description: "Execute trades on prediction markets with slippage protection and order management"
emoji: "⚡"
gates:
  envs:
    anyOf:
      - POLY_API_KEY
      - KALSHI_API_KEY
---

# Execution Service - Complete API Reference

Execute trades on Polymarket and Kalshi with slippage protection, maker orders, and order management.

## Supported Platforms

| Platform | Order Types | Features |
|----------|-------------|----------|
| Polymarket | Limit, Market, Maker | -0.5% maker rebate, GTC/FOK |
| Kalshi | Limit, Market | US regulated |

---

## Chat Commands

### Place Orders

```
/execute buy poly <market> YES 100 @ 0.52   # Limit buy on Polymarket
/execute sell kalshi <market> NO 50 @ 0.48  # Limit sell on Kalshi
/execute market-buy poly <market> YES 100   # Market buy
/execute market-sell poly <market> NO 50    # Market sell
```

### Maker Orders (Rebates)

```
/execute maker-buy poly <market> YES 100 @ 0.52   # Post-only buy
/execute maker-sell poly <market> NO 50 @ 0.48    # Post-only sell
```

### Protected Orders (Slippage Protection)

```
/execute protected-buy poly <market> YES 100 --max-slippage 1%
/execute protected-sell poly <market> NO 50 --max-slippage 0.5%
```

### Order Management

```
/orders open                                # View open orders
/orders open poly                           # Open orders on Polymarket
/orders cancel <order-id>                   # Cancel specific order
/orders cancel-all                          # Cancel all open orders
/orders cancel-all poly                     # Cancel all on Polymarket
```

### Slippage Estimation

```
/estimate-slippage poly <market> buy 1000   # Estimate slippage for $1000 buy
/estimate-slippage kalshi <market> sell 500 # Estimate for $500 sell
```

---

## TypeScript API Reference

### Create Execution Service

```typescript
import { createExecutionService } from 'clodds/execution';

const executor = createExecutionService({
  polymarket: {
    apiKey: process.env.POLY_API_KEY,
    apiSecret: process.env.POLY_API_SECRET,
    passphrase: process.env.POLY_API_PASSPHRASE,
    privateKey: process.env.PRIVATE_KEY,
  },
  kalshi: {
    apiKey: process.env.KALSHI_API_KEY,
    privateKey: process.env.KALSHI_PRIVATE_KEY,
  },

  // Defaults
  defaultSlippageTolerance: 0.5,  // 0.5%
  autoLogTrades: true,
});
```

### Limit Orders

```typescript
// Buy limit order
const order = await executor.buyLimit({
  platform: 'polymarket',
  marketId: 'market-123',
  side: 'YES',
  size: 100,           // $100
  price: 0.52,         // 52 cents
  timeInForce: 'GTC',  // Good-til-cancel
});

console.log(`Order placed: ${order.orderId}`);
console.log(`Status: ${order.status}`);

// Sell limit order
const sellOrder = await executor.sellLimit({
  platform: 'polymarket',
  marketId: 'market-123',
  side: 'YES',
  size: 100,
  price: 0.55,
});
```

### Market Orders

```typescript
// Market buy - executes immediately at best price
const order = await executor.marketBuy({
  platform: 'polymarket',
  marketId: 'market-123',
  side: 'YES',
  size: 100,
});

console.log(`Filled at: ${order.avgFillPrice}`);
console.log(`Filled size: ${order.filledSize}`);

// Market sell
const sellOrder = await executor.marketSell({
  platform: 'kalshi',
  marketId: 'TRUMP-WIN',
  side: 'YES',
  size: 50,
});
```

### Maker Orders (Post-Only)

```typescript
// Maker buy - only executes as maker (gets rebate)
const order = await executor.makerBuy({
  platform: 'polymarket',
  marketId: 'market-123',
  side: 'YES',
  size: 100,
  price: 0.52,
});

// Will be rejected if it would execute immediately as taker
if (order.status === 'rejected') {
  console.log('Price too aggressive - would be taker');
}

// Maker sell
const sellOrder = await executor.makerSell({
  platform: 'polymarket',
  marketId: 'market-123',
  side: 'NO',
  size: 50,
  price: 0.48,
});
```

### Protected Orders (Slippage Protection)

```typescript
// Protected buy - checks slippage before executing
const order = await executor.protectedBuy({
  platform: 'polymarket',
  marketId: 'market-123',
  side: 'YES',
  size: 100,
  maxSlippage: 0.5,  // 0.5% max slippage
});

if (order.status === 'rejected') {
  console.log(`Rejected: slippage would be ${order.estimatedSlippage}%`);
} else {
  console.log(`Executed with ${order.actualSlippage}% slippage`);
}

// Protected sell
const sellOrder = await executor.protectedSell({
  platform: 'kalshi',
  marketId: 'TRUMP-WIN',
  side: 'YES',
  size: 50,
  maxSlippage: 1,
});
```

### Order Management

```typescript
// Cancel specific order
await executor.cancelOrder('polymarket', orderId);

// Cancel all orders on platform
await executor.cancelAllOrders('polymarket');

// Cancel all orders for a market
await executor.cancelAllOrders('polymarket', { marketId: 'market-123' });

// Get open orders
const openOrders = await executor.getOpenOrders('polymarket');

for (const order of openOrders) {
  console.log(`${order.orderId}: ${order.side} ${order.size} @ ${order.price}`);
  console.log(`  Status: ${order.status}`);
  console.log(`  Filled: ${order.filledSize}/${order.size}`);
}
```

### Slippage Estimation

```typescript
// Estimate slippage before executing
const estimate = await executor.estimateSlippage({
  platform: 'polymarket',
  marketId: 'market-123',
  side: 'buy',
  size: 1000,
});

console.log(`For $1000 buy:`);
console.log(`  Avg fill price: ${estimate.avgFillPrice}`);
console.log(`  Expected slippage: ${estimate.slippagePct}%`);
console.log(`  Total filled: ${estimate.totalFilled}`);
console.log(`  Levels consumed: ${estimate.levelsConsumed}`);
```

---

## Order Types

| Type | Description | Best For |
|------|-------------|----------|
| **Limit** | Execute at specific price or better | Price-sensitive orders |
| **Market** | Execute immediately at best available | Urgent execution |
| **Maker** | Post-only, gets rebate | Collecting rebates |
| **Protected** | Checks slippage before executing | Large orders |

## Time In Force

| Value | Description |
|-------|-------------|
| **GTC** | Good-til-cancel (default) |
| **FOK** | Fill-or-kill - all or nothing |
| **IOC** | Immediate-or-cancel - fill what you can |

---

## Fee Structure

### Polymarket
- **Taker**: 0% (no fee)
- **Maker**: -0.5% (rebate!)

### Kalshi
- **Taker**: Varies by market
- **Maker**: Lower than taker

---

## Best Practices

1. **Use maker orders** when possible - Get rebates on Polymarket
2. **Check slippage** before large orders
3. **Use protected orders** for size > $500
4. **Set appropriate timeInForce** - GTC for patient orders, FOK for all-or-nothing
5. **Monitor open orders** - Cancel stale orders
6. **Start small** - Test with small sizes first
