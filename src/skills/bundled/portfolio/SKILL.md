---
name: portfolio
description: "Track positions, P&L, and balances across prediction markets and futures exchanges. Use when users ask about portfolio value, daily gains, platform exposure, risk analytics, or whale tracking."
emoji: "💼"
---

# Portfolio Skill

Track your positions and performance across prediction markets and futures exchanges.

## Commands

### View Portfolio
```
/portfolio
/portfolio positions
/portfolio pnl
```

### History
```
/portfolio history          # Last 7 days (default)
/portfolio history 30d      # Last 30 days
/portfolio history 90d      # Last 90 days
```

### Sync Positions (Auto)
```
/portfolio sync
```

### Filter by Platform
```
/portfolio platform polymarket
/portfolio platform binance
```

### Risk
```
/portfolio risk          # Full risk metrics
/portfolio exposure      # Category exposure breakdown
```

## Features

### Position Tracking
- Entry price and current price
- Shares held
- Unrealized P&L ($ and %)
- Platform breakdown

### Futures Support
- Leverage display
- Long/Short side indicator
- Liquidation price
- Notional value
- Margin type (cross/isolated)

### P&L Summary
- Total portfolio value
- Daily/weekly/monthly P&L
- Best and worst performers
- Platform-level P&L

### Multi-Platform Support

**Prediction Markets:**
- Polymarket (via API key)
- Kalshi (via API key)
- Manifold (via API key)

**Futures Exchanges:**
- Hyperliquid (via wallet address + private key)
- Binance Futures (via API key + secret)
- Bybit (via API key + secret)
- MEXC (via API key + secret)

### Balance Tracking
- Available and locked balance per platform
- Polymarket: locked USDC calculated from open buy orders
- Futures: margin used vs available

### Portfolio History
- Snapshots taken automatically during hourly cron sync
- ASCII sparkline chart
- Start/end value with change ($, %)
- Peak and low values
- Table of recent data points

### Risk Analytics
- **Correlation Matrix**: See how your positions correlate with each other
- **Category Exposure**: Breakdown by politics, crypto, sports, economics, etc.
- **Concentration Risk**: HHI score and diversification metrics
- **Hedged Pairs**: Identify offsetting positions (long YES + short NO)

### Whale Tracking Integration
Track what large traders are doing:
```
/portfolio whales        # Top whales in your markets
/portfolio follow 0x...  # Follow a whale's positions
/portfolio smart-money   # Aggregate whale activity
```

### Crypto Whale Monitoring
Monitor large crypto transactions across chains:
```
/portfolio crypto-whales          # Recent whale activity
/portfolio crypto-whales solana   # Solana whales only
/portfolio crypto-whales top 10   # Top 10 by volume
```

## Environment Variables

```
# Prediction Markets
POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE
KALSHI_API_KEY, KALSHI_PRIVATE_KEY

# Futures Exchanges
HL_WALLET_ADDRESS, HL_PRIVATE_KEY
BINANCE_FUTURES_KEY, BINANCE_FUTURES_SECRET
BYBIT_API_KEY, BYBIT_API_SECRET
MEXC_API_KEY, MEXC_API_SECRET
```

## Examples

User: "What's my portfolio looking like?"
→ Show all positions with current prices and P&L

User: "How much am I up today?"
→ Calculate daily P&L across all positions

User: "What's my exposure to politics markets?"
→ Filter positions by category, sum exposure

User: "Show my Binance positions"
→ Filter to Binance futures positions with leverage info

## Output Format

```
Portfolio Summary

Total Value: $12,450
Positions: 8
Unrealized P&L: +$320 (+2.6%)
Realized P&L: $150

Balances:
  polymarket: $2,500 ($2,100 avail, $400 locked)
  binance: $5,000 ($3,200 avail, $1,800 locked)

BTCUSDT Perp [binance]
  LONG 10x: 0.5000 @ $98,500.00
  +$250.00 (+5.1%) | liq $89,100.00

Trump 2028 [polymarket]
  Yes: 100.00 @ $0.520
  +$70.00 (+15.6%)
```
