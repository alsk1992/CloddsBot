# Clodds 🎲

**Claude + Odds** — The most comprehensive open-source AI platform for prediction markets.

A production-grade agentic AI framework with multi-platform trading, real-time market data, cross-platform arbitrage detection, and machine-to-machine payments. Built for prediction market traders, researchers, and developers.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

---

## Why Clodds?

| Feature | Clodds | Competitors |
|---------|--------|-------------|
| Prediction Markets | **9 platforms** | 0-2 |
| Trading Execution | **5 platforms** | 0-1 |
| Messaging Channels | **14+ platforms** | 1-3 |
| LLM Providers | **6 providers** | 1 |
| Cross-Platform Arbitrage | ✅ | ❌ |
| x402 Crypto Payments | ✅ | ❌ |
| Multi-Agent Routing | ✅ | ❌ |
| Semantic Memory | ✅ | ❌ |

---

## Table of Contents

- [Features](#features)
- [Prediction Markets](#prediction-markets)
- [AI Capabilities](#ai-capabilities)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Channels](#channels)
- [Trading](#trading)
- [Arbitrage](#arbitrage)
- [Payments (x402)](#payments-x402)
- [Tools](#tools)
- [Skills](#skills)
- [Memory System](#memory-system)
- [CLI Reference](#cli-reference)
- [Development](#development)
- [License](#license)

---

## Features

### Core Platform

| Feature | Status | Description |
|---------|--------|-------------|
| **9 Prediction Markets** | ✅ | Polymarket, Kalshi, Betfair, Smarkets, Manifold, Metaculus, PredictIt, Drift |
| **5 Trading Platforms** | ✅ | Full order execution on Polymarket, Kalshi, Betfair, Smarkets, Drift |
| **14+ Messaging Channels** | ✅ | Telegram, Discord, Slack, WhatsApp, Teams, Matrix, Signal, and more |
| **6 LLM Providers** | ✅ | Claude, GPT-4, Gemini, Groq, Together, Fireworks |
| **Cross-Platform Arbitrage** | ✅ | Automatic opportunity detection across all markets |
| **x402 Payments** | ✅ | Machine-to-machine USDC payments (Base + Solana) |
| **Real-time Crypto Prices** | ✅ | 10 cryptos via Binance WebSocket |
| **Portfolio Tracking** | ✅ | Multi-platform positions and P&L |
| **Price Alerts** | ✅ | Price, volume, and edge alerts |
| **Semantic Memory** | ✅ | Vector embeddings + hybrid search |
| **Multi-Agent Routing** | ✅ | 4 specialized agents with intelligent routing |
| **19+ AI Tools** | ✅ | Browser, SQL, Git, Docker, and more |

---

## Prediction Markets

### Supported Platforms (9 Total)

| Platform | Data Feed | Trading | Portfolio | Type |
|----------|-----------|---------|-----------|------|
| **Polymarket** | ✅ WebSocket | ✅ Full | ✅ Full | Crypto (USDC) |
| **Kalshi** | ✅ WebSocket | ✅ Full | ✅ Full | US Regulated |
| **Betfair** | ✅ WebSocket | ✅ Full | ✅ Full | Sports Exchange |
| **Smarkets** | ✅ WebSocket | ✅ Full | ✅ Full | Sports (2% fees) |
| **Drift** | ✅ REST | ✅ Full | ✅ Full | Solana |
| **Manifold** | ✅ WebSocket | ❌ No API | ⚠️ Partial | Play Money |
| **Metaculus** | ✅ REST | ❌ Forecast | ❌ | Forecasting |
| **PredictIt** | ✅ REST | ❌ Read-only | ❌ | US Politics |

### Trading Features

```typescript
// Polymarket
await execution.buyLimit('polymarket', marketId, 'Yes', 0.45, 100);
await execution.marketBuy('polymarket', marketId, 'Yes', 50);

// Kalshi
await execution.sellLimit('kalshi', marketId, 'Yes', 0.60, 100);

// Betfair (back/lay)
await betfair.placeBackOrder(marketId, selectionId, 2.5, 100);
await betfair.placeLayOrder(marketId, selectionId, 2.6, 50);

// Smarkets
await smarkets.placeBuyOrder(marketId, contractId, 0.45, 100);
```

### Real-time Crypto Prices (10 Assets)

| Asset | Feed | 24h Stats |
|-------|------|-----------|
| BTC | ✅ Binance WS | ✅ Change, High, Low, Volume |
| ETH | ✅ Binance WS | ✅ |
| SOL | ✅ Binance WS | ✅ |
| XRP | ✅ Binance WS | ✅ |
| DOGE | ✅ Binance WS | ✅ |
| ADA | ✅ Binance WS | ✅ |
| AVAX | ✅ Binance WS | ✅ |
| MATIC | ✅ Binance WS | ✅ |
| DOT | ✅ Binance WS | ✅ |
| LINK | ✅ Binance WS | ✅ |

Fallback sources: Coinbase, CoinGecko

---

## AI Capabilities

### Multi-Agent System

| Agent | Purpose | Routing |
|-------|---------|---------|
| **Main** | General assistant | Default |
| **Trading** | Order execution | `/buy`, `/sell`, `/portfolio` |
| **Research** | Market analysis | `/research`, `/analyze` |
| **Alerts** | Price monitoring | `/alert`, `/watch` |

### LLM Providers (6)

| Provider | Models | Features |
|----------|--------|----------|
| **Anthropic** | Claude 3.5 Sonnet, Opus, Haiku | Default, extended thinking |
| **OpenAI** | GPT-4, GPT-4o, GPT-3.5 | Fallback |
| **Google** | Gemini Pro, Flash | Multimodal |
| **Groq** | Llama, Mixtral | High-speed |
| **Together** | Open-source models | Cost-effective |
| **Fireworks** | Various | Fast inference |

### AI Tools (19+)

| Tool | Description |
|------|-------------|
| `exec` | Shell commands with approval |
| `browser` | Playwright automation |
| `web-search` | DuckDuckGo/Brave search |
| `web-fetch` | URL content extraction |
| `files` | Read/write/edit files |
| `git` | Git operations |
| `sql` | Database queries |
| `docker` | Container management |
| `image` | Vision analysis |
| `email` | Send emails |
| `sms` | Send SMS |
| `transcription` | Audio to text |
| `webhooks` | HTTP callbacks |
| `canvas` | Visual rendering |
| `nodes` | Hardware control |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Anthropic API Key
- Platform API keys (optional)

### Installation

```bash
# Clone
git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your API keys

# Build
npm run build

# Start
npm start
```

### First Run

```bash
# Start gateway
clodds start

# Check health
clodds doctor

# Approve your DM (get code from Telegram)
clodds pairing approve telegram ABC123

# Set yourself as owner
clodds pairing set-owner telegram <your_id>
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           GATEWAY                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │
│  │ WebSocket│  │   HTTP   │  │   Auth   │  │    Control UI        │ │
│  │  Server  │  │  Server  │  │  Layer   │  │    (Dashboard)       │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘ │
└───────┴─────────────┴─────────────┴────────────────────┴────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   CHANNELS    │    │    AGENTS     │    │    FEEDS      │
│  (14+ types)  │    │  (4 agents)   │    │  (9 markets)  │
│               │    │               │    │               │
│  • Telegram   │    │  • Main       │    │  • Polymarket │
│  • Discord    │    │  • Trading    │    │  • Kalshi     │
│  • Slack      │    │  • Research   │    │  • Betfair    │
│  • WhatsApp   │    │  • Alerts     │    │  • Smarkets   │
│  • Teams      │    │               │    │  • Drift      │
│  • Matrix     │    │  Tools (19+)  │    │  • Crypto     │
│  • Signal     │    │  Skills       │    │               │
│  • ...        │    │  Memory       │    │  Arbitrage    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          SERVICES                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Portfolio│  │ Execution│  │ Arbitrage│  │ Payments │            │
│  │ Tracking │  │  Engine  │  │ Detector │  │  (x402)  │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │     DATABASE     │
                    │     (SQLite)     │
                    │                  │
                    │  • Sessions      │
                    │  • Memory        │
                    │  • Trades        │
                    │  • Alerts        │
                    │  • Credentials   │
                    └──────────────────┘
```

### Directory Structure

```
clodds/
├── src/
│   ├── agents/              # AI agent system
│   ├── channels/            # 14+ messaging adapters
│   │   ├── telegram/
│   │   ├── discord/
│   │   ├── slack/
│   │   ├── whatsapp/
│   │   ├── teams/
│   │   ├── matrix/
│   │   ├── signal/
│   │   └── ...
│   ├── feeds/               # Market data feeds
│   │   ├── polymarket/
│   │   ├── kalshi/
│   │   ├── betfair/         # NEW
│   │   ├── smarkets/        # NEW
│   │   ├── drift/
│   │   ├── crypto/          # NEW - 10 assets
│   │   └── ...
│   ├── execution/           # Order execution
│   ├── portfolio/           # Position tracking
│   ├── arbitrage/           # Cross-platform arb
│   ├── payments/            # x402 protocol
│   │   └── x402/
│   │       ├── index.ts
│   │       ├── evm.ts       # Base signing
│   │       └── solana.ts    # Solana signing
│   ├── alerts/              # Price alerts
│   ├── history/             # Trade history
│   ├── memory/              # Semantic memory
│   ├── tools/               # 19+ AI tools
│   ├── skills/              # Pluggable skills
│   ├── routing/             # Multi-agent routing
│   ├── providers/           # 6 LLM providers
│   └── ...
├── trading/                 # Python trading libs
├── docs/                    # Documentation
├── tests/                   # Test suites
└── ui/                      # Web dashboard
```

---

## Configuration

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Messaging (at least one)
TELEGRAM_BOT_TOKEN=123456:ABC...
DISCORD_BOT_TOKEN=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...

# Prediction Markets
POLY_PRIVATE_KEY=0x...
POLY_API_KEY=...
POLY_API_SECRET=...
POLY_API_PASSPHRASE=...

KALSHI_API_KEY_ID=...
KALSHI_PRIVATE_KEY_PEM=...

BETFAIR_APP_KEY=...
BETFAIR_USERNAME=...
BETFAIR_PASSWORD=...

SMARKETS_SESSION_TOKEN=...

# Solana (Drift)
SOLANA_PRIVATE_KEY=...
SOLANA_RPC_URL=...

# x402 Payments
X402_EVM_PRIVATE_KEY=0x...
X402_SOLANA_PRIVATE_KEY=...
X402_AUTO_APPROVE_LIMIT=1.0

# Optional LLM Providers
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
GROQ_API_KEY=...
TOGETHER_API_KEY=...
```

### Config File (`~/.clodds/clodds.json`)

```json5
{
  "gateway": {
    "port": 3000,
    "auth": { "token": "your-secret" }
  },

  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4",
        "fallbacks": ["openai/gpt-4", "anthropic/claude-haiku-3"]
      }
    }
  },

  "channels": {
    "telegram": { "enabled": true, "dmPolicy": "pairing" },
    "discord": { "enabled": true },
    "slack": { "enabled": true }
  },

  "feeds": {
    "polymarket": { "enabled": true },
    "kalshi": { "enabled": true },
    "betfair": { "enabled": true },
    "smarkets": { "enabled": true },
    "drift": { "enabled": true },
    "manifold": { "enabled": true }
  },

  "x402": {
    "enabled": true,
    "network": "base",
    "autoApproveLimit": 1.0
  },

  "trading": {
    "enabled": true,
    "dryRun": false,
    "maxOrderSize": 100
  }
}
```

---

## Channels (14+ Platforms)

| Channel | Status | Auth Method |
|---------|--------|-------------|
| **Telegram** | ✅ Production | Bot Token |
| **Discord** | ✅ Production | Bot Token |
| **Slack** | ✅ Production | Bolt (Bot + App Token) |
| **WhatsApp** | ✅ Production | Baileys (QR) |
| **Microsoft Teams** | ✅ Production | App ID + Password |
| **Matrix** | ✅ Production | Access Token |
| **Signal** | ✅ Production | signal-cli |
| **Google Chat** | ✅ Production | Service Account |
| **Line** | ✅ Production | Channel Token |
| **iMessage** | ✅ macOS | AppleScript |
| **Mattermost** | ✅ Production | Bot Token |
| **Nextcloud Talk** | ✅ Production | App Password |
| **Nostr** | ✅ Production | Private Key |
| **Twitch** | ✅ Production | OAuth |

---

## Trading

### Order Types

| Type | Description | Platforms |
|------|-------------|-----------|
| **Limit (GTC)** | Good till cancelled | All |
| **Market (FOK)** | Fill or kill | Polymarket, Kalshi |
| **Maker (POST_ONLY)** | Add liquidity only | Polymarket |
| **GTD** | Good till date | Kalshi |
| **Back** | Bet for outcome | Betfair, Smarkets |
| **Lay** | Bet against outcome | Betfair, Smarkets |

### Example Usage

```typescript
import { createExecutionService } from './execution';

const exec = createExecutionService(config);

// Polymarket
const order = await exec.buyLimit('polymarket', {
  marketId: '0x...',
  outcome: 'Yes',
  price: 0.45,
  size: 100,
});

// Kalshi
await exec.marketBuy('kalshi', {
  marketId: 'INXD-24DEC31-T25000',
  outcome: 'Yes',
  size: 50,
});

// Check positions
const positions = await portfolio.getPositions();
const pnl = await portfolio.getUnrealizedPnL();
```

---

## Arbitrage

Cross-platform arbitrage detection across all supported markets.

### Features

- Real-time price monitoring
- Automatic opportunity detection
- Configurable minimum spread
- Question similarity matching
- Alert notifications

### Usage

```typescript
import { createArbitrageService } from './arbitrage';

const arb = createArbitrageService(priceProviders);

// Add market match
arb.addMatch({
  markets: [
    { platform: 'polymarket', marketId: '0x...', question: 'Trump wins?' },
    { platform: 'kalshi', marketId: 'PRES-...', question: 'Trump elected?' },
  ],
  similarity: 0.95,
  matchedBy: 'manual',
});

// Start monitoring
arb.start();

// Get opportunities
const opportunities = arb.getOpportunities();
// [{ buyPlatform: 'kalshi', buyPrice: 0.42, sellPlatform: 'polymarket', sellPrice: 0.48, spreadPct: 14.3 }]
```

### Chat Commands

```
/arbitrage trump           # Find arb opportunities
/compare "fed rate cut"    # Compare prices across platforms
```

---

## Payments (x402)

HTTP 402 machine-to-machine crypto payments via the [x402 protocol](https://x402.org).

### Supported Networks

| Network | Status | Fee |
|---------|--------|-----|
| **Base** | ✅ | Free (Coinbase facilitator) |
| **Base Sepolia** | ✅ | Free (testnet) |
| **Solana** | ✅ | Free (Coinbase facilitator) |
| **Solana Devnet** | ✅ | Free (testnet) |

### Client (Pay for APIs)

```typescript
import { createPaidFetch } from './payments';

const paidFetch = createPaidFetch({
  network: 'base',
  evmPrivateKey: '0x...',
  autoApproveLimit: 1.0, // $1 max auto-approve
});

// Automatically pays 402 responses
const response = await paidFetch('https://api.example.com/premium');
```

### Server (Receive Payments)

```typescript
import { createX402Server } from './payments';

const x402 = createX402Server(
  { payToAddress: '0x...', network: 'base' },
  {
    'GET /premium': { priceUsd: 0.01 },
    'POST /ai': { priceUsd: 0.05 },
  }
);

app.use(x402.middleware);
```

---

## Memory System

Persistent semantic memory with vector embeddings.

### Memory Types

| Type | Description |
|------|-------------|
| `fact` | Durable facts about user |
| `preference` | Stated likes/dislikes |
| `note` | Useful reminders |
| `profile` | Short profile summary |

### Commands

```
/remember preference timezone=PST
/remember note working_on=prediction markets
/memory                              # Show memories
/forget timezone                     # Delete memory
```

### Features

- Vector embeddings (hybrid BM25 + semantic)
- Per-user and per-channel scopes
- Auto-capture from conversations
- Privacy filters (skip secrets)

---

## CLI Reference

```bash
# Gateway
clodds start              # Start gateway
clodds doctor             # Health checks
clodds status             # Show status

# Pairing
clodds pairing list telegram
clodds pairing approve telegram ABC123
clodds pairing set-owner telegram <id>

# Skills
clodds skills list
clodds skills install <name>
clodds skills search "trading"

# Permissions
clodds permissions pending
clodds permissions approve <id>
```

### Chat Commands

```
/help                           # List commands
/new                            # Reset conversation
/model sonnet                   # Change model
/portfolio                      # Show positions
/markets trump                  # Search markets

# Opportunity Finding
/opportunity scan [query]       # Find arbitrage opportunities
/opportunity combinatorial      # Scan for combinatorial arb (arXiv:2508.03474)
/opportunity active             # Show active opportunities
/opportunity stats              # Performance statistics
/opportunity link <a> <b>       # Link equivalent markets

# Trading
/trades stats                   # Trade statistics
/trades recent                  # Recent trades
/bot list                       # List trading bots
/safety status                  # Safety controls

# Alerts & Risk
/alert price BTC > 100000       # Set alert
/risk show                      # View risk limits
```

---

## Development

### Setup

```bash
git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot
npm install
npm run dev   # Hot reload
```

### Docker

```bash
docker compose up --build
```

### Testing

```bash
npm run test
npm run typecheck
npm run ci
```

### Adding a Platform

1. Create `src/feeds/[platform]/index.ts`
2. Implement the feed interface
3. Add trading methods if supported
4. Register in `src/feeds/index.ts`
5. Add types to `src/types.ts`

---

## License

MIT — Free for everyone, forever.

---

## Links

- [GitHub](https://github.com/alsk1992/CloddsBot)
- [Issues](https://github.com/alsk1992/CloddsBot/issues)
- [x402 Protocol](https://x402.org)
- [Polymarket](https://polymarket.com)
- [Kalshi](https://kalshi.com)
- [Betfair](https://betfair.com)

---

*Built with Claude. The most comprehensive open-source prediction market platform.*
