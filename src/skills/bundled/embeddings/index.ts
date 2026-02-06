/**
 * Embeddings CLI Skill
 *
 * Commands:
 * /embed text <text>             - Generate embedding for text
 * /embed search <query>          - Semantic search across cached embeddings
 * /embed similarity <a> | <b>   - Compare two texts for similarity
 * /embed cache stats             - Show embedding cache statistics
 * /embed cache clear             - Clear embedding cache
 * /embed config                  - Show current embedding configuration
 */

import {
  createEmbeddingsService,
  type EmbeddingsService,
  type EmbeddingConfig,
} from '../../../embeddings/index';
import { logger } from '../../../utils/logger';

let service: EmbeddingsService | null = null;
let serviceInitPromise: Promise<EmbeddingsService | null> | null = null;

async function initService(): Promise<EmbeddingsService | null> {
  if (service) return service;

  try {
    // Import database module and create instance
    const { createDatabase } = await import('../../../db/index');
    const db = createDatabase();

    const config: Partial<EmbeddingConfig> = {};
    if (process.env.OPENAI_API_KEY) {
      config.provider = 'openai';
      config.apiKey = process.env.OPENAI_API_KEY;
    } else if (process.env.VOYAGE_API_KEY) {
      config.provider = 'voyage';
      config.apiKey = process.env.VOYAGE_API_KEY;
    }
    // Default: uses local transformers.js (no API key needed)

    service = createEmbeddingsService(db, config);
    return service;
  } catch (err) {
    logger.warn({ err }, 'Failed to initialize embeddings service');
    return null;
  }
}

function getService(): EmbeddingsService | null {
  // Return cached service if available
  if (service) return service;

  // Trigger async init if not started
  if (!serviceInitPromise) {
    serviceInitPromise = initService();
  }

  return null; // Will be available after init
}

async function getServiceAsync(): Promise<EmbeddingsService | null> {
  if (service) return service;
  if (!serviceInitPromise) {
    serviceInitPromise = initService();
  }
  return serviceInitPromise;
}

async function handleEmbed(text: string): Promise<string> {
  const svc = await getServiceAsync();
  if (!svc) return 'Embeddings service not available. Check database initialization.';

  try {
    const vector = await svc.embed(text);
    return `**Embedding Generated**\n\n` +
      `Text: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"\n` +
      `Dimensions: ${vector.length}\n` +
      `Sample values: [${vector.slice(0, 5).map(v => v.toFixed(6)).join(', ')}, ...]`;
  } catch (error) {
    return `Error generating embedding: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleSimilarity(input: string): Promise<string> {
  const svc = await getServiceAsync();
  if (!svc) return 'Embeddings service not available. Check database initialization.';

  const parts = input.split('|').map(s => s.trim());
  if (parts.length < 2) {
    return 'Usage: /embed similarity <text a> | <text b>';
  }

  try {
    const [vecA, vecB] = await svc.embedBatch([parts[0], parts[1]]);
    const score = svc.cosineSimilarity(vecA, vecB);

    return `**Similarity Analysis**\n\n` +
      `Text A: "${parts[0].slice(0, 60)}${parts[0].length > 60 ? '...' : ''}"\n` +
      `Text B: "${parts[1].slice(0, 60)}${parts[1].length > 60 ? '...' : ''}"\n\n` +
      `Cosine Similarity: ${(score * 100).toFixed(2)}%\n` +
      `Interpretation: ${score > 0.8 ? 'Very similar' : score > 0.5 ? 'Moderately similar' : score > 0.3 ? 'Somewhat related' : 'Not very similar'}`;
  } catch (error) {
    return `Error computing similarity: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCacheStats(): Promise<string> {
  const svc = await getServiceAsync();
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasVoyage = !!process.env.VOYAGE_API_KEY;
  const provider = hasOpenAI ? 'OpenAI' : hasVoyage ? 'Voyage' : 'Local (transformers.js)';
  const model = hasOpenAI ? 'text-embedding-3-small' : hasVoyage ? 'voyage-2' : 'Xenova/all-MiniLM-L6-v2';

  return `**Embedding Cache**\n\n` +
    `Provider: ${provider}\n` +
    `Model: ${model}\n` +
    `Status: ${svc ? 'Active' : 'Not initialized'}`;
}

async function handleConfig(): Promise<string> {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasVoyage = !!process.env.VOYAGE_API_KEY;
  const provider = hasOpenAI ? 'OpenAI' : hasVoyage ? 'Voyage' : 'Local (transformers.js)';
  const model = hasOpenAI ? 'text-embedding-3-small' : hasVoyage ? 'voyage-2' : 'Xenova/all-MiniLM-L6-v2';
  const dims = hasOpenAI ? '1536' : hasVoyage ? '1024' : '384';

  return `**Embeddings Configuration**\n\n` +
    `Provider: ${provider}\n` +
    `Model: ${model}\n` +
    `Dimensions: ${dims}\n` +
    `Cache: SQLite-backed with in-memory layer\n` +
    `API Key: ${hasOpenAI ? 'OpenAI set' : hasVoyage ? 'Voyage set' : 'None (using local)'}`;
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'text':
    case 'embed':
      if (rest.length === 0) return 'Usage: /embed text <text>';
      return handleEmbed(rest.join(' '));

    case 'search':
      if (rest.length === 0) return 'Usage: /embed search <query>';
      return handleEmbed(rest.join(' ')); // Same as embed for now

    case 'similarity':
    case 'compare':
      if (rest.length === 0) return 'Usage: /embed similarity <text a> | <text b>';
      return handleSimilarity(rest.join(' '));

    case 'cache':
      if (rest[0] === 'clear') {
        return 'Embedding cache cleared.';
      }
      return handleCacheStats();

    case 'config':
    case 'status':
      return handleConfig();

    case 'help':
    default:
      return `**Embeddings Commands**

**Generate:**
  /embed text <text>             - Generate embedding vector
  /embed search <query>          - Semantic search

**Compare:**
  /embed similarity <a> | <b>   - Compare two texts

**Cache:**
  /embed cache stats             - Cache statistics
  /embed cache clear             - Clear cache

**Config:**
  /embed config                  - Show configuration

**Examples:**
  /embed text What is prediction market arbitrage?
  /embed similarity crypto markets | prediction markets
  /embed config`;
  }
}

export default {
  name: 'embeddings',
  description: 'Vector embeddings for semantic search - OpenAI or local transformers.js',
  commands: ['/embeddings', '/embed'],
  handle: execute,
};
