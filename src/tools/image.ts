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
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 1024;

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

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: base64,
      },
    };
  }

  if (source.type === 'base64') {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: source.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: source.data,
      },
    };
  }

  if (source.type === 'file') {
    const filePath = source.path;
    const ext = path.extname(filePath).toLowerCase();
    const mediaTypeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };

    const mediaType = mediaTypeMap[ext] || 'image/jpeg';
    const data = fs.readFileSync(filePath).toString('base64');

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
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
      const prompt = options.prompt || DEFAULT_PROMPT;
      const model = options.model || DEFAULT_MODEL;
      const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;

      logger.info({ sourceType: source.type, model }, 'Analyzing image');

      try {
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

        return {
          description: raw,
          raw,
        };
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

      logger.info({ count: sources.length, model }, 'Analyzing multiple images');

      try {
        const content: Anthropic.ContentBlockParam[] = [];

        for (const source of sources) {
          content.push(await sourceToContent(source));
        }

        content.push({ type: 'text', text: prompt });

        const response = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content }],
        });

        const textContent = response.content.find((c) => c.type === 'text');
        const raw = textContent?.type === 'text' ? textContent.text : '';

        return {
          description: raw,
          raw,
        };
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
