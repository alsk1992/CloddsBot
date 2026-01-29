# Opportunity Finder

Cross-platform arbitrage and edge detection for prediction markets.

## Quick Start

```typescript
import { createOpportunityFinder } from './opportunity';

const finder = createOpportunityFinder(db, feeds, embeddings, {
  minEdge: 0.5,
  semanticMatching: true,
});

// Find opportunities
const opps = await finder.scan({ query: 'fed rate', minEdge: 1 });

// Real-time alerts
finder.on('opportunity', (opp) => console.log('Found:', opp.edgePct, '%'));
await finder.startRealtime();
```

## Commands

| Command | Description |
|---------|-------------|
| `/opportunity scan [query]` | Find opportunities |
| `/opportunity active` | Show active opportunities |
| `/opportunity link <a> <b>` | Link equivalent markets |
| `/opportunity stats` | View performance stats |
| `/opportunity pairs` | Platform pair analysis |
| `/opportunity realtime start` | Enable real-time scanning |

## Opportunity Types

### 1. Internal Arbitrage
Buy YES + NO on same market for < $1.00

```
Example: Polymarket "Will X happen?"
  YES: 45c + NO: 52c = 97c
  Edge: 3% guaranteed profit
```

### 2. Cross-Platform Arbitrage
Same market priced differently across platforms

```
Example: "Fed rate hike in Jan"
  Polymarket YES: 65c
  Kalshi YES: 72c

  Strategy: Buy YES @ 65c on Polymarket
            Buy NO @ 28c on Kalshi (or sell YES)
  Edge: 7%
```

### 3. Edge vs Fair Value
Market mispriced vs external benchmarks (polls, models)

```
Example: Election market
  Market price: 45%
  538 model: 52%
  Edge: 7% (buy YES)
```

## Configuration

```json
{
  "opportunityFinder": {
    "enabled": true,
    "minEdge": 0.5,
    "minLiquidity": 100,
    "platforms": ["polymarket", "kalshi", "betfair"],
    "semanticMatching": true,
    "similarityThreshold": 0.85,
    "realtime": false,
    "scanIntervalMs": 10000
  }
}
```

## Scoring System

Opportunities are scored 0-100 based on:

| Factor | Weight | Description |
|--------|--------|-------------|
| Edge % | 35% | Raw arbitrage spread |
| Liquidity | 25% | Available $ to trade |
| Confidence | 25% | Match quality / fair value confidence |
| Execution | 15% | Platform reliability, fees |

### Score Breakdown

```
Score = EdgeScore + LiquidityScore + ConfidenceScore + ExecutionScore - Penalties

EdgeScore (0-40):       edge% / 10 * 40
LiquidityScore (0-25):  min(liquidity/$50k, 1) * 25
ConfidenceScore (0-25): confidence * 25
ExecutionScore (0-10):  platform reliability factors
```

### Penalties
- Low liquidity: -5 if < 5x minimum
- Cross-platform: -3 per additional platform
- High slippage: -5 if > 2%
- Low confidence: -5 if fair value confidence < 70%

## Market Matching

### Semantic Matching
Uses embeddings to match markets with different wording:

```
"Will the Fed raise rates?"
  = "FOMC vote for rate hike?"
  = "Federal Reserve interest rate increase?"
```

### Text Matching (Fallback)
Tokenizes and compares using Jaccard similarity:
- Removes stop words (will, the, be, etc.)
- Normalizes entities (Fed = FOMC, Jan = January)
- Requires 60% token overlap

### Manual Linking
Override automatic matching:

```bash
/opportunity link polymarket:abc123 kalshi:fed-rate-jan
```

## Slippage Estimation

Platform-specific slippage factors:

| Platform | Factor | Notes |
|----------|--------|-------|
| Betfair | 0.6 | Best liquidity |
| Smarkets | 0.7 | Good liquidity |
| Polymarket | 0.8 | Good for crypto |
| Drift | 0.9 | Decent |
| Kalshi | 1.0 | Moderate |
| PredictIt | 1.2 | Lower liquidity |
| Manifold | 1.5 | Play money effects |
| Metaculus | 2.0 | Least liquid |

Slippage formula:
```
slippage = sqrt(size / liquidity) * 2 * platform_factor + spread/2
```

## Kelly Criterion

Recommended position sizing:

```
kelly = edge * confidence * 0.25  (quarter Kelly)
```

Capped at 25% of bankroll per opportunity.

## Analytics

### Win Rate Tracking
```bash
/opportunity stats 30  # Last 30 days
```

Output:
```
Found: 1,247
Taken: 89
Win Rate: 67.4%
Total Profit: $4,521.00
Avg Edge: 2.3%

By Type:
  internal: 412 found, 34 taken, 71.2% WR
  cross_platform: 623 found, 41 taken, 65.8% WR
  edge: 212 found, 14 taken, 64.3% WR
```

### Platform Pairs
```bash
/opportunity pairs
```

Output:
```
polymarket <-> kalshi
  Opportunities: 423 | Taken: 32
  Win Rate: 68.8% | Profit: $2,140
  Avg Edge: 2.1%

polymarket <-> betfair
  Opportunities: 198 | Taken: 21
  Win Rate: 71.4% | Profit: $1,890
  Avg Edge: 2.8%
```

## Database Tables

### market_links
Cross-platform market identity mapping

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Link ID |
| market_a | TEXT | platform:marketId |
| market_b | TEXT | platform:marketId |
| confidence | REAL | 0-1 match confidence |
| source | TEXT | manual/auto/semantic |

### opportunities
Historical opportunity tracking

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Opportunity ID |
| type | TEXT | internal/cross_platform/edge |
| edge_pct | REAL | Arbitrage spread % |
| score | REAL | 0-100 score |
| status | TEXT | active/taken/expired/closed |
| realized_pnl | REAL | Actual profit/loss |

### platform_pair_stats
Aggregated performance by platform combination

| Column | Type | Description |
|--------|------|-------------|
| platform_a | TEXT | First platform |
| platform_b | TEXT | Second platform |
| total_opportunities | INT | Count found |
| wins | INT | Profitable trades |
| total_profit | REAL | Cumulative P&L |

## API Reference

### createOpportunityFinder(db, feeds, embeddings?, config?)

Creates opportunity finder instance.

**Parameters:**
- `db` - Database instance
- `feeds` - FeedManager instance
- `embeddings` - Optional EmbeddingsService for semantic matching
- `config` - OpportunityFinderConfig

**Returns:** OpportunityFinder

### finder.scan(options?)

Scan for opportunities.

**Options:**
- `query` - Filter by market text
- `minEdge` - Minimum edge % (default: 0.5)
- `minLiquidity` - Minimum $ liquidity (default: 100)
- `platforms` - Platforms to scan
- `types` - Opportunity types to include
- `limit` - Max results (default: 50)
- `sortBy` - Sort by: edge, score, liquidity, profit

**Returns:** `Promise<Opportunity[]>`

### finder.startRealtime()

Start real-time opportunity scanning.

### finder.stopRealtime()

Stop real-time scanning.

### finder.linkMarkets(marketA, marketB, confidence?)

Manually link two markets as equivalent.

### finder.getAnalytics(options?)

Get performance statistics.

**Options:**
- `days` - Time period (default: 30)
- `platform` - Filter by platform

**Returns:** OpportunityStats

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `opportunity` | Opportunity | New opportunity found |
| `expired` | Opportunity | Opportunity expired |
| `taken` | Opportunity | Marked as taken |
| `closed` | Opportunity | Final outcome recorded |
| `started` | - | Real-time scanning started |
| `stopped` | - | Real-time scanning stopped |

## Best Practices

1. **Start with higher minEdge** (2-3%) to filter noise
2. **Enable semantic matching** if you have embeddings configured
3. **Monitor platform pairs** - some combinations are more reliable
4. **Use quarter Kelly** - the default is conservative for a reason
5. **Link markets manually** when auto-matching misses obvious pairs
6. **Track outcomes** - use `/opportunity take` and record results

## Troubleshooting

### "No opportunities found"
- Lower `minEdge` threshold
- Add more platforms to scan
- Check feed connectivity

### "Low confidence matches"
- Enable semantic matching
- Manually link known equivalent markets
- Adjust `similarityThreshold`

### "High slippage warnings"
- Reduce position size
- Wait for better liquidity
- Use limit orders instead of market
