<p align="center">
  <img src="./assets/logo.png" alt="Clodds Logo" width="280">
</p>

<p align="center">
  <strong>The AI-powered prediction market platform you run yourself</strong>
  <br>
  <sub>Claude + Odds = Clodds</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/typescript-5.3-blue" alt="TypeScript">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-yellow" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/channels-22-purple" alt="22 Channels">
  <img src="https://img.shields.io/badge/markets-9-orange" alt="9 Markets">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#everything-we-built">Everything We Built</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#channels">Channels</a> •
  <a href="#commands">Commands</a> •
  <a href="./docs/USER_GUIDE.md">Docs</a>
</p>

---

**Clodds** is a personal AI assistant for prediction market trading. Run it on your own machine, chat via any of **22 messaging platforms**, find arbitrage across **9 prediction markets**, execute trades, and manage your portfolio — all through natural conversation.

Built on Claude with cross-platform arbitrage detection based on [arXiv:2508.03474](https://arxiv.org/abs/2508.03474) which found **$40M+ in realized arbitrage** on Polymarket.

---

## Deployment Options

| Option | Best For | Setup Time | Features |
|--------|----------|------------|----------|
| **[Self-Hosted](#quick-start)** | Full control, all features | 5 min | 22 channels, trading, DeFi, bots |
| **[Cloudflare Worker](#cloudflare-worker)** | Lightweight, edge deployment | 2 min | 3 webhook channels, market data, arbitrage |

## Quick Start

```bash
git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot
npm install
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env
npm run build && npm start
```

Open `http://localhost:18789/webchat` — no account needed.

For Telegram: add `TELEGRAM_BOT_TOKEN` to `.env` and message your bot.

## Cloudflare Worker

For a lightweight edge deployment without dedicated hardware:

```bash
cd apps/clodds-worker
npm install
npx wrangler d1 create clodds
npx wrangler kv:namespace create CACHE
# Update wrangler.toml with IDs
npx wrangler d1 migrations apply clodds
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Worker supports: Telegram, Discord, Slack webhooks | Market search | Arbitrage scanning | Price alerts

See [apps/clodds-worker/README.md](./apps/clodds-worker/README.md) for full setup.

---

## CLI Commands

After installing, all commands start with `clodds`:

```bash
# Core
clodds start                    # Start the gateway
clodds repl                     # Interactive local REPL
clodds doctor                   # Run system diagnostics
clodds status                   # Show system status
clodds endpoints                # Show webhook endpoints

# User Management
clodds pairing list <channel>   # List pending pairing requests
clodds pairing approve <ch> <c> # Approve a pairing request
clodds pairing users <channel>  # List paired users
clodds pairing add <ch> <user>  # Add user to allowlist

# Configuration
clodds config get [key]         # Get config value
clodds config set <key> <val>   # Set config value
clodds config path              # Show config file path

# Skills & Extensions
clodds skills list              # List installed skills
clodds skills search <query>    # Search skill registry
clodds skills install <slug>    # Install a skill
clodds skills update [slug]     # Update skills

# Sessions & Memory
clodds session list             # List active sessions
clodds session clear [id]       # Clear session(s)
clodds memory list <userId>     # View user memories
clodds memory clear <userId>    # Clear memories

# Automation
clodds cron list                # List scheduled jobs
clodds cron show <id>           # Show job details
clodds cron enable <id>         # Enable a job
clodds cron disable <id>        # Disable a job

# MCP Servers
clodds mcp list                 # List MCP servers
clodds mcp add <name> <cmd>     # Add MCP server
clodds mcp test <name>          # Test connection

# Permissions (sandboxed execution)
clodds permissions list         # Show permission rules
clodds permissions allow <pat>  # Add allow pattern
clodds permissions pending      # Show pending requests

# Usage Tracking
clodds usage summary            # Token usage summary
clodds usage by-model           # Usage by model
clodds usage by-user            # Usage by user

# Account
clodds login                    # Authenticate
clodds logout                   # Sign out
clodds version                  # Show version
```

---

## Everything We Built

### At a Glance

| Category | What's Included |
|----------|-----------------|
| **Messaging** | 22 platforms (Telegram, Discord, WhatsApp, Slack, Teams, Signal, Matrix, iMessage, LINE, Nostr, and more) |
| **Prediction Markets** | 9 platforms (Polymarket, Kalshi, Betfair, Smarkets, Drift, Manifold, Metaculus, PredictIt) |
| **Trading** | Order execution on 5 platforms, portfolio tracking, P&L, trade logging |
| **Arbitrage** | Cross-platform detection, combinatorial analysis, semantic matching, real-time scanning |
| **AI** | 6 LLM providers, 4 specialized agents, semantic memory, 21 tools |
| **Solana DeFi** | Jupiter, Raydium, Orca, Meteora, Pump.fun integration |
| **EVM DeFi** | Uniswap V3, 1inch aggregator (ETH, ARB, OP, Base, Polygon) |
| **Smart Trading** | Whale tracking, copy trading, smart routing, MEV protection |
| **Payments** | x402 protocol for machine-to-machine USDC payments (Base + Solana) |
| **Bridging** | Wormhole cross-chain token transfers |
| **Automation** | Trading bots, cron jobs, webhooks, skills system |

---

## Messaging Channels (22)

Connect via any platform you already use:

**Chat Platforms**
- Telegram
- Discord
- Slack
- WhatsApp
- Microsoft Teams
- Matrix
- Signal
- Google Chat
- iMessage (via BlueBubbles)
- LINE
- Mattermost
- Nextcloud Talk
- Zalo

**Decentralized**
- Nostr
- Tlon/Urbit

**Streaming & Voice**
- Twitch
- Voice (audio/VoIP)

**Built-in**
- WebChat (browser)
- IRC

**Features across all channels:**
- Real-time sync across devices
- Message editing and deletion
- Rich text, images, files
- Reactions and polls
- Offline message queuing

---

## Prediction Markets (9)

### Full Trading Support

| Platform | Feed | Trading | Portfolio | Type |
|----------|:----:|:-------:|:---------:|------|
| **Polymarket** | WebSocket | ✓ | ✓ | Crypto (USDC) |
| **Kalshi** | WebSocket | ✓ | ✓ | US Regulated |
| **Betfair** | WebSocket | ✓ | ✓ | Sports Exchange |
| **Smarkets** | WebSocket | ✓ | ✓ | Sports (2% fees) |
| **Drift** | REST | ✓ | ✓ | Solana DEX |

### Data Feeds Only

| Platform | Feed | Type |
|----------|:----:|------|
| **Manifold** | WebSocket | Play Money |
| **Metaculus** | REST | Forecasting |
| **PredictIt** | REST | US Politics |

### Trading Features
- Limit, market, GTC, FOK, POST_ONLY orders
- Maker order rebates (Polymarket: -0.5% rebate)
- Real-time orderbook data
- Position tracking with cost basis
- P&L calculation (realized + unrealized)
- Trade history with fill prices
- Portfolio snapshots over time
- Auto-arbitrage execution with risk limits
- Smart order routing (best price/liquidity)

---

## Crypto & DeFi

### Real-time Prices (10 assets)
BTC • ETH • SOL • XRP • DOGE • ADA • AVAX • MATIC • DOT • LINK

Via Binance WebSocket with Coinbase/CoinGecko fallback.

### Solana DEX Integration (5 protocols)

| Protocol | Features |
|----------|----------|
| **Jupiter** | DEX aggregator, best route finding |
| **Raydium** | AMM swaps, pool discovery |
| **Orca** | Whirlpool concentrated liquidity |
| **Meteora** | DLMM dynamic pools |
| **Pump.fun** | Token launch protocol |

### EVM DEX Integration (5 chains)

| Chain | DEXes | Features |
|-------|-------|----------|
| **Ethereum** | Uniswap V3, 1inch | Full MEV protection via Flashbots |
| **Arbitrum** | Uniswap V3, 1inch | L2 sequencer protection |
| **Optimism** | Uniswap V3, 1inch | L2 sequencer protection |
| **Base** | Uniswap V3, 1inch | L2 sequencer protection |
| **Polygon** | Uniswap V3, 1inch | Standard routing |

### MEV Protection

| Network | Protection Method |
|---------|------------------|
| **Ethereum** | Flashbots Protect, MEV Blocker |
| **Solana** | Jito bundles, tip instructions |
| **L2s** | Sequencer-protected by default |

### Wormhole Bridging
Cross-chain transfers between:
- Ethereum ↔ Solana
- Polygon ↔ Base
- Avalanche ↔ Optimism
- Auto-route selection
- USDC and token wrapping

### x402 Payments
Machine-to-machine crypto payments:
- **Networks**: Base, Base Sepolia, Solana, Solana Devnet
- **Asset**: USDC
- **Features**: Auto-approval, fee-free via Coinbase facilitator
- Full client and server middleware

---

## AI System

### LLM Providers (6)

| Provider | Models | Use Case |
|----------|--------|----------|
| **Anthropic** | Claude Opus, Sonnet, Haiku | Primary (best for trading) |
| **OpenAI** | GPT-4, GPT-4o | Fallback |
| **Google** | Gemini Pro, Flash | Multimodal |
| **Groq** | Llama, Mixtral | High-speed inference |
| **Together** | Open models | Cost-effective |
| **Fireworks** | Various | Fast inference |
| **Ollama** | Local models | Privacy-first |

### Agents (4)

| Agent | Purpose |
|-------|---------|
| **Main** | General conversation, task routing |
| **Trading** | Order execution, portfolio management |
| **Research** | Market analysis, news synthesis |
| **Alerts** | Price monitoring, notifications |

### Tools (21)

**Development**
- `browser` — Puppeteer web automation
- `canvas` — Image manipulation
- `docker` — Container management
- `exec` — Shell commands (sandboxed)
- `files` — File system operations
- `git` — Version control
- `nodes` — Node.js subprocess execution

**Communication**
- `email` — SMTP sending
- `sms` — Twilio SMS
- `messages` — Cross-platform messaging
- `webhooks` — HTTP callbacks
- `web-fetch` — HTTP requests with caching
- `web-search` — Search engine queries

**Data**
- `sql` — Direct database queries
- `image` — Vision analysis
- `transcription` — Audio to text

### Memory System
- **Semantic search** — Vector embeddings (LanceDB)
- **Hybrid search** — BM25 + semantic
- **Context compression** — Auto-summarize old messages
- **User profiles** — Preferences, trading rules
- **Facts & notes** — Persistent knowledge

---

## Arbitrage Detection

Based on [arXiv:2508.03474](https://arxiv.org/abs/2508.03474) — "Unravelling the Probabilistic Forest"

### Opportunity Types

**1. Internal Arbitrage**
```
YES: 45c + NO: 52c = 97c
Buy both → guaranteed $1 payout
Profit: 3c per dollar
```

**2. Cross-Platform Arbitrage**
```
Polymarket: Trump YES @ 52c
Kalshi: Trump YES @ 55c
Buy low, sell high → 3c profit
```

**3. Combinatorial Arbitrage**
```
"Trump wins" (55c) > "Republican wins" (52c)
Violation: P(Trump) must be ≤ P(Republican)
Sell Trump, Buy Republican → guaranteed profit
```

**4. Edge vs Fair Value**
```
Market price: 45%
538 model: 52%
Edge: 7% (buy YES)
```

### Detection Features
- **Semantic matching** — Find equivalent markets across platforms using embeddings
- **Liquidity scoring** — Factor in orderbook depth and slippage
- **Kelly sizing** — Optimal position sizing with fractional safety
- **Real-time scanning** — WebSocket price subscriptions
- **Heuristic reduction** — O(2^n+m) → O(n·k) via topic clustering
- **Win rate tracking** — Performance analytics by platform pair

---

## Advanced Trading

### Whale Tracking (Polymarket)
Monitor large trades and positions to identify market-moving activity:
- Track trades >$10k automatically
- Follow specific wallet addresses
- Real-time WebSocket notifications
- Position history and PnL tracking
- Top trader leaderboard

### Copy Trading
Automatically mirror trades from successful wallets:
- Follow multiple addresses
- Configurable sizing (fixed, proportional, % of portfolio)
- Copy delay to avoid detection
- Risk limits (max position, daily loss)
- Stop loss / take profit automation

### Smart Order Routing
Automatically route orders to the best venue:
- **Best price** — Route to lowest ask / highest bid
- **Best liquidity** — Route to deepest orderbook
- **Lowest fees** — Factor in maker/taker fees
- **Balanced** — Weighted optimization of all factors
- **Split orders** — Execute across multiple platforms

### External Data Feeds
Compare market prices to external sources for edge detection:

| Source | Type | Data |
|--------|------|------|
| **CME FedWatch** | Official | Fed rate probabilities |
| **FiveThirtyEight** | Model | Election forecasts |
| **Silver Bulletin** | Model | Nate Silver's forecasts |
| **RealClearPolitics** | Poll | Polling averages |
| **The Odds API** | Betting | Sports odds |

### Trading Safety

**Circuit Breaker**
Automatic trading halt when risk thresholds are exceeded:
- Max loss ($ or %) triggers pause
- Consecutive loss limit (e.g., 5 losses in a row)
- Error rate threshold (e.g., >50% failed orders)
- Auto-reset after configurable cooldown

**Position Management**
- Stop-loss orders (fixed price or trailing)
- Take-profit targets
- Position size limits per market
- Daily trade limits

**Kelly Criterion Sizing**
Optimal position sizing with safety margins:
- Full Kelly, Half Kelly, Quarter Kelly options
- Multi-outcome Kelly for complex markets
- Portfolio-level Kelly allocation
- Confidence-adjusted sizing

### Portfolio Analytics

**Performance Attribution**
Track where your edge comes from:
- By edge source (price lag, liquidity gap, information)
- By time of day and day of week
- By edge size bucket
- Execution quality (slippage, fill rate)

**Correlation Tracking**
Understand portfolio risk:
- Position correlation matrix
- Category exposure (politics, crypto, sports, etc.)
- Concentration risk (HHI score)
- Hedged position detection

**Semantic Match Verification**
Prevent false arbitrage on different markets:
- Entity extraction (dates, thresholds, names)
- Automatic match rejection on mismatches
- Confidence scoring with warnings
- Human review flags for uncertain matches

### Drift (Solana) Integration

**Liquidation Alerts**
Real-time monitoring for leveraged positions:
- Health factor tracking
- Alert levels: Warning → Danger → Critical
- Position-level liquidation prices
- Formatted messages with action recommendations

---

## Screenshots

### Demo
<p align="center">
  <img src="./assets/demo.gif" alt="Clodds Demo" width="600">
</p>

### Arbitrage Scanner
<img src="./assets/screenshots/arbitrage.png" alt="Arbitrage Scanner" width="700">

### Portfolio Dashboard
<img src="./assets/screenshots/portfolio.png" alt="Portfolio" width="700">

### Chat Interfaces
<table>
<tr>
<td width="40%">
<strong>Telegram</strong>
<img src="./assets/screenshots/telegram.png" alt="Telegram" width="280">
</td>
<td width="60%">
<strong>WebChat</strong>
<img src="./assets/screenshots/webchat.png" alt="WebChat" width="400">
</td>
</tr>
</table>

---

## Chat Commands

These commands work inside any chat interface (Telegram, Discord, WebChat, etc.):

### Opportunity Finding
```
/opportunity scan [query]        Find arbitrage opportunities
/opportunity combinatorial       Scan conditional dependencies
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
/trades recent                   Recent history
```

### Bots & Automation
```
/bot list                        List trading bots
/bot start <id>                  Start a bot
/bot stop <id>                   Stop a bot
/safety status                   View safety controls
/safety kill                     Emergency stop all
```

### Market Research
```
/markets <query>                 Search all markets
/compare <query>                 Compare prices across platforms
/news <topic>                    Get relevant news
```

### Memory & Preferences
```
/remember <type> <key>=<value>   Store preference/fact/note
/memory                          View stored memories
/forget <key>                    Delete memory
```

### General
```
/help                            List all commands
/model <name>                    Change AI model
/new                             Reset conversation
/status                          Check context usage
```

---

## Trading Bots

### Built-in Strategies

| Strategy | Description |
|----------|-------------|
| **Mean Reversion** | Buy dips, sell rallies based on deviation from moving average |
| **Momentum** | Follow price trends with configurable lookback |
| **Arbitrage** | Auto-execute cross-platform opportunities |

### Bot Features
- Configurable intervals and position sizes
- Kelly criterion or fixed percentage sizing
- Stop-loss and take-profit exits
- Portfolio-aware execution
- Signal logging and backtesting
- Live trading with safety limits

---

## Safety & Risk Management

### Trading Safety
- **Daily loss limit** — Stop after max loss (default: $500)
- **Max drawdown** — Halt at portfolio drawdown (default: 20%)
- **Position limits** — Cap single position (default: 25%)
- **Kill switch** — `/safety kill` stops everything
- **Dry run mode** — Test without real money

### Security
- **Sandboxed execution** — Shell commands need approval
- **Encrypted credentials** — AES-256-GCM at rest
- **Rate limiting** — Per-platform throttling
- **Audit logging** — All trades logged

---

## Skills System

### Bundled Skills (13)
- `alerts` — Price and event alerts
- `edge` — Edge detection and analysis
- `markets` — Market search and discovery
- `news` — News aggregation
- `portfolio` — Portfolio management
- `portfolio-sync` — Multi-platform sync
- `research` — Market research automation
- `trading-kalshi` — Kalshi trading
- `trading-manifold` — Manifold trading
- `trading-polymarket` — Polymarket trading
- And more...

### Extensibility
- Install custom skills
- Per-skill configuration
- Event-driven architecture
- Dynamic command registration

---

## Extensions (7)

| Extension | Purpose |
|-----------|---------|
| `copilot-proxy` | GitHub Copilot integration |
| `diagnostics-otel` | OpenTelemetry observability |
| `google-auth` | Google OAuth |
| `llm-task` | LLM task orchestration |
| `lobster` | Advanced tracing |
| `memory-lancedb` | Vector database for memory |
| `qwen-portal` | Alibaba Qwen models |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                            GATEWAY                                   │
│       HTTP • WebSocket • Auth • Rate Limiting • 1000 connections     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│   CHANNELS    │         │    AGENTS     │         │    FEEDS      │
│   (22)        │         │    (4)        │         │    (9+)       │
├───────────────┤         ├───────────────┤         ├───────────────┤
│ Telegram      │         │ Main          │         │ Polymarket    │
│ Discord       │         │ Trading       │         │ Kalshi        │
│ WhatsApp      │         │ Research      │         │ Betfair       │
│ Slack         │         │ Alerts        │         │ Manifold      │
│ Teams         │         │               │         │ Crypto (10)   │
│ Matrix        │         │ Tools (21)    │         │               │
│ Signal        │         │ Skills (13)   │         │ Arbitrage     │
│ +15 more      │         │ Memory        │         │ Detector      │
└───────────────┘         └───────────────┘         └───────────────┘
        │                         │                         │
        └─────────────────────────┼─────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│   TRADING     │         │   SOLANA      │         │   PAYMENTS    │
│               │         │   DeFi        │         │   (x402)      │
├───────────────┤         ├───────────────┤         ├───────────────┤
│ Execution     │         │ Jupiter       │         │ Base USDC     │
│ Portfolio     │         │ Raydium       │         │ Solana USDC   │
│ Trade Logger  │         │ Orca          │         │ Auto-approve  │
│ Bots          │         │ Meteora       │         │               │
│ Risk Manager  │         │ Pump.fun      │         │ Wormhole      │
│ Backtesting   │         │               │         │ Bridge        │
└───────────────┘         └───────────────┘         └───────────────┘
```

---

## Configuration

### Environment Variables
```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Channels (pick any)
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
SLACK_BOT_TOKEN=...
SLACK_APP_TOKEN=...
WHATSAPP_SESSION_PATH=...

# Trading
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_FUNDER_ADDRESS=...
KALSHI_API_KEY=...
BETFAIR_APP_KEY=...

# Solana
SOLANA_RPC_URL=...
SOLANA_PRIVATE_KEY=...

# Features
MARKET_INDEX_ENABLED=true
OPPORTUNITY_FINDER_ENABLED=true
```

### Config File (clodds.json)
```json
{
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1"
  },
  "agent": {
    "model": "claude-sonnet-4-20250514"
  },
  "opportunityFinder": {
    "enabled": true,
    "minEdge": 0.5,
    "platforms": ["polymarket", "kalshi", "betfair"],
    "semanticMatching": true
  },
  "safety": {
    "dailyLossLimit": 500,
    "maxDrawdownPct": 20,
    "maxPositionPct": 25
  },
  "trading": {
    "dryRun": true
  }
}
```

---

## Channel Setup

### Telegram
1. Create bot via [@BotFather](https://t.me/botfather)
2. Add `TELEGRAM_BOT_TOKEN` to `.env`
3. Message your bot

### Discord
1. Create app at [Discord Developer Portal](https://discord.com/developers)
2. Enable Message Content Intent
3. Add `DISCORD_BOT_TOKEN` to `.env`
4. Invite bot to server

### Slack
1. Create app at [Slack API](https://api.slack.com/apps)
2. Enable Socket Mode
3. Add `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`

### WhatsApp
1. Use BlueBubbles or Baileys for connection
2. Configure session path in `.env`

### WebChat
Built-in at `http://localhost:18789/webchat` — no setup needed.

---

## Documentation

| Guide | Description |
|-------|-------------|
| [User Guide](./docs/USER_GUIDE.md) | Daily usage, commands |
| [Opportunity Finder](./docs/OPPORTUNITY_FINDER.md) | Arbitrage detection |
| [Trading System](./docs/TRADING.md) | Execution, bots, safety |
| [API Reference](./docs/API.md) | HTTP endpoints |
| [Deployment](./docs/DEPLOYMENT_GUIDE.md) | Production setup |
| [Worker Deployment](./apps/clodds-worker/README.md) | Cloudflare Workers setup |

---

## Development

```bash
npm run dev          # Hot reload
npm test             # Run tests
npm run typecheck    # Type check
npm run lint         # Lint
npm run build        # Build
```

### Docker
```bash
docker compose up --build
```

---

## Summary

| Category | Count |
|----------|------:|
| Messaging Channels | **22** |
| Prediction Markets | **9** |
| AI Tools | **21** |
| Skills | **13** |
| LLM Providers | **6** |
| Solana DEX Protocols | **5** |
| Trading Strategies | **3** |
| Extensions | **7** |

---

## License

MIT — see [LICENSE](./LICENSE)

---

<p align="center">
  <strong>Clodds</strong> — Claude + Odds
  <br>
  <sub>Built with Claude by Anthropic</sub>
</p>
