---
name: market-index
description: "Search, discover, and browse indexed markets across all platforms"
emoji: "🔍"
---

# Market Index - Complete API Reference

Search, discover, and browse markets across all prediction market platforms with advanced filtering and categorization.

---

## Chat Commands

### Search

```
/index search "trump"                       # Search all indexed markets
/index search "election" --platform poly    # Search specific platform
/index search "fed rate" --category finance # Filter by category
/index search "crypto" --min-volume 10000   # Min volume filter
/index search "sports" --active-only        # Active markets only
```

### Browse Categories

```
/index categories                           # List all categories
/index category politics                    # Browse politics markets
/index category crypto                      # Browse crypto markets
/index category sports                      # Browse sports markets
/index trending                             # Trending markets
```

### Market Discovery

```
/index new                                  # Newly created markets
/index new --last 24h                       # Last 24 hours
/index hot                                  # High activity markets
/index closing-soon                         # Markets ending soon
```

### Index Management

```
/index update                               # Refresh market index
/index update poly                          # Update specific platform
/index stats                                # Index statistics
/index status                               # Index health status
```

---

## TypeScript API Reference

### Create Market Index

```typescript
import { createMarketIndex } from 'clodds/market-index';

const index = createMarketIndex({
  platforms: ['polymarket', 'kalshi', 'manifold', 'betfair'],

  // Auto-refresh
  autoRefresh: true,
  refreshIntervalMs: 300000,  // 5 minutes

  // Storage
  cachePath: './market-index.db',
});
```

### Search Markets

```typescript
// Full-text search
const results = await index.search('trump election', {
  platforms: ['polymarket', 'kalshi'],
  limit: 20,
  sortBy: 'volume',  // 'volume' | 'relevance' | 'endDate' | 'created'
});

for (const market of results) {
  console.log(`[${market.platform}] ${market.question}`);
  console.log(`  Category: ${market.category}`);
  console.log(`  Volume: $${market.volume.toLocaleString()}`);
  console.log(`  End: ${market.endDate}`);
}

// With filters
const filtered = await index.search('', {
  category: 'politics',
  minVolume: 10000,
  activeOnly: true,
  endsBefore: '2024-12-31',
});
```

### Browse Categories

```typescript
// Get all categories
const categories = await index.getCategories();

for (const cat of categories) {
  console.log(`${cat.name}: ${cat.marketCount} markets`);
}

// Get markets in category
const politics = await index.getMarketsByCategory('politics', {
  limit: 50,
  sortBy: 'volume',
});
```

### Market Discovery

```typescript
// Get new markets
const newMarkets = await index.getNewMarkets({
  since: Date.now() - 24 * 60 * 60 * 1000,  // Last 24h
  limit: 20,
});

// Get trending/hot markets
const trending = await index.getTrendingMarkets({
  period: '24h',
  limit: 10,
});

for (const market of trending) {
  console.log(`${market.question}`);
  console.log(`  Volume 24h: $${market.volume24h.toLocaleString()}`);
  console.log(`  Volume change: ${market.volumeChange > 0 ? '+' : ''}${market.volumeChange}%`);
}

// Markets closing soon
const closingSoon = await index.getClosingSoon({
  within: '48h',
  minVolume: 1000,
});
```

### Index Management

```typescript
// Update index
await index.update();

// Update specific platform
await index.update('polymarket');

// Get index stats
const stats = await index.getStats();

console.log(`Total markets: ${stats.totalMarkets}`);
console.log(`By platform:`);
for (const [platform, count] of Object.entries(stats.byPlatform)) {
  console.log(`  ${platform}: ${count}`);
}
console.log(`By category:`);
for (const [category, count] of Object.entries(stats.byCategory)) {
  console.log(`  ${category}: ${count}`);
}
console.log(`Last updated: ${stats.lastUpdated}`);

// Check status
const status = await index.getStatus();
console.log(`Status: ${status.status}`);
console.log(`Markets indexed: ${status.marketCount}`);
console.log(`Index age: ${status.ageMinutes} minutes`);
```

### Get Single Market

```typescript
// Get market details
const market = await index.getMarket('polymarket', 'market-123');

console.log(`Question: ${market.question}`);
console.log(`Description: ${market.description}`);
console.log(`Category: ${market.category}`);
console.log(`Platform: ${market.platform}`);
console.log(`Volume: $${market.volume.toLocaleString()}`);
console.log(`Liquidity: $${market.liquidity.toLocaleString()}`);
console.log(`Start: ${market.startDate}`);
console.log(`End: ${market.endDate}`);
console.log(`Outcomes: ${market.outcomes.join(', ')}`);
```

---

## Categories

Standard categories across platforms:

| Category | Description |
|----------|-------------|
| **politics** | Elections, policy, government |
| **crypto** | Cryptocurrency prices, events |
| **finance** | Fed rates, stocks, economy |
| **sports** | Games, tournaments, awards |
| **entertainment** | Movies, TV, celebrities |
| **science** | Research, space, climate |
| **technology** | Tech companies, products |
| **world** | International events |
| **other** | Miscellaneous |

---

## Search Syntax

| Syntax | Example | Description |
|--------|---------|-------------|
| Keywords | `trump election` | Match any word |
| Exact phrase | `"federal reserve"` | Match exact phrase |
| Exclude | `election -trump` | Exclude word |
| Platform filter | `platform:poly` | Specific platform |
| Category filter | `category:politics` | Specific category |

---

## Sorting Options

| Option | Description |
|--------|-------------|
| `volume` | Highest volume first |
| `relevance` | Best match first |
| `endDate` | Ending soonest first |
| `created` | Newest first |
| `liquidity` | Highest liquidity first |

---

## Best Practices

1. **Refresh regularly** - Markets change frequently
2. **Use filters** - Narrow down large result sets
3. **Check liquidity** - Not just volume
4. **Monitor new markets** - Opportunities in new listings
5. **Track closing dates** - Don't miss resolution
