/**
 * Tailscale Module - Tailscale Serve/Funnel integration
 *
 * Features:
 * - Tailscale Serve (private network sharing)
 * - Tailscale Funnel (public internet sharing)
 * - Status monitoring
 * - Device management
 * - MagicDNS support
 */

import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

// =============================================================================
// TYPES
// =============================================================================

export interface TailscaleStatus {
  version: string;
  backendState: string;
  authUrl?: string;
  tailscaleIPs: string[];
  self: TailscaleNode;
  peers: TailscaleNode[];
  magicDnsSuffix?: string;
  currentTailnet?: string;
}

export interface TailscaleNode {
  id: string;
  publicKey: string;
  hostName: string;
  dnsName: string;
  os: string;
  tailscaleIPs: string[];
  online: boolean;
  lastSeen?: string;
  tags?: string[];
}

export interface ServeConfig {
  port: number;
  path?: string;
  https?: boolean;
  setHeaders?: Record<string, string>;
}

export interface FunnelConfig {
  port: number;
  path?: string;
}

export interface ServeStatus {
  tcp: Record<number, { https?: boolean; http?: string }>;
  web: Record<string, Record<string, { proxy: string }>>;
  funnel?: Record<number, boolean>;
}

// =============================================================================
// TAILSCALE CLIENT
// =============================================================================

export class TailscaleClient extends EventEmitter {
  private serveProcess: ChildProcess | null = null;
  private funnelProcess: ChildProcess | null = null;

  async isInstalled(): Promise<boolean> {
    try {
      await execFileAsync('which', ['tailscale']);
      return true;
    } catch {
      return false;
    }
  }

  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('tailscale', ['status', '--json']);
      const status = JSON.parse(stdout);
      return status.BackendState === 'Running';
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<TailscaleStatus> {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json']);
    const data = JSON.parse(stdout);

    const self: TailscaleNode = {
      id: data.Self?.ID || '',
      publicKey: data.Self?.PublicKey || '',
      hostName: data.Self?.HostName || '',
      dnsName: data.Self?.DNSName || '',
      os: data.Self?.OS || '',
      tailscaleIPs: data.Self?.TailscaleIPs || [],
      online: data.Self?.Online ?? true,
      tags: data.Self?.Tags,
    };

    const peers: TailscaleNode[] = Object.values(data.Peer || {}).map((peer: unknown) => {
      const p = peer as Record<string, unknown>;
      return {
        id: String(p.ID || ''),
        publicKey: String(p.PublicKey || ''),
        hostName: String(p.HostName || ''),
        dnsName: String(p.DNSName || ''),
        os: String(p.OS || ''),
        tailscaleIPs: (p.TailscaleIPs as string[]) || [],
        online: Boolean(p.Online),
        lastSeen: p.LastSeen as string | undefined,
        tags: p.Tags as string[] | undefined,
      };
    });

    return {
      version: data.Version || '',
      backendState: data.BackendState || '',
      authUrl: data.AuthURL,
      tailscaleIPs: data.TailscaleIPs || [],
      self,
      peers,
      magicDnsSuffix: data.MagicDNSSuffix,
      currentTailnet: data.CurrentTailnet?.Name,
    };
  }

  async getIP(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('tailscale', ['ip', '-4']);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /** Get this machine's MagicDNS name */
  async getDnsName(): Promise<string | null> {
    try {
      const status = await this.getStatus();
      return status.self.dnsName || null;
    } catch {
      return null;
    }
  }

  async serve(config: ServeConfig): Promise<string> {
    const port = config.port;
    const path = config.path || '/';

    await this.serveStop();

    const args = ['serve'];

    if (config.https !== false) {
      args.push('--https=' + String(port));
    } else {
      args.push('--http=' + String(port));
    }

    args.push(`localhost:${port}${path}`);

    try {
      await execFileAsync('tailscale', args);
      const dnsName = await this.getDnsName();
      const url = `https://${dnsName}${path}`;

      logger.info({ port, url }, 'Tailscale Serve started');
      this.emit('serve:start', { port, url });

      return url;
    } catch (error) {
      throw new Error(`Failed to start Tailscale Serve: ${error}`);
    }
  }

  async serveStop(): Promise<void> {
    try {
      await execFileAsync('tailscale', ['serve', 'off']);
      logger.info('Tailscale Serve stopped');
      this.emit('serve:stop');
    } catch {
      // Serve wasn't running
    }
  }

  async serveStatus(): Promise<ServeStatus | null> {
    try {
      const { stdout } = await execFileAsync('tailscale', ['serve', 'status', '--json']);
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }

  async funnel(config: FunnelConfig): Promise<string> {
    const port = config.port;
    const path = config.path || '/';

    await this.funnelStop();

    try {
      await execFileAsync('tailscale', ['funnel', `${port}${path}`]);
      const dnsName = await this.getDnsName();
      const url = `https://${dnsName}${path}`;

      logger.info({ port, url }, 'Tailscale Funnel started');
      this.emit('funnel:start', { port, url });

      return url;
    } catch (error) {
      throw new Error(`Failed to start Tailscale Funnel: ${error}`);
    }
  }

  async funnelStop(): Promise<void> {
    try {
      await execFileAsync('tailscale', ['funnel', 'off']);
      logger.info('Tailscale Funnel stopped');
      this.emit('funnel:stop');
    } catch {
      // Funnel wasn't running
    }
  }

  async funnelAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('tailscale', ['funnel', 'status', '--json']);
      return !stdout.includes('not available');
    } catch {
      return false;
    }
  }

  async ping(target: string, count = 1): Promise<{ latency: number; online: boolean }> {
    try {
      const { stdout } = await execFileAsync('tailscale', ['ping', '-c', String(count), target]);
      const match = stdout.match(/in (\d+(?:\.\d+)?)\s*ms/);
      const latency = match ? parseFloat(match[1]) : 0;
      return { latency, online: true };
    } catch {
      return { latency: 0, online: false };
    }
  }

  async sendFile(target: string, filePath: string): Promise<void> {
    try {
      await execFileAsync('tailscale', ['file', 'cp', filePath, `${target}:`]);
      logger.info({ target, filePath }, 'File sent via Tailscale');
    } catch (error) {
      throw new Error(`Failed to send file: ${error}`);
    }
  }

  async getIncomingFiles(): Promise<Array<{ name: string; size: number; from: string }>> {
    try {
      const { stdout } = await execFileAsync('tailscale', ['file', 'get', '--json']);
      return JSON.parse(stdout) || [];
    } catch {
      return [];
    }
  }

  async acceptFiles(destDir: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('tailscale', ['file', 'get', destDir]);
      const files = stdout.trim().split('\n').filter(Boolean);
      return files;
    } catch {
      return [];
    }
  }

  /** List peers on the tailnet */
  async listPeers(): Promise<TailscaleNode[]> {
    const status = await this.getStatus();
    return status.peers;
  }

  /** Find a peer by hostname or DNS name */
  async findPeer(query: string): Promise<TailscaleNode | null> {
    const peers = await this.listPeers();
    return peers.find(p =>
      p.hostName.toLowerCase().includes(query.toLowerCase()) ||
      p.dnsName.toLowerCase().includes(query.toLowerCase())
    ) || null;
  }

  /** Get online peers */
  async getOnlinePeers(): Promise<TailscaleNode[]> {
    const peers = await this.listPeers();
    return peers.filter(p => p.online);
  }

  /** SSH to a peer */
  async ssh(target: string, command?: string): Promise<ChildProcess> {
    const args = ['ssh', target];
    if (command) {
      args.push('--', command);
    }

    return spawn('tailscale', args, {
      stdio: 'inherit',
    });
  }

  async login(options?: { authKey?: string; hostname?: string }): Promise<void> {
    const args = ['up'];

    if (options?.authKey) {
      args.push('--authkey', options.authKey);
    }

    if (options?.hostname) {
      args.push('--hostname', options.hostname);
    }

    await execFileAsync('tailscale', args);
    logger.info('Tailscale logged in');
  }

  async logout(): Promise<void> {
    await execFileAsync('tailscale', ['logout']);
    logger.info('Tailscale logged out');
  }

  async setTags(tags: string[]): Promise<void> {
    const tagArgs = tags.map(t => t.startsWith('tag:') ? t : `tag:${t}`).join(',');
    await execFileAsync('tailscale', ['up', `--advertise-tags=${tagArgs}`]);
  }
}

// =============================================================================
// SERVE MANAGER
// =============================================================================

export class ServeManager {
  private client: TailscaleClient;
  private activeServes: Map<number, { url: string; path: string }> = new Map();

  constructor(client?: TailscaleClient) {
    this.client = client || new TailscaleClient();
  }

  /** Start serving a port */
  async serve(port: number, options?: { path?: string; https?: boolean }): Promise<string> {
    const url = await this.client.serve({
      port,
      path: options?.path,
      https: options?.https,
    });

    this.activeServes.set(port, { url, path: options?.path || '/' });
    return url;
  }

  /** Start funnel (public access) */
  async funnel(port: number, options?: { path?: string }): Promise<string> {
    return this.client.funnel({
      port,
      path: options?.path,
    });
  }

  /** Stop all serves */
  async stopAll(): Promise<void> {
    await this.client.serveStop();
    await this.client.funnelStop();
    this.activeServes.clear();
  }

  /** Get active serves */
  getActive(): Array<{ port: number; url: string; path: string }> {
    return Array.from(this.activeServes.entries()).map(([port, info]) => ({
      port,
      ...info,
    }));
  }

  /** Get the tailscale client */
  getClient(): TailscaleClient {
    return this.client;
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createTailscaleClient(): TailscaleClient {
  return new TailscaleClient();
}

export function createServeManager(client?: TailscaleClient): ServeManager {
  return new ServeManager(client);
}

// =============================================================================
// DEFAULT INSTANCES
// =============================================================================

export const tailscale = new TailscaleClient();
export const serveManager = new ServeManager(tailscale);
