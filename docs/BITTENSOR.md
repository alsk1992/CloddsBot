# Bittensor Subnet Mining

Mine TAO tokens on Bittensor subnets directly from Clodds. Supports wallet management, subnet registration, earnings tracking, and Chutes (SN64) GPU compute.

## Quick Start

```bash
# 1. Run the setup wizard (installs Python, btcli, creates wallet, configures Clodds)
clodds bittensor setup

# 2. Start Clodds
clodds start

# 3. Check status in chat
/tao status
```

## Setup

### Interactive Setup (Recommended)

```bash
clodds bittensor setup
```

The wizard will:
1. **Choose network** — mainnet (real TAO) or testnet (free experimentation)
2. **Find/install Python 3** and btcli
3. **Create a Bittensor wallet** (coldkey + hotkey)
4. **Write config** to `~/.clodds/clodds.json`

### Manual Setup

Set environment variables:

```bash
BITTENSOR_ENABLED=true
BITTENSOR_NETWORK=mainnet          # mainnet | testnet | local
BITTENSOR_COLDKEY_PATH=~/.bittensor/wallets/default/coldkey
BITTENSOR_COLDKEY_PASSWORD=        # optional, for encrypted coldkeys
BITTENSOR_PYTHON_PATH=python3      # optional, auto-detected
BITTENSOR_SUBTENSOR_URL=           # optional, uses default Finney endpoint
BITTENSOR_EARNINGS_POLL_INTERVAL_MS=300000  # optional, default 5 min
```

Or in `~/.clodds/clodds.json`:

```json
{
  "bittensor": {
    "enabled": true,
    "network": "mainnet",
    "coldkeyPath": "~/.bittensor/wallets/default/coldkey",
    "subnets": [
      {
        "subnetId": 64,
        "type": "chutes",
        "enabled": true,
        "chutesConfig": {
          "minerApiPort": 32000,
          "gpuNodes": [
            { "name": "gpu-1", "ip": "10.0.1.1", "gpuType": "a100", "gpuCount": 1, "hourlyCostUsd": 1.50 }
          ]
        }
      }
    ]
  }
}
```

### Verify Dependencies

```bash
clodds bittensor check
```

## CLI Commands

```bash
clodds bittensor setup           # Interactive setup wizard
clodds bittensor status          # Show config and mining status
clodds bittensor check           # Verify Python, btcli, wallet, config
clodds bittensor wallet show     # Show wallet address and overview
clodds bittensor wallet create   # Create a new wallet
clodds bittensor wallet balance  # Check TAO balance
clodds bittensor register <id>   # Register on a subnet (e.g. 64)
clodds bittensor earnings        # Show earnings (queries running gateway)
clodds bittensor miners          # Show miner statuses
clodds bittensor subnets         # List available subnets
```

## Chat Commands

Available via `/tao` (alias: `/bittensor`) in any messaging channel:

| Command | Description |
|---------|-------------|
| `/tao status` | Mining overview (connected, wallet, earnings) |
| `/tao earnings [period]` | TAO earnings — `daily`, `weekly`, `monthly`, `all` |
| `/tao wallet` | Wallet balance (free, staked, total) |
| `/tao miners` | Registered miner metrics (trust, incentive, emission) |
| `/tao subnets` | Available subnets with registration costs |
| `/tao start <subnetId>` | Start mining on a configured subnet |
| `/tao stop <subnetId>` | Stop mining on a subnet |
| `/tao register <subnetId>` | Register on a subnet |

## HTTP API

All endpoints require authentication (`CLODDS_TOKEN`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bittensor/status` | Service status |
| GET | `/api/bittensor/wallet` | Wallet info + balance |
| GET | `/api/bittensor/earnings?period=daily` | Earnings by period |
| GET | `/api/bittensor/miners` | Miner statuses |
| GET | `/api/bittensor/subnets` | Available subnets |
| POST | `/api/bittensor/register` | Register on subnet (`{ subnetId }`) |
| POST | `/api/bittensor/start` | Start mining (`{ subnetId }`) |
| POST | `/api/bittensor/stop` | Stop mining (`{ subnetId }`) |

### Examples

```bash
# Check status
curl -H "Authorization: Bearer $CLODDS_TOKEN" localhost:18789/api/bittensor/status

# Get daily earnings
curl -H "Authorization: Bearer $CLODDS_TOKEN" localhost:18789/api/bittensor/earnings?period=daily

# Register on Chutes (SN64)
curl -X POST -H "Authorization: Bearer $CLODDS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subnetId": 64}' \
  localhost:18789/api/bittensor/register
```

## AI Agent Tool

The agent can be asked naturally:

- "What's my Bittensor mining status?"
- "How much TAO did I earn today?"
- "Show my TAO wallet balance"
- "Start mining on Chutes"
- "Register on subnet 64"

## Architecture

```
src/bittensor/
  types.ts           -- All interfaces
  wallet.ts          -- Chain queries via @polkadot/api
  python-runner.ts   -- btcli command wrapper (sanitized)
  chutes.ts          -- Chutes SN64 GPU miner manager
  service.ts         -- Main service factory + orchestration
  persistence.ts     -- SQLite tables (earnings, status, costs)
  server.ts          -- Express router for HTTP API
  index.ts           -- Barrel exports
```

**Key design decisions:**
- **TypeScript + Python sidecar**: Chain queries use `@polkadot/api` (Bittensor is Substrate-based). Wallet operations and miner processes use `btcli` via `child_process` since all Bittensor tooling is Python-only.
- **Live TAO price**: Fetched from CoinGecko on startup and refreshed every 30 minutes. Can be overridden with `taoPriceUsd` in config.
- **Wallet refresh**: Hotkeys and balance refreshed every 30 minutes to detect new registrations.
- **Disabled by default**: Set `BITTENSOR_ENABLED=true` to activate.

## Chutes (SN64)

[Chutes](https://chutes.ai) is Bittensor's serverless AI compute subnet. Miners provide GPU nodes that run AI workloads.

**Requirements:**
- NVIDIA GPU (A100, H100, RTX 4090, etc.)
- Docker installed
- Network access on port 32000

**Configuration:**
```json
{
  "subnetId": 64,
  "type": "chutes",
  "enabled": true,
  "chutesConfig": {
    "minerApiPort": 32000,
    "gpuNodes": [
      {
        "name": "my-gpu",
        "ip": "10.0.1.1",
        "gpuType": "a100",
        "gpuCount": 1,
        "hourlyCostUsd": 1.50
      }
    ]
  }
}
```

## Troubleshooting

**"Python not found"** — Install Python 3.8+ (`brew install python3` / `apt install python3`)

**"btcli not found"** — Run `pip install bittensor` or `clodds bittensor setup`

**"Wallet not found"** — Run `clodds bittensor wallet create` or `btcli wallet create`

**"Not connected"** — Check network config. Default mainnet URL: `wss://entrypoint-finney.opentensor.ai:443`

**"Could not reach gateway"** — The `earnings`, `miners`, and `subnets` CLI commands query the running gateway. Start it first with `clodds start`.

**Stale USD values** — TAO/USD price is fetched from CoinGecko. If it returns 0, set `taoPriceUsd` in config as a fallback.

## System Health

Run `clodds doctor` to verify Bittensor dependencies are installed and configured correctly.
