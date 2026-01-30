---
name: sessions
description: "Session management, conversation history, and checkpoints"
emoji: "💬"
---

# Sessions - Complete API Reference

Manage conversation sessions, history, checkpoints, and resets across channels.

---

## Chat Commands

### Session Control

```
/new                                        Start new conversation
/reset                                      Reset current session
/session                                    View session info
/session list                               List active sessions
```

### Checkpoints

```
/checkpoint save "before refactor"          Save checkpoint
/checkpoint list                            List checkpoints
/checkpoint restore <id>                    Restore checkpoint
/checkpoint delete <id>                     Delete checkpoint
```

### History

```
/history                                    View conversation history
/history export                             Export as markdown
/history clear                              Clear history (keeps session)
```

### Settings

```
/session scope main                         Use main session
/session scope channel                      Per-channel sessions
/session scope peer                         Per-user sessions
/session reset-time 00:00                   Set daily reset time
/session idle-reset 30                      Reset after 30 min idle
```

---

## TypeScript API Reference

### Create Session Manager

```typescript
import { createSessionManager } from 'clodds/sessions';

const sessions = createSessionManager({
  // Session scope
  scope: 'per-channel-peer',  // 'main' | 'per-peer' | 'per-channel-peer'

  // Auto-reset
  dailyResetHour: 0,  // Reset at midnight
  idleResetMinutes: 30,  // Reset after 30 min idle

  // Storage
  storage: 'sqlite',
  dbPath: './sessions.db',

  // Encryption
  encryptTranscripts: true,
  encryptionKey: process.env.SESSION_KEY,
});
```

### Get or Create Session

```typescript
const session = await sessions.getOrCreateSession({
  userId: 'user-123',
  channelId: 'telegram-456',
  peerId: 'peer-789',
});

console.log(`Session ID: ${session.id}`);
console.log(`Created: ${session.createdAt}`);
console.log(`Messages: ${session.messageCount}`);
console.log(`Last activity: ${session.lastActivityAt}`);
```

### Add Message to History

```typescript
// Add user message
await sessions.addMessage({
  sessionId: session.id,
  role: 'user',
  content: 'What is my portfolio value?',
});

// Add assistant message
await sessions.addMessage({
  sessionId: session.id,
  role: 'assistant',
  content: 'Your portfolio is worth $10,234.56',
  usage: {
    inputTokens: 500,
    outputTokens: 200,
  },
});
```

### Get History

```typescript
// Get conversation history
const history = await sessions.getHistory(session.id, {
  limit: 50,
  format: 'messages',  // 'messages' | 'markdown' | 'text'
});

for (const msg of history) {
  console.log(`[${msg.role}] ${msg.content}`);
}
```

### Clear History

```typescript
// Clear conversation but keep session
await sessions.clearHistory(session.id);
```

### Reset Session

```typescript
// Full reset (new session)
await sessions.reset({
  userId: 'user-123',
  channelId: 'telegram-456',
});
```

### Checkpoints

```typescript
// Save checkpoint
const checkpoint = await sessions.saveCheckpoint({
  sessionId: session.id,
  name: 'Before major change',
  description: 'Saving state before refactoring trading strategy',
});

console.log(`Checkpoint ID: ${checkpoint.id}`);
console.log(`Messages saved: ${checkpoint.messageCount}`);

// List checkpoints
const checkpoints = await sessions.listCheckpoints(session.id);

for (const cp of checkpoints) {
  console.log(`${cp.id}: ${cp.name} (${cp.messageCount} messages)`);
}

// Restore checkpoint
await sessions.restoreCheckpoint(checkpoint.id);

// Delete checkpoint
await sessions.deleteCheckpoint(checkpoint.id);
```

### Export Session

```typescript
// Export as markdown
const markdown = await sessions.export(session.id, {
  format: 'markdown',
  includeMetadata: true,
});

// Export as JSON
const json = await sessions.export(session.id, {
  format: 'json',
});
```

### Session Cleanup

```typescript
// Delete old sessions
await sessions.cleanup({
  olderThan: '30d',  // Delete sessions older than 30 days
  keepCheckpoints: true,
});
```

---

## Session Scopes

| Scope | Description | Use Case |
|-------|-------------|----------|
| `main` | Single global session | Personal use |
| `per-peer` | Session per user | Multi-user, shared channels |
| `per-channel-peer` | Session per user per channel | Full isolation |

---

## Auto-Reset Behavior

| Trigger | Behavior |
|---------|----------|
| **Daily reset** | New session at configured hour |
| **Idle reset** | New session after inactivity |
| **Manual reset** | User runs `/new` or `/reset` |

---

## Encryption

When `encryptTranscripts: true`:
- All messages encrypted with AES-256-GCM
- Per-session encryption keys
- Secure key derivation from master key

---

## Context Window Management

```typescript
// Get context-aware history (for LLM)
const context = await sessions.getContextHistory({
  sessionId: session.id,
  maxTokens: 100000,  // Fit in context window
  strategy: 'smart',  // 'recent' | 'smart' | 'summarize'
});

// 'smart' keeps system messages + recent + important messages
// 'summarize' compresses old messages into summaries
```

---

## Best Practices

1. **Choose appropriate scope** — Per-channel-peer for multi-user
2. **Use checkpoints** — Before major changes or experiments
3. **Export regularly** — Keep backups of important conversations
4. **Set idle reset** — Prevents stale context
5. **Enable encryption** — For sensitive conversations
