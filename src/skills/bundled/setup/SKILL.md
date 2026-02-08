---
name: setup
description: "Setup Wizard — Configure environment for all skills"
emoji: "🔧"
commands:
  - /setup
---

# Setup Wizard

Interactive onboarding that checks which skills are ready and guides you through configuration.

## Quick Start

```bash
# See what's configured and what needs setup
/setup

# Configure a specific category
/setup defi
/setup futures
/setup prediction
/setup solana
/setup ai

# Check all environment variables
/setup env

# Quick health check
/setup check
```

## Commands

| Command | Description |
|---------|-------------|
| `/setup` | Overview of all categories and their status |
| `/setup defi` | Configure DeFi & DEX skills (EVM chains) |
| `/setup futures` | Configure Futures & Perps exchanges |
| `/setup prediction` | Configure Prediction Market platforms |
| `/setup solana` | Configure Solana DeFi skills |
| `/setup ai` | Configure AI & Strategy features |
| `/setup env` | List all environment variables and their status |
| `/setup check` | Health check across all skills |

## How It Works

The setup wizard:
1. Scans which environment variables are set
2. Groups skills by category
3. Shows what's ready vs what needs configuration
4. Provides exact `export` commands to copy-paste
5. Suggests related skills to try first
