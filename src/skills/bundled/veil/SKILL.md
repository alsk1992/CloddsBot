---
name: veil
description: "Privacy and shielded transactions on Base via Veil Cash - ZK-based anonymous transfers"
command: veil
emoji: "🌪️"
gates:
  envs:
    - VEIL_KEY
---

# Veil - Private Transactions on Base

Privacy and shielded transactions on Base via Veil Cash. Deposit ETH into a private pool, withdraw/transfer privately using ZK proofs.

## How It Works

1. **Deposit** - Send ETH to private pool (public → private)
2. **Transfer** - Move funds privately (private → private)
3. **Withdraw** - Exit to public address (private → public)

All private operations use ZK proofs - no one can link your deposits to withdrawals.

## Commands

### Setup
```
/veil init                           Initialize Veil keypair
/veil status                         Check config and relay health
```

### Balance
```
/veil balance                        Check all balances
/veil queue                          Check queue balance (pending deposits)
/veil private                        Check private balance
```

### Operations
```
/veil deposit <amount>               Deposit ETH to private pool
/veil withdraw <amount> <address>    Withdraw to public address
/veil transfer <amount> <veil-key>   Private transfer to another user
/veil merge                          Merge UTXOs (consolidate)
```

## Examples

```
/veil init
/veil balance
/veil deposit 0.1
/veil withdraw 0.05 0x1234...
```

## Security Notes

- **Never share your VEIL_KEY** - it controls your private funds
- Store keypair securely (chmod 600)
- Use dedicated RPC to avoid rate limits

## Setup

```bash
# Initialize creates keypair
/veil init

# Or manually set:
export VEIL_KEY="..."  # Your Veil private key
export PRIVATE_KEY="0x..."  # For deposits (public tx)
```

## Requirements

- ETH on Base for deposits and gas
- Node.js for ZK proof generation
- Veil SDK: `npm install -g @veil-cash/sdk`
