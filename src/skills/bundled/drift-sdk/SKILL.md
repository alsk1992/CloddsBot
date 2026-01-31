---
name: drift-sdk
description: "Drift Protocol perpetual futures trading on Solana (direct SDK)"
emoji: "🌊"
commands:
  - /drift
gates:
  envs:
    - DRIFT_PRIVATE_KEY
---

# Drift Protocol SDK

Direct SDK-based trading on Drift Protocol, Solana's leading perpetual futures DEX. Bypass the gateway requirement with native SDK integration.

## Quick Start

```bash
# Set credentials
export DRIFT_PRIVATE_KEY="your-solana-private-key"
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"

# Check balance
/drift balance

# Open a position
/drift long BTC 0.1
/drift short ETH 1 2500

# Close position
/drift close BTC
```

## Commands

### Trading

| Command | Description |
|---------|-------------|
| `/drift long <coin> <size> [price]` | Open long position |
| `/drift short <coin> <size> [price]` | Open short position |
| `/drift close <coin>` | Close position at market |
| `/drift closeall` | Close all positions |
| `/drift leverage <coin> <1-20>` | Set leverage |

**Examples:**
```bash
/drift long BTC 0.1           # Market buy 0.1 BTC
/drift short ETH 1 2500       # Limit sell 1 ETH at $2500
/drift leverage SOL 5         # Set SOL leverage to 5x
```

### Orders

| Command | Description |
|---------|-------------|
| `/drift orders` | List open orders |
| `/drift cancel <orderId>` | Cancel order by ID |
| `/drift cancel <coin>` | Cancel all orders for coin |
| `/drift cancelall` | Cancel all orders |
| `/drift modify <orderId> [price] [size]` | Modify order |

### Account

| Command | Description |
|---------|-------------|
| `/drift balance` | Collateral, margin, health factor |
| `/drift positions` | Open positions with PnL |

## Configuration

```bash
# Required
export DRIFT_PRIVATE_KEY="base58_or_json_array"

# Optional
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
export DRY_RUN=true  # Test mode
```

## Features

- **Direct SDK** - No gateway server required
- **Perp & Spot** - Trade both market types
- **Order Types** - Market, limit, post-only, IOC, FOK
- **Position Management** - Track unrealized PnL, entry prices
- **Risk Metrics** - Health factor, margin usage, liquidation prices
- **Leverage Control** - Set per-market leverage (1-20x)

## Markets

| Market | Index | Max Leverage |
|--------|-------|--------------|
| BTC-PERP | 0 | 20x |
| ETH-PERP | 1 | 20x |
| SOL-PERP | 2 | 20x |
| ... | ... | ... |

## Resources

- [Drift Protocol](https://drift.trade)
- [Drift Docs](https://docs.drift.trade)
- [Solana](https://solana.com)
