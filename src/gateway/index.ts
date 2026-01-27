/**
 * Gateway Module - Clawdbot-style WebSocket gateway protocol
 *
 * Features:
 * - WebSocket server for remote connections
 * - Binary and JSON message support
 * - Connection authentication
 * - Heartbeat/keepalive
 * - Message routing
 * - Session management
 */

import { WebSocket, WebSocketServer, RawData } from 'ws';
import * as http from 'http';
import * as https from 'https';
import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface GatewayConfig {
  port?: number;
  host?: string;
  path?: string;
  ssl?: { cert: string; key: string };
  auth?: {
    type: 'token' | 'basic' | 'none';
    tokens?: string[];
    users?: Record<string, string>;
  };
  heartbeatInterval?: number;
  maxClients?: number;
}

export interface GatewayClient {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  metadata: Record<string, unknown>;
  connectedAt: Date;
  lastHeartbeat: Date;
}

export interface GatewayMessage {
  op: number;
  d?: unknown;
  t?: string;
  s?: number;
}

export const GatewayOpcodes = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 3,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

// =============================================================================
// GATEWAY SERVER
// =============================================================================

export class GatewayServer extends EventEmitter {
  private config: GatewayConfig;
  private server: http.Server | https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, GatewayClient> = new Map();
  private heartbeatChecker: NodeJS.Timeout | null = null;
  private sequence = 0;

  constructor(config: GatewayConfig = {}) {
    super();
    this.config = {
      port: config.port ?? 8080,
      host: config.host ?? '0.0.0.0',
      path: config.path ?? '/gateway',
      heartbeatInterval: config.heartbeatInterval ?? 45000,
      maxClients: config.maxClients ?? 1000,
      auth: config.auth ?? { type: 'none' },
      ...config,
    };
  }

  /** Start the gateway server */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      // Create HTTP(S) server
      if (this.config.ssl) {
        const fs = require('fs');
        this.server = https.createServer({
          cert: fs.readFileSync(this.config.ssl.cert),
          key: fs.readFileSync(this.config.ssl.key),
        });
      } else {
        this.server = http.createServer();
      }

      // Create WebSocket server
      this.wss = new WebSocketServer({
        server: this.server,
        path: this.config.path,
      });

      this.wss.on('connection', (socket, request) => {
        this.handleConnection(socket, request);
      });

      // Start heartbeat checker
      this.heartbeatChecker = setInterval(() => {
        this.checkHeartbeats();
      }, this.config.heartbeatInterval);

      // Start listening
      this.server.listen(this.config.port, this.config.host, () => {
        const protocol = this.config.ssl ? 'wss' : 'ws';
        logger.info({
          url: `${protocol}://${this.config.host}:${this.config.port}${this.config.path}`,
        }, 'Gateway server started');
        resolve();
      });
    });
  }

  /** Stop the gateway server */
  async stop(): Promise<void> {
    if (this.heartbeatChecker) {
      clearInterval(this.heartbeatChecker);
      this.heartbeatChecker = null;
    }

    for (const client of this.clients.values()) {
      this.send(client, { op: GatewayOpcodes.RECONNECT });
      client.socket.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          if (this.server) {
            this.server.close(() => {
              logger.info('Gateway server stopped');
              resolve();
            });
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /** Send message to a client */
  send(client: GatewayClient, message: GatewayMessage): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  /** Broadcast to all authenticated clients */
  broadcast(message: GatewayMessage, filter?: (client: GatewayClient) => boolean): void {
    for (const client of this.clients.values()) {
      if (client.authenticated && (!filter || filter(client))) {
        this.send(client, message);
      }
    }
  }

  /** Dispatch an event to all clients */
  dispatch(event: string, data: unknown): void {
    this.sequence++;
    this.broadcast({
      op: GatewayOpcodes.DISPATCH,
      t: event,
      d: data,
      s: this.sequence,
    });
  }

  /** Get connected clients */
  getClients(): GatewayClient[] {
    return Array.from(this.clients.values());
  }

  /** Get client by ID */
  getClient(id: string): GatewayClient | undefined {
    return this.clients.get(id);
  }

  /** Disconnect a client */
  disconnect(id: string, code = 1000, reason = ''): void {
    const client = this.clients.get(id);
    if (client) {
      client.socket.close(code, reason);
      this.clients.delete(id);
    }
  }

  private handleConnection(socket: WebSocket, request: http.IncomingMessage): void {
    if (this.clients.size >= this.config.maxClients!) {
      socket.close(1013, 'Server at capacity');
      return;
    }

    const clientId = this.generateClientId();
    const client: GatewayClient = {
      id: clientId,
      socket,
      authenticated: this.config.auth?.type === 'none',
      metadata: {},
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
    };

    this.clients.set(clientId, client);
    logger.debug({ clientId }, 'Gateway client connected');

    this.send(client, {
      op: GatewayOpcodes.HELLO,
      d: {
        heartbeat_interval: this.config.heartbeatInterval,
        session_id: clientId,
      },
    });

    socket.on('message', (data) => {
      this.handleMessage(client, data);
    });

    socket.on('close', (code, reason) => {
      this.clients.delete(clientId);
      this.emit('disconnect', { clientId, code, reason: reason.toString() });
      logger.debug({ clientId, code }, 'Gateway client disconnected');
    });

    socket.on('error', (error) => {
      logger.error({ clientId, error }, 'Gateway client error');
    });

    this.emit('connection', client);
  }

  private handleMessage(client: GatewayClient, data: RawData): void {
    try {
      const message = JSON.parse(data.toString()) as GatewayMessage;

      switch (message.op) {
        case GatewayOpcodes.HEARTBEAT:
          client.lastHeartbeat = new Date();
          this.send(client, { op: GatewayOpcodes.HEARTBEAT_ACK });
          break;

        case GatewayOpcodes.IDENTIFY:
          this.handleIdentify(client, message.d as {
            token?: string;
            username?: string;
            password?: string;
          });
          break;

        case GatewayOpcodes.RESUME:
          client.authenticated = true;
          this.emit('resume', { client, data: message.d });
          break;

        case GatewayOpcodes.DISPATCH:
          if (client.authenticated) {
            this.emit('message', {
              client,
              event: message.t,
              data: message.d,
            });
          }
          break;
      }
    } catch (error) {
      logger.warn({ clientId: client.id, error }, 'Invalid gateway message');
    }
  }

  private handleIdentify(client: GatewayClient, data: {
    token?: string;
    username?: string;
    password?: string;
  } = {}): void {
    let authenticated = false;

    switch (this.config.auth?.type) {
      case 'none':
        authenticated = true;
        break;
      case 'token':
        authenticated = this.config.auth.tokens?.includes(data.token || '') ?? false;
        break;
      case 'basic':
        if (data.username && data.password) {
          authenticated = this.config.auth.users?.[data.username] === data.password;
        }
        break;
    }

    if (authenticated) {
      client.authenticated = true;
      client.metadata = { ...data, password: undefined };
      this.emit('identify', client);
      this.dispatch('READY', { session_id: client.id });
    } else {
      this.send(client, { op: GatewayOpcodes.INVALID_SESSION, d: false });
      client.socket.close(4001, 'Authentication failed');
    }
  }

  private checkHeartbeats(): void {
    const timeout = this.config.heartbeatInterval! * 2;
    const now = Date.now();

    for (const [id, client] of this.clients) {
      if (now - client.lastHeartbeat.getTime() > timeout) {
        logger.debug({ clientId: id }, 'Client heartbeat timeout');
        client.socket.close(4009, 'Heartbeat timeout');
        this.clients.delete(id);
      }
    }
  }

  private generateClientId(): string {
    return randomBytes(16).toString('hex');
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createGatewayServer(config?: GatewayConfig): GatewayServer {
  return new GatewayServer(config);
}

/** Create gateway from full application config (for CLI compatibility) */
export async function createGateway(config: { gateway: { port?: number; auth?: { token?: string; type?: string }; host?: string; path?: string } }): Promise<GatewayServer> {
  // Normalize the config with defaults
  const gw = config.gateway;

  // Convert simple auth config to full auth config
  let auth: GatewayConfig['auth'] = { type: 'none' };
  if (gw.auth?.token) {
    auth = { type: 'token', tokens: [gw.auth.token] };
  } else if (gw.auth?.type === 'token' || gw.auth?.type === 'basic' || gw.auth?.type === 'none') {
    auth = gw.auth as GatewayConfig['auth'];
  }

  const gatewayConfig: GatewayConfig = {
    port: gw.port ?? 8080,
    host: gw.host ?? '0.0.0.0',
    path: gw.path ?? '/gateway',
    heartbeatInterval: 45000,
    maxClients: 1000,
    auth,
  };
  return new GatewayServer(gatewayConfig);
}
