---
name: crypto-hft
description: "Automated trading on Polymarket 15-minute crypto binary markets"
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

# Crypto HFT - 15-Minute Market Trading

Trade Polymarket's 15-minute crypto binary markets (BTC, ETH, SOL, XRP) with 4 automated strategies. Each round lasts 15 minutes with UP/DOWN token pairs that settle at 0 or 1.

Starts in **dry-run mode** by default (no real orders).

## Quick Start

```
/crypto-hft start                          # Start dry-run on BTC,ETH,SOL,XRP
/crypto-hft start BTC,ETH --dry-run       # Specific assets, dry run
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
/crypto-hft markets      Active 15-min markets from Gamma API
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

| Preset | Size | Strategies | Risk |
|--------|------|-----------|------|
| **conservative** | $10 | mean_reversion, penny_clipper | Low - dry run, tight stops |
| **aggressive** | $50 | All 4 | High - live, wide stops |
| **scalper** | $20 | penny_clipper only | Medium - ratchet on |
| **momentum_only** | $30 | momentum only | Medium - ratchet + trailing |

## Exit Logic

Positions are monitored every 500ms with 9 exit types (in priority order):

1. **Force exit** - < 30s before market expiry
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
