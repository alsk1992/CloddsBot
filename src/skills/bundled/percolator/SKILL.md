---
name: percolator
description: "Trade on-chain Solana perpetual futures with leverage via the Percolator protocol, including deposits, withdrawals, and position management. Use when users mention Percolator, Solana perps, or on-chain perpetual futures."
command: percolator
emoji: "⚡"
---

# Percolator

On-chain Solana perpetual futures with leverage via Percolator protocol.

## Commands

```
/percolator status               Show market state (price, OI, funding, spread)
/percolator positions            View your open positions
/percolator long <size>          Open long position (size in USD)
/percolator short <size>         Open short position (size in USD)
/percolator deposit <amount>     Deposit USDC collateral
/percolator withdraw <amount>    Withdraw USDC collateral
/percolator help                 Show help
```

## Examples

```bash
# Check current market state
/percolator status

# Open a $100 long position
/percolator long 100

# Open a $50 short position
/percolator short 50

# Deposit USDC collateral
/percolator deposit 500
```

## Workflow

1. **Deposit** USDC collateral with `/percolator deposit`
2. **Check market** state (price, OI, funding) via `/percolator status`
3. **Open positions** with `/percolator long` or `/percolator short`
4. **Monitor** open positions with `/percolator positions`
5. **Withdraw** collateral when done with `/percolator withdraw`

## Notes

- Position sizes are denominated in USD
- Collateral is in USDC
- Funding rates and open interest are visible via `/percolator status`
