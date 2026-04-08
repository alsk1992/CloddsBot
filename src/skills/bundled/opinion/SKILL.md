---
name: opinion
description: "Trade prediction markets on Opinion.trade via BNB Chain on-chain CLOB with limit orders, orderbook views, and position tracking. Use when users mention Opinion.trade, BNB prediction market, or on-chain CLOB."
emoji: "🗳️"
commands:
  - /op
---

# Opinion.trade

Full integration with Opinion.trade, a BNB Chain prediction market with on-chain CLOB (Central Limit Order Book).

## Quick Start

```bash
# Set credentials
export OPINION_API_KEY="your-api-key"
export OPINION_PRIVATE_KEY="0x..."

# Search markets
/op markets trump

# Get price
/op price 813

# Place order
/op buy 813 YES 0.55 100
```

## Commands

### Market Data

| Command | Description |
|---------|-------------|
| `/op markets [query]` | Search markets |
| `/op market <id>` | Get market details |
| `/op price <id>` | Current prices |
| `/op book <tokenId>` | Show orderbook |

### Trading

| Command | Description |
|---------|-------------|
| `/op buy <marketId> <outcome> <price> <size>` | Place buy order |
| `/op sell <marketId> <outcome> <price> <size>` | Place sell order |
| `/op cancel <orderId>` | Cancel order |
| `/op cancelall` | Cancel all orders |
| `/op orders` | List open orders |

**Examples:**
```bash
/op buy 813 YES 0.55 100     # Buy YES at 55c, 100 shares
/op sell 813 NO 0.40 50      # Sell NO at 40c, 50 shares
/op cancel abc123            # Cancel specific order
```

### Account

| Command | Description |
|---------|-------------|
| `/op balance` | Check USDT balance |
| `/op positions` | View open positions |

## Configuration

```bash
# Required for market data
export OPINION_API_KEY="your-api-key"

# Required for trading
export OPINION_PRIVATE_KEY="0x..."
export OPINION_MULTISIG_ADDRESS="0x..."  # Vault/funder address
```

## Features

- **BNB Chain** - Fast, low-cost transactions
- **On-chain CLOB** - Fully decentralized orderbook
- **Prediction Markets** - Politics, crypto, sports, and more
- **Real-time WebSocket** - Live price updates
- **EIP-712 Signing** - Secure order authentication

## Resources

- [Opinion.trade App](https://opinion.trade)
- [API Documentation](https://docs.opinion.trade)
