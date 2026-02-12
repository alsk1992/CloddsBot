---
name: crypto-hft
description: "Trade crypto binary markets on Polymarket (15-min & 5-min BTC) with 4 automated strategies"
commands:
  - /crypto-hft
  - /hft
gates:
  envs:
    - POLY_PRIVATE_KEY
    - POLY_FUNDER_ADDRESS
    - POLY_API_KEY
    - POLY_API_SECRET
    - POLY_API_PASSPHRASE
---

# Crypto HFT - Binary Market Trading

Trade Polymarket's crypto binary markets with 4 automated strategies:
- **15-minute markets**: BTC, ETH, SOL, XRP (all assets supported)
- **5-minute markets**: BTC only (fastest settlement, high frequency)

Each round has UP/DOWN token pairs that settle at 0 or 1 using Chainlink price feeds.

Starts in **dry-run mode** by default (no real orders).

## Quick Start

```
/crypto-hft start                          # 15-min (default): BTC,ETH,SOL,XRP
/crypto-hft start --preset 5min-btc        # 5-minute BTC (fast, aggressive)
/crypto-hft start BTC,ETH --dry-run       # 15-min specific assets, dry run
/crypto-hft start --preset scalper         # Use a built-in preset
/crypto-hft status                         # Check stats + open positions
/crypto-hft stop                           # Stop and show summary
```

For live trading, set Polymarket env vars and omit `--dry-run`:
```bash
export POLY_PRIVATE_KEY="..."
export POLY_FUNDER_ADDRESS="..."
export POLY_API_KEY="..."
export POLY_API_SECRET="..."
export POLY_API_PASSPHRASE="..."
```

## Commands

### Start / Stop
```
/crypto-hft start [ASSETS] [--size N] [--dry-run] [--preset NAME]
/crypto-hft stop
```

### Monitor
```
/crypto-hft status       Stats, round info, open positions
/crypto-hft positions    Last 20 closed trades with PnL
/crypto-hft markets      Active markets from Gamma API (5-min or 15-min)
/crypto-hft round        Current round slot and timing
```

### Configure (while running)
```
/crypto-hft config                                 Show current config
/crypto-hft config --tp 15 --sl 12                 Set take-profit/stop-loss %
/crypto-hft config --size 30 --max-pos 4           Set trade size and max positions
/crypto-hft config --ratchet on --trailing off      Toggle exit features
/crypto-hft config --max-loss 100                   Set daily loss limit
```

### Strategy Control
```
/crypto-hft enable momentum          Enable a strategy
/crypto-hft disable expiry_fade      Disable a strategy
```

### Presets
```
/crypto-hft preset list              Show all presets
/crypto-hft preset save my_config    Save current config as preset
/crypto-hft preset load scalper      Load a preset (into running engine or for next start)
/crypto-hft preset delete my_config  Delete a saved preset
```

## Strategies

| Strategy | Entry Condition | Order Mode | Best For |
|----------|----------------|------------|----------|
| **momentum** | Spot price moved, poly lagging | maker_then_taker | Catching delayed reactions |
| **mean_reversion** | Token mispriced, spot calm | maker (0% fee) | Range-bound markets |
| **penny_clipper** | Oscillating in zone, price below mean | maker (0% fee) | Tight spread scalping |
| **expiry_fade** | Near expiry, skewed pricing, flat spot | taker (speed) | Late-round mean reversion |

## Built-in Presets

### 15-Minute Markets
| Preset | Size | Strategies | Risk |
|--------|------|-----------|------|
| **conservative** | $10 | mean_reversion, penny_clipper | Low - dry run, tight stops |
| **aggressive** | $50 | All 4 | High - live, wide stops |
| **scalper** | $20 | penny_clipper only | Medium - ratchet on |
| **momentum_only** | $30 | momentum only | Medium - ratchet + trailing |

### 5-Minute Markets (BTC Only)
| Preset | Size | Strategies | Features |
|--------|------|-----------|----------|
| **5min-btc** | $15 | All 4 | Aggressive - 10s min age, 50s min time left |
| **5min-btc-conservative** | $10 | mean_reversion, penny_clipper | Conservative - 15s min age, 60s min time left |

## 5-Minute vs 15-Minute Markets

| Aspect | 5-Minute | 15-Minute |
|--------|----------|-----------|
| **Assets** | BTC only | BTC, ETH, SOL, XRP |
| **Duration** | 5 minutes (300s) | 15 minutes (900s) |
| **Min Round Age** | 10s | 30s |
| **Min Time Left** | 50s | 130s |
| **Force Exit** | 10s before | 30s before |
| **Best For** | High-frequency scalping | Swing/momentum capture |
| **Liquidity** | Thinner (watch spreads) | Better established |
| **Fee Impact** | Critical (3x cycles) | Manageable |

**5-minute trading tips:**
- Lower position sizes due to faster settlement
- Tighter stops to avoid being wedged in expiry
- Focus on liquid tokens and penny_clipper/mean_reversion strategies
- Expect smaller wins but higher frequency
- Watch orderbook staleness (orders fill slower near expiry)

## Exit Logic

Positions are monitored every 500ms with 9 exit types (in priority order):

1. **Force exit** - < 30s before expiry (15-min) or < 10s (5-min)
2. **Take profit** - PnL >= TP% (default 15%)
3. **Stop loss** - PnL <= -SL% (default 12%)
4. **Ratchet floor** - Progressive giveback from confirmed high-water mark
5. **Trailing stop** - Tightens as expiry approaches
6. **Depth collapse** - Orderbook depth dropped 60%+ while price dropping
7. **Stale profit** - Profitable but bid unchanged for 7s
8. **Stagnant profit** - At +3% for 13s with no progress
9. **Time exit** - Approaching minimum time left

## Architecture

```
Binance WS (spot) --> CryptoFeed --> Strategy Evaluators --> Entry Signals
Gamma API ---------> MarketScanner --> Round Detection    |
                                                          v
Poly Orderbook ----> OBI/Spread/Depth --> Exit Checks --> ExecutionService
                                    |
                              PositionManager (ratchet, trailing, depth collapse)
```
