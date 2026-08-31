---
name: pumpfun
description: "Pump.fun - Complete Solana memecoin launchpad. Discovery, trending, gainers, losers, token data all work without a key. Trading requires SOLANA_PRIVATE_KEY."
command: pump
emoji: "🚀"
---

# Pump.fun - Complete API Coverage (32 Tools)

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
/pump trending               Top tokens by 24h volume (DexScreener enriched)
/pump gainers                Top 24h price gainers
/pump losers                 Top 24h price losers
/pump hot                    Most active right now (1h transactions)
/pump new-hot                Hottest new tokens by volume
/pump new                    Recently created tokens
/pump live                   Currently trading tokens
/pump graduated              Tokens migrated to PumpSwap
/pump search <query>         Search tokens by name/symbol
/pump volatile               High volatility tokens
/pump koth                   King of the Hill (30-35K mcap)
/pump for-you                Personalized recommendations
/pump metas                  Trending narratives/keywords
```

## Token Data

```
/pump token <mint>                      Full token info
/pump stats <mint>                      Volume, txns, liquidity, price change (DexScreener)
/pump price <mint>                      Current price + 24h stats
/pump holders <mint>                    Top holders list
/pump trades <mint> [--limit N]         Recent trades for token
/pump chart <mint> [--interval X]       OHLCV price chart
/pump similar <mint>                    Find similar tokens
```

**Intervals:** 1m, 5m, 15m, 1h, 4h, 1d

## Creator Tools

```
/pump user-coins <address>                    Tokens created by wallet
/pump create <name> <symbol> <metadata-uri>   Launch new token
/pump claim                                   Claim all accumulated creator fees
/pump ipfs-upload <name> <symbol> <desc>      Upload metadata to IPFS (may 403 server-side — see note below)
```

`create` builds and signs the transaction locally via the official SDK.
`metadata-uri` must already point to hosted JSON metadata — this command
does not upload it for you (pump.fun's own upload API blocks server-side/
bot requests, same as their trading frontend API, so there's no reliable
official endpoint to depend on for that step; pin it via IPFS/Arweave/etc
yourself first). `ipfs-upload` above attempts the same blocked endpoint
directly and may fail in a headless environment — it's kept for interactive/
browser-adjacent use, not relied upon by `create`.

**Create Options:**
- `--initial <SOL>` - Initial buy amount

`claim` claims ALL of the wallet's accumulated creator fees across every
token it created (bonding-curve and PumpSwap combined) in one transaction —
the on-chain vault is keyed by creator address, not by mint, so no mint
argument is needed or accepted.

## Platform Data

```
/pump latest-trades [--limit N]         Latest trades platform-wide
/pump sol-price                         Current SOL price
```

## Monitoring

```
/pump watch <mint> [--seconds N]   Watch for real trades on-chain (bounded window, default 20s, max 60s)
/pump snipe                        Not an auto-trading command — see pump-swarm skill / copytrade.ts
```

## Configuration

```bash
export SOLANA_PRIVATE_KEY="your-private-key"
export SOLANA_RPC_URL="your-rpc-url"         # Optional, custom RPC
```

## Pool Options

`/pump buy`/`/pump sell`'s `--pool` flag only accepts `pump` (default) or
`auto` — trades go directly against the Pump bonding curve program via the
official SDK. For a token that has already graduated off the bonding curve,
use the separate PumpSwap path (src/solana/pumpswap.ts, or `--dex pumpswap`
in the pump-swarm skill) — there is no multi-DEX `--pool` routing to
raydium/launchlab/bonk/etc. here.

## API Sources

- **Trading:** official @pump-fun/pump-sdk and @pump-fun/pump-swap-sdk — instructions built and signed locally, no third-party relay
- **Data:** Pump.fun Frontend API v3 (frontend-api-v3.pump.fun)
- **Analytics:** Advanced API v2 (advanced-api-v2.pump.fun)
- **Volatility:** Volatility API v2 (volatility-api-v2.pump.fun)
- **Watch:** on-chain via connection.onLogs (bounded-window, see `/pump watch`)

## Complete Tool List (32 Tools)

| Category | Tools |
|----------|-------|
| **Trading** | trade (buy/sell), quote |
| **Discovery** | trending, gainers, losers, hot, new-hot, new, live, graduated, search, volatile, koth, for-you, metas |
| **Token Data** | token, stats, price, holders, trades, chart, similar |
| **Creator** | user-coins, create, claim, ipfs-upload |
| **Platform** | latest-trades, sol-price |

## Features

- Bonding curve trading with automatic graduation
- Multi-pool routing (Pump, Raydium, CPMM, etc.)
- Token creation with IPFS metadata upload
- Creator fee claiming
- Real-time trade streaming via WebSocket
- Token sniping support
- OHLCV charts and analytics
- Holder analysis
- Trending metas/narratives discovery
- Similar token recommendations
- Platform-wide trade feed
