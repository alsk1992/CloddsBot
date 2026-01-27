/**
 * HTTP + WebSocket server
 */

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createHttpServer, Server, IncomingMessage } from 'http';
import { logger } from '../utils/logger';
import type { Config } from '../types';

export interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getWebSocketServer(): WebSocketServer | null;
}

export function createServer(config: Config['gateway']): GatewayServer {
  const app = express();
  let httpServer: Server | null = null;
  let wss: WebSocketServer | null = null;

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // API info endpoint
  app.get('/', (_req, res) => {
    res.json({
      name: 'clodds',
      version: '0.1.0',
      description: 'AI assistant for prediction markets',
      endpoints: {
        websocket: '/ws',
        webchat: '/chat',
        health: '/health',
      },
    });
  });

  // Serve simple WebChat HTML client
  app.get('/webchat', (_req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Clodds WebChat</title>
  <style>
    body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }
    #messages { height: 400px; overflow-y: auto; border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; }
    .msg { margin: 5px 0; padding: 8px; border-radius: 4px; }
    .user { background: #e3f2fd; text-align: right; }
    .bot { background: #f5f5f5; }
    .system { background: #fff3e0; font-style: italic; font-size: 0.9em; }
    #input { width: calc(100% - 80px); padding: 10px; }
    button { padding: 10px 20px; }
  </style>
</head>
<body>
  <h1>🎲 Clodds WebChat</h1>
  <div id="messages"></div>
  <input type="text" id="input" placeholder="Ask about prediction markets..." />
  <button onclick="send()">Send</button>
  <script>
    const port = window.location.port || 80;
    const ws = new WebSocket('ws://' + window.location.hostname + ':' + port + '/chat');
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');

    function addMsg(text, cls) {
      const div = document.createElement('div');
      div.className = 'msg ' + cls;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    ws.onopen = () => {
      addMsg('Connected. Authenticating...', 'system');
      ws.send(JSON.stringify({ type: 'auth', token: 'web-user', userId: 'web-' + Date.now() }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'authenticated') {
        addMsg('Ready! Ask me about prediction markets.', 'system');
      } else if (msg.type === 'message') {
        addMsg(msg.text, 'bot');
      } else if (msg.type === 'error') {
        addMsg('Error: ' + msg.message, 'system');
      }
    };

    ws.onclose = () => addMsg('Disconnected', 'system');

    function send() {
      const text = input.value.trim();
      if (text) {
        addMsg(text, 'user');
        ws.send(JSON.stringify({ type: 'message', text }));
        input.value = '';
      }
    }

    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') send(); });
  </script>
</body>
</html>
    `);
  });

  return {
    async start() {
      return new Promise((resolve) => {
        httpServer = createHttpServer(app);

        // WebSocket server - handles both /ws and /chat
        wss = new WebSocketServer({ noServer: true });

        // Handle upgrade requests
        httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
          const pathname = request.url || '';

          if (pathname === '/ws' || pathname === '/chat') {
            wss!.handleUpgrade(request, socket, head, (ws) => {
              wss!.emit('connection', ws, request);
            });
          } else {
            socket.destroy();
          }
        });

        // Default /ws handler (for API/control)
        wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
          // /chat connections are handled by WebChat channel via attachWebSocket
          if (request.url === '/chat') {
            return; // Let WebChat handle it
          }

          logger.info('WebSocket API client connected');

          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              logger.debug({ message }, 'WS API message received');

              ws.send(
                JSON.stringify({
                  type: 'res',
                  id: message.id,
                  ok: true,
                  payload: { echo: message },
                })
              );
            } catch (err) {
              logger.error({ err }, 'Failed to parse WS message');
            }
          });

          ws.on('close', () => {
            logger.info('WebSocket API client disconnected');
          });
        });

        httpServer.listen(config.port, () => {
          resolve();
        });
      });
    },

    async stop() {
      return new Promise((resolve) => {
        wss?.close();
        httpServer?.close(() => resolve());
      });
    },

    getWebSocketServer(): WebSocketServer | null {
      return wss;
    },
  };
}
