# Clodds 🎲

**Claude + Odds** — Open-source AI assistant for prediction markets.

An agentic assistant that lives in your messaging apps, understands prediction markets, and helps you trade smarter. Built on Clawdbot architecture.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

---

## Table of Contents

- [Features](#features)
- [Implementation Status](#implementation-status)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Channels](#channels)
- [Tools](#tools)
- [Skills](#skills)
- [Security](#security)
- [CLI Reference](#cli-reference)
- [Development](#development)

---

## Features

### Core Capabilities

| Feature | Status | Description |
|---------|--------|-------------|
| Multi-Channel Messaging | ✅ | Telegram, Discord, WebChat |
| WhatsApp Integration | ❌ | Baileys-based adapter (stub) |
| Slack Integration | ❌ | Bolt-based adapter (stub) |
| Signal/iMessage/Teams | ❌ | Channel adapters (stubs) |
| Real-time Market Data | ✅ | WebSocket feeds from exchanges |
| Portfolio Tracking | ✅ | Positions and P&L across platforms |
| Price Alerts | ✅ | Cron-based alert monitoring |
| Edge Detection | ✅ | Compare to external models |
| News Monitoring | ✅ | RSS/Twitter market correlation |

### Prediction Market Platforms

| Platform | Data Feed | Trading | Notes |
|----------|-----------|---------|-------|
| Polymarket | ✅ | ✅ | WebSocket + REST, highest volume |
| Kalshi | ✅ | ✅ | REST API, US-regulated |
| Manifold | ✅ | ✅ | WebSocket + REST, play money |
| Metaculus | ✅ | ✅ | Forecasting community |
| Drift BET | ✅ | ❌ | Solana-based (read-only) |
| PredictIt | ✅ | ❌ | Read-only (sunset) |

---

## Implementation Status

### Gateway & Infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| WebSocket + HTTP Gateway | ✅ | Single port multiplexing |
| Authentication (token mode) | ✅ | Gateway-level auth |
| Health Endpoint | ❌ | `/health` not implemented |
| Metrics/Observability | ❌ | Prometheus metrics pending |
| Graceful Shutdown | ❌ | Signal handling pending |
| Control UI | ✅ | Web-based dashboard |

### Agent System

| Component | Status | Notes |
|-----------|--------|-------|
| Claude AI Integration | ✅ | Anthropic SDK |
| Tool Calling Loop | ✅ | Full tool execution |
| Multi-Agent Routing | ❌ | Single agent only |
| Agent Bindings | ❌ | Channel/user routing |
| Per-Agent Identity | ❌ | Name, emoji, theme |
| Per-Agent Workspace | ❌ | Isolated directories |
| Subagent Execution | ✅ | Background tasks |
| Subagent Pause/Resume | ❌ | State management only |
| Thinking Modes | ✅ | None, basic, extended, chain-of-thought |

### Session Management

| Component | Status | Notes |
|-----------|--------|-------|
| Per-User Sessions | ✅ | Basic isolation |
| Session Scopes | ❌ | main, per-peer, per-channel-peer |
| Daily Reset | ❌ | Scheduled session clearing |
| Idle Reset | ❌ | Sliding window timeout |
| Manual Reset (/new, /reset) | ✅ | Command-based |
| Session Persistence | ✅ | SQLite storage |
| Conversation History | ✅ | Multi-turn context |

### Context & Memory

| Component | Status | Notes |
|-----------|--------|-------|
| Token Estimation | ✅ | Approximate counting |
| Context Compaction | ✅ | Auto-summarize when full |
| CLAUDE.md Discovery | ✅ | Project instructions |
| Memory Files (MEMORY.md) | ❌ | Long-term storage |
| Daily Logs | ❌ | Append-only notes |
| Vector Search | ❌ | Semantic retrieval |
| Embedding Cache | ❌ | SQLite storage |
| Memory Flush on Compaction | ❌ | Auto-persist |

### Security & Access Control

| Component | Status | Notes |
|-----------|--------|-------|
| DM Pairing (8-char codes) | ✅ | Clawdbot-style |
| Pairing Expiry (1 hour) | ✅ | Auto-expire |
| Owner System | ✅ | Chat-based approval |
| Allowlist Mode | ✅ | Block unknowns |
| Rate Limiting | ✅ | Per-user throttling |
| Access Control Lists | ✅ | User blocking |
| Command Approval | ✅ | Allowlist for shell |
| Elevated Permissions | ✅ | Role-based |
| Sandbox Mode (Docker) | ❌ | Isolated execution |
| Encrypted Credentials | ✅ | At-rest encryption |

### Tools

| Tool | Status | Notes |
|------|--------|-------|
| exec (shell commands) | ✅ | With approval gating |
| read/write/edit | ❌ | File operations |
| web_search | ✅ | DuckDuckGo/Brave |
| web_fetch | ✅ | URL content extraction |
| browser | ✅ | Puppeteer automation |
| image | ✅ | Vision analysis |
| message | ❌ | Cross-channel sending |
| cron | ✅ | Scheduled tasks |
| canvas | ✅ | Collaborative drawing |
| nodes | ❌ | macOS companion |
| process | ❌ | Background processes |

### Hooks System

| Hook | Status | Notes |
|------|--------|-------|
| message:before | ✅ | Can modify/cancel |
| message:after | ✅ | Post-processing |
| agent:before_start | ✅ | Modify system prompt |
| agent:end | ✅ | Completion notification |
| tool:before_call | ✅ | Can block execution |
| tool:after_call | ✅ | Result notification |
| compaction:before | ✅ | Pre-compaction |
| compaction:after | ✅ | Post-compaction |
| session:start/end | ❌ | Lifecycle events |
| gateway:start/stop | ❌ | Service lifecycle |

### Streaming

| Component | Status | Notes |
|-----------|--------|-------|
| Basic Response Streaming | ✅ | Token-by-token |
| Block Streaming | ❌ | Chunked messages |
| Draft Streaming (Telegram) | ❌ | Live editing |
| Configurable Chunk Size | ❌ | min/max chars |

### Skills System

| Component | Status | Notes |
|-----------|--------|-------|
| SKILL.md Parser | ✅ | Frontmatter + content |
| Bundled Skills | ✅ | 10 market skills |
| Workspace Skills | ❌ | Per-project |
| Managed Skills | ❌ | ~/.clodds/skills |
| Skill Discovery | ✅ | Directory scanning |
| Skill Gates (env/bins) | ✅ | Requirements checking |
| ClawdHub Registry | ❌ | Remote installation |

### CLI Commands

| Command | Status | Notes |
|---------|--------|-------|
| clodds start | ✅ | Start gateway |
| clodds doctor | ✅ | Health checks |
| clodds pairing list | ✅ | Pending requests |
| clodds pairing approve | ✅ | Approve access |
| clodds pairing set-owner | ✅ | Set admin |
| clodds skills list | ✅ | Installed skills |
| clodds skills install | ✅ | Add from registry |
| clodds onboard | ❌ | Interactive setup |
| clodds configure | ❌ | Settings management |
| clodds sessions | ❌ | List sessions |
| clodds agents | ❌ | Agent management |
| clodds logs | ❌ | Tail events |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Anthropic API Key

### Installation

```bash
# Clone the repository
git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Build
npm run build

# Start
npm start
```

### First Run

```bash
# Start the gateway
clodds start

# In another terminal, check status
clodds doctor

# Approve your first DM (get code from Telegram)
clodds pairing list telegram
clodds pairing approve telegram ABC123

# Set yourself as owner (for chat-based approvals)
clodds pairing set-owner telegram <your_telegram_id>
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        GATEWAY                               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │
│  │WebSocket│  │  HTTP   │  │  Auth   │  │   Control UI    │ │
│  │ Server  │  │ Server  │  │ Layer   │  │  (Dashboard)    │ │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘ │
│       └────────────┴────────────┴────────────────┘          │
└─────────────────────────────┬───────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│    CHANNELS     │  │     AGENTS      │  │     FEEDS       │
│  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────┐  │
│  │ Telegram  │  │  │  │  Claude   │  │  │  │Polymarket │  │
│  │ Discord   │  │  │  │  Tools    │  │  │  │  Kalshi   │  │
│  │  Slack    │  │  │  │  Skills   │  │  │  │ Manifold  │  │
│  │ WhatsApp  │  │  │  │ Sessions  │  │  │  │   News    │  │
│  └───────────┘  │  │  └───────────┘  │  │  └───────────┘  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │    DATABASE     │
                    │  ┌───────────┐  │
                    │  │  SQLite   │  │
                    │  │ Sessions  │  │
                    │  │  Alerts   │  │
                    │  │Credentials│  │
                    │  └───────────┘  │
                    └─────────────────┘
```

### Directory Structure

```
clodds/
├── src/
│   ├── index.ts                 # Entry point
│   ├── types.ts                 # TypeScript types
│   │
│   ├── gateway/                 # WebSocket + HTTP server
│   │   ├── index.ts             # Gateway factory
│   │   ├── server.ts            # Express server
│   │   └── control-ui.ts        # Dashboard
│   │
│   ├── agents/                  # AI agent system
│   │   ├── index.ts             # Agent manager (11K+ lines)
│   │   └── subagents.ts         # Background execution
│   │
│   ├── channels/                # Messaging adapters
│   │   ├── telegram/            # Grammy-based ✅
│   │   ├── discord/             # Discord.js ✅
│   │   ├── slack/               # Bolt (stub)
│   │   ├── whatsapp/            # Baileys (stub)
│   │   ├── teams/               # (stub)
│   │   ├── signal/              # (stub)
│   │   ├── matrix/              # (stub)
│   │   └── ...
│   │
│   ├── feeds/                   # Market data
│   │   ├── polymarket/          # WebSocket + REST
│   │   ├── kalshi/              # REST API
│   │   ├── manifold/            # WebSocket
│   │   ├── metaculus/           # REST
│   │   └── news/                # RSS aggregation
│   │
│   ├── tools/                   # AI tool implementations
│   │   ├── exec.ts              # Shell (with approval)
│   │   ├── web-search.ts        # Search engines
│   │   ├── web-fetch.ts         # URL fetching
│   │   ├── browser.ts           # Puppeteer
│   │   └── image.ts             # Vision
│   │
│   ├── skills/                  # Pluggable skills
│   │   ├── loader.ts            # SKILL.md parser
│   │   ├── registry.ts          # ClawdHub client
│   │   └── bundled/             # Built-in skills
│   │
│   ├── hooks/                   # Event lifecycle
│   ├── memory/                  # Context management
│   │   ├── index.ts             # Memory service
│   │   └── context.ts           # Compaction
│   │
│   ├── permissions/             # Access control
│   ├── security/                # Rate limiting, encryption
│   ├── pairing/                 # DM access control
│   ├── credentials/             # Encrypted storage
│   ├── sessions/                # Session management
│   ├── db/                      # SQLite persistence
│   ├── cron/                    # Scheduled tasks
│   └── cli/                     # CLI commands
│
├── workspace/                   # Default workspace
│   ├── AGENTS.md                # Agent instructions
│   └── skills/                  # User skills
│
├── package.json
└── tsconfig.json
```

---

## Configuration

Config file: `~/.clodds/clodds.json`

```json5
{
  // Gateway
  "gateway": {
    "port": 3000,
    "auth": {
      "token": "your-secret-token"  // Required for API access
    }
  },

  // Agent defaults
  "agents": {
    "defaults": {
      "workspace": "~/clodds-workspace",
      "model": {
        "primary": "anthropic/claude-sonnet-4",
        "fallbacks": ["anthropic/claude-haiku-3"]
      },
      "rateLimit": {
        "maxRequests": 30,    // Per user
        "windowMs": 60000     // Per minute
      },
      "timeoutSeconds": 600,  // 10 minute max
      "contextTokens": 128000
    }
  },

  // Channels
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "dmPolicy": "pairing",        // pairing | allowlist | open | disabled
      "allowFrom": ["tg:123456789"],
      "groups": {
        "*": { "requireMention": true }
      }
    },
    "discord": {
      "enabled": true,
      "token": "${DISCORD_BOT_TOKEN}",
      "dmPolicy": "pairing"
    }
  },

  // Market feeds
  "feeds": {
    "polymarket": { "enabled": true },
    "kalshi": {
      "enabled": true,
      "email": "${KALSHI_EMAIL}",
      "password": "${KALSHI_PASSWORD}"
    },
    "manifold": { "enabled": true }
  },

  // Sessions
  "session": {
    "scope": "per-sender",          // How to isolate sessions
    "resetTriggers": ["/new", "/reset"]
  },

  // Tools
  "tools": {
    "profile": "coding",            // minimal | coding | messaging | full
    "allow": ["read", "write", "exec"],
    "deny": ["process"]
  }
}
```

---

## Channels

### Telegram (✅ Implemented)

```json5
{
  "telegram": {
    "enabled": true,
    "botToken": "123456:ABC-DEF...",
    "dmPolicy": "pairing",
    "allowFrom": ["tg:123456789"],
    "groups": {
      "*": {
        "enabled": true,
        "requireMention": true
      },
      "123456789": {
        "enabled": true,
        "requireMention": false  // No @ needed
      }
    },
    "historyLimit": 50,
    "mediaMaxMb": 5
  }
}
```

### Discord (✅ Implemented)

```json5
{
  "discord": {
    "enabled": true,
    "token": "your-bot-token",
    "dmPolicy": "pairing",
    "guilds": {
      "123456789": {
        "requireMention": false,
        "channels": {
          "general": { "allow": true },
          "random": { "allow": false }
        }
      }
    }
  }
}
```

### WhatsApp (❌ Stub Only)

```json5
{
  "whatsapp": {
    "enabled": true,
    "authDir": "~/.clodds/whatsapp-auth",
    "dmPolicy": "pairing",
    "allowFrom": ["+15555550123"],
    "sendReadReceipts": true,
    "requireMentionInGroups": true
  }
}
```

### Slack (❌ Stub Only)

```json5
{
  "slack": {
    "enabled": true,
    "botToken": "xoxb-...",
    "appToken": "xapp-...",
    "dmPolicy": "pairing"
  }
}
```

---

## Tools

### Execution (exec)

```typescript
// With approval gating - commands checked against allowlist
const result = await exec.run('npm install', {
  cwd: '/path/to/project',
  timeout: 30000,
  agentId: 'main',
  sessionId: session.key,
});
```

**Approval Flow:**
1. Command parsed and checked against allowlist
2. Safe binaries (ls, cat, git) auto-approved
3. Unknown commands require manual approval
4. Elevated commands require role-based permission

### Web Search

```typescript
const results = await webSearch.search('polymarket trump odds', {
  engine: 'duckduckgo',  // or 'brave'
  maxResults: 10,
});
```

### Browser Automation

```typescript
const browser = await createBrowser();
await browser.navigate('https://polymarket.com');
const screenshot = await browser.screenshot();
const content = await browser.extractContent();
```

---

## Skills

Skills are defined with `SKILL.md` files:

```markdown
---
name: polymarket-trader
description: "Trade on Polymarket via natural language"
emoji: "📈"
gates:
  envs:
    - POLYMARKET_PRIVATE_KEY
  bins:
    - node
---

# Polymarket Trader

Execute trades on Polymarket using natural language commands.

## Commands

- `buy [amount] [market] at [price]` - Place buy order
- `sell [amount] [market] at [price]` - Place sell order
- `positions` - Show current positions
- `orders` - Show open orders

## Examples

"Buy $100 of Trump wins at 45 cents"
"Sell all my Fed rate cut positions"
"What are my current positions?"
```

### Bundled Skills

| Skill | Description |
|-------|-------------|
| `markets` | Search and browse markets |
| `portfolio` | Track positions and P&L |
| `alerts` | Price and volume alerts |
| `edge` | Compare to external models |
| `news` | Market-relevant news |
| `research` | Base rates and historical data |
| `trading-polymarket` | Polymarket execution |
| `trading-kalshi` | Kalshi execution |
| `trading-manifold` | Manifold execution |
| `portfolio-sync` | Cross-platform sync |

---

## Security

### DM Pairing System

Strangers must request access via pairing code:

```
Stranger: hi
Bot: 👋 To chat with me, get approval from the owner.
     Your pairing code: ABC12345
     (Expires in 1 hour)
```

Owner approves via CLI or chat:
```bash
clodds pairing approve telegram ABC12345
```

Or via chat (if owner):
```
Owner: /approve ABC12345
Bot: ✅ Approved! They can now chat with me.
```

### Rate Limiting

- Default: 30 requests per minute per user
- Configurable in `agents.defaults.rateLimit`
- Automatic cleanup of expired entries

### Command Approval

Shell commands are checked against allowlist:

```typescript
// Auto-approved (safe)
const safe = ['ls', 'cat', 'git status', 'npm list'];

// Requires approval
const dangerous = ['rm -rf', 'curl | bash', 'sudo'];

// Blocked
const blocked = ['rm -rf /', 'mkfs', 'dd if='];
```

---

## CLI Reference

### Gateway Management

```bash
# Start the gateway
clodds start

# Run health checks
clodds doctor

# Show status
clodds status
```

### Pairing Management

```bash
# List pending requests
clodds pairing list telegram
clodds pairing list discord

# Approve a request
clodds pairing approve telegram ABC123

# Reject a request
clodds pairing reject telegram ABC123

# List paired users
clodds pairing users telegram

# Set an owner (can approve via chat)
clodds pairing set-owner telegram 123456789 -u "username"

# Remove owner status
clodds pairing remove-owner telegram 123456789

# Manually add a user
clodds pairing add telegram 123456789 -u "username"

# Remove a user
clodds pairing remove telegram 123456789
```

### Skills Management

```bash
# List installed skills
clodds skills list

# Search registry
clodds skills search "trading" -t "polymarket,kalshi"

# Install from registry
clodds skills install polymarket-trader

# Update skills
clodds skills update
clodds skills update polymarket-trader

# Show skill details
clodds skills info polymarket-trader

# Check for updates
clodds skills check-updates

# Uninstall
clodds skills uninstall polymarket-trader
```

---

## Development

### Setup

```bash
# Clone
git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot

# Install
npm install

# Development mode (hot reload)
npm run dev

# Type checking
npm run typecheck

# Build
npm run build
```

### Adding a Channel

1. Create `src/channels/[name]/index.ts`
2. Implement the channel interface:

```typescript
export interface Channel {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutgoingMessage): Promise<void>;
}
```

3. Register in `src/channels/index.ts`
4. Add config schema to `src/types.ts`

### Adding a Tool

1. Create `src/tools/[name].ts`
2. Define the tool schema and handler:

```typescript
export const myTool = {
  name: 'my_tool',
  description: 'Does something useful',
  input_schema: {
    type: 'object',
    properties: {
      param: { type: 'string', description: 'A parameter' }
    },
    required: ['param']
  }
};

export async function executeTool(params: { param: string }) {
  // Implementation
  return { result: 'success' };
}
```

3. Register in `src/agents/index.ts` buildTools()

### Adding a Skill

1. Create `src/skills/bundled/[name]/SKILL.md`
2. Follow the SKILL.md format with frontmatter
3. Skill is auto-discovered on startup

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Bot token from BotFather |
| `DISCORD_BOT_TOKEN` | For Discord | Bot token from Discord |
| `SLACK_BOT_TOKEN` | For Slack | Slack bot token |
| `SLACK_APP_TOKEN` | For Slack | Slack app token |
| `POLYMARKET_PRIVATE_KEY` | For trading | Ethereum private key |
| `KALSHI_EMAIL` | For Kalshi | Kalshi login email |
| `KALSHI_PASSWORD` | For Kalshi | Kalshi login password |
| `DATABASE_URL` | No | SQLite path (default: ~/.clodds/clodds.db) |
| `LOG_LEVEL` | No | debug, info, warn, error |

---

## Roadmap

### In Progress
- [ ] WhatsApp channel (Baileys integration)
- [ ] Slack channel (Bolt integration)
- [ ] Multi-agent routing
- [ ] Memory system with vector search

### Planned
- [ ] Signal channel
- [ ] iMessage channel (macOS only)
- [ ] Docker sandbox mode
- [ ] Block streaming
- [ ] Session scopes (per-peer, main)
- [ ] Daily/idle session reset
- [ ] ClawdHub skill registry

---

## License

MIT — Free for everyone, forever.

---

## Links

- [GitHub](https://github.com/alsk1992/CloddsBot)
- [Issues](https://github.com/alsk1992/CloddsBot/issues)
- [Anthropic Claude](https://www.anthropic.com/claude)
- [Polymarket](https://polymarket.com)
- [Kalshi](https://kalshi.com)

---

*Built with Claude. Inspired by [Clawdbot](https://clawd.bot).*
