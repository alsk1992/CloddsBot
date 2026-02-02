/**
 * Web Scraping Service - HTTP fetching and HTML extraction for agents
 *
 * Supports static and JavaScript-rendered pages
 */

import { logger } from '../../utils/logger';
import type {
  ComputeRequest,
  WebRequest,
  WebResponse,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface WebScraper {
  /** Fetch and scrape a URL */
  execute(request: ComputeRequest): Promise<WebResponse>;
  /** Simple GET request */
  get(url: string): Promise<string>;
  /** Check if URL is allowed */
  isAllowed(url: string): boolean;
}

export interface WebScraperConfig {
  /** User agent string */
  userAgent?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Maximum response size in bytes (default: 10MB) */
  maxSize?: number;
  /** Blocked domains */
  blockedDomains?: string[];
  /** Proxy URL for requests */
  proxyUrl?: string;
  /** Enable JavaScript rendering (requires Playwright) */
  enableJs?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<WebScraperConfig> = {
  userAgent: 'CloddsBot/1.0 (+https://clodds.com/bot)',
  timeout: 30000,
  maxSize: 10 * 1024 * 1024, // 10MB
  blockedDomains: [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254', // AWS metadata
    'metadata.google.internal',
  ],
  proxyUrl: '',
  enableJs: false,
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createWebScraper(config: WebScraperConfig = {}): WebScraper {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  function isAllowed(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      // Check blocked domains
      for (const blocked of cfg.blockedDomains) {
        if (host === blocked || host.endsWith(`.${blocked}`)) {
          return false;
        }
      }

      // Only allow http/https
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  async function get(url: string): Promise<string> {
    if (!isAllowed(url)) {
      throw new Error(`URL not allowed: ${url}`);
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': cfg.userAgent,
      },
      signal: AbortSignal.timeout(cfg.timeout),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    if (text.length > cfg.maxSize) {
      throw new Error(`Response too large: ${text.length} bytes`);
    }

    return text;
  }

  async function execute(request: ComputeRequest): Promise<WebResponse> {
    const payload = request.payload as WebRequest;
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      waitFor,
      screenshot,
      extract,
      javascript,
      proxyCountry,
    } = payload;

    if (!isAllowed(url)) {
      throw new Error(`URL not allowed: ${url}`);
    }

    logger.info({
      requestId: request.id,
      url,
      method,
      javascript,
    }, 'Executing web scrape');

    // Use JavaScript rendering if requested and available
    if (javascript && cfg.enableJs) {
      return executeWithPlaywright(payload);
    }

    // Standard fetch
    const fetchHeaders: Record<string, string> = {
      'User-Agent': cfg.userAgent,
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: fetchHeaders,
      signal: AbortSignal.timeout(cfg.timeout),
    };

    if (body && method === 'POST') {
      fetchOptions.body = body;
    }

    const response = await fetch(url, fetchOptions);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let html: string | undefined;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text') || contentType.includes('json') || contentType.includes('xml')) {
      html = await response.text();

      // Enforce size limit
      if (html.length > cfg.maxSize) {
        html = html.slice(0, cfg.maxSize);
      }
    }

    // Extract data if selectors provided
    let extracted: Record<string, string> | undefined;
    if (extract && html) {
      extracted = extractData(html, extract);
    }

    return {
      status: response.status,
      headers: responseHeaders,
      html,
      extracted,
      finalUrl: response.url,
    };
  }

  async function executeWithPlaywright(payload: WebRequest): Promise<WebResponse> {
    // Dynamic import to avoid requiring Playwright unless needed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    let playwright: any;
    try {
      // Use require for optional dependency to avoid TypeScript module resolution
      playwright = require('playwright');
    } catch {
      throw new Error('Playwright not available. Install with: npm install playwright');
    }

    const browser = await playwright.chromium.launch({
      headless: true,
    });

    try {
      const context = await browser.newContext({
        userAgent: cfg.userAgent,
      });

      const page = await context.newPage();

      // Navigate
      const response = await page.goto(payload.url, {
        waitUntil: 'networkidle',
        timeout: cfg.timeout,
      });

      if (!response) {
        throw new Error('No response from page');
      }

      // Wait for selector if specified
      if (payload.waitFor) {
        await page.waitForSelector(payload.waitFor, { timeout: 10000 });
      }

      // Get HTML content
      const html = await page.content();

      // Take screenshot if requested
      let screenshotBase64: string | undefined;
      if (payload.screenshot) {
        const buffer = await page.screenshot({ type: 'png' });
        screenshotBase64 = buffer.toString('base64');
      }

      // Extract data
      let extracted: Record<string, string> | undefined;
      if (payload.extract) {
        extracted = {};
        for (const [key, selector] of Object.entries(payload.extract)) {
          try {
            const element = await page.$(selector);
            if (element) {
              extracted[key] = await element.textContent() || '';
            }
          } catch {
            // Ignore extraction errors
          }
        }
      }

      // Get response headers
      const headers: Record<string, string> = {};
      const allHeaders = response.headers() as Record<string, string>;
      for (const [key, value] of Object.entries(allHeaders)) {
        headers[key] = String(value);
      }

      return {
        status: response.status(),
        headers,
        html: html.length > cfg.maxSize ? html.slice(0, cfg.maxSize) : html,
        extracted,
        screenshot: screenshotBase64,
        finalUrl: page.url(),
      };
    } finally {
      await browser.close();
    }
  }

  function extractData(html: string, selectors: Record<string, string>): Record<string, string> {
    const extracted: Record<string, string> = {};

    // Simple regex-based extraction for common patterns
    for (const [key, selector] of Object.entries(selectors)) {
      try {
        // Handle common CSS-like selectors with regex
        if (selector.startsWith('#')) {
          // ID selector
          const id = selector.slice(1);
          const match = html.match(new RegExp(`id=["']${id}["'][^>]*>([^<]+)<`, 'i'));
          if (match) extracted[key] = match[1].trim();
        } else if (selector.startsWith('.')) {
          // Class selector
          const className = selector.slice(1);
          const match = html.match(new RegExp(`class=["'][^"']*${className}[^"']*["'][^>]*>([^<]+)<`, 'i'));
          if (match) extracted[key] = match[1].trim();
        } else if (selector.startsWith('meta[')) {
          // Meta tag
          const nameMatch = selector.match(/name=["']([^"']+)["']/);
          if (nameMatch) {
            const metaMatch = html.match(new RegExp(`<meta[^>]*name=["']${nameMatch[1]}["'][^>]*content=["']([^"']+)["']`, 'i'));
            if (metaMatch) extracted[key] = metaMatch[1];
          }
        } else if (selector === 'title') {
          // Title tag
          const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (match) extracted[key] = match[1].trim();
        } else {
          // Tag selector
          const match = html.match(new RegExp(`<${selector}[^>]*>([^<]+)</${selector}>`, 'i'));
          if (match) extracted[key] = match[1].trim();
        }
      } catch {
        // Ignore extraction errors
      }
    }

    return extracted;
  }

  return {
    execute,
    get,
    isAllowed,
  };
}
