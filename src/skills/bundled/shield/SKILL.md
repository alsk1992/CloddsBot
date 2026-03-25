---
name: shield
description: "Scan code, wallet addresses, and blockchain transactions for security vulnerabilities and scam patterns. Use when users ask about smart contract audits, address safety checks, or pre-flight transaction validation."
command: shield
emoji: "🛡️"
---

# Security Shield

Multi-chain security scanner for code, wallet addresses, transactions, and scam detection. Supports Solana and EVM chains.

## Commands

```
/shield scan <code>                        Scan code for malicious patterns
/shield check <address>                    Check address safety (auto-detect chain)
/shield validate <dest> <amt> [token]      Pre-flight transaction validation
/shield scams [solana|evm]                 List known scam addresses
/shield status                             Show scanner statistics
/shield help                               Show help
```

## Workflow

### Pre-Trade Security Check

1. **Check the address** before sending funds:
   ```
   /shield check 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18
   ```
2. **Validate the transaction** before signing:
   ```
   /shield validate 0x742d35Cc... 1.5 ETH
   ```
3. **Review the risk report** — look for flags like blacklisted addresses, contract honeypots, or suspicious ownership patterns.

### Code Audit Workflow

1. **Paste or reference the contract code**:
   ```
   /shield scan <paste solidity or rust code>
   ```
2. **Review flagged patterns** — the scanner detects:
   - Rug pull indicators (ownership renounce bypasses, hidden mints)
   - Honeypot patterns (buy-only tokens, transfer restrictions)
   - Suspicious fund flows (drain functions, unauthorized withdrawals)
   - Known exploit signatures

## Examples

```bash
# Check if a Solana address is safe
/shield check 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

# Check an EVM address (auto-detects chain)
/shield check 0xdAC17F958D2ee523a2206206994597C13D831ec7

# Validate a transfer before executing
/shield validate 0xRecipient... 500 USDC

# Scan smart contract code for vulnerabilities
/shield scan "function withdraw() public { ... }"

# List known scam addresses on Solana
/shield scams solana

# View scanner stats and database size
/shield status
```

## Detection Categories

| Category | What It Detects |
|----------|----------------|
| **Rug Pull** | Hidden mint functions, ownership bypasses, liquidity removal |
| **Honeypot** | Buy-only tokens, transfer blocks, sell tax > 50% |
| **Phishing** | Known phishing addresses, lookalike contracts |
| **Drain** | Unauthorized withdrawal functions, approval exploits |
| **Blacklist** | OFAC-sanctioned addresses, known scam wallets |

## Supported Chains

| Chain | Address Detection | Transaction Validation |
|-------|-------------------|----------------------|
| **Ethereum** | Auto-detect (0x prefix) | Yes |
| **Polygon** | Auto-detect (0x prefix) | Yes |
| **Base** | Auto-detect (0x prefix) | Yes |
| **Solana** | Auto-detect (base58) | Yes |

## Best Practices

1. **Always check before sending** — Run `/shield check` on any new address before transferring funds
2. **Validate large transactions** — Use `/shield validate` for any transfer above your comfort threshold
3. **Scan new token contracts** — Before buying a new token, scan the contract code
4. **Review scam lists regularly** — Use `/shield scams` to stay updated on known threats
5. **Check after approvals** — Monitor addresses you have granted token approvals to
