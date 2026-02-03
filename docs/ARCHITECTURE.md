# Clodds Architecture

System architecture and design overview for Clodds - the AI trading terminal.

## Table of Contents

- [System Overview](#system-overview)
- [Component Architecture](#component-architecture)
- [Data Flow](#data-flow)
- [Feed Integration](#feed-integration)
- [Extension Points](#extension-points)
- [Database Schema](#database-schema)
- [Security Model](#security-model)

---

## System Overview

Clodds is a modular AI trading terminal built on three core principles:

1. **Multi-Channel Communication**: Connect through any of 22 messaging platforms
2. **Multi-Market Integration**: Access 9+ prediction markets and 5 futures exchanges
3. **AI-First Design**: Claude-powered agent with semantic memory and specialized tools

```
                            CLODDS ARCHITECTURE
    ===============================================================

    +-----------------------------------------------------------------+
    |                          GATEWAY LAYER                          |
    |    HTTP Server (Express) | WebSocket | Rate Limiting | Auth     |
    |    Port: 18789 | Connections: 1000+ | TLS via reverse proxy     |
    +-----------------------------------------------------------------+
                |                    |                    |
        --------+--------    --------+--------    --------+--------
        |               |    |               |    |               |
    +-------+       +-------+            +-------+           +-------+
    |CHANNELS|     | AGENTS |           | FEEDS  |          |TRADING |
    | (22)   |     |  (4)   |           | (15+)  |          |        |
    +-------+       +-------+            +-------+           +-------+
        |               |                    |                   |
    +---+---+       +---+---+            +---+---+           +---+---+
    |Telegram|     | Main  |            |Polymarket|        |Execution|
    |Discord |     |Trading|            |Kalshi   |         |Portfolio|
    |Slack   |     |Research|           |Betfair  |         |Orders   |
    |WhatsApp|     |Alerts |            |Manifold |         |P&L      |
    |Matrix  |      -------             |Crypto   |         |Risk     |
    |Signal  |     |Tools(21)|          |News     |          -------
    |Teams   |     |Skills(103)|         |External |         |Binance |
    |WebChat |     |Memory   |           -------            |Bybit   |
    |+14 more|                          |Arbitrage|         |HL      |
    +--------+                          |Detector |         |MEXC    |
                                        +---------+         +--------+
        |                    |                    |              |
    ----+--------------------+--------------------+--------------+----
                                    |
    +-----------------------------------------------------------------+
    |                         DATA LAYER                              |
    |         SQLite (sql.js) | LanceDB | File System                 |
    |    Users | Sessions | Trades | Markets | Ticks | Memory         |
    +-----------------------------------------------------------------+
```

---

## Component Architecture

### Gateway Layer

The gateway is the entry point for all communication:

```
src/gateway/
├── index.ts          # Gateway factory and orchestration
├── server.ts         # Express HTTP server + WebSocket
└── control-ui.ts     # Admin control panel
```

**Responsibilities:**
- HTTP/WebSocket server management
- Request routing and middleware
- Rate limiting (token bucket algorithm)
- Connection pooling (1000+ concurrent)
- Health monitoring and metrics

**Key Configuration:**
```typescript
interface GatewayConfig {
  port: number;           // Default: 18789
  host: string;           // Default: 127.0.0.1
  maxConnections: number; // Default: 1000
  rateLimit: {
    windowMs: number;     // Rate limit window
    max: number;          // Max requests per window
  };
}
```

### Channel Adapters

Each messaging platform has a dedicated adapter:

```
src/channels/
├── base-adapter.ts    # Abstract base class
├── index.ts           # Channel manager
├── telegram/          # Telegram Bot API
├── discord/           # Discord.js
├── slack/             # Slack Bolt
├── whatsapp/          # Baileys
├── matrix/            # Matrix SDK
├── signal/            # signal-cli wrapper
├── teams/             # Microsoft Bot Framework
├── webchat/           # Built-in browser client
├── line/              # LINE Messaging API
├── googlechat/        # Google Chat API
├── nostr/             # Nostr protocol
├── twitch/            # TMI.js
└── ... (14 more)
```

**Base Adapter Interface:**
```typescript
abstract class BaseAdapter {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract sendMessage(chatId: string, message: Message): Promise<void>;
  abstract editMessage(chatId: string, messageId: string, message: Message): Promise<void>;
  abstract deleteMessage(chatId: string, messageId: string): Promise<void>;

  // Lifecycle hooks
  onMessage(handler: MessageHandler): void;
  onError(handler: ErrorHandler): void;

  // Production features
  protected rateLimit: RateLimiter;
  protected circuitBreaker: CircuitBreaker;
  protected healthCheck: HealthChecker;
}
```

**Production Features:**
| Feature | Description |
|---------|-------------|
| Rate Limiting | Token bucket (30 req/s default) |
| Circuit Breaker | Auto-disable on repeated failures |
| Health Checks | Periodic connectivity checks |
| Auto-Reconnect | Exponential backoff |
| Metrics | Request counts, latency, errors |

### Agent System

The AI agent system provides intelligent responses:

```
src/agents/
├── main-agent.ts      # Primary conversational agent
├── trading-agent.ts   # Trading-focused agent
├── research-agent.ts  # Market research agent
└── alert-agent.ts     # Alert and notification agent
```

**Agent Architecture:**
```
                    +----------------+
                    |   Router       |
                    | (intent-based) |
                    +-------+--------+
                            |
        +-------------------+-------------------+
        |                   |                   |
    +---+---+           +---+---+          +---+---+
    | Main  |           |Trading|          |Research|
    | Agent |           | Agent |          | Agent  |
    +---+---+           +---+---+          +---+---+
        |                   |                   |
        +-------------------+-------------------+
                            |
                    +-------+-------+
                    |    Tools      |
                    | (21 built-in) |
                    +---------------+
```

**Tools (21 Built-in):**
| Tool | Description |
|------|-------------|
| `browser` | Web browsing and scraping |
| `docker` | Container management |
| `exec` | Command execution (sandboxed) |
| `files` | File system operations |
| `git` | Version control |
| `email` | Email sending |
| `sms` | SMS sending |
| `webhooks` | Webhook management |
| `sql` | Database queries |
| `vision` | Image analysis |
| `markets` | Market data lookup |
| `trade` | Trade execution |
| `portfolio` | Portfolio management |
| `arbitrage` | Arbitrage detection |
| `whales` | Whale tracking |
| `copy` | Copy trading |
| `route` | Smart order routing |
| `swap` | DEX swaps |
| `memory` | Semantic memory |
| `calendar` | Calendar events |
| `cron` | Scheduled tasks |

**Skills (103 Bundled):**
Skills extend agent capabilities via a plugin system. They are lazy-loaded via
dynamic `import()` on first use, with each skill isolated in its own try/catch
so a missing dependency (e.g., `viem`, `@solana/web3.js`) only disables that
skill without crashing others.

```typescript
interface SkillHandler {
  name: string;
  description: string;
  commands: string[] | Array<{ name: string; description: string; usage: string }>;
  handle?: (args: string) => Promise<string>;
  handler?: (args: string) => Promise<string>;
  requires?: { env?: string[] };  // Pre-flight env var checks
}
```

The `SKILL_MANIFEST` array in `src/skills/executor.ts` lists all 103 skill
directory names. On first command invocation, `initializeSkills()` loads them
in parallel via `Promise.allSettled`. Use `/skills` to see loaded/failed/needs-config status.

Categories:
- **Trading**: Polymarket, Kalshi, Betfair, Hyperliquid, Binance, Bybit, MEXC, Jupiter, Raydium
- **Analysis**: Arbitrage, edge finding, whale tracking, copy trading
- **Automation**: Cron jobs, triggers, bots, webhooks
- **AI**: Memory, embeddings, multi-agent routing

### Feed System

Market data feeds provide real-time information:

```
src/feeds/
├── index.ts           # Feed manager
├── freshness.ts       # Data freshness tracking
├── polymarket/        # Polymarket CLOB
│   ├── index.ts
│   └── whale-tracker.ts
├── kalshi/            # Kalshi API
├── betfair/           # Betfair Exchange
├── manifold/          # Manifold Markets
├── metaculus/         # Metaculus forecasting
├── predictit/         # PredictIt
├── smarkets/          # Smarkets exchange
├── drift/             # Drift Protocol (Solana)
├── crypto/            # Crypto price feeds
│   └── whale-tracker.ts
├── news/              # RSS/Twitter news
├── external/          # External data sources
├── virtuals/          # Virtuals Protocol
└── opinion/           # Opinion.trade
```

**Feed Interface:**
```typescript
interface Feed {
  name: string;
  platform: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  getMarkets(query?: MarketQuery): Promise<Market[]>;
  getMarket(id: string): Promise<Market>;
  getOrderbook(marketId: string): Promise<Orderbook>;

  subscribe(marketId: string, callback: PriceCallback): void;
  unsubscribe(marketId: string): void;
}
```

### Trading System

The execution layer handles trade management:

```
src/execution/
├── executor.ts        # Order execution engine
├── portfolio.ts       # Position management
├── risk.ts            # Risk controls
├── smart-router.ts    # Cross-platform routing
├── mev-protection.ts  # MEV protection service
└── feature-engine.ts  # Feature engineering
```

```
src/trading/
├── copy-trading.ts    # Copy trading service
├── whale-tracker.ts   # Whale monitoring
└── bots/              # Trading bot strategies
```

**Execution Flow:**
```
User Intent → Agent → Tool → Execution Engine → Platform API
                                    ↓
                            Risk Manager (limits)
                                    ↓
                            Smart Router (best venue)
                                    ↓
                            MEV Protection
                                    ↓
                            Order Placement
                                    ↓
                            Fill Confirmation
                                    ↓
                            Portfolio Update
```

---

## Data Flow

### Message Processing

```
1. MESSAGE RECEIVED
   Channel Adapter receives message from platform

2. AUTHENTICATION
   User validated against pairing/permissions

3. RATE LIMITING
   Request checked against rate limits

4. ROUTING
   Message routed to appropriate agent

5. CONTEXT LOADING
   - Session history from database
   - User preferences
   - Semantic memory search

6. TOOL SELECTION
   Agent determines required tools

7. TOOL EXECUTION
   Tools execute with sandboxing

8. RESPONSE GENERATION
   Agent generates response

9. RESPONSE DELIVERY
   Adapter sends response to platform

10. STATE PERSISTENCE
    - Session updated
    - Memory stored
    - Metrics recorded
```

### Trade Execution

```
1. TRADE REQUEST
   User: "Buy $100 of YES on Trump winning"

2. MARKET RESOLUTION
   - Search market index
   - Find best match
   - Validate market is open

3. PRICE DISCOVERY
   - Fetch orderbook
   - Calculate fill price
   - Check slippage

4. RISK CHECK (via RiskEngine.validateTrade)
   - Kill switch + circuit breaker
   - Position limits + exposure limits
   - Daily loss / drawdown / concentration
   - VaR limit check
   - Volatility regime adjustment
   - Kelly sizing recommendation

5. SMART ROUTING
   - Compare platforms
   - Select best venue
   - Consider maker rebates

6. ORDER CREATION
   - Build order payload
   - Sign transaction
   - MEV protection

7. ORDER SUBMISSION
   - Submit to exchange
   - Monitor for fill
   - Handle errors

8. CONFIRMATION
   - Record in database
   - Update portfolio
   - Notify user

9. MONITORING
   - Track position
   - Check stop-loss
   - Monitor for exit
```

### Arbitrage Detection

```
1. MARKET SCAN
   Poll all platforms for markets

2. SEMANTIC MATCHING
   Match equivalent markets across platforms

3. PRICE COMPARISON
   - Calculate YES + NO prices
   - Calculate cross-platform spreads
   - Consider fees and slippage

4. OPPORTUNITY SCORING
   - Edge calculation
   - Liquidity scoring
   - Confidence ranking

5. FILTERING
   - Minimum edge threshold
   - Minimum liquidity
   - Maximum risk

6. NOTIFICATION/EXECUTION
   - Alert user
   - Or auto-execute (if enabled)
```

---

## Feed Integration

### Adding a New Feed

1. **Create feed directory:**
```
src/feeds/newplatform/
└── index.ts
```

2. **Implement Feed interface:**
```typescript
import { Feed, Market, Orderbook } from '../types';

export class NewPlatformFeed implements Feed {
  name = 'newplatform';
  platform = 'newplatform';

  private ws?: WebSocket;
  private markets: Map<string, Market> = new Map();

  async connect(): Promise<void> {
    // Initialize WebSocket or REST client
    this.ws = new WebSocket('wss://api.newplatform.com');

    // Handle connection
    this.ws.on('open', () => {
      console.log('Connected to NewPlatform');
    });

    // Handle messages
    this.ws.on('message', (data) => {
      this.handleMessage(JSON.parse(data));
    });
  }

  async disconnect(): Promise<void> {
    this.ws?.close();
  }

  async getMarkets(query?: MarketQuery): Promise<Market[]> {
    // Fetch and return markets
  }

  async getMarket(id: string): Promise<Market> {
    // Fetch single market
  }

  async getOrderbook(marketId: string): Promise<Orderbook> {
    // Fetch orderbook
  }

  subscribe(marketId: string, callback: PriceCallback): void {
    // Subscribe to price updates
  }

  unsubscribe(marketId: string): void {
    // Unsubscribe from updates
  }
}
```

3. **Register in feed manager:**
```typescript
// src/feeds/index.ts
import { NewPlatformFeed } from './newplatform';

export function createFeeds(config: Config): Feed[] {
  const feeds: Feed[] = [];

  if (config.feeds.newplatform?.enabled) {
    feeds.push(new NewPlatformFeed(config.feeds.newplatform));
  }

  return feeds;
}
```

### Supported Feed Types

| Type | Protocol | Features |
|------|----------|----------|
| REST | HTTP | Markets, orderbooks, trades |
| WebSocket | WS/WSS | Real-time prices, orderbooks |
| GraphQL | HTTP | Complex queries |
| gRPC | HTTP/2 | High-performance streaming |

---

## Extension Points

### Custom Tools

```typescript
// src/tools/custom/my-tool.ts
import { Tool, ToolContext, ToolResult } from '../types';

export const myTool: Tool = {
  name: 'my_tool',
  description: 'Description for the AI to understand',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'First parameter' },
      param2: { type: 'number', description: 'Second parameter' }
    },
    required: ['param1']
  },

  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { param1, param2 } = ctx.parameters;

    // Tool logic here
    const result = await doSomething(param1, param2);

    return {
      success: true,
      data: result
    };
  }
};
```

### Custom Skills

```typescript
// src/skills/custom/my-skill.ts
import { Skill, SkillContext, SkillResult } from '../types';

export const mySkill: Skill = {
  name: 'my_skill',
  description: 'Custom skill description',
  triggers: ['/mycommand', 'my skill'],

  async execute(ctx: SkillContext): Promise<SkillResult> {
    const { message, user, agent } = ctx;

    // Skill logic
    const response = await processMessage(message);

    return {
      reply: response,
      handled: true
    };
  }
};
```

### Custom Hooks

```typescript
// hooks/my-hook.ts
import { Hook, HookContext } from 'clodds';

export const myHook: Hook = {
  name: 'my_hook',
  description: 'Hook description',

  // Called before message processing
  beforeMessage(ctx: HookContext): void {
    console.log('Before:', ctx.message);
  },

  // Called after message processing
  afterMessage(ctx: HookContext): void {
    console.log('After:', ctx.response);
  },

  // Called on errors
  onError(ctx: HookContext, error: Error): void {
    console.error('Error:', error);
  }
};
```

### Custom Channel Adapter

```typescript
// src/channels/mychannel/index.ts
import { BaseAdapter, Message, MessageHandler } from '../base-adapter';

export class MyChannelAdapter extends BaseAdapter {
  name = 'mychannel';

  async connect(): Promise<void> {
    // Connect to platform
  }

  async disconnect(): Promise<void> {
    // Disconnect
  }

  async sendMessage(chatId: string, message: Message): Promise<void> {
    // Send message to platform
  }

  async editMessage(chatId: string, messageId: string, message: Message): Promise<void> {
    // Edit message on platform
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    // Delete message on platform
  }
}
```

---

## Database Schema

### Core Tables

```sql
-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  username TEXT,
  settings TEXT,  -- JSON
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(platform, platform_user_id)
);

-- Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  messages TEXT,  -- JSON array
  context TEXT,   -- JSON
  created_at INTEGER,
  updated_at INTEGER
);

-- Trades
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  platform TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  size REAL NOT NULL,
  price REAL NOT NULL,
  fees REAL,
  status TEXT,
  order_id TEXT,
  filled_at INTEGER,
  created_at INTEGER
);

-- Positions
CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  platform TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  size REAL NOT NULL,
  entry_price REAL NOT NULL,
  current_price REAL,
  unrealized_pnl REAL,
  created_at INTEGER,
  updated_at INTEGER
);

-- Markets (cache)
CREATE TABLE markets (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  question TEXT,
  description TEXT,
  status TEXT,
  end_date INTEGER,
  volume_24h REAL,
  liquidity REAL,
  last_price REAL,
  synced_at INTEGER,
  UNIQUE(platform, external_id)
);

-- Ticks
CREATE TABLE ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  market_id TEXT NOT NULL,
  outcome_id TEXT,
  price REAL NOT NULL,
  prev_price REAL,
  timestamp INTEGER NOT NULL
);

-- Memories (semantic)
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  content TEXT NOT NULL,
  embedding BLOB,  -- Vector embedding
  metadata TEXT,   -- JSON
  created_at INTEGER
);

-- Ledger (audit trail)
CREATE TABLE ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  category TEXT NOT NULL,
  decision TEXT NOT NULL,
  reasoning TEXT,
  confidence REAL,
  outcome TEXT,
  hash TEXT,        -- SHA-256 integrity hash
  anchor_tx TEXT,   -- Onchain anchor
  created_at INTEGER
);
```

### Indexes

```sql
CREATE INDEX idx_users_platform ON users(platform, platform_user_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_trades_user ON trades(user_id, created_at);
CREATE INDEX idx_positions_user ON positions(user_id);
CREATE INDEX idx_markets_platform ON markets(platform, external_id);
CREATE INDEX idx_ticks_market ON ticks(platform, market_id, timestamp);
CREATE INDEX idx_memories_user ON memories(user_id);
CREATE INDEX idx_ledger_user ON ledger(user_id, created_at);
```

---

## Security Model

### Authentication Layers

```
1. TRANSPORT SECURITY
   - TLS via reverse proxy
   - HSTS headers (optional)

2. CHANNEL AUTHENTICATION
   - Platform-specific tokens
   - OAuth flows where applicable

3. USER PAIRING
   - Approval required for DM access
   - Owner system for approvals

4. WEBHOOK VERIFICATION
   - HMAC-SHA256 signatures
   - Timestamp validation

5. CREDENTIAL STORAGE
   - AES-256-GCM encryption
   - Per-user credential isolation
```

### Sandboxing

```
Tool Execution:
├── Shell commands → Approval required
├── File operations → Restricted paths
├── Network requests → Allowlist
└── Code execution → Isolated containers
```

### Risk Controls

The unified `RiskEngine` (`src/risk/engine.ts`) orchestrates all pre-trade validation through a single `validateTrade()` call:

```typescript
interface RiskDecision {
  approved: boolean;
  adjustedSize?: number;   // Kelly + regime adjusted
  reason?: string;         // Rejection reason
  warnings: string[];      // Non-blocking warnings
  checks: CheckResult[];   // Per-check pass/fail
  regime: VolatilityRegime; // low | normal | high | extreme
}
```

Subsystems:
- **VaR** (`src/risk/var.ts`) — Historical/parametric VaR, CVaR
- **Volatility** (`src/risk/volatility.ts`) — Regime detection with size multipliers
- **Stress** (`src/risk/stress.ts`) — 5 predefined scenarios (flash crash, black swan, etc.)
- **Dashboard** (`src/risk/dashboard.ts`) — Aggregated metrics (HHI, VaR, regime)
- **Circuit breaker** (`src/risk/circuit-breaker.ts`) — Market-condition-aware
- **Safety** (`src/trading/safety.ts`) — Daily loss, drawdown, kill switch (SQLite-backed)
- **Kelly** (`src/trading/kelly.ts`) — Adaptive position sizing

### Audit Trail

Every significant action is logged:
- Trade decisions with reasoning
- Risk limit breaches
- Credential access
- Configuration changes

Ledger entries can be:
- Hash-verified for integrity
- Anchored onchain for immutability
