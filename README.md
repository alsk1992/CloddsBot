# Clodds Worker

Lightweight Cloudflare Workers version of Clodds for edge deployment. Provides webhook-based channels and core market functionality without dedicated hardware.

## Features

- **Webhook Channels**: Telegram, Discord (Interactions), Slack (Events API)
- **Market Data**: Polymarket, Kalshi, Manifold REST clients with KV caching
- **Arbitrage Scanner**: Cron-triggered scan every 5 minutes
- **Session Management**: Durable Objects for conversation state
- **REST API**: Market search, price, orderbook, arbitrage endpoints

## Prerequisites

- Cloudflare account with Workers subscription
- Node.js 18+
- wrangler CLI

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Cloudflare Resources

```bash
# Create D1 database
npx wrangler d1 create clodds

# Create KV namespace
npx wrangler kv:namespace create CACHE
```

### 3. Update wrangler.toml

Replace the placeholder IDs with actual values from the commands above:

```toml
[[d1_databases]]
binding = "DB"
database_name = "clodds"
database_id = "your-actual-database-id"

[[kv_namespaces]]
binding = "CACHE"
id = "your-actual-kv-namespace-id"
```

### 4. Run Migrations

```bash
npx wrangler d1 migrations apply clodds
```

### 5. Set Secrets

```bash
# Required
npx wrangler secret put ANTHROPIC_API_KEY

# Telegram (optional)
npx wrangler secret put TELEGRAM_BOT_TOKEN

# Discord (optional)
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN

# Slack (optional)
npx wrangler secret put SLACK_SIGNING_SECRET
npx wrangler secret put SLACK_BOT_TOKEN

# Kalshi auth (optional, for authenticated API access)
npx wrangler secret put KALSHI_API_KEY_ID
npx wrangler secret put KALSHI_PRIVATE_KEY
```

### 6. Deploy

```bash
npx wrangler deploy
```

## Channel Setup

### Telegram

1. Create a bot with [@BotFather](https://t.me/botfather)
2. Set the webhook:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://clodds-worker.<account>.workers.dev/webhook/telegram"
   ```

### Discord

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Set the Interactions Endpoint URL to: `https://clodds-worker.<account>.workers.dev/webhook/discord`
3. Register slash commands (run once):
   ```javascript
   // Call the registerCommands function or make a POST request
   ```

### Slack

1. Create an app at [Slack API](https://api.slack.com/apps)
2. Enable Events API and set Request URL to: `https://clodds-worker.<account>.workers.dev/webhook/slack`
3. Subscribe to `message.im` and `app_mention` events

## API Endpoints

### Health Check
```
GET /api/health
```

### Markets
```
GET /api/markets/search?q=<query>&platform=<platform>&limit=<n>
GET /api/markets/:platform/:id
GET /api/markets/:platform/:id/orderbook
```

### Arbitrage
```
GET /api/arbitrage/scan?min_edge=<pct>&platforms=<list>
GET /api/arbitrage/recent?limit=<n>
```

## Development

```bash
# Run locally
npx wrangler dev

# View logs
npx wrangler tail
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare Workers                      │
├─────────────────────────────────────────────────────────┤
│  Webhooks                    REST API                    │
│  ├─ /webhook/telegram        ├─ /api/markets/*          │
│  ├─ /webhook/discord         ├─ /api/arbitrage/*        │
│  └─ /webhook/slack           └─ /api/health             │
│           │                           │                  │
│           ▼                           ▼                  │
│  ┌─────────────────┐       ┌─────────────────┐          │
│  │  Session DO     │       │  Market Cache   │          │
│  │  (per user)     │       │  (KV Store)     │          │
│  └─────────────────┘       └─────────────────┘          │
│           │                           │                  │
│           ▼                           ▼                  │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Claude API + Tools                  │    │
│  └─────────────────────────────────────────────────┘    │
│                          │                               │
│                          ▼                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │                D1 Database                       │    │
│  │  users, alerts, positions, arbitrage_history    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Limitations (vs Full Clodds)

- **No trading execution** — CLOB APIs (Polymarket, Kalshi) require persistent WebSocket connections and complex signing that exceed Workers' 30s CPU limit. Use full Clodds for trading.
- No WebSocket real-time feeds (REST polling only)
- No browser/shell tools
- No whale tracking or copy trading
- Limited to webhook-based channels (no Socket Mode)

## License

MIT
