---
name: positions
description: "Position management with stop-loss, take-profit, and trailing stops"
emoji: "📍"
---

# Positions - Complete API Reference

Manage open positions with automated stop-loss, take-profit, and trailing stop orders.

---

## Chat Commands

### View Positions

```
/positions                          List all positions
/positions poly                     Polymarket positions only
/positions futures                  Futures positions only
/position <id>                      Position details
```

### Stop-Loss

```
/sl <position-id> at 0.35           Set stop-loss price
/sl <position-id> -10%              Stop-loss 10% below entry
/sl poly "Trump" at 0.35            Set by market name
```

### Take-Profit

```
/tp <position-id> at 0.65           Set take-profit price
/tp <position-id> +20%              Take-profit 20% above entry
/tp poly "Trump" at 0.65            Set by market name
```

### Trailing Stop

```
/trailing <position-id> 5%          Trail 5% from high
/trailing <position-id> $0.05       Trail $0.05 from high
```

### Partial Exits

```
/tp <position-id> at 0.55 size 50%  Take profit on half
/sl <position-id> at 0.40 size 25%  Stop-loss on quarter
```

---

## TypeScript API Reference

### Create Position Manager

```typescript
import { createPositionManager } from 'clodds/positions';

const positions = createPositionManager({
  // Monitoring
  checkIntervalMs: 5000,

  // Execution
  orderType: 'market',  // 'market' | 'limit'
  limitBuffer: 0.01,    // Buffer for limit orders

  // Storage
  storage: 'sqlite',
  dbPath: './positions.db',
});

// Start monitoring
await positions.start();
```

### List Positions

```typescript
const all = await positions.list();

for (const pos of all) {
  console.log(`${pos.id}: ${pos.platform} ${pos.market}`);
  console.log(`  Side: ${pos.side}`);
  console.log(`  Size: ${pos.size}`);
  console.log(`  Entry: ${pos.entryPrice}`);
  console.log(`  Current: ${pos.currentPrice}`);
  console.log(`  P&L: ${pos.pnl} (${pos.pnlPercent}%)`);
  console.log(`  Stop-loss: ${pos.stopLoss || 'none'}`);
  console.log(`  Take-profit: ${pos.takeProfit || 'none'}`);
}
```

### Set Stop-Loss

```typescript
// Absolute price
await positions.setStopLoss({
  positionId: 'pos-123',
  price: 0.35,
});

// Percentage from entry
await positions.setStopLoss({
  positionId: 'pos-123',
  percentFromEntry: 10,  // 10% below entry
});

// Percentage from current
await positions.setStopLoss({
  positionId: 'pos-123',
  percentFromCurrent: 5,  // 5% below current
});

// Partial stop-loss
await positions.setStopLoss({
  positionId: 'pos-123',
  price: 0.35,
  sizePercent: 50,  // Exit 50% of position
});
```

### Set Take-Profit

```typescript
// Absolute price
await positions.setTakeProfit({
  positionId: 'pos-123',
  price: 0.65,
});

// Percentage from entry
await positions.setTakeProfit({
  positionId: 'pos-123',
  percentFromEntry: 20,  // 20% above entry
});

// Multiple take-profit levels
await positions.setTakeProfit({
  positionId: 'pos-123',
  levels: [
    { price: 0.55, sizePercent: 25 },  // 25% at 0.55
    { price: 0.60, sizePercent: 25 },  // 25% at 0.60
    { price: 0.70, sizePercent: 50 },  // 50% at 0.70
  ],
});
```

### Set Trailing Stop

```typescript
// Percentage trail
await positions.setTrailingStop({
  positionId: 'pos-123',
  trailPercent: 5,  // Trail 5% below high
});

// Absolute trail
await positions.setTrailingStop({
  positionId: 'pos-123',
  trailAmount: 0.05,  // Trail $0.05 below high
});

// Activate after target
await positions.setTrailingStop({
  positionId: 'pos-123',
  trailPercent: 5,
  activateAt: 0.55,  // Only start trailing after 0.55
});
```

### Remove Stops

```typescript
// Remove stop-loss
await positions.removeStopLoss('pos-123');

// Remove take-profit
await positions.removeTakeProfit('pos-123');

// Remove trailing stop
await positions.removeTrailingStop('pos-123');

// Remove all
await positions.removeAllStops('pos-123');
```

### Event Handlers

```typescript
// Stop-loss triggered
positions.on('stopLossTriggered', (position, result) => {
  console.log(`🛑 Stop-loss hit: ${position.market}`);
  console.log(`  Entry: ${position.entryPrice}`);
  console.log(`  Exit: ${result.exitPrice}`);
  console.log(`  P&L: ${result.pnl}`);
});

// Take-profit triggered
positions.on('takeProfitTriggered', (position, result) => {
  console.log(`✅ Take-profit hit: ${position.market}`);
  console.log(`  P&L: ${result.pnl}`);
});

// Trailing stop triggered
positions.on('trailingStopTriggered', (position, result) => {
  console.log(`📉 Trailing stop hit: ${position.market}`);
  console.log(`  High: ${position.highWaterMark}`);
  console.log(`  Exit: ${result.exitPrice}`);
});

// Price approaching stop
positions.on('approaching', (position, type, distance) => {
  console.log(`⚠️ ${position.market} ${distance}% from ${type}`);
});
```

### Position Summary

```typescript
const summary = await positions.getSummary();

console.log(`Total positions: ${summary.count}`);
console.log(`Total value: $${summary.totalValue}`);
console.log(`Unrealized P&L: $${summary.unrealizedPnl}`);
console.log(`With stop-loss: ${summary.withStopLoss}`);
console.log(`With take-profit: ${summary.withTakeProfit}`);
```

---

## Stop Types

| Type | Description |
|------|-------------|
| **Stop-Loss** | Exit when price drops to limit losses |
| **Take-Profit** | Exit when price rises to lock in gains |
| **Trailing Stop** | Dynamic stop that follows price up |
| **Break-Even** | Move stop to entry after profit target |

---

## Order Execution

| Option | Description |
|--------|-------------|
| `market` | Immediate execution at current price |
| `limit` | Execute at specified price or better |
| `buffer` | Add buffer to limit price for fills |

---

## Best Practices

1. **Always set stops** — Don't leave positions unprotected
2. **Use trailing stops** — Lock in gains as price moves
3. **Partial exits** — Scale out at multiple levels
4. **Monitor approaching** — Get alerts before triggers
5. **Review filled stops** — Check execution quality
