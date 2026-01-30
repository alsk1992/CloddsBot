---
name: sizing
description: "Position sizing with Kelly criterion and bankroll management"
emoji: "📐"
---

# Sizing - Complete API Reference

Calculate optimal position sizes using Kelly criterion, fractional Kelly, and portfolio-level allocation.

---

## Chat Commands

### Kelly Calculator

```
/kelly 0.45 0.55 10000              Market price, your prob, bankroll
/kelly "Trump 2028" 0.55 --bank 10k Calculate for specific market
/kelly --half 0.45 0.55 10000       Half Kelly (safer)
/kelly --quarter 0.45 0.55 10000    Quarter Kelly (conservative)
```

### Position Sizing

```
/size 10000 --risk 2%               Size for 2% risk per trade
/size 10000 --max-position 25%      Max 25% in single position
/size portfolio --rebalance         Rebalance to target weights
```

### Edge Calculation

```
/edge 0.45 0.55                     Calculate edge (prob - price)
/edge "Trump 2028" --estimate 0.55  Edge vs market price
```

---

## TypeScript API Reference

### Create Sizing Calculator

```typescript
import { createSizingCalculator } from 'clodds/sizing';

const sizing = createSizingCalculator({
  // Bankroll
  bankroll: 10000,

  // Kelly fraction (1 = full, 0.5 = half)
  kellyFraction: 0.5,

  // Limits
  maxPositionPercent: 25,
  maxTotalExposure: 80,
});
```

### Basic Kelly

```typescript
// Binary outcome (YES/NO market)
const size = sizing.kelly({
  marketPrice: 0.45,        // Current price
  estimatedProb: 0.55,      // Your probability estimate
  bankroll: 10000,
});

console.log(`Optimal bet: $${size.optimalSize}`);
console.log(`Edge: ${size.edge}%`);
console.log(`Kelly %: ${size.kellyPercent}%`);
console.log(`Expected value: $${size.expectedValue}`);
```

### Fractional Kelly

```typescript
// Half Kelly (recommended for most traders)
const halfKelly = sizing.kelly({
  marketPrice: 0.45,
  estimatedProb: 0.55,
  bankroll: 10000,
  fraction: 0.5,  // Half Kelly
});

// Quarter Kelly (very conservative)
const quarterKelly = sizing.kelly({
  marketPrice: 0.45,
  estimatedProb: 0.55,
  bankroll: 10000,
  fraction: 0.25,
});

console.log(`Full Kelly: $${sizing.kelly({...}).optimalSize}`);
console.log(`Half Kelly: $${halfKelly.optimalSize}`);
console.log(`Quarter Kelly: $${quarterKelly.optimalSize}`);
```

### Multi-Outcome Kelly

```typescript
// For markets with 3+ outcomes
const multiKelly = sizing.kellyMultiOutcome({
  outcomes: [
    { name: 'Trump', price: 0.35, estimatedProb: 0.40 },
    { name: 'DeSantis', price: 0.25, estimatedProb: 0.20 },
    { name: 'Haley', price: 0.15, estimatedProb: 0.15 },
    { name: 'Other', price: 0.25, estimatedProb: 0.25 },
  ],
  bankroll: 10000,
  fraction: 0.5,
});

for (const alloc of multiKelly.allocations) {
  console.log(`${alloc.name}: $${alloc.size} (${alloc.percent}%)`);
}
```

### Portfolio-Level Kelly

```typescript
// Optimal allocation across multiple markets
const portfolio = sizing.kellyPortfolio({
  positions: [
    { market: 'Trump 2028', price: 0.45, prob: 0.55 },
    { market: 'Fed Rate Cut', price: 0.60, prob: 0.70 },
    { market: 'BTC > 100k', price: 0.30, prob: 0.40 },
  ],
  bankroll: 10000,
  correlations: correlationMatrix,  // Optional
  fraction: 0.5,
});

console.log('Optimal Portfolio:');
for (const pos of portfolio.positions) {
  console.log(`  ${pos.market}: $${pos.size}`);
}
console.log(`Total exposure: ${portfolio.totalExposure}%`);
```

### Confidence-Adjusted Sizing

```typescript
// Reduce size when less confident
const size = sizing.kellyWithConfidence({
  marketPrice: 0.45,
  estimatedProb: 0.55,
  confidence: 0.7,  // 70% confident in estimate
  bankroll: 10000,
});

// Size is reduced proportionally to confidence
console.log(`Confidence-adjusted size: $${size.optimalSize}`);
```

### Edge Calculation

```typescript
// Calculate edge
const edge = sizing.calculateEdge({
  marketPrice: 0.45,
  estimatedProb: 0.55,
});

console.log(`Edge: ${edge.edgePercent}%`);
console.log(`EV per dollar: $${edge.evPerDollar}`);
console.log(`Implied odds: ${edge.impliedOdds}`);
console.log(`True odds: ${edge.trueOdds}`);
```

### Risk-Based Sizing

```typescript
// Size based on risk per trade
const size = sizing.riskBased({
  bankroll: 10000,
  riskPercent: 2,     // Risk 2% per trade
  stopLossPercent: 10, // 10% stop loss
});

console.log(`Position size: $${size.positionSize}`);
console.log(`Max loss: $${size.maxLoss}`);
```

---

## Kelly Fractions

| Fraction | Risk Level | Use Case |
|----------|------------|----------|
| **Full (1.0)** | Aggressive | Mathematical optimum, high variance |
| **Half (0.5)** | Moderate | Most traders, good balance |
| **Quarter (0.25)** | Conservative | New traders, uncertain edges |
| **Tenth (0.1)** | Very Safe | Learning, small edges |

---

## Edge Requirements

| Edge | Recommendation |
|------|----------------|
| < 2% | Don't trade |
| 2-5% | Small size (quarter Kelly) |
| 5-10% | Normal size (half Kelly) |
| 10%+ | Larger size, verify edge |

---

## Formulas

### Kelly Formula
```
f* = (p * b - q) / b

Where:
f* = fraction of bankroll to bet
p = probability of winning
q = probability of losing (1 - p)
b = odds received (1/price - 1)
```

### Edge Formula
```
Edge = Estimated Prob - Market Price
EV = Edge * Bet Size
```

---

## Best Practices

1. **Use fractional Kelly** — Full Kelly has too much variance
2. **Be conservative on edge** — Overconfidence kills accounts
3. **Account for correlation** — Don't over-expose to same theme
4. **Set max position** — Never more than 25% in one market
5. **Reassess regularly** — Edge changes as prices move
