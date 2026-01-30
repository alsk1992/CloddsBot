---
name: triggers
description: "Conditional orders that auto-execute when price thresholds are met"
emoji: "⚡"
---

# Triggers - Complete API Reference

Set up conditional orders that automatically execute trades when price conditions are met. Works across prediction markets, futures, and crypto spot.

---

## Chat Commands

### Create Trigger Orders

```
/trigger buy poly "Trump 2028" YES below 0.40 size 100
/trigger buy poly "Fed rate" NO above 0.60 size 50
/trigger sell poly "Trump 2028" YES above 0.55 size all
```

### Futures Triggers

```
/trigger long binance BTCUSDT below 95000 size 0.1 leverage 10x
/trigger short binance ETHUSDT above 4000 size 1 leverage 20x
/trigger close binance BTCUSDT above 105000
```

### Crypto Spot Triggers

```
/trigger buy sol SOL below 180 size 100usdc
/trigger sell eth ETH above 4000 size 0.5
/trigger swap arb USDC to ARB below 1.50 size 500
```

### Manage Triggers

```
/triggers                        List all active triggers
/triggers pending                Show pending only
/triggers history                Triggered order history
/trigger cancel <id>             Cancel trigger
/trigger cancel all              Cancel all triggers
```

### Stop-Loss & Take-Profit

```
/sl poly "Trump" at 0.35         Stop-loss on position
/tp poly "Trump" at 0.65         Take-profit on position
/trailing-stop poly "Trump" 10%  Trailing stop (% from high)
```

---

## TypeScript API Reference

### Create Trigger Service

```typescript
import { createTriggerService } from 'clodds/triggers';

const triggers = createTriggerService({
  // Price monitoring
  checkIntervalMs: 5000,  // Check every 5 seconds

  // Execution
  maxSlippagePercent: 2,
  retryAttempts: 3,

  // Storage
  storage: 'sqlite',
  dbPath: './triggers.db',
});

// Start monitoring
await triggers.start();
```

### Create Prediction Market Trigger

```typescript
// Buy YES when price drops below threshold
const trigger = await triggers.create({
  type: 'entry',
  platform: 'polymarket',
  market: 'will-trump-win-2028',
  side: 'YES',
  direction: 'below',
  triggerPrice: 0.40,
  size: 100,  // $100
  orderType: 'limit',  // 'market' | 'limit'
  limitPrice: 0.41,    // Optional: max price for limit
});

console.log(`Trigger ID: ${trigger.id}`);
console.log(`Status: ${trigger.status}`);  // 'pending'

// Sell when price rises above threshold
await triggers.create({
  type: 'exit',
  platform: 'polymarket',
  market: 'will-trump-win-2028',
  side: 'YES',
  direction: 'above',
  triggerPrice: 0.55,
  size: 'all',  // Sell entire position
});
```

### Create Futures Trigger

```typescript
// Long entry when BTC drops below support
await triggers.create({
  type: 'entry',
  platform: 'binance',
  symbol: 'BTCUSDT',
  side: 'long',
  direction: 'below',
  triggerPrice: 95000,
  size: 0.1,
  leverage: 10,

  // Auto-set SL/TP on fill
  stopLoss: 93000,
  takeProfit: 105000,
});

// Short entry when ETH breaks above resistance
await triggers.create({
  type: 'entry',
  platform: 'bybit',
  symbol: 'ETHUSDT',
  side: 'short',
  direction: 'above',
  triggerPrice: 4000,
  size: 1,
  leverage: 20,
});

// Close position when price target hit
await triggers.create({
  type: 'exit',
  platform: 'binance',
  symbol: 'BTCUSDT',
  direction: 'above',
  triggerPrice: 105000,
  size: 'all',
});
```

### Create Crypto Spot Trigger

```typescript
// Buy SOL when price drops
await triggers.create({
  type: 'entry',
  platform: 'jupiter',  // Solana DEX
  tokenIn: 'USDC',
  tokenOut: 'SOL',
  direction: 'below',
  triggerPrice: 180,
  size: 100,  // 100 USDC
  slippagePercent: 1,
});

// Sell ETH when price rises
await triggers.create({
  type: 'exit',
  platform: 'uniswap',  // EVM DEX
  chain: 'ethereum',
  tokenIn: 'ETH',
  tokenOut: 'USDC',
  direction: 'above',
  triggerPrice: 4000,
  size: 0.5,
});
```

### Stop-Loss & Take-Profit

```typescript
// Set stop-loss on existing position
await triggers.setStopLoss({
  platform: 'polymarket',
  market: 'will-trump-win-2028',
  side: 'YES',
  triggerPrice: 0.35,
  size: 'all',
});

// Set take-profit
await triggers.setTakeProfit({
  platform: 'polymarket',
  market: 'will-trump-win-2028',
  side: 'YES',
  triggerPrice: 0.65,
  size: 'all',
});

// Trailing stop (follows price up, triggers on pullback)
await triggers.setTrailingStop({
  platform: 'polymarket',
  market: 'will-trump-win-2028',
  side: 'YES',
  trailPercent: 10,  // Trigger if drops 10% from high
  size: 'all',
});
```

### Multi-Condition Triggers

```typescript
// Trigger only when multiple conditions met
await triggers.create({
  type: 'entry',
  platform: 'polymarket',
  market: 'will-trump-win-2028',
  side: 'YES',

  conditions: [
    { type: 'price', direction: 'below', value: 0.40 },
    { type: 'volume24h', direction: 'above', value: 100000 },
    { type: 'spread', direction: 'below', value: 0.02 },
  ],

  // All conditions must be true
  conditionLogic: 'AND',  // 'AND' | 'OR'

  size: 100,
});
```

### One-Cancels-Other (OCO)

```typescript
// OCO: Either SL or TP triggers, other cancels
const oco = await triggers.createOCO({
  platform: 'binance',
  symbol: 'BTCUSDT',

  stopLoss: {
    direction: 'below',
    triggerPrice: 93000,
    size: 'all',
  },

  takeProfit: {
    direction: 'above',
    triggerPrice: 105000,
    size: 'all',
  },
});
```

### List & Manage Triggers

```typescript
// List all triggers
const all = await triggers.list();

for (const t of all) {
  console.log(`${t.id}: ${t.platform} ${t.market || t.symbol}`);
  console.log(`  ${t.direction} ${t.triggerPrice}`);
  console.log(`  Status: ${t.status}`);
  console.log(`  Created: ${t.createdAt}`);
}

// Get pending only
const pending = await triggers.list({ status: 'pending' });

// Get history (triggered)
const history = await triggers.list({ status: 'triggered' });

// Cancel trigger
await triggers.cancel(triggerId);

// Cancel all
await triggers.cancelAll();
```

### Event Handlers

```typescript
// Trigger activated
triggers.on('triggered', async (trigger, result) => {
  console.log(`Trigger ${trigger.id} activated!`);
  console.log(`Order: ${result.orderId}`);
  console.log(`Fill price: ${result.fillPrice}`);
  console.log(`Size: ${result.filledSize}`);
});

// Trigger failed
triggers.on('failed', (trigger, error) => {
  console.error(`Trigger ${trigger.id} failed: ${error.message}`);
});

// Price approaching trigger
triggers.on('approaching', (trigger, currentPrice) => {
  console.log(`Price ${currentPrice} approaching trigger at ${trigger.triggerPrice}`);
});
```

---

## Supported Platforms

### Prediction Markets

| Platform | Entry Triggers | Exit Triggers | SL/TP |
|----------|---------------|---------------|-------|
| **Polymarket** | ✓ | ✓ | ✓ |
| **Kalshi** | ✓ | ✓ | ✓ |
| **Manifold** | ✓ | ✓ | ✓ |

### Futures

| Platform | Entry Triggers | Native Triggers | SL/TP |
|----------|---------------|-----------------|-------|
| **Binance** | ✓ | ✓ | ✓ |
| **Bybit** | ✓ | ✓ | ✓ |
| **MEXC** | ✓ | ✓ Native | ✓ |
| **Hyperliquid** | ✓ | ✓ | ✓ |

### Crypto Spot

| Platform | Entry Triggers | Exit Triggers |
|----------|---------------|---------------|
| **Jupiter** (Solana) | ✓ | ✓ |
| **Raydium** | ✓ | ✓ |
| **Uniswap** (EVM) | ✓ | ✓ |
| **1inch** (EVM) | ✓ | ✓ |

---

## Trigger Types

| Type | Description |
|------|-------------|
| **entry** | Open new position when triggered |
| **exit** | Close position when triggered |
| **stop-loss** | Exit to limit losses |
| **take-profit** | Exit to lock in gains |
| **trailing-stop** | Dynamic stop that follows price |
| **oco** | One-cancels-other (SL + TP pair) |

---

## Price Sources

| Platform | Price Source |
|----------|-------------|
| Polymarket | WebSocket mid price |
| Kalshi | REST API best bid/ask |
| Binance | WebSocket mark price |
| Bybit | WebSocket last price |
| Jupiter | On-chain oracle |

---

## Examples

### Prediction Market Strategy

```typescript
// Buy the dip, sell the rip
await triggers.create({
  platform: 'polymarket',
  market: 'trump-2028',
  side: 'YES',
  direction: 'below',
  triggerPrice: 0.40,
  size: 200,
});

await triggers.create({
  platform: 'polymarket',
  market: 'trump-2028',
  side: 'YES',
  direction: 'above',
  triggerPrice: 0.55,
  size: 'all',
});
```

### Futures Breakout Strategy

```typescript
// Enter long on breakout above resistance
await triggers.create({
  platform: 'binance',
  symbol: 'BTCUSDT',
  side: 'long',
  direction: 'above',
  triggerPrice: 100000,
  size: 0.5,
  leverage: 10,
  stopLoss: 98000,
  takeProfit: 110000,
});
```

### DCA on Dips

```typescript
// Buy more as price drops
const levels = [180, 170, 160, 150];
for (const price of levels) {
  await triggers.create({
    platform: 'jupiter',
    tokenOut: 'SOL',
    tokenIn: 'USDC',
    direction: 'below',
    triggerPrice: price,
    size: 50,  // $50 at each level
  });
}
```

---

## Best Practices

1. **Use limit orders** — Avoid slippage on triggers
2. **Set expiration** — Don't leave triggers forever
3. **Monitor execution** — Check fill prices
4. **Use OCO for exits** — SL + TP together
5. **Test with small size** — Verify triggers work
6. **Account for fees** — Include in trigger price
