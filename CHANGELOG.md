# Changelog

All notable changes to Clodds will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.8] - 2026-02-04

### Added

#### Market Making Engine
- Two-sided quoting engine for prediction markets (Polymarket, Kalshi)
- Pure calculation functions: fair value (mid/weighted_mid/vwap/ema), volatility-adjusted spreads, inventory skew
- Strategy adapter integrating with BotManager via existing `Strategy` interface
- Post-only orders via `makerBuy`/`makerSell` (zero taker fees on Polymarket)
- Cancel-then-place requote cycle with configurable interval and price threshold
- Inventory management with asymmetric spread skewing
- Auto-halt on max loss breach
- New `market_making` template in strategy builder
- New `/mm` CLI skill: `start`, `stop`, `status`, `config`, `list` commands

## [0.3.7] - 2026-02-03

### Changed
- All 103 skills now fully wired to real implementations (previously 30 were unwired stubs)
- Updated SKILL_AUDIT.md with current-state summary (replaced outdated category-based audit)
- Updated skill counts in README.md and ARCHITECTURE.md (80/84 -> 103)

## [0.3.6] - 2026-02-02

### Added

#### TimescaleDB Tick Recorder
- Historical tick and orderbook data storage in TimescaleDB
- Batched writes (100 ticks or 1s flush interval) for performance
- Automatic schema initialization with hypertables
- Compression policy (7 days) and retention policy (365 days)
- OHLC aggregation using `time_bucket()` / `date_trunc()`
- REST endpoints: `/api/ticks/:platform/:marketId`, `/api/ohlc/:platform/:marketId`, `/api/orderbook-history/:platform/:marketId`
- Stats endpoint: `/api/tick-recorder/stats`
- New skill: `ticks` with `/ticks` command for querying historical data

#### Real-time WebSocket Tick Streaming
- Push-based streaming at `/api/ticks/stream` WebSocket endpoint
- Subscribe to specific platform/market pairs
- Receive live price ticks and orderbook updates
- Subscription management with per-client limits (100 max)
- Stats endpoint: `/api/tick-streamer/stats`

#### Feature Engineering Pipeline
- Real-time computation of trading indicators from tick/orderbook data
- Tick features: price change, momentum, velocity, volatility, tick intensity
- Orderbook features: spread, imbalance, depth, weighted prices
- Derived signals: buy pressure, sell pressure, trend strength, liquidity score
- Batch computation for historical data analysis
- REST endpoints: `/api/features/:platform/:marketId`, `/api/features`, `/api/features/stats`

#### Feed Improvements
- Orderbook events now emitted from Polymarket feed
- Feed events wired to tick recorder, tick streamer, and feature engineering

### Configuration

New config options in `clodds.config.yaml`:
```yaml
tickRecorder:
  enabled: true
  connectionString: postgres://user:pass@localhost:5432/clodds
  batchSize: 100
  flushIntervalMs: 1000
  retentionDays: 365
  platforms: [polymarket, kalshi]  # optional, defaults to all
```

## [0.3.4] - 2026-02-02

### Added

#### Copy Trading (Solana)
- Real-time Solana wallet monitoring via WebSocket (`connection.onLogs()`)
- Auto-detect trades on 6 DEXes: Pump.fun, Raydium, Jupiter, Orca, Meteora, Bags
- Configurable position sizing with multiplier and max cap
- Trade execution via Jupiter aggregator (best route)
- Trade history and P&L tracking
- Stealth mode with configurable delay
- New skill: `copy-trading-solana` with `/copy` commands

#### Signal Trading
- Monitor RSS feeds, Twitter/X accounts, and webhooks for trading signals
- Auto-detect token mint addresses in signal content
- Filter rules: keyword, sentiment (bullish/bearish), regex
- Trade execution via Jupiter Swap API
- Cooldown support to prevent spam trading
- New skill: `signals` with `/signal` commands

#### Weather Betting
- NOAA weather forecast integration (free, no API key)
- Polymarket weather market discovery via Gamma API
- Edge calculation: NOAA probability vs market YES price
- Quarter-Kelly position sizing (capped at 10% of bankroll)
- Auto-bet mode with configurable edge threshold
- Supported markets: temperature, precipitation, snow, record highs
- New skill: `weather` with `/weather` commands

#### AI Strategy
- Natural language to executable trading strategies
- Strategy types: price triggers, DCA, take-profit, stop-loss, scale in/out, ladder orders
- Built-in templates: `dip-buy`, `take-profit`, `dca-daily`, `stop-loss`, `ladder-buy`, `scale-out`
- Price monitoring every 5 seconds via Jupiter/Birdeye
- Immediate execution mode with `/execute` command
- New skill: `ai-strategy` with `/strategy` commands

#### Pump.fun Swarm Enhancements
- Multi-DEX support: Pump.fun, Bags.fm, Meteora DLMM
- Preset system: save/load trading configurations (`/swarm preset`)
- Built-in presets: `fast`, `atomic`, `stealth`, `aggressive`, `safe`
- Multi-bundle mode for 6-20 wallets (chunks of 5 for Jito)
- Sequential mode with 200-400ms delays (stealth)

### Changed
- Skills count increased from 80 to 84
- Updated README.md and USER_GUIDE.md with new skill documentation

## [0.3.3] - 2026-02-02

### Added

#### SPL Token Escrow
- Full support for SPL token escrow (USDC, USDT, any SPL token)
- Automatic creation of Associated Token Accounts (ATAs) when needed
- Token balance tracking and full balance transfer on release/refund
- Uses `@solana/spl-token` for proper token operations

#### Oracle Conditions
- **Pyth Network** price feed support for on-chain price data
- **HTTP Oracle** support for any REST API price feed
- JSON path extraction for nested API responses (e.g., `data.price`)
- Built-in price feeds: BTC/USD, ETH/USD, SOL/USD, USDC/USD, MATIC/USD
- Comparison operators: gt, lt, gte, lte, eq
- Format: `pyth:BTC/USD:gt:50000` or `http:https://api.example.com:lt:100:data.price`

#### Custom Conditions
- Callback registry for custom escrow release/refund conditions
- `registerCustomCondition()` - register handlers by name
- `unregisterCustomCondition()` - remove handlers
- `listCustomConditions()` - list registered handlers
- Built-in conditions: `always_true`, `always_false`, `time_window`, `min_age`
- Async handlers receive full escrow context

### Improved

- Better error messages for condition checks with debug logging
- Escrow operations now support both native SOL and SPL tokens seamlessly

## [0.3.2] - 2026-02-02

### Security

#### x402 EVM Cryptography Fix
- **Critical fix:** x402 EVM now uses proper Keccak256 (not SHA3-256) via `@noble/hashes`
- **Critical fix:** ecrecover implemented using `@noble/curves/secp256k1` for signature verification
- **Critical fix:** Signing now returns correct recovery bit (v) instead of hardcoded 27
- EVM address derivation simplified using `@noble/curves`
- Signatures now verify correctly on-chain

## [0.3.1] - 2026-02-02

### Security

#### Escrow Keypair Persistence
- **Critical fix:** Escrow keypairs now encrypted and stored in database (AES-256-GCM)
- Previously: Keypairs were only in memory - server restart = lost funds
- Now: Keypairs survive restarts, encrypted with `CLODDS_ESCROW_KEY` or `CLODDS_CREDENTIAL_KEY`
- Added `encrypted_keypair` column to `acp_escrows` table with auto-migration

## [0.3.0] - 2026-02-02

### Added

#### Agent Commerce Protocol (ACP)
Complete agent-to-agent commerce system:
- **Registry** (`src/acp/registry.ts`) - Agent/service registration, reputation tracking
- **Agreements** (`src/acp/agreement.ts`) - Cryptographic proof-of-agreement with Ed25519 signatures
- **Escrow** (`src/acp/escrow.ts`) - On-chain SOL escrow with buyer/seller/arbiter roles
- **Discovery** (`src/acp/discovery.ts`) - AI-scored service matching (relevance, reputation, price, availability)
- **Identity** (`src/acp/identity.ts`) - @handles, takeover bids, referrals (5% fee sharing), profiles, leaderboards
- **Predictions** (`src/acp/predictions.ts`) - Forecast tracking with Brier scores, prediction leaderboard
- **Persistence** (`src/acp/persistence.ts`) - SQLite storage with migrations 13-14
- 39+ new agent tools (`acp_*`)
- Full documentation in `docs/ACP.md`

#### New Handlers
- `src/agents/handlers/acp.ts` - ACP tool handlers
- `src/agents/handlers/arbitrage.ts` - Arbitrage execution handlers
- `src/agents/handlers/credentials.ts` - Credential management
- `src/agents/handlers/markets.ts` - Market data handlers
- `src/agents/handlers/paper-trading.ts` - Paper trading simulation
- `src/agents/handlers/polymarket.ts` - Polymarket-specific handlers
- `src/agents/handlers/wallets.ts` - Wallet management

#### Opportunity Scoring
- Enhanced scoring algorithm in `src/opportunity/scoring.ts`
- Correlation-based patterns in `src/opportunity/correlation.ts`

#### Other
- Futures execution module (`src/execution/futures.ts`)
- Predict.fun feed integration (`src/feeds/predictfun/`)
- Quick start guide (`docs/QUICK_START.md`)

## [0.2.1] - 2026-02-02

### Security

#### Cryptographic ID Generation
- Replaced `Math.random().toString(36)` with `crypto.randomBytes()` across 21 files
- New `src/utils/id.ts` utility with `generateId()`, `generateShortId()`, `generateUuid()`
- Affected: alerts, usage, memory, media, cron, hooks, arbitrage, canvas, embeddings, agents, extensions

#### Sandbox Hardening
- `createSandbox()` now **disabled by default** - requires `ALLOW_UNSAFE_SANDBOX=true`
- Canvas `eval()` now **disabled by default** - requires `CANVAS_ALLOW_JS_EVAL=true`

#### Task Runner Security
- Replaced `spawn(shell: true)` with `execFile()` to prevent shell injection
- Added command validation (blocks shell metacharacters)
- Restricted environment variable passthrough to allowlist

#### XSS Prevention
- Added `escapeHtml()` and `sanitizeStyle()` to canvas component renderers
- All user content now properly escaped before HTML insertion

#### Gateway Hardening
- **IP Rate Limiting**: Sliding window, 100 req/min default (`CLODDS_IP_RATE_LIMIT`)
- **Security Headers**: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection
- **HSTS Support**: `CLODDS_HSTS_ENABLED=true` enables Strict-Transport-Security
- **HTTPS Enforcement**: `CLODDS_FORCE_HTTPS=true` redirects HTTP to HTTPS
- **CORS Fix**: Credentials only allowed with specific origin allowlist (not wildcard)
- **/metrics Auth**: Now requires `CLODDS_TOKEN` if set

#### WebSocket Security
- Added message structure validation (`isValidWebMessage()`)
- Added 1MB message size limit to prevent DoS
- Session IDs now use `crypto.randomBytes(16)`

### Fixed
- Dockerfile: Updated Node 20 → 22, removed nonexistent Python dependencies, added healthcheck
- docker-compose.yml: Added `env_file` and `restart: unless-stopped`

### Added
- New environment variables:
  - `CLODDS_IP_RATE_LIMIT` - requests per minute per IP (default: 100)
  - `CLODDS_FORCE_HTTPS` - redirect HTTP to HTTPS
  - `CLODDS_HSTS_ENABLED` - enable HSTS header
  - `CANVAS_ALLOW_JS_EVAL` - enable canvas JS execution (default: false)
  - `ALLOW_UNSAFE_SANDBOX` - enable unsafe sandbox (default: false)

## [0.2.0] - 2026-01-31

### Added

#### New Trading Platforms
- **Opinion.trade**: Full BNB Chain prediction market integration
  - EIP-712 order signing via `unofficial-opinion-clob-sdk`
  - Place/cancel orders, get positions, balances, trade history
  - Split/merge outcome tokens, redeem settled positions
  - 20+ tool handlers in `src/exchanges/opinion/index.ts`

- **Predict.fun**: Full BNB Chain prediction market integration
  - Wallet signing via `@predictdotfun/sdk`
  - Create orders, cancel orders, get positions
  - Merge/redeem positions with proper index set handling
  - 15+ tool handlers in `src/exchanges/predictfun/index.ts`

#### Drift Protocol Direct SDK
- New SDK-based functions bypassing gateway requirement:
  - `executeDriftDirectOrder` - Place perp/spot orders
  - `cancelDriftOrder` - Cancel by ID, market, or all
  - `getDriftOrders` - Get open orders
  - `getDriftPositions` - Get positions with PnL calculation
  - `getDriftBalance` - Get collateral, margin, health factor
  - `modifyDriftOrder` - Modify existing orders
  - `setDriftLeverage` - Set leverage per market
- New handlers: `drift_direct_*` for SDK-based trading

#### Identity & Payments
- **ERC-8004 Indexer**: Event-based owner→agentId indexer
  - Transfer event scanning with batch processing
  - `getAgentByOwner()` now works via indexer
  - `getAgentsByOwner()` for multi-agent accounts
  - Auto-refreshing cache with TTL

- **X-402 Solana Signing**: Real Ed25519 implementation
  - Replaced HMAC placeholder with `@noble/ed25519`
  - Proper signature verification with `ed25519.verifyAsync()`
  - Correct PDA validation using curve point checking

#### Local AI
- **Transformers.js Embeddings**: Neural embeddings without API keys
  - `@xenova/transformers` integration
  - `Xenova/all-MiniLM-L6-v2` model (384 dimensions)
  - Lazy loading to avoid startup cost
  - Fallback to bag-of-words if model fails

#### Architecture
- **Modular Handlers**: New `src/agents/handlers/` structure
  - `types.ts` - Common handler types and helpers
  - `opinion.ts` - Opinion.trade handlers extracted
  - `index.ts` - Aggregation with `dispatchHandler()`
  - Pattern for incremental platform migration

### Improved

#### Type Safety
- Removed all `as any` casts from `agents/index.ts`
- Added typed interfaces: `KalshiBalanceResponse`, `PolymarketBookResponse`, `PolymarketMarketResponse`
- Added `toEvmChain()` helper for proper type narrowing
- Fixed BigInt literal compatibility issues

### Dependencies
- Added `@noble/ed25519@2.2.0` for Solana signing
- Added `@xenova/transformers@2.17.2` for local embeddings
- Added `unofficial-opinion-clob-sdk` for Opinion.trade
- Using `@predictdotfun/sdk` for Predict.fun

## [0.1.0] - 2026-01-30

### Added

#### Trading Platforms
- **9 Prediction Markets**: Polymarket, Kalshi, Betfair, Smarkets, Drift, Manifold, Metaculus, PredictIt
- **4 Futures Exchanges**: Binance (125x), Bybit (100x), Hyperliquid (50x), MEXC (200x)
- **5 Solana DEXs**: Jupiter, Raydium, Orca, Meteora, Pump.fun
- **5 EVM Chains**: Ethereum, Arbitrum, Optimism, Base, Polygon via Uniswap V3 & 1inch
- **700+ markets** available for trading

#### Messaging Channels (22)
- Telegram, Discord, Slack, WhatsApp, Microsoft Teams
- Matrix, Signal, Google Chat, iMessage (BlueBubbles), LINE
- Mattermost, Nextcloud Talk, Zalo, Nostr, Tlon/Urbit
- Twitch, Voice, WebChat, IRC
- Email (SMTP), SMS (Twilio), Webhooks

#### Smart Trading
- Cross-platform, internal, and combinatorial arbitrage detection
- Multi-chain whale tracking (Solana, ETH, Polygon, ARB, Base, OP)
- Copy trading with configurable sizing and SL/TP
- MEV protection (Flashbots, MEV Blocker, Jito)
- Smart order routing (best price/liquidity/fees)
- Order splitting and TWAP execution

#### Risk Management
- Kelly criterion position sizing (full, half, quarter)
- Circuit breakers with auto-halt
- Stop-loss, take-profit, trailing stops
- Daily loss limits, max drawdown protection
- Position size limits, consecutive loss limits
- Emergency kill switch

#### Strategy & Analytics
- Natural language strategy builder
- Backtesting with Monte Carlo simulation
- Walk-forward analysis
- Performance attribution by edge source
- Time-of-day analysis
- Sharpe ratio, profit factor, win rate tracking

#### AI System
- 6 LLM providers (Anthropic, OpenAI, Google, Groq, Together, Ollama)
- 4 specialized agents (Main, Trading, Research, Alerts)
- 21 AI tools
- Semantic memory with vector embeddings
- Hybrid search (BM25 + semantic)

#### Skills (61)
- Complete skill definitions with chat commands
- TypeScript API references for all skills
- Organized by category: Trading, Data, Analysis, Risk, Automation, AI, Infrastructure

#### Documentation
- 170+ term glossary
- Comprehensive README
- Frontend docs at cloddsbot.com

#### Infrastructure
- MCP server support
- Webhook integrations
- Background job processing
- Sandboxed code execution
- Tailscale VPN sharing
- x402 machine-to-machine payments
- Wormhole cross-chain bridging

### Security
- Encrypted credentials (AES-256-GCM)
- Sandboxed command execution
- Rate limiting per platform
- Audit logging for all trades

---

[0.2.0]: https://github.com/alsk1992/CloddsBot/releases/tag/v0.2.0
[0.1.0]: https://github.com/alsk1992/CloddsBot/releases/tag/v0.1.0
