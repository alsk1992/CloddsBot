---
name: orca
description: "Orca Whirlpools - concentrated liquidity on Solana"
command: orca
emoji: "🐋"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Orca Whirlpools

Orca is a Solana DEX with concentrated liquidity pools (Whirlpools).

## Commands

```
/orca swap <amount> <from> to <to>   Execute swap
/orca quote <amount> <from> to <to>  Get quote
/orca pools <token>                  List Whirlpools
```

## Examples

```
/orca swap 1 SOL to USDC
/orca pools ORCA
```
