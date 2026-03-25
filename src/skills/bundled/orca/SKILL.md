---
name: orca
description: "Swap tokens and query concentrated liquidity Whirlpools on Orca DEX for Solana. Use when users mention Orca, Whirlpools, Solana DEX swap, or concentrated liquidity on Solana."
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

```bash
/orca swap 1 SOL to USDC       # Swap 1 SOL for USDC
/orca quote 50 USDC to SOL     # Get quote without executing
/orca pools ORCA                # List Whirlpools for ORCA token
```

## Workflow

1. **Get a quote** first with `/orca quote` to check expected output and fees
2. **Execute the swap** with `/orca swap` when satisfied with the rate
3. **Browse pools** with `/orca pools` to find available Whirlpool trading pairs

## Notes

- Requires `SOLANA_PRIVATE_KEY` environment variable for swap execution
- Whirlpools use concentrated liquidity for better capital efficiency
- Supports all major Solana token pairs available on Orca
