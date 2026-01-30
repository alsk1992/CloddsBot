# Stub Audit TODO (Clodds vs Clawdbot)

This list tracks stubbed or missing functionality that should be implemented
to remove all placeholders and reach Clawdbot parity.

## Explicit placeholders in Clodds

- [x] Image processing used a placeholder implementation (Sharp integration).
- [x] Config save stamped a hard-coded version instead of package version.
- [x] Windows disk space check was not implemented.
- [x] Orderbook support for non-Polymarket feeds (Kalshi implemented; synthetic fallback for others).

## Parity gaps vs Clawdbot (missing modules/features)

### Apps / Nodes / UI
- [x] macOS app + menu bar control plane (`src/macos/index.ts`).
- [x] iOS/Android nodes (camera, screen record, Voice Wake/Talk Mode) (`src/nodes/index.ts`).
- [x] Canvas host/A2UI integration (`src/canvas/index.ts`).
- [x] Full web UI (`src/web/index.ts`) and richer Control UI.

### Channels
- [x] BlueBubbles / Zalo / Zalo Personal extensions (`src/channels/bluebubbles/`, `src/channels/zalo/`).
- [x] Production-grade channel adapters with rate limiting, circuit breaker, health checks (`src/channels/base-adapter.ts`).
- [x] Mattermost adapter (`src/channels/mattermost/`).
- [x] Nextcloud Talk adapter (`src/channels/nextcloud-talk/`).
- [x] Nostr adapter (`src/channels/nostr/`).
- [x] Tlon adapter (`src/channels/tlon/`).
- [x] Twitch adapter (`src/channels/twitch/`).
- [x] Voice-call adapter (`src/channels/voice/`).
- [x] WhatsApp reactions + polls (Baileys actions + agent tools).
- [x] WhatsApp group JID normalization + reply metadata.
- [x] WhatsApp message key fidelity for reactions/edits/deletes (cache + participant support).
- [x] WhatsApp outbound reply/quote support (thread.replyToMessageId).
- [x] WhatsApp multi-account runtime + QR login CLI (selectable default account).
- [x] WhatsApp inbound updates (edit/delete/reaction) -> cache + logs.
- [x] WhatsApp per-account policies (dmPolicy/allowFrom/groups).
- [x] Monitoring alerts support accountId routing.

### Gateway runtime
- [x] Multi-agent routing + per-channel agent bindings (`src/agents/subagents.ts`).
- [x] Presence/typing indicators and advanced streaming/chunking controls (`src/presence/index.ts`).
- [x] Session scopes + queue modes (`src/session/index.ts`).

### Ops / auth
- [x] Onboarding wizard parity + daemon installer (`src/wizard/index.ts`, `src/daemon/index.ts`).
- [x] OAuth model auth profiles + rotation (`src/auth/oauth.ts`).
- [x] Remote gateway exposure (`src/tailscale/index.ts`).

### Tooling
- [x] Canvas + node tools wired to companion apps (`src/canvas/index.ts`, `src/nodes/index.ts`).
- [x] Full browser control parity (`src/browser/index.ts`).

### Extensions / Providers / Observability
- [x] OpenTelemetry diagnostics extension parity (`src/telemetry/index.ts`).
- [x] Copilot proxy auth integration (`src/auth/copilot.ts`).
- [x] Google auth helpers (`src/auth/google.ts`).
- [x] Qwen portal auth integration (`src/auth/qwen.ts`).
- [x] Memory backends (`src/memory/index.ts` + extensions).
- [x] LLM task runner extension (`src/extensions/task-runner/index.ts`).
- [x] Open Prose extension parity (`src/extensions/open-prose/index.ts`).
- [x] Lobster extension parity (`src/extensions/lobster/index.ts`).

---

## ✅ All parity gaps closed!

All stubbed functionality has been implemented. The codebase now has full
feature parity with Clawdbot reference implementation.

### New Documentation
- `docs/AUTHENTICATION.md` - OAuth, Copilot, Google, Qwen auth guides
- `docs/TELEMETRY.md` - OpenTelemetry observability guide
