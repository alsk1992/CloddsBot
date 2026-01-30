# Clodds User Guide

This guide focuses on day-to-day usage: starting the gateway, pairing users,
chat commands, and common workflows.

## Quick start

1. Install dependencies:

```
npm install
```

2. Create `.env` from `.env.example` and add at least:
   - `ANTHROPIC_API_KEY`
   - `TELEGRAM_BOT_TOKEN` (if using Telegram)

3. Start the gateway:

```
npm run dev
# or
clodds start
```

The gateway listens on `http://127.0.0.1:18789` by default.

## Pairing and access control

Clodds uses a pairing flow to protect DMs.

### Approve a pairing request (CLI)

```
clodds pairing list telegram
clodds pairing approve telegram ABC123
```

### Set an owner (can approve via chat)

```
clodds pairing set-owner telegram 123456789 -u "username"
```

## WebChat (browser)

WebChat is a local browser chat UI at:

```
http://127.0.0.1:18789/webchat
```

If you set `WEBCHAT_TOKEN`, the browser will prompt for it on first load and
store it in localStorage.

## Chat commands

Send these in any supported channel (Telegram, Discord, WebChat, etc.):

- `/help` - list commands
- `/status` - session status and token estimate
- `/new` or `/reset` - reset the current session
- `/context` - preview recent context
- `/model [sonnet|opus|haiku|claude-...]` - change model
- `/markets [platform] <query>` - search markets
- `/compare <query> [platforms=polymarket,kalshi] [limit=3]` - compare prices

**Opportunity Finding:**
- `/opportunity scan [query]` - find arbitrage opportunities
- `/opportunity combinatorial` - scan for combinatorial arb (based on arXiv:2508.03474)
- `/opportunity active` - show active opportunities
- `/opportunity stats` - performance statistics
- `/opportunity link <a> <b>` - link equivalent markets
- `/opportunity realtime start` - enable real-time scanning

**Trading:**
- `/trades stats` - trade statistics
- `/trades recent` - recent trades
- `/bot list` - list trading bots
- `/bot start <id>` - start a bot
- `/safety status` - safety controls
- `/safety kill` - emergency stop

**Advanced Trading:**
- `/whale track <address>` - follow a whale address
- `/whale top [limit]` - top traders by volume
- `/whale activity <market>` - whale activity for market
- `/copy start <address>` - start copy trading
- `/copy stop` - stop copy trading
- `/route <market> <side> <size>` - find best execution route
- `/swap <chain> <from> <to> <amount>` - EVM DEX swap

**Portfolio & Risk:**
- `/portfolio` - show positions and P&L
- `/pnl [24h|7d|30m] [limit=50]` - historical P&L snapshots
- `/digest [on|off|HH:MM|show|reset]` - daily digest settings
- `/risk [show|set ...|reset|off]` - risk limits and stop loss

## Trading credentials

To enable trading tools, store per-user credentials via the agent tools (chat
commands or agent prompts) or the onboarding flow.

Supported platforms:
- Polymarket
- Kalshi
- Manifold

These are stored encrypted in the database and loaded at runtime.

## Risk management

Use `/risk` to control guardrails:

```
/risk show
/risk set maxOrderSize=100 maxPositionValue=500 maxTotalExposure=2000 stopLossPct=0.2
/risk reset
/risk off
```

Note: automated stop-loss execution respects `trading.dryRun` in config.

## Advanced Trading Configuration

Configure advanced trading features in `clodds.json`:

```json
{
  "whaleTracking": {
    "enabled": true,
    "minTradeSize": 10000,
    "minPositionSize": 50000,
    "platforms": ["polymarket"],
    "realtime": true
  },
  "copyTrading": {
    "enabled": true,
    "dryRun": true,
    "followedAddresses": ["0x1234..."],
    "sizingMode": "fixed",
    "fixedSize": 100,
    "maxPositionSize": 500,
    "copyDelayMs": 5000
  },
  "smartRouting": {
    "enabled": true,
    "mode": "balanced",
    "platforms": ["polymarket", "kalshi"],
    "maxSlippage": 1,
    "preferMaker": true
  },
  "evmDex": {
    "enabled": true,
    "defaultChain": "ethereum",
    "slippageBps": 50,
    "mevProtection": "basic",
    "maxPriceImpact": 3
  }
}
```

| Config | Options | Description |
|--------|---------|-------------|
| `whaleTracking.minTradeSize` | number | Min USD to track (default: 10000) |
| `copyTrading.sizingMode` | fixed/proportional/percentage | How to size copied trades |
| `smartRouting.mode` | best_price/best_liquidity/lowest_fee/balanced | Routing strategy |
| `evmDex.mevProtection` | none/basic/aggressive | MEV protection level |
| `realtimeAlerts.enabled` | boolean | Enable push notifications (default: false) |
| `realtimeAlerts.whaleTrades.minSize` | number | Min whale trade to alert (default: 50000) |
| `realtimeAlerts.arbitrage.minEdge` | number | Min arb edge % to alert (default: 2) |
| `arbitrageExecution.enabled` | boolean | Enable auto-execution (default: false) |
| `arbitrageExecution.dryRun` | boolean | Simulate without executing (default: true) |
| `arbitrageExecution.minEdge` | number | Min edge % to execute (default: 1.0) |

## Auto-Arbitrage Execution

Automatically execute detected arbitrage opportunities:

```json
{
  "arbitrageExecution": {
    "enabled": true,
    "dryRun": true,
    "minEdge": 1.0,
    "minLiquidity": 500,
    "maxPositionSize": 100,
    "maxDailyLoss": 500,
    "maxConcurrentPositions": 3,
    "platforms": ["polymarket", "kalshi"],
    "preferMakerOrders": true,
    "confirmationDelayMs": 0
  }
}
```

| Setting | Description |
|---------|-------------|
| dryRun | Simulate trades without executing (recommended for testing) |
| minEdge | Minimum edge % to trigger execution |
| maxPositionSize | Max USD per trade |
| maxDailyLoss | Stop executing if daily loss exceeds this |
| maxConcurrentPositions | Maximum simultaneous positions |
| confirmationDelayMs | Wait time before executing (allows price recheck) |

The executor listens for opportunities from the opportunity finder and automatically places orders when criteria are met. Always test with `dryRun: true` first.

## Real-time Alerts

Push notifications for trading events. Configure in `clodds.json`:

```json
{
  "realtimeAlerts": {
    "enabled": true,
    "targets": [
      { "platform": "telegram", "chatId": "123456789" }
    ],
    "whaleTrades": {
      "enabled": true,
      "minSize": 50000,
      "cooldownMs": 300000
    },
    "arbitrage": {
      "enabled": true,
      "minEdge": 2,
      "cooldownMs": 600000
    },
    "priceMovement": {
      "enabled": true,
      "minChangePct": 5,
      "windowMs": 300000
    },
    "copyTrading": {
      "enabled": true,
      "onCopied": true,
      "onFailed": true
    }
  }
}
```

| Alert Type | Trigger |
|------------|---------|
| Whale Trade | Large trades above minSize threshold |
| Arbitrage | Opportunities above minEdge % |
| Price Movement | Price changes above minChangePct % |
| Copy Trading | When trades are copied or fail |

## Performance Dashboard

Access the web-based performance dashboard at:

```
http://127.0.0.1:18789/dashboard
```

The dashboard shows:
- Total trades and win rate
- Cumulative P&L with interactive chart
- Sharpe ratio and max drawdown
- Strategy breakdown with P&L per strategy
- Recent trades table with entry/exit prices

API endpoint for programmatic access:
```
GET /api/performance
```

## Portfolio and P&L

- `/portfolio` shows current positions and live P&L.
- `/pnl` shows snapshots over time. Enable via:
  - `POSITIONS_PNL_SNAPSHOTS_ENABLED=true`
  - `POSITIONS_PNL_HISTORY_DAYS=90`

## Daily digest

Enable daily summaries:

```
/digest on
/digest 09:00
/digest show
/digest off
```

## Market index search

Enable the market index in config or `.env`:

```
MARKET_INDEX_ENABLED=true
```

Then use:
- `/markets <query>` in chat
- HTTP endpoint `GET /market-index/search`

## Webhooks (automation)

Webhooks are mounted at `/webhook` or `/webhook/*`. They require HMAC signatures
by default:

- Header: `x-webhook-signature` (or `x-hub-signature-256`)
- Value: hex HMAC-SHA256 of the raw request body using the webhook secret

Set `CLODDS_WEBHOOK_REQUIRE_SIGNATURE=0` to disable signature checks.

## Troubleshooting

Common checks:

- `clodds doctor` - environment and config checks
- `npm run build` - verify TypeScript compilation
- `npm run dev` - start in dev mode with logs

If a channel is not responding, confirm:
- Token set in `.env`
- Channel enabled in config (or `.env`)
- Pairing approved (for DMs)

Monitoring targets can include an `accountId` for multi-account channels, e.g.
WhatsApp:

```json
{
  "monitoring": {
    "alertTargets": [
      { "platform": "whatsapp", "accountId": "work", "chatId": "+15551234567" }
    ]
  }
}
```

If you omit `accountId`, Clodds will attempt to route alerts using the most
recent session for that chat (when available).

You can also specify per-account WhatsApp DM policies under
`channels.whatsapp.accounts.<id>.dmPolicy` (e.g. `pairing` vs `open`).

## Advanced Trading Features

### Whale Tracking

Monitor large trades on Polymarket:

```
/whale track 0x1234...  # Follow a specific address
/whale top 10           # Top 10 traders by volume
/whale activity trump   # Whale activity for Trump markets
```

### Copy Trading

Automatically mirror trades from successful wallets:

```
/copy start 0x1234...   # Start copying an address
/copy config size=100   # Set copy size to $100
/copy stop              # Stop copy trading
```

### Smart Order Routing

Find the best execution across platforms:

```
/route trump buy 1000   # Find best route for $1000 buy
```

### EVM DEX Trading

Trade on Uniswap/1inch across EVM chains:

```
/swap ethereum USDC WETH 1000   # Swap $1000 USDC for WETH
/swap base USDC ETH 500         # Swap on Base
```

Supported chains: ethereum, arbitrum, optimism, base, polygon

### MEV Protection

MEV protection is automatically enabled for swaps:
- **Ethereum**: Flashbots Protect, MEV Blocker
- **Solana**: Jito bundles
- **L2s**: Sequencer protection (built-in)

## Telegram Mini App

Access Clodds as a Telegram Mini App (Web App) for mobile-friendly portfolio and market access.

### Setup

1. Register your Mini App with BotFather:
```
/newapp
```

2. Set the Web App URL to your gateway:
```
https://your-domain.com/miniapp
```

3. Users can access via the menu button in your bot's chat.

### Features

- **Portfolio**: View total value, P&L, and recent positions
- **Markets**: Search prediction markets across platforms
- **Arbitrage**: Scan for opportunities with one tap

The Mini App uses Telegram's native theming and haptic feedback for a native experience.

### Direct Link

Share the Mini App directly:
```
https://t.me/YourBot/app
```

## Data Sources

Clodds integrates multiple external data sources for edge detection and trading signals.

### News Feed

RSS feeds from political and financial news sources:
- Reuters Politics
- NPR Politics
- Politico
- FiveThirtyEight

Twitter/X integration (requires `X_BEARER_TOKEN` or `TWITTER_BEARER_TOKEN`):
```json
{
  "feeds": {
    "news": {
      "enabled": true,
      "twitter": {
        "accounts": ["nikiivan", "NateSilver538", "redistrict"]
      }
    }
  }
}
```

### External Probability Sources

Edge detection compares market prices to external data:

| Source | Env Var | Description |
|--------|---------|-------------|
| CME FedWatch | `CME_FEDWATCH_ACCESS_TOKEN` | Fed rate probabilities |
| FiveThirtyEight | `FIVETHIRTYEIGHT_FORECAST_URL` | Election model |
| Silver Bulletin | `SILVER_BULLETIN_FORECAST_URL` | Nate Silver's model |
| Odds API | `ODDS_API_KEY` | Sports betting odds |

### Crypto Price Feed

Real-time prices via Binance WebSocket with Coinbase/CoinGecko fallback:
- BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, MATIC, DOT, LINK
- 24h volume and price changes
- OHLCV historical data

## Authentication

Clodds supports multiple authentication methods for AI providers:

### OAuth Authentication

```bash
# Interactive OAuth flow
clodds auth login anthropic
clodds auth login openai
clodds auth login google

# Check status
clodds auth status

# Revoke tokens
clodds auth logout anthropic
```

### GitHub Copilot

```bash
# Authenticate with GitHub Copilot
clodds auth copilot
```

### Google/Gemini

```bash
# API key authentication
export GOOGLE_API_KEY=your-key
# Or OAuth
clodds auth login google
```

### Qwen/DashScope

```bash
export DASHSCOPE_API_KEY=your-key
```

## Telemetry & Monitoring

Enable OpenTelemetry for observability:

```json
{
  "telemetry": {
    "enabled": true,
    "serviceName": "clodds",
    "otlpEndpoint": "http://localhost:4318",
    "metricsPort": 9090,
    "sampleRate": 1.0
  }
}
```

Access Prometheus metrics at `http://localhost:9090/metrics`.

### LLM Metrics

- `llm_requests_total` - Total LLM requests by provider/model/status
- `llm_request_duration_ms` - Request latency histogram
- `llm_tokens_input_total` - Input tokens by provider/model
- `llm_tokens_output_total` - Output tokens by provider/model

## Extensions

### Task Runner

AI-powered task execution with planning:

```bash
# Run a complex task
clodds task run "Build a REST API with authentication"

# View task status
clodds task status

# Cancel running task
clodds task cancel <id>
```

### Open Prose

AI-assisted document editing:

```bash
# Create a document
clodds prose create "My Article"

# Edit with AI
clodds prose edit <id> "Make it more concise"

# Export
clodds prose export <id> html
```

## Production Deployment

### Channel Adapters

All channel adapters include production-grade features:

- **Rate Limiting**: Token bucket algorithm (30 req/s default)
- **Circuit Breaker**: Auto-disable on repeated failures
- **Health Checks**: Periodic connectivity checks
- **Auto-Reconnection**: Exponential backoff reconnection
- **Metrics**: Request counts, latency, error rates

Configure in `clodds.json`:

```json
{
  "channels": {
    "telegram": {
      "rateLimit": 30,
      "rateLimitBurst": 10,
      "circuitBreakerThreshold": 5,
      "healthCheckIntervalMs": 30000,
      "maxReconnectAttempts": 10
    }
  }
}
```

## Tips

- Keep the gateway on loopback unless you add auth and a reverse proxy.
- Use WebChat for fast local testing before wiring up a messaging platform.
- For production, use Docker or a process manager and enable monitoring.
