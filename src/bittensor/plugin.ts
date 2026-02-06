/**
 * Bittensor Plugin
 * /tao chat command for Telegram/Discord interaction.
 */

import type { BittensorService, EarningsPeriod } from './types';

export interface PluginContext {
  userId: string;
  args: string[];
  rawArgs: string;
}

export interface PluginResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export function createBittensorPlugin(service: BittensorService) {
  return {
    name: 'tao',
    description: 'Bittensor subnet mining management',
    commands: {
      status: 'Show overall Bittensor mining status',
      earnings: 'Show TAO earnings (daily/weekly/monthly/all)',
      wallet: 'Show TAO wallet balances',
      miners: 'Show registered miner statuses',
      subnets: 'List available subnets',
      start: 'Start mining on a subnet (/tao start <subnetId>)',
      stop: 'Stop mining on a subnet (/tao stop <subnetId>)',
      register: 'Register on a subnet (/tao register <subnetId>)',
    },

    async handle(ctx: PluginContext): Promise<PluginResult> {
      const command = ctx.args[0]?.toLowerCase();

      switch (command) {
        case 'status': {
          const status = await service.getStatus();
          const lines = [
            `**Bittensor Mining Status**`,
            `Connected: ${status.connected ? 'Yes' : 'No'} | Network: ${status.network}`,
            `Wallet: ${status.walletLoaded ? 'Loaded' : 'Not loaded'}`,
            `Total earned: ${status.totalTaoEarned.toFixed(4)} TAO ($${status.totalUsdEarned.toFixed(2)})`,
          ];

          for (const m of status.activeMiners) {
            const state = m.running ? 'Running' : 'Stopped';
            lines.push(`  SN${m.subnetId} [${m.type}]: ${state}`);
          }

          return { success: true, message: lines.join('\n'), data: status };
        }

        case 'earnings': {
          const period = (ctx.args[1] ?? 'daily') as EarningsPeriod;
          const earnings = await service.getEarnings(period);

          if (earnings.length === 0) {
            return { success: true, message: `No ${period} earnings recorded yet.` };
          }

          const totalTao = earnings.reduce((s, e) => s + e.taoEarned, 0);
          const totalUsd = earnings.reduce((s, e) => s + e.usdEarned, 0);

          return {
            success: true,
            message: `**${period} Earnings**: ${totalTao.toFixed(4)} TAO ($${totalUsd.toFixed(2)}) from ${earnings.length} records`,
            data: earnings,
          };
        }

        case 'wallet': {
          const wallet = await service.getWalletInfo();
          if (!wallet) {
            return { success: false, message: 'Wallet not loaded.' };
          }

          return {
            success: true,
            message: [
              `**TAO Wallet** (${wallet.network})`,
              `Address: \`${wallet.coldkeyAddress}\``,
              `Free: ${wallet.balance.free.toFixed(4)} TAO | Staked: ${wallet.balance.staked.toFixed(4)} TAO`,
              `Total: ${wallet.balance.total.toFixed(4)} TAO`,
            ].join('\n'),
            data: wallet,
          };
        }

        case 'miners': {
          const miners = await service.getMinerStatuses();
          if (miners.length === 0) {
            return { success: true, message: 'No miners registered.' };
          }

          const lines = ['**Registered Miners**'];
          for (const m of miners) {
            lines.push(
              `SN${m.subnetId} UID${m.uid}: T=${m.trust.toFixed(3)} I=${m.incentive.toFixed(3)} E=${m.emission.toFixed(6)} ${m.active ? 'ACTIVE' : 'OFFLINE'}`
            );
          }

          return { success: true, message: lines.join('\n'), data: miners };
        }

        case 'subnets': {
          const subnets = await service.getSubnets();
          if (subnets.length === 0) {
            return { success: true, message: 'Could not fetch subnets.' };
          }

          const lines = ['**Subnets**'];
          for (const s of subnets.slice(0, 15)) {
            lines.push(`SN${s.netuid}: ${s.minerCount} miners, reg: ${s.registrationCost.toFixed(4)} TAO`);
          }

          return { success: true, message: lines.join('\n'), data: subnets };
        }

        case 'start': {
          const subnetId = parseInt(ctx.args[1], 10);
          if (isNaN(subnetId)) {
            return { success: false, message: 'Usage: /tao start <subnetId>' };
          }
          return service.startMining(subnetId);
        }

        case 'stop': {
          const subnetId = parseInt(ctx.args[1], 10);
          if (isNaN(subnetId)) {
            return { success: false, message: 'Usage: /tao stop <subnetId>' };
          }
          return service.stopMining(subnetId);
        }

        case 'register': {
          const subnetId = parseInt(ctx.args[1], 10);
          if (isNaN(subnetId)) {
            return { success: false, message: 'Usage: /tao register <subnetId>' };
          }
          const hotkeyName = ctx.args[2];
          return service.registerOnSubnet(subnetId, hotkeyName);
        }

        default:
          return {
            success: false,
            message: [
              '**Usage:** /tao <command>',
              '',
              'Commands:',
              '  status   - Mining status overview',
              '  earnings - TAO earnings (daily/weekly/monthly)',
              '  wallet   - Wallet balance',
              '  miners   - Registered miner info',
              '  subnets  - Available subnets',
              '  start    - Start mining (/tao start 64)',
              '  stop     - Stop mining (/tao stop 64)',
              '  register - Register on subnet (/tao register 64)',
            ].join('\n'),
          };
      }
    },
  };
}
