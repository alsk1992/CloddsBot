<p align="center">
  <img src="https://cloddsbot.com/logo.png" alt="Clodds Logo" width="280">
</p>

<p align="center">
  <strong>AI-powered trading terminal for prediction markets, crypto & futures</strong>
  <br>
  <sub>Claude + Odds = Clodds</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.4-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/typescript-5.3-blue" alt="TypeScript">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-yellow" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/channels-22-purple" alt="22 Channels">
  <img src="https://img.shields.io/badge/markets-9-orange" alt="9 Markets">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#everything-we-built">Features</a> •
  <a href="#channels">Channels</a> •
  <a href="#prediction-markets-9">Markets</a> •
  <a href="#documentation">Docs</a>
</p>

---

**Clodds** is a personal AI trading terminal for prediction markets, crypto spot, and **perpetual futures with leverage**. Run it on your own machine, chat via any of **22 messaging platforms**, trade across **9 prediction markets + 5 futures exchanges**, and manage your portfolio — all through natural conversation.

Built on Claude with arbitrage detection algorithms based on [arXiv:2508.03474](https://arxiv.org/abs/2508.03474), which documented arbitrage patterns on Polymarket. See [Arbitrage Limitations](#arbitrage-limitations) for practical considerations.

---

## Deployment Options

| Option | Best For | Setup Time | Features |
|--------|----------|------------|----------|
| **[Self-Hosted](#quick-start)** | Full control, all features | 5 min | 22 channels, trading, DeFi, bots |
| **[Cloudflare Worker](#cloudflare-worker)** | Lightweight, edge deployment | 2 min | 3 webhook channels, market data, arbitrage |
| **[Compute API](#compute-api)** | Agents paying for compute | Live | LLM, code, web, data, storage |

## Compute API

**Live at:** https://api.cloddsbot.com

Agents can pay USDC for compute resources — no API keys needed, just a wallet.

```bash
# Check health
curl https://api.cloddsbot.com/health

# See pricing
curl https://api.cloddsbot.com/pricing

# Check balance
curl https://api.cloddsbot.com/balance/0xYourWallet
```

**Services:**
| Service | Pricing | Description |
|---------|---------|-------------|
| `llm` | $0.000003/token | Claude, GPT-4, Llama, Mixtral |
| `code` | $0.001/second | Sandboxed Python, JS, Rust, Go |
| `web` | $0.005/request | Web scraping with JS rendering |
| `data` | $0.001/request | Prices, orderbooks, candles |
| `storage` | $0.0001/MB | Key-value file storage |
| `trade` | $0.01/call | Trade execution (Polymarket, DEXs) |

**Payment flow:**
1. Send USDC to treasury wallet on Base
2. Include payment proof in request
3. API credits your balance
4. Use compute services

See [docs/API.md](./docs/API.md#clodds-compute-api) for full documentation.

## Quick Start

**Option 1: npm (recommended)**
```bash
# One-time: configure npm for @alsk1992 scope
echo "@alsk1992:registry=https://npm.pkg.github.com" >> ~/.npmrc

# Install globally
npm install -g @alsk1992/clodds

# Run
export ANTHROPIC_API_KEY=sk-ant-...
clodds start
```

**Option 2: From source**
```bash
git clone https://github.com/alsk1992/CloddsBot.git && cd CloddsBot
npm install && cp .env.example .env
# Add ANTHROPIC_API_KEY to .env
npm run build && npm start
```

Open `http://localhost:18789/webchat` — no account needed.

## CLI

```bash
clodds start       # Start the gateway
clodds repl        # Interactive REPL
clodds doctor      # System diagnostics
clodds secure      # Harden security
clodds locale set zh  # Change language
```

See [docs/USER_GUIDE.md](./docs/USER_GUIDE.md) for all commands.

---

## Everything We Built

### At a Glance

| Category | What's Included |
|----------|-----------------|
| **Messaging** | 22 platforms (Telegram, Discord, WhatsApp, Slack, Teams, Signal, Matrix, iMessage, LINE, Nostr, and more) |
| **Prediction Markets** | 9 platforms (Polymarket, Kalshi, Betfair, Smarkets, Drift, Manifold, Metaculus, PredictIt) |
| **Perpetual Futures** | 4 exchanges (Binance, Bybit, Hyperliquid, MEXC) with up to 200x leverage, database tracking, A/B testing |
| **Trading** | Order execution on 5 platforms, portfolio tracking, P&L, trade logging |
| **Arbitrage** | Cross-platform detection, combinatorial analysis, semantic matching, real-time scanning |
| **AI** | 6 LLM providers, 4 specialized agents, semantic memory, 21 tools |
| **i18n** | 10 languages (EN, ZH, ES, JA, KO, DE, FR, PT, RU, AR) |
| **Solana DeFi** | Jupiter, Raydium, Orca, Meteora, Pump.fun integration |
| **EVM DeFi** | Uniswap V3, 1inch, Virtuals Protocol (ETH, ARB, OP, Base, Polygon) |
| **Smart Trading** | Whale tracking, copy trading, smart routing, MEV protection |
| **Trade Ledger** | Decision audit trail with confidence calibration, SHA-256 integrity hashing, statistics |
| **Crypto Whale Tracking** | Multi-chain whale monitoring (Solana, ETH, Polygon, ARB, Base, OP) |
| **Payments** | x402 protocol for machine-to-machine USDC payments (Base + Solana) |
| **Bridging** | Wormhole cross-chain token transfers |
| **Automation** | Trading bots, cron jobs, webhooks, skills system |

---

## Channels (22)

Telegram, Discord, Slack, WhatsApp, Teams, Matrix, Signal, iMessage, LINE, Nostr, Twitch, WebChat, and more.

All channels support real-time sync, rich media, and offline queuing.

---

## Prediction Markets (9)

| Platform | Trading | Type |
|----------|:-------:|------|
| Polymarket | ✓ | Crypto (USDC) |
| Kalshi | ✓ | US Regulated |
| Betfair | ✓ | Sports Exchange |
| Smarkets | ✓ | Sports |
| Drift | ✓ | Solana DEX |
| Manifold | data | Play Money |
| Metaculus | data | Forecasting |
| PredictIt | data | US Politics |

Supports limit/market orders, maker rebates, real-time orderbooks, P&L tracking, and smart routing.

---

## Crypto & DeFi

**Solana:** Jupiter, Raydium, Orca, Meteora, Pump.fun — with Jito MEV protection

**EVM (5 chains):** Uniswap V3, 1inch, Virtuals Protocol on Ethereum, Arbitrum, Optimism, Base, Polygon — with Flashbots MEV protection

**Bridging:** Wormhole cross-chain transfers (ETH ↔ Solana, Polygon ↔ Base)

**Payments:** x402 protocol for agent-to-agent USDC payments

---

## Perpetual Futures (4 Exchanges)

| Exchange | Max Leverage | KYC |
|----------|--------------|-----|
| Binance | 125x | Yes |
| Bybit | 100x | Yes |
| Hyperliquid | 50x | No |
| MEXC | 200x | No |

Long/short, cross/isolated margin, TP/SL, liquidation alerts, funding tracking, database logging.

```
/futures long BTCUSDT 0.1 10x
/futures sl BTCUSDT 95000
```

---

## AI System

**6 LLM providers:** Claude (primary), GPT-4, Gemini, Groq, Together, Ollama

**4 agents:** Main, Trading, Research, Alerts

**21 tools:** Browser, docker, exec, files, git, email, sms, webhooks, sql, vision

**Memory:** Semantic search (LanceDB), hybrid BM25, user profiles, persistent facts

---

## Arbitrage Detection

Based on [arXiv:2508.03474](https://arxiv.org/abs/2508.03474). Detects internal, cross-platform, and combinatorial arbitrage with semantic matching, liquidity scoring, and Kelly sizing.

```
YES: 45c + NO: 52c = 97c → Buy both → 3c profit
Polymarket @ 52c vs Kalshi @ 55c → 3c spread
```

**Note:** Defaults to dry-run mode. Cross-platform has currency/settlement complexity.

---

## Advanced Trading

**Whale Tracking:** Multi-chain monitoring (Solana, ETH, Polygon, ARB, Base, OP) with configurable thresholds

**Copy Trading:** Mirror successful wallets with sizing controls and SL/TP

**Swarm Trading:** Coordinated multi-wallet Pump.fun trading (20 wallets, Jito bundles)

**Smart Routing:** Best price, liquidity, or fees across platforms

**External Data:** FedWatch, 538, Silver Bulletin, RCP, Odds API for edge detection

**Safety:** Unified risk engine with circuit breaker, VaR/CVaR, volatility regime detection, stress testing, Kelly sizing, daily loss limits, kill switch

---

## Trading Bots

Built-in strategies: Mean Reversion, Momentum, Arbitrage, Market Making

Features: Configurable sizing, SL/TP, backtesting, live trading with safety limits

---

## Security

- Sandboxed execution (shell commands need approval)
- Encrypted credentials (AES-256-GCM)
- Audit logging for all trades

---

## Trade Ledger

Decision audit trail for AI trading transparency:

- **Decision Capture:** Every trade, copy, and risk decision logged with reasoning
- **Confidence Calibration:** Track AI prediction accuracy vs confidence levels
- **Integrity Hashing:** Optional SHA-256 hashes for tamper-proof records
- **Onchain Anchoring:** Anchor hashes to Solana, Polygon, or Base for immutable proof
- **Statistics:** Win rates, P&L, block reasons, accuracy by confidence bucket

```bash
clodds ledger stats              # Show decision statistics
clodds ledger calibration        # Confidence vs accuracy analysis
clodds ledger verify <id>        # Verify record integrity
clodds ledger anchor <id>        # Anchor hash to Solana
```

Enable: `clodds config set ledger.enabled true`

---

## Skills & Extensions

**103 bundled skills** across trading, data, automation, and infrastructure — lazy-loaded on first use so missing dependencies don't crash the app. Run `/skills` to see status.

| Category | Skills |
|----------|--------|
| Trading | Polymarket, Kalshi, Betfair, Hyperliquid, Binance, Bybit, MEXC, Jupiter, Raydium |
| Analysis | Arbitrage detection, edge finding, whale tracking, copy trading |
| Automation | Cron jobs, triggers, bots, webhooks |
| AI | Memory, embeddings, multi-agent routing |

**7 extensions** for Copilot, OpenTelemetry, LanceDB, and more.

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
│ Signal        │         │ Skills (103)  │         │ Arbitrage     │
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

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Channels (pick any)
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...

# Trading
POLYMARKET_API_KEY=...
SOLANA_PRIVATE_KEY=...
```

Data stored in `~/.clodds/` (SQLite database, auto-created on first run).

---

## Documentation

| Document | Description |
|----------|-------------|
| [User Guide](./docs/USER_GUIDE.md) | Commands, chat usage, workflows |
| [API Reference](./docs/API_REFERENCE.md) | HTTP/WebSocket endpoints, authentication, error codes |
| [Architecture](./docs/ARCHITECTURE.md) | System design, components, data flow, extension points |
| [Deployment](./docs/DEPLOYMENT.md) | Environment variables, Docker, systemd, production checklist |
| [Trading](./docs/TRADING.md) | Execution, bots, risk management, safety controls |
| [Security](./docs/SECURITY_AUDIT.md) | Security hardening, audit checklist |
| [OpenAPI Spec](./docs/openapi.yaml) | Full OpenAPI 3.0 specification |

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
| Skills | **103** |
| LLM Providers | **6** |
| Solana DEX Protocols | **5** |
| Trading Strategies | **4** |
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
