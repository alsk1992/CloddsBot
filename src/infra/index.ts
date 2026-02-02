/**
 * Infrastructure Module - Clawdbot-style deployment and infrastructure management
 *
 * Features:
 * - Docker container management
 * - Health checks and monitoring
 * - Deployment automation
 * - Service discovery
 * - Resource management
 */

import { spawn, exec } from 'child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, hostname, platform, cpus, totalmem, freemem } from 'os';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface ServiceConfig {
  name: string;
  image?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  ports?: Array<{ host: number; container: number }>;
  volumes?: Array<{ host: string; container: string }>;
  healthCheck?: HealthCheckConfig;
  restart?: 'no' | 'always' | 'on-failure' | 'unless-stopped';
  depends?: string[];
  resources?: ResourceLimits;
}

export interface HealthCheckConfig {
  command?: string;
  http?: { url: string; expectedStatus?: number };
  tcp?: { host: string; port: number };
  interval?: number;
  timeout?: number;
  retries?: number;
}

export interface ResourceLimits {
  cpus?: number;
  memory?: string;
  memoryReservation?: string;
}

export interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'starting' | 'error' | 'unknown';
  health: 'healthy' | 'unhealthy' | 'unknown';
  uptime?: number;
  pid?: number;
  containerId?: string;
  lastCheck?: Date;
  error?: string;
}

export interface DeploymentResult {
  success: boolean;
  services: Record<string, { started: boolean; error?: string }>;
  duration: number;
}

export interface SystemHealth {
  hostname: string;
  platform: string;
  uptime: number;
  load: number[];
  memory: { total: number; free: number; used: number; percent: number };
  cpu: { cores: number; model: string };
  disk?: { total: number; free: number; used: number; percent: number };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_HEALTH_INTERVAL = 30000;
const DEFAULT_HEALTH_TIMEOUT = 5000;
const DEFAULT_HEALTH_RETRIES = 3;

// =============================================================================
// HELPERS
// =============================================================================

function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker --version');
    return true;
  } catch {
    return false;
  }
}

async function checkHttpHealth(url: string, expectedStatus = 200, timeout = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    return response.status === expectedStatus;
  } catch {
    return false;
  }
}

async function checkTcpHealth(host: string, port: number, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

// =============================================================================
// DOCKER MANAGEMENT
// =============================================================================

export class DockerManager {
  private services: Map<string, ServiceConfig> = new Map();
  private statuses: Map<string, ServiceStatus> = new Map();
  private healthCheckers: Map<string, NodeJS.Timeout> = new Map();
  private events: EventEmitter = new EventEmitter();

  async isAvailable(): Promise<boolean> {
    return isDockerAvailable();
  }

  async listContainers(all = false): Promise<Array<{ id: string; name: string; image: string; status: string }>> {
    const flag = all ? '-a' : '';
    const { stdout } = await execAsync(`docker ps ${flag} --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}"`);

    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [id, name, image, status] = line.split('|');
      return { id, name, image, status };
    });
  }

  async startContainer(config: ServiceConfig): Promise<string> {
    this.services.set(config.name, config);

    const args: string[] = ['run', '-d', '--name', config.name];

    // Environment variables
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Ports
    if (config.ports) {
      for (const port of config.ports) {
        args.push('-p', `${port.host}:${port.container}`);
      }
    }

    // Volumes
    if (config.volumes) {
      for (const vol of config.volumes) {
        args.push('-v', `${vol.host}:${vol.container}`);
      }
    }

    // Resources
    if (config.resources) {
      if (config.resources.cpus) {
        args.push('--cpus', config.resources.cpus.toString());
      }
      if (config.resources.memory) {
        args.push('-m', config.resources.memory);
      }
    }

    // Restart policy
    if (config.restart) {
      args.push('--restart', config.restart);
    }

    // Image and command
    args.push(config.image!);
    if (config.command) args.push(config.command);
    if (config.args) args.push(...config.args);

    const { stdout } = await execAsync(`docker ${args.join(' ')}`);
    const containerId = stdout.trim();

    this.statuses.set(config.name, {
      name: config.name,
      status: 'running',
      health: 'unknown',
      containerId,
    });

    // Start health checking
    if (config.healthCheck) {
      this.startHealthCheck(config.name, config.healthCheck);
    }

    logger.info({ name: config.name, containerId }, 'Container started');
    return containerId;
  }

  async stopContainer(name: string, timeout = 10): Promise<void> {
    // Stop health checker
    const checker = this.healthCheckers.get(name);
    if (checker) {
      clearInterval(checker);
      this.healthCheckers.delete(name);
    }

    await execAsync(`docker stop -t ${timeout} ${name}`);

    this.statuses.set(name, {
      name,
      status: 'stopped',
      health: 'unknown',
    });

    logger.info({ name }, 'Container stopped');
  }

  async removeContainer(name: string, force = false): Promise<void> {
    const flag = force ? '-f' : '';
    await execAsync(`docker rm ${flag} ${name}`);

    this.services.delete(name);
    this.statuses.delete(name);

    logger.info({ name }, 'Container removed');
  }

  async getLogs(name: string, lines = 100): Promise<string> {
    const { stdout } = await execAsync(`docker logs --tail ${lines} ${name}`);
    return stdout;
  }

  async exec(name: string, command: string): Promise<string> {
    const { stdout } = await execAsync(`docker exec ${name} ${command}`);
    return stdout;
  }

  private startHealthCheck(name: string, config: HealthCheckConfig): void {
    const interval = config.interval ?? DEFAULT_HEALTH_INTERVAL;

    const checker = setInterval(async () => {
      const status = this.statuses.get(name);
      if (!status) return;

      let healthy = false;

      if (config.http) {
        healthy = await checkHttpHealth(
          config.http.url,
          config.http.expectedStatus,
          config.timeout ?? DEFAULT_HEALTH_TIMEOUT
        );
      } else if (config.tcp) {
        healthy = await checkTcpHealth(
          config.tcp.host,
          config.tcp.port,
          config.timeout ?? DEFAULT_HEALTH_TIMEOUT
        );
      } else if (config.command) {
        try {
          await this.exec(name, config.command);
          healthy = true;
        } catch {
          healthy = false;
        }
      }

      const previousHealth = status.health;
      status.health = healthy ? 'healthy' : 'unhealthy';
      status.lastCheck = new Date();

      if (previousHealth !== status.health) {
        this.events.emit('healthChange', { name, health: status.health });
        logger.info({ name, health: status.health }, 'Health status changed');
      }
    }, interval);

    this.healthCheckers.set(name, checker);
  }

  getStatus(name: string): ServiceStatus | undefined {
    return this.statuses.get(name);
  }

  getAllStatuses(): ServiceStatus[] {
    return Array.from(this.statuses.values());
  }

  onHealthChange(callback: (event: { name: string; health: string }) => void): void {
    this.events.on('healthChange', callback);
  }
}

// =============================================================================
// PROCESS MANAGER (NON-DOCKER)
// =============================================================================

export class ProcessManager {
  private processes: Map<string, { pid: number; startTime: Date; config: ServiceConfig }> = new Map();
  private statuses: Map<string, ServiceStatus> = new Map();

  async start(config: ServiceConfig): Promise<number> {
    const args = config.args || [];
    const env = { ...process.env, ...config.env };

    const child = spawn(config.command!, args, {
      env,
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
    });

    child.unref();

    const pid = child.pid!;
    this.processes.set(config.name, {
      pid,
      startTime: new Date(),
      config,
    });

    this.statuses.set(config.name, {
      name: config.name,
      status: 'running',
      health: 'unknown',
      pid,
    });

    logger.info({ name: config.name, pid }, 'Process started');
    return pid;
  }

  async stop(name: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const proc = this.processes.get(name);
    if (!proc) return;

    try {
      process.kill(proc.pid, signal);
    } catch {
      // Process might already be dead
    }

    this.processes.delete(name);
    this.statuses.set(name, {
      name,
      status: 'stopped',
      health: 'unknown',
    });

    logger.info({ name, pid: proc.pid }, 'Process stopped');
  }

  isRunning(name: string): boolean {
    const proc = this.processes.get(name);
    if (!proc) return false;

    try {
      process.kill(proc.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  getStatus(name: string): ServiceStatus | undefined {
    const status = this.statuses.get(name);
    if (status && this.isRunning(name)) {
      const proc = this.processes.get(name);
      if (proc) {
        status.uptime = Date.now() - proc.startTime.getTime();
      }
    }
    return status;
  }
}

// =============================================================================
// SYSTEM HEALTH
// =============================================================================

export async function getSystemHealth(): Promise<SystemHealth> {
  const health: SystemHealth = {
    hostname: hostname(),
    platform: platform(),
    uptime: process.uptime(),
    load: require('os').loadavg(),
    memory: {
      total: totalmem(),
      free: freemem(),
      used: totalmem() - freemem(),
      percent: ((totalmem() - freemem()) / totalmem()) * 100,
    },
    cpu: {
      cores: cpus().length,
      model: cpus()[0]?.model || 'Unknown',
    },
  };

  // Try to get disk info
  if (platform() !== 'win32') {
    try {
      const { stdout } = await execAsync('df -k / | tail -1');
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 4) {
        const total = parseInt(parts[1]) * 1024;
        const used = parseInt(parts[2]) * 1024;
        const free = parseInt(parts[3]) * 1024;
        health.disk = {
          total,
          free,
          used,
          percent: (used / total) * 100,
        };
      }
    } catch (e) {
      logger.debug({ err: e }, 'Failed to get disk info');
    }
  }

  return health;
}

// =============================================================================
// DEPLOYMENT
// =============================================================================

export interface DeploymentConfig {
  name: string;
  services: ServiceConfig[];
  networks?: string[];
  volumes?: string[];
}

export async function deploy(config: DeploymentConfig): Promise<DeploymentResult> {
  const startTime = Date.now();
  const results: Record<string, { started: boolean; error?: string }> = {};

  const docker = new DockerManager();
  const useDocker = await docker.isAvailable();
  const processManager = new ProcessManager();

  // Sort services by dependencies
  const sorted = topologicalSort(config.services);

  for (const service of sorted) {
    try {
      if (useDocker && service.image) {
        await docker.startContainer(service);
      } else if (service.command) {
        await processManager.start(service);
      }
      results[service.name] = { started: true };
    } catch (error) {
      results[service.name] = { started: false, error: String(error) };
      logger.error({ service: service.name, error }, 'Failed to start service');
    }
  }

  return {
    success: Object.values(results).every(r => r.started),
    services: results,
    duration: Date.now() - startTime,
  };
}

function topologicalSort(services: ServiceConfig[]): ServiceConfig[] {
  const sorted: ServiceConfig[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const serviceMap = new Map(services.map(s => [s.name, s]));

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Circular dependency: ${name}`);

    visiting.add(name);

    const service = serviceMap.get(name);
    if (service?.depends) {
      for (const dep of service.depends) {
        visit(dep);
      }
    }

    visiting.delete(name);
    visited.add(name);
    if (service) sorted.push(service);
  }

  for (const service of services) {
    visit(service.name);
  }

  return sorted;
}

// =============================================================================
// DOCKER COMPOSE SUPPORT
// =============================================================================

export function generateDockerCompose(config: DeploymentConfig): string {
  const compose: Record<string, unknown> = {
    version: '3.8',
    services: {} as Record<string, unknown>,
  };

  for (const service of config.services) {
    const svc: Record<string, unknown> = {};

    if (service.image) svc.image = service.image;
    if (service.command) svc.command = service.command;

    if (service.env) {
      svc.environment = service.env;
    }

    if (service.ports) {
      svc.ports = service.ports.map(p => `${p.host}:${p.container}`);
    }

    if (service.volumes) {
      svc.volumes = service.volumes.map(v => `${v.host}:${v.container}`);
    }

    if (service.depends) {
      svc.depends_on = service.depends;
    }

    if (service.restart) {
      svc.restart = service.restart;
    }

    if (service.resources) {
      svc.deploy = {
        resources: {
          limits: {
            cpus: service.resources.cpus?.toString(),
            memory: service.resources.memory,
          },
        },
      };
    }

    if (service.healthCheck) {
      if (service.healthCheck.command) {
        svc.healthcheck = {
          test: ['CMD-SHELL', service.healthCheck.command],
          interval: `${(service.healthCheck.interval || 30000) / 1000}s`,
          timeout: `${(service.healthCheck.timeout || 5000) / 1000}s`,
          retries: service.healthCheck.retries || 3,
        };
      }
    }

    (compose.services as Record<string, unknown>)[service.name] = svc;
  }

  if (config.networks) {
    compose.networks = Object.fromEntries(
      config.networks.map(n => [n, { driver: 'bridge' }])
    );
  }

  if (config.volumes) {
    compose.volumes = Object.fromEntries(
      config.volumes.map(v => [v, {}])
    );
  }

  // Convert to YAML-like format (simplified)
  return JSON.stringify(compose, null, 2);
}

// =============================================================================
// EXPORTS
// =============================================================================

export const docker = new DockerManager();
export const processes = new ProcessManager();

// Re-export retry infrastructure
export * from './retry';
