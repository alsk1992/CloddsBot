/**
 * Remote Module - Remote gateway and tunneling support
 *
 * Features:
 * - SSH tunneling
 * - ngrok integration
 * - Cloudflare tunnels
 * - Port forwarding
 * - Remote session management
 */

import { EventEmitter } from 'events';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// =============================================================================
// TYPES
// =============================================================================

export type TunnelType = 'ssh' | 'ngrok' | 'cloudflare' | 'localtunnel';

export interface TunnelConfig {
  type: TunnelType;
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
  authToken?: string;
  subdomain?: string;
  region?: string;
}

export interface TunnelInfo {
  id: string;
  type: TunnelType;
  localPort: number;
  publicUrl?: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  process?: ChildProcess;
  startedAt: Date;
  error?: string;
}

export interface RemoteSession {
  id: string;
  name: string;
  tunnel: TunnelInfo;
  gatewayUrl: string;
  createdAt: Date;
  lastActivity: Date;
}

// =============================================================================
// TUNNEL MANAGER
// =============================================================================

export class TunnelManager extends EventEmitter {
  private tunnels: Map<string, TunnelInfo> = new Map();
  private counter = 0;

  /** Create an SSH tunnel */
  async createSshTunnel(config: {
    localPort: number;
    remoteHost: string;
    remotePort: number;
    sshHost: string;
    sshUser?: string;
    sshKey?: string;
  }): Promise<TunnelInfo> {
    const id = `ssh-${++this.counter}`;

    const args = [
      '-N', '-L',
      `${config.localPort}:${config.remoteHost}:${config.remotePort}`,
    ];

    if (config.sshUser) {
      args.push('-l', config.sshUser);
    }

    if (config.sshKey) {
      args.push('-i', config.sshKey);
    }

    args.push(config.sshHost);

    const tunnel: TunnelInfo = {
      id,
      type: 'ssh',
      localPort: config.localPort,
      status: 'connecting',
      startedAt: new Date(),
    };

    try {
      const proc = spawn('ssh', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      tunnel.process = proc;

      proc.on('error', (err) => {
        tunnel.status = 'error';
        tunnel.error = err.message;
        this.emit('error', { id, error: err });
      });

      proc.on('exit', (code) => {
        tunnel.status = 'disconnected';
        this.emit('disconnect', { id, code });
      });

      // Give it a moment to connect
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (tunnel.status !== 'error') {
        tunnel.status = 'connected';
        tunnel.publicUrl = `localhost:${config.localPort}`;
      }

      this.tunnels.set(id, tunnel);
      this.emit('connect', tunnel);
      logger.info({ id, localPort: config.localPort }, 'SSH tunnel created');

      return tunnel;
    } catch (error) {
      tunnel.status = 'error';
      tunnel.error = String(error);
      throw error;
    }
  }

  /** Create an ngrok tunnel */
  async createNgrokTunnel(config: {
    localPort: number;
    authToken?: string;
    subdomain?: string;
    region?: string;
  }): Promise<TunnelInfo> {
    const id = `ngrok-${++this.counter}`;

    const tunnel: TunnelInfo = {
      id,
      type: 'ngrok',
      localPort: config.localPort,
      status: 'connecting',
      startedAt: new Date(),
    };

    try {
      // Check if ngrok is installed
      await execAsync('which ngrok');

      const args = ['http', String(config.localPort)];

      if (config.subdomain) {
        args.push('--subdomain', config.subdomain);
      }

      if (config.region) {
        args.push('--region', config.region);
      }

      const proc = spawn('ngrok', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: {
          ...process.env,
          NGROK_AUTHTOKEN: config.authToken,
        },
      });

      tunnel.process = proc;

      proc.on('error', (err) => {
        tunnel.status = 'error';
        tunnel.error = err.message;
        this.emit('error', { id, error: err });
      });

      proc.on('exit', (code) => {
        tunnel.status = 'disconnected';
        this.emit('disconnect', { id, code });
      });

      // Wait for ngrok to start and get the URL
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to get the public URL from ngrok API
      try {
        const { stdout } = await execAsync('curl -s http://localhost:4040/api/tunnels');
        const data = JSON.parse(stdout);
        if (data.tunnels && data.tunnels.length > 0) {
          tunnel.publicUrl = data.tunnels[0].public_url;
        }
      } catch {
        // ngrok API not available
      }

      tunnel.status = 'connected';
      this.tunnels.set(id, tunnel);
      this.emit('connect', tunnel);
      logger.info({ id, publicUrl: tunnel.publicUrl }, 'ngrok tunnel created');

      return tunnel;
    } catch (error) {
      tunnel.status = 'error';
      tunnel.error = String(error);
      throw new Error('ngrok not installed or failed to start');
    }
  }

  /** Create a Cloudflare tunnel */
  async createCloudflareTunnel(config: {
    localPort: number;
    hostname?: string;
  }): Promise<TunnelInfo> {
    const id = `cf-${++this.counter}`;

    const tunnel: TunnelInfo = {
      id,
      type: 'cloudflare',
      localPort: config.localPort,
      status: 'connecting',
      startedAt: new Date(),
    };

    try {
      // Check if cloudflared is installed
      await execAsync('which cloudflared');

      const args = ['tunnel', '--url', `http://localhost:${config.localPort}`];

      if (config.hostname) {
        args.push('--hostname', config.hostname);
      }

      const proc = spawn('cloudflared', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      tunnel.process = proc;

      let output = '';

      proc.stderr?.on('data', (data) => {
        output += data.toString();
        // Look for the URL in cloudflared output
        const match = output.match(/https:\/\/[^\s]+\.trycloudflare\.com/);
        if (match && !tunnel.publicUrl) {
          tunnel.publicUrl = match[0];
          tunnel.status = 'connected';
          this.emit('connect', tunnel);
        }
      });

      proc.on('error', (err) => {
        tunnel.status = 'error';
        tunnel.error = err.message;
        this.emit('error', { id, error: err });
      });

      proc.on('exit', (code) => {
        tunnel.status = 'disconnected';
        this.emit('disconnect', { id, code });
      });

      // Wait for cloudflared to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      if (!tunnel.publicUrl) {
        tunnel.status = 'connected';
        tunnel.publicUrl = 'pending...';
      }

      this.tunnels.set(id, tunnel);
      logger.info({ id, publicUrl: tunnel.publicUrl }, 'Cloudflare tunnel created');

      return tunnel;
    } catch (error) {
      tunnel.status = 'error';
      tunnel.error = String(error);
      throw new Error('cloudflared not installed or failed to start');
    }
  }

  /** Create a localtunnel */
  async createLocaltunnel(config: {
    localPort: number;
    subdomain?: string;
  }): Promise<TunnelInfo> {
    const id = `lt-${++this.counter}`;

    const tunnel: TunnelInfo = {
      id,
      type: 'localtunnel',
      localPort: config.localPort,
      status: 'connecting',
      startedAt: new Date(),
    };

    try {
      const args = ['--port', String(config.localPort)];

      if (config.subdomain) {
        args.push('--subdomain', config.subdomain);
      }

      const proc = spawn('npx', ['localtunnel', ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      tunnel.process = proc;

      proc.stdout?.on('data', (data) => {
        const output = data.toString();
        const match = output.match(/https:\/\/[^\s]+\.loca\.lt/);
        if (match && !tunnel.publicUrl) {
          tunnel.publicUrl = match[0];
          tunnel.status = 'connected';
          this.emit('connect', tunnel);
        }
      });

      proc.on('error', (err) => {
        tunnel.status = 'error';
        tunnel.error = err.message;
        this.emit('error', { id, error: err });
      });

      proc.on('exit', (code) => {
        tunnel.status = 'disconnected';
        this.emit('disconnect', { id, code });
      });

      // Wait for localtunnel to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      this.tunnels.set(id, tunnel);
      logger.info({ id, publicUrl: tunnel.publicUrl }, 'localtunnel created');

      return tunnel;
    } catch (error) {
      tunnel.status = 'error';
      tunnel.error = String(error);
      throw error;
    }
  }

  /** Close a tunnel */
  close(id: string): void {
    const tunnel = this.tunnels.get(id);
    if (tunnel) {
      if (tunnel.process) {
        tunnel.process.kill();
      }
      tunnel.status = 'disconnected';
      this.tunnels.delete(id);
      this.emit('close', { id });
      logger.info({ id }, 'Tunnel closed');
    }
  }

  /** Close all tunnels */
  closeAll(): void {
    for (const id of this.tunnels.keys()) {
      this.close(id);
    }
  }

  /** Get tunnel by ID */
  get(id: string): TunnelInfo | undefined {
    return this.tunnels.get(id);
  }

  /** List all tunnels */
  list(): TunnelInfo[] {
    return Array.from(this.tunnels.values());
  }

  /** Get active tunnels */
  getActive(): TunnelInfo[] {
    return this.list().filter(t => t.status === 'connected');
  }
}

// =============================================================================
// REMOTE SESSION MANAGER
// =============================================================================

export class RemoteSessionManager extends EventEmitter {
  private sessions: Map<string, RemoteSession> = new Map();
  private tunnelManager: TunnelManager;

  constructor(tunnelManager?: TunnelManager) {
    super();
    this.tunnelManager = tunnelManager || new TunnelManager();
  }

  /** Create a remote session with automatic tunneling */
  async createSession(config: {
    name: string;
    localPort: number;
    tunnelType?: TunnelType;
    tunnelConfig?: Partial<TunnelConfig>;
  }): Promise<RemoteSession> {
    const tunnelType = config.tunnelType || 'cloudflare';

    let tunnel: TunnelInfo;

    switch (tunnelType) {
      case 'ngrok':
        tunnel = await this.tunnelManager.createNgrokTunnel({
          localPort: config.localPort,
          authToken: config.tunnelConfig?.authToken,
          subdomain: config.tunnelConfig?.subdomain,
          region: config.tunnelConfig?.region,
        });
        break;
      case 'cloudflare':
        tunnel = await this.tunnelManager.createCloudflareTunnel({
          localPort: config.localPort,
        });
        break;
      case 'localtunnel':
        tunnel = await this.tunnelManager.createLocaltunnel({
          localPort: config.localPort,
          subdomain: config.tunnelConfig?.subdomain,
        });
        break;
      default:
        throw new Error(`Unsupported tunnel type: ${tunnelType}`);
    }

    const session: RemoteSession = {
      id: tunnel.id,
      name: config.name,
      tunnel,
      gatewayUrl: tunnel.publicUrl || `localhost:${config.localPort}`,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessions.set(session.id, session);
    this.emit('session:create', session);

    return session;
  }

  /** Update session activity */
  touch(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /** Close a session */
  close(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      this.tunnelManager.close(session.tunnel.id);
      this.sessions.delete(id);
      this.emit('session:close', { id });
    }
  }

  /** Close all sessions */
  closeAll(): void {
    for (const id of this.sessions.keys()) {
      this.close(id);
    }
  }

  /** Get session by ID */
  get(id: string): RemoteSession | undefined {
    return this.sessions.get(id);
  }

  /** List all sessions */
  list(): RemoteSession[] {
    return Array.from(this.sessions.values());
  }

  /** Get tunnel manager */
  getTunnelManager(): TunnelManager {
    return this.tunnelManager;
  }
}

// =============================================================================
// PORT FORWARDING
// =============================================================================

export interface PortForward {
  id: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  protocol: 'tcp' | 'udp';
  status: 'active' | 'inactive';
}

export class PortForwarder {
  private forwards: Map<string, PortForward> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private counter = 0;

  /** Create a port forward using socat */
  async forward(config: {
    localPort: number;
    remoteHost: string;
    remotePort: number;
    protocol?: 'tcp' | 'udp';
  }): Promise<PortForward> {
    const id = `pf-${++this.counter}`;
    const protocol = config.protocol || 'tcp';

    const pf: PortForward = {
      id,
      localPort: config.localPort,
      remoteHost: config.remoteHost,
      remotePort: config.remotePort,
      protocol,
      status: 'active',
    };

    try {
      // Use socat for port forwarding
      const socatProto = protocol === 'tcp' ? 'TCP-LISTEN' : 'UDP-RECVFROM';
      const socatRemote = protocol === 'tcp' ? 'TCP' : 'UDP-SENDTO';

      const proc = spawn('socat', [
        `${socatProto}:${config.localPort},fork,reuseaddr`,
        `${socatRemote}:${config.remoteHost}:${config.remotePort}`,
      ], {
        stdio: 'ignore',
        detached: true,
      });

      this.processes.set(id, proc);
      this.forwards.set(id, pf);

      proc.on('exit', () => {
        pf.status = 'inactive';
      });

      logger.info({
        id,
        local: config.localPort,
        remote: `${config.remoteHost}:${config.remotePort}`,
      }, 'Port forward created');

      return pf;
    } catch (error) {
      throw new Error(`Failed to create port forward: ${error}`);
    }
  }

  /** Stop a port forward */
  stop(id: string): void {
    const proc = this.processes.get(id);
    if (proc) {
      proc.kill();
      this.processes.delete(id);
    }
    const pf = this.forwards.get(id);
    if (pf) {
      pf.status = 'inactive';
      this.forwards.delete(id);
    }
  }

  /** Stop all port forwards */
  stopAll(): void {
    for (const id of this.forwards.keys()) {
      this.stop(id);
    }
  }

  /** List all port forwards */
  list(): PortForward[] {
    return Array.from(this.forwards.values());
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createTunnelManager(): TunnelManager {
  return new TunnelManager();
}

export function createRemoteSessionManager(tunnelManager?: TunnelManager): RemoteSessionManager {
  return new RemoteSessionManager(tunnelManager);
}

export function createPortForwarder(): PortForwarder {
  return new PortForwarder();
}

// =============================================================================
// DEFAULT INSTANCES
// =============================================================================

export const tunnels = new TunnelManager();
export const remoteSessions = new RemoteSessionManager(tunnels);
export const portForwarder = new PortForwarder();
