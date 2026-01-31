---
name: jupiter
description: "Jupiter DEX aggregator - best swap routes on Solana"
command: jup
emoji: "🪐"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Jupiter Aggregator

Jupiter finds the best swap routes across all Solana DEXes for optimal pricing.

## Commands

```
/jup swap <amount> <from> to <to>    Execute swap via Jupiter
/jup quote <amount> <from> to <to>   Get quote without executing
/jup route <from> <to> <amount>      Show detailed route info
```

## Examples

```
/jup swap 1 SOL to USDC
/jup quote 100 USDC to JUP
/jup route SOL BONK 1
```

## Features

- Best route across 20+ DEXes
- Automatic route splitting
- MEV protection
- Priority fee support
