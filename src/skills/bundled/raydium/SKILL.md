---
name: raydium
description: "Raydium AMM - high volume Solana DEX"
command: ray
emoji: "💜"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Raydium DEX

Raydium is a high-volume AMM on Solana with concentrated liquidity pools.

## Commands

```
/ray swap <amount> <from> to <to>    Execute swap on Raydium
/ray quote <amount> <from> to <to>   Get quote
/ray pools <token>                   List pools for token
```

## Examples

```
/ray swap 1 SOL to USDC
/ray quote 100 USDC to RAY
/ray pools SOL
```
