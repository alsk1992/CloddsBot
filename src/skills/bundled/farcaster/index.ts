/**
 * Farcaster Skill - Social protocol via Neynar API
 *
 * Commands:
 * /fc user <username>         Look up user
 * /fc search-users <query>    Search users
 * /fc feed [--channel X]      Get feed
 * /fc trending                Trending casts
 * /fc search <query>          Search casts
 * /fc channel <id>            Channel info
 * /fc channels <query>        Search channels
 * /fc post <text>             Post cast
 * /fc reply <hash> <text>     Reply to cast
 * /fc like <hash>             Like cast
 * /fc recast <hash>           Recast
 * /fc follow <username>       Follow user
 * /fc unfollow <username>     Unfollow user
 */

import { getNeynarClient, type Cast, type FarcasterUser, type Channel } from '../../../farcaster';

// =============================================================================
// Execute
// =============================================================================

export async function execute(args: string): Promise<string> {
  const trimmed = args.trim();

  if (!trimmed || trimmed === 'help' || trimmed === '--help') {
    return getHelp();
  }

  const [cmd, ...rest] = trimmed.split(/\s+/);
  const restStr = rest.join(' ');

  try {
    switch (cmd) {
      case 'user':
        return handleUser(restStr);
      case 'search-users':
        return handleSearchUsers(restStr);
      case 'feed':
        return handleFeed(restStr);
      case 'trending':
        return handleTrending();
      case 'search':
        return handleSearch(restStr);
      case 'channel':
        return handleChannel(restStr);
      case 'channels':
        return handleSearchChannels(restStr);
      case 'post':
        return handlePost(restStr);
      case 'reply':
        return handleReply(restStr);
      case 'like':
        return handleLike(restStr);
      case 'recast':
        return handleRecast(restStr);
      case 'follow':
        return handleFollow(restStr);
      case 'unfollow':
        return handleUnfollow(restStr);
      default:
        return `Unknown command: ${cmd}\n\n${getHelp()}`;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `❌ Error: ${msg}`;
  }
}

// =============================================================================
// Handlers
// =============================================================================

async function handleUser(username: string): Promise<string> {
  if (!username) return '❌ Usage: /fc user <username>';

  const client = getNeynarClient();
  const user = await client.getUserByUsername(username.replace('@', ''));
  return formatUser(user);
}

async function handleSearchUsers(query: string): Promise<string> {
  if (!query) return '❌ Usage: /fc search-users <query>';

  const client = getNeynarClient();
  const users = await client.searchUsers(query, 10);

  if (users.length === 0) return 'No users found.';

  return users.map((u) => `@${u.username} (${u.displayName}) - ${u.followerCount} followers`).join('\n');
}

async function handleFeed(args: string): Promise<string> {
  const client = getNeynarClient();

  // Parse --channel flag
  const channelMatch = args.match(/--channel\s+(\S+)/);
  const channelId = channelMatch?.[1];

  let casts: Cast[];
  if (channelId) {
    casts = await client.getChannelFeed(channelId, { limit: 10 });
  } else {
    casts = await client.getTrendingCasts({ limit: 10 });
  }

  if (casts.length === 0) return 'No casts found.';

  return casts.map(formatCast).join('\n\n---\n\n');
}

async function handleTrending(): Promise<string> {
  const client = getNeynarClient();
  const casts = await client.getTrendingCasts({ limit: 10 });

  if (casts.length === 0) return 'No trending casts.';

  return '**Trending on Farcaster**\n\n' + casts.map(formatCast).join('\n\n---\n\n');
}

async function handleSearch(query: string): Promise<string> {
  if (!query) return '❌ Usage: /fc search <query>';

  const client = getNeynarClient();
  const casts = await client.searchCasts(query, { limit: 10 });

  if (casts.length === 0) return 'No casts found.';

  return casts.map(formatCast).join('\n\n---\n\n');
}

async function handleChannel(channelId: string): Promise<string> {
  if (!channelId) return '❌ Usage: /fc channel <id>';

  const client = getNeynarClient();
  const channel = await client.getChannel(channelId);
  return formatChannel(channel);
}

async function handleSearchChannels(query: string): Promise<string> {
  if (!query) return '❌ Usage: /fc channels <query>';

  const client = getNeynarClient();
  const channels = await client.searchChannels(query, 10);

  if (channels.length === 0) return 'No channels found.';

  return channels.map((ch) => `/${ch.id} - ${ch.name} (${ch.followerCount} followers)`).join('\n');
}

async function handlePost(text: string): Promise<string> {
  if (!text) return '❌ Usage: /fc post <text>';

  const client = getNeynarClient();
  const cast = await client.postCast(text);
  return `✅ Posted!\n\n${formatCast(cast)}`;
}

async function handleReply(args: string): Promise<string> {
  const [hash, ...textParts] = args.split(/\s+/);
  const text = textParts.join(' ');

  if (!hash || !text) return '❌ Usage: /fc reply <hash> <text>';

  const client = getNeynarClient();
  const cast = await client.postCast(text, { parentHash: hash });
  return `✅ Replied!\n\n${formatCast(cast)}`;
}

async function handleLike(hash: string): Promise<string> {
  if (!hash) return '❌ Usage: /fc like <hash>';

  const client = getNeynarClient();
  await client.likeCast(hash);
  return `✅ Liked cast ${hash.slice(0, 10)}...`;
}

async function handleRecast(hash: string): Promise<string> {
  if (!hash) return '❌ Usage: /fc recast <hash>';

  const client = getNeynarClient();
  await client.recastCast(hash);
  return `✅ Recasted ${hash.slice(0, 10)}...`;
}

async function handleFollow(username: string): Promise<string> {
  if (!username) return '❌ Usage: /fc follow <username>';

  const client = getNeynarClient();
  const user = await client.getUserByUsername(username.replace('@', ''));
  await client.followUser(user.fid);
  return `✅ Now following @${user.username}`;
}

async function handleUnfollow(username: string): Promise<string> {
  if (!username) return '❌ Usage: /fc unfollow <username>';

  const client = getNeynarClient();
  const user = await client.getUserByUsername(username.replace('@', ''));
  await client.unfollowUser(user.fid);
  return `✅ Unfollowed @${user.username}`;
}

// =============================================================================
// Formatting
// =============================================================================

function formatUser(u: FarcasterUser): string {
  const lines = [
    `**@${u.username}** (${u.displayName})`,
    u.bio ? `> ${u.bio}` : '',
    '',
    `📊 ${u.followerCount.toLocaleString()} followers · ${u.followingCount.toLocaleString()} following`,
    `🆔 FID: ${u.fid}`,
  ];

  if (u.verifiedAddresses?.ethAddresses?.length) {
    lines.push(`🔗 ETH: ${u.verifiedAddresses.ethAddresses[0]}`);
  }
  if (u.verifiedAddresses?.solAddresses?.length) {
    lines.push(`🔗 SOL: ${u.verifiedAddresses.solAddresses[0]}`);
  }

  return lines.filter(Boolean).join('\n');
}

function formatCast(c: Cast): string {
  const channelStr = c.channel ? ` in /${c.channel.id}` : '';
  const lines = [
    `**@${c.author.username}**${channelStr}`,
    c.text,
    '',
    `❤️ ${c.reactions.likes} · 🔁 ${c.reactions.recasts} · 💬 ${c.replies.count}`,
    `\`${c.hash.slice(0, 10)}...\``,
  ];
  return lines.join('\n');
}

function formatChannel(ch: Channel): string {
  return [
    `**/${ch.id}** - ${ch.name}`,
    ch.description ? `> ${ch.description}` : '',
    '',
    `👥 ${ch.followerCount.toLocaleString()} followers`,
  ].filter(Boolean).join('\n');
}

function getHelp(): string {
  return `**Farcaster** - Social Protocol

**Read:**
\`/fc user <username>\` - Look up user
\`/fc search-users <query>\` - Search users
\`/fc feed [--channel X]\` - Get feed
\`/fc trending\` - Trending casts
\`/fc search <query>\` - Search casts
\`/fc channel <id>\` - Channel info
\`/fc channels <query>\` - Search channels

**Write (requires NEYNAR_SIGNER_UUID):**
\`/fc post <text>\` - Post cast
\`/fc reply <hash> <text>\` - Reply
\`/fc like <hash>\` - Like
\`/fc recast <hash>\` - Recast
\`/fc follow <username>\` - Follow
\`/fc unfollow <username>\` - Unfollow`;
}

// =============================================================================
// Agent Tools
// =============================================================================

export const tools = [
  {
    name: 'farcaster_user',
    description: 'Get Farcaster user profile by username',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Farcaster username' },
      },
      required: ['username'],
    },
    execute: async ({ username }: { username: string }) => handleUser(username),
  },
  {
    name: 'farcaster_search',
    description: 'Search Farcaster casts',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    execute: async ({ query }: { query: string }) => handleSearch(query),
  },
  {
    name: 'farcaster_trending',
    description: 'Get trending Farcaster casts',
    parameters: { type: 'object', properties: {} },
    execute: async () => handleTrending(),
  },
  {
    name: 'farcaster_post',
    description: 'Post a cast to Farcaster (requires signer)',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Cast text' },
        channelId: { type: 'string', description: 'Optional channel ID' },
      },
      required: ['text'],
    },
    execute: async ({ text, channelId }: { text: string; channelId?: string }) => {
      if (!text) return '❌ Text required';
      const client = getNeynarClient();
      const cast = await client.postCast(text, { channelId });
      return `✅ Posted!\n\n${formatCast(cast)}`;
    },
  },
  {
    name: 'farcaster_channel_feed',
    description: 'Get casts from a Farcaster channel',
    parameters: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Channel ID (e.g., "base", "ethereum")' },
      },
      required: ['channelId'],
    },
    execute: async ({ channelId }: { channelId: string }) => handleFeed(`--channel ${channelId}`),
  },
];
