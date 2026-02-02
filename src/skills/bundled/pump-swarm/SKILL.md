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

Coordinate up to **20 wallets** to execute synchronized trades on Pump.fun tokens.

## Quick Start

```bash
# Set up wallets
export SOLANA_PRIVATE_KEY="your-main-wallet-key"     # wallet_0
export SOLANA_SWARM_KEY_1="second-wallet-key"        # wallet_1
export SOLANA_SWARM_KEY_2="third-wallet-key"         # wallet_2
# ... up to SOLANA_SWARM_KEY_20

# Optional
export SOLANA_RPC_URL="https://your-rpc.com"
export PUMPPORTAL_API_KEY="your-api-key"
```

## Commands

### Wallet Management

```
/swarm wallets              List all swarm wallets with addresses
/swarm balances             Fetch SOL balances from chain
/swarm enable <wallet_id>   Enable a wallet for trading
/swarm disable <wallet_id>  Disable a wallet
```

### Trading

```
/swarm buy <mint> <sol> [options]      Buy with all enabled wallets
/swarm sell <mint> <amount|%> [opts]   Sell from wallets with positions
```

### Position Management

```
/swarm position <mint>      Show cached token positions
/swarm refresh <mint>       Fetch fresh positions from chain (required before sell)
```

## Execution Modes

| Mode | Flag | Best For | Description |
|------|------|----------|-------------|
| **Parallel** | `--parallel` | Speed (>5 wallets) | All wallets execute simultaneously |
| **Bundle** | `--bundle` | Atomicity (≤5) | Single Jito bundle, all-or-nothing |
| **Multi-Bundle** | `--multi-bundle` | Atomicity (6-20) | Multiple Jito bundles in parallel |
| **Sequential** | `--sequential` | Stealth | Staggered 200-400ms delays |

### Auto Mode Selection (Default)
- 1 wallet → Parallel (direct submit)
- 2-5 wallets → Single Jito Bundle
- 6-20 wallets → Multi-Bundle (chunks of 5)

## Other Options

| Option | Description |
|--------|-------------|
| `--preset <name>` | Apply a saved preset |
| `--wallets <id1,id2>` | Use specific wallets only |
| `--slippage <bps>` | Slippage tolerance (default: 500 = 5%) |
| `--pool <pool>` | Pool: pump, raydium, auto |

## Examples

```bash
# Buy 0.1 SOL worth on each enabled wallet (auto mode)
/swarm buy ABC123mint... 0.1

# Buy with specific wallets only
/swarm buy ABC123mint... 0.2 --wallets wallet_0,wallet_1

# Buy with a preset
/swarm buy ABC123mint... 0.1 --preset stealth

# Sell 100% with multiple Jito bundles (for >5 wallets)
/swarm sell ABC123mint... 100% --multi-bundle

# Sell 50% with staggered timing (stealth mode)
/swarm sell ABC123mint... 50% --sequential

# Sell with preset
/swarm sell ABC123mint... 100% --preset fast

# Check positions before selling
/swarm refresh ABC123mint...
/swarm position ABC123mint...
```

## Execution Modes Deep Dive

### Parallel (Default for >5 wallets)
- **Speed:** All wallets submit simultaneously via `Promise.all`
- **Risk:** No atomicity - some may succeed, others fail
- **Use when:** Speed is priority, or bundles keep failing

### Jito Bundle (Default for 2-5 wallets)
- **Atomic:** All transactions succeed or all fail together
- **MEV-protected:** No front-running between your own wallets
- **Cost:** ~10,000 lamports tip per bundle
- **Limit:** Max 5 transactions per bundle (Jito constraint)

### Multi-Bundle (Recommended for 6-20 wallets)
- **Chunked:** Splits wallets into groups of 5
- **Parallel bundles:** All chunks submit simultaneously
- **Partial atomicity:** Each chunk is atomic, but chunks are independent
- **Example:** 12 wallets → 3 bundles of [5, 5, 2] wallets

### Sequential (Stealth mode)
- **Staggered:** 200-400ms random delay between wallets
- **Amount variance:** ±5% to avoid detection patterns
- **Rate limited:** 5 seconds minimum between trades per wallet
- **Use when:** Want to avoid pattern detection

## How It Works

### Buy Flow
1. Refreshes SOL balances from chain
2. Filters wallets with sufficient balance (≥0.01 SOL + amount)
3. Builds transaction for each wallet via PumpPortal API
4. Signs all transactions locally
5. Submits via selected execution mode
6. Reports results per wallet

### Sell Flow
1. **Fetches actual token balances from chain** (critical!)
2. Filters wallets with positions
3. Calculates sell amount (% of position or exact)
4. Builds and signs transactions
5. Submits via selected execution mode
6. Reports results per wallet

## Safety Features

- **Balance check:** Verifies sufficient SOL before buy
- **Position check:** Fetches real token balances before sell
- **Max amount:** Rejects buy amounts > 10 SOL per wallet
- **Confirmation timeout:** 60 second timeout per transaction
- **Error reporting:** Shows detailed errors per wallet
- **Bundle fallback:** Failed bundles automatically retry as parallel

## Configuration

| Env Variable | Description |
|--------------|-------------|
| `SOLANA_PRIVATE_KEY` | Main wallet (wallet_0) |
| `SOLANA_SWARM_KEY_1..20` | Additional swarm wallets |
| `SOLANA_RPC_URL` | Custom RPC endpoint (faster = better) |
| `PUMPPORTAL_API_KEY` | PumpPortal API key (optional, for trading) |

## Agent Tools (12)

| Tool | Description |
|------|-------------|
| `swarm_wallets` | List all swarm wallets |
| `swarm_balances` | Refresh SOL balances from chain |
| `swarm_buy` | Coordinated buy across wallets (supports `preset` param) |
| `swarm_sell` | Coordinated sell across wallets (supports `preset` param) |
| `swarm_position` | Get cached positions |
| `swarm_refresh` | Fetch fresh positions from chain |
| `swarm_enable` | Enable a wallet |
| `swarm_disable` | Disable a wallet |
| `swarm_preset_save` | Save a trading preset |
| `swarm_preset_list` | List saved presets |
| `swarm_preset_get` | Get preset details |
| `swarm_preset_delete` | Delete a preset |

## Scaling Notes

- **Max wallets:** 20 (wallet_0 + SOLANA_SWARM_KEY_1..20)
- **Jito bundle limit:** 5 txs per bundle (handled automatically)
- **Multi-bundle parallel:** All bundles submit simultaneously
- **RPC recommendation:** Use dedicated RPC for best performance
- **Tip amount:** 10,000 lamports per bundle (~$0.002)

## Presets

Save and reuse trading configurations across tokens and strategies.

### Preset Commands

```bash
/swarm preset save <name> [options]   Save a preset
/swarm preset list [type]             List presets
/swarm preset show <name>             Show preset details
/swarm preset delete <name>           Delete a preset
```

### Preset Save Options

| Option | Description |
|--------|-------------|
| `--type <type>` | Preset type: strategy, token, wallet_group |
| `--desc "..."` | Preset description |
| `--mint <addr>` | Token address (for token presets) |
| `--amount <sol>` | Default SOL per wallet |
| `--slippage <bps>` | Slippage in basis points |
| `--pool <pool>` | Pool: pump, raydium, auto |
| `--mode <mode>` | parallel, bundle, multi-bundle, sequential |
| `--wallets <ids>` | Wallet IDs (for wallet_group presets) |

### Built-in Presets

| Name | Mode | Slippage | Pool | Use Case |
|------|------|----------|------|----------|
| `fast` | parallel | 5% | auto | Speed priority |
| `atomic` | multi-bundle | 5% | auto | All-or-nothing execution |
| `stealth` | sequential | 3% | auto | Pattern avoidance |
| `aggressive` | parallel | 10% | pump | High volatility tokens |
| `safe` | bundle | 2% | auto | Conservative trading |

### Preset Examples

```bash
# Create a custom strategy preset
/swarm preset save my_stealth --type strategy --mode sequential --slippage 300

# Create a token preset for BONK
/swarm preset save bonk_entry --type token --mint DezXAZ... --slippage 1000 --amount 0.1

# Create a wallet group preset
/swarm preset save top5 --type wallet_group --wallets wallet_0,wallet_1,wallet_2,wallet_3,wallet_4

# List all presets
/swarm preset list

# List only strategy presets
/swarm preset list strategy

# Use preset in trade
/swarm buy ABC... 0.1 --preset my_stealth
/swarm sell ABC... 100% --preset fast

# Delete a preset
/swarm preset delete old_preset
```

### Preset Types

| Type | Purpose |
|------|---------|
| `strategy` | Reusable trading settings (mode, slippage, pool) |
| `token` | Token-specific settings with saved mint address |
| `wallet_group` | Named wallet combinations for specific trades |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Bundle keeps failing | Try `--parallel` or check network congestion |
| Positions not showing | Run `/swarm refresh <mint>` first |
| Insufficient balance | Check with `/swarm balances` |
| Slow execution | Use dedicated RPC via `SOLANA_RPC_URL` |
| Some wallets skipped | Wallet disabled or insufficient balance |
| Preset not found | Check name with `/swarm preset list` |
