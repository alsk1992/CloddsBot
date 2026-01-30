---
name: feeds
description: "Real-time market data feeds from 8 prediction market platforms"
emoji: "📡"
---

# Market Feeds - Complete API Reference

Real-time and historical market data from Polymarket, Kalshi, Manifold, Metaculus, PredictIt, Drift, Betfair, and Smarkets.

## Supported Platforms

| Platform | Feed Type | Trading | Data |
|----------|-----------|---------|------|
| Polymarket | WebSocket + RTDS | Yes | Prices, orderbook, trades |
| Kalshi | WebSocket | Yes | Prices, orderbook |
| Betfair | WebSocket | Yes | Odds, volume |
| Smarkets | WebSocket | Yes | Odds, volume |
| Drift | REST | Yes | Prices, funding |
| Manifold | WebSocket | Read-only | Prices, comments |
| Metaculus | REST | Read-only | Forecasts |
| PredictIt | REST | Read-only | Prices |

---

## Chat Commands

### Search Markets

```
/feed search "trump"                        # Search all platforms
/feed search "election" --platform poly     # Search specific platform
/feed search "fed rate" --limit 20          # Limit results
```

### Get Prices

```
/feed price poly <market-id>                # Get current price
/feed price kalshi TRUMP-WIN                # Kalshi market
/feed prices "trump"                        # Prices for all matching markets
```

### Orderbook

```
/feed orderbook poly <market-id>            # Get orderbook
/feed orderbook poly <market-id> --depth 10 # Limit depth
```

### Subscribe (Real-time)

```
/feed subscribe poly <market-id>            # Subscribe to price updates
/feed unsubscribe poly <market-id>          # Unsubscribe
/feed subscriptions                         # List active subscriptions
```

### News

```
/feed news "trump"                          # Get news for topic
/feed news <market-id>                      # News for specific market
/feed news --recent 10                      # Last 10 news items
```

### Edge Analysis

```
/feed edge poly <market-id>                 # Analyze edge vs models
/feed kelly poly <market-id> --prob 0.55    # Calculate Kelly fraction
```

---

## TypeScript API Reference

### Create Feed Manager

```typescript
import { createFeedManager } from 'clodds/feeds';

const feeds = createFeedManager({
  platforms: ['polymarket', 'kalshi', 'manifold', 'betfair'],

  // Enable real-time
  enableRealtime: true,

  // Platform credentials (optional for read-only)
  polymarket: { apiKey },
  kalshi: { apiKey },
  betfair: { appKey, sessionToken },
});
```

### Search Markets

```typescript
// Search across all platforms
const results = await feeds.searchMarkets('trump election', {
  platforms: ['polymarket', 'kalshi'],
  limit: 20,
  sortBy: 'volume',
});

for (const market of results) {
  console.log(`[${market.platform}] ${market.question}`);
  console.log(`  Price: ${market.price}`);
  console.log(`  Volume: $${market.volume.toLocaleString()}`);
}
```

### Get Single Market

```typescript
// Get specific market
const market = await feeds.getMarket('polymarket', 'market-123');

console.log(`Question: ${market.question}`);
console.log(`YES: ${market.yesPrice} / NO: ${market.noPrice}`);
console.log(`Volume: $${market.volume.toLocaleString()}`);
console.log(`End date: ${market.endDate}`);
```

### Get Price

```typescript
// Get current price
const price = await feeds.getPrice('polymarket', 'market-123');

console.log(`YES: ${price.yes}`);
console.log(`NO: ${price.no}`);
console.log(`Spread: ${price.spread}`);
console.log(`Updated: ${price.timestamp}`);
```

### Get Orderbook

```typescript
// Get orderbook
const orderbook = await feeds.getOrderbook('polymarket', 'market-123', {
  depth: 10,
});

console.log('Bids (YES):');
for (const bid of orderbook.bids) {
  console.log(`  ${bid.price}: $${bid.size}`);
}

console.log('Asks (YES):');
for (const ask of orderbook.asks) {
  console.log(`  ${ask.price}: $${ask.size}`);
}
```

### Subscribe to Real-time Updates

```typescript
// Subscribe to price updates
const subscription = await feeds.subscribePrice('polymarket', 'market-123');

subscription.on('price', (update) => {
  console.log(`Price update: YES=${update.yes}, NO=${update.no}`);
});

subscription.on('trade', (trade) => {
  console.log(`Trade: ${trade.side} ${trade.size} @ ${trade.price}`);
});

// Unsubscribe
await subscription.unsubscribe();
```

### News

```typescript
// Get recent news
const news = await feeds.getRecentNews('trump', { limit: 10 });

for (const article of news) {
  console.log(`[${article.source}] ${article.title}`);
  console.log(`  ${article.summary}`);
  console.log(`  ${article.url}`);
}

// Search news
const searchResults = await feeds.searchNews('federal reserve', {
  from: '2024-01-01',
  sources: ['reuters', 'bloomberg'],
});
```

### Edge Analysis

```typescript
// Analyze edge vs external models
const edge = await feeds.analyzeEdge('polymarket', 'market-123');

console.log(`Market price: ${edge.marketPrice}`);
console.log(`Model estimates:`);
for (const model of edge.models) {
  console.log(`  ${model.name}: ${model.estimate}`);
  console.log(`    Edge: ${model.edge > 0 ? '+' : ''}${model.edge.toFixed(1)}%`);
}
console.log(`Consensus edge: ${edge.consensusEdge.toFixed(1)}%`);
```

### Kelly Criterion

```typescript
// Calculate optimal position size
const kelly = await feeds.calculateKelly({
  platform: 'polymarket',
  marketId: 'market-123',
  estimatedProbability: 0.55,  // Your estimate
  bankroll: 10000,             // Your bankroll
  kellyFraction: 0.5,          // Half-Kelly for safety
});

console.log(`Market price: ${kelly.marketPrice}`);
console.log(`Your estimate: ${kelly.estimatedProb}`);
console.log(`Edge: ${kelly.edge.toFixed(1)}%`);
console.log(`Full Kelly: ${kelly.fullKelly.toFixed(1)}%`);
console.log(`Recommended size: $${kelly.recommendedSize}`);
```

---

## Platform-Specific Features

### Polymarket RTDS (Real-time Data Service)

```typescript
// Connect to RTDS for ultra-low-latency updates
const rtds = await feeds.connectRTDS('polymarket');

rtds.on('tick', (tick) => {
  console.log(`${tick.market}: ${tick.price} (${tick.side})`);
});

rtds.subscribe(['market-123', 'market-456']);
```

### Betfair Odds

```typescript
// Get Betfair odds
const odds = await feeds.getBetfairOdds('event-123');

for (const runner of odds.runners) {
  console.log(`${runner.name}: ${runner.backOdds} / ${runner.layOdds}`);
}
```

### Metaculus Forecasts

```typescript
// Get Metaculus community forecast
const forecast = await feeds.getMetaculusForecast('question-123');

console.log(`Community median: ${forecast.median}`);
console.log(`25th percentile: ${forecast.q25}`);
console.log(`75th percentile: ${forecast.q75}`);
console.log(`Forecasters: ${forecast.forecasterCount}`);
```

---

## Data Refresh Rates

| Platform | REST | WebSocket |
|----------|------|-----------|
| Polymarket | 5s | Real-time |
| Kalshi | 10s | Real-time |
| Betfair | 1s | Real-time |
| Manifold | 30s | Real-time |
| Metaculus | 60s | N/A |
| PredictIt | 30s | N/A |

---

## Best Practices

1. **Use WebSocket** for real-time trading decisions
2. **Cache responses** for non-time-sensitive queries
3. **Respect rate limits** - batch requests when possible
4. **Subscribe selectively** - only to markets you need
5. **Handle reconnections** - WebSocket connections can drop
