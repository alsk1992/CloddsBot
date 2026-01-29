# Clodds User Guide

This guide focuses on day-to-day usage: starting the gateway, pairing users,
chat commands, and common workflows.

## Quick start

1. Install dependencies:

```
npm install
```

2. Create `.env` from `.env.example` and add at least:
   - `ANTHROPIC_API_KEY`
   - `TELEGRAM_BOT_TOKEN` (if using Telegram)

3. Start the gateway:

```
npm run dev
# or
clodds start
```

The gateway listens on `http://127.0.0.1:18789` by default.

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

**Portfolio & Risk:**
- `/portfolio` - show positions and P&L
- `/pnl [24h|7d|30m] [limit=50]` - historical P&L snapshots
- `/digest [on|off|HH:MM|show|reset]` - daily digest settings
- `/risk [show|set ...|reset|off]` - risk limits and stop loss

## Trading credentials

To enable trading tools, store per-user credentials via the agent tools (chat
commands or agent prompts) or the onboarding flow.

Supported platforms:
- Polymarket
- Kalshi
- Manifold

These are stored encrypted in the database and loaded at runtime.

## Risk management

Use `/risk` to control guardrails:

```
/risk show
/risk set maxOrderSize=100 maxPositionValue=500 maxTotalExposure=2000 stopLossPct=0.2
/risk reset
/risk off
```

Note: automated stop-loss execution respects `trading.dryRun` in config.

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

## Tips

- Keep the gateway on loopback unless you add auth and a reverse proxy.
- Use WebChat for fast local testing before wiring up a messaging platform.
- For production, use Docker or a process manager and enable monitoring.
