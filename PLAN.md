# Clodds - Implementation Plan

**Clodds** = Claude + Odds. An open-source AI assistant for prediction markets.

Free for everyone. Built on Clawdbot's architecture, tailored for traders.

---

## Vision

Clawdbot lets you chat with Claude via Telegram/Discord to automate your life.
Clodds does the same, but specifically for prediction market trading.

**Core Value Props:**
1. Real-time market alerts via Telegram/Discord
2. Portfolio tracking across platforms
3. News → market correlation
4. Edge detection (market vs external models)
5. Research assistant (base rates, resolution rules)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLODDS GATEWAY                          │
│                    ws://127.0.0.1:18789                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  CHANNELS   │  │   FEEDS     │  │   SKILLS    │            │
│  ├─────────────┤  ├─────────────┤  ├─────────────┤            │
│  │ Telegram    │  │ Polymarket  │  │ alerts      │            │
│  │ Discord     │  │ Kalshi      │  │ portfolio   │            │
│  │ WebChat     │  │ Manifold    │  │ research    │            │
│  │             │  │ Metaculus   │  │ edge        │            │
│  │             │  │ Drift BET   │  │ news        │            │
│  │             │  │ News/RSS    │  │ markets     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  SESSIONS   │  │    CRON     │  │     DB      │            │
│  ├─────────────┤  ├─────────────┤  ├─────────────┤            │
│  │ Per-user    │  │ Price alerts│  │ SQLite      │            │
│  │ Context     │  │ Digests     │  │ Positions   │            │
│  │ Preferences │  │ Portfolio   │  │ Alerts      │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
clodds/
├── package.json
├── tsconfig.json
├── README.md
├── PLAN.md
├── .env.example
├── .gitignore
│
├── src/
│   ├── index.ts                     # Entry point
│   ├── types.ts                     # All TypeScript types
│   │
│   ├── gateway/                     # WebSocket control plane
│   │   ├── index.ts
│   │   ├── server.ts
│   │   ├── router.ts
│   │   └── config.ts
│   │
│   ├── channels/                    # Messaging integrations
│   │   ├── index.ts
│   │   ├── telegram/
│   │   │   └── index.ts
│   │   └── discord/
│   │       └── index.ts
│   │
│   ├── feeds/                       # Market data feeds
│   │   ├── index.ts
│   │   ├── polymarket/
│   │   │   ├── index.ts
│   │   │   ├── websocket.ts
│   │   │   └── types.ts
│   │   ├── kalshi/
│   │   │   └── index.ts
│   │   ├── manifold/
│   │   │   └── index.ts
│   │   └── news/
│   │       └── index.ts
│   │
│   ├── skills/                      # Agent skills
│   │   ├── loader.ts
│   │   └── bundled/
│   │       ├── alerts/SKILL.md
│   │       ├── portfolio/SKILL.md
│   │       ├── markets/SKILL.md
│   │       └── research/SKILL.md
│   │
│   ├── agents/                      # AI agent loop
│   │   ├── index.ts
│   │   └── loop.ts
│   │
│   ├── db/                          # Database
│   │   ├── index.ts
│   │   └── schema.ts
│   │
│   └── utils/
│       ├── logger.ts
│       └── config.ts
│
└── workspace/                       # Default user workspace
    ├── AGENTS.md
    └── skills/
```

---

## API Integrations

### Polymarket
- **Docs**: https://docs.polymarket.com/
- **WS**: `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- **REST**: `https://clob.polymarket.com/`

### Kalshi
- **Docs**: https://docs.kalshi.com/
- **Base**: `https://api.elections.kalshi.com/trade-api/v2`
- **Auth**: 30-min token refresh

### Manifold
- **Docs**: https://docs.manifold.markets/api
- **REST**: `https://api.manifold.markets/v0/`
- **WS**: `wss://api.manifold.markets/ws`

### Metaculus
- **Docs**: https://www.metaculus.com/api/

### Drift BET (Solana)
- **Docs**: https://docs.drift.trade/prediction-markets/

### PredictIt
- **REST**: `https://www.predictit.org/api/marketdata/all/`

---

## Implementation Phases

### Phase 1: Core
- [x] Project structure
- [ ] Gateway server
- [ ] Config system
- [ ] Logger
- [ ] Database schema

### Phase 2: Channels
- [ ] Telegram (grammY)
- [ ] Discord (discord.js)
- [ ] DM pairing flow

### Phase 3: Feeds
- [ ] Polymarket WebSocket
- [ ] Kalshi API
- [ ] Manifold API
- [ ] News/RSS

### Phase 4: Skills
- [ ] Skill loader
- [ ] markets skill
- [ ] alerts skill
- [ ] portfolio skill
- [ ] research skill

### Phase 5: Agent
- [ ] Claude integration
- [ ] System prompt
- [ ] Tool execution

### Phase 6: Polish
- [ ] CLI commands
- [ ] Installer script
- [ ] Documentation

---

## Config Example

```json5
{
  agents: {
    defaults: {
      model: { primary: "anthropic/claude-sonnet-4" }
    }
  },
  channels: {
    telegram: {
      enabled: true,
      botToken: "${TELEGRAM_BOT_TOKEN}",
      dmPolicy: "pairing"
    }
  },
  feeds: {
    polymarket: { enabled: true },
    kalshi: { enabled: true },
    manifold: { enabled: true }
  }
}
```
