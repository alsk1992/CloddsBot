---
name: copy-trading-solana
description: "Monitor and automatically copy trades from Solana wallets via Jupiter with configurable sizing, delays, and stealth mode. Use when users want to follow whale wallets, mirror Solana DEX trades, or set up copy trading on Pump.fun, Raydium, or Orca."
command: copy
emoji: "👥"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Copy Trading - Solana

Monitor Solana wallets and automatically copy their trades using Jupiter aggregator.

## Commands

```
/copy add <wallet> [--name "label"] [--mult 1.0] [--max 0.5]   Follow a wallet
/copy remove <wallet|id>                                       Stop following
/copy list                                                     List followed wallets
/copy history [wallet]                                         View trade history
/copy pause <wallet|id>                                        Pause copying
/copy resume <wallet|id>                                       Resume copying
/copy stats                                                    View overall stats
/copy config <wallet|id> [options]                             Update config
```

## Examples

```
/copy add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
/copy add 7xKXtg... --name "whale1" --mult 0.5 --max 0.1
/copy list
/copy pause 7xKXtg...
/copy stats
/copy history whale1
```

## Configuration Options

- `--mult <number>`: Position size multiplier (default: 1.0)
  - `0.5` = half their size, `2.0` = double their size
- `--max <sol>`: Maximum SOL per trade (default: 0.5)
- `--min <sol>`: Minimum trade to copy (default: 0.01)
- `--name <label>`: Friendly name for the wallet
- `--delay <ms>`: Delay before copying (stealth mode)
- `--slippage <bps>`: Slippage tolerance in basis points (default: 500)
- `--buys-only`: Only copy buy trades
- `--sells-only`: Only copy sell trades

## Features

- Real-time monitoring via Solana WebSocket
- Automatic trade detection (Pump.fun, Raydium, Jupiter, Orca, Meteora)
- Configurable position sizing with multiplier and max cap
- Token whitelist/blacklist support
- Trade history and P&L tracking
- Stealth mode with configurable delay

## How It Works

1. Monitor target wallet for transactions
2. Detect buy/sell trades across major DEXes
3. Apply your position sizing rules
4. Execute copy trade via Jupiter (best route)
5. Log results and update P&L stats
