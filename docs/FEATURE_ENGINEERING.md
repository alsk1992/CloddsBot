# Feature Engineering Integration

This document describes how the feature engineering service integrates with trading executors and how to use it for signal-based trading decisions.

## Overview

The feature engineering service computes real-time trading indicators from tick and orderbook data:

- **Tick Features**: price, momentum, volatility, tick intensity
- **Orderbook Features**: spread, depth, imbalance, liquidity
- **Derived Signals**: buy pressure, sell pressure, trend strength, liquidity score

## Architecture

```
Feed Events ──► FeatureEngineering ──┬──► Arbitrage Executor
                     │               ├──► Copy Trading
                     │               ├──► Smart Router
                     │               └──► CLI Skill (/features)
                     │
                     └──► REST API (/api/features)
```

## Accessing Features

### From Trading Modules

```typescript
import {
  getMarketFeatures,
  checkLiquidity,
  checkSpread,
  isArbitrageReady,
  isHighVolatility,
} from '../services/feature-engineering';

// Get features for a market
const features = getMarketFeatures('polymarket', marketId, outcomeId);

// Check if conditions are suitable for trading
if (features && !checkLiquidity(features, 0.3)) {
  console.log('Low liquidity - skip trading');
}

if (features && isHighVolatility(features, 5.0)) {
  console.log('High volatility - widen stops');
}
```

### From REST API

```bash
# Get features for specific market
curl http://localhost:3000/api/features/polymarket/0x1234

# Get all tracked markets
curl http://localhost:3000/api/features

# Get service stats
curl http://localhost:3000/api/features/stats
```

### From CLI

```bash
# Get features for a market
/features get polymarket 0x1234abcd

# Get trading signals
/features signals polymarket 0x1234abcd

# List all tracked markets
/features all

# Get service stats
/features stats
```

## Integration with Trading Executors

### Arbitrage Executor

The arbitrage executor uses features to filter opportunities before execution:

```yaml
# config.yaml
arbitrageExecution:
  enabled: true
  useFeatureFilters: true  # Enable feature-based filtering
  featureThresholds:
    minLiquidityScore: 0.3
    maxSpreadPct: 2.0
```

When `useFeatureFilters` is enabled, opportunities are skipped if:
- Market liquidity score is below threshold
- Spread is too wide

Logs will show: `Skip arb: market conditions unfavorable`

### Copy Trading

Copy trading uses features to avoid copying into unfavorable markets:

```yaml
# config.yaml
copyTrading:
  enabled: true
  useFeatureFilters: true    # Enable feature-based filtering
  maxVolatility: 10.0        # Don't copy into volatile markets
  minLiquidityScore: 0.2     # Minimum liquidity required
  maxSpreadPct: 3.0          # Maximum spread allowed
```

Trades are skipped if market conditions are unfavorable:
- `high_volatility (X% > maxVolatility%)`
- `low_liquidity (X < minLiquidityScore)`
- `wide_spread (X% > maxSpreadPct%)`

### Smart Router

The smart router uses features to score routes in balanced mode:

```yaml
# config.yaml
smartRouting:
  enabled: true
  mode: balanced
  useFeatureScoring: true    # Use feature data for scoring
  liquidityWeight: 0.2       # Weight for liquidity in scoring
```

Routes are scored using:
- Net price (50%)
- Available size (30%)
- Fees (20%)
- **Liquidity score** (configurable weight)
- Spread penalty

## Threshold Helpers

The `thresholds.ts` module provides helper functions:

### Basic Checks

```typescript
// Liquidity check (returns true if sufficient)
checkLiquidity(features, minScore);  // default: 0.3

// Volatility range check
checkVolatility(features, minPct, maxPct);  // default: 0.1, 5.0

// Spread check
checkSpread(features, maxPct);  // default: 2.0

// High volatility detection
isHighVolatility(features, maxPct);  // default: 5.0
```

### Signal Checks

```typescript
// Check buy/sell pressure
checkBuyPressure(features, minPressure);   // default: 0.4
checkSellPressure(features, minPressure);  // default: 0.4

// Check trend strength
checkTrendStrength(features, minStrength);  // default: 0.3

// Get trend direction
getTrendDirection(features);  // 'bullish' | 'bearish' | 'neutral'
```

### Composite Checks

```typescript
// Comprehensive market condition check
const result = checkMarketConditions(features, {
  minLiquidityScore: 0.3,
  maxSpreadPct: 2.0,
  maxVolatilityPct: 5.0,
});
// { tradeable: true, reasons: [], score: 100 }
// { tradeable: false, reasons: ['low_liquidity'], score: 70 }

// Quick arbitrage readiness check
isArbitrageReady(features);  // liquidity + spread check

// Check if conditions favor a trade direction
favorsTrade(features, 'buy');   // checks buy pressure
favorsTrade(features, 'sell');  // checks sell pressure
```

### Adaptive Risk Management

```typescript
// Widen stop loss based on volatility
const stop = adaptiveStopLoss(baseStopPct, features, multiplier);

// Adjust take profit based on trend + volatility
const tp = adaptiveTakeProfit(baseTpPct, features, multiplier);
```

## Default Thresholds

| Threshold | Default | Description |
|-----------|---------|-------------|
| minLiquidityScore | 0.3 | Minimum liquidity score [0, 1] |
| maxVolatilityPct | 5.0 | Maximum volatility % |
| minVolatilityPct | 0.1 | Minimum volatility % |
| maxSpreadPct | 2.0 | Maximum spread % |
| minTrendStrength | 0.3 | Minimum trend strength [-1, 1] |
| minBuyPressure | 0.4 | Minimum buy pressure [0, 1] |
| minSellPressure | 0.4 | Minimum sell pressure [0, 1] |
| minImbalanceRatio | 1.5 | Minimum imbalance ratio |
| minTickIntensity | 0.1 | Minimum ticks per second |

## Fallback Behavior

All feature checks are designed to **not block** trading when data is unavailable:

- If features are `null`, checks return `true` (proceed)
- This ensures trading continues even without feature data
- Configure logging to debug mode to see when features cause skips

## Debugging

Enable debug logging to see feature-based decisions:

```bash
LOG_LEVEL=debug npm start
```

Look for log messages:
- `Skip arb: market conditions unfavorable`
- `Skip copy: market too volatile`
- `Skip copy: low liquidity`
- `Skip copy: wide spread`

## Configuration Reference

### Full config.yaml example

```yaml
# Feature engineering is always enabled (computed from feed data)

arbitrageExecution:
  enabled: true
  useFeatureFilters: true
  featureThresholds:
    minLiquidityScore: 0.3
    maxSpreadPct: 2.0

copyTrading:
  enabled: true
  useFeatureFilters: true
  maxVolatility: 10.0
  minLiquidityScore: 0.2
  maxSpreadPct: 3.0

smartRouting:
  enabled: true
  mode: balanced
  useFeatureScoring: true
  liquidityWeight: 0.2
```

## API Reference

See [API.md](./API.md) for full REST endpoint documentation:
- `GET /api/features/:platform/:marketId`
- `GET /api/features`
- `GET /api/features/stats`
