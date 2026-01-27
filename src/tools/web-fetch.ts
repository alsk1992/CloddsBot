/**
 * Web Fetch Tool - Clawdbot-style URL content fetching
 *
 * Features:
 * - Fetch URLs and convert to markdown
 * - HTML to markdown conversion
 * - Content truncation
 * - Caching
 */

import { logger } from '../utils/logger';

/** Fetch options */
export interface FetchOptions {
  /** Max content length in characters */
  maxLength?: number;
  /** Output format */
  format?: 'markdown' | 'text' | 'html';
  /** Include metadata (title, description) */
  includeMetadata?: boolean;
  /** Timeout in ms */
  timeout?: number;
}

/** Fetch result */
export interface FetchResult {
  url: string;
  title?: string;
  description?: string;
  content: string;
  contentType: string;
  truncated: boolean;
  cached: boolean;
}

export interface WebFetchTool {
  /** Fetch a URL and return content */
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;

  /** Clear cache */
  clearCache(): void;
}

// Simple cache
interface CacheEntry {
  result: FetchResult;
  timestamp: number;
}

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const cache = new Map<string, CacheEntry>();

const DEFAULT_MAX_LENGTH = 50000;
const DEFAULT_TIMEOUT = 30000;

/**
 * Simple HTML to text conversion
 */
function htmlToText(html: string): string {
  return html
    // Remove scripts and styles
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Convert common elements
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * Simple HTML to markdown conversion
 */
function htmlToMarkdown(html: string): string {
  return html
    // Remove scripts and styles
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Headers
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n')
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n')
    // Bold and italic
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    // Links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    // Code
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>(.*?)<\/pre>/gis, '\n```\n$1\n```\n')
    // Lists
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    // Paragraphs and breaks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    // Remove remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * Extract metadata from HTML
 */
function extractMetadata(html: string): { title?: string; description?: string } {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  const descMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i
  );

  return {
    title: titleMatch ? titleMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
  };
}

export function createWebFetchTool(): WebFetchTool {
  return {
    async fetch(url, options = {}): Promise<FetchResult> {
      const maxLength = options.maxLength || DEFAULT_MAX_LENGTH;
      const format = options.format || 'markdown';
      const timeout = options.timeout || DEFAULT_TIMEOUT;
      const cacheKey = `${url}:${format}:${maxLength}`;

      // Check cache
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        logger.debug({ url }, 'Returning cached fetch result');
        return { ...cached.result, cached: true };
      }

      logger.info({ url, format }, 'Fetching URL');

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Clodds/1.0 (Web Fetch Tool)',
            Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || 'text/plain';
        let rawContent = await response.text();

        // Extract metadata
        let title: string | undefined;
        let description: string | undefined;
        if (options.includeMetadata && contentType.includes('html')) {
          const meta = extractMetadata(rawContent);
          title = meta.title;
          description = meta.description;
        }

        // Convert content
        let content: string;
        if (contentType.includes('html')) {
          if (format === 'markdown') {
            content = htmlToMarkdown(rawContent);
          } else if (format === 'text') {
            content = htmlToText(rawContent);
          } else {
            content = rawContent;
          }
        } else {
          content = rawContent;
        }

        // Truncate if needed
        let truncated = false;
        if (content.length > maxLength) {
          content = content.slice(0, maxLength) + '\n\n... (content truncated)';
          truncated = true;
        }

        const result: FetchResult = {
          url,
          title,
          description,
          content,
          contentType,
          truncated,
          cached: false,
        };

        // Cache result
        cache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        });

        return result;
      } catch (error) {
        logger.error({ error, url }, 'Web fetch failed');
        throw error;
      }
    },

    clearCache() {
      cache.clear();
      logger.info('Web fetch cache cleared');
    },
  };
}
