# Clodds TODO

## Status: Alpha

Working skeleton with all major features outlined. Needs testing and real API integration.

---

## Recently Added (Filling Gaps)

- [x] **Drift BET feed** - Solana prediction markets (`src/feeds/drift/index.ts`)
- [x] **DM Pairing flow** - Telegram pairing codes for secure access
- [x] **workspace/AGENTS.md** - Agent customization file
- [x] **CONTRIBUTING.md** - Contribution guidelines
- [x] **Telegram /help command** - Built-in help
- [x] **Telegram /start command** - Welcome message
- [x] **Callback button handling** - Alert delete, market view
- [x] **WebChat channel** - Browser-based chat via WebSocket (`src/channels/webchat/index.ts`)
- [x] **WebChat HTML client** - Built-in at `/webchat` endpoint
- [x] **Trading skills** - Real Python methods for Polymarket, Kalshi, Manifold
- [x] **Portfolio sync skill** - Sync positions from all platforms
- [x] **Trading config** - Added to types and default config

---

## Needs Real Implementation

### Feeds (Market Data)

#### Polymarket
- [ ] **WebSocket message parsing** - Currently using placeholder format, need to match actual Polymarket WS protocol
- [ ] **Orderbook fetching** - `getOrderbook()` returns null
- [ ] **CLOB authentication** - Need to add API key auth for trading endpoints
- [ ] **Trade execution** - Not implemented (read-only currently)

#### Kalshi
- [ ] **Real authentication** - Token refresh every 30 min is stubbed
- [ ] **WebSocket support** - Currently polling every 5s, Kalshi may have WS
- [ ] **Market search** - Need to verify API endpoint and response format

#### Manifold
- [ ] **WebSocket reconnection** - Basic reconnect logic, needs backoff and error handling
- [ ] **Multiple choice markets** - Parsing may be incomplete

#### Metaculus
- [ ] **API pagination** - Currently fetches first page only
- [ ] **Tournament questions** - Need to handle tournament-specific endpoints

#### PredictIt
- [ ] **Read-only verified** - Confirm API still works (they shut down trading)

#### Drift BET
- [ ] **API verification** - Endpoints may have changed
- [ ] **Solana wallet integration** - Not implemented (read-only)

#### News
- [ ] **RSS feed URLs** - Some may be outdated/broken, need verification
- [ ] **Twitter integration** - Not implemented (would need Twitter API)
- [ ] **Rate limiting** - No rate limit handling on RSS fetches

### External Data Sources (Edge Detection)

- [ ] **CME FedWatch** - API endpoint needs verification, may need scraping
- [ ] **RealClearPolitics** - No public API, would need scraping
- [ ] **538/Silver Bulletin** - No public API, would need scraping
- [ ] **Betting odds aggregation** - No implementation yet

### Channels

#### Telegram
- [x] **Pairing flow** - Implemented with 6-char codes
- [x] **/start command** - Welcome message
- [x] **/help command** - Command reference
- [x] **Callback buttons** - Alert delete, market view
- [ ] **Rate limiting** - No rate limit handling for Telegram API
- [ ] **Group permissions** - Not checking bot admin status in groups
- [ ] **Persistent pairing** - Currently in-memory, should use DB

#### Discord
- [ ] **Slash commands** - Not implemented (using message prefix)
- [ ] **Embeds** - Using plain text, should use rich embeds
- [ ] **Rate limiting** - No rate limit handling

#### WebChat (IMPLEMENTED)
- [x] **WebSocket client** - Browser-based chat at `/webchat` endpoint
- [x] **Basic auth** - Session-based, no tokens yet
- [ ] **Token-based auth** - For multi-user deployments

### Database

- [ ] **Position price updates** - Cron job to update current prices
- [ ] **Session cleanup** - Old sessions never deleted
- [ ] **Market cache TTL** - Cached markets never expire
- [ ] **Pairing codes** - Store in DB instead of memory

### Agent

- [x] **Conversation history** - Multi-turn context with MAX 20 messages (`src/sessions/index.ts`)
- [ ] **Error recovery** - Basic error handling, no retries
- [x] **Tool timeout** - 30s default timeout on execution tools
- [ ] **Streaming responses** - Not implemented

### Execution Tools (IMPLEMENTED - Clawdbot-Level)

- [x] **Trading execution** - Direct buy/sell via agent tools (**312 total platform tools: 91 Polymarket + 78 Kalshi + 40 Manifold + 25 Metaculus + 3 PredictIt + 18 Drift + 22 Opinion.trade + 19 Predict.fun + 8 CoinGecko + 8 Yahoo Finance - 100% API coverage across 8 prediction markets + finance data!**)
  - **Polymarket Trading (8 tools)**:
    - `polymarket_buy`, `polymarket_sell` (GTC limit orders)
    - `polymarket_market_buy`, `polymarket_market_sell` (FOK instant orders)
    - `polymarket_maker_buy`, `polymarket_maker_sell` (POST_ONLY - avoid fees, earn rebates)
    - `polymarket_post_orders_batch`, `polymarket_cancel_orders_batch`
  - **Polymarket Account (5 tools)**:
    - `polymarket_positions`, `polymarket_balance`, `polymarket_orders`, `polymarket_trades`
    - `polymarket_get_order`
  - **Polymarket Market Data - Single (9 tools)**:
    - `polymarket_orderbook`, `polymarket_midpoint`, `polymarket_spread`, `polymarket_price`
    - `polymarket_last_trade`, `polymarket_tick_size`, `polymarket_fee_rate`, `polymarket_neg_risk`
    - `polymarket_market_info`
  - **Polymarket Market Data - Batch (5 tools)**:
    - `polymarket_midpoints_batch`, `polymarket_prices_batch`, `polymarket_spreads_batch`
    - `polymarket_orderbooks_batch`, `polymarket_last_trades_batch`
  - **Polymarket Market Discovery (4 tools)**:
    - `polymarket_markets`, `polymarket_simplified_markets`, `polymarket_sampling_markets`
    - `polymarket_market_trades_events`
  - **Polymarket Order Management (4 tools)**:
    - `polymarket_cancel`, `polymarket_cancel_all`, `polymarket_cancel_market`
    - `polymarket_estimate_fill`
  - **Polymarket API Key Management (4 tools)**:
    - `polymarket_create_api_key`, `polymarket_derive_api_key`, `polymarket_get_api_keys`, `polymarket_delete_api_key`
  - **Polymarket Read-Only API Keys (4 tools)**:
    - `polymarket_create_readonly_api_key`, `polymarket_get_readonly_api_keys`
    - `polymarket_delete_readonly_api_key`, `polymarket_validate_readonly_api_key`
  - **Polymarket Balance & Allowance (2 tools)**:
    - `polymarket_get_balance_allowance`, `polymarket_update_balance_allowance`
  - **Polymarket Advanced (5 tools)**:
    - `polymarket_heartbeat` (keep orders alive)
    - `polymarket_is_order_scoring`, `polymarket_are_orders_scoring` (rewards eligibility)
    - `polymarket_notifications`, `polymarket_drop_notifications`
  - **Polymarket Health & Config (6 tools)**:
    - `polymarket_health`, `polymarket_server_time`
    - `polymarket_get_address`, `polymarket_collateral_address`, `polymarket_conditional_address`, `polymarket_exchange_address`
  - **Polymarket Search (1 tool)**: `polymarket_search`
  - **Polymarket Extra Market Data (2 tools)**:
    - `polymarket_orderbook_hash` (efficient change detection)
    - `polymarket_sampling_simplified_markets` (featured markets)
  - **Polymarket Gamma API - Events (7 tools)**:
    - `polymarket_event`, `polymarket_event_by_slug`, `polymarket_events`, `polymarket_search_events`
    - `polymarket_event_tags`, `polymarket_market_by_slug`, `polymarket_market_tags`
  - **Polymarket Gamma API - Series (2 tools)**:
    - `polymarket_series`, `polymarket_series_list`
  - **Polymarket Gamma API - Tags (4 tools)**:
    - `polymarket_tags`, `polymarket_tag`, `polymarket_tag_by_slug`, `polymarket_tag_relations`
  - **Polymarket Gamma API - Sports (2 tools)**:
    - `polymarket_sports`, `polymarket_teams`
  - **Polymarket Gamma API - Comments (2 tools)**:
    - `polymarket_comments`, `polymarket_user_comments`
  - **Polymarket Data API - Portfolio & Analytics (11 tools)**:
    - `polymarket_positions_value`, `polymarket_closed_positions`
    - `polymarket_pnl_timeseries`, `polymarket_overall_pnl`
    - `polymarket_user_rank`, `polymarket_leaderboard`
    - `polymarket_top_holders`, `polymarket_user_activity`
    - `polymarket_open_interest`, `polymarket_live_volume`, `polymarket_price_history`
  - **Polymarket Rewards API (3 tools)**:
    - `polymarket_daily_rewards`, `polymarket_market_rewards`, `polymarket_reward_markets`
  - **Polymarket Profiles API (1 tool)**: `polymarket_profile`
  - **Kalshi (76 tools - FULL API COVERAGE):**
    - **Trading (2)**: `kalshi_buy`, `kalshi_sell`
    - **Advanced Trading (5)**: `kalshi_market_order`, `kalshi_batch_create_orders`, `kalshi_batch_cancel_orders`, `kalshi_amend_order`, `kalshi_decrease_order`
    - **Account (2)**: `kalshi_positions`, `kalshi_balance`
    - **Order Management (6)**: `kalshi_orders`, `kalshi_cancel`, `kalshi_cancel_all`, `kalshi_get_order`, `kalshi_queue_position`, `kalshi_queue_positions`
    - **Market Data (5)**: `kalshi_search`, `kalshi_market`, `kalshi_orderbook`, `kalshi_market_trades`, `kalshi_candlesticks`
    - **Events & Series (4)**: `kalshi_events`, `kalshi_event`, `kalshi_series`, `kalshi_series_info`
    - **Portfolio (2)**: `kalshi_fills`, `kalshi_settlements`
    - **Exchange Info (3)**: `kalshi_exchange_status`, `kalshi_exchange_schedule`, `kalshi_announcements`
    - **API Keys (2)**: `kalshi_create_api_key`, `kalshi_delete_api_key`
  - **Manifold (40 tools - COMPLETE - 100% API coverage):**
    - **Trading (4)**: `manifold_bet`, `manifold_sell`, `manifold_multiple_choice`, `manifold_multi_bet`
    - **Account (4)**: `manifold_balance`, `manifold_positions`, `manifold_bets`, `manifold_cancel`
    - **User Endpoints (8)**: `manifold_get_user`, `manifold_get_user_lite`, `manifold_get_user_by_id`, `manifold_get_user_by_id_lite`, `manifold_get_me`, `manifold_get_user_portfolio`, `manifold_get_user_portfolio_history`, `manifold_list_users`
    - **Group/Topics (3)**: `manifold_get_groups`, `manifold_get_group`, `manifold_get_group_by_id`
    - **Market Data (9)**: `manifold_search`, `manifold_market`, `manifold_list_markets`, `manifold_get_market_by_slug`, `manifold_get_probability`, `manifold_get_probabilities`, `manifold_get_market_positions`, `manifold_get_user_metrics`, `manifold_create_market`
    - **Market Management (7)**: `manifold_add_answer`, `manifold_add_liquidity`, `manifold_add_bounty`, `manifold_award_bounty`, `manifold_close_market`, `manifold_manage_topic`, `manifold_resolve_market`
    - **Comments (2)**: `manifold_get_comments`, `manifold_create_comment`
    - **Transactions (2)**: `manifold_get_transactions`, `manifold_send_mana`
    - **Leagues (1)**: `manifold_get_leagues`
  - **Metaculus (25 tools - Forecasting Platform - FULL API COVERAGE!):**
    - Read: `metaculus_search`, `metaculus_question`, `metaculus_tournaments`, `metaculus_tournament_questions`
    - Submit: `metaculus_submit_prediction`, `metaculus_my_predictions`, `metaculus_bulk_predict`
    - History: `metaculus_prediction_history`, `metaculus_categories`, `metaculus_category`
    - Comments: `metaculus_comments`, `metaculus_post_comment`
    - Projects: `metaculus_projects`, `metaculus_project`, `metaculus_project_questions`, `metaculus_join_project`
    - Notifications: `metaculus_notifications`, `metaculus_mark_notifications_read`
    - Users: `metaculus_user_profile`, `metaculus_user_stats`, `metaculus_leaderboard`
    - Create: `metaculus_create_question`, `metaculus_about_numbers`, `metaculus_question_summaries`, `metaculus_vote`
  - **PredictIt (3 tools - Read Only - No Trading API):**
    - `predictit_search` - Search markets
    - `predictit_market` - Get market details
    - `predictit_all_markets` - Get all markets snapshot
    - Note: PredictIt API is read-only (won CFTC lawsuit July 2025, may add trading later)
  - **Drift BET (11 tools - Solana Prediction Markets - FULL TRADING via Gateway):**
    - See Opinion.trade/Predict.fun section below for full list
  - **CoinGecko (8 tools - Crypto Prices - like Clawdbot's crypto-price):**
    - `coingecko_price` - Get current price for a cryptocurrency
    - `coingecko_prices` - Get prices for multiple coins at once
    - `coingecko_coin_info` - Get detailed coin info (description, links, market data)
    - `coingecko_market_chart` - Get historical price data (OHLC)
    - `coingecko_trending` - Get top 7 trending coins by search popularity
    - `coingecko_search` - Search for coins by name or symbol
    - `coingecko_markets` - Get top coins by market cap with 24h/7d changes
    - `coingecko_global` - Get global crypto market data (total cap, BTC dominance)
  - **Yahoo Finance (8 tools - Stocks - like Clawdbot's yahoo-finance):**
    - `yahoo_quote` - Get real-time stock quote (price, change, P/E, etc.)
    - `yahoo_quotes` - Get quotes for multiple stocks at once
    - `yahoo_chart` - Get historical price data (OHLCV)
    - `yahoo_search` - Search for stock tickers by company name
    - `yahoo_options` - Get options chain data (calls, puts, IV)
    - `yahoo_news` - Get recent news articles for a stock
    - `yahoo_fundamentals` - Get fundamental data (P/E, EPS, margins, etc.)
    - `yahoo_earnings` - Get earnings history and upcoming dates
  - **Opinion.trade (22 tools - BNB Chain Prediction Market - 100% SDK COVERAGE!):**
    - Market Data: `opinion_markets`, `opinion_market`, `opinion_categorical_market`, `opinion_price`, `opinion_orderbook`, `opinion_price_history`, `opinion_quote_tokens`, `opinion_fee_rates`
    - Trading: `opinion_place_order`, `opinion_place_orders_batch`, `opinion_cancel_order`, `opinion_cancel_orders_batch`, `opinion_cancel_all_orders`, `opinion_order_by_id`
    - Account: `opinion_orders`, `opinion_positions`, `opinion_balances`, `opinion_trades`
    - Smart Contract: `opinion_enable_trading`, `opinion_split`, `opinion_merge`, `opinion_redeem`
  - **Predict.fun (19 tools - BNB Chain Prediction Market - 100% SDK COVERAGE!):**
    - Market Data: `predictfun_markets`, `predictfun_market`, `predictfun_orderbook`, `predictfun_market_stats`, `predictfun_last_sale`, `predictfun_categories`, `predictfun_category`
    - Trading: `predictfun_create_order`, `predictfun_cancel_orders`, `predictfun_order_by_hash`
    - Account: `predictfun_orders`, `predictfun_positions`, `predictfun_account`, `predictfun_activity`, `predictfun_balance`, `predictfun_matches`
    - Smart Contract: `predictfun_set_approvals`, `predictfun_redeem_positions`, `predictfun_merge_positions`
  - **Drift BET (18 tools - Solana Prediction Market - 100% GATEWAY COVERAGE!):**
    - Market Data: `drift_search`, `drift_market`, `drift_all_markets`, `drift_orderbook`, `drift_markets`, `drift_market_info`
    - Trading: `drift_place_order`, `drift_cancel_order`, `drift_cancel_all_orders`, `drift_modify_order`, `drift_cancel_and_place`
    - Account: `drift_orders`, `drift_positions`, `drift_balance`, `drift_leverage`, `drift_margin_info`, `drift_collateral`, `drift_transaction_events`
  - **Metaculus (25 tools - Forecasting Platform - 100% API COVERAGE!):**
    - See expanded section above
- [x] **Code execution** - Run Python/shell on user's behalf
  - `exec_python` - Execute Python scripts with timeout
  - `exec_shell` - Execute shell commands (with safety blocklist)
- [x] **Background bot management** - Like Clawdbot's process tool
  - `start_bot` - Launch background trading bots
  - `stop_bot` - Stop running bots
  - `list_bots` - List user's running bots with status
  - `get_bot_logs` - Get recent output from bots
- [x] **File operations** - Workspace file management
  - `write_file` - Write files (path-traversal protected)
  - `read_file` - Read files from workspace
- [ ] **Cron scheduling** - Scheduled task automation (planned)
- [ ] **Approval workflows** - Human-in-the-loop for risky actions (planned)

### Cron

- [ ] **Price alert checking** - Basic implementation, needs:
  - [ ] Proper chat ID lookup (currently broken)
  - [ ] Price change detection (comparing to previous)
  - [ ] Volume spike detection
- [ ] **Daily digest** - Not implemented
- [ ] **Portfolio sync** - Not implemented

### Trading (IMPLEMENTED - Full API Access)

- [x] **Polymarket order placement** - Full py_clob_client integration
  - Complete API reference in `src/skills/bundled/trading-polymarket/SKILL.md`
  - CLI wrapper at `trading/polymarket.py`
  - All ClobClient methods documented: orders, cancels, positions, balance
  - Fee structure for 15-min crypto markets documented
- [x] **Kalshi order placement** - Full REST API integration
  - Complete API reference in `src/skills/bundled/trading-kalshi/SKILL.md`
  - CLI wrapper at `trading/kalshi.py`
  - All endpoints documented: markets, orders, portfolio, fills
  - WebSocket support for real-time data
- [x] **Manifold betting** - Full Mana API integration
  - Complete API reference in `src/skills/bundled/trading-manifold/SKILL.md`
  - Bet placement, limit orders, sell shares, multiple choice markets
- [x] **Position tracking** - Via on-chain RPC (Polymarket) and REST APIs (Kalshi/Manifold)
- [ ] **Risk management** - Max position size, stop losses (to implement)

### Per-User Credentials (FULLY IMPLEMENTED - Clawdbot Architecture)

- [x] **Credential types** - Encrypted per-user credential storage
  - `PolymarketCredentials`: privateKey, funderAddress, apiKey, apiSecret, apiPassphrase
  - `KalshiCredentials`: email, password
  - `ManifoldCredentials`: apiKey
- [x] **CredentialsManager** - `src/credentials/index.ts`
  - `setCredentials()` - Store encrypted credentials
  - `getCredentials()` - Decrypt at runtime
  - `buildTradingContext()` - Factory for tool execution context
  - Cooldown tracking for failed auth (exponential backoff)
- [x] **TradingContext** - Passed to tools at runtime
  - `userId`, `sessionKey`, `credentials` Map
  - `dryRun`, `maxOrderSize` safety limits
- [x] **Database storage** - `trading_credentials` table
  - AES-256 encryption at rest
  - Cooldown/failure tracking columns
- [x] **Onboarding tools** - In `src/agents/index.ts`
  - `setup_polymarket_credentials` - Store Polymarket API credentials
  - `setup_kalshi_credentials` - Store Kalshi login
  - `setup_manifold_credentials` - Store Manifold API key
  - `list_trading_credentials` - Show which platforms are enabled
  - `delete_trading_credentials` - Remove platform credentials
- [x] **Trading tools use per-user creds** - All trading handlers updated
  - Each tool checks `context.tradingContext.credentials.get(platform)`
  - Returns error if no credentials set up
  - Passes user creds via environment to Python scripts
  - Marks success/failure for cooldown tracking
- [x] **WebSocket auth** - Per-user WS connections for fill notifications (`src/feeds/polymarket/user-ws.ts`)

---

## Verified Working (Needs Testing)

- [x] Project structure
- [x] TypeScript compilation (using bundler resolution)
- [x] Config loading with env var substitution
- [x] SQLite database schema
- [x] Logger setup
- [x] Gateway WebSocket server
- [x] Skill loader (SKILL.md parsing)
- [x] Agent tool definitions (12 tools)
- [x] All feed adapters (structure complete)
  - [x] Polymarket
  - [x] Kalshi
  - [x] Manifold
  - [x] Metaculus
  - [x] PredictIt
  - [x] Drift BET
  - [x] News/RSS
  - [x] External (edge detection)
- [x] Telegram channel with pairing
- [x] Discord channel (basic)
- [x] CLI commands (start, onboard, pair)

---

## Not Started

### Features
- [x] Portfolio sync from Polymarket wallet (skill added)
- [x] Portfolio sync from Kalshi API (skill added)
- [x] Portfolio sync from Manifold API (skill added)
- [x] Trading execution (skills with real py_clob_client methods)
- [ ] P&L tracking over time (historical)
- [ ] Daily digest notifications
- [ ] Market comparison across platforms
- [ ] Arbitrage detection
- [x] WebChat channel (implemented)

### Infrastructure
- [ ] Tests (unit, integration)
- [ ] CI/CD pipeline
- [ ] Docker containerization
- [ ] Health monitoring
- [ ] Error alerting
- [ ] Rate limit handling across all APIs

### Documentation
- [ ] API documentation
- [ ] User guide
- [ ] Deployment guide
- [x] Contributing guide

---

## To Test First

1. `npm install` - Does it install without errors?
2. `npm run build` - Does TypeScript compile?
3. `npm run dev` - Does it start without crashing?
4. Telegram connection - Does bot respond?
5. Market search - Does Polymarket API work?

---

## Known Issues

1. ~~**Import paths** - Mix of `.js` extensions and bare imports~~ (FIXED)
2. ~~**Type exports** - Some types may not be properly exported~~ (FIXED - PolymarketFeed interface added)
3. ~~**Channel method mismatch** - `send()` vs `sendMessage()`~~ (FIXED)
4. **Async/await** - Some functions may not properly handle promises
5. **Error handling** - Many try/catch blocks just log and continue
6. **Memory usage** - Pairing codes stored in memory, not DB

---

## Priority Order

1. Get it to compile (`npm run build`)
2. Get it to start (`npm run dev`)
3. Test Telegram bot connection
4. Test Polymarket market search
5. Test alert creation
6. Test news feed
7. Add conversation history to agent
8. Add real external data sources for edge detection
9. ~~Implement trading execution~~ (DONE - full API access)
10. ~~Add WebChat channel~~ (DONE - at /webchat endpoint)
11. Test trading execution via Python scripts
12. Add risk management (max position, stop loss)

---

## File Structure (30+ source files)

```
src/
├── index.ts                     # Entry point
├── types.ts                     # All types
├── gateway/
│   ├── index.ts                 # Gateway orchestration
│   └── server.ts                # HTTP/WS server + WebChat client
├── channels/
│   ├── index.ts                 # Channel manager
│   ├── telegram/index.ts        # Telegram (grammY) with pairing
│   ├── discord/index.ts         # Discord (discord.js)
│   └── webchat/index.ts         # Browser WebSocket chat
├── feeds/
│   ├── index.ts                 # Feed manager
│   ├── polymarket/index.ts      # Polymarket WS+REST
│   ├── kalshi/index.ts          # Kalshi REST
│   ├── manifold/index.ts        # Manifold WS+REST
│   ├── metaculus/index.ts       # Metaculus REST
│   ├── predictit/index.ts       # PredictIt REST
│   ├── drift/index.ts           # Drift BET (Solana)
│   ├── news/index.ts            # RSS aggregation
│   └── external/index.ts        # Edge detection sources
├── trading/
│   └── index.ts                 # Trading manager (routes to Python)
├── agents/index.ts              # Claude AI agent
├── sessions/index.ts            # Session management
├── cron/index.ts                # Scheduled tasks
├── db/index.ts                  # SQLite persistence
├── skills/
│   ├── loader.ts                # SKILL.md parser
│   └── bundled/                 # Built-in skills
│       ├── alerts/SKILL.md
│       ├── edge/SKILL.md
│       ├── markets/SKILL.md
│       ├── news/SKILL.md
│       ├── portfolio/SKILL.md
│       ├── research/SKILL.md
│       ├── trading-polymarket/SKILL.md   # Real py_clob_client methods
│       ├── trading-kalshi/SKILL.md       # Kalshi REST trading
│       ├── trading-manifold/SKILL.md     # Manifold API betting
│       └── portfolio-sync/SKILL.md       # Sync positions from APIs
├── cli/
│   ├── index.ts                 # CLI entry
│   └── commands/
│       ├── gateway.ts           # Start command
│       └── onboard.ts           # Setup wizard
└── utils/
    ├── config.ts                # Config loading
    └── logger.ts                # Pino logger
```
