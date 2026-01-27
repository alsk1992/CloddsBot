/**
 * Web Module - Clawdbot-style web interface
 *
 * Features:
 * - HTTP server with WebSocket support
 * - WebChat interface
 * - Control panel UI
 * - REST API endpoints
 * - Real-time updates
 * - Session management
 */

import * as http from 'http';
import * as https from 'https';
import { WebSocket, WebSocketServer } from 'ws';
import { URL } from 'url';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface ServerConfig {
  port?: number;
  host?: string;
  ssl?: {
    cert: string;
    key: string;
  };
  cors?: boolean | string[];
  auth?: AuthConfig;
}

export interface AuthConfig {
  type: 'basic' | 'bearer' | 'none';
  users?: Record<string, string>;
  tokens?: string[];
}

export interface WebSession {
  id: string;
  userId?: string;
  createdAt: Date;
  lastActivity: Date;
  data: Record<string, unknown>;
}

export interface ApiRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: (req: ApiRequest, res: ApiResponse) => Promise<void> | void;
  auth?: boolean;
}

export interface ApiRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  session?: WebSession;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(data: unknown): void;
  text(data: string): void;
  html(data: string): void;
  send(data: Buffer | string): void;
  redirect(url: string): void;
  setHeader(name: string, value: string): ApiResponse;
}

export interface WebMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = 'localhost';

// =============================================================================
// SESSION MANAGER
// =============================================================================

export class SessionManager {
  private sessions: Map<string, WebSession> = new Map();
  private timeout: number;

  constructor(timeoutMs = 30 * 60 * 1000) {
    this.timeout = timeoutMs;

    // Cleanup expired sessions every minute
    setInterval(() => this.cleanup(), 60000);
  }

  create(userId?: string): WebSession {
    const session: WebSession = {
      id: this.generateId(),
      userId,
      createdAt: new Date(),
      lastActivity: new Date(),
      data: {},
    };

    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): WebSession | undefined {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = new Date();
    }
    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity.getTime() > this.timeout) {
        this.sessions.delete(id);
      }
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

// =============================================================================
// WEB SERVER
// =============================================================================

export class WebServer extends EventEmitter {
  private server: http.Server | https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private config: ServerConfig;
  private routes: ApiRoute[] = [];
  private sessions: SessionManager;
  private clients: Map<string, WebSocket> = new Map();

  constructor(config: ServerConfig = {}) {
    super();
    this.config = {
      port: config.port ?? DEFAULT_PORT,
      host: config.host ?? DEFAULT_HOST,
      cors: config.cors ?? true,
      auth: config.auth ?? { type: 'none' },
      ...config,
    };
    this.sessions = new SessionManager();
  }

  /** Add an API route */
  route(route: ApiRoute): this {
    this.routes.push(route);
    return this;
  }

  /** Add GET route */
  get(path: string, handler: ApiRoute['handler'], auth = false): this {
    return this.route({ method: 'GET', path, handler, auth });
  }

  /** Add POST route */
  post(path: string, handler: ApiRoute['handler'], auth = false): this {
    return this.route({ method: 'POST', path, handler, auth });
  }

  /** Add PUT route */
  put(path: string, handler: ApiRoute['handler'], auth = false): this {
    return this.route({ method: 'PUT', path, handler, auth });
  }

  /** Add DELETE route */
  delete(path: string, handler: ApiRoute['handler'], auth = false): this {
    return this.route({ method: 'DELETE', path, handler, auth });
  }

  /** Start the server */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      // Create HTTP or HTTPS server
      if (this.config.ssl) {
        this.server = https.createServer({
          cert: readFileSync(this.config.ssl.cert),
          key: readFileSync(this.config.ssl.key),
        }, (req, res) => this.handleRequest(req, res));
      } else {
        this.server = http.createServer((req, res) => this.handleRequest(req, res));
      }

      // Create WebSocket server
      this.wss = new WebSocketServer({ server: this.server });
      this.wss.on('connection', (ws, req) => this.handleWebSocket(ws, req));

      // Start listening
      this.server.listen(this.config.port, this.config.host, () => {
        const protocol = this.config.ssl ? 'https' : 'http';
        logger.info({
          url: `${protocol}://${this.config.host}:${this.config.port}`,
        }, 'Web server started');
        resolve();
      });
    });
  }

  /** Stop the server */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all WebSocket connections
      for (const [id, client] of this.clients) {
        client.close();
      }
      this.clients.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      // Close HTTP server
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          logger.info('Web server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /** Broadcast message to all WebSocket clients */
  broadcast(message: WebMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /** Send message to specific client */
  sendTo(clientId: string, message: WebMessage): void {
    const client = this.clients.get(clientId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  /** Get session manager */
  getSessionManager(): SessionManager {
    return this.sessions;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const method = req.method || 'GET';

    // CORS headers
    if (this.config.cors) {
      const origin = this.config.cors === true ? '*' :
        (Array.isArray(this.config.cors) && this.config.cors.includes(req.headers.origin || ''))
          ? req.headers.origin : '';

      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }

    // Handle OPTIONS
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Find matching route
    const route = this.findRoute(method, url.pathname);

    if (!route) {
      // Try static files
      if (method === 'GET') {
        const served = await this.serveStatic(url.pathname, res);
        if (served) return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Auth check
    if (route.auth && this.config.auth?.type !== 'none') {
      const authResult = this.checkAuth(req);
      if (!authResult.valid) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: authResult.error }));
        return;
      }
    }

    // Parse body
    let body: unknown;
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      body = await this.parseBody(req);
    }

    // Build API request
    const apiReq: ApiRequest = {
      method,
      path: url.pathname,
      params: route.params || {},
      query: Object.fromEntries(url.searchParams),
      body,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || ''])
      ),
    };

    // Build API response
    let statusCode = 200;
    const headers: Record<string, string> = {};

    const apiRes: ApiResponse = {
      status(code) {
        statusCode = code;
        return apiRes;
      },
      setHeader(name, value) {
        headers[name] = value;
        return apiRes;
      },
      json(data) {
        headers['Content-Type'] = 'application/json';
        res.writeHead(statusCode, headers);
        res.end(JSON.stringify(data));
      },
      text(data) {
        headers['Content-Type'] = 'text/plain';
        res.writeHead(statusCode, headers);
        res.end(data);
      },
      html(data) {
        headers['Content-Type'] = 'text/html';
        res.writeHead(statusCode, headers);
        res.end(data);
      },
      send(data) {
        res.writeHead(statusCode, headers);
        res.end(data);
      },
      redirect(redirectUrl) {
        res.writeHead(302, { Location: redirectUrl });
        res.end();
      },
    };

    try {
      await route.handler(apiReq, apiRes);
    } catch (error) {
      logger.error({ error, path: url.pathname }, 'Request handler error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private handleWebSocket(ws: WebSocket, req: http.IncomingMessage): void {
    const clientId = this.sessions.create().id;
    this.clients.set(clientId, ws);

    logger.debug({ clientId }, 'WebSocket client connected');
    this.emit('connection', { clientId, ws });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      payload: { clientId },
      timestamp: Date.now(),
    }));

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WebMessage;
        this.emit('message', { clientId, message });
      } catch {
        logger.warn({ clientId }, 'Invalid WebSocket message');
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      logger.debug({ clientId }, 'WebSocket client disconnected');
      this.emit('disconnection', { clientId });
    });

    ws.on('error', (error) => {
      logger.error({ clientId, error }, 'WebSocket error');
    });
  }

  private findRoute(method: string, path: string): (ApiRoute & { params?: Record<string, string> }) | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;

      // Simple path matching with params
      const routeParts = route.path.split('/');
      const pathParts = path.split('/');

      if (routeParts.length !== pathParts.length) continue;

      const params: Record<string, string> = {};
      let match = true;

      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          params[routeParts[i].slice(1)] = pathParts[i];
        } else if (routeParts[i] !== pathParts[i]) {
          match = false;
          break;
        }
      }

      if (match) {
        return { ...route, params };
      }
    }

    return null;
  }

  private async parseBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        } else {
          resolve(body);
        }
      });
    });
  }

  private checkAuth(req: http.IncomingMessage): { valid: boolean; error?: string } {
    const auth = this.config.auth!;
    const header = req.headers.authorization;

    if (auth.type === 'basic') {
      if (!header?.startsWith('Basic ')) {
        return { valid: false, error: 'Basic auth required' };
      }

      const credentials = Buffer.from(header.slice(6), 'base64').toString();
      const [username, password] = credentials.split(':');

      if (auth.users && auth.users[username] === password) {
        return { valid: true };
      }

      return { valid: false, error: 'Invalid credentials' };
    }

    if (auth.type === 'bearer') {
      if (!header?.startsWith('Bearer ')) {
        return { valid: false, error: 'Bearer token required' };
      }

      const token = header.slice(7);
      if (auth.tokens?.includes(token)) {
        return { valid: true };
      }

      return { valid: false, error: 'Invalid token' };
    }

    return { valid: true };
  }

  private async serveStatic(path: string, res: http.ServerResponse): Promise<boolean> {
    // Serve built-in chat interface
    if (path === '/' || path === '/chat') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(CHAT_HTML);
      return true;
    }

    return false;
  }
}

// =============================================================================
// BUILT-IN CHAT HTML
// =============================================================================

const CHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clodds Chat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #16213e;
      padding: 1rem;
      border-bottom: 1px solid #0f3460;
    }
    header h1 { font-size: 1.25rem; }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
    }
    .message {
      max-width: 80%;
      margin-bottom: 0.5rem;
      padding: 0.75rem 1rem;
      border-radius: 12px;
      line-height: 1.4;
    }
    .message.user {
      background: #0f3460;
      margin-left: auto;
    }
    .message.assistant {
      background: #1f4068;
    }
    .message pre {
      background: #0a0a1a;
      padding: 0.5rem;
      border-radius: 6px;
      overflow-x: auto;
      margin: 0.5rem 0;
    }
    #input-area {
      padding: 1rem;
      background: #16213e;
      border-top: 1px solid #0f3460;
      display: flex;
      gap: 0.5rem;
    }
    #input {
      flex: 1;
      padding: 0.75rem 1rem;
      border: none;
      border-radius: 8px;
      background: #1a1a2e;
      color: #eee;
      font-size: 1rem;
    }
    #input:focus { outline: 2px solid #e94560; }
    button {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 8px;
      background: #e94560;
      color: white;
      font-size: 1rem;
      cursor: pointer;
    }
    button:hover { background: #ff6b6b; }
    #status {
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      color: #888;
    }
    .connected { color: #4ecdc4 !important; }
  </style>
</head>
<body>
  <header>
    <h1>Clodds</h1>
    <div id="status">Connecting...</div>
  </header>
  <div id="messages"></div>
  <div id="input-area">
    <input type="text" id="input" placeholder="Type a message..." autocomplete="off">
    <button onclick="send()">Send</button>
  </div>
  <script>
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    const status = document.getElementById('status');
    let ws;

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host);

      ws.onopen = () => {
        status.textContent = 'Connected';
        status.className = 'connected';
      };

      ws.onclose = () => {
        status.textContent = 'Disconnected - Reconnecting...';
        status.className = '';
        setTimeout(connect, 3000);
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'response') {
          addMessage(msg.payload.content, 'assistant');
        }
      };
    }

    function addMessage(content, type) {
      const div = document.createElement('div');
      div.className = 'message ' + type;
      div.innerHTML = formatMessage(content);
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function formatMessage(text) {
      return text
        .replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\n/g, '<br>');
    }

    function send() {
      const text = input.value.trim();
      if (!text || ws.readyState !== WebSocket.OPEN) return;

      addMessage(text, 'user');
      ws.send(JSON.stringify({ type: 'message', payload: { content: text } }));
      input.value = '';
    }

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') send();
    });

    connect();
  </script>
</body>
</html>`;

// =============================================================================
// FACTORY
// =============================================================================

/** Create and configure a web server */
export function createWebServer(config?: ServerConfig): WebServer {
  return new WebServer(config);
}

/** Quick start a web chat server */
export async function startChat(port = 3000): Promise<WebServer> {
  const server = new WebServer({ port });

  // Add default API routes
  server.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  server.get('/api/status', (req, res) => {
    res.json({
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  });

  await server.start();
  return server;
}
