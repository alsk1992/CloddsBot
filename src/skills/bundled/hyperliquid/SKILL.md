---
name: hyperliquid
description: Hyperliquid L1 perps DEX (69% market share)
emoji: "🔷"
commands:
  - /hl
---

# Hyperliquid

Full integration with the dominant perpetual futures DEX.

## Commands

### `/hl stats`
Show HLP vault TVL, APR, and top funding rates.

### `/hl markets [query]`
List perpetual and spot markets. Optional search filter.

### `/hl book <coin>`
Show live orderbook for a market (e.g., `/hl book BTC`).

### `/hl balance`
Show your account balances, positions, and points.

### `/hl hlp [action] [amount]`
HLP vault operations:
- `/hl hlp` - Show vault stats
- `/hl hlp deposit 1000` - Deposit $1000
- `/hl hlp withdraw 500` - Withdraw $500

### `/hl leaderboard [timeframe]`
Top traders. Timeframes: day, week, month, allTime

### `/hl spot <subcommand>`
Spot trading:
- `/hl spot markets` - List spot markets
- `/hl spot book HYPE` - Spot orderbook
- `/hl spot buy HYPE 100 5.50` - Limit buy
- `/hl spot sell HYPE 100` - Market sell

### `/hl twap <action>`
TWAP orders for large positions:
- `/hl twap buy BTC 10 60` - Buy 10 BTC over 60 minutes
- `/hl twap sell ETH 50 30` - Sell 50 ETH over 30 minutes
- `/hl twap cancel BTC 123` - Cancel TWAP by coin and ID

### `/hl points`
Your points breakdown (trading, referrals, HLP, staking).

## Configuration

```bash
export HYPERLIQUID_WALLET="0x..."
export HYPERLIQUID_PRIVATE_KEY="0x..."
```

## Features

- **130+ Perp Markets** with up to 50x leverage
- **Spot Trading** with native HYPE token
- **HLP Vault** - Earn yield providing liquidity
- **TWAP Orders** - Execute large orders over time
- **Points System** - Earn rewards for activity
- **Real-time WebSocket** - Live orderbook and fills

## Resources

- [Hyperliquid App](https://app.hyperliquid.xyz)
- [API Documentation](https://hyperliquid.gitbook.io/hyperliquid-docs)
