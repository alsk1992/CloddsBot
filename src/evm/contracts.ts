/**
 * Generic Smart Contract Interactions
 *
 * Read and write to any smart contract with ABI.
 */

import {
  Wallet,
  Contract,
  Interface,
  InterfaceAbi,
  TransactionReceipt,
  formatUnits,
  parseUnits,
  isAddress,
} from 'ethers';
import { getProvider, getChainConfig, ChainName } from './multichain';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface ContractCallRequest {
  chain: ChainName;
  contractAddress: string;
  abi: InterfaceAbi;
  method: string;
  args?: unknown[];
}

export interface ContractWriteRequest extends ContractCallRequest {
  privateKey: string;
  value?: string;          // ETH to send with call
  gasLimit?: bigint;
}

export interface ContractCallResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ContractWriteResult {
  success: boolean;
  txHash?: string;
  receipt?: TransactionReceipt;
  result?: unknown;        // Return value from call
  gasUsed?: bigint;
  error?: string;
}

export interface ContractInfo {
  address: string;
  chain: ChainName;
  isContract: boolean;
  bytecodeSize?: number;
}

// =============================================================================
// COMMON ABIS
// =============================================================================

export const COMMON_ABIS = {
  erc20: [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)',
  ],
  erc721: [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function balanceOf(address owner) view returns (uint256)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function approve(address to, uint256 tokenId)',
    'function getApproved(uint256 tokenId) view returns (address)',
    'function setApprovalForAll(address operator, bool approved)',
    'function isApprovedForAll(address owner, address operator) view returns (bool)',
    'function transferFrom(address from, address to, uint256 tokenId)',
    'function safeTransferFrom(address from, address to, uint256 tokenId)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  ],
  erc1155: [
    'function uri(uint256 id) view returns (string)',
    'function balanceOf(address account, uint256 id) view returns (uint256)',
    'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
    'function setApprovalForAll(address operator, bool approved)',
    'function isApprovedForAll(address account, address operator) view returns (bool)',
    'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
    'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
  ],
  multicall: [
    'function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)',
    'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)',
  ],
  uniswapV2Pair: [
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function price0CumulativeLast() view returns (uint256)',
    'function price1CumulativeLast() view returns (uint256)',
  ],
  uniswapV2Router: [
    'function WETH() view returns (address)',
    'function factory() view returns (address)',
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
    'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
    'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  ],
};

// =============================================================================
// CONTRACT INFO
// =============================================================================

/**
 * Check if address is a contract
 */
export async function isContract(chain: ChainName, address: string): Promise<boolean> {
  if (!isAddress(address)) return false;

  const provider = getProvider(chain);
  const code = await provider.getCode(address);
  return code !== '0x';
}

/**
 * Get contract info
 */
export async function getContractInfo(chain: ChainName, address: string): Promise<ContractInfo> {
  if (!isAddress(address)) {
    return {
      address,
      chain,
      isContract: false,
    };
  }

  const provider = getProvider(chain);
  const code = await provider.getCode(address);
  const isContractAddress = code !== '0x';

  return {
    address,
    chain,
    isContract: isContractAddress,
    bytecodeSize: isContractAddress ? (code.length - 2) / 2 : undefined,
  };
}

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * Call a read-only contract method
 */
export async function callContract(request: ContractCallRequest): Promise<ContractCallResult> {
  const { chain, contractAddress, abi, method, args = [] } = request;

  if (!isAddress(contractAddress)) {
    return {
      success: false,
      error: 'Invalid contract address',
    };
  }

  try {
    const provider = getProvider(chain);
    const contract = new Contract(contractAddress, abi, provider);

    if (!contract[method]) {
      return {
        success: false,
        error: `Method ${method} not found in ABI`,
      };
    }

    const result = await contract[method](...args);

    return {
      success: true,
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug({ chain, contract: contractAddress, method, error: message }, 'Contract call failed');

    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Call multiple read-only methods in batch
 */
export async function callContractBatch(
  requests: ContractCallRequest[]
): Promise<ContractCallResult[]> {
  return Promise.all(requests.map(callContract));
}

// =============================================================================
// WRITE OPERATIONS
// =============================================================================

/**
 * Execute a state-changing contract method
 */
export async function writeContract(request: ContractWriteRequest): Promise<ContractWriteResult> {
  const { chain, contractAddress, abi, method, args = [], privateKey, value, gasLimit } = request;

  if (!isAddress(contractAddress)) {
    return {
      success: false,
      error: 'Invalid contract address',
    };
  }

  try {
    const provider = getProvider(chain);
    const wallet = new Wallet(privateKey, provider);
    const contract = new Contract(contractAddress, abi, wallet);

    if (!contract[method]) {
      return {
        success: false,
        error: `Method ${method} not found in ABI`,
      };
    }

    // Build transaction options
    const txOptions: { value?: bigint; gasLimit?: bigint } = {};
    if (value) {
      txOptions.value = parseUnits(value, 18);
    }
    if (gasLimit) {
      txOptions.gasLimit = gasLimit;
    }

    logger.info({
      chain,
      contract: contractAddress,
      method,
      args: args.map(a => String(a).slice(0, 50)),
    }, 'Writing to contract');

    const tx = await contract[method](...args, txOptions);
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: receipt.hash,
      receipt,
      gasUsed: receipt.gasUsed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ chain, contract: contractAddress, method, error: message }, 'Contract write failed');

    return {
      success: false,
      error: message,
    };
  }
}

// =============================================================================
// ENCODING/DECODING
// =============================================================================

/**
 * Encode function call data
 */
export function encodeFunctionData(
  abi: InterfaceAbi,
  method: string,
  args: unknown[] = []
): string {
  const iface = new Interface(abi);
  return iface.encodeFunctionData(method, args);
}

/**
 * Decode function call data
 */
export function decodeFunctionData(
  abi: InterfaceAbi,
  method: string,
  data: string
): unknown[] {
  const iface = new Interface(abi);
  const result = iface.decodeFunctionResult(method, data);
  return Array.from(result);
}

/**
 * Decode function call input
 */
export function decodeFunctionInput(
  abi: InterfaceAbi,
  data: string
): { name: string; args: unknown[] } | null {
  try {
    const iface = new Interface(abi);
    const parsed = iface.parseTransaction({ data });
    if (!parsed) return null;

    return {
      name: parsed.name,
      args: Array.from(parsed.args),
    };
  } catch {
    return null;
  }
}

// =============================================================================
// EVENT LOGS
// =============================================================================

export interface EventLogQuery {
  chain: ChainName;
  contractAddress: string;
  abi: InterfaceAbi;
  eventName: string;
  fromBlock?: number | 'latest';
  toBlock?: number | 'latest';
  filter?: Record<string, unknown>;
}

export interface ParsedEventLog {
  blockNumber: number;
  txHash: string;
  logIndex: number;
  args: Record<string, unknown>;
}

/**
 * Query event logs from contract
 */
export async function getEventLogs(query: EventLogQuery): Promise<ParsedEventLog[]> {
  const {
    chain,
    contractAddress,
    abi,
    eventName,
    fromBlock = 'latest',
    toBlock = 'latest',
    filter = {},
  } = query;

  const provider = getProvider(chain);
  const contract = new Contract(contractAddress, abi, provider);

  const eventFilter = contract.filters[eventName]?.(...Object.values(filter));
  if (!eventFilter) {
    throw new Error(`Event ${eventName} not found in ABI`);
  }

  const logs = await contract.queryFilter(eventFilter, fromBlock, toBlock);

  return logs.map(log => {
    // EventLog has args, Log does not
    const logArgs = 'args' in log ? log.args : undefined;
    return {
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      logIndex: log.index,
      args: logArgs
        ? Object.fromEntries(
            Object.entries(logArgs).filter(([key]) => isNaN(Number(key)))
          )
        : {},
    };
  });
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Estimate gas for contract call
 */
export async function estimateContractGas(request: ContractWriteRequest): Promise<bigint> {
  const { chain, contractAddress, abi, method, args = [], privateKey, value } = request;

  const provider = getProvider(chain);
  const wallet = new Wallet(privateKey, provider);
  const contract = new Contract(contractAddress, abi, wallet);

  const txOptions: { value?: bigint } = {};
  if (value) {
    txOptions.value = parseUnits(value, 18);
  }

  return contract[method].estimateGas(...args, txOptions);
}

/**
 * Simulate contract call without sending transaction
 */
export async function simulateContractCall(request: ContractWriteRequest): Promise<ContractCallResult> {
  const { chain, contractAddress, abi, method, args = [], privateKey, value } = request;

  const provider = getProvider(chain);
  const wallet = new Wallet(privateKey, provider);
  const contract = new Contract(contractAddress, abi, wallet);

  const txOptions: { value?: bigint } = {};
  if (value) {
    txOptions.value = parseUnits(value, 18);
  }

  try {
    // Use staticCall to simulate without sending
    const result = await contract[method].staticCall(...args, txOptions);
    return {
      success: true,
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Get contract storage at slot
 */
export async function getStorageAt(
  chain: ChainName,
  address: string,
  slot: string | number
): Promise<string> {
  const provider = getProvider(chain);
  const slotHex = typeof slot === 'number' ? '0x' + slot.toString(16).padStart(64, '0') : slot;
  return provider.getStorage(address, slotHex);
}
