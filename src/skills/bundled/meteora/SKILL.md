---
name: meteora
description: "Meteora DLMM - dynamic liquidity market maker on Solana"
command: met
emoji: "☄️"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Meteora DLMM

Meteora uses Dynamic Liquidity Market Maker (DLMM) pools with bin-based pricing.

## Commands

```
/met swap <amount> <from> to <to>    Execute swap
/met quote <amount> <from> to <to>   Get quote
/met pools <token>                   List DLMM pools
```

## Examples

```
/met swap 1 SOL to USDC
/met pools SOL
```
