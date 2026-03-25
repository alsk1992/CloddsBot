---
name: ticks
description: "Query historical tick, OHLC, and orderbook data from TimescaleDB. Analyze price action, volume, spread history, and market depth over time. Use when users need historical market data, candlestick charts, tick-by-tick analysis, or orderbook snapshots."
emoji: "📊"
---

# Tick Data Skill

Query historical tick, OHLC, and orderbook data from TimescaleDB.

## Commands

| Command | Description |
|---------|-------------|
| `/ticks <platform> <marketId>` | Get recent ticks (last 24h) |
| `/ticks ohlc <platform> <marketId> --outcome <id>` | Get OHLC candles |
| `/ticks spread <platform> <marketId>` | Get spread history |
| `/ticks stats` | Get tick recorder stats |

## Options

| Option | Description |
|--------|-------------|
| `--outcome <id>` | Filter by outcome ID |
| `--interval <int>` | OHLC interval: `1m`, `5m`, `15m`, `1h`, `4h`, `1d` |
| `--limit <n>` | Limit number of results |

## Examples

```
/ticks polymarket 0x1234abcd
/ticks ohlc polymarket 0x1234 --outcome 0x5678 --interval 1h
/ticks spread polymarket 0x1234 --limit 50
/ticks stats
```

## Requirements

- TimescaleDB tick recorder must be enabled
- Configure in `clodds.config.yaml`:

```yaml
tickRecorder:
  enabled: true
  connectionString: postgres://user:pass@localhost:5432/clodds
```

## Output

### Ticks
Shows price history with timestamps and price changes.

### OHLC
Shows candlestick data with open, high, low, close, and tick count.
Includes period change summary.

### Spread
Shows orderbook spread history with mid price and depth.
Includes spread statistics (avg, min, max).

### Stats
Shows recorder status including:
- Database connection status
- Total ticks/orderbooks recorded
- Buffer pending counts
- Last flush time
- Active platforms
