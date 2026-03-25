---
name: features
description: "Retrieve real-time market features and computed trading signals from tick and orderbook data for tracked prediction markets. Use when users ask about market features, trading signals, feature engine stats, or real-time market indicators."
command: features
emoji: "📈"
---

# Features

View real-time market features and trading signals computed from tick and orderbook data.

## Commands

```
/features get <platform> <marketId>       Get features for a specific market
/features all                             List all tracked markets
/features signals <platform> <marketId>   Get trading signals and recommendations
/features stats                           Show feature engine statistics
/features help                            Show help
```

## Workflow

1. **List tracked markets** with `/features all` to see what the feature engine is monitoring.
2. **Get features** for a specific market with `/features get <platform> <marketId>` to inspect computed indicators (e.g., momentum, volatility, orderbook imbalance).
3. **Check signals** with `/features signals <platform> <marketId>` to get actionable trading recommendations derived from the feature set.
4. **Monitor engine health** with `/features stats` to view processing rates, latency, and tracked market counts.

## Examples

```
/features all                                 # List all tracked markets
/features get poly market-123                 # Get computed features for a Polymarket market
/features signals kalshi TRUMP-WIN            # Get trading signals for a Kalshi market
/features stats                               # Show feature engine statistics
```
