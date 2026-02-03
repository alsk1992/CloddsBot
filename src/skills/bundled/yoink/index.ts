/**
 * Yoink Skill - Capture the Flag on Base
 *
 * Contract: 0x4bBFD120d9f352A0BEd7a014bd67913a2007a878
 *
 * Commands:
 * /yoink                      Yoink the flag!
 * /yoink status               Current flag holder and stats
 * /yoink score <address>      Get player score
 * /yoink cooldown             Check your cooldown
 */

import { createPublicClient, createWalletClient, http, formatEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const YOINK_CONTRACT = '0x4bBFD120d9f352A0BEd7a014bd67913a2007a878' as Address;
const COOLDOWN = 600; // 10 minutes

const YOINK_ABI = [
  { inputs: [], name: 'yoink', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'lastYoinkedBy', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'lastYoinkedAt', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalYoinks', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'topYoinker', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mostYoinks', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [{ name: 'player', type: 'address' }],
    name: 'score',
    outputs: [
      { name: 'yoinks', type: 'uint256' },
      { name: 'time', type: 'uint256' },
      { name: 'lastYoinkedAt', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

function getPublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });
}

function getWalletClient() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('PRIVATE_KEY not set');
  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey as `0x${string}` : `0x${privateKey}`);
  return createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });
}

async function handleYoink(): Promise<string> {
  try {
    const publicClient = getPublicClient();
    const walletClient = getWalletClient();

    // Check current holder
    const currentHolder = await publicClient.readContract({
      address: YOINK_CONTRACT,
      abi: YOINK_ABI,
      functionName: 'lastYoinkedBy',
    });

    if (currentHolder.toLowerCase() === walletClient.account.address.toLowerCase()) {
      return 'You already hold the flag! Cannot yoink from yourself.';
    }

    // Check cooldown
    const lastYoinkedAt = await publicClient.readContract({
      address: YOINK_CONTRACT,
      abi: YOINK_ABI,
      functionName: 'lastYoinkedAt',
    });

    const now = Math.floor(Date.now() / 1000);
    const timeSinceYoink = now - Number(lastYoinkedAt);

    if (timeSinceYoink < COOLDOWN) {
      const remaining = COOLDOWN - timeSinceYoink;
      return `Cooldown active! Wait ${remaining} seconds before yoinking.`;
    }

    // Yoink!
    const hash = await walletClient.writeContract({
      address: YOINK_CONTRACT,
      abi: YOINK_ABI,
      functionName: 'yoink',
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**YOINK!**\n\n` +
      `You grabbed the flag from \`${currentHolder.slice(0, 10)}...\`!\n` +
      `TX: \`${hash}\`\n` +
      `Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('SlowDown')) {
      return 'Cooldown not elapsed! Wait 10 minutes between yoinks.';
    }
    if (msg.includes('Unauthorized')) {
      return 'You already hold the flag!';
    }
    return `Yoink failed: ${msg}`;
  }
}

async function handleStatus(): Promise<string> {
  try {
    const client = getPublicClient();

    const [holder, lastYoinkedAt, totalYoinks, topYoinker, mostYoinks] = await Promise.all([
      client.readContract({ address: YOINK_CONTRACT, abi: YOINK_ABI, functionName: 'lastYoinkedBy' }),
      client.readContract({ address: YOINK_CONTRACT, abi: YOINK_ABI, functionName: 'lastYoinkedAt' }),
      client.readContract({ address: YOINK_CONTRACT, abi: YOINK_ABI, functionName: 'totalYoinks' }),
      client.readContract({ address: YOINK_CONTRACT, abi: YOINK_ABI, functionName: 'topYoinker' }),
      client.readContract({ address: YOINK_CONTRACT, abi: YOINK_ABI, functionName: 'mostYoinks' }),
    ]);

    const lastTime = new Date(Number(lastYoinkedAt) * 1000).toLocaleString();
    const now = Math.floor(Date.now() / 1000);
    const cooldownRemaining = Math.max(0, COOLDOWN - (now - Number(lastYoinkedAt)));

    let output = `**Yoink Game Status**\n\n`;
    output += `**Current Flag Holder:** \`${holder}\`\n`;
    output += `**Last Yoinked:** ${lastTime}\n`;
    output += `**Cooldown:** ${cooldownRemaining > 0 ? `${cooldownRemaining}s remaining` : 'Ready!'}\n\n`;
    output += `**Total Yoinks:** ${totalYoinks}\n`;
    output += `**Trophy Holder:** \`${topYoinker}\`\n`;
    output += `**Most Yoinks:** ${mostYoinks}`;

    return output;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleScore(address: string): Promise<string> {
  if (!address) {
    return 'Usage: /yoink score <address>';
  }

  try {
    const client = getPublicClient();
    const [yoinks, time, lastAt] = await client.readContract({
      address: YOINK_CONTRACT,
      abi: YOINK_ABI,
      functionName: 'score',
      args: [address as Address],
    });

    const lastTime = Number(lastAt) > 0
      ? new Date(Number(lastAt) * 1000).toLocaleString()
      : 'Never';

    return `**Player Score**\n\n` +
      `Address: \`${address}\`\n` +
      `Yoinks: ${yoinks}\n` +
      `Time Held: ${Number(time)} seconds\n` +
      `Last Yoink: ${lastTime}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleCooldown(): Promise<string> {
  try {
    const client = getPublicClient();
    const lastYoinkedAt = await client.readContract({
      address: YOINK_CONTRACT,
      abi: YOINK_ABI,
      functionName: 'lastYoinkedAt',
    });

    const now = Math.floor(Date.now() / 1000);
    const remaining = Math.max(0, COOLDOWN - (now - Number(lastYoinkedAt)));

    if (remaining > 0) {
      return `Cooldown: ${remaining} seconds remaining\nReady at: ${new Date((Number(lastYoinkedAt) + COOLDOWN) * 1000).toLocaleString()}`;
    }
    return 'Cooldown complete! Ready to yoink!';
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || '';

  switch (command) {
    case '':
      return handleYoink();
    case 'status':
      return handleStatus();
    case 'score':
      return handleScore(parts[1]);
    case 'cooldown':
      return handleCooldown();
    case 'help':
    default:
      return `**Yoink - Capture the Flag**

/yoink                     Yoink the flag!
/yoink status              Game status
/yoink score <address>     Player score
/yoink cooldown            Check cooldown

**Rules:**
- 10 minute cooldown between yoinks
- Can't yoink from yourself
- Most yoinks wins trophy

Contract: \`${YOINK_CONTRACT}\``;
  }
}

export const tools = [
  {
    name: 'yoink_flag',
    description: 'Yoink the flag in the capture-the-flag game on Base',
    parameters: { type: 'object', properties: {} },
    execute: async () => handleYoink(),
  },
  {
    name: 'yoink_status',
    description: 'Get current Yoink game status - flag holder, total yoinks, trophy holder',
    parameters: { type: 'object', properties: {} },
    execute: async () => handleStatus(),
  },
  {
    name: 'yoink_score',
    description: 'Get a player score in the Yoink game',
    parameters: {
      type: 'object',
      properties: { address: { type: 'string', description: 'Player wallet address' } },
      required: ['address'],
    },
    execute: async ({ address }: { address: string }) => handleScore(address),
  },
];

export default {
  name: 'yoink',
  description: 'Yoink - capture the flag game on Base',
  commands: ['/yoink'],
  requires: { env: ['PRIVATE_KEY'] },
  handle: execute,
  tools,
};
