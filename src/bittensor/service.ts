/**
 * Bittensor Service
 * Orchestrates wallet connection, python runner, subnet miners, and earnings tracking.
 */

import type { ApiPromise } from '@polkadot/api';
import type { Database } from '../db';
import { logger } from '../utils/logger';
import type {
  BittensorConfig,
  BittensorService,
  BittensorServiceStatus,
  ActiveMinerSummary,
  MinerEarnings,
  MinerStatus,
  SubnetInfo,
  EarningsPeriod,
  TaoWalletInfo,
} from './types';
import {
  connectToSubtensor,
  disconnectFromSubtensor,
  getWalletInfo,
  getBalance,
  getMinerInfo,
  listSubnets,
  registerOnSubnet as walletRegister,
} from './wallet';
import { createPythonRunner } from './python-runner';
import { createBittensorPersistence } from './persistence';
import { createChutesMinerManager, type ChutesMinerManager } from './chutes';

export function createBittensorService(
  config: BittensorConfig,
  db: Database
): BittensorService {
  let api: ApiPromise | null = null;
  let connected = false;
  let walletInfo: TaoWalletInfo | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const runner = createPythonRunner(config.pythonPath);
  const persistence = createBittensorPersistence(db);
  const minerManagers = new Map<number, ChutesMinerManager>();

  persistence.init();

  for (const subnet of config.subnets ?? []) {
    if (subnet.type === 'chutes' && subnet.chutesConfig) {
      const manager = createChutesMinerManager(subnet.chutesConfig, runner);
      minerManagers.set(subnet.subnetId, manager);
    }
  }

  async function start(): Promise<void> {
    if (!config.enabled) return;

    try {
      const url = config.subtensorUrl ?? 'wss://entrypoint-finney.opentensor.ai:443';
      logger.info(`[bittensor] Connecting to ${config.network} at ${url}`);
      api = await connectToSubtensor(url);
      connected = true;
      logger.info('[bittensor] Connected to Subtensor');

      if (config.coldkeyPath) {
        const result = await runner.btcli([
          'wallet', 'overview',
          '--wallet.path', config.coldkeyPath,
          '--no_prompt',
        ]);

        const addressMatch = result.stdout.match(/coldkey:\s*(\w{48})/);
        if (addressMatch) {
          walletInfo = await getWalletInfo(api, addressMatch[1], config.network);
          logger.info(`[bittensor] Wallet loaded: ${addressMatch[1]}`);
        }
      }

      for (const subnet of config.subnets ?? []) {
        if (subnet.enabled) {
          const manager = minerManagers.get(subnet.subnetId);
          if (manager) {
            await manager.start();
            logger.info(`[bittensor] Started miner on SN${subnet.subnetId}`);
          }
        }
      }

      const pollMs = config.earningsPollIntervalMs ?? 300_000;
      pollInterval = setInterval(() => {
        pollEarnings().catch((err) => {
          logger.warn({ err }, '[bittensor] Earnings poll failed');
        });
      }, pollMs);

    } catch (err) {
      logger.error(`[bittensor] Failed to start: ${err instanceof Error ? err.message : err}`);
      connected = false;
    }
  }

  async function stop(): Promise<void> {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    for (const [subnetId, manager] of minerManagers) {
      await manager.stop();
      logger.info(`[bittensor] Stopped miner on SN${subnetId}`);
    }

    if (api) {
      await disconnectFromSubtensor(api);
      api = null;
    }

    connected = false;
    logger.info('[bittensor] Service stopped');
  }

  async function pollEarnings(): Promise<void> {
    if (!api || !walletInfo) return;

    for (const subnet of config.subnets ?? []) {
      if (!subnet.enabled) continue;

      for (const hotkey of walletInfo.hotkeys) {
        if (!hotkey.registeredSubnets.includes(subnet.subnetId)) continue;

        const minerInfo = await getMinerInfo(api, subnet.subnetId, hotkey.address);
        if (!minerInfo) continue;

        persistence.saveMinerStatus(minerInfo);

        const taoEarned = minerInfo.emission;
        if (taoEarned > 0) {
          persistence.saveEarnings({
            subnetId: subnet.subnetId,
            hotkey: hotkey.address,
            taoEarned,
            usdEarned: taoEarned * 170,
            apiCost: 0,
            infraCost: 0,
            netProfit: taoEarned * 170,
            period: 'hourly',
          });
        }
      }
    }
  }

  async function getStatus(): Promise<BittensorServiceStatus> {
    const activeMiners: ActiveMinerSummary[] = [];

    for (const subnet of config.subnets ?? []) {
      const manager = minerManagers.get(subnet.subnetId);
      const firstHotkey = walletInfo?.hotkeys?.[0];
      const dbStatus = firstHotkey
        ? persistence.getMinerStatus(subnet.subnetId, firstHotkey.address)
        : null;

      activeMiners.push({
        subnetId: subnet.subnetId,
        type: subnet.type,
        running: manager?.getStatus().running ?? false,
        uid: dbStatus?.uid,
        emission: dbStatus?.emission,
        rank: dbStatus?.rank,
      });
    }

    const allEarnings = persistence.getEarnings('all');
    const totalTaoEarned = allEarnings.reduce((sum, e) => sum + e.taoEarned, 0);
    const totalUsdEarned = allEarnings.reduce((sum, e) => sum + e.usdEarned, 0);

    return {
      connected,
      network: config.network,
      walletLoaded: walletInfo !== null,
      activeMiners,
      totalTaoEarned,
      totalUsdEarned,
    };
  }

  async function getWallet(): Promise<TaoWalletInfo | null> {
    if (!api || !walletInfo) return null;
    walletInfo.balance = await getBalance(api, walletInfo.coldkeyAddress);
    return walletInfo;
  }

  async function getEarnings(period: EarningsPeriod): Promise<MinerEarnings[]> {
    return persistence.getEarnings(period);
  }

  async function getMinerStatuses(): Promise<MinerStatus[]> {
    return persistence.getMinerStatuses();
  }

  async function getSubnets(): Promise<SubnetInfo[]> {
    if (!api) return [];
    return listSubnets(api);
  }

  async function registerOnSubnet(
    subnetId: number,
    hotkeyName?: string
  ): Promise<{ success: boolean; message: string }> {
    if (!api || !walletInfo) {
      return { success: false, message: 'Not connected. Start the service first.' };
    }

    const hotkey = hotkeyName ?? walletInfo.hotkeys[0]?.address;
    if (!hotkey) {
      return { success: false, message: 'No hotkey available. Create one with btcli first.' };
    }

    const check = await walletRegister(api, walletInfo.coldkeyAddress, hotkey, subnetId);
    if (!check.success) return check;

    const args = [
      'subnet', 'register',
      '--netuid', String(subnetId),
      '--wallet.name', 'default',
      '--no_prompt',
    ];

    if (config.coldkeyPath) {
      args.push('--wallet.path', config.coldkeyPath);
    }

    if (hotkeyName) {
      args.push('--wallet.hotkey', hotkeyName);
    }

    const result = await runner.btcli(args, 120_000);

    if (result.success) {
      const costMatch = result.stdout.match(/cost:\s*([\d.]+)\s*TAO/i);
      if (costMatch) {
        const cost = parseFloat(costMatch[1]);
        persistence.logCost({
          category: 'registration',
          description: `Registered on subnet ${subnetId}`,
          amountTao: cost,
          amountUsd: cost * 170,
          subnetId,
        });
      }

      return { success: true, message: `Registered on subnet ${subnetId}` };
    }

    return {
      success: false,
      message: `Registration failed: ${result.stderr || result.stdout}`.slice(0, 500),
    };
  }

  async function startMining(subnetId: number): Promise<{ success: boolean; message: string }> {
    const manager = minerManagers.get(subnetId);
    if (!manager) {
      return { success: false, message: `No miner configured for subnet ${subnetId}` };
    }

    if (manager.getStatus().running) {
      return { success: false, message: `Miner for subnet ${subnetId} is already running` };
    }

    await manager.start();
    return { success: true, message: `Started mining on subnet ${subnetId}` };
  }

  async function stopMining(subnetId: number): Promise<{ success: boolean; message: string }> {
    const manager = minerManagers.get(subnetId);
    if (!manager) {
      return { success: false, message: `No miner configured for subnet ${subnetId}` };
    }

    if (!manager.getStatus().running) {
      return { success: false, message: `Miner for subnet ${subnetId} is not running` };
    }

    await manager.stop();
    return { success: true, message: `Stopped mining on subnet ${subnetId}` };
  }

  return {
    start,
    stop,
    getStatus,
    getWalletInfo: getWallet,
    getEarnings,
    getMinerStatuses,
    getSubnets,
    registerOnSubnet,
    startMining,
    stopMining,
  };
}
