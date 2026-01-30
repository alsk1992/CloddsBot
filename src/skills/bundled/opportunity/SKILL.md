---
name: opportunity
description: "Find and execute cross-platform arbitrage opportunities across prediction markets"
emoji: "🎯"
gates:
  envs:
    anyOf:
      - POLY_API_KEY
      - KALSHI_API_KEY
---

# Opportunity Finder - Complete API Reference

Discover and execute cross-platform arbitrage opportunities across Polymarket, Kalshi, Betfair, Smarkets, Manifold, Metaculus, PredictIt, and Drift.

Based on [arXiv:2508.03474](https://arxiv.org/abs/2508.03474) which found **$40M+ in realized arbitrage** on Polymarket.

## Opportunity Types

| Type | Description | Example |
|------|-------------|---------|
| **Internal** | YES + NO < $1 on same platform | Buy both for guaranteed profit |
| **Cross-Platform** | Same market priced differently | Buy low on A, sell high on B |
| **Combinatorial** | Logical violations (P(A) > P(B) when A implies B) | Trump > Republican |
| **Edge** | Market vs external model (538, polls) | Market 45%, model 52% |

---

## Chat Commands

### Scanning

```
/opportunities scan                         # Scan all platforms for opportunities
/opportunities scan "trump"                 # Scan with keyword filter
/opportunities scan --min-edge 2            # Min 2% edge
/opportunities scan --min-liquidity 1000    # Min $1000 liquidity

/opportunities active                       # View active opportunities
/opportunities active --sort edge           # Sort by edge size
/opportunities active --sort liquidity      # Sort by liquidity
```

### Real-Time Monitoring

```
/opportunities realtime start               # Start continuous scanning
/opportunities realtime stop                # Stop scanning
/opportunities realtime status              # Check monitoring status
/opportunities realtime config --interval 30 # Set scan interval (seconds)
```

### Market Linking

```
/opportunities link <market-a> <market-b>   # Manually link equivalent markets
/opportunities unlink <market-a> <market-b> # Remove link
/opportunities links                        # View all linked markets
/opportunities auto-match                   # Run auto-matching algorithm
```

### Execution

```
/opportunities execute <id>                 # Execute an opportunity
/opportunities execute <id> --size 100      # Execute with $100 size
/opportunities mark-taken <id>              # Mark as taken (manual)
/opportunities record-outcome <id> <pnl>    # Record P&L outcome
```

### Analytics

```
/opportunities stats                        # Performance statistics
/opportunities stats --period 7d            # Last 7 days
/opportunities history                      # Past opportunities
/opportunities by-platform                  # Stats by platform pair
/opportunities by-type                      # Stats by opportunity type
```

### Risk Modeling

```
/opportunities risk <id>                    # Model execution risk
/opportunities estimate <id>                # Estimate execution costs
/opportunities kelly <id>                   # Calculate Kelly fraction
```

---

## TypeScript API Reference

### Create Opportunity Finder

```typescript
import { createOpportunityFinder } from 'clodds/opportunity';

const finder = createOpportunityFinder({
  platforms: ['polymarket', 'kalshi', 'betfair', 'manifold'],

  // Filtering
  minEdge: 0.5,           // 0.5% minimum edge
  minLiquidity: 500,      // $500 minimum liquidity
  minConfidence: 0.7,     // 70% match confidence

  // Real-time
  enableRealtime: true,
  scanIntervalMs: 30000,  // 30 second intervals

  // Credentials
  polymarket: { apiKey, apiSecret, passphrase, privateKey },
  kalshi: { apiKey, privateKey },
});
```

### Scan for Opportunities

```typescript
// One-time scan
const opportunities = await finder.scan({
  query: 'election',      // Optional keyword
  minEdge: 1,             // 1% minimum
  minLiquidity: 1000,     // $1000 minimum
  platforms: ['polymarket', 'kalshi'],
});

for (const opp of opportunities) {
  console.log(`${opp.type}: ${opp.description}`);
  console.log(`  Edge: ${opp.edge.toFixed(2)}%`);
  console.log(`  Liquidity: $${opp.liquidity.toLocaleString()}`);
  console.log(`  Confidence: ${(opp.confidence * 100).toFixed(0)}%`);
  console.log(`  Score: ${opp.score}/100`);
  console.log(`  Platforms: ${opp.platforms.join(' ↔ ')}`);
}
```

### Real-Time Monitoring

```typescript
// Start real-time scanning
await finder.startRealtime();

// Event handlers
finder.on('opportunity', (opp) => {
  console.log(`🎯 New opportunity: ${opp.description}`);
  console.log(`   Edge: ${opp.edge.toFixed(2)}%`);
});

finder.on('opportunityExpired', (opp) => {
  console.log(`❌ Opportunity expired: ${opp.id}`);
});

finder.on('opportunityUpdated', (opp) => {
  console.log(`📊 Updated: ${opp.id} - Edge now ${opp.edge.toFixed(2)}%`);
});

// Get active opportunities
const active = await finder.getActive();

// Stop monitoring
await finder.stopRealtime();
```

### Market Linking

```typescript
// Manually link equivalent markets
await finder.linkMarkets(
  { platform: 'polymarket', id: 'market-123' },
  { platform: 'kalshi', id: 'TRUMP-WIN' }
);

// Auto-match using semantic similarity
const matches = await finder.autoMatchMarkets({
  minSimilarity: 0.85,
  platforms: ['polymarket', 'kalshi'],
});

console.log(`Found ${matches.length} potential matches`);
for (const match of matches) {
  console.log(`${match.marketA.question}`);
  console.log(`  ↔ ${match.marketB.question}`);
  console.log(`  Similarity: ${(match.similarity * 100).toFixed(0)}%`);
}

// Get all links
const links = await finder.getLinks();
```

### Execute Opportunity

```typescript
// Execute an opportunity
const result = await finder.execute(opportunityId, {
  size: 100,              // $100 position
  maxSlippage: 0.5,       // 0.5% max slippage
  useProtectedOrders: true,
});

console.log(`Executed: ${result.status}`);
console.log(`  Filled: $${result.filledSize}`);
console.log(`  Avg price: ${result.avgPrice}`);
console.log(`  Fees: $${result.fees}`);

// Mark as taken manually
await finder.markTaken(opportunityId);

// Record outcome
await finder.recordOutcome(opportunityId, {
  pnl: 25.50,
  exitPrice: 0.55,
  exitTimestamp: Date.now(),
});
```

### Analytics

```typescript
// Get statistics
const stats = await finder.getAnalytics({
  period: '30d',
});

console.log(`Total opportunities: ${stats.total}`);
console.log(`Taken: ${stats.taken}`);
console.log(`Win rate: ${(stats.winRate * 100).toFixed(1)}%`);
console.log(`Total P&L: $${stats.totalPnl.toLocaleString()}`);
console.log(`Avg edge: ${stats.avgEdge.toFixed(2)}%`);
console.log(`By platform pair:`);
for (const [pair, data] of Object.entries(stats.byPlatformPair)) {
  console.log(`  ${pair}: ${data.count} opps, $${data.pnl} P&L`);
}
```

### Risk Modeling

```typescript
// Model execution risk
const risk = await finder.modelRisk(opportunityId);

console.log(`Execution risk:`);
console.log(`  Fill probability: ${(risk.fillProbability * 100).toFixed(0)}%`);
console.log(`  Expected slippage: ${risk.expectedSlippage.toFixed(2)}%`);
console.log(`  Time to fill: ${risk.estimatedTimeToFill}s`);
console.log(`  Counterparty risk: ${risk.counterpartyRisk}`);

// Estimate execution
const estimate = await finder.estimateExecution(opportunityId, {
  size: 500,
});

console.log(`Execution estimate for $500:`);
console.log(`  Expected fill: $${estimate.expectedFill}`);
console.log(`  Expected cost: $${estimate.expectedCost}`);
console.log(`  Net edge after costs: ${estimate.netEdge.toFixed(2)}%`);
```

---

## Opportunity Scoring

Opportunities are scored 0-100 based on:

| Factor | Weight | Description |
|--------|--------|-------------|
| Edge % | 35% | Raw arbitrage spread |
| Liquidity | 25% | Available volume |
| Confidence | 25% | Match quality |
| Execution | 15% | Platform reliability |

### Penalties

- Low liquidity (<$1000): -5 points
- Cross-platform complexity: -3 per platform
- High slippage (>2%): -5 points
- Low confidence (<70%): -5 points
- Near expiry (<24h): -3 points

---

## Semantic Matching

Markets are matched using:

1. **Exact slug match** - Platform-specific IDs
2. **Text similarity** - Jaccard coefficient
3. **Vector embeddings** - Semantic similarity
4. **Manual links** - User-defined

```typescript
// Configure matching
finder.setMatchingConfig({
  minTextSimilarity: 0.8,
  minEmbeddingSimilarity: 0.85,
  useManualLinksFirst: true,
});
```

---

## Best Practices

1. **Start with high-confidence matches** - 85%+ similarity
2. **Check liquidity** - Ensure enough volume to execute
3. **Account for fees** - Factor in platform fees
4. **Use protected orders** - Avoid slippage
5. **Monitor in real-time** - Opportunities disappear fast
6. **Track outcomes** - Build performance history
