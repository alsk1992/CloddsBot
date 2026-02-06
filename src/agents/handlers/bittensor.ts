/**
 * Bittensor Handler - Modular handler for bittensor agent tool
 *
 * Uses singleton pattern (setBittensorService) matching setFeatureEngine.
 */

import type { HandlersMap, ToolInput } from './types';
import { errorResult, safeHandler } from './types';
import type { BittensorService, EarningsPeriod } from '../../bittensor/types';

let service: BittensorService | null = null;

/** Set the bittensor service instance (called from gateway) */
export function setBittensorService(svc: BittensorService | null): void {
  service = svc;
}

export const bittensorHandlers: HandlersMap = {
  bittensor: async (input: ToolInput) => {
    if (!service) {
      return errorResult('Bittensor is not enabled. Run `clodds bittensor setup` or set BITTENSOR_ENABLED=true.');
    }

    const action = input.action as string;

    return safeHandler(async () => {
      switch (action) {
        case 'status': {
          const status = await service!.getStatus();
          return {
            result: {
              connected: status.connected,
              network: status.network,
              walletLoaded: status.walletLoaded,
              totalTaoEarned: status.totalTaoEarned,
              totalUsdEarned: status.totalUsdEarned,
              activeMiners: status.activeMiners,
            },
          };
        }

        case 'earnings': {
          const period = (input.period as EarningsPeriod) ?? 'daily';
          const earnings = await service!.getEarnings(period);
          const totalTao = earnings.reduce((s, e) => s + e.taoEarned, 0);
          const totalUsd = earnings.reduce((s, e) => s + e.usdEarned, 0);
          return {
            result: {
              period,
              totalTao,
              totalUsd,
              records: earnings.length,
              earnings: earnings.slice(0, 20),
            },
          };
        }

        case 'wallet': {
          const wallet = await service!.getWalletInfo();
          if (!wallet) return { error: 'Wallet not loaded. Check BITTENSOR_COLDKEY_PATH.' };
          return { result: wallet };
        }

        case 'miners': {
          const miners = await service!.getMinerStatuses();
          return { result: miners };
        }

        case 'subnets': {
          const subnets = await service!.getSubnets();
          return { result: subnets.slice(0, 20) };
        }

        case 'start': {
          const subnetId = input.subnetId as number | undefined;
          if (!subnetId) return { error: 'subnetId is required' };
          return await service!.startMining(subnetId);
        }

        case 'stop': {
          const subnetId = input.subnetId as number | undefined;
          if (!subnetId) return { error: 'subnetId is required' };
          return await service!.stopMining(subnetId);
        }

        case 'register': {
          const subnetId = input.subnetId as number | undefined;
          if (!subnetId) return { error: 'subnetId is required' };
          return await service!.registerOnSubnet(subnetId, input.hotkeyName as string | undefined);
        }

        default:
          return { error: `Unknown bittensor action: ${action}` };
      }
    }, 'Bittensor');
  },
};
