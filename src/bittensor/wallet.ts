/**
 * Bittensor Wallet Management
 * Connects to Subtensor chain via @polkadot/api for balance, registration, and miner queries.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import type {
  BittensorNetwork,
  TaoWalletInfo,
  TaoBalance,
  MinerStatus,
  SubnetInfo,
} from './types';

// TAO has 9 decimal places (rao = 1e-9 TAO)
const RAO_PER_TAO = 1_000_000_000;

function raoToTao(rao: bigint | number | string): number {
  return Number(BigInt(rao)) / RAO_PER_TAO;
}

export async function connectToSubtensor(url: string): Promise<ApiPromise> {
  const provider = new WsProvider(url);
  const api = await ApiPromise.create({ provider });
  await api.isReady;
  return api;
}

export async function disconnectFromSubtensor(api: ApiPromise): Promise<void> {
  await api.disconnect();
}

export async function getBalance(api: ApiPromise, address: string): Promise<TaoBalance> {
  const account = await api.query['system']?.['account'](address);
  if (!account) {
    return { free: 0, staked: 0, total: 0 };
  }

  const data = (account as unknown as { data: { free: { toBigInt(): bigint }; reserved: { toBigInt(): bigint } } }).data;
  const free = raoToTao(data.free.toBigInt());
  const staked = raoToTao(data.reserved.toBigInt());

  return {
    free,
    staked,
    total: free + staked,
  };
}

export async function getWalletInfo(
  api: ApiPromise,
  coldkeyAddress: string,
  network: BittensorNetwork
): Promise<TaoWalletInfo> {
  const balance = await getBalance(api, coldkeyAddress);

  return {
    coldkeyAddress,
    hotkeys: [],
    balance,
    network,
  };
}

export async function getMinerInfo(
  api: ApiPromise,
  netuid: number,
  hotkey: string
): Promise<MinerStatus | null> {
  try {
    const uidResult = await api.query['subtensorModule']?.['uids'](netuid, hotkey);
    if (!uidResult) return null;

    const uid = (uidResult as unknown as { unwrapOr(val: null): number | null }).unwrapOr(null);
    if (uid === null) return null;

    const [trustResult, incentiveResult, emissionResult, rankResult, activeResult] = await Promise.all([
      api.query['subtensorModule']?.['trust'](netuid, uid),
      api.query['subtensorModule']?.['incentive'](netuid, uid),
      api.query['subtensorModule']?.['emission'](netuid, uid),
      api.query['subtensorModule']?.['rank'](netuid, uid),
      api.query['subtensorModule']?.['active'](netuid, uid),
    ]);

    const toNumber = (val: unknown): number => {
      if (!val) return 0;
      const v = val as { toNumber?(): number };
      return v.toNumber?.() ?? 0;
    };

    return {
      subnetId: netuid,
      hotkey,
      uid,
      trust: toNumber(trustResult) / 65535,
      incentive: toNumber(incentiveResult) / 65535,
      emission: raoToTao(toNumber(emissionResult)),
      rank: toNumber(rankResult),
      active: Boolean(activeResult && (activeResult as unknown as { isTrue?: boolean }).isTrue),
      updatedAt: new Date(),
    };
  } catch {
    return null;
  }
}

export async function getSubnetInfo(
  api: ApiPromise,
  netuid: number
): Promise<SubnetInfo | null> {
  try {
    const [minerCountResult, registrationCostResult, immunityResult] = await Promise.all([
      api.query['subtensorModule']?.['subnetworkN'](netuid),
      api.query['subtensorModule']?.['burn'](netuid),
      api.query['subtensorModule']?.['immunityPeriod'](netuid),
    ]);

    const toNumber = (val: unknown): number => {
      if (!val) return 0;
      const v = val as { toNumber?(): number };
      return v.toNumber?.() ?? 0;
    };

    return {
      netuid,
      name: `Subnet ${netuid}`,
      minerCount: toNumber(minerCountResult),
      validatorCount: 0,
      emissionPct: 0,
      registrationCost: raoToTao(toNumber(registrationCostResult)),
      immunityPeriodBlocks: toNumber(immunityResult),
    };
  } catch {
    return null;
  }
}

export async function registerOnSubnet(
  api: ApiPromise,
  coldkeyAddress: string,
  _hotkeyAddress: string,
  netuid: number
): Promise<{ success: boolean; message: string; txHash?: string }> {
  try {
    const subnetInfo = await getSubnetInfo(api, netuid);
    if (!subnetInfo) {
      return { success: false, message: `Subnet ${netuid} not found` };
    }

    const balance = await getBalance(api, coldkeyAddress);
    if (balance.free < subnetInfo.registrationCost) {
      return {
        success: false,
        message: `Insufficient balance. Need ${subnetInfo.registrationCost.toFixed(4)} TAO, have ${balance.free.toFixed(4)} TAO`,
      };
    }

    return {
      success: true,
      message: `Ready to register on subnet ${netuid}. Cost: ${subnetInfo.registrationCost.toFixed(4)} TAO. Use btcli to complete.`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Registration check failed',
    };
  }
}

export async function listSubnets(api: ApiPromise): Promise<SubnetInfo[]> {
  const subnets: SubnetInfo[] = [];

  try {
    const totalSubnets = await api.query['subtensorModule']?.['totalNetworks']();
    const count = totalSubnets ? (totalSubnets as unknown as { toNumber(): number }).toNumber() : 0;

    for (let i = 1; i <= Math.min(count, 128); i++) {
      const info = await getSubnetInfo(api, i);
      if (info && info.minerCount > 0) {
        subnets.push(info);
      }
    }
  } catch {
    // Return whatever we collected
  }

  return subnets;
}
