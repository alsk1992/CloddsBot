---
name: memory
description: "Persistent memory system for preferences, facts, and notes"
emoji: "🧠"
---

# Memory - Complete API Reference

Store and recall user preferences, facts, and notes across conversations. Semantic search powered by vector embeddings.

---

## Chat Commands

### Store Memories

```
/remember preference risk=conservative      Save trading preference
/remember fact BTC halving is in April 2028 Store a fact
/remember note Check ETH before market open Save a note
/remember rule Never trade during FOMC      Store trading rule
```

### Recall Memories

```
/memory                                     View all memories
/memory preferences                         View preferences only
/memory facts                               View facts only
/memory notes                               View notes only
/memory rules                               View trading rules
/memory search "bitcoin"                    Search memories
```

### Forget Memories

```
/forget <key>                               Delete specific memory
/forget all preferences                     Clear all preferences
/forget all                                 Clear everything (careful!)
```

---

## TypeScript API Reference

### Create Memory Service

```typescript
import { createMemoryService } from 'clodds/memory';

const memory = createMemoryService({
  // Storage backend
  backend: 'lancedb',  // 'lancedb' | 'sqlite' | 'postgres'

  // Embedding model
  embeddings: {
    provider: 'openai',
    model: 'text-embedding-3-small',
  },

  // Options
  encryptionKey: process.env.MEMORY_ENCRYPTION_KEY,
});
```

### Remember (Store)

```typescript
// Store a preference
await memory.remember({
  userId: 'user-123',
  type: 'preference',
  key: 'risk_tolerance',
  value: 'conservative',
});

// Store a fact
await memory.remember({
  userId: 'user-123',
  type: 'fact',
  content: 'BTC halving occurs approximately every 4 years',
  metadata: { topic: 'crypto', confidence: 0.95 },
});

// Store a note
await memory.remember({
  userId: 'user-123',
  type: 'note',
  content: 'Check Polymarket for election markets before Tuesday',
  metadata: { priority: 'high' },
});

// Store a trading rule
await memory.remember({
  userId: 'user-123',
  type: 'rule',
  content: 'Never trade more than 5% of portfolio on single position',
});
```

### Recall (Retrieve)

```typescript
// Get all memories for user
const all = await memory.recall({ userId: 'user-123' });

// Get by type
const preferences = await memory.recall({
  userId: 'user-123',
  type: 'preference',
});

// Get specific key
const risk = await memory.recall({
  userId: 'user-123',
  type: 'preference',
  key: 'risk_tolerance',
});
```

### Semantic Search

```typescript
// Search by meaning (not just keywords)
const results = await memory.semanticSearch({
  userId: 'user-123',
  query: 'what is my risk appetite?',
  limit: 5,
  threshold: 0.7,  // Similarity threshold
});

for (const result of results) {
  console.log(`${result.type}: ${result.content}`);
  console.log(`  Similarity: ${result.score}`);
}
```

### Forget (Delete)

```typescript
// Delete specific memory
await memory.forget({
  userId: 'user-123',
  type: 'preference',
  key: 'risk_tolerance',
});

// Delete all of a type
await memory.forgetByType({
  userId: 'user-123',
  type: 'note',
});

// Delete all memories
await memory.forgetAll({ userId: 'user-123' });
```

### Daily Journal

```typescript
// Log daily activity
await memory.logDaily({
  userId: 'user-123',
  date: new Date(),
  trades: 5,
  pnl: 123.45,
  notes: 'Good day, caught BTC rally',
});

// Get journal entries
const journal = await memory.getDailyLogs({
  userId: 'user-123',
  from: '2024-01-01',
  to: '2024-01-31',
});
```

---

## Memory Types

| Type | Purpose | Example |
|------|---------|---------|
| **preference** | User settings | `risk=conservative` |
| **fact** | Stored knowledge | "ETH gas is cheaper on weekends" |
| **note** | Reminders/todos | "Check election markets" |
| **rule** | Trading rules | "Max 5% per position" |
| **context** | Conversation context | Auto-saved by system |

---

## Storage Backends

| Backend | Description | Best For |
|---------|-------------|----------|
| **LanceDB** | Vector DB with hybrid search | Production, semantic search |
| **SQLite** | Local file-based | Development, single user |
| **PostgreSQL** | Distributed with pgvector | Multi-user, production |

---

## Best Practices

1. **Be specific with keys** — `max_position_size` not just `size`
2. **Use types correctly** — Preferences for settings, rules for constraints
3. **Semantic search** — Ask questions naturally, embeddings will match
4. **Regular cleanup** — Delete outdated notes and facts
5. **Backup memories** — Export before major changes
