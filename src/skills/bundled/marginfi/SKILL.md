---
name: marginfi
description: "MarginFi — Solana lending and borrowing"
emoji: "🏦"
commands:
  - /marginfi
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# MarginFi

MarginFi is a lending and borrowing protocol on Solana. Deposit collateral, borrow assets, and monitor your health factor to avoid liquidation.

## Commands

### Lending
```
/marginfi deposit <amount> <token>     Deposit collateral
/marginfi withdraw <amount|all> <token> Withdraw collateral
/marginfi borrow <amount> <token>      Borrow assets
/marginfi repay <amount|all> <token>   Repay borrowed assets
```

### Account
```
/marginfi account                      View positions (deposits & borrows)
/marginfi health                       Check health factor & liquidation risk
```

### Markets
```
/marginfi banks                        List all lending pools with APY
/marginfi rates                        View supply/borrow interest rates table
```

## Examples

```
/marginfi deposit 100 USDC
/marginfi borrow 1 SOL
/marginfi health
/marginfi repay all SOL
/marginfi withdraw all USDC
/marginfi banks
/marginfi rates
```

## Configuration

```bash
export SOLANA_PRIVATE_KEY="your-base58-private-key"
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"  # Optional
```

## See Also

- `/kamino` — Kamino Finance lending + liquidity vaults
- `/solend` — Solend lending protocol
- `/jup` — Jupiter DEX aggregator
- `/bags` — Portfolio overview
