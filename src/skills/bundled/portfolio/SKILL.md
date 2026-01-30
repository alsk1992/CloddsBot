---
name: portfolio
description: "Track your positions and P&L across prediction market platforms"
emoji: "💼"
---

# Portfolio Skill

Track your positions and performance across all prediction market platforms.

## Commands

### View Portfolio
```
/portfolio
/positions
/pnl
```

### Add Position (Manual)
```
/position add polymarket "Trump 2028" YES 100 @ 0.45
```

### Sync Positions (Auto)
```
/portfolio sync
```

## Features

### Position Tracking
- Entry price and current price
- Shares held
- Unrealized P&L ($ and %)
- Platform breakdown

### P&L Summary
- Total portfolio value
- Daily/weekly/monthly P&L
- Best and worst performers
- Platform-level P&L

### Multi-Platform Support
- Polymarket (via wallet address)
- Kalshi (via API)
- Manifold (via API key)

### Risk Analytics
- **Correlation Matrix**: See how your positions correlate with each other
- **Category Exposure**: Breakdown by politics, crypto, sports, economics, etc.
- **Concentration Risk**: HHI score and diversification metrics
- **Hedged Pairs**: Identify offsetting positions (long YES + short NO)

### Risk Commands
```
/portfolio risk          # Full risk metrics
/portfolio correlation   # Position correlation matrix
/portfolio exposure      # Category exposure breakdown
```

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

## Examples

User: "What's my portfolio looking like?"
→ Show all positions with current prices and P&L

User: "How much am I up today?"
→ Calculate daily P&L across all positions

User: "What's my exposure to politics markets?"
→ Filter positions by category, sum exposure

## Output Format

```
📊 PORTFOLIO

💰 Total Value: $2,450
📈 P&L: +$320 (+15.0%)

POSITIONS:
┌─────────────────────────────────────┐
│ Trump 2028 (Polymarket)             │
│ YES 100 shares @ $0.45 → $0.52      │
│ +$70 (+15.6%)                       │
├─────────────────────────────────────┤
│ Fed Rate Cut March (Kalshi)         │
│ YES 50 shares @ $0.30 → $0.35       │
│ +$25 (+16.7%)                       │
└─────────────────────────────────────┘
```
