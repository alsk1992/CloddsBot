<p align="center">
  <img src="./assets/logo.png" alt="Clodds Logo" width="280">
</p>

<p align="center">
  <strong>AI-powered trading terminal for prediction markets, crypto & futures</strong>
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

**Clodds** is a personal AI trading terminal for prediction markets, crypto spot, and **perpetual futures with leverage**. Run it on your own machine, chat via any of **22 messaging platforms**, trade across **9 prediction markets + 5 futures exchanges**, and manage your portfolio — all through natural conversation.

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
| **Perpetual Futures** | 4 exchanges (Binance, Bybit, Hyperliquid, MEXC) with up to 200x leverage, database tracking, A/B testing |
| **Trading** | Order execution on 5 platforms, portfolio tracking, P&L, trade logging |
| **Arbitrage** | Cross-platform detection, combinatorial analysis, semantic matching, real-time scanning |
| **AI** | 6 LLM providers, 4 specialized agents, semantic memory, 21 tools |
| **Solana DeFi** | Jupiter, Raydium, Orca, Meteora, Pump.fun integration |
| **EVM DeFi** | Uniswap V3, 1inch aggregator (ETH, ARB, OP, Base, Polygon) |
| **Smart Trading** | Whale tracking, copy trading, smart routing, MEV protection |
| **Crypto Whale Tracking** | Multi-chain whale monitoring (Solana, ETH, Polygon, ARB, Base, OP) |
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
- Proper ECDSA secp256k1 signing for EVM
- Solana ATA derivation via PDA algorithm
- Real blockchain balance queries

---

## Perpetual Futures Trading

Trade perpetual futures with leverage across centralized and decentralized exchanges. Full PostgreSQL database integration for trade tracking, custom strategy support, and A/B testing.

### Supported Exchanges

| Exchange | Type | Max Leverage | KYC Required | Features |
|----------|------|--------------|--------------|----------|
| **Binance Futures** | CEX | 125x | Yes | USDT-M perpetuals, highest liquidity, 55+ API methods |
| **Bybit** | CEX | 100x | Yes | USDT perpetuals, unified account, 50+ API methods |
| **Hyperliquid** | DEX | 50x | No | On-chain (Arbitrum), fully decentralized, 60+ API methods |
| **MEXC** | CEX | 200x | No (small amounts) | No-KYC exchange, 35+ API methods |

### Core Features
- **Long & Short** — Open leveraged positions in either direction
- **Cross & Isolated Margin** — Choose margin mode per position
- **Take-Profit / Stop-Loss** — Automatic exit orders on entry
- **Liquidation Monitoring** — Real-time alerts at 5%/3%/2% proximity
- **Position Management** — View all positions, close individually or all
- **Funding Rate Tracking** — Monitor funding costs
- **Database Integration** — PostgreSQL trade logging with `futures_trades` table
- **Custom Strategies** — Build your own with `FuturesStrategy` interface
- **A/B Testing** — Test strategy variants with `futures_strategy_variants` table

### Easy Setup
```typescript
import { setupFromEnv } from 'clodds/trading/futures';

// Auto-configure from environment variables
const { clients, database, strategyEngine } = await setupFromEnv();

// Environment variables:
// BINANCE_API_KEY, BINANCE_API_SECRET
// BYBIT_API_KEY, BYBIT_API_SECRET
// HYPERLIQUID_PRIVATE_KEY, HYPERLIQUID_WALLET_ADDRESS
// MEXC_API_KEY, MEXC_API_SECRET
// DATABASE_URL (for trade tracking)
```

### Chat Commands
```
/futures balance binance           # Check margin balance
/futures positions                 # View all open positions
/futures long BTCUSDT 0.1 10x      # Open 0.1 BTC long at 10x
/futures short ETHUSDT 1 20x       # Open 1 ETH short at 20x
/futures tp BTCUSDT 105000         # Set take-profit
/futures sl BTCUSDT 95000          # Set stop-loss
/futures close BTCUSDT             # Close BTC position
/futures close-all binance         # Close all positions on Binance
/futures markets binance           # List available markets
/futures funding BTCUSDT           # Check funding rate
/futures leverage BTCUSDT 10       # Set leverage
/futures stats                     # View trade statistics from database
```

### Comprehensive API Coverage (200+ Methods)

**Binance (55+ methods):** Market data, trading, account, risk management, staking, convert, portfolio margin
**Bybit (50+ methods):** Linear/inverse perpetuals, unified account, copy trading, lending, earn products
**Hyperliquid (60+ methods):** Perp trading, spot, vaults, staking, delegations, referrals, leaderboards
**MEXC (35+ methods):** Futures trading, account management, batch orders, TP/SL

### Programmatic Usage
```typescript
import { BinanceFuturesClient, FuturesDatabase, StrategyEngine } from 'clodds/trading/futures';

// Initialize exchange client
const binance = new BinanceFuturesClient({
  apiKey: process.env.BINANCE_API_KEY!,
  apiSecret: process.env.BINANCE_API_SECRET!,
});

// Database tracking
const db = new FuturesDatabase(process.env.DATABASE_URL!);
await db.initialize();

// Open a position
const order = await binance.placeOrder({
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: 0.01,
});

// Log to database
await db.logTrade({
  exchange: 'binance',
  symbol: 'BTCUSDT',
  orderId: order.orderId,
  side: 'BUY',
  price: order.avgPrice,
  quantity: order.executedQty,
});

// Custom strategy with A/B testing
const engine = new StrategyEngine(db);
engine.registerStrategy(new MomentumStrategy({ lookbackPeriod: 14 }));
engine.registerVariant('momentum', 'aggressive', { threshold: 0.02 });
engine.registerVariant('momentum', 'conservative', { threshold: 0.05 });
```

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

### Crypto Whale Tracking (Multi-Chain)
Real-time whale monitoring across major blockchains:

| Chain | Protocol | Features |
|-------|----------|----------|
| **Solana** | Birdeye WebSocket | Real-time token transfers, swap detection |
| **Ethereum** | Alchemy WebSocket | ERC-20 transfers, large ETH movements |
| **Polygon** | Alchemy WebSocket | MATIC + token tracking |
| **Arbitrum** | Alchemy WebSocket | L2 whale activity |
| **Base** | Alchemy WebSocket | Coinbase L2 tracking |
| **Optimism** | Alchemy WebSocket | OP ecosystem whales |

**Features:**
- Configurable thresholds per chain ($10k-$1M+)
- Watch specific wallet addresses
- Transaction type detection (transfer, swap, NFT, stake)
- Top whale leaderboards by volume
- Real-time alerts via any channel

### Copy Trading
Automatically mirror trades from successful wallets:
- Follow multiple addresses
- Configurable sizing (fixed, proportional, % of portfolio)
- Copy delay to avoid detection
- Risk limits (max position, daily loss)
- Stop-loss / take-profit monitoring with 5-second price polling
- Automatic position exit on SL/TP trigger

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
/positions                       List all positions
/pnl                             Show P&L summary
/portfolio sync                  Sync from platforms
/trades stats                    Trade statistics
/trades recent                   Recent history
```

### Perpetual Futures
```
/futures balance binance         Check margin balance
/futures positions               View all open positions
/futures long BTCUSDT 0.1 10x    Open long at 10x leverage
/futures short ETHUSDT 1 20x     Open short at 20x leverage
/futures tp BTCUSDT 105000       Set take-profit
/futures sl BTCUSDT 95000        Set stop-loss
/futures close BTCUSDT           Close position
/futures close-all               Close all positions
/futures stats                   Trade statistics from DB
```

### Solana DEX
```
/swap sol 1 SOL to USDC          Swap on Solana (Jupiter)
/swap sol 100 USDC to JUP        Swap USDC to JUP
/quote sol 1 SOL to USDC         Get quote without executing
/pools sol SOL                   List liquidity pools
/balance sol                     Check Solana balances
```

### EVM DEX (5 chains)
```
/swap eth 1 ETH to USDC          Swap on Ethereum
/swap arb 100 USDC to ARB        Swap on Arbitrum
/swap base 0.5 ETH to DEGEN      Swap on Base
/swap op 10 USDC to OP           Swap on Optimism
/swap matic 10 MATIC to USDC     Swap on Polygon
/compare eth 1 ETH to USDC       Compare Uniswap vs 1inch
```

### Copy Trading
```
/copy follow 0x1234...           Follow wallet
/copy follow 0x1234... --size 100 Fixed $100 per trade
/copy unfollow 0x1234...         Stop following
/copy list                       List followed wallets
/copy top 10                     Top 10 traders to copy
/copy status                     Copy trading status
```

### Whale Tracking
```
/whale start                     Start whale monitoring
/whale track 0x1234...           Track specific wallet
/whale top 10                    Top 10 traders by volume
/whale activity "trump"          Whale activity for market
/crypto-whale start              Start crypto whale tracking
/crypto-whale watch solana ABC   Watch Solana wallet
/crypto-whale top eth 10         Top ETH whales
```

### Price Alerts
```
/alert "Trump 2028" above 0.50   Alert when price goes above
/alert "Fed rate" below 0.30     Alert when price drops below
/alert "BTC" change 5%           Alert on 5% move
/alerts                          List all alerts
/alert delete <id>               Delete alert
```

### Trigger Orders (Auto-Execute)
```
/trigger buy poly "Trump" YES below 0.40 size 100   Buy when drops
/trigger sell poly "Trump" YES above 0.55 size all  Sell when rises
/trigger long binance BTCUSDT below 95000 0.1 10x   Futures entry
/trigger short binance ETHUSDT above 4000 1 20x     Short on breakout
/triggers                        List active triggers
/trigger cancel <id>             Cancel trigger
/sl poly "Trump" at 0.35         Stop-loss on position
/tp poly "Trump" at 0.65         Take-profit on position
```

### Edge Detection
```
/edge                            Scan all markets for edge
/edge politics                   Scan political markets
/edge fed                        Scan Fed/economic markets
/compare "Trump" 538 betting     Compare to external models
/kelly 0.45 0.55 1000            Kelly calculator
```

### Execution
```
/execute buy poly <market> YES 100 @ 0.52   Place limit order
/execute market-buy poly <market> YES 100   Market order
/execute maker-buy poly <market> YES 100    Post-only (rebate)
/orders open                     View open orders
/orders cancel <id>              Cancel order
/estimate-slippage poly <mkt> buy 1000      Check slippage
```

### Arbitrage
```
/arb start                       Start arbitrage monitoring
/arb check                       One-time scan
/arb opportunities               View current spreads
/arb compare <mkt-a> <mkt-b>     Compare two markets
/arb link <mkt-a> <mkt-b>        Manually link markets
/arb stats                       Arbitrage statistics
```

### Market Feeds
```
/feed search "trump"             Search all platforms
/feed price poly <market>        Get current price
/feed orderbook poly <market>    View orderbook
/feed subscribe poly <market>    Real-time updates
/feed kelly poly <mkt> --prob 0.55  Calculate Kelly
```

### Trade History
```
/history fetch                   Sync trades from APIs
/history stats                   Performance metrics
/history daily-pnl               Daily P&L breakdown
/history export                  Export to CSV
```

### Bots & Automation
```
/bot list                        List trading bots
/bot start <id>                  Start a bot
/bot stop <id>                   Stop a bot
/bot register <name> <strategy>  Create new bot
/cron list                       View scheduled jobs
/cron add "0 9 * * *" "task"     Schedule job
/safety status                   View safety controls
/safety kill                     Emergency stop all
```

### Bridge (Cross-Chain)
```
/bridge quote 100 USDC sol to eth   Quote transfer
/bridge send 100 USDC sol to eth    Execute transfer
/bridge redeem <tx-hash>            Claim tokens
/bridge status <tx-hash>            Check status
```

### Monitoring
```
/monitor start                   Start system monitoring
/monitor health                  Run health check
/monitor alerts                  View recent alerts
/monitor providers               Check LLM status
```

### Market Index
```
/index search "election"         Search indexed markets
/index categories                List categories
/index trending                  Trending markets
/index new --last 24h            New markets
```

### Market Research
```
/markets <query>                 Search all markets
/price <market-id>               Get current price
/orderbook <market-id>           View bid/ask spread
/compare <query>                 Compare prices across platforms
/news <topic>                    Get relevant news
```

### Memory & Preferences
```
/remember preference risk=low    Store preference
/remember fact "BTC halves 2028" Store a fact
/remember note "Check ETH"       Store a note
/memory                          View stored memories
/memory search "bitcoin"         Search memories
/forget <key>                    Delete memory
```

### Voice & TTS
```
/voice start                     Start voice listening
/voice stop                      Stop voice listening
/voice wake "hey clodds"         Set wake word
/speak "Order filled"            Speak text aloud
/voices                          List available voices
```

### Credentials
```
/creds add polymarket            Add platform credentials
/creds list                      List configured platforms
/creds test binance              Test API connection
/creds remove kalshi             Remove credentials
/auth status                     Check auth status
```

### Usage & Costs
```
/usage                           Current session usage
/usage today                     Today's usage
/usage cost month                Monthly cost estimate
/usage by-model                  Usage breakdown by model
```

### Sessions
```
/new                             Start new conversation
/reset                           Reset current session
/checkpoint save "before test"   Save checkpoint
/checkpoint restore <id>         Restore checkpoint
/history export                  Export conversation
```

### User Pairing
```
/pair                            Request pairing (get code)
/pair-code ABC123                Enter pairing code
/pairing list                    List pending requests
/pairing approve <code>          Approve request (admin)
/trust <user> owner              Grant owner trust
```

### Agent Routing
```
/agents                          List available agents
/agent trading                   Switch to trading agent
/bind research                   Bind channel to agent
/tools policy trading            View agent's tools
```

### MCP Servers
```
/mcp list                        List configured servers
/mcp status                      Check server connections
/mcp add <name> <command>        Add new MCP server
/mcp tools                       List available MCP tools
/mcp call <server> <tool>        Call an MCP tool
```

### Permissions
```
/permissions                     View current permissions
/permissions allow "npm *"       Allow command pattern
/permissions block "rm -rf"      Block dangerous command
/approve                         Approve pending command
/reject                          Reject pending command
```

### System Health
```
/doctor                          Run all diagnostics
/doctor quick                    Quick health check
/doctor api                      Check API keys
/doctor network                  Test connectivity
/health                          Quick health status
```

### Data Integrations
```
/integrations                    List data sources
/integrations enable fedwatch    Enable CME FedWatch
/integrations add webhook "sigs" Add custom webhook source
/integrations add rest "api" <u> Add REST API source
/integrations test <source>      Test connection
```

### Incoming Webhooks
```
/webhook create trading-signals  Create webhook endpoint
/webhook url <name>              Get webhook URL
/webhook test <name>             Send test payload
/webhook logs <name>             View recent payloads
```

### Auto-Reply Rules
```
/auto-reply                      List all rules
/auto-reply add "hi" "Hello!"    Add keyword rule
/auto-reply test "hello world"   Test which rules match
/auto-reply enable <id>          Enable/disable rule
```

### Plugins
```
/plugins                         List installed plugins
/plugins install <name>          Install from registry
/plugins enable <id>             Enable plugin
/plugins config <id>             View settings
```

### Background Jobs
```
/job spawn "npm run backtest"    Start background job
/jobs                            List running jobs
/job output <id>                 View job output
/job stop <id>                   Stop job
```

### Embeddings
```
/embeddings                      Show config
/embeddings provider openai      Set provider
/embeddings cache stats          Cache statistics
/embeddings test "sample text"   Generate test embedding
```

### Identity & Devices
```
/identity                        Show your identity
/identity link google            Connect OAuth provider
/identity devices                List devices
/identity device revoke <id>     Revoke device access
```

### Presence
```
/presence                        Show status
/presence away                   Set away status
/presence status "Trading"       Custom status message
```

### Remote Access
```
/remote tunnel ngrok 3000        Expose via ngrok
/remote tunnel cloudflare 3000   Expose via Cloudflare
/remote list                     List active tunnels
/remote close <id>               Close tunnel
```

### Search Config
```
/search-config                   Show search config
/search-config rebuild           Rebuild indexes
/search-config stats             Search statistics
```

### Streaming
```
/streaming                       Show settings
/streaming enable                Enable streaming
/streaming chunk-size 100        Set chunk size
/streaming typing on             Enable typing indicators
```

### Sandbox (Safe Code Execution)
```
/run python "print('Hello')"     Run Python code
/run node "console.log('Hi')"    Run JavaScript
/run bash "ls -la"               Run shell command
/sandbox status                  Container status
```

### Tailscale (VPN Sharing)
```
/tailscale serve 3000            Share port on tailnet
/tailscale funnel 3000           Expose to public internet
/tailscale status                Network status
/tailscale peers                 List connected peers
```

### Backtesting
```
/backtest <strategy> --period 30d        Backtest strategy
/backtest "buy dips" --from 2024-01-01   Custom period
/backtest <strategy> --monte-carlo 1000  Monte Carlo simulation
/backtest compare momentum mean-rev      Compare strategies
/backtest optimize <strategy>            Optimize parameters
/backtest report <id>                    Generate report
```

### Position Sizing
```
/kelly 0.55 2.0                  Calculate Kelly for odds/edge
/sizing portfolio                Show portfolio sizing
/sizing calculate 10000 0.55 2   Size for bankroll/prob/odds
/sizing mode half-kelly          Set default sizing mode
/sizing limits max 5%            Set max position limit
```

### Risk Management
```
/risk                            Show risk status
/risk circuit-breaker status     Circuit breaker status
/risk pause                      Pause all trading
/risk resume                     Resume trading
/risk daily-limit 500            Set daily loss limit
/risk max-drawdown 20%           Set max drawdown
/risk consecutive-loss 5         Set consecutive loss limit
```

### Position Management (SL/TP)
```
/positions                       List all positions
/position <id>                   Position details
/sl <position-id> at 0.35        Set stop-loss price
/sl <position-id> -10%           Stop-loss 10% below entry
/tp <position-id> at 0.65        Set take-profit price
/tp <position-id> +20%           Take-profit 20% above entry
/trailing <position-id> 5%       Trailing stop 5% from high
```

### Analytics & Attribution
```
/analytics                       Performance summary
/analytics today                 Today's performance
/analytics attribution           P&L by edge source
/analytics by-platform           P&L by platform
/analytics best-times            Best trading hours
/analytics edge-decay            How edge decays over time
/analytics export csv            Export to CSV
```

### Strategy Builder
```
/strategy create "Buy when..."   Create from natural language
/strategies                      List all strategies
/strategy <name>                 View strategy details
/strategy activate <name>        Start running strategy
/strategy deactivate <name>      Stop strategy
/strategy backtest <name>        Run backtest
/strategy from-template momentum Use template
```

### Smart Routing
```
/route "Trump" YES 1000          Find best route for order
/route compare "Trump" YES 1000  Compare all platforms
/route fees "Trump"              Compare fee structures
/route liquidity "Trump"         Compare orderbook depth
/route execute <route-id>        Execute routed order
/route split "Trump" YES 5000    Split across platforms
```

### MEV Protection
```
/mev                             Show current protection
/mev enable                      Enable protection
/mev disable                     Disable protection
/mev level aggressive            Maximum protection
/mev level standard              Balanced protection
/mev check <tx-hash>             Check if tx was attacked
/mev simulate <order>            Simulate MEV risk
```

### Slippage Analysis
```
/slippage estimate "Trump" 5000  Estimate slippage
/slippage depth "Trump"          Show orderbook depth
/slippage impact 10000           Price impact for size
/slippage optimize "Trump" 10000 Find best execution
/slippage max 1%                 Set max tolerance
/slippage protect on             Enable protection
```

### System Metrics
```
/metrics                         Show current metrics
/metrics system                  CPU, memory, latency
/metrics api                     API performance stats
/metrics trades                  Trade execution stats
/metrics latency                 Order latency stats
/metrics alert <name> > 100      Set metric alert
/metrics export csv              Export metrics
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

### Bundled Skills (61)

**Trading & Markets**
- `trading-polymarket` — Polymarket trading
- `trading-kalshi` — Kalshi trading
- `trading-manifold` — Manifold trading
- `trading-futures` — Perpetual futures (4 exchanges)
- `trading-solana` — Solana DEX (Jupiter/Raydium/Orca)
- `trading-evm` — EVM DEX trading (Uniswap/1inch)
- `trading-system` — Unified trading with bots
- `execution` — Order execution with slippage protection
- `portfolio` — Portfolio management
- `portfolio-sync` — Multi-platform sync

**Data & Feeds**
- `feeds` — Real-time market data feeds
- `integrations` — External data sources & custom connectors
- `webhooks` — Incoming webhooks for custom signals
- `market-index` — Market search and discovery
- `markets` — Market browsing
- `news` — News aggregation

**Analysis & Opportunities**
- `arbitrage` — Cross-platform arbitrage detection
- `opportunity` — Arbitrage opportunity scanner
- `edge` — Edge detection and analysis
- `qmd` — Quantitative market data
- `research` — Market research automation
- `history` — Trade history and analytics

**Smart Trading**
- `whale-tracking` — Multi-chain whale monitoring
- `copy-trading` — Mirror whale trades
- `alerts` — Price and event alerts

**Automation**
- `automation` — Cron jobs, scheduling
- `auto-reply` — Automatic response rules
- `processes` — Background jobs management
- `plugins` — Plugin management

**AI & Memory**
- `memory` — Persistent memory (preferences, facts, notes)
- `embeddings` — Vector embeddings configuration
- `search-config` — Search indexing configuration
- `routing` — Multi-agent routing and tool policies

**Infrastructure**
- `mcp` — MCP server management
- `streaming` — Response streaming configuration
- `remote` — SSH tunnels and remote access
- `monitoring` — System health and alerts
- `doctor` — System diagnostics

**User Management**
- `credentials` — Secure credential management
- `pairing` — User pairing and trust management
- `identity` — OAuth and device management
- `permissions` — Command approvals and security
- `sessions` — Session management and checkpoints
- `presence` — Online status and activity
- `usage` — Token usage and cost tracking

**Voice & Media**
- `voice` — Voice recognition and commands
- `tts` — Text-to-speech (ElevenLabs)

**Conditional Trading**
- `triggers` — Auto-execute when price thresholds met

**Strategy & Backtesting**
- `backtest` — Strategy validation with Monte Carlo simulation
- `strategy` — Build custom strategies from natural language
- `sizing` — Kelly criterion position sizing
- `risk` — Circuit breaker and loss limits

**Position Management**
- `positions` — Stop-loss, take-profit, trailing stops

**Analytics & Optimization**
- `analytics` — Performance attribution by edge source
- `slippage` — Slippage estimation and protection
- `metrics` — System telemetry and monitoring

**Order Routing**
- `router` — Smart order routing across platforms
- `mev` — MEV protection (Flashbots, Jito)

**Execution & Networking**
- `sandbox` — Safe code execution in Docker containers
- `tailscale` — VPN sharing, Serve, and Funnel

**Cross-Chain**
- `bridge` — Wormhole/CCTP cross-chain transfers

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
│ Signal        │         │ Skills (61)   │         │ Arbitrage     │
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
| Skills | **61** |
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
