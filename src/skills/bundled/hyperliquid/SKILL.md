---
name: hyperliquid
description: Hyperliquid L1 perps DEX (69% market share)
emoji: "🔷"
commands:
  - /hl
---

# Hyperliquid

Full integration with the dominant perpetual futures DEX. 130+ perp markets, spot trading, HLP vault, TWAP orders.

## Quick Start

```bash
# Set credentials
export HYPERLIQUID_WALLET="0x..."
export HYPERLIQUID_PRIVATE_KEY="0x..."

# Check balance
/hl balance

# Open a position
/hl long BTC 0.1
/hl short ETH 1 3000

# Close position
/hl close BTC
```

## Commands

### Market Data

| Command | Description |
|---------|-------------|
| `/hl stats` | HLP TVL, APR, top funding rates |
| `/hl markets [query]` | List perp/spot markets |
| `/hl price <coin>` | Get current price |
| `/hl book <coin>` | Show orderbook depth |
| `/hl candles <coin> [1m\|5m\|15m\|1h\|4h\|1d]` | OHLCV candle data |
| `/hl funding [coin]` | Funding rates (current + predicted) |

### Account

| Command | Description |
|---------|-------------|
| `/hl balance` | Positions, balances, margin |
| `/hl portfolio` | PnL breakdown (day/week/month/all) |
| `/hl orders` | List open orders |
| `/hl orders cancel <coin> [orderId]` | Cancel orders |
| `/hl orders cancelall` | Cancel all orders |
| `/hl fills [coin]` | Recent trade fills |
| `/hl history` | Order history |

### Trading

| Command | Description |
|---------|-------------|
| `/hl long <coin> <size> [price]` | Open long position |
| `/hl short <coin> <size> [price]` | Open short position |
| `/hl close <coin>` | Close position at market |
| `/hl closeall` | Close all positions |
| `/hl leverage <coin> <1-50>` | Set leverage |
| `/hl margin <coin> <amount>` | Add/remove isolated margin |

**Examples:**
```bash
/hl long BTC 0.1           # Market long 0.1 BTC
/hl long BTC 0.1 45000     # Limit long at $45,000
/hl short ETH 1            # Market short 1 ETH
/hl close BTC              # Close BTC position
/hl leverage BTC 10        # Set 10x leverage
```

### TWAP Orders

Execute large orders over time to minimize slippage.

| Command | Description |
|---------|-------------|
| `/hl twap buy <coin> <size> <minutes>` | Start TWAP buy |
| `/hl twap sell <coin> <size> <minutes>` | Start TWAP sell |
| `/hl twap cancel <coin> <twapId>` | Cancel TWAP |
| `/hl twap status` | Show active TWAP fills |

**Example:**
```bash
/hl twap buy BTC 1 60      # Buy 1 BTC over 60 minutes
/hl twap sell ETH 10 30    # Sell 10 ETH over 30 minutes
```

### Spot Trading

| Command | Description |
|---------|-------------|
| `/hl spot markets` | List spot markets |
| `/hl spot book <coin>` | Spot orderbook |
| `/hl spot buy <coin> <amount> [price]` | Buy spot |
| `/hl spot sell <coin> <amount> [price]` | Sell spot |

### HLP Vault

Earn yield by providing liquidity to the HLP vault.

| Command | Description |
|---------|-------------|
| `/hl hlp` | Show vault stats (TVL, APR) |
| `/hl hlp deposit <amount>` | Deposit USDC to vault |
| `/hl hlp withdraw <amount>` | Withdraw from vault |
| `/hl vaults` | Your vault positions |

### Transfers

| Command | Description |
|---------|-------------|
| `/hl transfer spot2perp <amount>` | Move USDC to perps |
| `/hl transfer perp2spot <amount>` | Move USDC to spot |
| `/hl transfer send <address> <amount>` | Send USDC on Hyperliquid |
| `/hl transfer withdraw <address> <amount>` | Withdraw to L1 (Arbitrum) |

### Account Info

| Command | Description |
|---------|-------------|
| `/hl fees` | Your fee tier & rate limits |
| `/hl points` | Points balance |
| `/hl referral` | Referral info & rewards |
| `/hl claim` | Claim referral rewards |
| `/hl leaderboard [day\|week\|month\|allTime]` | Top traders |
| `/hl sub` | List subaccounts |
| `/hl sub create <name>` | Create subaccount |
| `/hl lend` | Borrow/lend rates |

## Shortcuts

Most commands have short aliases:

| Full | Short |
|------|-------|
| `/hl balance` | `/hl b` |
| `/hl markets` | `/hl m` |
| `/hl price` | `/hl p` |
| `/hl book` | `/hl ob` |
| `/hl candles` | `/hl c` |
| `/hl funding` | `/hl f` |
| `/hl orders` | `/hl o` |
| `/hl history` | `/hl h` |
| `/hl long` | `/hl l` |
| `/hl short` | `/hl s` |
| `/hl leverage` | `/hl lev` |
| `/hl portfolio` | `/hl pf` |
| `/hl leaderboard` | `/hl lb` |
| `/hl referral` | `/hl ref` |

## Configuration

```bash
# Required for trading
export HYPERLIQUID_WALLET="0x..."
export HYPERLIQUID_PRIVATE_KEY="0x..."

# Optional: dry run mode (no real trades)
export DRY_RUN=true
```

## Features

- **130+ Perp Markets** with up to 50x leverage
- **Spot Trading** with native HYPE token
- **HLP Vault** - Earn yield providing liquidity
- **TWAP Orders** - Execute large orders over time
- **Points System** - Earn rewards for activity
- **Subaccounts** - Manage multiple strategies
- **Real-time WebSocket** - Live orderbook and fills

### Database/History

All trades are automatically logged to SQLite for tracking.

| Command | Description |
|---------|-------------|
| `/hl trades [coin] [limit]` | Trade history from database |
| `/hl dbstats [coin] [period]` | Win rate, PnL, profit factor |
| `/hl dbfunding [coin]` | Funding payments history |
| `/hl dbpositions [all]` | Position history |

**Stats periods:** `day`, `week`, `month`

**Example:**
```bash
/hl trades BTC 10           # Last 10 BTC trades
/hl dbstats week            # This week's performance
/hl dbstats ETH month       # ETH stats for the month
```

## Resources

- [Hyperliquid App](https://app.hyperliquid.xyz)
- [API Documentation](https://hyperliquid.gitbook.io/hyperliquid-docs)
