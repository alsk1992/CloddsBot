---
name: divergence
description: "Spot vs Polymarket divergence trading on 15-minute crypto markets"
commands:
  - /divergence
  - /div
gates:
  envs:
    - POLY_PRIVATE_KEY
    - POLY_FUNDER_ADDRESS
    - POLY_API_KEY
    - POLY_API_SECRET
    - POLY_API_PASSPHRASE
---

# Divergence Trading - Spot vs Poly Price Lag

Detects when Binance spot prices move but Polymarket 15-minute binary markets haven't caught up yet. Buys the lagging side and sells when it corrects.

Strategy tags match the CLAUDE.md encoding: `BTC_DOWN_s12-14_w15` (0.12-0.14% move in 15s window).

Starts in **dry-run mode** by default (no real orders).

## Quick Start

```
/div start                     # Dry-run on BTC,ETH,SOL,XRP
/div start BTC,ETH --size 30   # Specific assets + size
/div status                    # Stats, open positions
/div stop                      # Stop and show summary
```

## Commands

### Start / Stop
```
/div start [ASSETS] [--size N] [--dry-run]
/div stop
```

### Monitor
```
/div status       Stats + open positions + round info
/div positions    Last 20 closed trades with strategy tags
/div markets      Active 15-min markets from Gamma API
```

### Configure
```
/div config                           Show current config
/div config --tp 20 --sl 30          Set TP/SL %
/div config --size 50                 Set trade size
/div config --windows 5,10,30         Set detection windows
```

## Detection Algorithm

For each spot tick, across all configured windows (5s, 10s, 15s, 30s, 60s, 90s, 120s):

1. Look up spot price N seconds ago via binary search
2. Calculate `spotMovePct = (now - then) / then * 100`
3. If move >= threshold AND poly is fresh (< 5s stale):
   - Generate signal with strategy tag: `{ASSET}_{DIR}_s{bucket}_w{window}`
   - e.g., `BTC_DOWN_s12-14_w15` = 0.12-0.14% spot drop over 15s

## Threshold Buckets

| Bucket | Spot Move Range |
|--------|----------------|
| s08-10 | 0.08% - 0.10% |
| s10-12 | 0.10% - 0.12% |
| s12-14 | 0.12% - 0.14% |
| s14-16 | 0.14% - 0.16% |
| s16-20 | 0.16% - 0.20% |
| s20+   | 0.20%+         |

## Exit Logic

1. **Force exit** — < 30s before market expiry
2. **Take profit** — PnL >= 15% (configurable)
3. **Stop loss** — PnL <= -25% (configurable)
4. **Trailing stop** — Activated at +10%, exits if drops 8% from HWM
5. **Time exit** — < 2min before expiry
