# Risk Management

Unified risk management system for trading operations. All pre-trade validation flows through a single `RiskEngine` that orchestrates circuit breakers, exposure limits, VaR, volatility regime detection, stress testing, and Kelly sizing.

## Architecture

```
src/risk/
├── engine.ts          # Unified risk engine (validateTrade entry point)
├── var.ts             # Value-at-Risk and CVaR (Expected Shortfall)
├── volatility.ts      # Volatility regime detection (low/normal/high/extreme)
├── stress.ts          # Stress testing (flash crash, black swan, etc.)
├── dashboard.ts       # Real-time risk metrics aggregation
├── circuit-breaker.ts # Feature-engineering circuit breaker (market-aware)
└── index.ts           # Barrel exports

src/execution/
└── circuit-breaker.ts # Execution-level circuit breaker (trade-result-based)

src/trading/
├── risk.ts            # Max order size + exposure limit enforcement
├── safety.ts          # Daily loss, drawdown, correlation, kill switch (SQLite)
└── kelly.ts           # Dynamic Kelly criterion position sizing
```

## Risk Engine

The `createRiskEngine()` factory produces a single `validateTrade()` entry point that runs 10 checks in order:

| # | Check | Source | Blocking? |
|---|-------|--------|-----------|
| 1 | Kill switch | SafetyManager | Yes |
| 2 | Circuit breaker | CircuitBreaker | Yes |
| 3 | Max order size | trading/risk | Yes |
| 4 | Exposure limits | trading/risk | Yes |
| 5 | Daily loss / drawdown / concentration | SafetyManager | Yes |
| 6 | VaR limit | VaRCalculator | Yes (if configured) |
| 7 | Volatility regime | VolatilityDetector | Yes (if extreme + halt) |
| 8 | Kelly sizing | DynamicKelly | No (adjusts size) |

```typescript
import { createRiskEngine } from '../risk';

const engine = createRiskEngine(
  { varLimit: 500, varConfidence: 0.95, volatilityConfig: { haltOnExtreme: true } },
  { riskContext, safetyManager, circuitBreaker, kellyCalculator, getPositions, getPositionValues }
);

const decision = engine.validateTrade({ userId, platform: 'polymarket', size: 500, price: 0.65, side: 'buy' });
if (decision.approved) {
  executeTrade(decision.adjustedSize); // Kelly + regime adjusted
}
```

## Value-at-Risk (VaR)

Historical and parametric VaR with CVaR (Expected Shortfall).

```typescript
import { createVaRCalculator, calculateVaR, calculateCVaR } from '../risk';

const calc = createVaRCalculator({ windowSize: 100 });
calc.addObservation({ pnlUsd: -50, pnlPct: -0.05, timestamp: new Date() });

const var95 = calc.calculateAt(0.95);
// { historicalVaR, parametricVaR, cvar, sampleSize, meanPnL, stdDev }

const posVaR = calc.positionVaR(); // Per-position VaR with contribution %
```

## Volatility Regime Detection

Classifies conditions into 4 regimes with position size multipliers:

| Regime | Multiplier | Description |
|--------|-----------|-------------|
| `low` | 1.2x | Calm markets |
| `normal` | 1.0x | Baseline |
| `high` | 0.5x | Elevated volatility |
| `extreme` | 0.25x | Crisis — halt or quarter size |

```typescript
import { createVolatilityDetector, detectRegime } from '../risk';

const detector = createVolatilityDetector({ lookbackWindow: 30, haltOnExtreme: true });
detector.addObservation(0.03); // 3% P&L
const snap = detector.detect(); // { regime, sizeMultiplier, shouldHalt, rollingStdDev, atr }
```

## Stress Testing

5 predefined scenarios plus custom:

| Scenario | Loss | Description |
|----------|------|-------------|
| `flash_crash` | 20% | Instant price decline |
| `liquidity_crunch` | 10% | Slippage doubles |
| `platform_down` | 15% | Primary platform offline |
| `correlation_spike` | 25% | Diversification vanishes |
| `black_swan` | 40% | 3-sigma tail event |

```typescript
import { runStressTest, runAllScenarios } from '../risk';

const result = runStressTest(positions, 'black_swan');
// { estimatedLoss, estimatedLossPct, severity, recommendations, mostAffected }

const all = runAllScenarios(positions); // All 5, sorted by severity
```

## Circuit Breaker (Feature-Engineering)

Market-condition-aware circuit breaker using feature engineering data (volatility, liquidity, spread).

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

```typescript
import { createCircuitBreaker, MODERATE_CONFIG } from '../risk';

const breaker = createCircuitBreaker(MODERATE_CONFIG);
breaker.startMonitoring();

if (!breaker.canTrade('polymarket', marketId)) {
  return; // Trading halted
}
breaker.recordTrade({ success: true, pnl: 2.5 });
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

## Risk Dashboard

Aggregates all subsystem metrics into a single snapshot:

```typescript
const dashboard = engine.getDashboard();
// {
//   portfolioVaR95, portfolioVaR99, cvar95,
//   regime, regimeSizeMultiplier,
//   circuitBreakerTripped, circuitBreakerReason,
//   dailyPnL, dailyLossLimit, dailyLossUtilization,
//   maxDrawdown, currentDrawdown,
//   openPositions, concentrationHHI,
//   killSwitchActive, kellyFraction,
//   warnings, timestamp,
// }
```

## CLI Commands

```
/risk                    Status overview
/risk status             Detailed status with portfolio metrics
/risk limits             View all configured limits
/risk dashboard          Full dashboard (VaR, regime, HHI, etc.)
/risk var                VaR / CVaR numbers
/risk regime             Current volatility regime
/risk stress [scenario]  Run stress test
/risk set <param> <val>  Configure a limit
/risk check <notional>   Check if a trade is allowed
/risk trip "reason"      Manually trip circuit breaker
/risk reset              Reset circuit breaker
/risk kill               Emergency stop all trading
```
