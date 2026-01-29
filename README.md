<p align="center">
  <img src="./assets/demo.gif" alt="Clodds Demo" width="600">
</p>

<h1 align="center">Clodds</h1>

<p align="center">
  <strong>Your AI-powered prediction market trading assistant</strong>
</p>

<p align="center">
  <a href="https://github.com/alsk1992/CloddsBot/actions"><img src="https://img.shields.io/github/actions/workflow/status/alsk1992/CloddsBot/ci.yml?style=for-the-badge&label=CI" alt="CI"></a>
  <a href="https://github.com/alsk1992/CloddsBot/releases"><img src="https://img.shields.io/github/v/release/alsk1992/CloddsBot?style=for-the-badge" alt="Release"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node.js-20%2B-brightgreen?style=for-the-badge" alt="Node.js 20+">
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge" alt="TypeScript">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#platforms">Platforms</a> •
  <a href="#commands">Commands</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="./docs/USER_GUIDE.md">Docs</a>
</p>

---

**Clodds** is an agentic AI assistant that helps you find arbitrage opportunities, execute trades, and manage your portfolio across 9 prediction market platforms. Chat naturally via Telegram, Discord, Slack, or 14+ other channels.

Built on Claude, with cross-platform arbitrage detection based on [arXiv:2508.03474](https://arxiv.org/abs/2508.03474) ("Unravelling the Probabilistic Forest"), which found **$40M+ in realized arbitrage** on Polymarket.

---

## Quick Start

**Install and run in 60 seconds:**

```bash
git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm run build && npm start
```

Open `http://localhost:18789/webchat` or connect via Telegram.

---

## Features

### Trading & Arbitrage

- **Cross-platform arbitrage detection** — Find price differences across Polymarket, Kalshi, Betfair, and more
- **Combinatorial arbitrage** — Detect conditional dependencies (Trump wins → Republican wins)
- **Internal arbitrage** — Find YES + NO < $1 opportunities within single markets
- **Order execution** — Place limit and market orders on 5 platforms
- **Portfolio tracking** — Real-time positions, P&L, and performance metrics
- **Kelly criterion sizing** — Optimal position sizing with fractional Kelly safety
- **Risk management** — Daily loss limits, max drawdown, position limits, kill switch

### AI Capabilities

- **Multi-agent system** — Specialized agents for trading, research, and alerts
- **6 LLM providers** — Claude (default), GPT-4, Gemini, Groq, Together, Fireworks
- **19+ tools** — Browser automation, web search, SQL, Git, Docker, and more
- **Semantic memory** — Vector embeddings with hybrid BM25 search
- **Natural language** — Chat naturally, no command memorization required

### Messaging Channels

- **14+ platforms** — Telegram, Discord, Slack, WhatsApp, Teams, Matrix, Signal, IRC, and more
- **Real-time sync** — Conversations persist across devices
- **Rich media** — Images, files, code blocks with syntax highlighting

---

## Platforms

### Prediction Markets (9)

| Platform | Data Feed | Trading | Portfolio | Type |
|----------|:---------:|:-------:|:---------:|------|
| **Polymarket** | WebSocket | ✓ | ✓ | Crypto (USDC) |
| **Kalshi** | WebSocket | ✓ | ✓ | US Regulated |
| **Betfair** | WebSocket | ✓ | ✓ | Sports Exchange |
| **Smarkets** | WebSocket | ✓ | ✓ | Sports (2% fees) |
| **Drift** | REST | ✓ | ✓ | Solana DEX |
| **Manifold** | WebSocket | — | Partial | Play Money |
| **Metaculus** | REST | — | — | Forecasting |
| **PredictIt** | REST | — | — | US Politics |

### Crypto Prices (10 assets)

Real-time via Binance WebSocket: BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, MATIC, DOT, LINK

### Messaging Channels (14+)

Telegram • Discord • Slack • WhatsApp • Microsoft Teams • Matrix • Signal • IRC • Nostr • WebChat • Twitch • BlueBubbles • Zalo • Mattermost

---

## Screenshots

### Arbitrage Scanner

Find cross-platform opportunities with one command.

<img src="./assets/screenshots/arbitrage.png" alt="Arbitrage Scanner" width="700">

### Portfolio Dashboard

Track all your positions and P&L in real-time.

<img src="./assets/screenshots/portfolio.png" alt="Portfolio Dashboard" width="700">

### Chat Interfaces

<table>
<tr>
<td width="40%">

**Telegram**

<img src="./assets/screenshots/telegram.png" alt="Telegram" width="280">

</td>
<td width="60%">

**WebChat**

<img src="./assets/screenshots/webchat.png" alt="WebChat" width="400">

</td>
</tr>
</table>

---

## Commands

### Opportunity Finding

```
/opportunity scan [query]        Find arbitrage opportunities
/opportunity combinatorial       Scan for conditional dependencies
/opportunity active              Show active opportunities
/opportunity stats               Performance statistics
/opportunity link <a> <b>        Link equivalent markets
/opportunity realtime start      Enable real-time scanning
```

### Trading

```
/buy <platform> <market> <side> <size> @ <price>
/sell <platform> <market> <side> <size> @ <price>
/portfolio                       Show positions and P&L
/trades stats                    Trade statistics
/trades recent                   Recent trade history
```

### Bots & Safety

```
/bot list                        List trading bots
/bot start <id>                  Start a bot
/bot stop <id>                   Stop a bot
/safety status                   Safety controls status
/safety kill                     Emergency stop all trading
```

### General

```
/help                            List all commands
/markets <query>                 Search markets
/model <name>                    Change AI model
/new                             Reset conversation
/remember <key> <value>          Store a preference
/memory                          View stored memories
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           GATEWAY                                │
│         HTTP Server • WebSocket • Auth • Rate Limiting           │
└───────────────────────────────┬─────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│   CHANNELS    │       │    AGENTS     │       │    FEEDS      │
│               │       │               │       │               │
│ • Telegram    │       │ • Main        │       │ • Polymarket  │
│ • Discord     │       │ • Trading     │       │ • Kalshi      │
│ • Slack       │       │ • Research    │       │ • Betfair     │
│ • WhatsApp    │       │ • Alerts      │       │ • Crypto      │
│ • Teams       │       │               │       │               │
│ • Matrix      │       │ Tools (19+)   │       │ Arbitrage     │
│ • Signal      │       │ Skills        │       │ Detector      │
│ • WebChat     │       │ Memory        │       │               │
└───────────────┘       └───────────────┘       └───────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│   PORTFOLIO   │       │  EXECUTION    │       │  OPPORTUNITY  │
│   Tracking    │       │   Engine      │       │    Finder     │
│               │       │               │       │               │
│ • Positions   │       │ • Polymarket  │       │ • Semantic    │
│ • P&L         │       │ • Kalshi      │       │   Matching    │
│ • History     │       │ • Betfair     │       │ • Scoring     │
│ • Snapshots   │       │ • Smarkets    │       │ • Analytics   │
└───────────────┘       └───────────────┘       └───────────────┘
```

---

## Configuration

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Channels (enable one or more)
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
SLACK_BOT_TOKEN=...
WHATSAPP_SESSION_PATH=...

# Trading (optional)
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_FUNDER_ADDRESS=...
KALSHI_API_KEY=...
KALSHI_API_SECRET=...
BETFAIR_APP_KEY=...
BETFAIR_SESSION_TOKEN=...

# Features
MARKET_INDEX_ENABLED=true
OPPORTUNITY_FINDER_ENABLED=true
MEMORY_ENABLED=true
```

### Config File (clodds.json)

```json
{
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1"
  },
  "agent": {
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 8192
  },
  "opportunityFinder": {
    "enabled": true,
    "minEdge": 0.5,
    "minLiquidity": 100,
    "platforms": ["polymarket", "kalshi", "betfair"],
    "semanticMatching": true,
    "realtime": false
  },
  "safety": {
    "dailyLossLimit": 500,
    "maxDrawdownPct": 20,
    "maxPositionPct": 25,
    "cooldownMs": 3600000
  },
  "trading": {
    "dryRun": true,
    "autoLog": true
  }
}
```

---

## Safety & Security

### Trading Safety

- **Daily loss limit** — Stop trading after reaching max daily loss (default: $500)
- **Max drawdown** — Halt on portfolio drawdown from peak (default: 20%)
- **Position limits** — Cap single position size (default: 25% of portfolio)
- **Kill switch** — Emergency stop via `/safety kill`
- **Dry run mode** — Test strategies without real money

### Security Defaults

- **Sandboxed execution** — Shell commands require approval
- **Credential encryption** — API keys encrypted at rest (AES-256-GCM)
- **Rate limiting** — Per-platform request throttling
- **Audit logging** — All trades and commands logged

---

## Channel Setup

### Telegram

1. Create bot via [@BotFather](https://t.me/botfather)
2. Add `TELEGRAM_BOT_TOKEN` to `.env`
3. Message your bot to start

### Discord

1. Create app at [Discord Developer Portal](https://discord.com/developers/applications)
2. Enable Message Content Intent
3. Add `DISCORD_BOT_TOKEN` to `.env`
4. Invite bot to server

### Slack

1. Create app at [Slack API](https://api.slack.com/apps)
2. Enable Socket Mode
3. Add `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` to `.env`

### WebChat

Built-in at `http://localhost:18789/webchat` — no setup required.

---

## Documentation

| Guide | Description |
|-------|-------------|
| [User Guide](./docs/USER_GUIDE.md) | Day-to-day usage, commands, workflows |
| [Opportunity Finder](./docs/OPPORTUNITY_FINDER.md) | Arbitrage detection, scoring, analytics |
| [Trading System](./docs/TRADING.md) | Execution, bots, strategies, safety |
| [API Reference](./docs/API.md) | HTTP endpoints, webhooks |
| [Deployment](./docs/DEPLOYMENT_GUIDE.md) | Production setup, Docker, monitoring |

---

## Development

```bash
# Development mode (hot reload)
npm run dev

# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint

# Build
npm run build
```

### Docker

```bash
docker compose up --build
```

### Regenerate Screenshots

```bash
node scripts/capture-screenshots.js
```

---

## Arbitrage Detection

Based on [arXiv:2508.03474](https://arxiv.org/abs/2508.03474) — "Unravelling the Probabilistic Forest: Arbitrage in Prediction Markets"

The paper found **$40M+ in realized arbitrage profits** on Polymarket through:

### Market Rebalancing
When YES + NO prices don't sum to $1:
```
YES: 45c + NO: 52c = 97c
Buy both → guaranteed $1 payout
Profit: 3c per dollar
```

### Combinatorial Arbitrage
Conditional dependencies between markets:
```
"Trump wins" (55c) > "Republican wins" (52c)
Violation: P(Trump) must be ≤ P(Republican)
Strategy: Sell Trump, Buy Republican
```

### Heuristic Reduction
Naive analysis requires O(2^n+m) comparisons. We reduce via:
- **Timeliness** — Compare markets with similar end dates
- **Topical clustering** — Group by topic (elections, crypto, fed)
- **Logical relationships** — implies, inverse, mutually_exclusive

---

## Contributing

Contributions welcome! Please read our contributing guidelines before submitting PRs.

```bash
git checkout -b feature/your-feature
npm test
git commit -m "Add your feature"
git push origin feature/your-feature
```

---

## License

MIT License — see [LICENSE](./LICENSE)

---

<p align="center">
  <strong>Clodds</strong> — Claude + Odds
  <br>
  <sub>Built with Claude by Anthropic</sub>
</p>
