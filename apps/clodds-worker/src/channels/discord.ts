/**
 * Discord Interactions Handler
 * Uses Discord Interactions API (no gateway connection)
 */

import type { Env } from '../config';
import type { DiscordInteraction } from '../types';
import { handleMessage } from '../agent';
import { getOrCreateUser } from '../storage/d1';
import { verifyDiscordSignature } from '../utils/crypto';
import {
  generateSessionKey,
  getSession,
  addToSession,
  clearSession,
} from '../durable/session';

// Discord interaction types
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;

// Response types
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const DEFERRED_UPDATE_MESSAGE = 6;
const UPDATE_MESSAGE = 7;

export async function handleDiscordInteraction(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (!env.DISCORD_PUBLIC_KEY) {
    return new Response('Discord not configured', { status: 503 });
  }

  // Verify signature
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  const body = await request.text();

  if (!signature || !timestamp) {
    return new Response('Missing signature', { status: 401 });
  }

  const isValid = await verifyDiscordSignature(
    env.DISCORD_PUBLIC_KEY,
    signature,
    timestamp,
    body
  );

  if (!isValid) {
    return new Response('Invalid signature', { status: 401 });
  }

  const interaction = JSON.parse(body) as DiscordInteraction;

  // Handle ping
  if (interaction.type === PING) {
    return Response.json({ type: PONG });
  }

  // Handle slash commands
  if (interaction.type === APPLICATION_COMMAND && interaction.data) {
    return handleSlashCommand(interaction, env, ctx);
  }

  return Response.json({ type: PONG });
}

async function handleSlashCommand(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const commandName = interaction.data?.name;
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const channelId = interaction.channel_id;

  if (!userId || !channelId || !commandName) {
    return Response.json({
      type: CHANNEL_MESSAGE,
      data: { content: 'Invalid interaction' },
    });
  }

  // Handle built-in commands
  if (commandName === 'help') {
    return Response.json({
      type: CHANNEL_MESSAGE,
      data: {
        content: `**Clodds - Prediction Market Assistant**

**Commands:**
\`/ask <question>\` - Ask about prediction markets
\`/search <query>\` - Search for markets
\`/price <market>\` - Get current price
\`/arbitrage\` - Find arbitrage opportunities
\`/reset\` - Clear conversation history
\`/help\` - Show this message

**Example:**
\`/ask What are the best Trump markets?\``,
      },
    });
  }

  if (commandName === 'reset') {
    const sessionKey = generateSessionKey('discord', channelId, userId);
    await clearSession(env, sessionKey);
    return Response.json({
      type: CHANNEL_MESSAGE,
      data: { content: 'Conversation reset. What would you like to know?' },
    });
  }

  // Handle ask/search/price commands
  if (['ask', 'search', 'price', 'arbitrage'].includes(commandName)) {
    // Defer response (we'll follow up)
    ctx.waitUntil(
      processCommand(interaction, commandName, env).catch((error) => {
        console.error('Discord command error:', error);
        followUp(interaction.token, 'Sorry, an error occurred.', env);
      })
    );

    return Response.json({
      type: DEFERRED_CHANNEL_MESSAGE,
    });
  }

  return Response.json({
    type: CHANNEL_MESSAGE,
    data: { content: `Unknown command: ${commandName}` },
  });
}

async function processCommand(
  interaction: DiscordInteraction,
  commandName: string,
  env: Env
): Promise<void> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const username = interaction.member?.user?.username || interaction.user?.username;
  const channelId = interaction.channel_id;

  if (!userId || !channelId) return;

  // Get query from options
  const options = interaction.data?.options || [];
  const queryOption = options.find((o) => o.name === 'query' || o.name === 'question');
  const query = queryOption?.value as string | undefined;

  // Build the message based on command
  let message: string;
  switch (commandName) {
    case 'ask':
      message = query || 'What prediction markets should I know about?';
      break;
    case 'search':
      message = query ? `Search for markets: ${query}` : 'Search for popular markets';
      break;
    case 'price':
      message = query ? `Get price for: ${query}` : 'Show me market prices';
      break;
    case 'arbitrage':
      message = 'Find arbitrage opportunities';
      break;
    default:
      message = query || 'Help me with prediction markets';
  }

  // Get user and session
  const user = await getOrCreateUser(env.DB, 'discord', userId, username);
  const sessionKey = generateSessionKey('discord', channelId, userId);
  const session = await getSession(env, sessionKey);
  const history = session?.history || [];

  // Process with agent
  const response = await handleMessage(message, history, user, env);

  // Save to session
  await addToSession(env, sessionKey, {
    userId: user.id,
    platform: 'discord',
    chatId: channelId,
    role: 'user',
    content: message,
  });

  await addToSession(env, sessionKey, {
    userId: user.id,
    platform: 'discord',
    chatId: channelId,
    role: 'assistant',
    content: response.text,
  });

  // Follow up with response
  await followUp(interaction.token, response.text, env);
}

async function followUp(
  token: string,
  content: string,
  env: Env
): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) return;

  // Truncate if too long (Discord limit is 2000)
  const truncated = content.length > 1900 ? content.slice(0, 1900) + '...' : content;

  // Use webhook to follow up
  const url = `https://discord.com/api/v10/webhooks/${getApplicationId(env)}/${token}`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({ content: truncated }),
    });
  } catch (error) {
    console.error('Failed to send Discord follow-up:', error);
  }
}

function getApplicationId(env: Env): string {
  // Extract from bot token (token format: base64(app_id).timestamp.hmac)
  if (!env.DISCORD_BOT_TOKEN) return '';
  const parts = env.DISCORD_BOT_TOKEN.split('.');
  if (parts.length < 1) return '';
  try {
    return atob(parts[0]);
  } catch {
    return '';
  }
}

// Slash command registration helper
export async function registerCommands(env: Env): Promise<boolean> {
  if (!env.DISCORD_BOT_TOKEN) return false;

  const applicationId = getApplicationId(env);
  if (!applicationId) return false;

  const commands = [
    {
      name: 'ask',
      description: 'Ask Clodds about prediction markets',
      options: [
        {
          name: 'question',
          description: 'Your question',
          type: 3, // STRING
          required: true,
        },
      ],
    },
    {
      name: 'search',
      description: 'Search for prediction markets',
      options: [
        {
          name: 'query',
          description: 'Search query',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'price',
      description: 'Get price for a market',
      options: [
        {
          name: 'query',
          description: 'Market name or ID',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'arbitrage',
      description: 'Find arbitrage opportunities',
    },
    {
      name: 'reset',
      description: 'Clear conversation history',
    },
    {
      name: 'help',
      description: 'Show help information',
    },
  ];

  const url = `https://discord.com/api/v10/applications/${applicationId}/commands`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
    body: JSON.stringify(commands),
  });

  return res.ok;
}
