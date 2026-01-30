---
name: arbitrage
description: "Automated cross-platform arbitrage detection and monitoring"
emoji: "⚖️"
gates:
  envs:
    anyOf:
      - POLY_API_KEY
      - KALSHI_API_KEY
---

# Arbitrage Service - Complete API Reference

Automated detection and monitoring of arbitrage opportunities across prediction market platforms.

## Supported Platforms

- Polymarket
- Kalshi
- Manifold
- Metaculus
- PredictIt
- Drift
- Betfair
- Smarkets

---

## Chat Commands

### Monitoring Control

```
/arb start                                  # Start arbitrage monitoring
/arb stop                                   # Stop monitoring
/arb status                                 # Check monitoring status
/arb config --interval 60                   # Set check interval (seconds)
```

### Manual Scanning

```
/arb check                                  # Run one-time scan
/arb check "election"                       # Scan with keyword
/arb check --platforms poly,kalshi          # Specific platforms
```

### Market Comparison

```
/arb compare <market-a> <market-b>          # Compare two specific markets
/arb compare poly:12345 kalshi:TRUMP        # By platform:id
```

### View Opportunities

```
/arb opportunities                          # List current opportunities
/arb opportunities --min-spread 2           # Min 2% spread
/arb opportunities --format table           # Table format
/arb opportunities --format detailed        # Detailed view
```

### Market Linking

```
/arb link <market-a> <market-b>             # Manually link markets
/arb unlink <market-a> <market-b>           # Remove link
/arb links                                  # View all links
/arb auto-match                             # Auto-detect matches
```

### Statistics

```
/arb stats                                  # Arbitrage statistics
/arb stats --period 7d                      # Last 7 days
/arb history                                # Historical opportunities
```

---

## TypeScript API Reference

### Create Arbitrage Service

```typescript
import { createArbitrageService } from 'clodds/arbitrage';

const arbService = createArbitrageService({
  platforms: ['polymarket', 'kalshi', 'manifold', 'betfair'],

  checkIntervalMs: 30000,    // Check every 30 seconds
  minSpread: 0.5,            // 0.5% minimum spread
  minLiquidity: 100,         // $100 minimum

  // Platform credentials
  polymarket: { apiKey, apiSecret, passphrase },
  kalshi: { apiKey },
});
```

### Start/Stop Monitoring

```typescript
// Start continuous monitoring
await arbService.start();

// Event handlers
arbService.on('arbitrage', (opp) => {
  console.log(`⚖️ Arbitrage found!`);
  console.log(`  ${opp.marketA.platform}: ${opp.marketA.price}`);
  console.log(`  ${opp.marketB.platform}: ${opp.marketB.price}`);
  console.log(`  Spread: ${opp.spread.toFixed(2)}%`);
});

arbService.on('arbitrageExpired', (opp) => {
  console.log(`Arbitrage expired: ${opp.id}`);
});

// Check status
const isRunning = arbService.isRunning();

// Stop monitoring
await arbService.stop();
```

### One-Time Check

```typescript
// Run a single scan
const opportunities = await arbService.checkArbitrage({
  query: 'trump',
  platforms: ['polymarket', 'kalshi'],
  minSpread: 1,
});

for (const opp of opportunities) {
  console.log(`${opp.question}`);
  console.log(`  Buy on ${opp.buyPlatform} @ ${opp.buyPrice}`);
  console.log(`  Sell on ${opp.sellPlatform} @ ${opp.sellPrice}`);
  console.log(`  Spread: ${opp.spread.toFixed(2)}%`);
}
```

### Compare Specific Markets

```typescript
// Compare two specific markets
const comparison = await arbService.compareMarkets(
  { platform: 'polymarket', id: 'market-123' },
  { platform: 'kalshi', id: 'TRUMP-WIN' }
);

if (comparison.hasArbitrage) {
  console.log(`Arbitrage exists!`);
  console.log(`  Buy ${comparison.buySide} on ${comparison.buyPlatform}`);
  console.log(`  Sell ${comparison.sellSide} on ${comparison.sellPlatform}`);
  console.log(`  Spread: ${comparison.spread.toFixed(2)}%`);
} else {
  console.log(`No arbitrage. Price difference: ${comparison.priceDiff.toFixed(2)}%`);
}
```

### Market Linking

```typescript
// Add a manual match
await arbService.addMatch(
  { platform: 'polymarket', id: 'market-123', question: 'Will Trump win?' },
  { platform: 'kalshi', id: 'TRUMP-WIN', question: 'Trump wins 2024' }
);

// Remove a match
await arbService.removeMatch('polymarket:market-123', 'kalshi:TRUMP-WIN');

// Auto-detect matches using question similarity
const autoMatches = await arbService.autoMatchMarkets({
  minSimilarity: 0.85,
});

console.log(`Found ${autoMatches.length} auto-matches`);
```

### Get Opportunities

```typescript
// Get current opportunities
const opportunities = await arbService.getOpportunities({
  minSpread: 1,
  sortBy: 'spread',  // 'spread' | 'liquidity' | 'confidence'
});

// Format for display
const formatted = await arbService.formatOpportunities(opportunities);
console.log(formatted);
```

### Statistics

```typescript
// Get arbitrage statistics
const stats = await arbService.getStats({
  period: '30d',
});

console.log(`Total opportunities: ${stats.totalOpportunities}`);
console.log(`Avg spread: ${stats.avgSpread.toFixed(2)}%`);
console.log(`Max spread seen: ${stats.maxSpread.toFixed(2)}%`);
console.log(`By platform pair:`);
for (const [pair, count] of Object.entries(stats.byPlatformPair)) {
  console.log(`  ${pair}: ${count}`);
}
```

---

## Arbitrage Types Detected

### 1. Cross-Platform Price Difference

```
Market: "Trump wins 2024"
Polymarket YES: 52¢
Kalshi YES: 55¢

Strategy: Buy Polymarket YES, Sell Kalshi YES
Spread: 3¢ (5.8%)
```

### 2. Internal Arbitrage (Rebalancing)

```
Market: "Will X happen?"
YES: 45¢
NO: 52¢
Total: 97¢

Strategy: Buy both YES and NO
Guaranteed profit: 3¢ per $1
```

### 3. Inverse Markets

```
Market A: "Trump wins" = 55¢
Market B: "Trump loses" = 48¢
Total: 103¢ (should be 100¢)

Strategy: Sell both, pocket 3¢
```

---

## Configuration

```typescript
arbService.configure({
  // Scanning
  checkIntervalMs: 30000,
  batchSize: 50,

  // Filtering
  minSpread: 0.5,
  minLiquidity: 100,
  minConfidence: 0.7,

  // Matching
  autoMatchEnabled: true,
  minMatchSimilarity: 0.85,

  // Alerts
  alertOnNewArb: true,
  alertThreshold: 2,  // Alert on 2%+ spreads
});
```

---

## Best Practices

1. **Verify matches manually** - Auto-matching can have false positives
2. **Check liquidity** - Ensure you can actually execute
3. **Account for fees** - Platform fees reduce spreads
4. **Move fast** - Arbitrage disappears quickly
5. **Use limit orders** - Avoid slippage
6. **Track all outcomes** - Build performance data
