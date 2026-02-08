---
name: kamino
description: "Kamino Finance — Solana lending, borrowing, and liquidity vaults"
emoji: "🌀"
commands:
  - /kamino
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Kamino Finance

Kamino is Solana's largest lending protocol and liquidity vault provider. Deposit collateral, borrow assets, provide liquidity to automated vaults, and monitor health to avoid liquidation.

## Commands

### Lending
```
/kamino deposit <amount> <token>          Deposit collateral
/kamino withdraw <amount|all> <token>     Withdraw collateral
/kamino borrow <amount> <token>           Borrow assets
/kamino repay <amount|all> <token>        Repay borrowed assets
/kamino obligation                        View your positions
/kamino health                            Check health factor & liquidation risk
/kamino reserves                          List available reserves with rates
/kamino rates                             View supply/borrow APYs
```

### Liquidity Vaults
```
/kamino strategies                        List all vault strategies
/kamino strategy <address>                Get strategy details
/kamino vault-deposit <strat> <amtA> [amtB]  Deposit to vault
/kamino vault-withdraw <strat> [shares|all]  Withdraw from vault
/kamino shares                            View your vault shares
/kamino share-price <strategy>            Get strategy share price
```

### Info
```
/kamino markets                           List lending markets
```

## Examples

```
/kamino deposit 100 USDC
/kamino borrow 50 SOL
/kamino health
/kamino repay all SOL
/kamino rates
/kamino strategies
/kamino vault-deposit ABC123... 1000 500
```

## Configuration

```bash
export SOLANA_PRIVATE_KEY="your-base58-private-key"
export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"  # Optional
```

## See Also

- `/marginfi` — MarginFi lending protocol
- `/solend` — Solend lending protocol
- `/jup` — Jupiter DEX aggregator
- `/bags` — Portfolio overview
