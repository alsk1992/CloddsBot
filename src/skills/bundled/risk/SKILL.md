---
name: risk
description: "Unified risk engine with VaR, stress testing, volatility regimes, and automated controls"
emoji: "🛑"
---

# Risk - Complete API Reference

Full risk management engine: circuit breakers, loss limits, Value-at-Risk, volatility regime detection, stress testing, and kill switches.

---

## Chat Commands

### View Risk Status

```
/risk                               Current risk status
/risk status                        Detailed status with portfolio metrics
/risk limits                        View all limits
/risk dashboard                     Real-time risk metrics (VaR, regime, HHI, etc.)
```

### Risk Analytics

```
/risk var                           Value-at-Risk and CVaR numbers
/risk regime                        Current volatility regime and size multiplier
/risk stress [scenario]             Run stress test (flash_crash, black_swan, etc.)
```

**Available stress scenarios:** `flash_crash`, `liquidity_crunch`, `platform_down`, `correlation_spike`, `black_swan`

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
/risk check 500                     Check if a $500 trade is allowed
```

---

## TypeScript API Reference

### Unified Risk Engine

The risk engine is the single entry point for all pre-trade validation. It orchestrates 10 checks in order:

1. Kill switch (SafetyManager)
2. Circuit breaker (execution-level)
3. Max order size
4. Exposure limits
5. Daily loss limit
6. Max drawdown
7. Position concentration
8. VaR limit
9. Volatility regime
10. Kelly sizing recommendation

```typescript
import { createRiskEngine } from 'clodds/risk';

const engine = createRiskEngine(
  {
    varLimit: 500,           // Reject trades if portfolio VaR > $500
    varConfidence: 0.95,
    varWindowSize: 100,
    volatilityConfig: {
      lookbackWindow: 30,
      haltOnExtreme: true,   // Stop trading in extreme volatility
    },
  },
  {
    riskContext,              // From trading/risk.ts
    safetyManager,           // From trading/safety.ts
    circuitBreaker,          // From execution/circuit-breaker.ts
    kellyCalculator,         // From trading/kelly.ts
    getPositions: () => positions,
    getPositionValues: () => positions.map(p => p.value),
  }
);
```

### Validate a Trade

```typescript
const decision = engine.validateTrade({
  userId: 'user-123',
  platform: 'polymarket',
  marketId: 'market-456',
  outcome: 'YES',
  side: 'buy',
  size: 500,
  price: 0.65,
  estimatedEdge: 0.05,    // 5% edge
  confidence: 0.8,
  category: 'politics',
});

if (decision.approved) {
  // Use adjustedSize — may be smaller than requested (Kelly + regime)
  await executeTrade(decision.adjustedSize);
  console.log(`Regime: ${decision.regime}`);
  console.log(`Warnings: ${decision.warnings}`);
} else {
  console.log(`Blocked: ${decision.reason}`);
  // Check which step failed:
  for (const check of decision.checks) {
    console.log(`  ${check.name}: ${check.passed ? 'PASS' : 'FAIL'} — ${check.message}`);
  }
}
```

### Record Trade P&L (feeds VaR + volatility)

```typescript
engine.recordPnL({
  pnlUsd: -45.20,
  pnlPct: -0.09,
  positionId: 'polymarket:market-456:YES',
  timestamp: new Date(),
});
```

### Portfolio Risk Snapshot

```typescript
const risk = engine.getPortfolioRisk();
console.log(`Total value: $${risk.totalValue}`);
console.log(`VaR (95%): $${risk.var95}`);
console.log(`VaR (99%): $${risk.var99}`);
console.log(`CVaR (95%): $${risk.cvar95}`);
console.log(`Regime: ${risk.regime}`);
console.log(`Drawdown: ${risk.drawdownPct}%`);
```

### Value-at-Risk

```typescript
import { createVaRCalculator, calculateVaR, calculateCVaR } from 'clodds/risk';

// Full calculator with rolling window
const calc = createVaRCalculator({ windowSize: 100, confidenceLevel: 0.95 });
calc.addObservation({ pnlUsd: -50, pnlPct: -0.05, timestamp: new Date() });
const result = calc.calculateAt(0.99);
console.log(`VaR (99%): $${result.historicalVaR}`);
console.log(`CVaR (99%): $${result.cvar}`);

// Quick one-liners
const var95 = calculateVaR(pnlArray, 0.95);
const cvar95 = calculateCVaR(pnlArray, 0.95);
```

### Volatility Regime Detection

```typescript
import { createVolatilityDetector, detectRegime } from 'clodds/risk';

const detector = createVolatilityDetector({
  lookbackWindow: 30,
  haltOnExtreme: false,
  regimeMultipliers: { low: 1.2, normal: 1.0, high: 0.5, extreme: 0.25 },
});

detector.addObservation(0.03);  // 3% P&L
const snapshot = detector.detect();
console.log(`Regime: ${snapshot.regime}`);          // 'low' | 'normal' | 'high' | 'extreme'
console.log(`Size multiplier: ${snapshot.sizeMultiplier}x`);
console.log(`Should halt: ${snapshot.shouldHalt}`);

// One-shot from array
const regime = detectRegime(recentPnLPcts);
```

### Stress Testing

```typescript
import { runStressTest, runAllScenarios, getAvailableScenarios } from 'clodds/risk';

const result = runStressTest(positions, 'flash_crash');
console.log(`Estimated loss: $${result.estimatedLoss} (${result.estimatedLossPct}%)`);
console.log(`Severity: ${result.severity}`);
console.log(`Recommendations: ${result.recommendations.join(', ')}`);

// Run all scenarios at once
const all = runAllScenarios(positions);  // sorted by severity

// Override scenario parameters
const custom = runStressTest(positions, 'flash_crash', {
  scenarios: { flash_crash: { lossPct: 30, description: 'Severe crash' } },
});
```

### Risk Dashboard

```typescript
import { getRiskDashboard } from 'clodds/risk';

const dashboard = engine.getDashboard();
console.log(`VaR (95%): $${dashboard.portfolioVaR95}`);
console.log(`Regime: ${dashboard.regime} (${dashboard.regimeSizeMultiplier}x)`);
console.log(`Daily P&L: $${dashboard.dailyPnL} / $${dashboard.dailyLossLimit}`);
console.log(`Drawdown: ${dashboard.currentDrawdown}% / ${dashboard.maxDrawdown}%`);
console.log(`Concentration HHI: ${dashboard.concentrationHHI}`);
console.log(`Kill switch: ${dashboard.killSwitchActive}`);
console.log(`Warnings: ${dashboard.warnings}`);
```

### Circuit Breaker (Standalone)

```typescript
import { createCircuitBreaker, MODERATE_CONFIG } from 'clodds/risk';

// Feature-engineering circuit breaker (market-condition-aware)
const breaker = createCircuitBreaker(MODERATE_CONFIG);
breaker.startMonitoring();

if (!breaker.canTrade('polymarket', marketId)) {
  return; // Trading halted
}

breaker.recordTrade({ success: true, pnl: 2.5 });
```

### Kill Switch

```typescript
// Emergency stop via SafetyManager — no auto-resume
safetyManager.killSwitch('Market anomaly detected');

// Resume manually after review
safetyManager.resumeTrading();
```

---

## Risk Engine Checks

| # | Check | Module | Blocks Trade? |
|---|-------|--------|---------------|
| 1 | Kill switch | SafetyManager | Yes |
| 2 | Circuit breaker | CircuitBreaker | Yes |
| 3 | Max order size | trading/risk | Yes |
| 4 | Exposure limits | trading/risk | Yes |
| 5 | Daily loss limit | SafetyManager | Yes |
| 6 | Max drawdown | SafetyManager | Yes |
| 7 | Concentration | SafetyManager | Yes |
| 8 | VaR limit | VaRCalculator | Yes (if configured) |
| 9 | Volatility regime | VolatilityDetector | Yes (if extreme + halt) |
| 10 | Kelly sizing | DynamicKelly | No (adjusts size) |

## Circuit Breaker Triggers

| Trigger | Default | Description |
|---------|---------|-------------|
| **Daily loss (USD)** | $1,000 | Absolute loss limit |
| **Daily loss (%)** | 10% | Percentage of capital |
| **Drawdown** | 20% | Peak-to-trough |
| **Consecutive losses** | 5 | Losses in a row |
| **Error rate** | 50% | Failed order rate |
| **Max trades** | 50 | Trades per day |

## Volatility Regimes

| Regime | Size Multiplier | Description |
|--------|----------------|-------------|
| `low` | 1.2x | Calm markets, slightly larger positions |
| `normal` | 1.0x | Baseline conditions |
| `high` | 0.5x | Elevated volatility, half size |
| `extreme` | 0.25x | Crisis — quarter size or halt trading |

## Stress Test Scenarios

| Scenario | Loss | Description |
|----------|------|-------------|
| `flash_crash` | 20% | All positions lose value instantly |
| `liquidity_crunch` | 10% | Slippage doubles, partial fills |
| `platform_down` | 15% | Primary platform offline |
| `correlation_spike` | 25% | All positions move together |
| `black_swan` | 40% | 3-sigma tail event |

## Status Levels

| Status | Description |
|--------|-------------|
| `armed` | Normal, trading allowed |
| `warning` | Approaching limits (80%) |
| `tripped` | Limit exceeded, trading stopped |
| `killed` | Emergency stop, manual reset required |

---

## Recovery Process

1. **Auto-reset**: Next day at midnight (daily counters)
2. **Cooldown**: Circuit breaker auto-resets after cooldown period
3. **Manual reset**: `/risk reset` to re-arm
4. **Kill recovery**: `/risk reset` after manual review (no auto-resume)

---

## Best Practices

1. **Start conservative** — Lower limits while learning
2. **Don't override** — Respect the circuit breaker
3. **Review trips** — Understand why limits were hit
4. **Monitor VaR** — Use `/risk var` and `/risk dashboard` regularly
5. **Run stress tests** — Use `/risk stress` before large position changes
6. **Watch regime** — Use `/risk regime` to understand current volatility
7. **Adjust limits** — Based on strategy performance and regime
