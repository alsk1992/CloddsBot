---
name: erc8004
description: "Register AI agent identity on Ethereum via ERC-8004 Trustless Agents standard"
command: agent-id
emoji: "🤖"
gates:
  envs:
    - PRIVATE_KEY
---

# ERC-8004: Trustless Agents

Register your AI agent on Ethereum mainnet with a verifiable on-chain identity.

## What is ERC-8004?

Ethereum standard for trustless agent identity and reputation:
- **Identity Registry** - ERC-721 based agent IDs
- **Reputation Registry** - Feedback and trust signals
- **Validation Registry** - Third-party verification

Website: https://www.8004.org

## Contract Addresses

| Chain | Identity Registry | Reputation Registry |
|-------|-------------------|---------------------|
| Ethereum | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Sepolia | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Commands

### Register
```
/agent-id register                   Register your agent
/agent-id register --name "My Agent" --description "An AI agent"
```

### Info
```
/agent-id info <agent-id>            Get agent info
/agent-id lookup <address>           Find agent ID by address
/agent-id reputation <agent-id>      Check agent reputation
```

### Update
```
/agent-id update <agent-id> --name "New Name"
/agent-id update <agent-id> --image ipfs://...
```

## Registration File Format

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "My Agent",
  "description": "An AI assistant",
  "image": "https://example.com/avatar.png",
  "active": true
}
```

## Examples

```
/agent-id register --name "Trading Bot" --description "Automated trading agent"
/agent-id info 123
/agent-id reputation 123
```

## Setup

```bash
export PRIVATE_KEY="0x..."      # Wallet with ETH on mainnet
export PINATA_JWT="..."         # Optional: for IPFS uploads
```

Gas: ~100-200k gas for registration (~$5-20 depending on gas prices)
