# Clodds User Guide

This guide focuses on day-to-day usage: starting the gateway, pairing users,
chat commands, and common workflows.

## Quick start

**Option 1: npm install**
```bash
echo "@alsk1992:registry=https://npm.pkg.github.com" >> ~/.npmrc
npm install -g @alsk1992/clodds
export ANTHROPIC_API_KEY=sk-ant-...
clodds start
```

**Option 2: From source**
```bash
git clone https://github.com/alsk1992/CloddsBot.git && cd CloddsBot
npm install
cp .env.example .env  # Add ANTHROPIC_API_KEY
npm run dev
```

The gateway listens on `http://127.0.0.1:18789` by default.

## CLI Commands Reference

All `clodds` CLI commands:

### Core Commands

```bash
clodds start                    # Start the gateway
clodds repl                     # Interactive REPL mode
clodds doctor                   # System diagnostics and health checks
clodds status                   # Show gateway status
clodds endpoints                # List all registered endpoints
clodds secure [--dry-run]       # Server security hardening (Linux)
clodds secure audit             # Run security audit only
```

### Pairing Commands

```bash
clodds pairing list <channel>              # List pending pairing requests
clodds pairing approve <channel> <code>    # Approve a pairing request
clodds pairing reject <channel> <code>     # Reject a pairing request
clodds pairing users <channel>             # List paired users
clodds pairing set-owner <channel> <id>    # Set channel owner
clodds pairing remove-owner <channel> <id> # Remove channel owner
clodds pairing owners <channel>            # List channel owners
clodds pairing add <channel> <userId>      # Manually add user
clodds pairing remove <channel> <userId>   # Remove user
```

### Configuration Commands

```bash
clodds config get [key]         # Get config value or show all
clodds config set <key> <value> # Set config value
clodds config unset <key>       # Remove config value
clodds config path              # Show config file path
```

### Model Commands

```bash
clodds model list               # List available models
clodds model default [model]    # Get or set default model
```

### Session Commands

```bash
clodds session list             # List active sessions
clodds session clear [id]       # Clear all or specific session
```

### Cron Commands (Scheduled Tasks)

```bash
clodds cron list                # List scheduled jobs
clodds cron show <id>           # Show job details
clodds cron enable <id>         # Enable a job
clodds cron disable <id>        # Disable a job
clodds cron delete <id>         # Delete a job
```

### User Management Commands

```bash
clodds users list                                    # List all users
clodds users settings <platform> <platformUserId>   # Show user settings
clodds users settings-by-id <userId>                # Show settings by ID
clodds users set-settings <platform> <platformUserId> [options]  # Update settings
clodds users set-settings-by-id <userId> [options]  # Update settings by ID
```

### Memory Commands

```bash
clodds memory list <userId>           # List user's memories
clodds memory search <userId> <query> # Search user's memories
clodds memory clear <userId>          # Clear user's memories
clodds memory export <userId>         # Export user's memories
```

### Hooks Commands

```bash
clodds hooks list               # List all hooks
clodds hooks install <path>     # Install a hook from path
clodds hooks uninstall <name>   # Uninstall a hook
clodds hooks enable <name>      # Enable a hook
clodds hooks disable <name>     # Disable a hook
clodds hooks trace              # Show hook execution trace
clodds hooks state get <name> [key]        # Get hook state
clodds hooks state set <name> <key> <val>  # Set hook state
clodds hooks state clear <name> [key]      # Clear hook state
```

### MCP (Model Context Protocol) Commands

```bash
clodds mcp list                 # List MCP servers
clodds mcp add <name> <command> # Add an MCP server
clodds mcp remove <name>        # Remove an MCP server
clodds mcp test <name>          # Test an MCP server
clodds mcp stats                # Show MCP stats
clodds mcp sync                 # Sync MCP servers
```

### Permissions Commands

```bash
clodds permissions list              # List permission rules
clodds permissions allow <pattern>   # Allow a command pattern
clodds permissions remove <entryId>  # Remove permission rule
clodds permissions mode <mode>       # Set permission mode
clodds permissions ask <mode>        # Set ask mode
clodds permissions pending           # Show pending approvals
clodds permissions approve <reqId>   # Approve pending request
clodds permissions deny <reqId>      # Deny pending request
```

### Usage & Analytics Commands

```bash
clodds usage summary            # Usage summary
clodds usage by-model           # Usage breakdown by model
clodds usage by-user            # Usage breakdown by user
clodds usage export             # Export usage data
clodds usage today              # Today's usage
```

### Credentials Commands

```bash
clodds creds test [platform]    # Test credentials for a platform
```

### Skills Commands

```bash
clodds skills list              # List available skills
clodds skills search <query>    # Search for skills
clodds skills install <slug>    # Install a skill
clodds skills update [slug]     # Update skill(s)
clodds skills uninstall <slug>  # Uninstall a skill
clodds skills info <slug>       # Show skill details
clodds skills check-updates     # Check for skill updates
```

### MCP Server Commands

```bash
clodds mcp                      # Start MCP server (stdio JSON-RPC)
clodds mcp install              # Auto-configure Claude Desktop & Claude Code
clodds mcp uninstall            # Remove Clodds from Claude config
```

Exposes all 110 skills as MCP tools. After `clodds mcp install`, restart Claude Desktop/Code to use Clodds skills directly from Claude.

### QMD (Quantitative Market Data) Commands

```bash
clodds qmd status               # Show QMD status
clodds qmd update               # Update market data
clodds qmd embed                # Generate embeddings
clodds qmd get <target>         # Get market data
clodds qmd multi-get <targets>  # Get multiple markets
clodds qmd collection add <path>           # Add collection
clodds qmd context add <collection> <desc> # Add context
clodds qmd polymarket <query>   # Search Polymarket
clodds qmd kalshi <query>       # Search Kalshi
clodds qmd metaculus <query>    # Search Metaculus
clodds qmd manifold <query>     # Search Manifold
```

### Market Index Commands

```bash
clodds market-index stats       # Show index statistics
clodds market-index sync        # Sync market index
```

### WhatsApp Commands

```bash
clodds whatsapp login           # Login with QR code
```

### Bittensor Commands

```bash
clodds bittensor setup          # Interactive setup wizard (Python, btcli, wallet, config)
clodds bittensor status         # Show mining configuration and status
clodds bittensor check          # Verify all dependencies are installed
clodds bittensor wallet show    # Show wallet address and balance
clodds bittensor wallet create  # Create a new Bittensor wallet
clodds bittensor wallet balance # Check TAO balance
clodds bittensor register <id>  # Register on a subnet (e.g. 64 for Chutes)
```

### Doctor Command

```bash
clodds doctor                   # Comprehensive system health check
clodds doctor --verbose         # Include all optional features and services
```

Checks AI providers, messaging channels, trading platforms, external services, and Bittensor dependencies. Use this to diagnose configuration issues.

### Locale Commands (i18n)

```bash
clodds locale list              # List supported languages
clodds locale get               # Show current locale
clodds locale set <code>        # Set locale (en, zh, es, ja, ko, de, fr, pt, ru, ar)
clodds locale test [key]        # Test a translation key
```

### Trade Ledger Commands

Decision audit trail for AI trading transparency.

```bash
clodds ledger list [userId]         # List recent decisions
clodds ledger list -n 50            # List more decisions
clodds ledger list -c trade         # Filter by category (trade/copy/arbitrage/risk)
clodds ledger list -d rejected      # Filter by decision (approved/rejected/blocked)
clodds ledger stats [userId]        # Show decision statistics
clodds ledger stats -p 30d          # Stats for last 30 days
clodds ledger calibration [userId]  # Show confidence calibration
clodds ledger export [userId]       # Export decisions to JSON
clodds ledger export -f csv         # Export as CSV
clodds ledger prune --days 90       # Delete decisions older than 90 days
clodds ledger verify <id>           # Verify decision hash integrity
clodds ledger config                # Show ledger configuration
```

Enable the ledger:
```bash
clodds config set ledger.enabled true
clodds config set ledger.hashIntegrity true  # Optional: SHA-256 hashing
```

Onchain anchoring (tamper-proof verification):
```bash
clodds ledger anchor <id>                    # Anchor to Solana (default)
clodds ledger anchor <id> -c polygon         # Anchor to Polygon
clodds ledger anchor <id> -c base            # Anchor to Base
clodds ledger verify-anchor <txHash> <hash>  # Verify onchain anchor
```

### Auth Commands

```bash
clodds login                    # Login to Clodds
clodds logout                   # Logout from Clodds
clodds version                  # Show version
```

### Other Commands

```bash
clodds init                     # Initialize config
clodds upgrade                  # Check for updates
```

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

**Virtuals Protocol (AI Agents):**
- `/virt search <query>` - search AI agents
- `/virt agent <id>` - get agent details
- `/virt agents [category]` - list agents with sorting
- `/virt trending [limit]` - top agents by volume
- `/virt new [limit]` - recently launched agents
- `/virt price <token>` - get bonding curve price
- `/virt graduation <token>` - check graduation status

**Betfair Exchange (Sports):**
- `/bf markets <query>` - search sports markets
- `/bf market <id>` - get market details
- `/bf prices <market>` - get market book/odds
- `/bf book <market> <selection>` - view orderbook
- `/bf back <market> <sel> <odds> <stake>` - place back bet
- `/bf lay <market> <sel> <odds> <stake>` - place lay bet
- `/bf orders` - view open orders
- `/bf positions` - view current positions
- `/bf balance` - check account funds

**Smarkets Exchange:**
- `/sm markets <query>` - search markets
- `/sm market <id>` - get market details
- `/sm quotes <market>` - get current quotes
- `/sm book <market> <contract>` - view orderbook
- `/sm buy <market> <contract> <price> <qty>` - place buy order
- `/sm sell <market> <contract> <price> <qty>` - place sell order
- `/sm orders` - view open orders
- `/sm balance` - check account balance

**Metaculus (Forecasting):**
- `/mc search <query>` - search questions
- `/mc question <id>` - get question details and community prediction
- `/mc tournaments` - list tournaments
- `/mc tournament <id>` - get tournament details

**PredictIt (Political Markets):**
- `/pi search <query>` - search markets
- `/pi market <id>` - get market and contract details
- `/pi all` - list all markets

**Portfolio & Risk:**
- `/portfolio` - show positions and P&L
- `/pnl [24h|7d|30m] [limit=50]` - historical P&L snapshots
- `/digest [on|off|HH:MM|show|reset]` - daily digest settings
- `/risk` - risk status, limits, and circuit breaker
- `/risk dashboard` - real-time risk metrics (VaR, regime, HHI)
- `/risk var` - Value-at-Risk and CVaR numbers
- `/risk stress [scenario]` - run stress test
- `/risk regime` - current volatility regime

## Trading credentials

To enable trading tools, store per-user credentials via the agent tools (chat
commands or agent prompts) or the onboarding flow.

Supported platforms:
- Polymarket
- Kalshi
- Manifold
- Betfair
- Smarkets
- Opinion.trade
- Virtuals Protocol (AI agents)
- Hyperliquid (perp DEX)
- Drift Protocol (Solana perps)
- Jupiter (Solana aggregator)
- Raydium (Solana AMM)
- Orca (Solana Whirlpools)
- Meteora (Solana DLMM)
- Pump.fun (Solana launchpad)
- Percolator (On-chain Solana perpetual futures)

These are stored encrypted in the database and loaded at runtime.

### Environment Variables for New Skills

| Skill | Required Env Vars |
|-------|-------------------|
| Copy Trading (Solana) | `SOLANA_PRIVATE_KEY` |
| Signal Trading | `SOLANA_PRIVATE_KEY` |
| AI Strategy | `SOLANA_PRIVATE_KEY` |
| Weather Betting | `POLY_API_KEY`, `POLY_API_SECRET` |
| Pump.fun Swarm | `SOLANA_PRIVATE_KEY`, optionally `SOLANA_SWARM_KEY_1..20` |
| Percolator | `SOLANA_PRIVATE_KEY`, `PERCOLATOR_SLAB`, `PERCOLATOR_ORACLE` |

## Risk management

Use `/risk` to control guardrails:

```
/risk                               Current status + portfolio metrics
/risk status                        Detailed status
/risk limits                        View all configured limits
/risk dashboard                     Full dashboard (VaR, regime, concentration, etc.)
/risk var                           Value-at-Risk / CVaR numbers
/risk regime                        Volatility regime + position size multiplier
/risk stress flash_crash            Run a stress test scenario
/risk set max-loss 1000             Set max daily loss ($)
/risk set max-drawdown 20           Set max drawdown (%)
/risk check 500                     Check if a $500 trade is allowed
/risk trip "reason"                 Manually trip circuit breaker
/risk reset                         Reset circuit breaker
/risk kill                          Emergency stop all trading
```

**Stress test scenarios:** `flash_crash`, `liquidity_crunch`, `platform_down`, `correlation_spike`, `black_swan`

**Volatility regimes:** low (1.2x size), normal (1.0x), high (0.5x), extreme (0.25x or halt)

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

### Whale Tracking (Polymarket)

Monitor large trades on Polymarket:

```
/whale track 0x1234...  # Follow a specific address
/whale top 10           # Top 10 traders by volume
/whale activity trump   # Whale activity for Trump markets
```

### Crypto Whale Tracking (Multi-Chain)

Monitor whale activity across Solana and EVM chains:

```
/crypto-whale start                    # Start tracking all configured chains
/crypto-whale watch solana ABC123...   # Watch a Solana wallet
/crypto-whale watch ethereum 0x1234... # Watch an ETH wallet
/crypto-whale top solana 10            # Top 10 Solana whales
/crypto-whale recent ethereum 20       # Recent 20 ETH whale transactions
/crypto-whale stop                     # Stop tracking
```

**Supported chains:** Solana, Ethereum, Polygon, Arbitrum, Base, Optimism

Configure thresholds in `clodds.json`:

```json
{
  "cryptoWhaleTracking": {
    "enabled": true,
    "chains": ["solana", "ethereum", "polygon"],
    "thresholds": {
      "solana": 10000,
      "ethereum": 50000,
      "polygon": 5000
    },
    "birdeyeApiKey": "...",
    "alchemyApiKey": "..."
  }
}
```

### Copy Trading (Polymarket)

Automatically mirror trades from successful wallets with automatic stop-loss and take-profit:

```
/copy start 0x1234...   # Start copying an address
/copy config size=100   # Set copy size to $100
/copy config sl=10      # Set 10% stop-loss
/copy config tp=20      # Set 20% take-profit
/copy status            # View active positions and SL/TP status
/copy stop              # Stop copy trading
```

**SL/TP Monitoring:**
- Positions are monitored every 5 seconds
- Automatic exit when stop-loss or take-profit triggers
- Notifications sent when positions are closed

### Copy Trading (Solana)

Monitor Solana wallets and automatically copy their trades using Jupiter aggregator:

```
/copy add <wallet> [--mult 1.0] [--max 0.5]   Follow a wallet
/copy add 7xKXtg... --name "whale1"           With friendly name
/copy remove <wallet>                          Stop following
/copy list                                     List followed wallets
/copy pause <wallet>                           Pause copying
/copy resume <wallet>                          Resume copying
/copy history [wallet]                         View trade history
/copy stats                                    View overall stats
/copy config <wallet> --mult 0.5               Update multiplier
```

**Configuration Options:**
- `--mult <number>`: Position size multiplier (0.5 = half, 2.0 = double)
- `--max <sol>`: Maximum SOL per trade (default: 0.5)
- `--min <sol>`: Minimum trade to copy (default: 0.01)
- `--delay <ms>`: Delay before copying (stealth mode)
- `--slippage <bps>`: Slippage tolerance in basis points
- `--buys-only` / `--sells-only`: Filter trade direction

**Features:**
- Real-time monitoring via Solana WebSocket
- Auto-detects trades on Pump.fun, Raydium, Jupiter, Orca, Meteora
- Configurable position sizing with multiplier and max cap
- Trade history and P&L tracking

### Signal Trading

Monitor external signals from RSS feeds, Twitter, and webhooks to trigger automatic trades:

```
/signal add rss <url> --name "news"       Add RSS feed
/signal add twitter whale_alert           Add Twitter/X account
/signal add webhook --name "custom"       Get webhook URL
/signal list                              List all sources
/signal remove <id>                       Remove source
/signal pause <id>                        Pause source
/signal resume <id>                       Resume source
/signal history [source]                  View signal history
/signal filter <id> add keyword "pump" buy   Add filter rule
/signal config <id> --amount 0.1         Set SOL per trade
```

**Signal Sources:**
- **RSS Feeds**: Monitor any RSS/Atom feed (polls every 30s)
- **Twitter/X**: Monitor tweets via Nitter proxy
- **Webhooks**: Receive signals via HTTP POST

**Filters:**
- `keyword`: Match text content → action (buy/sell)
- `sentiment`: Match bullish/bearish
- `regex`: Custom regex patterns
- `mint`: Match specific token address

**Webhook payload:**
```json
{
  "content": "Buy BONK now! 5BqXr...",
  "author": "trader",
  "secret": "your-secret"
}
```

### AI Strategy

Convert natural language descriptions into executable trading strategies:

```
/strategy "buy $100 of SOL if it drops 5%"
/strategy "sell half my BONK when it hits $0.00003"
/strategy "DCA $50 into JUP every hour for 12 hours"
/strategy "set stop loss at 20% for my SOL position"
/strategies                      List active strategies
/strategy status <id>            Check strategy status
/strategy cancel <id>            Cancel strategy
/strategy templates              List templates
/execute buy 0.5 SOL of TOKEN... Execute immediately
```

**Strategy Types:**
- **Price Triggers**: Buy/sell when price crosses threshold
- **DCA**: Dollar cost average over time intervals
- **Take Profit / Stop Loss**: Automatic exit at targets
- **Scale In/Out**: Buy/sell in tranches
- **Ladder Orders**: Multiple orders at different price levels

**Templates:** `dip-buy`, `take-profit`, `dca-daily`, `stop-loss`, `ladder-buy`, `scale-out`

**Monitoring:** Strategies checked every 5 seconds via Jupiter/Birdeye prices.

### Weather Betting

Use NOAA weather forecasts to find edge on Polymarket weather markets:

```
/weather scan                    Scan all weather markets for edge
/weather forecast "New York"     Get NOAA forecast
/weather markets                 List active weather markets
/weather edge <market-id>        Calculate edge for specific market
/weather bet <market-id> 10      Execute $10 bet
/weather auto --threshold 15     Auto-bet when edge >= 15%
/weather history                 View bet history
```

**How It Works:**
1. Fetch NOAA forecast (free, no API key)
2. Match to Polymarket weather markets
3. Compare NOAA probability to market YES price
4. Bet if significant edge exists

**Edge Calculation:**
```
Edge = NOAA Probability - Market Price
Example: NOAA 80% rain, Market 65% → +15% edge → Bet YES
```

**Supported Market Types:** Temperature, precipitation, snow, record highs

**Position Sizing:** Quarter-Kelly criterion, capped at 10% of bankroll.

### Pump.fun Swarm Trading

Coordinate up to 20 wallets for synchronized trades on Pump.fun tokens:

```
/swarm wallets                   List all swarm wallets
/swarm balances                  Refresh SOL balances from chain
/swarm enable <wallet_id>        Enable a wallet
/swarm disable <wallet_id>       Disable a wallet
/swarm buy <mint> 0.1            Buy 0.1 SOL on each wallet
/swarm sell <mint> 100%          Sell all positions
/swarm position <mint>           Show cached positions
/swarm refresh <mint>            Fetch fresh positions
/swarm preset list               List saved presets
/swarm preset save <name>        Save a preset
```

**Execution Modes:**
- `--parallel`: All wallets simultaneously (fastest)
- `--bundle`: Jito bundle, all-or-nothing (≤5 wallets)
- `--multi-bundle`: Multiple Jito bundles (6-20 wallets)
- `--sequential`: Staggered 200-400ms delays (stealth)

**Built-in Presets:** `fast`, `atomic`, `stealth`, `aggressive`, `safe`

**Multi-DEX Support:** Pump.fun (default), Bags.fm (`--dex bags`), Meteora (`--dex meteora`)

**Setup:**
```bash
export SOLANA_PRIVATE_KEY="wallet_0"
export SOLANA_SWARM_KEY_1="wallet_1"
# ... up to SOLANA_SWARM_KEY_20
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

### Solana DEX Trading

Trade on Solana DEXes via unified interface or direct DEX commands:

**Unified Commands:**
```
/sol swap 1 SOL to USDC          Execute swap (uses Jupiter)
/sol quote 100 USDC to JUP       Get quotes from all DEXes
/sol pools BONK                  List all pools
/sol route SOL USDC              Find best route
/sol balance                     Check balance
```

**Jupiter Aggregator:**
```
/jup swap 1 SOL to USDC          Execute swap
/jup quote 100 USDC to JUP       Get quote
/jup route SOL BONK              Show route details
```

**Raydium DEX:**
```
/ray swap 1 SOL to USDC          Execute swap
/ray pools SOL                   List pools
```

**Orca Whirlpools:**
```
/orca swap 1 SOL to USDC         Execute swap
/orca pools SOL                  List Whirlpools
```

**Meteora DLMM:**
```
/met swap 1 SOL to USDC          Execute swap
/met pools SOL                   List DLMM pools
```

**Pump.fun:**
```
/pump buy <mint> 0.1             Buy with 0.1 SOL
/pump sell <mint> 1000           Sell 1000 tokens
```

**Token Security Audit:**
```
/audit <address>                 Auto-detect chain, full security audit
/audit <address> --chain eth     Specify chain (eth, bsc, polygon, arb, base, solana...)
/audit help                      Show usage
```

**DCA (Dollar-Cost Averaging):**
```
/dca poly <token-id> <total-$> --per <$> --every <interval> [--price <p>]     Polymarket DCA
/dca kalshi <ticker> <total-$> --per <$> --every <interval> [--price <p>]     Kalshi DCA
/dca pump <mint> <total-SOL> --per <SOL> --every <interval> [--slippage <bps>] [--pool pump|raydium|auto]  PumpFun DCA
/dca hl <coin> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>]  Hyperliquid DCA
/dca bf <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>] Binance Futures DCA
/dca bb <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>] Bybit DCA
/dca mexc <symbol> <total-$> --per <$> --every <interval> [--side long|short] [--leverage <n>] MEXC Futures DCA
/dca drift <idx> <total-$> --per <$> --every <interval> [--type perp|spot] [--side long|short] Drift DCA
/dca opinion <market-id> <total-$> --per <$> --every <interval> [--price <p>]  Opinion.trade DCA
/dca predict <market-id> <total-$> --per <$> --every <interval> [--price <p>]  Predict.fun DCA
/dca orca <pool> <input-mint> <total> --per <amt> --every <interval> [--slippage <bps>]  Orca DCA
/dca raydium <input> to <output> <total> --per <amt> --every <interval> [--slippage <bps>]  Raydium DCA
/dca virtuals <agent-token> <total-VIRTUAL> --per <VIRTUAL> --every <interval> [--slippage <bps>]  Virtuals DCA (Base)
/dca base <input> to <output> <total> --per <amt> --every <interval> [--slippage <bps>]  Base chain swap DCA
/dca evm <chain> <input> to <output> <total> --per <amt> --every <interval> [--slippage <bps>]  EVM swap DCA (Odos)
/dca sol <total> <from> to <to> --per <amt> --every <secs>   Jupiter DCA (Solana)
/dca list                        List active DCA orders
/dca info <id>                   Show order details and progress
/dca pause <id>                  Pause a running DCA order
/dca resume <id>                 Resume a paused DCA order
/dca cancel <id>                 Cancel a DCA order
```

**Drift Protocol (Perpetuals):**
```
/drift long SOL-PERP 0.5         Open long position
/drift short BTC-PERP 0.01       Open short position
/drift positions                 View open positions
/drift orders                    View open orders
/drift balance                   Check balance
/drift leverage SOL 5            Set 5x leverage
```

**Percolator (On-Chain Solana Perps):**
```
/percolator status               Market state (oracle price, OI, funding, spread)
/percolator positions            Your open positions
/percolator long 100             Open $100 long position
/percolator short 50             Open $50 short position
/percolator deposit 500          Deposit USDC collateral
/percolator withdraw 100         Withdraw USDC collateral
/percolator help                 Show all commands
```
Also available via `/perc` alias.

**Bags.fm (Token Launchpad - Complete):**
```
# Trading
/bags quote 1 SOL to USDC              Get swap quote
/bags swap 0.5 SOL to BONK             Execute swap

# Discovery
/bags pools                            List all pools
/bags trending                         Trending by volume
/bags token <mint>                     Full token info
/bags creators <mint>                  Get creators
/bags lifetime-fees <mint>             Total fees collected

# Fee Claiming
/bags fees [wallet]                    Check claimable fees
/bags claim [wallet]                   Claim all fees
/bags claim-events <mint>              Claim history
/bags stats <mint>                     Per-claimer stats

# Token Launch
/bags launch <name> <symbol> <desc>    Launch new token
/bags fee-config <mint> <wallet:bps>   Set up fee shares

# Wallet Lookup (providers: twitter, github, kick, tiktok, instagram, onlyfans, solana, apple, google, email, moltbook)
/bags wallet twitter <username>        Lookup by social
/bags wallets github user1,user2       Bulk lookup

# Partner System
/bags partner-config <mint>            Create partner key
/bags partner-claim                    Claim partner fees
/bags partner-stats <key>              View partner stats
```

### MEV Protection

MEV protection is automatically enabled for swaps:
- **Ethereum**: Flashbots Protect, MEV Blocker
- **Solana**: Jito bundles
- **L2s**: Sequencer protection (built-in)

### Hyperliquid DEX

Trade perpetual futures on Hyperliquid (69% market share, 130+ markets, up to 50x leverage).

**Setup:**
```bash
export HYPERLIQUID_WALLET="0x..."
export HYPERLIQUID_PRIVATE_KEY="0x..."
```

**Quick Commands:**
```
/hl balance              # Positions & balances
/hl long BTC 0.1         # Open long 0.1 BTC
/hl short ETH 1 3000     # Short 1 ETH at $3000
/hl close BTC            # Close BTC position
/hl closeall             # Close all positions
/hl portfolio            # PnL breakdown
/hl funding BTC          # Funding rates
/hl orders               # Open orders
```

**TWAP & Advanced:**
```
/hl twap buy BTC 1 60    # Buy 1 BTC over 60 minutes
/hl leverage BTC 10      # Set 10x leverage
/hl hlp deposit 1000     # Deposit to HLP vault
/hl transfer spot2perp 500  # Move to perps
```

**Database Tracking:**
All trades are logged to SQLite with full PnL tracking:
```
/hl trades [coin] [limit]     # Trade history
/hl dbstats [coin] [period]   # Win rate, profit factor
/hl dbfunding [coin]          # Funding payments
```

**Shortcuts:** `/hl b` (balance), `/hl l` (long), `/hl s` (short), `/hl p` (price), `/hl f` (funding)

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

## Server Security Hardening

For production Linux deployments, use the built-in security hardening CLI:

```bash
# Preview changes (safe, no modifications)
clodds secure --dry-run

# Apply all hardening
sudo clodds secure

# Run security audit only
clodds secure audit
```

### What gets hardened

| Component | Changes |
|-----------|---------|
| SSH | Disable password auth, root login, limit attempts |
| Firewall | Configure ufw with minimal ports |
| fail2ban | Block brute-force attempts |
| Auto-updates | Enable security patches |
| Kernel | Apply sysctl hardening |

### Important

1. **Always test SSH** in a new terminal before closing your session
2. **Backup SSH keys** before disabling password auth
3. **Check firewall rules** don't block your app ports

See [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) for detailed security documentation.

## Tips

- Keep the gateway on loopback unless you add auth and a reverse proxy.
- Use WebChat for fast local testing before wiring up a messaging platform.
- For production, use Docker or a process manager and enable monitoring.
- Run `clodds secure` on production servers for security hardening.
