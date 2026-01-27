# Clawdbot Architecture Reference

> This document contains the complete Clawdbot architecture for reference during Clodds development.
> Source: https://docs.clawd.bot/

---

## 1. HIGH-LEVEL ARCHITECTURE

### Gateway (Central Hub)
- Multiplexes WebSocket + HTTP on single port (default 18789)
- Handles authentication, session routing, and tool execution
- Can supervise browser control servers and macOS nodes
- Supports multiple agents with per-agent configurations
- Maintains provider connections (WhatsApp, Telegram, etc.)
- Exposes typed WebSocket API for clients

### Agents (AI Executors)
- Route messages based on channel/sender
- Execute tools within optional sandboxes
- Maintain isolated session transcripts on disk
- Support per-agent access profiles and tool policies
- Each agent has: Workspace, State directory, Session store

### Channels (Messaging Surfaces)
- WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Microsoft Teams, Google Chat, Mattermost, LINE, Matrix
- Each implements DM and group policies independently
- Support pairing-based allowlists for inbound access

### Tools & Sandboxes
- Elevated tools run shell commands on paired macOS nodes
- Docker sandbox isolates tool execution from host filesystem
- Workspace access controlled per-agent (read-only, read-write, or none)

---

## 2. MESSAGE FLOW

```
Strangers → DM/Group Policy → Allowlist/Pairing → Routed Message
                                                        ↓
                                        Agent Selection (multi-agent routing)
                                                        ↓
                                    Session Isolation (per-peer or shared)
                                                        ↓
                         Tool Execution (host or sandboxed)
                                                        ↓
                              Session Transcript (encrypted at rest)
```

---

## 3. AUTHENTICATION & SECURITY

### Layered Identity Verification

**Gateway level:** Requires authentication by default with fail-closed semantics when no credentials exist (token or password modes)

**Channel level (DMs):** Four-tier policy:
- `pairing` (default): generates 1-hour codes for unknowns
- `allowlist`: block unknowns
- `open`: requires explicit `"*"` entry
- `disabled`

**Device pairing:** Local connections auto-approve; remote tailnet peers require manual approval

**Trust hierarchy:** Owner > AI > Allowlisted contacts > Strangers

### Pairing System

**DM Pairing (Chat Access):**
- 8 characters, uppercase, excludes ambiguous letters (0, O, 1, I)
- Expire after 1 hour
- Maximum 3 pending requests per channel; extras are ignored

**Commands:**
```bash
clawdbot pairing list telegram
clawdbot pairing approve telegram <CODE>
```

**Storage:** `~/.clawdbot/credentials/` for DM pairing

---

## 4. AGENT LOOP

The full agent run: intake → context assembly → model inference → tool execution → streaming replies → persistence

### Workflow Steps
1. **Entry & Validation**: `agent` RPC accepts parameters, returns `runId` immediately
2. **Execution**: `agentCommand` loads skills and invokes the pi-agent-core runtime
3. **Event Bridging**: Pi-agent-core events converted to Clawdbot streams (tool, assistant, lifecycle)
4. **Completion**: `agent.wait` polls for lifecycle end/error events, returns final status

### Concurrency
- Runs serialize per-session to prevent race conditions
- Write locks acquired for session state management

### Extension Points
- **Internal hooks**: Bootstrap and command event interception
- **Plugin hooks**: `before_agent_start`, `after_tool_call`, `tool_result_persist`

### Timeouts
- Default 30s for wait operations
- Default 600s for agent runtime

---

## 5. SESSION MANAGEMENT

### Session Types

**Direct Messages** follow `dmScope` settings:
- `main` (default): all DMs share the main session for continuity
- `per-peer`: isolates by sender across channels
- `per-channel-peer`: isolates by channel + sender

**Group Chats:** Get their own keys: `agent:<agentId>:<channel>:group:<id>`

### Session Lifecycle

Reset triggers:
- **Daily reset**: defaults to 4 AM on gateway host
- **Idle reset**: optional sliding window
- **Manual triggers**: `/new` or `/reset` commands

### Storage
Sessions live at `~/.clawdbot/agents/<agentId>/sessions/`

### Commands
- `clawdbot sessions --json` — list all sessions
- `/status` — check agent reachability and context usage
- `/context list` — review system prompt contributions

---

## 6. MULTI-AGENT ROUTING

### What Defines an Agent
- Workspace (files, AGENTS.md/SOUL.md/USER.md, local notes, persona rules)
- State directory (agentDir) for auth profiles, model registry, per-agent config
- Session store (chat history + routing state)

### Storage Structure
- Config: `~/.clawdbot/clawdbot.json`
- Agent state: `~/.clawdbot/agents/<agentId>/agent`
- Sessions: `~/.clawdbot/agents/<agentId>/sessions`

### Routing Precedence (most to least specific)
1. Direct peer matches (DM/group ID)
2. Guild/team identifiers
3. Account ID matching
4. Channel-level defaults
5. Fallback to primary agent

### Use Cases
- Multiple personalities on different channels
- Shared account, split by user phone numbers
- Per-agent security/sandboxing

---

## 7. MEMORY SYSTEM

Uses **plain Markdown files** in the agent workspace:
- **Daily logs**: `memory/YYYY-MM-DD.md` (append-only notes)
- **Long-term memory**: `MEMORY.md` (curated durable facts)

### Features
- Automatic memory flush before context compaction
- Vector-powered semantic search with embeddings
- Hybrid retrieval (vector + BM25 keyword matching)
- SQLite caching for embeddings

---

## 8. TOOLS

### Tool Categories
- **Execution**: `exec`, `process`, `bash`
- **File System**: `read`, `write`, `edit`, `apply_patch`
- **Web**: `web_search`, `web_fetch`, `browser`
- **Automation**: `cron`, `gateway`, `canvas`
- **Communications**: `message` (Discord, Slack, Teams, etc.)
- **System**: `nodes` for macOS companion apps

### Access Control
- Global allow/deny via `tools.allow` / `tools.deny`
- **Tool Groups**: `group:fs`, `group:runtime`, `group:sessions`, `group:web`
- **Tool Profiles**: `minimal`, `coding`, `messaging`, `full`

---

## 9. SKILLS

Skills are AgentSkills-compatible folders with `SKILL.md` files.

### Loading Priority (highest to lowest)
1. Workspace skills (`<workspace>/skills`)
2. Managed/local skills (`~/.clawdbot/skills`)
3. Bundled skills

### SKILL.md Format
```yaml
---
name: skill-name
description: "What the skill does"
emoji: "🔧"
gates:
  envs:
    - REQUIRED_ENV_VAR
  bins:
    - required-binary
---

# Skill Documentation

Full markdown documentation here...
```

### Discovery
Browse available skills at ClawdHub: https://clawdhub.com

---

## 10. SYSTEM PROMPT

Clawdbot constructs a custom system prompt for each agent run.

### Components
- Tooling descriptions
- Skills (when applicable)
- Workspace directory info
- Documentation references
- Runtime details (OS, Node version, model info)
- Current date/time (when timezone known)
- Sandbox configuration

### Prompt Modes
- **Full** (default): All sections
- **Minimal**: For sub-agents; omits Skills, Memory Recall, etc.
- **None**: Only identity

### Bootstrap Injection
Automatically injects from: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`
Large files truncated at `bootstrapMaxChars` (default 20,000)

---

## 11. STREAMING

### Block Streaming (Channel Messages)
Sends assistant output in coarse chunks as available.

Config:
- `blockStreamingDefault`: on/off
- `blockStreamingBreak`: emit at text boundaries or wait until complete
- Chunking rules with `minChars`/`maxChars`

### Telegram Draft Streaming
- `streamMode: "partial"`: updates drafts with live text
- `streamMode: "block"`: applies chunking rules to drafts

---

## 12. CHANNEL CONFIGURATION

### Telegram
```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "token",
      dmPolicy: "pairing",
      allowFrom: ["tg:123456789"],
      groups: { "*": { requireMention: true } },
      historyLimit: 50,
      mediaMaxMb: 5
    }
  }
}
```

### WhatsApp
```json5
{
  channels: {
    whatsapp: {
      enabled: true,
      dmPolicy: "pairing",
      allowFrom: ["+15555550123"],
      sendReadReceipts: true,
      textChunkLimit: 4000,
      mediaMaxMb: 50,
      historyLimit: 50
    }
  }
}
```

### Discord
```json5
{
  channels: {
    discord: {
      enabled: true,
      token: "bot-token",
      mediaMaxMb: 8,
      dm: {
        enabled: true,
        policy: "pairing",
        allowFrom: ["1234567890"]
      },
      guilds: {
        "123456789": {
          requireMention: false,
          channels: { general: { allow: true } }
        }
      },
      historyLimit: 20
    }
  }
}
```

---

## 13. COMPLETE CONFIGURATION STRUCTURE

```json5
{
  // Gateway Settings
  gateway: {
    port: 18789,
    auth: { token: "secret" }
  },

  // Agent Configuration
  agents: {
    defaults: {
      workspace: "~/clawd",
      model: { primary: "anthropic/claude-opus-4-5", fallbacks: [] },
      thinkingDefault: "low",
      timeoutSeconds: 600,
      mediaMaxMb: 5,
      maxConcurrent: 3,
      userTimezone: "America/Chicago",

      // Sandbox
      sandbox: {
        mode: "non-main", // off | non-main | all
        scope: "agent",   // session | agent | shared
        workspaceAccess: "none", // none | ro | rw
      },

      // Context
      contextTokens: 200000,
      compaction: { mode: "default", memoryFlush: { enabled: true } },

      // Sub-agents
      subagents: { model: "minimax/MiniMax-M2.1", maxConcurrent: 1 }
    },

    // Per-Agent Overrides
    list: [
      {
        id: "main",
        default: true,
        name: "Primary Agent",
        workspace: "~/clawd",

        // Agent Identity
        identity: {
          name: "Samantha",
          emoji: "🦥",
          theme: "helpful sloth"
        },

        // Tools & Access
        tools: {
          profile: "coding",
          allow: ["read", "write"],
          deny: ["process"]
        }
      }
    ]
  },

  // Channels
  channels: {
    defaults: { groupPolicy: "allowlist" },
    telegram: { /* ... */ },
    whatsapp: { /* ... */ },
    discord: { /* ... */ }
  },

  // Messages
  messages: {
    responsePrefix: "🦞",
    ackReaction: "👀",
    queue: { mode: "collect", debounceMs: 1000, cap: 20 }
  },

  // Sessions
  session: {
    scope: "per-sender",
    dmScope: "main",
    reset: { mode: "daily", atHour: 4, idleMinutes: 60 },
    resetTriggers: ["/new", "/reset"]
  },

  // Commands
  commands: {
    native: "auto",
    text: true,
    bash: false
  },

  // Tools
  tools: {
    profile: "coding",
    allow: ["read", "write"],
    deny: ["process"]
  },

  // Skills
  skills: {
    allowBundled: ["gemini"],
    load: { extraDirs: ["~/Projects/skills"] }
  },

  // Multi-Agent Routing
  bindings: [
    { agentId: "work", match: { channel: "whatsapp", accountId: "biz" } }
  ]
}
```

---

## 14. CLI COMMANDS

### Setup & Configuration
- `clawdbot onboard` - Interactive setup wizard
- `clawdbot configure` - Manage settings
- `clawdbot doctor --fix` - Health checks and auto-repair

### Communication
- `clawdbot message` - Unified outbound messaging
- `clawdbot channels login` - Authenticate channels
- `clawdbot pairing approve <channel> <code>` - Approve DM requests

### Agent Management
- `clawdbot agent` - Run single conversation turn
- `clawdbot agents add <name>` - Create isolated agent
- `clawdbot skills` - List available skills

### Session Management
- `clawdbot sessions --json` - List all sessions
- `/new` or `/reset` - Start fresh session (in chat)
- `/status` - Check agent status (in chat)

### Monitoring
- `clawdbot gateway` - Manage WebSocket service
- `clawdbot logs` - Tail structured events
- `clawdbot status` - Diagnostics

---

## 15. KEY DIFFERENCES: CLODDS vs CLAWDBOT

| Feature | Clawdbot | Clodds (Current) |
|---------|----------|------------------|
| Gateway | WebSocket + HTTP single port | Basic ✅ |
| Multi-agent routing | Full bindings system | Single agent ❌ |
| Channels | 10+ (WhatsApp, Signal, iMessage, etc.) | 3 (Telegram, Discord, WebChat) |
| Pairing auth | 8-char codes, 1hr expiry | ✅ Full implementation |
| Session scopes | per-sender, main, per-channel-peer | Basic per-user ❌ |
| Message queue | Debounce, collect, cap | None ❌ |
| Commands | /new, /reset, /status, /model | ✅ Full implementation |
| Identity/persona | Per-agent name, emoji, theme | None ❌ |
| Sandbox | Docker isolation | None ❌ |
| Memory | Vector search, daily logs | None ❌ |
| Streaming | Block + draft streaming | Basic ✅ |
| Skills | Full SKILL.md system | Has structure ✅ |
| CLI | Full command set | ✅ pairing commands |

---

## 16. IMPLEMENTATION PRIORITIES FOR CLODDS

### Phase 1: Core Infrastructure
1. ✅ Pairing system with codes (src/pairing/index.ts)
2. ✅ Commands system (/new, /reset, /status) (src/commands/index.ts)
3. Session scopes (per-sender, main, shared)
4. Message queue with debouncing

### Phase 2: Multi-Agent
1. Agent routing with bindings
2. Per-agent identity/persona
3. Agent isolation (workspace, sessions)

### Phase 3: Enhanced Channels
1. WhatsApp (Baileys)
2. Slack
3. Signal

### Phase 4: Advanced Features
1. Memory system with vector search
2. Sandbox mode
3. Browser control
