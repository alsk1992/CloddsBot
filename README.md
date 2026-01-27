# Clodds 🎲

**Claude + Odds** — Open-source AI assistant for prediction markets.

Chat with Claude via Telegram, Discord, Slack, or any channel to track markets, manage positions, and trade smarter.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

## Features

### Core Capabilities
- **Multi-Channel Support** — Telegram, Discord, Slack, WhatsApp, and more
- **Real-time Alerts** — Price moves, volume spikes, news correlation
- **Portfolio Tracking** — Positions and P&L across all platforms
- **Edge Detection** — Compare market prices to external models (538, FedWatch)
- **Research Assistant** — Base rates, resolution rules, historical data
- **News Monitoring** — Twitter, RSS feeds matched to your markets

### Supported Platforms

| Platform | Data | Trading | Notes |
|----------|------|---------|-------|
| Polymarket | ✅ | ✅ | Highest volume crypto prediction market |
| Kalshi | ✅ | ✅ | US-regulated, event contracts |
| Manifold | ✅ | ✅ | Play money, great for practice |
| Metaculus | ✅ | ✅ | Forecasting community |
| Drift BET | ✅ | 🚧 | Solana-based |
| PredictIt | ✅ | ❌ | Read-only (sunset) |

### Security & Access Control
- **DM Pairing** — Clawdbot-style pairing codes for secure access
- **Rate Limiting** — Per-user request throttling
- **Command Approval** — Allowlist system for shell commands
- **Elevated Permissions** — Role-based access for sensitive operations

## Quick Start

### Prerequisites
- Node.js 20+
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Anthropic API Key (for Claude)

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

# Start the bot
npm start
```

### Using the CLI

```bash
# Start the gateway
clodds start

# Run diagnostics
clodds doctor

# Manage pairing (access control)
clodds pairing list telegram
clodds pairing approve telegram ABC123
clodds pairing set-owner telegram <userId>

# Manage skills
clodds skills list
clodds skills search "trading"
clodds skills install polymarket-trader
```

## Configuration

Config lives at `~/.clodds/clodds.json`:

```json5
{
  // Gateway settings
  "gateway": {
    "port": 3000,
    "auth": { "token": "your-secret-token" }
  },

  // AI Model configuration
  "agents": {
    "defaults": {
      "model": { "primary": "anthropic/claude-sonnet-4" },
      "workspace": "~/.clodds/workspace",
      "rateLimit": {
        "maxRequests": 30,
        "windowMs": 60000
      }
    }
  },

  // Channel configuration
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "dmPolicy": "pairing",  // pairing | allowlist | open | disabled
      "allowFrom": ["your_telegram_id"]
    },
    "discord": {
      "enabled": true,
      "token": "${DISCORD_BOT_TOKEN}",
      "dmPolicy": "pairing"
    }
  },

  // Market data feeds
  "feeds": {
    "polymarket": { "enabled": true },
    "kalshi": { "enabled": true, "email": "", "password": "" },
    "manifold": { "enabled": true }
  }
}
```

## Commands

| Command | Description |
|---------|-------------|
| `/status` | Your positions and P&L |
| `/markets [query]` | Search markets |
| `/price [market]` | Current price and orderbook |
| `/alert [condition]` | Set price alert |
| `/alerts` | List your alerts |
| `/portfolio` | Full portfolio view |
| `/edge` | Find mispriced markets |
| `/news` | Recent relevant news |
| `/model [name]` | Switch AI model |
| `/help` | All commands |

## Example Interactions

**Setting up credentials:**
```
You: /setup polymarket
Bot: Let's set up your Polymarket credentials.
     Please provide your private key (I'll encrypt it):
You: 0x...
Bot: ✅ Credentials saved! You can now trade on Polymarket.
```

**Price Alert:**
```
📉 ALERT: "Trump wins 2028"
Dropped 5.2% in 10 min (47¢ → 42¢)
Volume: $127k (3x normal)

🔗 Polymarket
```

**Edge Detection:**
```
🎯 EDGE FOUND
"Fed cuts rates March"

Market: 23¢
538 Model: 41%
CME FedWatch: 38%

Edge: +12-18%
```

**Research Query:**
```
You: What's the base rate for incumbent presidents losing?
Bot: Based on historical data since 1900:
     - Incumbents win: 66% (10/15)
     - In recession year: 33% (1/3)
     - With approval <45%: 25% (1/4)

     Current context factors to consider...
```

## Architecture

```
clodds/
├── src/
│   ├── index.ts              # Entry point
│   ├── types.ts              # TypeScript types
│   │
│   ├── gateway/              # WebSocket control plane
│   ├── channels/             # Multi-platform adapters
│   │   ├── telegram/         # Grammy-based
│   │   ├── discord/          # Discord.js
│   │   ├── slack/            # Bolt
│   │   └── whatsapp/         # Baileys
│   │
│   ├── agents/               # Claude AI integration
│   │   ├── index.ts          # Agent manager
│   │   └── subagents.ts      # Background tasks
│   │
│   ├── feeds/                # Market data feeds
│   │   ├── polymarket/       # WebSocket + REST
│   │   ├── kalshi/           # REST API
│   │   └── manifold/         # WebSocket + REST
│   │
│   ├── tools/                # AI tool implementations
│   │   ├── exec.ts           # Shell commands (with approval)
│   │   ├── web-search.ts     # Web search
│   │   ├── browser.ts        # Headless browser
│   │   └── image.ts          # Image analysis
│   │
│   ├── skills/               # Pluggable AI skills
│   │   ├── loader.ts         # SKILL.md parser
│   │   └── bundled/          # Built-in skills
│   │
│   ├── hooks/                # Event lifecycle hooks
│   ├── memory/               # Context & memory management
│   ├── mcp/                  # Model Context Protocol
│   ├── permissions/          # Access control
│   ├── security/             # Rate limiting, encryption
│   ├── sessions/             # Per-user state
│   ├── pairing/              # DM access control
│   ├── credentials/          # Encrypted credential storage
│   ├── db/                   # SQLite persistence
│   └── cli/                  # CLI commands
│
├── package.json
└── tsconfig.json
```

## Key Systems

### Hooks System
Register custom hooks for events throughout the agent lifecycle:

```typescript
import { hooks } from './hooks';

// Modify messages before processing
hooks.register('message:before', async (ctx) => {
  console.log('Incoming:', ctx.message?.text);
});

// Intercept tool calls
hooks.register('tool:before_call', async (ctx) => {
  if (ctx.data.toolName === 'exec') {
    // Block dangerous commands
    return { block: true, blockReason: 'Not allowed' };
  }
});

// Get notified when agent completes
hooks.register('agent:end', async (ctx) => {
  console.log('Response:', ctx.data.response);
});
```

### Background Subagents
Run long-running tasks in the background:

```typescript
import { subagents } from './agents/subagents';

const manager = subagents.createManager();

// Start a background task
const run = manager.startBackground({
  id: 'research-task-1',
  sessionId: session.key,
  userId: session.userId,
  task: 'Research the top 10 prediction markets by volume',
  maxTurns: 20,
  autoRetry: true,
});

// Check status
const state = manager.getStatus(run.state.config.id);

// Wait for completion
const result = await manager.waitFor(run.state.config.id);
```

### Context Compaction
Automatic context management to handle long conversations:

```typescript
import { createContextManager } from './memory/context';

const ctx = createContextManager({
  maxTokens: 128000,
  compactThreshold: 0.85,
  minMessagesAfterCompact: 6,
});

// Messages are automatically compacted when approaching limits
ctx.addMessage({ role: 'user', content: '...' });

if (ctx.checkGuard().shouldCompact) {
  await ctx.compact(); // Summarizes old messages
}
```

## Development

```bash
# Development mode (hot reload)
npm run dev

# Type checking
npm run typecheck

# Build for production
npm run build
```

### Adding a New Channel

1. Create adapter in `src/channels/[name]/`
2. Implement the channel interface
3. Register in gateway
4. Add config schema to types

### Adding a New Skill

Create a `SKILL.md` file:

```markdown
# Skill: market-analyzer

## Description
Analyzes prediction market efficiency

## Commands
- /analyze [market] - Deep analysis
- /compare [m1] [m2] - Compare markets

## Tools Required
- web-search
- calculator
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Claude API key | Yes |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | For Telegram |
| `DISCORD_BOT_TOKEN` | Discord bot token | For Discord |
| `SLACK_BOT_TOKEN` | Slack bot token | For Slack |
| `SLACK_APP_TOKEN` | Slack app token | For Slack |
| `DATABASE_URL` | SQLite path | No (defaults to ~/.clodds/clodds.db) |
| `LOG_LEVEL` | Logging level | No (defaults to info) |

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT — Free for everyone, forever.

## Links

- [GitHub Issues](https://github.com/alsk1992/CloddsBot/issues)
- [Anthropic Claude](https://www.anthropic.com/claude)
- [Polymarket](https://polymarket.com)
- [Kalshi](https://kalshi.com)

---

Built with Claude by the prediction market community.
