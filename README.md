# Clodds

An agentic AI assistant for prediction markets. Chat naturally to find arbitrage, execute trades, and track your portfolio across 9 platforms.

![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-brightgreen?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

<img src="./assets/demo.gif" alt="Clodds demo" />

## Get started

### Quick install

```bash
git clone https://github.com/alsk1992/clodds.git
cd clodds
npm install
```

### Configure

```bash
cp .env.example .env
```

Add your API keys to `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...        # Required
TELEGRAM_BOT_TOKEN=...              # For Telegram
POLYMARKET_API_KEY=...              # For trading
```

### Start

```bash
npm run build
npm start
```

Open Telegram and message your bot, or visit `http://localhost:18789/webchat`

---

## What can Clodds do?

<table>
<tr>
<td width="50%">

### Find Arbitrage

```
/opportunity scan election

Found: 3.2% edge on "Trump wins"
  Polymarket: 52c
  Kalshi: 55c

  Strategy: Buy @ 52c, Sell @ 55c
  Profit: $3.20 per $100
```

</td>
<td width="50%">

### Execute Trades

```
/buy polymarket trump-wins YES 100 @ 0.52

Order placed:
  Market: Will Trump win?
  Side: YES @ 52c
  Size: $100
  Status: FILLED
```

</td>
</tr>
<tr>
<td width="50%">

### Track Portfolio

```
/portfolio

Positions: 5
Total Value: $2,450
Today P&L: +$127 (+5.2%)

TRUMP-WIN  YES  200 @ 0.48  +$24
FED-RATE   NO   150 @ 0.35  +$18
...
```

</td>
<td width="50%">

### Combinatorial Arbitrage

```
/opportunity combinatorial

Scanning for conditional dependencies...

Found: Trump 55c > Republican 52c
  Violation: P(Trump) should be ≤ P(GOP)
  Edge: 3% guaranteed
```

</td>
</tr>
</table>

---

## Supported Platforms

### Prediction Markets (9)

| Platform | Data | Trade | Type |
|----------|:----:|:-----:|------|
| Polymarket | ✓ | ✓ | Crypto (USDC) |
| Kalshi | ✓ | ✓ | US Regulated |
| Betfair | ✓ | ✓ | Sports Exchange |
| Smarkets | ✓ | ✓ | Sports |
| Drift | ✓ | ✓ | Solana |
| Manifold | ✓ | - | Play Money |
| Metaculus | ✓ | - | Forecasting |
| PredictIt | ✓ | - | US Politics |

### Messaging Channels (14+)

Telegram, Discord, Slack, WhatsApp, Teams, Matrix, Signal, IRC, Nostr, and more.

### LLM Providers (6)

Claude (default), GPT-4, Gemini, Groq, Together, Fireworks

---

## Commands

### Opportunity Finding

| Command | Description |
|---------|-------------|
| `/opportunity scan [query]` | Find arbitrage opportunities |
| `/opportunity combinatorial` | Scan for conditional dependencies |
| `/opportunity active` | Show active opportunities |
| `/opportunity stats` | Performance statistics |

### Trading

| Command | Description |
|---------|-------------|
| `/buy <platform> <market> <side> <size> @ <price>` | Place buy order |
| `/sell <platform> <market> <side> <size> @ <price>` | Place sell order |
| `/portfolio` | Show positions and P&L |
| `/trades recent` | Recent trade history |

### Bots & Safety

| Command | Description |
|---------|-------------|
| `/bot list` | List trading bots |
| `/bot start <id>` | Start a bot |
| `/safety status` | Safety controls |
| `/safety kill` | Emergency stop all |

### General

| Command | Description |
|---------|-------------|
| `/help` | List all commands |
| `/markets <query>` | Search markets |
| `/model <name>` | Change AI model |
| `/new` | Reset conversation |

---

## Configuration

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Channels (pick one or more)
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
SLACK_BOT_TOKEN=...

# Trading (optional)
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
KALSHI_API_KEY=...
BETFAIR_APP_KEY=...

# Features
MARKET_INDEX_ENABLED=true
OPPORTUNITY_FINDER_ENABLED=true
```

### Config File

Create `clodds.json` for advanced options:

```json
{
  "opportunityFinder": {
    "enabled": true,
    "minEdge": 0.5,
    "platforms": ["polymarket", "kalshi", "betfair"]
  },
  "safety": {
    "dailyLossLimit": 500,
    "maxDrawdownPct": 20
  }
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      GATEWAY                             │
│   WebSocket + HTTP + Auth + Dashboard                    │
└─────────────────────┬───────────────────────────────────┘
                      │
      ┌───────────────┼───────────────┐
      ▼               ▼               ▼
┌───────────┐   ┌───────────┐   ┌───────────┐
│ CHANNELS  │   │  AGENTS   │   │   FEEDS   │
│           │   │           │   │           │
│ Telegram  │   │ Main      │   │ Polymarket│
│ Discord   │   │ Trading   │   │ Kalshi    │
│ Slack     │   │ Research  │   │ Betfair   │
│ WhatsApp  │   │ Alerts    │   │ Crypto    │
│ ...       │   │           │   │ ...       │
└───────────┘   └───────────┘   └───────────┘
                      │
      ┌───────────────┼───────────────┐
      ▼               ▼               ▼
┌───────────┐   ┌───────────┐   ┌───────────┐
│ PORTFOLIO │   │ EXECUTION │   │ ARBITRAGE │
│ Tracking  │   │  Engine   │   │ Detector  │
└───────────┘   └───────────┘   └───────────┘
```

---

## Documentation

| Guide | Description |
|-------|-------------|
| [User Guide](./docs/USER_GUIDE.md) | Day-to-day usage |
| [Opportunity Finder](./docs/OPPORTUNITY_FINDER.md) | Arbitrage detection |
| [Trading](./docs/TRADING.md) | Execution, bots, strategies |
| [API Reference](./docs/API.md) | HTTP endpoints |
| [Deployment](./docs/DEPLOYMENT_GUIDE.md) | Production setup |

---

## Development

```bash
# Dev mode with hot reload
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

### Docker

```bash
docker compose up --build
```

---

## Screenshots

### Arbitrage Scanner
Find cross-platform arbitrage opportunities in seconds.

<img src="./assets/screenshots/arbitrage.png" alt="Arbitrage Scanner" width="700" />

### Portfolio Dashboard
Track positions and P&L across all platforms.

<img src="./assets/screenshots/portfolio.png" alt="Portfolio Dashboard" width="700" />

### Chat Interfaces

<table>
<tr>
<td width="40%">

**Telegram**

<img src="./assets/screenshots/telegram.png" alt="Telegram" width="280" />

</td>
<td width="60%">

**WebChat**

<img src="./assets/screenshots/webchat.png" alt="WebChat" width="420" />

</td>
</tr>
</table>

---

## Reporting Issues

Found a bug? [Open an issue](https://github.com/alsk1992/clodds/issues)

---

## License

MIT License - see [LICENSE](./LICENSE)

---

<p align="center">
  <b>Clodds</b> — Claude + Odds
</p>
