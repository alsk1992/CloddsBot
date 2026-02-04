---
name: mm
description: "Market making - two-sided quoting with inventory management"
emoji: "📊"
gates:
  envs:
    anyOf:
      - POLY_API_KEY
      - KALSHI_API_KEY
---

# Market Making Skill

Automated two-sided quoting on prediction markets with inventory skew, volatility-adjusted spreads, and risk controls.

## Supported Platforms

- Polymarket (post-only maker orders, zero taker fees)
- Kalshi

---

## Chat Commands

### Lifecycle

```
/mm start <platform> <marketId> <tokenId> [flags]   Start market making
/mm stop <id>                                        Stop and cancel all orders
/mm list                                             List active market makers
```

### Monitoring

```
/mm status                     Overview of all active MMs
/mm status <id>                Detailed state for one MM
```

### Configuration

```
/mm config <id>                View current config as JSON
/mm config <id> --spread 3     Update config (takes effect next requote)
```

---

## Start Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--spread N` | 2 | Base half-spread in cents |
| `--min-spread N` | 1 | Minimum spread floor (cents) |
| `--max-spread N` | 10 | Maximum spread cap (cents) |
| `--size N` | 50 | Order size per side (shares) |
| `--max-inventory N` | 500 | Max inventory before aggressive skew |
| `--skew N` | 0.5 | Inventory skew factor (0-1) |
| `--vol-mult N` | 10 | Volatility multiplier for spread widening |
| `--alpha N` | 0.3 | EMA alpha for fair value smoothing (0-1) |
| `--fv-method M` | weighted_mid | Fair value method: mid_price, weighted_mid, vwap, ema |
| `--interval N` | 5000 | Requote interval in ms |
| `--threshold N` | 1 | Min price change (cents) to trigger requote |
| `--max-pos N` | 1000 | Max position value in USD |
| `--max-loss N` | 100 | Max loss before auto-halt (USD) |
| `--max-orders N` | 1 | Orders per side (levels) |
| `--level-spacing N` | (=spread) | Cents between price levels |
| `--level-decay N` | 0.5 | Size decay per level (0-1, e.g. 0.5 = each level half of previous) |
| `--neg-risk true` | false | Enable negative risk mode (Polymarket crypto) |
| `--name "Name"` | auto | Display name for the outcome |

---

## Examples

```
# Start with defaults
/mm start polymarket 0xabc123 98765

# Custom spread and sizing
/mm start polymarket 0xabc123 98765 --spread 3 --size 100 --max-inventory 1000

# Tight spread for liquid market
/mm start polymarket 0xabc123 98765 --spread 1 --min-spread 1 --max-spread 5 --interval 2000

# 3-level quoting: L1=50 shares, L2=25, L3=12 — spaced 2c apart
/mm start polymarket 0xabc123 98765 --max-orders 3 --level-spacing 2 --level-decay 0.5 --size 50

# Check all running MMs
/mm status

# Widen spread on the fly
/mm config polymarket_98765678 --spread 4

# Shut down
/mm stop polymarket_98765678
```

---

## How It Works

1. **Fair value** computed from orderbook (weighted mid, VWAP, or EMA)
2. **Spread** adjusted by recent volatility (wider in volatile markets)
3. **Skew** shifts quotes away from overweight side to manage inventory
4. **Quotes** placed as post-only maker orders (bid and ask)
5. **Requote** cycle: cancel all, recalculate, place new orders
6. **Auto-halt** if realized P&L exceeds max loss threshold

---

## API Usage

```typescript
import { createMMStrategy, type MMConfig } from '../trading/market-making';

const config: MMConfig = {
  id: 'btc-yes',
  platform: 'polymarket',
  marketId: '0x...',
  tokenId: '12345',
  outcomeName: 'BTC > 100k',
  baseSpreadCents: 2,
  minSpreadCents: 1,
  maxSpreadCents: 10,
  orderSize: 50,
  maxInventory: 500,
  skewFactor: 0.5,
  volatilityMultiplier: 10,
  fairValueAlpha: 0.3,
  fairValueMethod: 'weighted_mid',
  requoteIntervalMs: 5000,
  requoteThresholdCents: 1,
  maxPositionValueUsd: 1000,
  maxLossUsd: 100,
  maxOrdersPerSide: 1,
};

const strategy = createMMStrategy(config, { execution, feeds });
botManager.registerStrategy(strategy);
await botManager.startBot(strategy.config.id);
```
