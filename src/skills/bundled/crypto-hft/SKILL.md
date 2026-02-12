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
/crypto-hft start --preset 1h-all          # 1-hour all assets
/crypto-hft start --preset 4h-all          # 4-hour all assets (swing)
/crypto-hft start --preset daily-all       # Daily all assets (position)
/crypto-hft start BTC,ETH --dry-run       # 15-min specific assets, dry run
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

### By Market Duration

#### 5-Minute (BTC Only)
| Preset | Size | Max Pos | Strategies | Features |
|--------|------|---------|-----------|----------|
| **5min-btc** | $15 | 1 | All 4 | Aggressive - 10s min age |
| **5min-btc-conservative** | $10 | 1 | MR, PC | Conservative - 15s min age |

#### 1-Hour (All Assets)
| Preset | Size | Max Pos | Strategies | Features |
|--------|------|---------|-----------|----------|
| **1h-all** | $20 | 3 | All 4 | Balanced - ratchet + trailing |

#### 4-Hour (All Assets - Swing)
| Preset | Size | Max Pos | Strategies | Features |
|--------|------|---------|-----------|----------|
| **4h-all** | $30 | 4 | Mom + MR | Swing trading focus |

#### Daily (All Assets - Position)
| Preset | Size | Max Pos | Strategies | Features |
|--------|------|---------|-----------|----------|
| **daily-all** | $50 | 4 | Mom + MR | Position trading, tight ratchet |

#### 15-Minute (Classic - All Assets)
| Preset | Size | Max Pos | Strategies | Risk |
|--------|------|---------|-----------|------|
| **conservative** | $10 | 2 | MR, PC | Low - dry run, tight stops |
| **aggressive** | $50 | 4 | All 4 | High - live, wide stops |
| **scalper** | $20 | 3 | PC only | Medium - ratchet on |
| **momentum_only** | $30 | 3 | Mom only | Medium - ratchet + trailing |

**Legend:** MR=mean_reversion, PC=penny_clipper, Mom=momentum

## Market Duration Comparison

| Aspect | 5-Min | 1-Hour | 4-Hour | Daily |
|--------|-------|--------|--------|-------|
| **Assets** | BTC | All | All | All |
| **Duration** | 300s | 3,600s | 14,400s | 86,400s |
| **Min Round Age** | 10s | 60s | 120s | 600s |
| **Min Time Left** | 50s | 180s | 600s | 3,600s |
| **Force Exit** | 10s | 60s | 120s | 600s |
| **Best For** | HFT scalping | Fast swing | Swing trading | Position trading |
| **Liquidity** | Thin | Good | Very good | Excellent |
| **Fee Impact** | Critical | Moderate | Low | Very low |
| **Daily Cycles** | 288 | 24 | 6 | 1 |

**Trading Strategy by Duration:**
- **5-min**: Ultra-high frequency, requires tight risk management, penny_clipper focus
- **1-hour**: Balanced entry points, good for mean reversion + momentum
- **4-hour**: Swing trading, catch multi-hour trends, focus on momentum
- **Daily**: Position trading, macroeconomic drivers, long holding periods

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
