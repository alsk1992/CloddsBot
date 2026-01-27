/**
 * Web Search Tool - Clawdbot-style web search via Brave Search API
 *
 * Features:
 * - Search the web using Brave Search API
 * - Configurable result count
 * - Response caching
 * - Rate limiting
 */

import { logger } from '../utils/logger';

/** Search result */
export interface SearchResult {
  title: string;
  url: string;
  description: string;
  /** Publication date if available */
  date?: string;
}

/** Search options */
export interface SearchOptions {
  /** Number of results (default: 5, max: 20) */
  count?: number;
  /** Country code for localization */
  country?: string;
  /** Search freshness: day, week, month, year */
  freshness?: 'day' | 'week' | 'month' | 'year';
  /** Safe search: off, moderate, strict */
  safesearch?: 'off' | 'moderate' | 'strict';
}

/** Search response */
export interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalResults?: number;
  cached: boolean;
}

export interface WebSearchTool {
  /** Search the web */
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;

  /** Clear the cache */
  clearCache(): void;
}

// Simple in-memory cache
interface CacheEntry {
  response: SearchResponse;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry>();

export function createWebSearchTool(apiKey?: string): WebSearchTool {
  const braveApiKey = apiKey || process.env.BRAVE_SEARCH_API_KEY;

  if (!braveApiKey) {
    logger.warn('Brave Search API key not configured, web search will be unavailable');
  }

  function getCacheKey(query: string, options: SearchOptions): string {
    return JSON.stringify({ query, ...options });
  }

  return {
    async search(query, options = {}): Promise<SearchResponse> {
      const count = Math.min(options.count || 5, 20);
      const cacheKey = getCacheKey(query, { ...options, count });

      // Check cache
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        logger.debug({ query }, 'Returning cached search results');
        return { ...cached.response, cached: true };
      }

      if (!braveApiKey) {
        throw new Error('Brave Search API key not configured');
      }

      logger.info({ query, count }, 'Performing web search');

      try {
        // Build URL
        const params = new URLSearchParams({
          q: query,
          count: count.toString(),
        });

        if (options.country) {
          params.set('country', options.country);
        }
        if (options.freshness) {
          params.set('freshness', options.freshness);
        }
        if (options.safesearch) {
          params.set('safesearch', options.safesearch);
        }

        const response = await fetch(
          `https://api.search.brave.com/res/v1/web/search?${params}`,
          {
            headers: {
              Accept: 'application/json',
              'X-Subscription-Token': braveApiKey,
            },
          }
        );

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Brave Search API error: ${response.status} ${error}`);
        }

        const data = await response.json() as {
          web?: { results?: any[]; total?: number };
        };

        // Parse results
        const results: SearchResult[] = (data.web?.results || []).map(
          (r: any) => ({
            title: r.title,
            url: r.url,
            description: r.description,
            date: r.age,
          })
        );

        const searchResponse: SearchResponse = {
          query,
          results,
          totalResults: data.web?.total,
          cached: false,
        };

        // Cache results
        cache.set(cacheKey, {
          response: searchResponse,
          timestamp: Date.now(),
        });

        return searchResponse;
      } catch (error) {
        logger.error({ error, query }, 'Web search failed');
        throw error;
      }
    },

    clearCache() {
      cache.clear();
      logger.info('Web search cache cleared');
    },
  };
}

/**
 * Format search results for display
 */
export function formatSearchResults(response: SearchResponse): string {
  if (response.results.length === 0) {
    return `No results found for "${response.query}"`;
  }

  const lines = [`**Search results for "${response.query}":**\n`];

  for (let i = 0; i < response.results.length; i++) {
    const r = response.results[i];
    lines.push(`${i + 1}. **${r.title}**`);
    lines.push(`   ${r.url}`);
    lines.push(`   ${r.description}`);
    if (r.date) {
      lines.push(`   _${r.date}_`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
