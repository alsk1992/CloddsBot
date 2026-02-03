/**
 * QR Coin Skill - QR Code Auctions on Base
 *
 * Contract: 0x7309779122069EFa06ef71a45AE0DB55A259A176
 * USDC: 0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913
 *
 * Commands:
 * /qr status                   Current auction info
 * /qr reserves                 Check reserve prices
 * /qr bid <url> <name>         Create new bid
 * /qr contribute <url> <name>  Contribute to existing bid
 * /qr approve <amount>         Approve USDC
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const QR_AUCTION = '0x7309779122069EFa06ef71a45AE0DB55A259A176' as Address;
const USDC = '0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913' as Address;

const QR_ABI = [
  { inputs: [], name: 'currentTokenId', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'tokenId', type: 'uint256' }], name: 'auctionEndTime', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'createBidReserve', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'contributeReserve', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'url', type: 'string' }, { name: 'name', type: 'string' }],
    name: 'createBid',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'url', type: 'string' }, { name: 'name', type: 'string' }],
    name: 'contributeToBid',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    name: 'approve',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    name: 'allowance',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
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

async function handleStatus(): Promise<string> {
  try {
    const client = getPublicClient();

    const tokenId = await client.readContract({
      address: QR_AUCTION,
      abi: QR_ABI,
      functionName: 'currentTokenId',
    });

    const [endTime, createReserve, contributeReserve] = await Promise.all([
      client.readContract({ address: QR_AUCTION, abi: QR_ABI, functionName: 'auctionEndTime', args: [tokenId] }),
      client.readContract({ address: QR_AUCTION, abi: QR_ABI, functionName: 'createBidReserve' }),
      client.readContract({ address: QR_AUCTION, abi: QR_ABI, functionName: 'contributeReserve' }),
    ]);

    const endDate = new Date(Number(endTime) * 1000);
    const now = new Date();
    const remaining = Math.max(0, Math.floor((endDate.getTime() - now.getTime()) / 1000));
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);

    return `**QR Coin Auction Status**

**Current Auction:** #${tokenId}
**End Time:** ${endDate.toLocaleString()}
**Time Remaining:** ${hours}h ${minutes}m

**Reserve Prices:**
- Create Bid: ${formatUnits(createReserve, 6)} USDC
- Contribute: ${formatUnits(contributeReserve, 6)} USDC

**Platform:** https://qrcoin.fun`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleReserves(): Promise<string> {
  try {
    const client = getPublicClient();

    const [createReserve, contributeReserve] = await Promise.all([
      client.readContract({ address: QR_AUCTION, abi: QR_ABI, functionName: 'createBidReserve' }),
      client.readContract({ address: QR_AUCTION, abi: QR_ABI, functionName: 'contributeReserve' }),
    ]);

    return `**QR Coin Reserve Prices**

- **Create New Bid:** ${formatUnits(createReserve, 6)} USDC
- **Contribute to Bid:** ${formatUnits(contributeReserve, 6)} USDC

*Create a new bid to start; contribute to support existing URLs.*`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBid(url: string, name: string): Promise<string> {
  if (!url || !name) {
    return 'Usage: /qr bid <url> <name>\nExample: /qr bid https://mysite.com "MyProject"';
  }

  try {
    const publicClient = getPublicClient();
    const walletClient = getWalletClient();

    // Get current token ID
    const tokenId = await publicClient.readContract({
      address: QR_AUCTION,
      abi: QR_ABI,
      functionName: 'currentTokenId',
    });

    // Check allowance
    const allowance = await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [walletClient.account.address, QR_AUCTION],
    });

    const createReserve = await publicClient.readContract({
      address: QR_AUCTION,
      abi: QR_ABI,
      functionName: 'createBidReserve',
    });

    if (allowance < createReserve) {
      return `Insufficient USDC allowance. Run:\n/qr approve 50\n\nThen try bidding again.`;
    }

    // Create bid
    const hash = await walletClient.writeContract({
      address: QR_AUCTION,
      abi: QR_ABI,
      functionName: 'createBid',
      args: [tokenId, url, name],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**Bid Created!**

URL: ${url}
Name: ${name}
Token ID: #${tokenId}
Cost: ~${formatUnits(createReserve, 6)} USDC
TX: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('URL_ALREADY_HAS_BID')) {
      return 'This URL already has a bid. Use `/qr contribute` instead.';
    }
    return `Bid failed: ${msg}`;
  }
}

async function handleContribute(url: string, name: string): Promise<string> {
  if (!url || !name) {
    return 'Usage: /qr contribute <url> <name>\nExample: /qr contribute https://mysite.com "MyProject"';
  }

  try {
    const publicClient = getPublicClient();
    const walletClient = getWalletClient();

    const tokenId = await publicClient.readContract({
      address: QR_AUCTION,
      abi: QR_ABI,
      functionName: 'currentTokenId',
    });

    const allowance = await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [walletClient.account.address, QR_AUCTION],
    });

    const contributeReserve = await publicClient.readContract({
      address: QR_AUCTION,
      abi: QR_ABI,
      functionName: 'contributeReserve',
    });

    if (allowance < contributeReserve) {
      return `Insufficient USDC allowance. Run:\n/qr approve 10\n\nThen try again.`;
    }

    const hash = await walletClient.writeContract({
      address: QR_AUCTION,
      abi: QR_ABI,
      functionName: 'contributeToBid',
      args: [tokenId, url, name],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**Contribution Added!**

URL: ${url}
Name: ${name}
Cost: ~${formatUnits(contributeReserve, 6)} USDC
TX: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('BID_NOT_FOUND')) {
      return 'No existing bid for this URL. Use `/qr bid` to create one.';
    }
    return `Contribute failed: ${msg}`;
  }
}

async function handleApprove(amount: string): Promise<string> {
  if (!amount) {
    return 'Usage: /qr approve <amount>\nExample: /qr approve 50';
  }

  try {
    const publicClient = getPublicClient();
    const walletClient = getWalletClient();

    const amountWei = parseUnits(amount, 6);

    const hash = await walletClient.writeContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [QR_AUCTION, amountWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**USDC Approved**

Amount: ${amount} USDC
Spender: QR Auction
TX: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}

You can now bid on QR auctions!`;
  } catch (error) {
    return `Approve failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'status';
  const rest = parts.slice(1);

  switch (command) {
    case 'status':
      return handleStatus();
    case 'reserves':
      return handleReserves();
    case 'bid':
      return handleBid(rest[0], rest.slice(1).join(' ').replace(/^["']|["']$/g, ''));
    case 'contribute':
      return handleContribute(rest[0], rest.slice(1).join(' ').replace(/^["']|["']$/g, ''));
    case 'approve':
      return handleApprove(rest[0]);
    case 'help':
    default:
      return `**QR Coin - QR Code Auctions**

/qr status                    Auction info
/qr reserves                  Reserve prices
/qr bid <url> <name>          Create bid (~11 USDC)
/qr contribute <url> <name>   Contribute (~1 USDC)
/qr approve <amount>          Approve USDC

**How it works:**
1. Approve USDC: /qr approve 50
2. Create bid: /qr bid https://mysite.com "MyProject"
3. Or contribute to existing: /qr contribute https://mysite.com "MyProject"
4. Highest bid wins!

Platform: https://qrcoin.fun`;
  }
}

export const tools = [
  {
    name: 'qrcoin_status',
    description: 'Get current QR Coin auction status',
    parameters: { type: 'object', properties: {} },
    execute: async () => handleStatus(),
  },
  {
    name: 'qrcoin_bid',
    description: 'Create a new bid on QR Coin auction',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to encode in QR code' },
        name: { type: 'string', description: 'Display name for the bid' },
      },
      required: ['url', 'name'],
    },
    execute: async ({ url, name }: { url: string; name: string }) => handleBid(url, name),
  },
];

export default {
  name: 'qrcoin',
  description: 'QR Coin auctions on Base - bid, check status, and manage QR code NFTs',
  commands: ['/qrcoin'],
  requires: { env: ['PRIVATE_KEY'] },
  handle: execute,
  tools,
};
