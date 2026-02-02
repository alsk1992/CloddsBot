---
name: virtuals
description: "Virtuals Protocol AI Agent marketplace (Base chain)"
emoji: "🤖"
commands:
  - /virt
---

# Virtuals Protocol

Integration with Virtuals Protocol, an AI Agent marketplace on Base chain. View agents, prices, and bonding curve data.

## Quick Start

```bash
# Search agents
/virt search luna

# Get agent details
/virt agent <id>

# Trending agents
/virt trending

# New agents
/virt new
```

## Commands

| Command | Description |
|---------|-------------|
| `/virt search [query]` | Search agents |
| `/virt agent <id>` | Get agent details |
| `/virt agents` | List all agents |
| `/virt trending` | Trending agents (by volume) |
| `/virt new` | Recently launched agents |
| `/virt price <tokenAddress>` | Get bonding curve price |
| `/virt graduation <tokenAddress>` | Check graduation progress |

**Examples:**
```bash
/virt search gaming         # Search gaming agents
/virt agent abc123          # Get specific agent
/virt trending              # Top volume agents
/virt graduation 0x...      # Check if graduated
```

## Features

- **AI Agents** - Discover AI agents with unique personalities
- **Bonding Curves** - Price discovery via bonding curves
- **Graduation** - Track agents graduating to Uniswap
- **Categories** - Gaming, social, utility, etc.

## Agent Status

| Status | Description |
|--------|-------------|
| prototype | New, on bonding curve |
| sentient | Active, growing community |
| graduated | Migrated to Uniswap |

## Bonding Curve

Agents start on bonding curves:
- Price increases with demand
- ~42K VIRTUAL triggers graduation
- Graduation creates Uniswap pair
- LP tokens sent to creator vault

## Configuration

```bash
# Optional - custom RPC
export BASE_RPC_URL="https://mainnet.base.org"
```

## Resources

- [Virtuals Protocol](https://virtuals.io/)
- [Base Chain](https://base.org/)
