---
name: pumpfun
description: "Pump.fun - Complete Solana memecoin launchpad"
command: pump
emoji: "🚀"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Pump.fun - Complete API Coverage

Pump.fun is the leading Solana memecoin launchpad with bonding curve trading.

## Trading

```
/pump buy <mint> <amount> [options]     Buy tokens (amount in SOL)
/pump sell <mint> <amount|%> [options]  Sell tokens (amount or percentage)
/pump quote <mint> <amount> <action>    Get swap quote
```

**Options:**
- `--pool <pool>` - Pool: pump, raydium, pump-amm, launchlab, bonk, auto
- `--slippage <bps>` - Slippage in basis points (default: 500 = 5%)
- `--priority <lamports>` - Priority fee for faster execution

**Examples:**
```
/pump buy ABC123... 0.1
/pump buy ABC123... 0.5 --pool auto --slippage 1000
/pump sell ABC123... 100%
/pump sell ABC123... 50% --pool raydium
```

## Discovery

```
/pump trending               Top performing tokens
/pump new                    Recently created tokens
/pump live                   Currently trading tokens
/pump graduated              Tokens migrated to Raydium
/pump search <query>         Search tokens by name/symbol
/pump volatile               High volatility tokens
/pump koth                   King of the Hill (30-35K mcap)
```

## Token Data

```
/pump token <mint>                      Full token info
/pump price <mint>                      Current price + 24h stats
/pump holders <mint>                    Top holders list
/pump trades <mint> [--limit N]         Recent trades
/pump chart <mint> [--interval X]       OHLCV price chart
```

**Intervals:** 1m, 5m, 15m, 1h, 4h, 1d

## Token Creation

```
/pump create <name> <symbol> <desc> [options]   Launch new token
/pump claim <mint>                              Claim creator fees
```

**Create Options:**
- `--image <url>` - Token image URL
- `--twitter <url>` - Twitter link
- `--telegram <url>` - Telegram link
- `--website <url>` - Website link
- `--initial <SOL>` - Initial buy amount

## Monitoring (WebSocket)

```
/pump watch <mint>           Watch token for real-time trades
/pump snipe <symbol>         Wait for token with symbol to launch
```

## Configuration

```bash
export SOLANA_PRIVATE_KEY="your-private-key"
export PUMPPORTAL_API_KEY="your-api-key"     # Optional, for trading API
export SOLANA_RPC_URL="your-rpc-url"         # Optional, custom RPC
```

## Pool Options

| Pool | Description |
|------|-------------|
| `pump` | Pump.fun bonding curve (default) |
| `raydium` | Raydium AMM (graduated tokens) |
| `pump-amm` | Pump.fun native AMM |
| `launchlab` | LaunchLab pools |
| `bonk` | Bonk pools |
| `auto` | Automatic best route |

## API Sources

- **Trading:** PumpPortal (pumpportal.fun) - 0.5% fee
- **Data:** Pump.fun Frontend API (frontend-api-v3.pump.fun)
- **WebSocket:** wss://pumpportal.fun/api/data

## Features

- Bonding curve trading with automatic graduation
- Multi-pool routing (Pump, Raydium, etc.)
- Token creation with metadata
- Creator fee claiming
- Real-time trade streaming
- Token sniping support
- OHLCV charts and analytics
- Holder analysis
