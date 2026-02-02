---
name: embeddings
description: "Vector embeddings configuration and semantic search"
emoji: "🧬"
---

# Embeddings - Complete API Reference

Configure embedding providers, manage vector storage, and perform semantic search.

---

## Chat Commands

### View Config

```
/embeddings                                 Show current settings
/embeddings status                          Provider status
/embeddings stats                           Cache statistics
```

### Configure Provider

```
/embeddings provider openai                 Use OpenAI embeddings
/embeddings provider voyage                 Use Voyage AI
/embeddings provider local                  Use local model
/embeddings model text-embedding-3-small    Set model
```

### Cache Management

```
/embeddings cache stats                     View cache stats
/embeddings cache clear                     Clear cache
/embeddings cache size                      Total cache size
```

### Testing

```
/embeddings test "sample text"              Generate test embedding
/embeddings similarity "text1" "text2"      Compare similarity
```

---

## TypeScript API Reference

### Create Embeddings Service

```typescript
import { createEmbeddingsService } from 'clodds/embeddings';

const embeddings = createEmbeddingsService({
  // Provider
  provider: 'openai',  // 'openai' | 'voyage' | 'local' | 'cohere'
  apiKey: process.env.OPENAI_API_KEY,

  // Model
  model: 'text-embedding-3-small',
  dimensions: 1536,

  // Caching
  cache: true,
  cacheBackend: 'sqlite',
  cachePath: './embeddings-cache.db',

  // Batching
  batchSize: 100,
  maxConcurrent: 5,
});
```

### Generate Embeddings

```typescript
// Single text
const embedding = await embeddings.embed('Hello world');
console.log(`Dimensions: ${embedding.length}`);

// Multiple texts (batched)
const vectors = await embeddings.embedBatch([
  'First document',
  'Second document',
  'Third document',
]);
```

### Semantic Search

```typescript
// Search against stored vectors
const results = await embeddings.search({
  query: 'trading strategies',
  collection: 'documents',
  limit: 10,
  threshold: 0.7,
});

for (const result of results) {
  console.log(`${result.text} (score: ${result.score})`);
}
```

### Similarity

```typescript
// Compare two texts
const score = await embeddings.similarity(
  'The cat sat on the mat',
  'A feline rested on the rug'
);

console.log(`Similarity: ${score}`);  // 0.0 - 1.0
```

### Store Vectors

```typescript
// Store embedding with metadata
await embeddings.store({
  collection: 'documents',
  id: 'doc-1',
  text: 'Original text',
  embedding: vector,
  metadata: {
    source: 'wiki',
    date: '2024-01-01',
  },
});

// Store batch
await embeddings.storeBatch({
  collection: 'documents',
  items: [
    { id: 'doc-1', text: 'First doc' },
    { id: 'doc-2', text: 'Second doc' },
  ],
});
```

### Cache Management

```typescript
// Get cache stats
const stats = await embeddings.getCacheStats();
console.log(`Cached: ${stats.count} embeddings`);
console.log(`Size: ${stats.sizeMB} MB`);
console.log(`Hit rate: ${stats.hitRate}%`);

// Clear cache
await embeddings.clearCache();

// Clear specific entries
await embeddings.clearCache({ olderThan: '7d' });
```

### Provider Configuration

```typescript
// Switch provider
embeddings.setProvider('voyage', {
  apiKey: process.env.VOYAGE_API_KEY,
  model: 'voyage-large-2',
});

// Use local model (Transformers.js)
// No API key required - runs locally via @xenova/transformers
embeddings.setProvider('local', {
  model: 'Xenova/all-MiniLM-L6-v2',  // 384 dimensions
});
```

---

## Providers

| Provider | Models | Quality | Speed | Cost |
|----------|--------|---------|-------|------|
| **OpenAI** | text-embedding-3-small/large | Excellent | Fast | $0.02/1M |
| **Voyage** | voyage-large-2 | Excellent | Fast | $0.02/1M |
| **Cohere** | embed-english-v3 | Good | Fast | $0.10/1M |
| **Local (Transformers.js)** | Xenova/all-MiniLM-L6-v2 | Good | Medium | Free |

---

## Models

### OpenAI
| Model | Dimensions | Best For |
|-------|------------|----------|
| `text-embedding-3-small` | 1536 | General use |
| `text-embedding-3-large` | 3072 | High accuracy |

### Voyage
| Model | Dimensions | Best For |
|-------|------------|----------|
| `voyage-large-2` | 1024 | General use |
| `voyage-code-2` | 1536 | Code search |

---

## Use Cases

### Semantic Memory Search

```typescript
// Store user memories
await embeddings.store({
  collection: 'memories',
  id: 'mem-1',
  text: 'User prefers conservative trading',
});

// Search memories
const relevant = await embeddings.search({
  query: 'what is user risk preference',
  collection: 'memories',
  limit: 5,
});
```

### Document Similarity

```typescript
// Find similar documents
const similar = await embeddings.findSimilar({
  text: 'How to trade options',
  collection: 'docs',
  limit: 5,
});
```

---

## Best Practices

1. **Use caching** — Avoid redundant API calls
2. **Batch requests** — More efficient than single calls
3. **Choose dimensions wisely** — Balance quality vs storage
4. **Monitor costs** — Embeddings can add up
5. **Local for development** — Use local model to save costs
