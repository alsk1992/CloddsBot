/**
 * Base Chain Provider
 *
 * Shared utilities for Base chain interactions.
 */

import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// =============================================================================
// Types
// =============================================================================

export interface BaseProviderConfig {
  rpcUrl?: string;
  chainId?: number;
  privateKey?: string;
}

// =============================================================================
// Chain Definitions
// =============================================================================

export const BASE_MAINNET: Chain = base;
export const BASE_SEPOLIA: Chain = baseSepolia;

export function getChain(chainId: number = 8453): Chain {
  switch (chainId) {
    case 8453:
      return BASE_MAINNET;
    case 84532:
      return BASE_SEPOLIA;
    default:
      throw new Error(`Unsupported chain ID: ${chainId}`);
  }
}

// =============================================================================
// Provider Factory
// =============================================================================

let defaultPublicClient: PublicClient | null = null;

export function getBasePublicClient(config?: BaseProviderConfig): PublicClient {
  if (config?.rpcUrl || config?.chainId) {
    const chain = getChain(config.chainId);
    return createPublicClient({
      chain,
      transport: http(config.rpcUrl || getDefaultRpcUrl(chain.id)),
    });
  }

  if (!defaultPublicClient) {
    const rpcUrl = process.env.BASE_RPC_URL || getDefaultRpcUrl(8453);
    defaultPublicClient = createPublicClient({
      chain: BASE_MAINNET,
      transport: http(rpcUrl),
    });
  }

  return defaultPublicClient;
}

export function getBaseWalletClient(config: BaseProviderConfig & { privateKey: string }): WalletClient {
  const chain = getChain(config.chainId);
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);

  return createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl || getDefaultRpcUrl(chain.id)),
  });
}

function getDefaultRpcUrl(chainId: number): string {
  switch (chainId) {
    case 8453:
      return 'https://mainnet.base.org';
    case 84532:
      return 'https://sepolia.base.org';
    default:
      return 'https://mainnet.base.org';
  }
}

// =============================================================================
// Contract Helpers
// =============================================================================

export async function callContract(
  address: string,
  data: string,
  config?: BaseProviderConfig
): Promise<string> {
  const client = getBasePublicClient(config);

  const result = await client.call({
    to: address as `0x${string}`,
    data: data as `0x${string}`,
  });

  return result.data || '0x';
}

export async function readContract<T>(
  address: string,
  abi: any[],
  functionName: string,
  args: any[] = [],
  config?: BaseProviderConfig
): Promise<T> {
  const client = getBasePublicClient(config);

  return client.readContract({
    address: address as `0x${string}`,
    abi,
    functionName,
    args,
  }) as Promise<T>;
}

export async function writeContract(
  address: string,
  abi: any[],
  functionName: string,
  args: any[] = [],
  config: BaseProviderConfig & { privateKey: string }
): Promise<string> {
  const chain = getChain(config.chainId);
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  const walletClient = getBaseWalletClient(config);

  const hash = await walletClient.writeContract({
    address: address as `0x${string}`,
    abi,
    functionName,
    args,
    chain,
    account,
  });

  return hash;
}

// =============================================================================
// Utilities
// =============================================================================

export async function getBalance(address: string, config?: BaseProviderConfig): Promise<bigint> {
  const client = getBasePublicClient(config);
  return client.getBalance({ address: address as `0x${string}` });
}

export async function getBlockNumber(config?: BaseProviderConfig): Promise<bigint> {
  const client = getBasePublicClient(config);
  return client.getBlockNumber();
}

export function formatEther(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(6);
}

export function parseEther(ether: string): bigint {
  return BigInt(Math.floor(parseFloat(ether) * 1e18));
}
