# Risk Management

Risk management tools for trading operations.

## Circuit Breaker

Halts trading when market conditions become unfavorable using feature engineering data.

### Quick Start

```typescript
import { createCircuitBreaker, MODERATE_CONFIG } from '../risk';

const breaker = createCircuitBreaker(MODERATE_CONFIG);
breaker.startMonitoring();

// Check before trading
if (!breaker.canTrade('polymarket', marketId)) {
  return; // Trading halted
}

// Record results
breaker.recordTrade({ success: true, pnl: 2.5 });
```

### Trip Conditions

| Type | Description | Example |
|------|-------------|---------|
| volatility | Trips on high volatility | `{ type: 'volatility', maxVolatilityPct: 10, scope: 'market' }` |
| liquidity | Trips on low liquidity | `{ type: 'liquidity', minLiquidityScore: 0.3, scope: 'market' }` |
| loss | Trips on cumulative loss | `{ type: 'loss', maxLossPct: 5, window: 'daily' }` |
| failures | Trips on consecutive failures | `{ type: 'failures', maxConsecutive: 5 }` |
| spread | Trips on wide spread | `{ type: 'spread', maxSpreadPct: 3, scope: 'market' }` |

### Presets

- **CONSERVATIVE_CONFIG**: Low thresholds, manual reset (capital preservation)
- **MODERATE_CONFIG**: Balanced thresholds, auto-reset (normal trading)
- **AGGRESSIVE_CONFIG**: High thresholds, quick reset (risk-tolerant)

### Integration with Executor

```typescript
const circuitBreaker = createCircuitBreaker(MODERATE_CONFIG);
circuitBreaker.startMonitoring();

const executor = createOpportunityExecutor(finder, execution, {
  circuitBreaker,
  // ... other config
});
```

### Events

```typescript
breaker.on('tripped', (event) => {
  console.log('Tripped:', event.condition.type, event.details);
});

breaker.on('reset', (manual) => {
  console.log('Reset:', manual ? 'manual' : 'auto');
});
```

### Manual Controls

```typescript
breaker.trip('Manual halt for maintenance');
breaker.reset();
```
