---
name: drift
description: "Drift Protocol - perpetuals and prediction markets on Solana"
command: drift
emoji: "🌊"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Drift Protocol

Drift is a Solana DEX for perpetual futures and prediction markets.

## Commands

### Trading
```
/drift long <market> <size> [price]    Open long position
/drift short <market> <size> [price]   Open short position
/drift close <market>                  Close position
/drift cancel [orderId]                Cancel order(s)
```

### Positions & Orders
```
/drift positions                       View open positions
/drift orders                          View open orders
/drift balance                         Check account balance
```

### Market Info
```
/drift markets                         List available markets
/drift market <index>                  Get market details
/drift leverage <market> <amount>      Set leverage
```

## Examples

```
/drift long SOL-PERP 0.5
/drift short BTC-PERP 0.01 95000
/drift positions
/drift balance
/drift leverage SOL-PERP 5
```

## Market Types

- **perp**: Perpetual futures (SOL-PERP, BTC-PERP, ETH-PERP)
- **spot**: Spot markets
- **prediction**: Prediction markets
