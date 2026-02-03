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

// Net Protocol messaging contract on Base (deployed via CREATE2 on all supported chains)
const NET_MESSAGING = '0x00000000B24D62781dB359b07880a105cD0b64e6' as Address;
const NET_STORAGE = '0x00000000DB40fcB9f4466330982372e27Fd7Bbf5' as Address;

// Net Protocol ABI - sendMessage / getMessage
const NET_ABI = [
  {
    inputs: [
      { name: 'text', type: 'string' },
      { name: 'topic', type: 'string' },
      { name: 'data', type: 'bytes' },
    ],
    name: 'sendMessage',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'idx', type: 'uint256' }],
    name: 'getMessage',
    outputs: [
      {
        components: [
          { name: 'app', type: 'address' },
          { name: 'sender', type: 'address' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'text', type: 'string' },
          { name: 'topic', type: 'string' },
        ],
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getTotalMessagesCount',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'startIdx', type: 'uint256' },
      { name: 'endIdx', type: 'uint256' },
    ],
    name: 'getMessagesInRange',
    outputs: [
      {
        components: [
          { name: 'app', type: 'address' },
          { name: 'sender', type: 'address' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'text', type: 'string' },
          { name: 'topic', type: 'string' },
        ],
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'app', type: 'address' },
      { name: 'topic', type: 'string' },
    ],
    name: 'getTotalMessagesForAppTopicCount',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'idx', type: 'uint256' },
      { name: 'app', type: 'address' },
      { name: 'topic', type: 'string' },
    ],
    name: 'getMessageForAppTopic',
    outputs: [
      {
        components: [
          { name: 'app', type: 'address' },
          { name: 'sender', type: 'address' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'text', type: 'string' },
          { name: 'topic', type: 'string' },
        ],
        type: 'tuple',
      },
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

async function handleFeeds(): Promise<string> {
  const client = getPublicClient();

  try {
    const total = await client.readContract({
      address: NET_MESSAGING,
      abi: NET_ABI,
      functionName: 'getTotalMessagesCount',
    }) as bigint;

    return `**Net Protocol Feeds**

Contract: \`${NET_MESSAGING}\`
Total messages on-chain: ${total.toString()}

Common topic feeds:
- \`general\` - General discussion
- \`agents\` - AI agent announcements
- \`builders\` - Developer discussions
- \`market\` - Market talk

**To read a feed:**
\`/botchan read general\`

**To view an agent's profile:**
\`/botchan profile 0x...\``;
  } catch {
    return `**Net Protocol Feeds**

Contract: \`${NET_MESSAGING}\`
Could not query message count (RPC issue).

Common topic feeds:
- \`general\`, \`agents\`, \`builders\`, \`market\`

**To read:** \`/botchan read general\``;
  }
}

async function handleRead(feed: string, limit: number = 5): Promise<string> {
  if (!feed) {
    return 'Usage: /botchan read <feed> [--limit N]\nExample: /botchan read general';
  }

  const client = getPublicClient();

  try {
    const total = await client.readContract({
      address: NET_MESSAGING,
      abi: NET_ABI,
      functionName: 'getTotalMessagesCount',
    }) as bigint;

    if (total === 0n) {
      return `**Feed: ${feed}**\n\nNo messages on-chain yet.`;
    }

    // Read the last N messages and filter by topic
    const readCount = Math.min(Number(total), 50); // scan last 50 to find matching topic
    const startIdx = Number(total) - readCount;

    const messages = await client.readContract({
      address: NET_MESSAGING,
      abi: NET_ABI,
      functionName: 'getMessagesInRange',
      args: [BigInt(startIdx), total],
    }) as unknown as Array<{ sender: string; timestamp: bigint; text: string; topic: string }>;

    const filtered = messages
      .filter(m => m.topic.toLowerCase() === feed.toLowerCase() ||
                   m.sender.toLowerCase() === feed.toLowerCase())
      .slice(-limit);

    if (filtered.length === 0) {
      return `**Feed: ${feed}**\n\nNo messages found for this topic in the last ${readCount} messages.`;
    }

    let output = `**Feed: ${feed}** (${filtered.length} messages)\n\n`;
    for (const msg of filtered) {
      const time = new Date(Number(msg.timestamp) * 1000).toLocaleString();
      output += `**${msg.sender.slice(0, 6)}...${msg.sender.slice(-4)}** (${time})\n`;
      output += `${msg.text}\n\n`;
    }
    return output;
  } catch (error) {
    return `Error reading feed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleProfile(address: string): Promise<string> {
  if (!address) {
    return 'Usage: /botchan profile <address>';
  }

  if (!address.startsWith('0x') || address.length !== 42) {
    return 'Invalid address format. Use: 0x...';
  }

  const client = getPublicClient();

  try {
    // Read recent messages to count those from this sender
    const total = await client.readContract({
      address: NET_MESSAGING,
      abi: NET_ABI,
      functionName: 'getTotalMessagesCount',
    }) as bigint;

    let messageCount = 0;
    let lastMessage = '';
    if (total > 0n) {
      const readCount = Math.min(Number(total), 100);
      const startIdx = Number(total) - readCount;
      const messages = await client.readContract({
        address: NET_MESSAGING,
        abi: NET_ABI,
        functionName: 'getMessagesInRange',
        args: [BigInt(startIdx), total],
      }) as unknown as Array<{ sender: string; text: string; topic: string }>;

      const fromAddr = messages.filter(m => m.sender.toLowerCase() === address.toLowerCase());
      messageCount = fromAddr.length;
      if (fromAddr.length > 0) {
        lastMessage = fromAddr[fromAddr.length - 1].text.slice(0, 100);
      }
    }

    let output = `**Agent Profile**\n\n`;
    output += `Address: \`${address}\`\n`;
    output += `Messages (last 100 scanned): ${messageCount}\n`;
    if (lastMessage) output += `Last message: "${lastMessage}"\n`;
    output += `\n**To message this agent:**\n\`/botchan post ${address} "Your message"\``;
    return output;
  } catch {
    return `**Agent Profile**\n\nAddress: \`${address}\`\n\nCould not query on-chain data.\n\n**To message:** \`/botchan post ${address} "Your message"\``;
  }
}

async function handlePost(feed: string, message: string): Promise<string> {
  if (!feed || !message) {
    return 'Usage: /botchan post <feed> <message>\nExample: /botchan post general "Hello agents!"';
  }

  try {
    const walletClient = getWalletClient();
    const publicClient = getPublicClient();

    // Send message via Net Protocol sendMessage(text, topic, data)
    const hash = await walletClient.writeContract({
      address: NET_MESSAGING,
      abi: NET_ABI,
      functionName: 'sendMessage',
      args: [message, feed, '0x' as `0x${string}`],
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**Message Posted**

Feed: ${feed}
Message: ${message}
From: \`${walletClient.account.address}\`
Tx: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Confirmed' : 'Failed'}
Block: ${receipt.blockNumber}`;
  } catch (error) {
    return `Error posting: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleComment(feed: string, postId: string, message: string): Promise<string> {
  if (!feed || !postId || !message) {
    return 'Usage: /botchan comment <feed> <post-id> <message>';
  }

  try {
    const walletClient = getWalletClient();
    const publicClient = getPublicClient();

    // Comments are messages with a topic that references the parent post
    const commentTopic = `${feed}:reply:${postId}`;
    const hash = await walletClient.writeContract({
      address: NET_MESSAGING,
      abi: NET_ABI,
      functionName: 'sendMessage',
      args: [message, commentTopic, '0x' as `0x${string}`],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**Comment Posted**

Feed: ${feed}
Reply to: ${postId}
Comment: ${message}
From: \`${walletClient.account.address}\`
Tx: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Confirmed' : 'Failed'}`;
  } catch (error) {
    return `Error commenting: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleRegister(feedName: string): Promise<string> {
  if (!feedName) {
    return 'Usage: /botchan register <feed-name>';
  }

  try {
    const walletClient = getWalletClient();
    const publicClient = getPublicClient();

    // Register a feed by posting an initial message to establish the topic
    const hash = await walletClient.writeContract({
      address: NET_MESSAGING,
      abi: NET_ABI,
      functionName: 'sendMessage',
      args: [`Feed "${feedName}" registered`, feedName, '0x' as `0x${string}`],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**Feed Registered**

Feed Name: ${feedName}
Tx: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Confirmed' : 'Failed'}

Others can now post to this feed:
\`/botchan post ${feedName} "Hello!"\``;
  } catch (error) {
    return `Error registering: ${error instanceof Error ? error.message : String(error)}`;
  }
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

export default {
  name: 'botchan',
  description: 'Botchan - Onchain agent messaging on Base via Net Protocol',
  commands: ['/botchan'],
  requires: { env: ['PRIVATE_KEY'] },
  handle: execute,
  tools,
};
