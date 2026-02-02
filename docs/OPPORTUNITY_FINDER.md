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
| `/opportunity combinatorial` | Scan for combinatorial arbitrage (arXiv:2508.03474) |
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

**Note:** These factors are heuristic estimates, not empirically validated. Actual slippage varies significantly based on market, time of day, and current orderbook depth.

Platform-specific slippage factors (relative scale):

| Platform | Factor | Rationale |
|----------|--------|-----------|
| Betfair | 0.6 | High-volume sports exchange |
| Smarkets | 0.7 | Good liquidity, regulated |
| Polymarket | 0.8 | Varies greatly by market |
| Drift | 0.9 | Solana DEX |
| Kalshi | 1.0 | Baseline (moderate liquidity) |
| PredictIt | 1.2 | Lower liquidity, US only |
| Manifold | 1.5 | Play money (less market depth) |
| Metaculus | 2.0 | Community predictions |

Slippage formula (heuristic):
```
slippage = sqrt(size / liquidity) * 2 * platform_factor + spread/2
```

**Recommendation:** For real trading, fetch actual orderbook depth via `/orderbook` command rather than relying on these estimates.

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

Example output (illustrative, not actual results):
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

**Note:** Actual results depend on execution speed, market conditions, and timing. Past performance does not guarantee future results.

### Platform Pairs
```bash
/opportunity pairs
```

Example output (illustrative):
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

## Combinatorial Arbitrage

Based on [arXiv:2508.03474](https://arxiv.org/abs/2508.03474) - "Unravelling the Probabilistic Forest"

The paper analyzed Polymarket data from **April 2024 to April 2025** (86 million bets across thousands of markets) and found **$40M in realized arbitrage profits** extracted by traders. Key caveats:
- Most profits were captured by **sophisticated arbitrageurs** with fast execution
- Political markets (2024 US election) had the largest spreads
- Sports markets had more frequent but smaller opportunities

The paper identifies two mechanisms:

### 1. Market Rebalancing
When YES + NO prices don't sum to $1.00:

```
Example: Market totals $0.97
  Buy YES @ 45c + Buy NO @ 52c = 97c
  One outcome pays $1.00
  Guaranteed profit: 3c per dollar
```

Long when sum < $1, short when sum > $1.

### 2. Conditional Dependencies
Markets with logical relationships:

| Relationship | Formula | Example |
|--------------|---------|---------|
| Implies (→) | P(A) ≤ P(B) | "Trump wins" → "Republican wins" |
| Inverse (¬) | P(A) + P(B) = 1 | "X happens" vs "X doesn't happen" |
| Exclusive (⊕) | P(A) + P(B) ≤ 1 | "Biden wins" vs "Trump wins" |
| Exhaustive (∨) | ΣP(i) = 1 | All candidates in race |

Arbitrage exists when market prices violate these constraints.

### Commands

```bash
# Scan for combinatorial arbitrage
/opportunity combinatorial

# With options
/opportunity comb minEdge=1 platforms=polymarket,kalshi
```

### Heuristic Reduction

The naive algorithm is O(2^n+m) - computationally infeasible. We use three heuristics:

1. **Timeliness**: Only compare markets ending within 30 days of each other
2. **Topical similarity**: Cluster markets by topic (elections, crypto, fed, sports)
3. **Logical relationships**: Only check pairs with detectable dependencies

This reduces millions of comparisons to thousands.

### Order Book Imbalance Signals

Additional predictive indicators:

```
OBI = (Q_bid - Q_ask) / (Q_bid + Q_ask)
```

Research shows:
- OBI explains ~65% of short-term price variance
- Imbalance Ratio > 0.65 predicts price increase (58% accuracy)

### Position Sizing

Kelly criterion for combinatorial positions:

```
f* = (P_true - P_market) / (1 - P_market)
```

Use fractional Kelly (25-50%) for safety.

### Time Decay

Reduce position as expiry approaches:

```
Position(t) = Initial × √(T_remaining / T_initial)
```

This reduces exposure ~65% in the final week.

### API

```typescript
import { scanCombinatorialArbitrage } from './opportunity/combinatorial';

const result = await scanCombinatorialArbitrage(feeds, {
  platforms: ['polymarket', 'kalshi'],
  minEdgePct: 0.5,
});

// result.rebalance - YES+NO != $1 opportunities
// result.combinatorial - conditional dependency opportunities
// result.clusters - market topic clusters
```

### Database Tables

#### combinatorial_opportunities
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Opportunity ID |
| type | TEXT | rebalance_long/rebalance_short/combinatorial |
| markets_json | TEXT | Markets involved |
| relationship | TEXT | implies/inverse/exclusive/exhaustive |
| edge_pct | REAL | Arbitrage edge % |
| confidence | REAL | Match confidence |

#### market_clusters
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Cluster ID |
| topic | TEXT | election_2024, bitcoin, fed_rates, etc. |
| market_ids_json | TEXT | Markets in cluster |
| avg_similarity | REAL | Average pairwise similarity |

## Cross-Asset Correlation Arbitrage

Find mispriced markets based on logical and statistical correlations between assets.

### Overview

Markets often have relationships that aren't reflected in their pricing:
- If "Trump wins presidency" is 60%, then "Republican wins presidency" should be ≥ 60%
- If "BTC hits $100k" moves, "ETH hits $5k" often follows within minutes
- "Harris wins" and "Trump wins" are mutually exclusive (can't both be > 50%)

The correlation finder detects these relationships and alerts when prices violate them.

### Correlation Types

| Type | Description | Example |
|------|-------------|---------|
| `identical` | Same underlying event | "Fed raises rates" on Polymarket vs Kalshi |
| `implies` | A implies B (P(A) ≤ P(B)) | "Trump wins" → "Republican wins" |
| `mutually_exclusive` | Both can't happen (P(A) + P(B) ≤ 1) | "Biden wins" vs "Trump wins" |
| `time_shifted` | Correlated with lag (arbitrage window) | BTC price leads ETH by ~60s |
| `partial` | Statistical correlation (not logical) | Crypto prices tend to move together |

### Quick Start

```typescript
import { createCorrelationFinder } from './opportunity/correlation';

const corrFinder = createCorrelationFinder(feeds, db, {
  minCorrelation: 0.7,
  maxLagSeconds: 300,
  minMispricingPct: 2.0,
});

// Scan for correlation arbitrage
const opportunities = await corrFinder.scan();

// Real-time alerts
corrFinder.on('mispricing', (opp) => {
  console.log(`Mispricing: ${opp.marketA.question} vs ${opp.marketB.question}`);
  console.log(`Expected: ${opp.expectedPrice}, Actual: ${opp.actualPrice}`);
  console.log(`Edge: ${opp.edgePct}%`);
});

await corrFinder.startMonitoring();
```

### Built-in Correlation Rules

The system includes pre-configured rules for common relationships:

#### Political Implications
```typescript
// Candidate → Party
"Trump wins" implies "Republican wins"
"Harris wins" implies "Democrat wins"
"Biden wins" implies "Democrat wins"

// State → National (strong states)
"Trump wins Florida" implies "Trump wins presidency" (partial)
```

#### Crypto Time-Shifts
```typescript
// BTC leads other crypto (60-120s typical lag)
"BTC up 5%" → "ETH up" (corr: 0.85, lag: 60-120s)
"BTC up 5%" → "SOL up" (corr: 0.75, lag: 90-180s)

// Major events propagate
"Coinbase lists X" → "X price up" (lag: varies)
```

#### Mutual Exclusions
```typescript
// Same race
"Biden wins 2024" + "Trump wins 2024" ≤ 1.0
"Harris wins" + "Trump wins" + "Other wins" = 1.0 (exhaustive)
```

### Configuration

```typescript
interface CorrelationConfig {
  // Minimum correlation coefficient to consider
  minCorrelation?: number;  // default: 0.6

  // Maximum lag for time-shifted correlations (seconds)
  maxLagSeconds?: number;  // default: 300

  // Minimum mispricing to alert
  minMispricingPct?: number;  // default: 1.5

  // Window for calculating correlations
  correlationWindowMs?: number;  // default: 3600000 (1 hour)

  // Custom rules to add
  customRules?: CorrelationRule[];

  // Categories to scan (default: all)
  categories?: string[];
}
```

### Custom Rules

Add your own correlation rules:

```typescript
const finder = createCorrelationFinder(feeds, db, {
  customRules: [
    {
      type: 'implies',
      marketA: { pattern: /SpaceX.*launch/i },
      marketB: { pattern: /Starship.*success/i },
      description: 'SpaceX launch implies Starship program',
    },
    {
      type: 'time_shifted',
      marketA: { category: 'crypto', asset: 'BTC' },
      marketB: { category: 'crypto', asset: 'DOGE' },
      lagRangeSeconds: [120, 600],
      minCorrelation: 0.65,
    },
    {
      type: 'mutually_exclusive',
      markets: [
        { pattern: /Biden wins 2024/i },
        { pattern: /Trump wins 2024/i },
        { pattern: /Third party wins 2024/i },
      ],
      sumConstraint: 1.0,  // exhaustive
    },
  ],
});
```

### API Reference

#### createCorrelationFinder(feeds, db, config?)

Creates a correlation finder instance.

**Parameters:**
- `feeds` - FeedManager instance for market data
- `db` - Database instance for persistence
- `config` - CorrelationConfig options

**Returns:** CorrelationFinder

#### finder.scan(options?)

Scan for correlation-based arbitrage opportunities.

**Options:**
- `categories` - Categories to scan
- `minEdge` - Minimum edge % to include
- `limit` - Max results

**Returns:** `Promise<CorrelationOpportunity[]>`

#### finder.addRule(rule)

Add a custom correlation rule.

#### finder.getCorrelationMatrix(category?)

Get correlation coefficients between markets.

**Returns:** `Map<string, Map<string, number>>`

#### finder.startMonitoring()

Start real-time correlation monitoring.

#### finder.stopMonitoring()

Stop monitoring.

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `mispricing` | CorrelationOpportunity | Mispricing detected |
| `correlation_break` | { marketA, marketB, oldCorr, newCorr } | Historical correlation broke |
| `rule_triggered` | { rule, markets, edge } | Custom rule matched |

### Example: Political Arbitrage

```typescript
// Detect implies violation
const finder = createCorrelationFinder(feeds, db);

finder.on('mispricing', async (opp) => {
  if (opp.type === 'implies' && opp.edgePct > 3) {
    // "Trump wins" at 55% but "Republican wins" at 52%
    // This violates implies relationship
    console.log('Implies violation!');
    console.log(`Buy "${opp.marketB.question}" at ${opp.marketB.price}`);
    console.log(`Expected fair value: ${opp.expectedPrice} (${opp.edgePct}% edge)`);
  }
});
```

### Example: Crypto Lead-Lag

```typescript
const finder = createCorrelationFinder(feeds, db, {
  categories: ['crypto'],
  maxLagSeconds: 180,
});

finder.on('mispricing', async (opp) => {
  if (opp.type === 'time_shifted') {
    // BTC moved 5% up, ETH hasn't moved yet
    console.log(`${opp.marketA.asset} moved, ${opp.marketB.asset} lagging`);
    console.log(`Expected move: ${opp.expectedMove}%`);
    console.log(`Time remaining: ${opp.lagRemaining}s`);
  }
});
```

### Database Tables

#### correlation_rules
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Rule ID |
| type | TEXT | implies/mutually_exclusive/time_shifted/partial |
| market_a_pattern | TEXT | Regex or market ID |
| market_b_pattern | TEXT | Regex or market ID |
| parameters_json | TEXT | Lag, correlation threshold, etc. |
| enabled | BOOLEAN | Active status |

#### correlation_opportunities
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Opportunity ID |
| rule_id | TEXT | Triggering rule |
| market_a_id | TEXT | First market |
| market_b_id | TEXT | Second market |
| type | TEXT | Correlation type |
| expected_price | REAL | Fair value based on correlation |
| actual_price | REAL | Current market price |
| edge_pct | REAL | Mispricing % |
| created_at | TIMESTAMP | Detection time |

#### correlation_history
| Column | Type | Description |
|--------|------|-------------|
| market_a_id | TEXT | First market |
| market_b_id | TEXT | Second market |
| correlation | REAL | Pearson correlation |
| lag_seconds | INT | Optimal lag |
| sample_count | INT | Data points |
| updated_at | TIMESTAMP | Last calculation |
