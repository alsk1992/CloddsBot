---
name: token-security
description: "Audit token security using GoPlus API with honeypot detection, rug-pull analysis, and risk scoring. Auto-detect chain from address and flag dangerous contracts. Use when checking if a token is safe to trade, detecting scams, or reviewing contract risks."
command: audit
emoji: "🔍"
---

# Token Security Audit

Comprehensive token security analysis powered by GoPlus API - honeypot detection, rug-pull analysis, and risk scoring.

## Commands

```
/audit <address>                  Auto-detect chain and audit token
/audit <address> --chain <name>   Audit token on specific chain
/audit help                       Show help
```

## Examples

```
/audit 0x6B175474E89094C44Da98b954EescdeCB5BE3830
/audit So11111111111111111111111111111111111111112 --chain solana
/audit 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed --chain base
```

## Supported Chains

| Chain | Address Format |
|-------|---------------|
| Ethereum | `0x...` (auto-detected) |
| BSC | `0x...` |
| Polygon | `0x...` |
| Arbitrum | `0x...` |
| Base | `0x...` |
| Solana | Base58 address |

## Security Checks

The audit covers these risk categories:

- **Honeypot Detection** — Can the token be sold after buying?
- **Rug-Pull Analysis** — Owner privileges, mint functions, proxy contracts
- **Tax Analysis** — Buy/sell tax percentages and hidden fees
- **Liquidity Lock** — Is liquidity locked and for how long?
- **Contract Verification** — Is the source code verified on-chain?
- **Holder Concentration** — Top holder distribution and whale risk

## Risk Scoring

| Score | Risk Level | Recommendation |
|-------|------------|----------------|
| 0-30 | High Risk | Do not trade |
| 31-60 | Medium Risk | Trade with caution, small size |
| 61-80 | Low Risk | Generally safe, verify liquidity |
| 81-100 | Safe | Standard trading parameters |

## Best Practices

1. **Always audit before trading** — Especially for new or low-cap tokens
2. **Check liquidity lock** — Unlocked liquidity is a major rug-pull risk
3. **Verify contract source** — Unverified contracts may hide malicious logic
4. **Watch for high tax** — Buy/sell tax above 10% is suspicious
5. **Cross-reference** — Use alongside whale-tracking and on-chain analysis
