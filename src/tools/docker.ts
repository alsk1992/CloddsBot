/**
 * Docker Tool - safe wrappers around the Docker CLI
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { assertSandboxPath, resolveSandboxPath } from '../permissions';
import { logger } from '../utils/logger';

export interface DockerContainerInfo {
  id: string;
  image: string;
  names: string;
  status: string;
  state: string;
  ports?: string;
}

export interface DockerImageInfo {
  repository: string;
  tag: string;
  id: string;
  size: string;
  createdSince?: string;
}

export interface DockerRunOptions {
  image: string;
  name?: string;
  command?: string[];
  env?: Record<string, string>;
  ports?: Array<{ host: number; container: number }>;
  volumes?: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
  detach?: boolean;
  workdir?: string;
  network?: string;
}

export interface DockerTool {
  isAvailable(): boolean;
  listContainers(all?: boolean): Promise<DockerContainerInfo[]>;
  listImages(): Promise<DockerImageInfo[]>;
  run(options: DockerRunOptions): Promise<{ ok: boolean; idOrName?: string; output?: string }>;
  stop(container: string, timeoutSeconds?: number): Promise<{ ok: boolean; output?: string }>;
  remove(container: string, force?: boolean): Promise<{ ok: boolean; output?: string }>;
  logs(container: string, tail?: number): Promise<{ ok: boolean; output: string }>;
}

interface DockerRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

const DEFAULT_LOG_TAIL = 200;

function runDocker(args: string[], cwd?: string): DockerRunResult {
  try {
    const res = spawnSync('docker', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      ok: res.status === 0,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
      code: res.status ?? 1,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return {
        ok: false,
        stdout: '',
        stderr: 'docker CLI not found. Install Docker Desktop or the docker CLI.',
        code: 127,
      };
    }
    return {
      ok: false,
      stdout: '',
      stderr: err.message,
      code: 1,
    };
  }
}

function parseJsonLines<T>(text: string): T[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try { return JSON.parse(line) as T; }
      catch { return null; }
    })
    .filter((item): item is T => item !== null);
}

function ensureVolumePath(workspaceRoot: string, hostPath: string): string {
  const resolved = resolveSandboxPath(hostPath, { root: workspaceRoot, allowSymlinks: false });
  assertSandboxPath(resolved, { root: workspaceRoot, allowSymlinks: false });
  if (!existsSync(resolved)) {
    throw new Error(`Volume host path does not exist: ${hostPath}`);
  }
  return resolved;
}

function clampTail(value?: number): number {
  if (!value || Number.isNaN(value)) return DEFAULT_LOG_TAIL;
  return Math.max(1, Math.min(5000, Math.floor(value)));
}

export function createDockerTool(workspaceRoot: string): DockerTool {
  const root = workspaceRoot;

  return {
    isAvailable() {
      const res = runDocker(['version', '--format', '{{json .Client}}']);
      return res.ok;
    },

    async listContainers(all = true) {
      const args = ['ps', '--format', '{{json .}}'];
      if (all) args.splice(1, 0, '-a');

      const res = runDocker(args);
      if (!res.ok) {
        throw new Error(res.stderr || `docker ps failed (exit ${res.code})`);
      }

      type Raw = {
        ID: string;
        Image: string;
        Names: string;
        Status: string;
        State: string;
        Ports?: string;
      };

      const rows = parseJsonLines<Raw>(res.stdout);
      return rows.map((r) => ({
        id: r.ID,
        image: r.Image,
        names: r.Names,
        status: r.Status,
        state: r.State,
        ports: r.Ports,
      }));
    },

    async listImages() {
      const res = runDocker(['images', '--format', '{{json .}}']);
      if (!res.ok) {
        throw new Error(res.stderr || `docker images failed (exit ${res.code})`);
      }

      type Raw = {
        Repository: string;
        Tag: string;
        ID: string;
        Size: string;
        CreatedSince?: string;
      };

      const rows = parseJsonLines<Raw>(res.stdout);
      return rows.map((r) => ({
        repository: r.Repository,
        tag: r.Tag,
        id: r.ID,
        size: r.Size,
        createdSince: r.CreatedSince,
      }));
    },

    async run(options: DockerRunOptions) {
      if (!options?.image?.trim()) {
        throw new Error('Docker run requires an image');
      }

      const args: string[] = ['run'];
      const detach = options.detach !== false;
      if (detach) args.push('-d');

      args.push('--cap-drop=ALL', '--security-opt', 'no-new-privileges');

      if (options.name?.trim()) {
        args.push('--name', options.name.trim());
      }

      if (options.workdir?.trim()) {
        args.push('-w', options.workdir.trim());
      }

      if (options.network?.trim()) {
        args.push('--network', options.network.trim());
      }

      if (options.env) {
        for (const [key, value] of Object.entries(options.env)) {
          args.push('-e', `${key}=${value}`);
        }
      }

      if (options.ports) {
        for (const p of options.ports) {
          args.push('-p', `${p.host}:${p.container}`);
        }
      }

      // Always mount the workspace read-write at /workspace.
      args.push('-v', `${root}:/workspace`);

      if (options.volumes) {
        for (const v of options.volumes) {
          const host = ensureVolumePath(root, v.hostPath);
          const mode = v.readOnly ? ':ro' : '';
          args.push('-v', `${host}:${v.containerPath}${mode}`);
        }
      }

      args.push(options.image.trim());

      if (options.command?.length) {
        args.push(...options.command);
      }

      logger.info({ image: options.image, detach }, 'Running docker container');
      const res = runDocker(args, root);

      if (!res.ok) {
        throw new Error(res.stderr || `docker run failed (exit ${res.code})`);
      }

      return {
        ok: true,
        idOrName: res.stdout.trim() || options.name,
        output: res.stderr.trim() || undefined,
      };
    },

    async stop(container: string, timeoutSeconds = 10) {
      if (!container?.trim()) throw new Error('Container name or id is required');
      const res = runDocker(['stop', '-t', String(timeoutSeconds), container.trim()]);
      if (!res.ok) {
        throw new Error(res.stderr || `docker stop failed (exit ${res.code})`);
      }
      return { ok: true, output: res.stdout.trim() };
    },

    async remove(container: string, force = false) {
      if (!container?.trim()) throw new Error('Container name or id is required');
      const args = ['rm'];
      if (force) args.push('-f');
      args.push(container.trim());
      const res = runDocker(args);
      if (!res.ok) {
        throw new Error(res.stderr || `docker rm failed (exit ${res.code})`);
      }
      return { ok: true, output: res.stdout.trim() };
    },

    async logs(container: string, tail?: number) {
      if (!container?.trim()) throw new Error('Container name or id is required');
      const t = clampTail(tail);
      const res = runDocker(['logs', '--tail', String(t), container.trim()]);
      if (!res.ok) {
        throw new Error(res.stderr || `docker logs failed (exit ${res.code})`);
      }
      // docker logs writes to stderr in many cases; include both.
      const output = [res.stdout, res.stderr].filter(Boolean).join('\n').trim();
      return { ok: true, output };
    },
  };
}
