/**
 * Image Tool - Clawdbot-style image analysis with vision models
 *
 * Features:
 * - Analyze images using Claude's vision
 * - Support for URLs and base64
 * - Custom prompts
 * - Multiple image analysis
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';

/** Image source types */
export type ImageSource =
  | { type: 'url'; url: string }
  | { type: 'base64'; data: string; mediaType: string }
  | { type: 'file'; path: string };

/** Analysis options */
export interface AnalyzeOptions {
  /** Custom prompt for analysis */
  prompt?: string;
  /** Model to use */
  model?: string;
  /** Max tokens for response */
  maxTokens?: number;
  /** OCR/text extraction hints */
  ocr?: {
    enabled?: boolean;
    /** Language hint (e.g., en, es, ja) */
    language?: string;
    /** Treat as document-like image */
    documentMode?: boolean;
  };
}

/** Analysis result */
export interface AnalysisResult {
  description: string;
  /** Extracted text if any */
  text?: string;
  /** Detected objects/elements */
  elements?: string[];
  /** Raw model response */
  raw: string;
}

export interface ImageTool {
  /** Analyze a single image */
  analyze(source: ImageSource, options?: AnalyzeOptions): Promise<AnalysisResult>;

  /** Analyze multiple images */
  analyzeMultiple(
    sources: ImageSource[],
    options?: AnalyzeOptions
  ): Promise<AnalysisResult>;

  /** Compare two images */
  compare(
    source1: ImageSource,
    source2: ImageSource,
    options?: AnalyzeOptions
  ): Promise<string>;
}

const DEFAULT_PROMPT = 'Describe this image in detail. Include any text visible in the image.';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 20;

type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
const SUPPORTED_MEDIA_TYPES = new Set<SupportedMediaType>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface CacheEntry {
  value: AnalysisResult;
  timestamp: number;
}

const MAX_CACHE_ENTRIES = 100;
const rateLimitState: RateLimitEntry = { count: 0, resetAt: 0 };
const responseCache = new Map<string, CacheEntry>();

function isSupportedMediaType(mediaType: string): mediaType is SupportedMediaType {
  return SUPPORTED_MEDIA_TYPES.has(mediaType as SupportedMediaType);
}

function normalizeMediaType(mediaType: string): SupportedMediaType {
  const normalized = mediaType.toLowerCase().trim();
  if (!isSupportedMediaType(normalized)) {
    throw new Error(`Unsupported image media type: ${mediaType}`);
  }
  return normalized;
}

function detectMediaTypeFromFile(filePath: string): SupportedMediaType {
  const ext = path.extname(filePath).toLowerCase();
  const mediaTypeMap: Record<string, SupportedMediaType> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const mediaType = mediaTypeMap[ext];
  if (!mediaType) {
    throw new Error(`Unsupported image file extension: ${ext || '(none)'}`);
  }
  return mediaType;
}

function enforceVisionRateLimit(): void {
  const now = Date.now();
  const windowMs =
    parseInt(process.env.CLODDS_VISION_RATE_WINDOW_MS || '', 10) || DEFAULT_RATE_LIMIT_WINDOW_MS;
  const maxRequests =
    parseInt(process.env.CLODDS_VISION_RATE_MAX || '', 10) || DEFAULT_RATE_LIMIT_MAX;

  if (rateLimitState.resetAt <= now) {
    rateLimitState.count = 0;
    rateLimitState.resetAt = now + Math.max(1_000, windowMs);
  }

  if (rateLimitState.count >= Math.max(1, maxRequests)) {
    const resetIn = Math.ceil((rateLimitState.resetAt - now) / 1000);
    throw new Error(`Vision rate limit exceeded. Try again in ${resetIn}s.`);
  }

  rateLimitState.count += 1;
}

function buildCacheKey(source: ImageSource, options: AnalyzeOptions, prompt: string, model: string): string {
  // Avoid huge keys by hashing significant inputs.
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ prompt, model, maxTokens: options.maxTokens, ocr: options.ocr }));
  switch (source.type) {
    case 'url':
      hash.update(`url:${source.url}`);
      break;
    case 'base64':
      hash.update(`base64:${source.mediaType}:${source.data.slice(0, 256)}`);
      break;
    case 'file':
      hash.update(`file:${source.path}`);
      try {
        const stat = fs.statSync(source.path);
        hash.update(`:${stat.size}:${stat.mtimeMs}`);
      } catch {
        // Ignore stat errors; file read will fail later if needed.
      }
      break;
  }
  return hash.digest('hex');
}

function getCached(cacheKey: string): AnalysisResult | null {
  const entry = responseCache.get(cacheKey);
  if (!entry) return null;
  const ttl =
    parseInt(process.env.CLODDS_VISION_CACHE_TTL_MS || '', 10) || DEFAULT_CACHE_TTL_MS;
  if (Date.now() - entry.timestamp > Math.max(1_000, ttl)) {
    responseCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function evictStaleCacheEntries(): void {
  const ttl =
    parseInt(process.env.CLODDS_VISION_CACHE_TTL_MS || '', 10) || DEFAULT_CACHE_TTL_MS;
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (now - entry.timestamp > Math.max(1_000, ttl)) {
      responseCache.delete(key);
    }
  }
}

function setCached(cacheKey: string, value: AnalysisResult): void {
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    evictStaleCacheEntries();
  }
  // If still at capacity after eviction, drop the oldest entry.
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(cacheKey, { value, timestamp: Date.now() });
}

function buildPrompt(basePrompt: string, options: AnalyzeOptions): string {
  const ocr = options.ocr;
  if (!ocr?.enabled) {
    return basePrompt;
  }

  const hints: string[] = [
    'Perform OCR and extract all visible text verbatim before summarizing.',
  ];
  if (ocr.language) {
    hints.push(`Primary OCR language hint: ${ocr.language}.`);
  }
  if (ocr.documentMode) {
    hints.push('Treat the image as a document or screenshot; preserve layout cues when relevant.');
  }

  return `${hints.join(' ')}\n\n${basePrompt}`;
}

/**
 * Convert image source to Anthropic API format
 */
async function sourceToContent(
  source: ImageSource
): Promise<Anthropic.ImageBlockParam> {
  if (source.type === 'url') {
    // Fetch the URL and convert to base64
    const response = await fetch(source.url);
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const mediaType = normalizeMediaType(contentType.split(';')[0] || contentType);

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64,
      },
    };
  }

  if (source.type === 'base64') {
    const mediaType = normalizeMediaType(source.mediaType);
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: source.data,
      },
    };
  }

  if (source.type === 'file') {
    const filePath = source.path;
    const mediaType = detectMediaTypeFromFile(filePath);
    const data = fs.readFileSync(filePath).toString('base64');

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data,
      },
    };
  }

  throw new Error('Invalid image source type');
}

export function createImageTool(apiKey?: string): ImageTool {
  const anthropic = new Anthropic({
    apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
  });

  return {
    async analyze(source, options = {}): Promise<AnalysisResult> {
      const basePrompt = options.prompt || DEFAULT_PROMPT;
      const prompt = buildPrompt(basePrompt, options);
      const model = options.model || DEFAULT_MODEL;
      const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
      const cacheKey = buildCacheKey(source, options, prompt, model);

      logger.info({ sourceType: source.type, model }, 'Analyzing image');

      try {
        const cached = getCached(cacheKey);
        if (cached) {
          return { ...cached };
        }

        enforceVisionRateLimit();
        const imageContent = await sourceToContent(source);

        const response = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          messages: [
            {
              role: 'user',
              content: [
                imageContent,
                { type: 'text', text: prompt },
              ],
            },
          ],
        });

        const textContent = response.content.find((c) => c.type === 'text');
        const raw = textContent?.type === 'text' ? textContent.text : '';

        const result: AnalysisResult = {
          description: raw,
          raw,
        };
        setCached(cacheKey, result);
        return result;
      } catch (error) {
        logger.error({ error }, 'Image analysis failed');
        throw error;
      }
    },

    async analyzeMultiple(sources, options = {}): Promise<AnalysisResult> {
      const prompt =
        options.prompt ||
        'Describe these images in detail. Note any relationships or differences between them.';
      const model = options.model || DEFAULT_MODEL;
      const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
      const finalPrompt = buildPrompt(prompt, options);

      logger.info({ count: sources.length, model }, 'Analyzing multiple images');

      try {
        // Try to serve from cache for single-image multi calls.
        if (sources.length === 1) {
          const cacheKey = buildCacheKey(sources[0], options, finalPrompt, model);
          const cached = getCached(cacheKey);
          if (cached) {
            return { ...cached };
          }
        }

        const content: Anthropic.ContentBlockParam[] = [];

        for (const source of sources) {
          content.push(await sourceToContent(source));
        }

        content.push({ type: 'text', text: finalPrompt });
        enforceVisionRateLimit();

        const response = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content }],
        });

        const textContent = response.content.find((c) => c.type === 'text');
        const raw = textContent?.type === 'text' ? textContent.text : '';

        const result: AnalysisResult = {
          description: raw,
          raw,
        };
        if (sources.length === 1) {
          const cacheKey = buildCacheKey(sources[0], options, finalPrompt, model);
          setCached(cacheKey, result);
        }
        return result;
      } catch (error) {
        logger.error({ error }, 'Multiple image analysis failed');
        throw error;
      }
    },

    async compare(source1, source2, options = {}): Promise<string> {
      const prompt =
        options.prompt ||
        'Compare these two images. Describe the differences and similarities in detail.';

      const result = await this.analyzeMultiple([source1, source2], {
        ...options,
        prompt,
      });

      return result.description;
    },
  };
}
