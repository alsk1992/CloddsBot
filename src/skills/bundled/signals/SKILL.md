---
name: signals
description: "Monitor RSS feeds, Twitter accounts, Telegram channels, and webhooks to auto-trigger trades based on signal filters. Use when automating trade execution from external signal sources, keyword-based triggers, or sentiment-driven entries."
command: signal
emoji: "📡"
gates:
  envs:
    - SOLANA_PRIVATE_KEY
---

# Signals Trading

Monitor external signals from RSS feeds, Twitter, Telegram, and webhooks to trigger automatic trades.

## Commands

```
/signal add rss <url> [--name "label"]            Add RSS feed source
/signal add twitter <username> [--name "label"]   Add Twitter/X account
/signal add webhook [--name "label"]              Get webhook URL for custom signals
/signal list                                      List all signal sources
/signal remove <id>                               Remove source
/signal pause <id>                                Pause source
/signal resume <id>                               Resume source
/signal history [source]                          View signal history
/signal test <id>                                 Test signal detection
/signal filter <id> add <type> <value> <action>   Add filter rule
/signal filter <id> list                          List filters
/signal config <id> [options]                     Configure source
```

## Examples

```
/signal add rss https://example.com/feed.xml --name "crypto-news"
/signal add twitter CryptoTrader --name "whale-alerts"
/signal add webhook --name "my-alerts"
/signal filter abc123 add keyword "bullish" buy
/signal filter abc123 add keyword "dump" sell
/signal list
```

## Signal Sources

### RSS Feeds
Monitor any RSS/Atom feed for signals. Polls every 30 seconds by default.

```
/signal add rss https://example.com/feed.xml --name "news"
```

### Twitter/X
Monitor tweets from specific accounts via Nitter proxy.

```
/signal add twitter whale_alert --name "whale"
```

### Webhooks
Receive signals via HTTP POST to a custom webhook URL.

```
/signal add webhook --name "custom"
# Returns: POST https://clodds.io/webhook/abc123
```

Webhook payload:
```json
{
  "content": "Buy BONK now! 5BqXr...",
  "author": "trader",
  "secret": "your-secret"
}
```

## Filters

Control when signals trigger trades:

- **keyword**: Match text content
- **mint**: Match specific token address
- **sentiment**: Match bullish/bearish sentiment
- **regex**: Custom regex pattern

```
/signal filter <id> add keyword "100x" buy
/signal filter <id> add sentiment bearish sell
/signal filter <id> add regex "pump.*now" buy
```

## Configuration

```
/signal config <id> --amount 0.1       SOL amount per trade
/signal config <id> --slippage 500     Slippage in bps
/signal config <id> --cooldown 60000   Cooldown between trades (ms)
/signal config <id> --require-mint     Only trade if mint found in signal
```

## Features

- Auto-detect token mint addresses in signals
- Sentiment analysis (bullish/bearish keywords)
- Cooldown to prevent spam trading
- Trade history and P&L tracking
- Support for Pump.fun, Raydium, Jupiter routing
