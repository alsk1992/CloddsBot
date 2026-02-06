/**
 * Bittensor AI Tool
 * Enables natural language control of Bittensor mining via the agent system.
 */

import type { BittensorService, EarningsPeriod } from './types';

export interface BittensorToolInput {
  action: 'status' | 'earnings' | 'wallet' | 'miners' | 'subnets' | 'start' | 'stop' | 'register';
  period?: EarningsPeriod;
  subnetId?: number;
  hotkeyName?: string;
}

export interface BittensorToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export function createBittensorTool(service: BittensorService) {
  return {
    name: 'bittensor',
    description: 'Manage Bittensor subnet mining - check status, earnings, wallet, start/stop miners, register on subnets.',
    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'earnings', 'wallet', 'miners', 'subnets', 'start', 'stop', 'register'],
          description: 'The action to perform',
        },
        period: {
          type: 'string',
          enum: ['hourly', 'daily', 'weekly', 'monthly', 'all'],
          description: 'Earnings period (for earnings action)',
        },
        subnetId: {
          type: 'number',
          description: 'Subnet ID (for start/stop/register)',
        },
        hotkeyName: {
          type: 'string',
          description: 'Hotkey name (for register)',
        },
      },
      required: ['action'],
    },

    async execute(input: BittensorToolInput): Promise<BittensorToolResult> {
      switch (input.action) {
        case 'status': {
          const status = await service.getStatus();
          const lines = [
            `**Bittensor Status**`,
            `- Connected: ${status.connected ? 'Yes' : 'No'}`,
            `- Network: ${status.network}`,
            `- Wallet loaded: ${status.walletLoaded ? 'Yes' : 'No'}`,
            `- Total TAO earned: ${status.totalTaoEarned.toFixed(4)}`,
            `- Total USD earned: $${status.totalUsdEarned.toFixed(2)}`,
          ];

          if (status.activeMiners.length > 0) {
            lines.push('', '**Active Miners:**');
            for (const m of status.activeMiners) {
              const state = m.running ? 'Running' : 'Stopped';
              const uid = m.uid !== undefined ? ` (UID ${m.uid})` : '';
              lines.push(`- SN${m.subnetId} [${m.type}]: ${state}${uid}`);
            }
          }

          return { success: true, message: lines.join('\n'), data: status };
        }

        case 'earnings': {
          const period = input.period ?? 'daily';
          const earnings = await service.getEarnings(period);

          if (earnings.length === 0) {
            return { success: true, message: `No earnings recorded for ${period} period.` };
          }

          const totalTao = earnings.reduce((s, e) => s + e.taoEarned, 0);
          const totalUsd = earnings.reduce((s, e) => s + e.usdEarned, 0);
          const totalProfit = earnings.reduce((s, e) => s + e.netProfit, 0);

          return {
            success: true,
            message: [
              `**${period.charAt(0).toUpperCase() + period.slice(1)} Earnings**`,
              `- TAO earned: ${totalTao.toFixed(4)}`,
              `- USD earned: $${totalUsd.toFixed(2)}`,
              `- Net profit: $${totalProfit.toFixed(2)}`,
              `- Records: ${earnings.length}`,
            ].join('\n'),
            data: earnings,
          };
        }

        case 'wallet': {
          const wallet = await service.getWalletInfo();
          if (!wallet) {
            return { success: false, message: 'Wallet not loaded. Check BITTENSOR_COLDKEY_PATH.' };
          }

          return {
            success: true,
            message: [
              `**TAO Wallet**`,
              `- Address: ${wallet.coldkeyAddress}`,
              `- Free: ${wallet.balance.free.toFixed(4)} TAO`,
              `- Staked: ${wallet.balance.staked.toFixed(4)} TAO`,
              `- Total: ${wallet.balance.total.toFixed(4)} TAO`,
              `- Network: ${wallet.network}`,
              `- Hotkeys: ${wallet.hotkeys.length}`,
            ].join('\n'),
            data: wallet,
          };
        }

        case 'miners': {
          const miners = await service.getMinerStatuses();
          if (miners.length === 0) {
            return { success: true, message: 'No miners registered.' };
          }

          const lines = ['**Miner Statuses**', ''];
          for (const m of miners) {
            lines.push(
              `- SN${m.subnetId} UID${m.uid}: trust=${m.trust.toFixed(3)} incentive=${m.incentive.toFixed(3)} emission=${m.emission.toFixed(6)} rank=${m.rank} ${m.active ? 'ACTIVE' : 'INACTIVE'}`
            );
          }

          return { success: true, message: lines.join('\n'), data: miners };
        }

        case 'subnets': {
          const subnets = await service.getSubnets();
          if (subnets.length === 0) {
            return { success: true, message: 'Could not fetch subnet list. Check connection.' };
          }

          const lines = ['**Available Subnets**', ''];
          for (const s of subnets.slice(0, 20)) {
            lines.push(
              `- SN${s.netuid} (${s.name}): ${s.minerCount} miners, reg cost: ${s.registrationCost.toFixed(4)} TAO`
            );
          }

          if (subnets.length > 20) {
            lines.push(`... and ${subnets.length - 20} more`);
          }

          return { success: true, message: lines.join('\n'), data: subnets };
        }

        case 'start': {
          if (!input.subnetId) {
            return { success: false, message: 'subnetId is required to start mining.' };
          }
          return service.startMining(input.subnetId);
        }

        case 'stop': {
          if (!input.subnetId) {
            return { success: false, message: 'subnetId is required to stop mining.' };
          }
          return service.stopMining(input.subnetId);
        }

        case 'register': {
          if (!input.subnetId) {
            return { success: false, message: 'subnetId is required to register.' };
          }
          return service.registerOnSubnet(input.subnetId, input.hotkeyName);
        }

        default:
          return { success: false, message: `Unknown action: ${input.action}` };
      }
    },
  };
}
