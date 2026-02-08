---
name: solend
description: "Solend — Solana lending and borrowing"
emoji: "💰"
commands:
  - /solend
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Solend

Solend is a decentralized lending and borrowing protocol on Solana. Supply assets to earn interest, borrow against collateral, and monitor health to avoid liquidation.

## Commands

### Lending
```
/solend deposit <amount> <token>       Deposit collateral
/solend withdraw <amount|all> <token>  Withdraw collateral
/solend borrow <amount> <token>        Borrow assets
/solend repay <amount|all> <token>     Repay borrowed assets
```

### Account
```
/solend obligation                     View your positions (deposits & borrows)
/solend health                         Check health factor & liquidation risk
```

### Markets
```
/solend reserves                       List reserves with APY & utilization
/solend rates                          View supply/borrow interest rates table
/solend markets                        List available lending markets
```

## Examples

```
/solend deposit 100 USDC
/solend borrow 1 SOL
/solend health
/solend repay all SOL
/solend withdraw all USDC
/solend reserves
/solend rates
```

## Configuration

```bash
export SOLANA_PRIVATE_KEY="your-base58-private-key"
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"  # Optional
```

## See Also

- `/kamino` — Kamino Finance lending + liquidity vaults
- `/marginfi` — MarginFi lending protocol
- `/jup` — Jupiter DEX aggregator
- `/bags` — Portfolio overview
