/**
 * Control UI - Clawdbot-style web dashboard
 *
 * Features:
 * - Gateway status overview
 * - Channel health indicators
 * - Session list and management
 * - Usage statistics
 * - Real-time logs (WebSocket)
 */

import { logger } from '../utils/logger';
import type { Express, Request, Response } from 'express';
import type { SessionManager } from '../sessions/index';
import type { UsageService } from '../usage/index';
import type { ChannelManager } from '../channels/index';

export interface ControlUIConfig {
  /** Enable control UI */
  enabled: boolean;
  /** Path prefix for UI routes */
  pathPrefix?: string;
  /** Require auth for control UI */
  requireAuth?: boolean;
  /** Auth token (if requireAuth is true) */
  authToken?: string;
}

interface GatewayStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  channels: Array<{
    name: string;
    status: 'connected' | 'disconnected' | 'error';
    lastActivity?: Date;
  }>;
  sessions: {
    active: number;
    total: number;
  };
  usage: {
    today: {
      requests: number;
      tokens: number;
      cost: number;
    };
  };
}

export function mountControlUI(
  app: Express,
  config: ControlUIConfig,
  deps: {
    sessionManager?: SessionManager;
    usageService?: UsageService;
    channelManager?: ChannelManager;
    startTime: Date;
    version: string;
  }
): void {
  if (!config.enabled) {
    logger.info('Control UI disabled');
    return;
  }

  const prefix = config.pathPrefix || '/_control';

  /** Auth middleware */
  function authMiddleware(req: Request, res: Response, next: () => void): void {
    if (!config.requireAuth) {
      next();
      return;
    }

    const token =
      req.headers.authorization?.replace('Bearer ', '') ||
      req.query.token as string;

    if (token !== config.authToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  }

  /** Get gateway status */
  app.get(`${prefix}/status`, authMiddleware, (_req, res) => {
    const uptime = Math.floor(
      (Date.now() - deps.startTime.getTime()) / 1000
    );

    // Get channel status
    const channels: GatewayStatus['channels'] = [];
    if (deps.channelManager) {
      const adapters = deps.channelManager.getAdapters();
      for (const [name, adapter] of Object.entries(adapters)) {
        channels.push({
          name,
          status: 'connected', // Would need actual status tracking
        });
      }
    }

    // Get usage stats
    let usageToday = { requests: 0, tokens: 0, cost: 0 };
    if (deps.usageService) {
      const summary = deps.usageService.getTotalUsage(true);
      usageToday = {
        requests: summary.totalRequests,
        tokens: summary.totalTokens,
        cost: summary.estimatedCost,
      };
    }

    const status: GatewayStatus = {
      status: channels.length > 0 ? 'healthy' : 'degraded',
      uptime,
      version: deps.version,
      channels,
      sessions: {
        active: 0, // Would need session manager method
        total: 0,
      },
      usage: { today: usageToday },
    };

    res.json(status);
  });

  /** Health check endpoint */
  app.get(`${prefix}/health`, (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  /** Dashboard HTML */
  app.get(prefix, authMiddleware, (_req, res) => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clodds Control</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #38bdf8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
    .card {
      background: #1e293b;
      border-radius: 0.5rem;
      padding: 1.25rem;
      border: 1px solid #334155;
    }
    .card h2 {
      font-size: 0.875rem;
      color: #94a3b8;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .card .value {
      font-size: 1.5rem;
      font-weight: 600;
    }
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 0.5rem;
    }
    .status-healthy { background: #22c55e; }
    .status-degraded { background: #eab308; }
    .status-unhealthy { background: #ef4444; }
    .channel-list { margin-top: 0.5rem; }
    .channel-item {
      display: flex;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid #334155;
    }
    .channel-item:last-child { border-bottom: none; }
    .refresh-btn {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 0.25rem;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .refresh-btn:hover { background: #2563eb; }
    #lastUpdate { color: #64748b; font-size: 0.75rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎯 Clodds Control</h1>

    <div class="grid">
      <div class="card">
        <h2>Status</h2>
        <div class="value">
          <span id="statusDot" class="status-dot status-healthy"></span>
          <span id="statusText">Healthy</span>
        </div>
      </div>

      <div class="card">
        <h2>Uptime</h2>
        <div class="value" id="uptime">--</div>
      </div>

      <div class="card">
        <h2>Version</h2>
        <div class="value" id="version">--</div>
      </div>

      <div class="card">
        <h2>Today's Usage</h2>
        <div class="value" id="usage">--</div>
      </div>
    </div>

    <div class="card" style="margin-top: 1rem;">
      <h2>Channels</h2>
      <div id="channels" class="channel-list">Loading...</div>
    </div>

    <button class="refresh-btn" style="margin-top: 1rem;" onclick="refresh()">Refresh</button>
    <div id="lastUpdate"></div>
  </div>

  <script>
    function formatUptime(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (h > 0) return h + 'h ' + m + 'm';
      return m + 'm';
    }

    async function refresh() {
      try {
        const res = await fetch('${prefix}/status');
        const data = await res.json();

        document.getElementById('statusText').textContent = data.status;
        document.getElementById('statusDot').className = 'status-dot status-' + data.status;
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('version').textContent = data.version;
        document.getElementById('usage').textContent =
          data.usage.today.requests + ' requests / $' + data.usage.today.cost.toFixed(4);

        const channelsHtml = data.channels.map(ch =>
          '<div class="channel-item">' +
          '<span class="status-dot status-' + (ch.status === 'connected' ? 'healthy' : 'unhealthy') + '"></span>' +
          ch.name +
          '</div>'
        ).join('') || '<div style="color: #64748b">No channels connected</div>';

        document.getElementById('channels').innerHTML = channelsHtml;
        document.getElementById('lastUpdate').textContent = 'Last updated: ' + new Date().toLocaleTimeString();
      } catch (err) {
        console.error('Failed to refresh:', err);
      }
    }

    refresh();
    setInterval(refresh, 30000); // Refresh every 30s
  </script>
</body>
</html>
    `.trim();

    res.type('html').send(html);
  });

  logger.info({ prefix }, 'Control UI mounted');
}

/**
 * Create standalone Control UI server
 */
export interface StandaloneControlUI {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createControlUI(options: {
  port: number;
  channels: ChannelManager;
  sessions: SessionManager;
  usage: UsageService;
  pairing?: unknown;
}): StandaloneControlUI {
  // Dynamic import express to avoid bundling if not used
  let server: ReturnType<typeof import('http').createServer> | null = null;

  return {
    async start(): Promise<void> {
      const express = (await import('express')).default;
      const http = await import('http');

      const app = express();

      // Mount control UI routes
      mountControlUI(app, { enabled: true }, {
        sessionManager: options.sessions,
        usageService: options.usage,
        channelManager: options.channels,
        startTime: new Date(),
        version: '0.1.0',
      });

      // Health check at root
      app.get('/health', (_req, res) => {
        res.json({ ok: true, timestamp: new Date().toISOString() });
      });

      server = http.createServer(app);

      return new Promise((resolve) => {
        server!.listen(options.port, () => {
          logger.info({ port: options.port }, 'Control UI server started');
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      if (server) {
        return new Promise((resolve) => {
          server!.close(() => {
            logger.info('Control UI server stopped');
            resolve();
          });
        });
      }
    },
  };
}
