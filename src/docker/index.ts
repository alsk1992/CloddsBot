/**
 * Docker Module - Docker sandbox mode
 *
 * Features:
 * - Container management
 * - Sandbox execution
 * - Volume mounting
 * - Network isolation
 * - Image management
 */

import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

function sanitizeDockerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '');
}

// =============================================================================
// TYPES
// =============================================================================

export interface ContainerConfig {
  image: string;
  name?: string;
  command?: string[];
  env?: Record<string, string>;
  volumes?: Array<{ host: string; container: string; readonly?: boolean }>;
  ports?: Array<{ host: number; container: number; protocol?: 'tcp' | 'udp' }>;
  network?: string;
  workdir?: string;
  user?: string;
  memory?: string;
  cpus?: number;
  readonly?: boolean;
  autoRemove?: boolean;
  detach?: boolean;
  interactive?: boolean;
  tty?: boolean;
  labels?: Record<string, string>;
  privileged?: boolean;
  capAdd?: string[];
  capDrop?: string[];
}

export interface Container {
  id: string;
  name: string;
  image: string;
  status: 'created' | 'running' | 'paused' | 'stopped' | 'dead';
  ports: Array<{ host: number; container: number }>;
  createdAt: Date;
  startedAt?: Date;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: number;
  createdAt: Date;
}

export interface SandboxConfig {
  image?: string;
  name?: string;
  timeout?: number;
  memoryLimit?: string;
  cpuLimit?: number;
  networkEnabled?: boolean;
  workdir?: string;
  env?: Record<string, string>;
  mounts?: Array<{ host: string; container: string }>;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
}

// =============================================================================
// DOCKER CLIENT
// =============================================================================

export class DockerClient extends EventEmitter {
  private prefix: string;

  constructor(prefix = 'clodds') {
    super();
    this.prefix = prefix;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('docker', ['info']);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<{ client: string; server: string }> {
    const { stdout } = await execFileAsync('docker', ['version', '--format', '{{.Client.Version}}|{{.Server.Version}}']);
    const [client, server] = stdout.trim().split('|');
    return { client, server };
  }

  /** List containers */
  async listContainers(all = false): Promise<Container[]> {
    const args = ['ps', '--format', '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}'];
    if (all) args.push('-a');

    const { stdout } = await execFileAsync('docker', args);
    const lines = stdout.trim().split('\n').filter(Boolean);

    return lines.map(line => {
      const [id, name, image, status, ports, createdAt] = line.split('|');
      return {
        id: id.trim(),
        name: name.trim(),
        image: image.trim(),
        status: this.parseStatus(status),
        ports: this.parsePorts(ports),
        createdAt: new Date(createdAt),
      };
    });
  }

  private parseStatus(status: string): Container['status'] {
    const lower = status.toLowerCase();
    if (lower.includes('up')) return 'running';
    if (lower.includes('paused')) return 'paused';
    if (lower.includes('exited')) return 'stopped';
    if (lower.includes('dead')) return 'dead';
    return 'created';
  }

  private parsePorts(ports: string): Array<{ host: number; container: number }> {
    const result: Array<{ host: number; container: number }> = [];
    const matches = ports.matchAll(/(\d+)->(\d+)/g);
    for (const match of matches) {
      result.push({ host: parseInt(match[1], 10), container: parseInt(match[2], 10) });
    }
    return result;
  }

  /** Create and start a container */
  async run(config: ContainerConfig): Promise<string> {
    const args = ['run'];

    const name = sanitizeDockerName(config.name || `${this.prefix}-${randomBytes(4).toString('hex')}`);
    args.push('--name', name);

    // Detach
    if (config.detach !== false) {
      args.push('-d');
    }

    // Interactive/TTY
    if (config.interactive) args.push('-i');
    if (config.tty) args.push('-t');

    // Auto-remove
    if (config.autoRemove) args.push('--rm');

    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    if (config.volumes) {
      for (const vol of config.volumes) {
        const mode = vol.readonly ? ':ro' : '';
        args.push('-v', `${vol.host}:${vol.container}${mode}`);
      }
    }

    if (config.ports) {
      for (const port of config.ports) {
        const proto = port.protocol || 'tcp';
        args.push('-p', `${port.host}:${port.container}/${proto}`);
      }
    }

    if (config.network) {
      args.push('--network', config.network);
    }

    if (config.workdir) {
      args.push('-w', config.workdir);
    }

    if (config.user) {
      args.push('-u', config.user);
    }

    if (config.memory) {
      args.push('-m', config.memory);
    }
    if (config.cpus) {
      args.push('--cpus', String(config.cpus));
    }

    if (config.readonly) {
      args.push('--read-only');
    }

    if (config.labels) {
      for (const [key, value] of Object.entries(config.labels)) {
        args.push('-l', `${key}=${value}`);
      }
    }

    if (config.privileged) {
      args.push('--privileged');
    }
    if (config.capAdd) {
      for (const cap of config.capAdd) {
        args.push('--cap-add', cap);
      }
    }
    if (config.capDrop) {
      for (const cap of config.capDrop) {
        args.push('--cap-drop', cap);
      }
    }

    args.push(config.image);

    if (config.command) {
      args.push(...config.command);
    }

    const { stdout } = await execFileAsync('docker', args);
    const containerId = stdout.trim();

    logger.info({ containerId, name, image: config.image }, 'Container started');
    this.emit('container:start', { id: containerId, name });

    return containerId;
  }

  async stop(containerId: string, timeout = 10): Promise<void> {
    await execFileAsync('docker', ['stop', '-t', String(timeout), containerId]);
    logger.info({ containerId }, 'Container stopped');
    this.emit('container:stop', { id: containerId });
  }

  async kill(containerId: string, signal = 'KILL'): Promise<void> {
    await execFileAsync('docker', ['kill', '-s', signal, containerId]);
    logger.info({ containerId }, 'Container killed');
    this.emit('container:kill', { id: containerId });
  }

  async remove(containerId: string, force = false): Promise<void> {
    const args = ['rm'];
    if (force) args.push('-f');
    args.push(containerId);
    await execFileAsync('docker', args);
    logger.info({ containerId }, 'Container removed');
    this.emit('container:remove', { id: containerId });
  }

  /** Execute a command in a running container */
  async exec(containerId: string, command: string[], options?: {
    interactive?: boolean;
    tty?: boolean;
    user?: string;
    workdir?: string;
    env?: Record<string, string>;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const args = ['exec'];

    if (options?.interactive) args.push('-i');
    if (options?.tty) args.push('-t');
    if (options?.user) args.push('-u', options.user);
    if (options?.workdir) args.push('-w', options.workdir);

    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    args.push(containerId, ...command);

    try {
      const { stdout, stderr } = await execFileAsync('docker', args);
      return { stdout, stderr, exitCode: 0 };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        exitCode: err.code ?? 1,
      };
    }
  }

  /** Get container logs */
  async logs(containerId: string, options?: {
    follow?: boolean;
    tail?: number;
    since?: string;
    timestamps?: boolean;
  }): Promise<string> {
    const args = ['logs'];

    if (options?.tail != null) args.push('--tail', String(options.tail));
    if (options?.since) args.push('--since', options.since);
    if (options?.timestamps) args.push('-t');

    args.push(containerId);

    const { stdout, stderr } = await execFileAsync('docker', args);
    return stdout + stderr;
  }

  streamLogs(containerId: string, options?: { tail?: number }): ChildProcess {
    const args = ['logs', '-f'];
    if (options?.tail != null) args.push('--tail', String(options.tail));
    args.push(containerId);

    return spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  async stats(containerId: string): Promise<ContainerStats> {
    const { stdout } = await execFileAsync('docker', [
      'stats', containerId, '--no-stream',
      '--format', '{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}'
    ]);

    const parts = stdout.trim().split('|');

    const parseSize = (s: string): number => {
      const match = s.match(/([\d.]+)([KMGT]?i?B)/i);
      if (!match) return 0;
      const value = parseFloat(match[1]);
      const unit = match[2].toUpperCase();
      const multipliers: Record<string, number> = {
        'B': 1, 'KB': 1024, 'KIB': 1024, 'MB': 1024 ** 2, 'MIB': 1024 ** 2,
        'GB': 1024 ** 3, 'GIB': 1024 ** 3, 'TB': 1024 ** 4, 'TIB': 1024 ** 4,
      };
      return value * (multipliers[unit] || 1);
    };

    const [memUsage, memLimit] = parts[1].split('/').map(s => parseSize(s.trim()));
    const [netRx, netTx] = parts[3].split('/').map(s => parseSize(s.trim()));
    const [blockRead, blockWrite] = parts[4].split('/').map(s => parseSize(s.trim()));

    return {
      cpuPercent: parseFloat(parts[0]) || 0,
      memoryUsage: memUsage,
      memoryLimit: memLimit,
      memoryPercent: parseFloat(parts[2]) || 0,
      networkRx: netRx,
      networkTx: netTx,
      blockRead,
      blockWrite,
    };
  }

  async listImages(): Promise<DockerImage[]> {
    const { stdout } = await execFileAsync('docker', [
      'images', '--format', '{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}'
    ]);

    const lines = stdout.trim().split('\n').filter(Boolean);

    return lines.map(line => {
      const [id, repository, tag, size, createdAt] = line.split('|');

      const parseSize = (s: string): number => {
        const match = s.match(/([\d.]+)([KMGT]?B)/i);
        if (!match) return 0;
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        const multipliers: Record<string, number> = {
          'B': 1, 'KB': 1024, 'MB': 1024 ** 2, 'GB': 1024 ** 3, 'TB': 1024 ** 4,
        };
        return value * (multipliers[unit] || 1);
      };

      return {
        id: id.trim(),
        repository: repository.trim(),
        tag: tag.trim(),
        size: parseSize(size),
        createdAt: new Date(createdAt),
      };
    });
  }

  async pull(image: string): Promise<void> {
    logger.info({ image }, 'Pulling Docker image');
    await execFileAsync('docker', ['pull', image]);
    logger.info({ image }, 'Docker image pulled');
    this.emit('image:pull', { image });
  }

  /** Build an image */
  async build(path: string, options?: {
    tag?: string;
    dockerfile?: string;
    buildArgs?: Record<string, string>;
    noCache?: boolean;
  }): Promise<string> {
    const args = ['build'];

    if (options?.tag) args.push('-t', options.tag);
    if (options?.dockerfile) args.push('-f', options.dockerfile);
    if (options?.noCache) args.push('--no-cache');

    if (options?.buildArgs) {
      for (const [key, value] of Object.entries(options.buildArgs)) {
        args.push('--build-arg', `${key}=${value}`);
      }
    }

    args.push(path);

    logger.info({ path, tag: options?.tag }, 'Building Docker image');
    const { stdout } = await execFileAsync('docker', args);

    // Extract image ID from output
    const match = stdout.match(/Successfully built ([a-f0-9]+)/);
    const imageId = match ? match[1] : options?.tag || 'unknown';

    logger.info({ imageId }, 'Docker image built');
    this.emit('image:build', { id: imageId });

    return imageId;
  }

  async removeImage(imageId: string, force = false): Promise<void> {
    const args = ['rmi'];
    if (force) args.push('-f');
    args.push(imageId);
    await execFileAsync('docker', args);
    this.emit('image:remove', { id: imageId });
  }

  /** Create a network */
  async createNetwork(name: string, options?: {
    driver?: string;
    subnet?: string;
    gateway?: string;
    internal?: boolean;
  }): Promise<string> {
    const args = ['network', 'create'];

    if (options?.driver) args.push('--driver', options.driver);
    if (options?.subnet) args.push('--subnet', options.subnet);
    if (options?.gateway) args.push('--gateway', options.gateway);
    if (options?.internal) args.push('--internal');

    args.push(name);

    const { stdout } = await execFileAsync('docker', args);
    return stdout.trim();
  }

  async removeNetwork(name: string): Promise<void> {
    await execFileAsync('docker', ['network', 'rm', name]);
  }

  /** Prune unused resources */
  async prune(options?: {
    containers?: boolean;
    images?: boolean;
    volumes?: boolean;
    networks?: boolean;
    all?: boolean;
  }): Promise<void> {
    if (options?.all || options?.containers) {
      await execFileAsync('docker', ['container', 'prune', '-f']);
    }
    if (options?.all || options?.images) {
      await execFileAsync('docker', ['image', 'prune', '-f']);
    }
    if (options?.all || options?.volumes) {
      await execFileAsync('docker', ['volume', 'prune', '-f']);
    }
    if (options?.all || options?.networks) {
      await execFileAsync('docker', ['network', 'prune', '-f']);
    }
  }
}

// =============================================================================
// SANDBOX
// =============================================================================

export class Sandbox {
  private docker: DockerClient;
  private config: Required<SandboxConfig>;

  constructor(docker: DockerClient, config: SandboxConfig = {}) {
    this.docker = docker;
    this.config = {
      image: config.image || 'python:3.11-slim',
      name: config.name || `sandbox-${randomBytes(4).toString('hex')}`,
      timeout: config.timeout ?? 30000,
      memoryLimit: config.memoryLimit || '256m',
      cpuLimit: config.cpuLimit ?? 0.5,
      networkEnabled: config.networkEnabled ?? false,
      workdir: config.workdir || '/sandbox',
      env: config.env ?? {},
      mounts: config.mounts ?? [],
    };
  }

  /** Execute code in the sandbox */
  async execute(code: string, options?: {
    language?: 'python' | 'node' | 'bash' | 'ruby';
    args?: string[];
  }): Promise<SandboxResult> {
    const language = options?.language || 'python';
    const startTime = Date.now();

    // Determine command based on language
    let command: string[];
    switch (language) {
      case 'python':
        command = ['python', '-c', code];
        break;
      case 'node':
        command = ['node', '-e', code];
        break;
      case 'bash':
        command = ['bash', '-c', code];
        break;
      case 'ruby':
        command = ['ruby', '-e', code];
        break;
      default:
        command = ['sh', '-c', code];
    }

    if (options?.args) {
      command.push(...options.args);
    }

    const volumes = this.config.mounts.map(m => ({
      host: m.host,
      container: m.container,
      readonly: true,
    }));

    try {
      // Run container with timeout
      const containerId = await this.docker.run({
        image: this.config.image,
        name: this.config.name,
        command,
        env: this.config.env,
        volumes,
        memory: this.config.memoryLimit,
        cpus: this.config.cpuLimit,
        workdir: this.config.workdir,
        network: this.config.networkEnabled ? undefined : 'none',
        autoRemove: true,
        readonly: true,
        detach: false,
        capDrop: ['ALL'],
      });

      let timeoutId: NodeJS.Timeout;
      const timeoutPromise = new Promise<SandboxResult>((resolve) => {
        timeoutId = setTimeout(async () => {
          try {
            await this.docker.kill(containerId);
          } catch (err) { logger.warn({ error: err, containerId }, 'Failed to kill timed-out container'); }
          resolve({
            exitCode: 124,
            stdout: '',
            stderr: 'Execution timed out',
            duration: this.config.timeout,
            timedOut: true,
          });
        }, this.config.timeout);
      });

      const execPromise = (async (): Promise<SandboxResult> => {
        const logs = await this.docker.logs(containerId);
        const duration = Date.now() - startTime;
        return {
          exitCode: 0,
          stdout: logs,
          stderr: '',
          duration,
          timedOut: false,
        };
      })();

      const result = await Promise.race([execPromise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      return {
        exitCode: err.code ?? 1,
        stdout: err.stdout ?? '',
        stderr: err.stderr || String(error),
        duration: Date.now() - startTime,
        timedOut: false,
      };
    }
  }

  /** Execute a script file in the sandbox */
  async executeFile(filePath: string, options?: {
    language?: 'python' | 'node' | 'bash' | 'ruby';
    args?: string[];
  }): Promise<SandboxResult> {
    const language = options?.language || 'python';

    let command: string[];
    switch (language) {
      case 'python':
        command = ['python', '/script'];
        break;
      case 'node':
        command = ['node', '/script'];
        break;
      case 'bash':
        command = ['bash', '/script'];
        break;
      case 'ruby':
        command = ['ruby', '/script'];
        break;
      default:
        command = ['sh', '/script'];
    }

    if (options?.args) {
      command.push(...options.args);
    }

    // Mount the script file
    const volumes = [
      ...this.config.mounts.map(m => ({ host: m.host, container: m.container, readonly: true })),
      { host: filePath, container: '/script', readonly: true },
    ];

    const startTime = Date.now();

    try {
      const containerId = await this.docker.run({
        image: this.config.image,
        name: `${this.config.name}-file`,
        command,
        env: this.config.env,
        volumes,
        memory: this.config.memoryLimit,
        cpus: this.config.cpuLimit,
        workdir: this.config.workdir,
        network: this.config.networkEnabled ? undefined : 'none',
        autoRemove: true,
        readonly: true,
        detach: false,
        capDrop: ['ALL'],
      });

      const logs = await this.docker.logs(containerId);
      return {
        exitCode: 0,
        stdout: logs,
        stderr: '',
        duration: Date.now() - startTime,
        timedOut: false,
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      return {
        exitCode: err.code ?? 1,
        stdout: err.stdout ?? '',
        stderr: err.stderr || String(error),
        duration: Date.now() - startTime,
        timedOut: false,
      };
    }
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createDockerClient(prefix?: string): DockerClient {
  return new DockerClient(prefix);
}

export function createSandbox(docker: DockerClient, config?: SandboxConfig): Sandbox {
  return new Sandbox(docker, config);
}

// =============================================================================
// DEFAULT INSTANCES
// =============================================================================

export const docker = new DockerClient();
