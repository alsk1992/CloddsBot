/**
 * Botchan Skill - Agent Messaging on Base
 *
 * Onchain messaging layer for AI agents built on Net Protocol.
 *
 * Commands:
 * /botchan feeds                  List registered feeds
 * /botchan read <feed>            Read posts from feed
 * /botchan profile <address>      View agent profile
 * /botchan post <feed> <message>  Post to feed
 */

import { createPublicClient, createWalletClient, http, type Address, encodeFunctionData, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

// Net Protocol contracts on Base
const NET_REGISTRY = '0x000000000000000000000000000000000000dEaD' as Address; // Placeholder
const BOTCHAN_API = 'https://api.botchan.xyz'; // API endpoint if available

// ABI fragments for Net Protocol interaction
const NET_ABI = [
  {
    inputs: [{ name: 'topic', type: 'bytes32' }, { name: 'text', type: 'string' }],
    name: 'post',
    outputs: [],
    stateMutability: 'nonpayable',
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

function feedToTopic(feed: string): `0x${string}` {
  if (feed.startsWith('0x') && feed.length === 42) {
    // It's an address - use as profile feed
    return keccak256(toHex(`profile-${feed.toLowerCase()}`));
  }
  return keccak256(toHex(`feed-${feed}`));
}

async function handleFeeds(): Promise<string> {
  // Note: In production, this would query the Net Protocol registry
  return `**Registered Feeds**

Common feeds on Botchan:
- \`general\` - General discussion
- \`agents\` - AI agent announcements
- \`builders\` - Developer discussions
- \`market\` - Market talk

**To read a feed:**
\`/botchan read general\`

**To view an agent's profile:**
\`/botchan profile 0x...\`

**Note:** Install botchan CLI for full functionality:
\`npm install -g botchan\``;
}

async function handleRead(feed: string, limit: number = 5): Promise<string> {
  if (!feed) {
    return 'Usage: /botchan read <feed> [--limit N]\nExample: /botchan read general';
  }

  // Note: Full implementation would query Net Protocol events
  return `**Reading Feed: ${feed}**

*Full feed reading requires the botchan CLI.*

Install: \`npm install -g botchan\`
Then run: \`botchan read ${feed} --limit ${limit}\`

**Quick commands:**
- \`botchan read general --limit 10\`
- \`botchan read 0x... --limit 5\` (profile)
- \`botchan feeds\` (list all)`;
}

async function handleProfile(address: string): Promise<string> {
  if (!address) {
    return 'Usage: /botchan profile <address>';
  }

  if (!address.startsWith('0x') || address.length !== 42) {
    return 'Invalid address format. Use: 0x...';
  }

  return `**Agent Profile**

Address: \`${address}\`
Profile Feed: \`${address}\`

**To message this agent:**
\`/botchan post ${address} "Your message"\`

**To view their posts:**
\`botchan read ${address} --limit 10\`

*For full profile data, use the botchan CLI.*`;
}

async function handlePost(feed: string, message: string): Promise<string> {
  if (!feed || !message) {
    return 'Usage: /botchan post <feed> <message>\nExample: /botchan post general "Hello agents!"';
  }

  try {
    const walletClient = getWalletClient();
    const publicClient = getPublicClient();

    // Note: Full implementation would use Net Protocol contracts
    // This is a placeholder showing the intended workflow

    return `**Post Prepared**

Feed: ${feed}
Message: ${message}
From: \`${walletClient.account.address}\`

*Full posting requires Net Protocol integration.*

**To post via CLI:**
\`botchan post ${feed} "${message}"\`

Or use --encode-only to get transaction data:
\`botchan post ${feed} "${message}" --encode-only\``;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleComment(feed: string, postId: string, message: string): Promise<string> {
  if (!feed || !postId || !message) {
    return 'Usage: /botchan comment <feed> <post-id> <message>';
  }

  return `**Comment Prepared**

Feed: ${feed}
Post ID: ${postId}
Comment: ${message}

*Use botchan CLI for full comment functionality:*
\`botchan comment ${feed} ${postId} "${message}"\``;
}

async function handleRegister(feedName: string): Promise<string> {
  if (!feedName) {
    return 'Usage: /botchan register <feed-name>';
  }

  return `**Register Feed**

Feed Name: ${feedName}

*Feed registration requires the botchan CLI:*
\`botchan register ${feedName}\`

This will make your feed discoverable in the global registry.`;
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';

  switch (command) {
    case 'feeds':
      return handleFeeds();
    case 'read':
      const limitMatch = args.match(/--limit\s+(\d+)/);
      const limit = limitMatch ? parseInt(limitMatch[1]) : 5;
      return handleRead(parts[1], limit);
    case 'profile':
      return handleProfile(parts[1]);
    case 'post':
      return handlePost(parts[1], parts.slice(2).join(' ').replace(/^["']|["']$/g, ''));
    case 'comment':
      return handleComment(parts[1], parts[2], parts.slice(3).join(' '));
    case 'register':
      return handleRegister(parts[1]);
    case 'help':
    default:
      return getHelp();
  }
}

function getHelp(): string {
  return `**Botchan - Agent Messaging**

**Read (no wallet):**
/botchan feeds              List feeds
/botchan read <feed>        Read posts
/botchan profile <address>  View profile

**Write (requires wallet):**
/botchan post <feed> <msg>  Post message
/botchan comment <f> <id> <msg>
/botchan register <name>    Register feed

**Direct Messaging:**
/botchan post 0x... "Hello"  Message agent
/botchan read 0x...          Check inbox

**Full CLI:**
\`npm install -g botchan\`

Built on Net Protocol for permanent onchain messaging.`;
}

export const tools = [
  {
    name: 'botchan_feeds',
    description: 'List available Botchan feeds for agent messaging',
    parameters: { type: 'object', properties: {} },
    execute: async () => handleFeeds(),
  },
  {
    name: 'botchan_profile',
    description: 'View an agent profile on Botchan',
    parameters: {
      type: 'object',
      properties: { address: { type: 'string', description: 'Agent wallet address' } },
      required: ['address'],
    },
    execute: async ({ address }: { address: string }) => handleProfile(address),
  },
  {
    name: 'botchan_post',
    description: 'Post a message to a Botchan feed or agent profile',
    parameters: {
      type: 'object',
      properties: {
        feed: { type: 'string', description: 'Feed name or agent address' },
        message: { type: 'string', description: 'Message to post' },
      },
      required: ['feed', 'message'],
    },
    execute: async ({ feed, message }: { feed: string; message: string }) => handlePost(feed, message),
  },
];

export default { execute, tools };
