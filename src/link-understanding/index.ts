/**
 * Link Understanding Module - Clawdbot-style URL metadata extraction
 *
 * Features:
 * - Extract OpenGraph metadata
 * - Twitter Card support
 * - Favicon extraction
 * - Content type detection
 * - Preview generation
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface LinkMetadata {
  url: string;
  finalUrl?: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
  type?: string;
  author?: string;
  publishedTime?: string;
  contentType?: string;
  charset?: string;
  // Twitter Card
  twitterCard?: string;
  twitterSite?: string;
  twitterCreator?: string;
  // Additional
  keywords?: string[];
  locale?: string;
  videoUrl?: string;
  audioUrl?: string;
}

export interface LinkPreview {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

export interface FetchOptions {
  timeout?: number;
  maxRedirects?: number;
  userAgent?: string;
  followRedirects?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; CloddsBot/1.0; +https://clodds.com)';
const MAX_CONTENT_LENGTH = 1024 * 1024; // 1MB

// =============================================================================
// HELPERS
// =============================================================================

/** Fetch URL content */
async function fetchUrl(url: string, options: FetchOptions = {}): Promise<{ content: string; contentType: string; finalUrl: string }> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  let redirectCount = 0;
  let currentUrl = url;

  while (redirectCount < maxRedirects) {
    const result = await new Promise<{ content: string; contentType: string; finalUrl: string } | { redirect: string }>((resolve, reject) => {
      const parsedUrl = new URL(currentUrl);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const req = protocol.get(currentUrl, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout,
      }, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const location = res.headers.location;
          const redirectUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
          resolve({ redirect: redirectUrl });
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const contentType = res.headers['content-type'] || 'text/html';

        // Only fetch HTML content
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          resolve({ content: '', contentType, finalUrl: currentUrl });
          return;
        }

        let data = '';
        let size = 0;

        res.setEncoding('utf-8');
        res.on('data', (chunk: string) => {
          size += chunk.length;
          if (size > MAX_CONTENT_LENGTH) {
            res.destroy();
            return;
          }
          data += chunk;
        });

        res.on('end', () => {
          resolve({ content: data, contentType, finalUrl: currentUrl });
        });

        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });

    if ('redirect' in result) {
      currentUrl = result.redirect;
      redirectCount++;
      continue;
    }

    return result;
  }

  throw new Error('Too many redirects');
}

/** Extract meta tag content */
function extractMeta(html: string, property: string): string | undefined {
  // Try property attribute
  const propRegex = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  let match = html.match(propRegex);
  if (match) return decodeHtmlEntities(match[1]);

  // Try name attribute
  const nameRegex = new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  match = html.match(nameRegex);
  if (match) return decodeHtmlEntities(match[1]);

  // Try content before property/name
  const reverseRegex = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i');
  match = html.match(reverseRegex);
  if (match) return decodeHtmlEntities(match[1]);

  return undefined;
}

/** Extract title tag */
function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : undefined;
}

/** Extract favicon */
function extractFavicon(html: string, baseUrl: string): string | undefined {
  // Try link tags
  const iconRegex = /<link[^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]+href=["']([^"']+)["']/i;
  const match = html.match(iconRegex);

  if (match) {
    const href = match[1];
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return 'https:' + href;
    if (href.startsWith('/')) return new URL(href, baseUrl).href;
    return new URL(href, baseUrl).href;
  }

  // Default to /favicon.ico
  try {
    return new URL('/favicon.ico', baseUrl).href;
  } catch {
    return undefined;
  }
}

/** Decode HTML entities */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/** Extract charset from content type or meta */
function extractCharset(contentType: string, html: string): string {
  // From Content-Type header
  const ctMatch = contentType.match(/charset=([^\s;]+)/i);
  if (ctMatch) return ctMatch[1];

  // From meta tag
  const metaMatch = html.match(/<meta[^>]+charset=["']?([^"'\s>]+)/i);
  if (metaMatch) return metaMatch[1];

  return 'utf-8';
}

// =============================================================================
// PUBLIC API
// =============================================================================

/** Extract metadata from a URL */
export async function extractMetadata(url: string, options: FetchOptions = {}): Promise<LinkMetadata> {
  try {
    const { content, contentType, finalUrl } = await fetchUrl(url, options);

    const metadata: LinkMetadata = {
      url,
      finalUrl: finalUrl !== url ? finalUrl : undefined,
      contentType,
      charset: extractCharset(contentType, content),
    };

    if (!content) {
      return metadata;
    }

    // OpenGraph
    metadata.title = extractMeta(content, 'og:title') || extractTitle(content);
    metadata.description = extractMeta(content, 'og:description') || extractMeta(content, 'description');
    metadata.image = extractMeta(content, 'og:image');
    metadata.siteName = extractMeta(content, 'og:site_name');
    metadata.type = extractMeta(content, 'og:type');
    metadata.locale = extractMeta(content, 'og:locale');
    metadata.videoUrl = extractMeta(content, 'og:video') || extractMeta(content, 'og:video:url');
    metadata.audioUrl = extractMeta(content, 'og:audio');

    // Article metadata
    metadata.author = extractMeta(content, 'article:author') || extractMeta(content, 'author');
    metadata.publishedTime = extractMeta(content, 'article:published_time');

    // Twitter Card
    metadata.twitterCard = extractMeta(content, 'twitter:card');
    metadata.twitterSite = extractMeta(content, 'twitter:site');
    metadata.twitterCreator = extractMeta(content, 'twitter:creator');

    // Fallback image from twitter
    if (!metadata.image) {
      metadata.image = extractMeta(content, 'twitter:image');
    }

    // Favicon
    metadata.favicon = extractFavicon(content, finalUrl);

    // Keywords
    const keywords = extractMeta(content, 'keywords');
    if (keywords) {
      metadata.keywords = keywords.split(',').map(k => k.trim()).filter(Boolean);
    }

    logger.debug({ url, title: metadata.title }, 'Link metadata extracted');
    return metadata;

  } catch (error) {
    logger.error({ url, error }, 'Failed to extract link metadata');
    return { url };
  }
}

/** Generate a preview for a URL */
export async function generatePreview(url: string, options: FetchOptions = {}): Promise<LinkPreview> {
  const metadata = await extractMetadata(url, options);

  return {
    url: metadata.finalUrl || url,
    title: metadata.title || new URL(url).hostname,
    description: metadata.description,
    image: metadata.image,
    siteName: metadata.siteName,
    favicon: metadata.favicon,
  };
}

/** Check if a URL is valid and accessible */
export async function checkUrl(url: string, options: FetchOptions = {}): Promise<{ valid: boolean; status?: number; error?: string }> {
  try {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve) => {
      const req = protocol.request(url, {
        method: 'HEAD',
        timeout: options.timeout ?? DEFAULT_TIMEOUT,
        headers: {
          'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
        },
      }, (res) => {
        resolve({
          valid: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
        });
      });

      req.on('error', (error) => {
        resolve({ valid: false, error: error.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ valid: false, error: 'Timeout' });
      });

      req.end();
    });
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Invalid URL' };
  }
}

/** Extract all URLs from text */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>\[\](){}'"]+/gi;
  const matches = text.match(urlRegex) || [];

  // Clean up URLs (remove trailing punctuation)
  return matches.map(url => url.replace(/[.,;:!?]$/, ''));
}

/** Check if text contains URLs */
export function hasUrls(text: string): boolean {
  return /https?:\/\/[^\s]+/.test(text);
}

/** Expand shortened URLs */
export async function expandUrl(shortUrl: string, options: FetchOptions = {}): Promise<string> {
  try {
    const { finalUrl } = await fetchUrl(shortUrl, { ...options, followRedirects: true });
    return finalUrl;
  } catch {
    return shortUrl;
  }
}
