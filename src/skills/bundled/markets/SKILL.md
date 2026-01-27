---
name: markets
description: "Search and view prediction market data from Polymarket, Kalshi, Manifold, and Metaculus"
emoji: "📊"
---

# Markets Skill

Use this skill to search for prediction markets and view current prices across platforms.

## Commands

### Search Markets
Search for markets matching a query:
```
/markets trump 2028
/markets fed rate cut
/markets super bowl
```

### Get Price
Get current price for a specific market:
```
/price [market-id or slug]
```

### View Orderbook
View bid/ask spread:
```
/orderbook [market-id]
```

## Supported Platforms

- **Polymarket** - Crypto prediction market, highest volume
- **Kalshi** - CFTC-regulated, US legal
- **Manifold** - Play money, anyone can create markets
- **Metaculus** - Forecasting platform, community predictions

## Examples

User: "What's the current price on Trump winning 2028?"
→ Search Polymarket for "Trump 2028", return YES price

User: "Show me Fed rate cut markets"
→ Search all platforms for "Fed rate", list top results with prices

User: "Compare prices across platforms for Bitcoin ETF approval"
→ Search multiple platforms, show price comparison table
