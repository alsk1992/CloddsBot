---
name: search-config
description: "Search indexing configuration and full-text search management"
emoji: "🔎"
---

# Search Config - Complete API Reference

Configure search indexing, manage search backends, and optimize full-text search.

---

## Chat Commands

### View Status

```
/search-config                              Show search config
/search-config status                       Index status
/search-config stats                        Search statistics
```

### Index Management

```
/search-config rebuild                      Rebuild all indexes
/search-config rebuild memories             Rebuild specific index
/search-config optimize                     Optimize indexes
/search-config clear <index>                Clear index
```

### Configuration

```
/search-config backend sqlite               Set backend
/search-config backend elasticsearch        Use Elasticsearch
/search-config mode hybrid                  Set search mode
/search-config boost semantic 0.7           Set semantic weight
```

---

## TypeScript API Reference

### Create Search Service

```typescript
import { createSearchService } from 'clodds/search';

const search = createSearchService({
  // Backend
  backend: 'sqlite',  // 'sqlite' | 'elasticsearch' | 'typesense' | 'meilisearch'

  // Search mode
  mode: 'hybrid',  // 'fulltext' | 'semantic' | 'hybrid'

  // Hybrid weights
  semanticWeight: 0.6,
  fulltextWeight: 0.4,

  // Embedding provider (for semantic)
  embeddings: {
    provider: 'openai',
    model: 'text-embedding-3-small',
  },

  // Storage
  dbPath: './search.db',
});
```

### Index Documents

```typescript
// Index single document
await search.index({
  collection: 'memories',
  id: 'mem-1',
  content: 'User prefers conservative trading',
  metadata: {
    type: 'preference',
    userId: 'user-123',
  },
});

// Index batch
await search.indexBatch({
  collection: 'documents',
  documents: [
    { id: 'doc-1', content: 'First document', metadata: {} },
    { id: 'doc-2', content: 'Second document', metadata: {} },
  ],
});
```

### Search

```typescript
// Full-text search
const results = await search.search({
  query: 'trading strategies',
  collection: 'documents',
  limit: 10,
});

for (const result of results) {
  console.log(`${result.id}: ${result.score}`);
  console.log(`  ${result.snippet}`);
}

// With filters
const results = await search.search({
  query: 'bitcoin',
  collection: 'news',
  filters: {
    date: { gte: '2024-01-01' },
    source: 'reuters',
  },
  limit: 20,
});
```

### Hybrid Search

```typescript
// Combine full-text and semantic
const results = await search.hybridSearch({
  query: 'how to manage risk in trading',
  collection: 'documents',
  semanticWeight: 0.7,
  fulltextWeight: 0.3,
  limit: 10,
});
```

### Get Index Stats

```typescript
const stats = await search.getStats();

console.log('Index Statistics:');
for (const [collection, info] of Object.entries(stats.collections)) {
  console.log(`${collection}:`);
  console.log(`  Documents: ${info.documentCount}`);
  console.log(`  Size: ${info.sizeMB} MB`);
  console.log(`  Last indexed: ${info.lastIndexed}`);
}

console.log(`\nSearch Stats:`);
console.log(`  Queries today: ${stats.queriesToday}`);
console.log(`  Avg latency: ${stats.avgLatencyMs}ms`);
console.log(`  Cache hit rate: ${stats.cacheHitRate}%`);
```

### Rebuild Index

```typescript
// Rebuild all indexes
await search.rebuildAll();

// Rebuild specific collection
await search.rebuild('memories');

// With progress callback
await search.rebuild('documents', {
  onProgress: (progress) => {
    console.log(`${progress.current}/${progress.total} (${progress.percent}%)`);
  },
});
```

### Optimize Index

```typescript
// Optimize for better performance
await search.optimize();

// Optimize specific collection
await search.optimize('documents');
```

### Clear Index

```typescript
// Clear specific collection
await search.clear('memories');

// Clear all
await search.clearAll();
```

### Configure Backend

```typescript
// Switch to Elasticsearch
await search.setBackend('elasticsearch', {
  url: process.env.ELASTICSEARCH_URL,
  index: 'clodds',
});

// Switch to Typesense
await search.setBackend('typesense', {
  url: process.env.TYPESENSE_URL,
  apiKey: process.env.TYPESENSE_API_KEY,
});
```

---

## Search Backends

| Backend | Best For | Features |
|---------|----------|----------|
| **SQLite** | Development, small data | Simple, embedded |
| **Elasticsearch** | Production, large data | Scalable, powerful |
| **Typesense** | Fast search | Typo tolerance |
| **Meilisearch** | Instant search | Easy setup |

---

## Search Modes

| Mode | Description |
|------|-------------|
| `fulltext` | Traditional keyword matching |
| `semantic` | Vector similarity search |
| `hybrid` | Combined (best of both) |

---

## Hybrid Search Weights

```typescript
// More emphasis on meaning
const results = await search.hybridSearch({
  query: 'risk management',
  semanticWeight: 0.8,  // 80% semantic
  fulltextWeight: 0.2,  // 20% keyword
});

// More emphasis on exact matches
const results = await search.hybridSearch({
  query: 'BTCUSDT',
  semanticWeight: 0.2,  // 20% semantic
  fulltextWeight: 0.8,  // 80% keyword
});
```

---

## Best Practices

1. **Use hybrid search** — Best results for most queries
2. **Rebuild periodically** — Keep indexes fresh
3. **Optimize after bulk inserts** — Improve performance
4. **Monitor latency** — Scale if too slow
5. **Tune weights** — Adjust semantic/fulltext balance
