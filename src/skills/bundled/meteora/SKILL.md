---
name: meteora
description: "Swap tokens and query DLMM pools on Meteora's dynamic liquidity market maker on Solana. Use when users mention Meteora swap, DLMM pools, or Solana liquidity."
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

```bash
/met swap 1 SOL to USDC       # Swap 1 SOL for USDC
/met quote 100 USDC to SOL    # Get quote without executing
/met pools SOL                 # List available DLMM pools for SOL
```

## Workflow

1. **Get a quote** first with `/met quote` to check expected output
2. **Execute the swap** with `/met swap` when satisfied with the rate
3. **Browse pools** with `/met pools` to find available trading pairs

## Notes

- Requires `SOLANA_PRIVATE_KEY` environment variable for swap execution
- DLMM uses bin-based pricing for concentrated liquidity
- Supports all major Solana token pairs available on Meteora
