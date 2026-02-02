---
name: ens
description: "Set your primary ENS name on Base and L2s - configure reverse resolution"
command: ens
emoji: "🏷️"
gates:
  envs:
    - PRIVATE_KEY
---

# ENS Primary Name

Set your primary ENS name on Base and other L2 chains via the ENS Reverse Registrar.

## What It Does

Creates a bi-directional link:
- **Forward:** `name.eth` → `0x1234...` (set in ENS resolver)
- **Reverse:** `0x1234...` → `name.eth` (set via this skill)

## Supported Chains

| Chain | Reverse Registrar |
|-------|-------------------|
| Base | `0x0000000000D8e504002cC26E3Ec46D81971C1664` |
| Arbitrum | `0x0000000000D8e504002cC26E3Ec46D81971C1664` |
| Optimism | `0x0000000000D8e504002cC26E3Ec46D81971C1664` |
| Ethereum | `0x283F227c4Bd38ecE252C4Ae7ECE650B0e913f1f9` |

## Commands

### Set Primary Name
```
/ens set <name.eth>                  Set primary name on Base
/ens set <name.eth> --chain arb      Set on Arbitrum
/ens set <name.eth> --chain eth      Set on Ethereum
```

### Verify
```
/ens verify <address>                Check if primary name is set
/ens resolve <name.eth>              Resolve ENS name to address
```

## Examples

```
/ens set myname.eth
/ens set myname.eth --chain arbitrum
/ens verify 0x1234...
```

## Prerequisites

1. Own an ENS name (registered)
2. Forward resolution configured (name → your address)
3. Native tokens for gas (ETH on target chain)

## Setup

```bash
export PRIVATE_KEY="0x..."  # Your wallet key
```
