---
name: risk
description: "Circuit breaker, loss limits, and automated risk controls"
emoji: "🛑"
---

# Risk - Complete API Reference

Automatic risk management with circuit breakers, loss limits, and kill switches.

---

## Chat Commands

### View Risk Status

```
/risk                               Current risk status
/risk status                        Detailed status
/risk limits                        View all limits
```

### Configure Limits

```
/risk set max-loss 1000             Max daily loss ($)
/risk set max-loss-pct 10           Max daily loss (%)
/risk set max-drawdown 20           Max drawdown (%)
/risk set max-position 25           Max single position (%)
/risk set max-trades 50             Max trades per day
/risk set consecutive-losses 5      Stop after N losses
```

### Circuit Breaker

```
/risk trip "manual stop"            Manually trip breaker
/risk reset                         Reset after cooldown
/risk kill                          Emergency stop all trading
```

---

## TypeScript API Reference

### Create Risk Manager

```typescript
import { createRiskManager } from 'clodds/risk';

const risk = createRiskManager({
  // Loss limits
  maxDailyLossUsd: 1000,
  maxDailyLossPct: 10,
  maxDrawdownPct: 20,

  // Position limits
  maxPositionPct: 25,
  maxTotalExposure: 80,

  // Trade limits
  maxTradesPerDay: 50,
  maxConsecutiveLosses: 5,

  // Error handling
  maxErrorRate: 50,  // % of failed orders

  // Cooldown
  cooldownMinutes: 60,
  autoResetHour: 0,  // Reset at midnight

  // Storage
  storage: 'sqlite',
  dbPath: './risk.db',
});
```

### Check Before Trade

```typescript
// Check if trade is allowed
const check = await risk.checkTrade({
  size: 500,
  platform: 'polymarket',
  market: 'trump-2028',
});

if (check.allowed) {
  // Execute trade
  await executeTrade();
} else {
  console.log(`Blocked: ${check.reason}`);
  // 'max_daily_loss_exceeded'
  // 'max_position_exceeded'
  // 'circuit_breaker_tripped'
  // 'max_trades_exceeded'
}
```

### Record Trade Result

```typescript
// Record winning trade
await risk.recordTrade({
  pnl: 150,
  platform: 'polymarket',
  market: 'trump-2028',
});

// Record losing trade
await risk.recordTrade({
  pnl: -200,
  platform: 'polymarket',
  market: 'fed-rate',
});

// System checks limits automatically after each trade
```

### Get Status

```typescript
const status = await risk.getStatus();

console.log('=== Daily Stats ===');
console.log(`P&L today: $${status.dailyPnl}`);
console.log(`Trades today: ${status.tradesToday}`);
console.log(`Win rate: ${status.winRate}%`);

console.log('=== Limits ===');
console.log(`Daily loss: $${Math.abs(status.dailyPnl)}/$${status.maxDailyLoss}`);
console.log(`Drawdown: ${status.currentDrawdown}%/${status.maxDrawdown}%`);
console.log(`Consecutive losses: ${status.consecutiveLosses}/${status.maxConsecutiveLosses}`);

console.log('=== Status ===');
console.log(`Circuit breaker: ${status.circuitBreaker}`);  // 'armed' | 'tripped'
console.log(`Trading allowed: ${status.tradingAllowed}`);
```

### Circuit Breaker

```typescript
// Manually trip breaker
await risk.trip('Market too volatile');

// Check if tripped
const tripped = risk.isTripped();

// Get trip reason
const reason = risk.getTripReason();

// Reset (after cooldown)
await risk.reset();

// Force reset (admin)
await risk.forceReset();
```

### Kill Switch

```typescript
// Emergency stop - cancels all orders, closes positions
await risk.kill();

// This will:
// 1. Cancel all open orders
// 2. Close all positions (market orders)
// 3. Trip circuit breaker
// 4. Disable all trading
// 5. Send alert to all channels
```

### Event Handlers

```typescript
// Circuit breaker tripped
risk.on('tripped', (reason, stats) => {
  console.log(`🛑 Circuit breaker tripped: ${reason}`);
  console.log(`Daily P&L: $${stats.dailyPnl}`);
  // Send alert
});

// Approaching limits
risk.on('warning', (type, current, limit) => {
  console.log(`⚠️ Warning: ${type} at ${current}/${limit}`);
});

// Daily reset
risk.on('reset', () => {
  console.log('✅ Daily risk counters reset');
});
```

### Configure Limits

```typescript
// Update limits
risk.setLimits({
  maxDailyLossUsd: 2000,
  maxConsecutiveLosses: 3,
});

// Get current limits
const limits = risk.getLimits();
```

---

## Circuit Breaker Triggers

| Trigger | Default | Description |
|---------|---------|-------------|
| **Daily loss (USD)** | $1,000 | Absolute loss limit |
| **Daily loss (%)** | 10% | Percentage of capital |
| **Drawdown** | 20% | Peak-to-trough |
| **Consecutive losses** | 5 | Losses in a row |
| **Error rate** | 50% | Failed order rate |
| **Max trades** | 50 | Trades per day |

---

## Status Levels

| Status | Description |
|--------|-------------|
| `armed` | Normal, trading allowed |
| `warning` | Approaching limits (80%) |
| `tripped` | Limit exceeded, trading stopped |
| `killed` | Emergency stop, manual reset required |

---

## Recovery Process

1. **Auto-reset**: Next day at configured hour (default midnight)
2. **Manual reset**: `/risk reset` after cooldown period
3. **Force reset**: Admin can force reset anytime
4. **Kill recovery**: Requires explicit `/risk unkill`

---

## Best Practices

1. **Start conservative** — Lower limits while learning
2. **Don't override** — Respect the circuit breaker
3. **Review trips** — Understand why limits were hit
4. **Adjust limits** — Based on strategy performance
5. **Test kill switch** — Know how to stop everything
