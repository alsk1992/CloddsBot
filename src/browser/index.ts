/**
 * Browser Control - Clawdbot-style Chrome/Chromium CDP control
 *
 * Features:
 * - Launch managed browser instance
 * - Navigate, click, type, screenshot
 * - Profile management
 * - Cookie/session persistence
 */

import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { homedir, platform } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import * as http from 'http';
import * as https from 'https';

// =============================================================================
// CDP (Chrome DevTools Protocol) Client
// =============================================================================

interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CDPMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Simple WebSocket implementation for CDP */
class CDPConnection extends EventEmitter {
  private ws: import('ws').WebSocket | null = null;
  private messageId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  async connect(wsUrl: string): Promise<void> {
    // Dynamic import ws
    const WebSocket = (await import('ws')).default;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        logger.debug({ wsUrl }, 'CDP connected');
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        const msg: CDPMessage = JSON.parse(data.toString());

        if (msg.id !== undefined) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg.result);
            }
          }
        } else if (msg.method) {
          this.emit(msg.method, msg.params);
        }
      });

      this.ws.on('error', (err) => {
        logger.error({ error: err }, 'CDP error');
        reject(err);
      });

      this.ws.on('close', () => {
        logger.debug('CDP disconnected');
        this.emit('disconnected');
      });
    });
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.ws) throw new Error('Not connected');

    const id = ++this.messageId;
    const message = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(message);

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// =============================================================================
// BROWSER PAGE
// =============================================================================

export interface BrowserPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string, options?: { delay?: number }): Promise<void>;
  screenshot(options?: { fullPage?: boolean; format?: 'png' | 'jpeg' }): Promise<Buffer>;
  content(): Promise<string>;
  title(): Promise<string>;
  url(): string;
  evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
  waitForNavigation(options?: { timeout?: number }): Promise<void>;
  setViewport(width: number, height: number): Promise<void>;
  cookies(): Promise<Array<{ name: string; value: string; domain: string }>>;
  setCookie(name: string, value: string, options?: { domain?: string; path?: string }): Promise<void>;
  close(): Promise<void>;
}

function createPage(cdp: CDPConnection, targetId: string): BrowserPage {
  let currentUrl = '';

  const page: BrowserPage = {
    async goto(url, options = {}) {
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url });
      currentUrl = url;

      // Wait for load
      await new Promise<void>((resolve) => {
        const handler = () => {
          cdp.off('Page.loadEventFired', handler);
          resolve();
        };
        cdp.on('Page.loadEventFired', handler);
        // Timeout fallback
        setTimeout(resolve, 30000);
      });

      logger.debug({ url }, 'Page navigated');
    },

    async click(selector) {
      // Get element position
      const result = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) throw new Error('Element not found: ${selector}');
            const rect = el.getBoundingClientRect();
            return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
          })()
        `,
        returnByValue: true,
      }) as { result: { value: { x: number; y: number } } };

      const { x, y } = result.result.value;

      // Click at position
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

      logger.debug({ selector }, 'Clicked element');
    },

    async type(selector, text, options = {}) {
      // Focus element
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
      });

      // Type each character
      const delay = options.delay || 0;
      for (const char of text) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', text: char });
        if (delay) await new Promise(r => setTimeout(r, delay));
      }

      logger.debug({ selector, length: text.length }, 'Typed text');
    },

    async screenshot(options = {}) {
      const format = options.format || 'png';

      if (options.fullPage) {
        // Get full page dimensions
        const metrics = await cdp.send('Page.getLayoutMetrics') as {
          contentSize: { width: number; height: number };
        };
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: Math.ceil(metrics.contentSize.width),
          height: Math.ceil(metrics.contentSize.height),
          deviceScaleFactor: 1,
          mobile: false,
        });
      }

      const result = await cdp.send('Page.captureScreenshot', { format }) as { data: string };

      logger.debug({ format, fullPage: options.fullPage }, 'Screenshot captured');
      return Buffer.from(result.data, 'base64');
    },

    async content() {
      const result = await cdp.send('Runtime.evaluate', {
        expression: 'document.documentElement.outerHTML',
        returnByValue: true,
      }) as { result: { value: string } };
      return result.result.value;
    },

    async title() {
      const result = await cdp.send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true,
      }) as { result: { value: string } };
      return result.result.value;
    },

    url() {
      return currentUrl;
    },

    async evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
      const expression = typeof fn === 'string'
        ? fn
        : `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`;

      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }) as { result: { value: T } };

      return result.result.value;
    },

    async waitForSelector(selector, options = {}) {
      const timeout = options.timeout || 30000;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        const result = await cdp.send('Runtime.evaluate', {
          expression: `!!document.querySelector(${JSON.stringify(selector)})`,
          returnByValue: true,
        }) as { result: { value: boolean } };

        if (result.result.value) return;
        await new Promise(r => setTimeout(r, 100));
      }

      throw new Error(`Timeout waiting for selector: ${selector}`);
    },

    async waitForNavigation(options = {}) {
      const timeout = options.timeout || 30000;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Navigation timeout')), timeout);
        const handler = () => {
          clearTimeout(timer);
          cdp.off('Page.loadEventFired', handler);
          resolve();
        };
        cdp.on('Page.loadEventFired', handler);
      });
    },

    async setViewport(width, height) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    },

    async cookies() {
      const result = await cdp.send('Network.getAllCookies') as {
        cookies: Array<{ name: string; value: string; domain: string }>;
      };
      return result.cookies;
    },

    async setCookie(name, value, options = {}) {
      await cdp.send('Network.setCookie', {
        name,
        value,
        domain: options.domain || new URL(currentUrl).hostname,
        path: options.path || '/',
      });
    },

    async close() {
      await cdp.send('Target.closeTarget', { targetId });
      cdp.close();
      logger.debug({ targetId }, 'Page closed');
    },
  };

  return page;
}

// =============================================================================
// BROWSER SERVICE
// =============================================================================

export interface BrowserLaunchOptions {
  headless?: boolean;
  userDataDir?: string;
  args?: string[];
  executablePath?: string;
}

export interface BrowserService {
  launch(options?: BrowserLaunchOptions): Promise<void>;
  newPage(): Promise<BrowserPage>;
  pages(): Promise<BrowserPage[]>;
  close(): Promise<void>;
  isRunning(): boolean;
}

/** Find Chrome executable */
function findChrome(): string | null {
  const os = platform();

  const paths = os === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  ] : os === 'linux' ? [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ] : [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  return null;
}

/** Get list of targets from CDP */
async function getTargets(port: number): Promise<CDPTarget[]> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/** Create new target */
async function createTarget(port: number, url = 'about:blank'): Promise<CDPTarget> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/new?${url}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

export function createBrowserService(): BrowserService {
  let process: ChildProcess | null = null;
  let debuggingPort = 0;
  let running = false;
  const pages: BrowserPage[] = [];

  return {
    async launch(options = {}) {
      const chromePath = options.executablePath || findChrome();
      if (!chromePath) {
        throw new Error('Chrome not found. Install Chrome or specify executablePath.');
      }

      // Find available port
      debuggingPort = 9222 + Math.floor(Math.random() * 100);

      // User data dir for profile persistence
      const userDataDir = options.userDataDir || join(homedir(), '.clodds', 'browser-profile');
      if (!existsSync(userDataDir)) {
        mkdirSync(userDataDir, { recursive: true });
      }

      const args = [
        `--remote-debugging-port=${debuggingPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...(options.headless !== false ? ['--headless=new'] : []),
        ...(options.args || []),
      ];

      logger.info({ chromePath, port: debuggingPort, headless: options.headless !== false }, 'Launching browser');

      process = spawn(chromePath, args, {
        stdio: 'ignore',
        detached: false,
      });

      process.on('exit', (code) => {
        logger.debug({ code }, 'Browser process exited');
        running = false;
        process = null;
      });

      // Wait for CDP to be ready
      let attempts = 0;
      while (attempts < 30) {
        try {
          await getTargets(debuggingPort);
          running = true;
          logger.info({ port: debuggingPort }, 'Browser launched');
          return;
        } catch {
          await new Promise(r => setTimeout(r, 100));
          attempts++;
        }
      }

      throw new Error('Browser failed to start');
    },

    async newPage() {
      if (!running) throw new Error('Browser not running');

      const target = await createTarget(debuggingPort);
      if (!target.webSocketDebuggerUrl) {
        throw new Error('Failed to create page');
      }

      const cdp = new CDPConnection();
      await cdp.connect(target.webSocketDebuggerUrl);

      // Enable required domains
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Network.enable');

      const page = createPage(cdp, target.id);
      pages.push(page);

      logger.debug({ targetId: target.id }, 'New page created');
      return page;
    },

    async pages() {
      return [...pages];
    },

    async close() {
      // Close all pages
      for (const page of pages) {
        try {
          await page.close();
        } catch {}
      }
      pages.length = 0;

      // Kill browser process
      if (process) {
        process.kill();
        process = null;
      }

      running = false;
      logger.info('Browser closed');
    },

    isRunning() {
      return running;
    },
  };
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/** Quick screenshot of a URL */
export async function screenshotUrl(url: string, options?: { fullPage?: boolean }): Promise<Buffer> {
  const browser = createBrowserService();
  await browser.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(url);
    const screenshot = await page.screenshot({ fullPage: options?.fullPage });
    return screenshot;
  } finally {
    await browser.close();
  }
}

/** Quick page content extraction */
export async function fetchPageContent(url: string): Promise<{ title: string; content: string; url: string }> {
  const browser = createBrowserService();
  await browser.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(url);

    return {
      title: await page.title(),
      content: await page.content(),
      url: page.url(),
    };
  } finally {
    await browser.close();
  }
}
