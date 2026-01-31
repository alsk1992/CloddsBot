---
name: pump-swarm
description: "Coordinated multi-wallet trading on Pump.fun"
command: swarm
emoji: "🐝"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Pump.fun Swarm Trading

Coordinate multiple wallets to execute synchronized trades on Pump.fun tokens.

## Quick Start

```bash
# Set up wallets (primary + swarm wallets)
export SOLANA_PRIVATE_KEY="your-main-wallet-key"
export SOLANA_SWARM_KEY_1="wallet-2-key"
export SOLANA_SWARM_KEY_2="wallet-3-key"
# ... up to SOLANA_SWARM_KEY_20

# Optional: API key for trading
export PUMPPORTAL_API_KEY="your-api-key"
```

## Commands

### Wallet Management

```
/swarm wallets                    List all swarm wallets
/swarm balances                   Check SOL balances
/swarm enable <wallet_id>         Enable a wallet
/swarm disable <wallet_id>        Disable a wallet
/swarm add <private_key>          Add wallet to swarm (runtime)
```

### Coordinated Trading

```
/swarm buy <mint> <sol_each> [options]     Buy across all wallets
/swarm sell <mint> <amount|%> [options]    Sell across all wallets
/swarm position <mint>                     Check swarm position
```

**Options:**
- `--wallets <id1,id2,...>` - Specific wallets only
- `--bundle` - Force Jito bundle (atomic)
- `--sequential` - Force sequential execution
- `--slippage <bps>` - Slippage (default: 500 = 5%)
- `--pool <pool>` - Pool: pump, raydium, auto

### Examples

```bash
# Buy 0.1 SOL worth on each of 5 wallets (0.5 SOL total)
/swarm buy ABC123mint... 0.1

# Buy with specific wallets only
/swarm buy ABC123mint... 0.2 --wallets wallet_0,wallet_1

# Sell 100% of position from all wallets
/swarm sell ABC123mint... 100%

# Sell 50% with atomic execution
/swarm sell ABC123mint... 50% --bundle

# Check total swarm position
/swarm position ABC123mint...
```

## Execution Modes

### Jito Bundle (Default)
- **Atomic:** All transactions succeed or all fail
- **MEV-protected:** No front-running between wallets
- **Cost:** ~0.00001 SOL tip per bundle
- Up to 5 transactions per bundle

### Sequential (Fallback)
- **Staggered:** 200-400ms delay between wallets
- **Amount variance:** ±5% to avoid detection
- **Rate limited:** 5 seconds minimum between trades per wallet

## Configuration

```bash
# Required
export SOLANA_PRIVATE_KEY="base58-or-json-array"

# Swarm wallets (up to 20)
export SOLANA_SWARM_KEY_1="..."
export SOLANA_SWARM_KEY_2="..."

# Optional
export SOLANA_RPC_URL="https://your-rpc.com"
export PUMPPORTAL_API_KEY="your-key"
```

## Position Tracking

The swarm tracks positions per wallet:

```
/swarm position ABC123...

Swarm Position: ABC123mint...
Total: 1,500,000 tokens

By Wallet:
  wallet_0: 500,000 (33.3%)
  wallet_1: 500,000 (33.3%)
  wallet_2: 500,000 (33.3%)
```

## Risk Management

- **Rate limiting:** Prevents rapid-fire trades per wallet
- **Stagger timing:** Avoids pattern detection
- **Amount variance:** Randomizes trade sizes slightly
- **Balance checks:** Validates sufficient SOL before trade

## Detection Avoidance

The swarm implements several measures:
1. **Timing spread:** 200-400ms between wallet executions
2. **Amount variance:** ±5% on each trade
3. **Rate limiting:** 5s minimum between trades per wallet
4. **Bundle option:** Atomic execution hides coordination

## Notes

- Pump.fun tokens are highly volatile - use small amounts
- Jito bundles require tips (~10,000 lamports default)
- Bundle failure falls back to sequential automatically
- Track positions carefully - swarm state is in-memory
