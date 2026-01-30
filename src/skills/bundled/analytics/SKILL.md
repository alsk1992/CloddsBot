---
name: analytics
description: "Performance attribution, trade analytics, and strategy optimization"
emoji: "📊"
---

# Analytics - Complete API Reference

Analyze trading performance with attribution by edge source, time-of-day analysis, and optimization insights.

---

## Chat Commands

### Performance Overview

```
/analytics                          Performance summary
/analytics today                    Today's performance
/analytics week                     Weekly breakdown
/analytics month                    Monthly breakdown
```

### Attribution

```
/analytics attribution              P&L by edge source
/analytics by-platform              P&L by platform
/analytics by-category              P&L by market category
/analytics by-strategy              P&L by strategy
```

### Time Analysis

```
/analytics best-times               Best trading hours
/analytics by-hour                  Hourly performance
/analytics by-day                   Day of week analysis
```

### Edge Analysis

```
/analytics edge-decay               How edge decays over time
/analytics edge-buckets             Performance by edge size
/analytics liquidity                Performance by liquidity
```

---

## TypeScript API Reference

### Create Analytics Service

```typescript
import { createAnalyticsService } from 'clodds/analytics';

const analytics = createAnalyticsService({
  // Data source
  tradesDb: './trades.db',

  // Time zone
  timezone: 'America/New_York',
});
```

### Performance Summary

```typescript
const summary = await analytics.getSummary({
  period: 'month',
  // or: from: '2024-01-01', to: '2024-01-31'
});

console.log('=== Performance ===');
console.log(`Total P&L: $${summary.totalPnl}`);
console.log(`Win Rate: ${summary.winRate}%`);
console.log(`Profit Factor: ${summary.profitFactor}`);
console.log(`Sharpe Ratio: ${summary.sharpeRatio}`);
console.log(`Total Trades: ${summary.totalTrades}`);
console.log(`Avg Trade: $${summary.avgTrade}`);
console.log(`Best Trade: $${summary.bestTrade}`);
console.log(`Worst Trade: $${summary.worstTrade}`);
```

### Attribution by Edge Source

```typescript
const attribution = await analytics.getAttribution('edgeSource');

for (const source of attribution) {
  console.log(`${source.name}:`);
  console.log(`  P&L: $${source.pnl}`);
  console.log(`  Trades: ${source.trades}`);
  console.log(`  Win Rate: ${source.winRate}%`);
  console.log(`  Contribution: ${source.contribution}%`);
}

// Example sources:
// - price_lag (stale prices)
// - liquidity_gap (thin orderbooks)
// - information (news/events)
// - model_edge (external models)
// - combinatorial (arbitrage)
```

### Time-of-Day Analysis

```typescript
const hourly = await analytics.getHourlyPerformance();

console.log('Best Hours:');
for (const hour of hourly.slice(0, 3)) {
  console.log(`  ${hour.hour}:00 - Win: ${hour.winRate}%, Avg: $${hour.avgPnl}`);
}

console.log('Worst Hours:');
for (const hour of hourly.slice(-3)) {
  console.log(`  ${hour.hour}:00 - Win: ${hour.winRate}%, Avg: $${hour.avgPnl}`);
}
```

### Day-of-Week Analysis

```typescript
const daily = await analytics.getDayOfWeekPerformance();

for (const day of daily) {
  console.log(`${day.name}: $${day.pnl} (${day.trades} trades, ${day.winRate}% win)`);
}
```

### Edge Decay Analysis

```typescript
const decay = await analytics.getEdgeDecay();

console.log('Edge Decay (how fast edge disappears):');
for (const bucket of decay) {
  console.log(`  ${bucket.holdTime}: ${bucket.avgReturn}% return`);
}
// Shows optimal hold time before edge decays
```

### Edge Size Buckets

```typescript
const edgeBuckets = await analytics.getEdgeBuckets();

for (const bucket of edgeBuckets) {
  console.log(`Edge ${bucket.min}-${bucket.max}%:`);
  console.log(`  Trades: ${bucket.trades}`);
  console.log(`  Win Rate: ${bucket.winRate}%`);
  console.log(`  Avg P&L: $${bucket.avgPnl}`);
  console.log(`  Realized Edge: ${bucket.realizedEdge}%`);
}
```

### Liquidity Analysis

```typescript
const liquidity = await analytics.getLiquidityAnalysis();

for (const bucket of liquidity) {
  console.log(`${bucket.name} liquidity:`);
  console.log(`  Trades: ${bucket.trades}`);
  console.log(`  Avg Slippage: ${bucket.avgSlippage}%`);
  console.log(`  Fill Rate: ${bucket.fillRate}%`);
  console.log(`  Avg P&L: $${bucket.avgPnl}`);
}
```

### Execution Quality

```typescript
const execution = await analytics.getExecutionQuality();

console.log('=== Execution Quality ===');
console.log(`Avg Slippage: ${execution.avgSlippage}%`);
console.log(`Fill Rate: ${execution.fillRate}%`);
console.log(`Avg Fill Time: ${execution.avgFillTimeMs}ms`);
console.log(`Partial Fills: ${execution.partialFillRate}%`);
console.log(`Rejected Orders: ${execution.rejectionRate}%`);
```

### Platform Comparison

```typescript
const platforms = await analytics.getPlatformComparison();

for (const platform of platforms) {
  console.log(`${platform.name}:`);
  console.log(`  P&L: $${platform.pnl}`);
  console.log(`  Win Rate: ${platform.winRate}%`);
  console.log(`  Avg Slippage: ${platform.avgSlippage}%`);
  console.log(`  Best For: ${platform.strengths.join(', ')}`);
}
```

### Export Report

```typescript
// Generate PDF report
await analytics.exportReport({
  format: 'pdf',
  period: 'month',
  include: ['summary', 'attribution', 'charts'],
  outputPath: './reports/january-2024.pdf',
});

// Export raw data
await analytics.exportData({
  format: 'csv',
  period: 'month',
  outputPath: './data/january-trades.csv',
});
```

---

## Attribution Categories

| Category | Description |
|----------|-------------|
| **Edge Source** | Where the edge came from |
| **Platform** | Which platform traded on |
| **Category** | Market category (politics, crypto) |
| **Strategy** | Which strategy generated trade |
| **Time** | Hour/day of trade |
| **Size** | Trade size bucket |

---

## Key Metrics

| Metric | Good Value | Description |
|--------|------------|-------------|
| **Win Rate** | > 50% | Percent of winning trades |
| **Profit Factor** | > 1.5 | Gross profit / gross loss |
| **Sharpe Ratio** | > 1.0 | Risk-adjusted returns |
| **Realized Edge** | > 0 | Actual vs expected edge |
| **Fill Rate** | > 95% | Orders fully filled |

---

## Best Practices

1. **Review weekly** — Catch problems early
2. **Track attribution** — Know where profits come from
3. **Optimize timing** — Trade your best hours
4. **Monitor edge decay** — Don't hold too long
5. **Check execution** — Slippage kills edge
