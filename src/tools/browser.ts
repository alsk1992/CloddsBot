/**
 * Browser Tool - Clawdbot-style browser automation via CDP
 *
 * Features:
 * - Launch and control Chrome/Chromium
 * - Navigate, click, type, screenshot
 * - Multiple browser profiles
 * - Page content extraction
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { logger } from '../utils/logger';

/** Browser configuration */
export interface BrowserConfig {
  /** Enable browser tool */
  enabled: boolean;
  /** Path to Chrome/Chromium executable */
  executablePath?: string;
  /** User data directory for profiles */
  userDataDir?: string;
  /** Profile name for persistent storage */
  profile?: string;
  /** Default viewport width */
  viewportWidth?: number;
  /** Default viewport height */
  viewportHeight?: number;
  /** Headless mode */
  headless?: boolean;
  /** CDP port */
  cdpPort?: number;
  /** Initial wait for CDP readiness (ms) */
  cdpWaitMs?: number;
  /** Max time to wait for CDP readiness (ms) */
  cdpMaxWaitMs?: number;
  /** Poll interval while waiting for CDP (ms) */
  cdpPollMs?: number;
}

/** Page info */
export interface PageInfo {
  url: string;
  title: string;
  /** Text content of the page */
  content?: string;
}

/** Screenshot options */
export interface ScreenshotOptions {
  /** Full page screenshot */
  fullPage?: boolean;
  /** Output format */
  format?: 'png' | 'jpeg' | 'webp';
  /** Quality (0-100) for jpeg/webp */
  quality?: number;
  /** Clip region */
  clip?: { x: number; y: number; width: number; height: number };
}

/** Click options */
export interface ClickOptions {
  /** Button to click */
  button?: 'left' | 'right' | 'middle';
  /** Number of clicks */
  clickCount?: number;
  /** Delay between clicks in ms */
  delay?: number;
}

/** Cookie representation (CDP-compatible subset) */
export interface BrowserCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  url?: string;
}

/** CDP connection */
interface CDPConnection {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
  isConnected(): boolean;
}

export interface BrowserTool {
  /** Launch browser */
  launch(): Promise<void>;

  /** Close browser */
  close(): Promise<void>;

  /** Check if browser is running */
  isRunning(): boolean;

  /** Navigate to URL */
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' }): Promise<PageInfo>;

  /** Get current page info */
  getPageInfo(): Promise<PageInfo>;

  /** Take screenshot */
  screenshot(options?: ScreenshotOptions): Promise<Buffer>;

  /** Click on element by selector */
  click(selector: string, options?: ClickOptions): Promise<void>;

  /** Type text into element */
  type(selector: string, text: string, options?: { delay?: number }): Promise<void>;

  /** Evaluate JavaScript in page */
  evaluate<T>(script: string): Promise<T>;

  /** Wait for selector */
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;

  /** Get page content as text */
  getContent(): Promise<string>;

  /** Get page HTML */
  getHTML(): Promise<string>;

  /** Scroll page */
  scroll(options: { x?: number; y?: number } | 'top' | 'bottom'): Promise<void>;

  /** Go back */
  goBack(): Promise<void>;

  /** Go forward */
  goForward(): Promise<void>;

  /** Reload page */
  reload(): Promise<void>;

  /** Get cookies for the current page (or specific URLs) */
  getCookies(urls?: string[]): Promise<BrowserCookie[]>;

  /** Set cookies */
  setCookies(cookies: BrowserCookie[]): Promise<void>;

  /** Clear all browser cookies */
  clearCookies(): Promise<void>;
}

const DEFAULT_CONFIG: Required<BrowserConfig> = {
  enabled: true,
  executablePath: '',
  userDataDir: path.join(os.homedir(), '.clodds', 'browser'),
  profile: 'default',
  viewportWidth: 1280,
  viewportHeight: 720,
  headless: true,
  cdpPort: 9222,
  cdpWaitMs: 1000,
  cdpMaxWaitMs: 15_000,
  cdpPollMs: 200,
};

/**
 * Find Chrome/Chromium executable
 */
function findChrome(): string | null {
  const platform = process.platform;

  const paths: string[] = [];

  if (platform === 'darwin') {
    paths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
    );
  } else if (platform === 'linux') {
    paths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    );
  } else if (platform === 'win32') {
    paths.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    );
  }

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Simple CDP client using WebSocket
 */
async function connectCDP(port: number, onDisconnect?: (reason: string) => void): Promise<CDPConnection> {
  const WebSocket = (await import('ws')).default;

  // Get WebSocket URL from CDP
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  const data = await response.json() as { webSocketDebuggerUrl: string };
  const wsUrl = data.webSocketDebuggerUrl;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let messageId = 0;
    let connected = false;
    let resolved = false;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

    ws.on('open', () => {
      connected = true;
      resolved = true;
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++messageId;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          ws.close();
        },
        isConnected() {
          return connected && ws.readyState === ws.OPEN;
        },
      });
    });

    ws.on('message', (data: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // skip malformed CDP messages
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      }
    });

    ws.on('close', () => {
      connected = false;
      for (const { reject } of pending.values()) {
        reject(new Error('CDP connection closed'));
      }
      pending.clear();
      onDisconnect?.('close');
    });

    ws.on('error', (err: Error) => {
      connected = false;
      onDisconnect?.(err.message || 'error');
      // If not yet connected, surface the error to the caller.
      if (!resolved) {
        reject(err);
      }
    });
  });
}

async function waitForCdpReady(
  port: number,
  initialWaitMs: number,
  maxWaitMs: number,
  pollMs: number
): Promise<void> {
  const start = Date.now();

  if (initialWaitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, initialWaitMs));
  }

  let lastError: unknown = null;
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
      lastError = new Error(`CDP not ready: ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for CDP on port ${port}`);
}

export function createBrowserTool(configInput?: Partial<BrowserConfig>): BrowserTool {
  const config: Required<BrowserConfig> = { ...DEFAULT_CONFIG, ...configInput };
  const profileRoot = path.join(config.userDataDir, 'profiles', config.profile);

  let browserProcess: ChildProcess | null = null;
  let cdp: CDPConnection | null = null;
  let reconnectPromise: Promise<CDPConnection> | null = null;

  const handleDisconnect = (reason: string) => {
    logger.warn({ reason }, 'CDP disconnected');
    cdp = null;
    // Best-effort background reconnect if the browser is still running.
    if (browserProcess && !reconnectPromise) {
      void ensureCdp();
    }
  };

  async function establishCdpConnection(): Promise<CDPConnection> {
    const conn = await connectCDP(config.cdpPort, handleDisconnect);
    await conn.send('Page.enable');
    await conn.send('Runtime.enable');
    await conn.send('Network.enable');
    return conn;
  }

  async function ensureCdp(): Promise<CDPConnection> {
    if (cdp && cdp.isConnected()) {
      return cdp;
    }
    if (!browserProcess) {
      throw new Error('Browser not running');
    }
    if (reconnectPromise) {
      return reconnectPromise;
    }

    reconnectPromise = (async () => {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          const conn = await establishCdpConnection();
          cdp = conn;
          logger.info({ attempt }, 'CDP reconnected');
          return conn;
        } catch (error) {
          lastError = error;
          const backoff = Math.min(2000, 200 * attempt);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Failed to reconnect CDP');
    })().finally(() => {
      reconnectPromise = null;
    });

    return reconnectPromise;
  }

  // Find Chrome if not specified
  if (!config.executablePath) {
    const found = findChrome();
    if (found) {
      config.executablePath = found;
    }
  }

  // Ensure profile directory exists (persistent cookies/localStorage per profile)
  if (!fs.existsSync(profileRoot)) {
    fs.mkdirSync(profileRoot, { recursive: true });
  }

  const tool: BrowserTool = {
    async launch() {
      if (browserProcess) {
        logger.warn('Browser already running');
        return;
      }

      if (!config.executablePath) {
        throw new Error('Chrome/Chromium not found. Set executablePath in config.');
      }

      logger.info({ executable: config.executablePath }, 'Launching browser');

      const args = [
        `--remote-debugging-port=${config.cdpPort}`,
        `--user-data-dir=${profileRoot}`,
        `--window-size=${config.viewportWidth},${config.viewportHeight}`,
        '--no-first-run',
        '--no-default-browser-check',
      ];

      if (config.headless) {
        args.push('--headless=new');
      }

      browserProcess = spawn(config.executablePath, args, {
        stdio: 'ignore',
        detached: false,
      });

      browserProcess.on('exit', (code) => {
        logger.info({ code }, 'Browser exited');
        browserProcess = null;
        cdp = null;
      });

      // Wait for CDP to be ready
      await waitForCdpReady(
        config.cdpPort,
        config.cdpWaitMs,
        config.cdpMaxWaitMs,
        config.cdpPollMs
      );

      // Connect to CDP
      cdp = await establishCdpConnection();

      logger.info('Browser launched and CDP connected');
    },

    async close() {
      if (cdp) {
        cdp.close();
        cdp = null;
      }

      if (browserProcess) {
        browserProcess.kill();
        browserProcess = null;
      }

      logger.info('Browser closed');
    },

    isRunning() {
      return browserProcess !== null && cdp !== null;
    },

    async goto(url, options = {}) {
      const c = await ensureCdp();

      logger.debug({ url }, 'Navigating to URL');

      await c.send('Page.navigate', { url });

      // Wait for load/DOM readiness (polling readyState).
      const timeoutMs = 30_000;
      const start = Date.now();
      const targetState = options.waitUntil === 'load' ? 'complete' : 'interactive';
      while (Date.now() - start < timeoutMs) {
        const state = await this.evaluate<string>('document.readyState');
        if (state === targetState || state === 'complete') break;
        await new Promise((r) => setTimeout(r, 100));
      }

      return this.getPageInfo();
    },

    async getPageInfo() {
      const c = await ensureCdp();

      const result = await c.send('Runtime.evaluate', {
        expression: 'JSON.stringify({ url: location.href, title: document.title })',
        returnByValue: true,
      }) as { result: { value: string } };

      return JSON.parse(result.result.value);
    },

    async screenshot(options = {}) {
      const c = await ensureCdp();

      const params: Record<string, unknown> = {
        format: options.format || 'png',
      };

      if (options.quality) {
        params.quality = options.quality;
      }

      if (options.fullPage) {
        // Get full page dimensions
        const metrics = await c.send('Page.getLayoutMetrics') as {
          contentSize: { width: number; height: number };
        };
        params.clip = {
          x: 0,
          y: 0,
          width: metrics.contentSize.width,
          height: metrics.contentSize.height,
          scale: 1,
        };
      } else if (options.clip) {
        params.clip = { ...options.clip, scale: 1 };
      }

      const result = await c.send('Page.captureScreenshot', params) as {
        data: string;
      };

      return Buffer.from(result.data, 'base64');
    },

    async click(selector, options = {}) {
      const c = await ensureCdp();

      // Find element and get coordinates
      const result = await c.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
          })()
        `,
        returnByValue: true,
      }) as { result: { value: { x: number; y: number } | null } };

      if (!result.result.value) {
        throw new Error(`Element not found: ${selector}`);
      }

      const { x, y } = result.result.value;

      await c.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: options.button || 'left',
        clickCount: options.clickCount || 1,
      });

      await c.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: options.button || 'left',
      });
    },

    async type(selector, text, options = {}) {
      const c = await ensureCdp();

      // Focus element
      await c.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
      });

      // Type text
      for (const char of text) {
        await c.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char,
        });
        await c.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          text: char,
        });

        if (options.delay) {
          await new Promise((r) => setTimeout(r, options.delay));
        }
      }
    },

    async evaluate<T>(script: string): Promise<T> {
      const c = await ensureCdp();

      const result = await c.send('Runtime.evaluate', {
        expression: script,
        returnByValue: true,
      }) as { result: { value: T } };

      return result.result.value;
    },

    async waitForSelector(selector, options = {}) {
      await ensureCdp();

      const timeout = options.timeout || 30000;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        const found = await this.evaluate<boolean>(
          `!!document.querySelector(${JSON.stringify(selector)})`
        );

        if (found) return;

        await new Promise((r) => setTimeout(r, 100));
      }

      throw new Error(`Timeout waiting for selector: ${selector}`);
    },

    async getContent() {
      await ensureCdp();
      return this.evaluate<string>('document.body.innerText');
    },

    async getHTML() {
      await ensureCdp();
      return this.evaluate<string>('document.documentElement.outerHTML');
    },

    async scroll(options) {
      await ensureCdp();

      if (options === 'top') {
        await this.evaluate('window.scrollTo(0, 0)');
      } else if (options === 'bottom') {
        await this.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      } else {
        await this.evaluate(`window.scrollTo(${options.x || 0}, ${options.y || 0})`);
      }
    },

    async goBack() {
      await ensureCdp();
      await this.evaluate('history.back()');
    },

    async goForward() {
      await ensureCdp();
      await this.evaluate('history.forward()');
    },

    async reload() {
      const c = await ensureCdp();
      await c.send('Page.reload');
    },

    async getCookies(urls?: string[]) {
      const c = await ensureCdp();

      const pageUrl = await this.evaluate<string>('location.href');
      const params = urls && urls.length > 0 ? { urls } : { urls: [pageUrl] };
      const result = (await c.send('Network.getCookies', params)) as {
        cookies?: BrowserCookie[];
      };
      return result.cookies || [];
    },

    async setCookies(cookies: BrowserCookie[]) {
      const c = await ensureCdp();
      if (cookies.length === 0) return;

      await c.send('Network.setCookies', { cookies });
    },

    async clearCookies() {
      const c = await ensureCdp();
      await c.send('Network.clearBrowserCookies');
    },
  };

  return tool;
}
