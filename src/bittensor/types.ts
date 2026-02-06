/**
 * Bittensor Subnet Mining Integration - Type Definitions
 */

import type { Database } from '../db';

// =============================================================================
// CONFIGURATION
// =============================================================================

export type BittensorNetwork = 'mainnet' | 'testnet' | 'local';

export interface BittensorConfig {
  enabled: boolean;
  network: BittensorNetwork;
  subtensorUrl?: string;
  coldkeyPath?: string;
  coldkeyPassword?: string;
  pythonPath?: string;
  subnets?: SubnetMinerConfig[];
  earningsPollIntervalMs?: number;
  /** Override TAO/USD price. If unset, fetched from CoinGecko. */
  taoPriceUsd?: number;
}

export type SubnetType = 'chutes' | 'apex' | 'nineteen' | 'custom';

export interface SubnetMinerConfig {
  subnetId: number;
  type: SubnetType;
  enabled: boolean;
  hotkeyName?: string;
  chutesConfig?: ChutesConfig;
  customConfig?: Record<string, unknown>;
}

export interface ChutesConfig {
  minerApiPort: number;
  gpuNodes: GpuNode[];
  dockerImage?: string;
  maxConcurrentInvocations?: number;
}

export interface GpuNode {
  name: string;
  ip: string;
  gpuType: string;
  gpuCount: number;
  hourlyCostUsd: number;
  port?: number;
}

// =============================================================================
// WALLET & ON-CHAIN DATA
// =============================================================================

export interface TaoWalletInfo {
  coldkeyAddress: string;
  hotkeys: HotkeyInfo[];
  balance: TaoBalance;
  network: BittensorNetwork;
}

export interface HotkeyInfo {
  address: string;
  name: string;
  registeredSubnets: number[];
}

export interface TaoBalance {
  free: number;
  staked: number;
  total: number;
}

// =============================================================================
// MINER STATUS
// =============================================================================

export interface MinerStatus {
  subnetId: number;
  hotkey: string;
  uid: number;
  trust: number;
  incentive: number;
  emission: number;
  rank: number;
  active: boolean;
  updatedAt: Date;
}

export interface SubnetInfo {
  netuid: number;
  name: string;
  minerCount: number;
  validatorCount: number;
  emissionPct: number;
  registrationCost: number;
  immunityPeriodBlocks: number;
}

// =============================================================================
// EARNINGS & COSTS
// =============================================================================

export interface MinerEarnings {
  subnetId: number;
  hotkey: string;
  taoEarned: number;
  usdEarned: number;
  apiCost: number;
  infraCost: number;
  netProfit: number;
  period: EarningsPeriod;
  createdAt: Date;
}

export type EarningsPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'all';

export interface CostLogEntry {
  id?: number;
  category: 'gpu' | 'api' | 'registration' | 'other';
  description: string;
  amountUsd: number;
  amountTao: number;
  subnetId?: number;
  createdAt: Date;
}

// =============================================================================
// CHUTES-SPECIFIC
// =============================================================================

export interface ChutesStatus {
  running: boolean;
  gpuNodes: GpuNodeStatus[];
  activeDeployments: number;
  totalInvocations: number;
  uptimeSeconds: number;
}

export interface GpuNodeStatus {
  name: string;
  ip: string;
  gpuType: string;
  gpuCount: number;
  online: boolean;
  gpuUtilizationPct: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
}

export interface InvocationStats {
  totalInvocations: number;
  computeHours: number;
  estimatedEarningsTao: number;
  estimatedEarningsUsd: number;
  periodStart: Date;
  periodEnd: Date;
}

// =============================================================================
// SERVICE INTERFACE
// =============================================================================

export interface BittensorService {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<BittensorServiceStatus>;
  getWalletInfo(): Promise<TaoWalletInfo | null>;
  getEarnings(period: EarningsPeriod): Promise<MinerEarnings[]>;
  getMinerStatuses(): Promise<MinerStatus[]>;
  getSubnets(): Promise<SubnetInfo[]>;
  registerOnSubnet(subnetId: number, hotkeyName?: string): Promise<{ success: boolean; message: string }>;
  startMining(subnetId: number): Promise<{ success: boolean; message: string }>;
  stopMining(subnetId: number): Promise<{ success: boolean; message: string }>;
}

export interface BittensorServiceStatus {
  connected: boolean;
  network: BittensorNetwork;
  walletLoaded: boolean;
  activeMiners: ActiveMinerSummary[];
  totalTaoEarned: number;
  totalUsdEarned: number;
}

export interface ActiveMinerSummary {
  subnetId: number;
  type: SubnetType;
  running: boolean;
  uid?: number;
  emission?: number;
  rank?: number;
}

// =============================================================================
// PYTHON RUNNER
// =============================================================================

export interface PythonRunner {
  exec(cmd: string, args: string[], timeout?: number): Promise<PythonExecResult>;
  spawn(cmd: string, args: string[], logPrefix: string): PythonProcess;
  btcli(args: string[], timeout?: number): Promise<PythonExecResult>;
}

export interface PythonExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface PythonProcess {
  pid: number | undefined;
  kill(): void;
  onExit(cb: (code: number | null) => void): void;
  onStdout(cb: (data: string) => void): void;
  onStderr(cb: (data: string) => void): void;
}

// =============================================================================
// PERSISTENCE
// =============================================================================

export interface BittensorPersistence {
  init(): void;
  saveEarnings(earnings: Omit<MinerEarnings, 'createdAt'>): void;
  getEarnings(period: EarningsPeriod, subnetId?: number): MinerEarnings[];
  saveMinerStatus(status: Omit<MinerStatus, 'updatedAt'>): void;
  getMinerStatuses(): MinerStatus[];
  getMinerStatus(subnetId: number, hotkey: string): MinerStatus | null;
  logCost(entry: Omit<CostLogEntry, 'id' | 'createdAt'>): void;
  getCosts(since?: Date): CostLogEntry[];
  db: Database;
}
