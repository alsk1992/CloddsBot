/**
 * Chutes (SN64) Miner Manager
 * Manages GPU compute nodes for Bittensor's serverless AI compute subnet.
 */

import type {
  ChutesConfig,
  ChutesStatus,
  GpuNode,
  GpuNodeStatus,
  InvocationStats,
  PythonRunner,
  PythonProcess,
} from './types';

export interface ChutesMinerManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ChutesStatus;
  addGpuNode(node: GpuNode): void;
  removeGpuNode(name: string): boolean;
  getInvocationStats(): InvocationStats;
}

export function createChutesMinerManager(
  config: ChutesConfig,
  runner: PythonRunner
): ChutesMinerManager {
  let running = false;
  let minerProcess: PythonProcess | null = null;
  let startTime: Date | null = null;
  const gpuNodes: GpuNode[] = [...config.gpuNodes];
  const nodeStatuses = new Map<string, GpuNodeStatus>();
  let totalInvocations = 0;
  let totalComputeHours = 0;

  function buildNodeStatus(node: GpuNode): GpuNodeStatus {
    return {
      name: node.name,
      ip: node.ip,
      gpuType: node.gpuType,
      gpuCount: node.gpuCount,
      online: false,
      gpuUtilizationPct: 0,
      memoryUsedGb: 0,
      memoryTotalGb: 0,
    };
  }

  for (const node of gpuNodes) {
    nodeStatuses.set(node.name, buildNodeStatus(node));
  }

  async function start(): Promise<void> {
    if (running) return;

    const args = [
      '-m', 'chutes.miner',
      '--port', String(config.minerApiPort),
    ];

    if (config.dockerImage) {
      args.push('--image', config.dockerImage);
    }

    if (config.maxConcurrentInvocations) {
      args.push('--max-concurrent', String(config.maxConcurrentInvocations));
    }

    for (const node of gpuNodes) {
      args.push('--gpu-node', `${node.ip}:${node.port ?? 32000}`);
    }

    minerProcess = runner.spawn('python3', args, 'chutes-miner');

    minerProcess.onStdout((data) => {
      const match = data.match(/invocations?: (\d+)/i);
      if (match) {
        totalInvocations = parseInt(match[1], 10);
      }
    });

    minerProcess.onExit((code) => {
      running = false;
      minerProcess = null;
      if (code !== 0 && code !== null) {
        console.error(`[chutes] Miner process exited with code ${code}`);
      }
    });

    running = true;
    startTime = new Date();

    for (const node of gpuNodes) {
      const status = nodeStatuses.get(node.name);
      if (status) {
        status.online = true;
      }
    }
  }

  async function stop(): Promise<void> {
    if (!running || !minerProcess) return;

    minerProcess.kill();
    minerProcess = null;
    running = false;

    for (const [, status] of nodeStatuses) {
      status.online = false;
    }
  }

  function getStatus(): ChutesStatus {
    const uptimeSeconds = startTime
      ? Math.floor((Date.now() - startTime.getTime()) / 1000)
      : 0;

    return {
      running,
      gpuNodes: Array.from(nodeStatuses.values()),
      activeDeployments: running ? gpuNodes.length : 0,
      totalInvocations,
      uptimeSeconds,
    };
  }

  function addGpuNode(node: GpuNode): void {
    gpuNodes.push(node);
    nodeStatuses.set(node.name, buildNodeStatus(node));
  }

  function removeGpuNode(name: string): boolean {
    const idx = gpuNodes.findIndex((n) => n.name === name);
    if (idx === -1) return false;

    gpuNodes.splice(idx, 1);
    nodeStatuses.delete(name);
    return true;
  }

  function getInvocationStats(): InvocationStats {
    const now = new Date();
    const periodStart = startTime ?? now;

    if (startTime) {
      const hours = (now.getTime() - startTime.getTime()) / 3_600_000;
      const activeGpus = gpuNodes.reduce((sum, n) => sum + n.gpuCount, 0);
      totalComputeHours = hours * activeGpus;
    }

    const estimatedTaoPerGpuHour = 0.001;
    // totalComputeHours already accounts for GPU count (hours * activeGpus)
    const estimatedTao = totalComputeHours * estimatedTaoPerGpuHour;

    return {
      totalInvocations,
      computeHours: totalComputeHours,
      estimatedEarningsTao: estimatedTao,
      estimatedEarningsUsd: estimatedTao * 170,
      periodStart,
      periodEnd: now,
    };
  }

  return {
    start,
    stop,
    getStatus,
    addGpuNode,
    removeGpuNode,
    getInvocationStats,
  };
}
