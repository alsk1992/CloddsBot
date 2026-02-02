---
name: betfair
description: "Betfair Exchange sports betting and trading"
emoji: "🏇"
commands:
  - /bf
gates:
  envs:
    - BETFAIR_APP_KEY
---

# Betfair Exchange

Full integration with Betfair Exchange, the world's largest sports betting exchange. Trade sports markets using back/lay orders.

## Quick Start

```bash
# Set credentials
export BETFAIR_APP_KEY="your-app-key"
export BETFAIR_SESSION_TOKEN="your-session-token"

# Search markets
/bf markets football

# Get market prices
/bf prices 1.234567890

# Place back order (bet FOR outcome)
/bf back 1.234567890 12345678 2.5 10

# Place lay order (bet AGAINST outcome)
/bf lay 1.234567890 12345678 2.5 10
```

## Commands

### Market Data

| Command | Description |
|---------|-------------|
| `/bf markets [query]` | Search markets |
| `/bf market <id>` | Get market details |
| `/bf prices <marketId>` | Current prices and volumes |
| `/bf book <marketId> <selectionId>` | Show orderbook |

### Trading

| Command | Description |
|---------|-------------|
| `/bf back <marketId> <selectionId> <odds> <stake>` | Place back order |
| `/bf lay <marketId> <selectionId> <odds> <stake>` | Place lay order |
| `/bf cancel <marketId> <betId>` | Cancel order |
| `/bf cancelall [marketId]` | Cancel all orders |
| `/bf orders [marketId]` | List open orders |

**Examples:**
```bash
/bf back 1.234 5678 2.0 10    # Back at 2.0 odds, £10 stake
/bf lay 1.234 5678 2.1 10     # Lay at 2.1 odds, £10 liability
/bf cancel 1.234 abc123       # Cancel specific order
```

### Account

| Command | Description |
|---------|-------------|
| `/bf balance` | Check account balance |
| `/bf positions` | View open positions |

## Configuration

```bash
# Required
export BETFAIR_APP_KEY="your-app-key"

# Either session token or username/password
export BETFAIR_SESSION_TOKEN="your-session-token"

# Or login credentials
export BETFAIR_USERNAME="your-username"
export BETFAIR_PASSWORD="your-password"
```

## Features

- **Back/Lay Trading** - Trade both sides of markets
- **Live Streaming** - Real-time price updates via WebSocket
- **Sports Coverage** - Football, tennis, horse racing, politics, and more
- **Low Fees** - Exchange model with 2-5% commission
- **Deep Liquidity** - World's largest betting exchange

## Event Types

| Sport | ID | Example Query |
|-------|-----|---------------|
| Soccer | 1 | `/bf markets champions league` |
| Tennis | 2 | `/bf markets wimbledon` |
| Horse Racing | 7 | `/bf markets ascot` |
| Politics | 2378961 | `/bf markets election` |
| Basketball | 7522 | `/bf markets nba` |

## Trading Notes

1. **Odds Format**: Betfair uses decimal odds (2.0 = evens, 3.0 = 2/1)
2. **Minimum Stake**: Usually £2/€2/$2
3. **Back vs Lay**: Back = betting FOR, Lay = betting AGAINST
4. **Liability**: Lay stake = liability / (odds - 1)

## Resources

- [Betfair Exchange](https://www.betfair.com/exchange/)
- [Betfair API Documentation](https://docs.developer.betfair.com/)
