# Clodds vs Clawdbot Implementation Audit

## Summary Score

| Component | Clawdbot | Clodds | Completeness |
|-----------|----------|--------|--------------|
| Pairing System | 100% | ~85% | Good |
| Commands | 100% | ~60% | Partial |
| Sessions | 100% | ~30% | Basic |
| Channels | 100% | ~40% | Basic |
| Message Queue | 100% | 0% | Missing |
| Multi-Agent | 100% | 0% | Missing |
| Memory | 100% | 0% | Missing |
| Tools | 100% | ~50% | Partial |
| Skills | 100% | ~30% | Basic |

**Overall: ~35% complete compared to Clawdbot**

---

## 1. PAIRING SYSTEM

### Clawdbot Features
- 8-char codes, uppercase, no ambiguous chars (0, O, 1, I)
- 1 hour expiry
- Max 3 pending requests per channel
- Persistent storage in `~/.clawdbot/credentials/`
- CLI: `clawdbot pairing list <channel>`, `clawdbot pairing approve <channel> <code>`
- Auto-approval for local connections
- Manual approval for remote tailnet peers
- Trust hierarchy: Owner > AI > Allowlisted > Strangers

### Clodds Implementation ✅
- ✅ 8-char codes with same charset
- ✅ 1 hour expiry
- ✅ Max 3 pending per channel
- ✅ Persistent in SQLite
- ✅ CLI commands: list, approve, reject, users, add, remove
- ❌ NO auto-approval for local connections
- ❌ NO tailnet integration
- ❌ NO trust hierarchy (everyone is equal once paired)

### Missing (15%)
```
- Auto-approve local connections
- Tailnet/remote peer handling
- Trust levels (owner vs allowlisted vs stranger)
- Per-agent pairing (currently global)
```

---

## 2. COMMANDS SYSTEM

### Clawdbot Features
- `/new`, `/reset` - Start fresh session
- `/status` - Agent reachability + context usage
- `/model` - Show/change model (can actually change it)
- `/context list` - Review system prompt contributions
- Configurable: `commands.native: "auto"`, `commands.text: true`, `commands.bash: false`
- Per-channel command overrides
- Skill-based commands

### Clodds Implementation ✅
- ✅ `/new`, `/reset` - Clears history
- ✅ `/status` - Shows session stats
- ⚠️ `/model` - Shows model but CAN'T change it
- ✅ `/context` - Shows recent messages (not system prompt)
- ✅ `/help` - Lists commands
- ❌ NO command configuration
- ❌ NO per-channel overrides
- ❌ NO skill-based commands

### Missing (40%)
```
- Ability to actually change model at runtime
- /context list showing system prompt contributions
- Command configuration (enable/disable per command)
- Per-channel command overrides
- Skill commands integration
- bash command mode
```

---

## 3. SESSION MANAGEMENT

### Clawdbot Features
- **Session Types:**
  - `dmScope: "main"` - All DMs share one session
  - `dmScope: "per-peer"` - Isolate by sender across channels
  - `dmScope: "per-channel-peer"` - Isolate by channel + sender
  - Groups get own keys: `agent:<agentId>:<channel>:group:<id>`

- **Session Lifecycle:**
  - Daily reset at configurable hour (default 4 AM)
  - Idle reset after configurable minutes
  - Manual triggers: `/new`, `/reset`
  - Memory flush before context compaction

- **Storage:** `~/.clawdbot/agents/<agentId>/sessions/`

### Clodds Implementation ✅
- ⚠️ Single scope: `platform:chatId:userId` (essentially per-channel-peer)
- ❌ NO dmScope configuration
- ❌ NO daily reset
- ❌ NO idle reset
- ✅ Manual reset via commands
- ❌ NO memory flush
- ✅ SQLite storage

### Missing (70%)
```
- dmScope configuration (main, per-peer, per-channel-peer)
- Daily reset at configurable hour
- Idle reset after N minutes of inactivity
- Memory flush before compaction
- Per-agent session isolation
- Session transcript encryption
```

---

## 4. CHANNELS

### Clawdbot Features
- **11 Channels:** WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, Google Chat, Mattermost, LINE, Matrix
- **DM Policies:** `pairing` (default), `allowlist`, `open`, `disabled`
- **Group Policies:** Per-guild/group configuration
- **Streaming:** Block streaming with configurable chunking
- **Draft streaming:** For Telegram (partial updates)
- **Message queue:** Debounce, collect, cap
- **Per-channel history limits**
- **Media handling:** Per-channel max MB

### Clodds Implementation ✅
- ✅ 3 Channels: Telegram, Discord, WebChat
- ✅ DM Policies: pairing, allowlist, open, disabled
- ❌ NO group policies (mention required in Discord)
- ❌ NO block streaming
- ❌ NO draft streaming
- ❌ NO message queue
- ❌ NO history limits (hardcoded 20)
- ❌ NO media handling

### Missing (60%)
```
- 8 more channels (WhatsApp, Slack, Signal, etc.)
- Group policy configuration
- Block streaming with chunking
- Draft streaming for Telegram
- Message queue (debounce, collect, cap)
- Per-channel history limits
- Media upload/download handling
- Read receipts (WhatsApp)
- Reaction acknowledgment
```

---

## 5. MESSAGE QUEUE

### Clawdbot Features
```json
{
  "messages": {
    "responsePrefix": "🦞",
    "ackReaction": "👀",
    "queue": {
      "mode": "collect",      // or "debounce"
      "debounceMs": 1000,
      "cap": 20
    }
  }
}
```
- **Debounce mode:** Wait for typing to stop
- **Collect mode:** Batch rapid messages
- **Cap:** Max messages to collect
- **Ack reaction:** Show 👀 when processing

### Clodds Implementation ❌
- NO message queue at all
- Each message processed immediately
- No debouncing
- No batching
- No acknowledgment reaction

### Missing (100%)
```
- Entire queue system
- Debounce mode
- Collect mode
- Configurable timing
- Ack reactions
- Response prefix
```

---

## 6. MULTI-AGENT ROUTING

### Clawdbot Features
- Multiple agents with independent:
  - Workspaces
  - State directories
  - Session stores
  - Tool policies
  - Model configs

- **Routing Precedence:**
  1. Direct peer matches
  2. Guild/team identifiers
  3. Account ID matching
  4. Channel-level defaults
  5. Fallback to primary agent

- **Bindings:**
```json
{
  "bindings": [
    { "agentId": "work", "match": { "channel": "whatsapp", "accountId": "biz" } }
  ]
}
```

### Clodds Implementation ❌
- Single agent only
- No routing
- No bindings
- No per-agent isolation

### Missing (100%)
```
- Agent definition system
- Routing by channel/user/group
- Bindings configuration
- Per-agent workspaces
- Per-agent tool policies
- Agent isolation
```

---

## 7. MEMORY SYSTEM

### Clawdbot Features
- **Daily logs:** `memory/YYYY-MM-DD.md` (append-only)
- **Long-term memory:** `MEMORY.md` (curated facts)
- **Vector search:** Embeddings for semantic retrieval
- **Hybrid retrieval:** Vector + BM25 keyword matching
- **SQLite caching:** For embeddings
- **Auto-flush:** Before context compaction

### Clodds Implementation ❌
- NO memory system
- Only conversation history (last 20 messages)

### Missing (100%)
```
- Daily log files
- Long-term memory curation
- Vector embeddings
- Semantic search
- BM25 keyword matching
- Memory flush before compaction
```

---

## 8. TOOLS

### Clawdbot Features
- **Categories:**
  - Execution: `exec`, `process`, `bash`
  - File System: `read`, `write`, `edit`, `apply_patch`
  - Web: `web_search`, `web_fetch`, `browser`
  - Automation: `cron`, `gateway`, `canvas`
  - Communications: `message` (Discord, Slack, etc.)
  - System: `nodes` for macOS companion

- **Access Control:**
  - Global allow/deny lists
  - Tool groups: `group:fs`, `group:runtime`, `group:sessions`, `group:web`
  - Tool profiles: `minimal`, `coding`, `messaging`, `full`

### Clodds Implementation ⚠️
- ✅ Market search (prediction-market specific)
- ✅ Price lookup
- ✅ Portfolio tracking
- ✅ Alerts
- ✅ Trading execution
- ❌ NO file system tools
- ❌ NO bash/exec
- ❌ NO web search/fetch
- ❌ NO automation tools
- ❌ NO tool access control

### Assessment
Clodds has **different** tools focused on prediction markets. Not comparable 1:1 but missing general-purpose capabilities.

---

## 9. SKILLS

### Clawdbot Features
- `SKILL.md` files with YAML frontmatter
- Gates: Required envs, required binaries
- Loading priority: Workspace > Managed > Bundled
- ClawdHub marketplace

### Clodds Implementation ⚠️
- Has skills structure (from summary)
- Not fully reviewed

---

## 10. PRIORITY FIXES

### Critical (Do First)
1. **Session Scopes** - Add dmScope config (main/per-peer/per-channel-peer)
2. **Message Queue** - Add debounce/collect mode
3. **Daily Reset** - Add scheduled session reset

### High Priority
4. **Block Streaming** - Chunked responses for long outputs
5. **Trust Levels** - Owner vs allowlisted distinction
6. **Model Switching** - Actually allow runtime model change

### Medium Priority
7. **Memory System** - At least daily logs
8. **More Channels** - WhatsApp (Baileys), Slack
9. **Tool Access Control** - Allow/deny lists

### Lower Priority
10. Multi-agent routing
11. Sandbox mode
12. Browser control

---

## Files to Improve

| File | Current LOC | Missing Features |
|------|-------------|------------------|
| `src/sessions/index.ts` | 152 | dmScope, daily reset, idle reset |
| `src/commands/index.ts` | 157 | model change, config, skill commands |
| `src/pairing/index.ts` | 309 | trust levels, auto-approve local |
| `src/gateway/index.ts` | 123 | message queue, streaming |
| `src/channels/telegram/index.ts` | 259 | block streaming, media, queue |
| `src/channels/discord/index.ts` | 202 | guild policies, streaming |

---

## Conclusion

Clodds has a **solid foundation** matching Clawdbot's core architecture patterns, but is missing:

1. **Session flexibility** - Most critical gap
2. **Message queue** - Important for UX
3. **Memory** - Important for long-term usefulness
4. **Multi-agent** - Nice to have, not critical for MVP

The prediction-market specific tools (Polymarket, Kalshi, etc.) are actually **more complete** than Clawdbot's general tools for that domain.

**Recommendation:** Focus on session scopes and message queue before adding more channels.
