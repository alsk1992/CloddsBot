/**
 * Canvas/A2UI Host - Clawdbot-style visual workspace
 *
 * Features:
 * - Agent-driven visual UI
 * - Push/reset canvas state
 * - Eval JavaScript in canvas
 * - Screenshot/snapshot via browser
 * - Live preview server
 */

import { EventEmitter } from 'eventemitter3';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger';
import { createBrowserService, BrowserService, BrowserPage } from '../browser';

// =============================================================================
// TYPES
// =============================================================================

export interface CanvasState {
  html?: string;
  css?: string;
  js?: string;
  data?: Record<string, unknown>;
}

export interface CanvasComponent {
  id: string;
  type: 'text' | 'chart' | 'table' | 'image' | 'form' | 'list' | 'card' | 'custom';
  props: Record<string, unknown>;
  children?: CanvasComponent[];
}

export interface CanvasServiceEvents {
  update: (state: CanvasState) => void;
  reset: () => void;
  component: (component: CanvasComponent) => void;
  error: (error: Error) => void;
}

export interface CanvasService {
  /** Push state update */
  push(state: Partial<CanvasState>): void;
  /** Push a component */
  pushComponent(component: CanvasComponent): void;
  /** Reset canvas */
  reset(): void;
  /** Evaluate JS in canvas context */
  eval(code: string): Promise<unknown>;
  /** Take screenshot */
  snapshot(): Promise<Buffer>;
  /** Get current state */
  getState(): CanvasState;
  /** Start preview server */
  startServer(port?: number): Promise<string>;
  /** Stop preview server */
  stopServer(): Promise<void>;
  /** Get server URL */
  getUrl(): string | null;
  /** Subscribe to events */
  on<K extends keyof CanvasServiceEvents>(event: K, fn: CanvasServiceEvents[K]): void;
  off<K extends keyof CanvasServiceEvents>(event: K, fn: CanvasServiceEvents[K]): void;
}

// =============================================================================
// HTML TEMPLATE
// =============================================================================

function generateHtml(state: CanvasState): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Clodds Canvas</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    ${state.css || ''}
  </style>
</head>
<body>
  <div class="container">
    ${state.html || '<p>Canvas ready</p>'}
  </div>
  <script>
    window.canvasData = ${JSON.stringify(state.data || {})};

    // WebSocket for live updates
    const ws = new WebSocket('ws://' + location.host);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'update') {
        if (msg.html) document.querySelector('.container').innerHTML = msg.html;
        if (msg.css) {
          let style = document.querySelector('#dynamic-css');
          if (!style) {
            style = document.createElement('style');
            style.id = 'dynamic-css';
            document.head.appendChild(style);
          }
          style.textContent = msg.css;
        }
        if (msg.js) {
          try { eval(msg.js); } catch(e) { console.error(e); }
        }
        if (msg.data) window.canvasData = msg.data;
      } else if (msg.type === 'eval') {
        try {
          const result = eval(msg.code);
          ws.send(JSON.stringify({ type: 'evalResult', id: msg.id, result }));
        } catch(e) {
          ws.send(JSON.stringify({ type: 'evalResult', id: msg.id, error: e.message }));
        }
      } else if (msg.type === 'reset') {
        document.querySelector('.container').innerHTML = '<p>Canvas ready</p>';
        window.canvasData = {};
      }
    };
    ws.onclose = () => console.log('Canvas disconnected');

    ${state.js || ''}
  </script>
</body>
</html>`;
}

// =============================================================================
// COMPONENT RENDERERS
// =============================================================================

function renderComponent(comp: CanvasComponent): string {
  switch (comp.type) {
    case 'text':
      const tag = comp.props.variant === 'h1' ? 'h1' :
                  comp.props.variant === 'h2' ? 'h2' :
                  comp.props.variant === 'h3' ? 'h3' : 'p';
      return `<${tag} class="canvas-text" style="${comp.props.style || ''}">${comp.props.content || ''}</${tag}>`;

    case 'chart':
      return `<div class="canvas-chart" id="${comp.id}" data-type="${comp.props.chartType || 'line'}" data-values='${JSON.stringify(comp.props.data || [])}'></div>`;

    case 'table':
      const headers = (comp.props.headers as string[]) || [];
      const rows = (comp.props.rows as string[][]) || [];
      return `
        <table class="canvas-table">
          <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>`;

    case 'image':
      return `<img class="canvas-image" src="${comp.props.src}" alt="${comp.props.alt || ''}" style="${comp.props.style || ''}">`;

    case 'form':
      const fields = (comp.props.fields as Array<{ name: string; type: string; label: string }>) || [];
      return `
        <form class="canvas-form" id="${comp.id}">
          ${fields.map(f => `
            <label>${f.label}
              <input type="${f.type || 'text'}" name="${f.name}">
            </label>
          `).join('')}
          <button type="submit">${comp.props.submitText || 'Submit'}</button>
        </form>`;

    case 'list':
      const items = (comp.props.items as string[]) || [];
      const ordered = comp.props.ordered;
      const tag2 = ordered ? 'ol' : 'ul';
      return `<${tag2} class="canvas-list">${items.map(i => `<li>${i}</li>`).join('')}</${tag2}>`;

    case 'card':
      return `
        <div class="canvas-card" style="${comp.props.style || ''}">
          ${comp.props.title ? `<h3>${comp.props.title}</h3>` : ''}
          ${comp.props.content ? `<p>${comp.props.content}</p>` : ''}
          ${comp.children ? comp.children.map(c => renderComponent(c)).join('') : ''}
        </div>`;

    case 'custom':
      return comp.props.html as string || '';

    default:
      return `<div class="canvas-unknown">[Unknown: ${comp.type}]</div>`;
  }
}

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

export function createCanvasService(): CanvasService {
  const emitter = new EventEmitter();
  let currentState: CanvasState = {};
  let components: CanvasComponent[] = [];
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let clients: WebSocket[] = [];
  let serverPort = 0;
  let browser: BrowserService | null = null;
  let page: BrowserPage | null = null;
  let evalCallbacks = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  function broadcast(msg: Record<string, unknown>) {
    const data = JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  const service: CanvasService = {
    push(state) {
      currentState = { ...currentState, ...state };
      emitter.emit('update', currentState);
      broadcast({ type: 'update', ...state });
      logger.debug('Canvas state updated');
    },

    pushComponent(component) {
      components.push(component);
      const html = components.map(c => renderComponent(c)).join('\n');
      this.push({ html });
      emitter.emit('component', component);
    },

    reset() {
      currentState = {};
      components = [];
      emitter.emit('reset');
      broadcast({ type: 'reset' });
      logger.debug('Canvas reset');
    },

    async eval(code) {
      // If we have connected clients, eval via WebSocket
      if (clients.length > 0) {
        const id = `eval_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        return new Promise((resolve, reject) => {
          evalCallbacks.set(id, { resolve, reject });
          broadcast({ type: 'eval', id, code });

          // Timeout after 10s
          setTimeout(() => {
            if (evalCallbacks.has(id)) {
              evalCallbacks.delete(id);
              reject(new Error('Eval timeout'));
            }
          }, 10000);
        });
      }

      // Fallback: use headless browser
      if (!browser) {
        browser = createBrowserService();
        await browser.launch({ headless: true });
        page = await browser.newPage();
        const url = this.getUrl();
        if (url) await page.goto(url);
      }

      if (page) {
        return page.evaluate(code);
      }

      throw new Error('No canvas context available');
    },

    async snapshot() {
      // Ensure browser is running
      if (!browser) {
        browser = createBrowserService();
        await browser.launch({ headless: true });
      }

      if (!page) {
        page = await browser.newPage();
        await page.setViewport(1200, 800);
      }

      // Navigate to canvas if server running, otherwise render directly
      const url = this.getUrl();
      if (url) {
        await page.goto(url);
        // Wait for render
        await new Promise(r => setTimeout(r, 500));
      } else {
        // Render HTML directly
        const html = generateHtml(currentState);
        await page.evaluate(`document.documentElement.innerHTML = ${JSON.stringify(html)}`);
      }

      const screenshot = await page.screenshot({ fullPage: true });
      logger.debug('Canvas snapshot taken');
      return screenshot;
    },

    getState() {
      return { ...currentState };
    },

    async startServer(port = 3456) {
      if (server) {
        return `http://localhost:${serverPort}`;
      }

      return new Promise((resolve, reject) => {
        server = createServer((req: IncomingMessage, res: ServerResponse) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(generateHtml(currentState));
        });

        wss = new WebSocketServer({ server });

        wss.on('connection', (ws) => {
          clients.push(ws);
          logger.debug('Canvas client connected');

          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'evalResult' && msg.id) {
                const callback = evalCallbacks.get(msg.id);
                if (callback) {
                  evalCallbacks.delete(msg.id);
                  if (msg.error) {
                    callback.reject(new Error(msg.error));
                  } else {
                    callback.resolve(msg.result);
                  }
                }
              }
            } catch {}
          });

          ws.on('close', () => {
            clients = clients.filter(c => c !== ws);
            logger.debug('Canvas client disconnected');
          });
        });

        server.listen(port, () => {
          serverPort = port;
          const url = `http://localhost:${port}`;
          logger.info({ url }, 'Canvas server started');
          resolve(url);
        });

        server.on('error', (err) => {
          logger.error({ error: err }, 'Canvas server error');
          reject(err);
        });
      });
    },

    async stopServer() {
      if (wss) {
        wss.close();
        wss = null;
      }

      if (server) {
        server.close();
        server = null;
      }

      if (browser) {
        await browser.close();
        browser = null;
        page = null;
      }

      clients = [];
      serverPort = 0;
      logger.info('Canvas server stopped');
    },

    getUrl() {
      return serverPort > 0 ? `http://localhost:${serverPort}` : null;
    },

    on(event, fn) {
      emitter.on(event, fn);
    },

    off(event, fn) {
      emitter.off(event, fn);
    },
  };

  return service;
}

// =============================================================================
// CONVENIENCE - Pre-built components
// =============================================================================

export const components = {
  text(content: string, variant?: 'h1' | 'h2' | 'h3' | 'p'): CanvasComponent {
    return { id: `text_${Date.now()}`, type: 'text', props: { content, variant } };
  },

  table(headers: string[], rows: string[][]): CanvasComponent {
    return { id: `table_${Date.now()}`, type: 'table', props: { headers, rows } };
  },

  list(items: string[], ordered = false): CanvasComponent {
    return { id: `list_${Date.now()}`, type: 'list', props: { items, ordered } };
  },

  image(src: string, alt?: string): CanvasComponent {
    return { id: `image_${Date.now()}`, type: 'image', props: { src, alt } };
  },

  card(title: string, content: string): CanvasComponent {
    return { id: `card_${Date.now()}`, type: 'card', props: { title, content } };
  },

  chart(chartType: 'line' | 'bar' | 'pie', data: unknown[]): CanvasComponent {
    return { id: `chart_${Date.now()}`, type: 'chart', props: { chartType, data } };
  },

  form(fields: Array<{ name: string; type?: string; label: string }>, submitText = 'Submit'): CanvasComponent {
    return { id: `form_${Date.now()}`, type: 'form', props: { fields, submitText } };
  },

  custom(html: string): CanvasComponent {
    return { id: `custom_${Date.now()}`, type: 'custom', props: { html } };
  },
};
