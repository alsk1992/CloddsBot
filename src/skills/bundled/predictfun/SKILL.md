---
name: predictfun
description: "Predict.fun prediction market trading (BNB Chain)"
emoji: "🎯"
commands:
  - /pf
gates:
  envs:
    - PREDICTFUN_API_KEY
---

# Predict.fun

Full integration with Predict.fun, a BNB Chain prediction market with binary and categorical outcomes.

## Quick Start

```bash
# Set credentials
export PREDICTFUN_API_KEY="your-api-key"
export PREDICTFUN_PRIVATE_KEY="0x..."

# Search markets
/pf markets crypto

# Check balance
/pf balance

# Place order
/pf buy <marketId> YES 0.55 100
```

## Commands

### Market Data

| Command | Description |
|---------|-------------|
| `/pf markets [query]` | Search markets |
| `/pf market <id>` | Get market details |
| `/pf book <marketId>` | Show orderbook |

### Trading

| Command | Description |
|---------|-------------|
| `/pf buy <marketId> <outcome> <price> <size>` | Place buy order |
| `/pf sell <marketId> <outcome> <price> <size>` | Place sell order |
| `/pf cancel <orderId>` | Cancel order |
| `/pf cancelall` | Cancel all orders |
| `/pf orders` | List open orders |

**Examples:**
```bash
/pf buy market-123 YES 0.55 100   # Buy YES at 55c, 100 shares
/pf sell market-123 NO 0.40 50    # Sell NO at 40c, 50 shares
/pf cancel order-abc              # Cancel specific order
```

### Account

| Command | Description |
|---------|-------------|
| `/pf balance` | Check USDT balance |
| `/pf positions` | View open positions |
| `/pf redeem <conditionId>` | Redeem settled positions |
| `/pf merge <conditionId> <amount>` | Merge outcome tokens |

## Configuration

```bash
# Required for market data
export PREDICTFUN_API_KEY="your-api-key"

# Required for trading
export PREDICTFUN_PRIVATE_KEY="0x..."
```

Or in `~/.clodds/clodds.json`:

```json
{
  "trading": {
    "predictfun": {
      "apiKey": "${PREDICTFUN_API_KEY}",
      "privateKey": "${PREDICTFUN_PRIVATE_KEY}"
    }
  }
}
```

## Features

- **BNB Chain** - Fast, low-cost transactions (chainId 56)
- **Binary & Categorical** - Multiple market types
- **Order Signing** - Secure wallet signatures via SDK
- **Position Management** - Track & redeem positions
- **Merge/Split** - Convert between collateral and outcome tokens

## Trading Notes

1. **Index Sets**: Binary markets use `indexSet = 1` for YES, `indexSet = 2` for NO
2. **Merging**: Requires equal amounts of all outcome tokens
3. **Fees**: Check platform for current fee structure

## Resources

- [Predict.fun App](https://predict.fun)
- [BscScan](https://bscscan.com)
