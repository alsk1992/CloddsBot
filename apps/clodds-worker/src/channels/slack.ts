/**
 * Slack Events API Handler
 */

import type { Env } from '../config';
import type { SlackEvent, SlackEventPayload } from '../types';
import { handleMessage } from '../agent';
import { getOrCreateUser } from '../storage/d1';
import { verifySlackSignature } from '../utils/crypto';
import {
  generateSessionKey,
  getSession,
  addToSession,
  clearSession,
} from '../durable/session';

export async function handleSlackEvent(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (!env.SLACK_SIGNING_SECRET || !env.SLACK_BOT_TOKEN) {
    return new Response('Slack not configured', { status: 503 });
  }

  // Get signature headers
  const signature = request.headers.get('X-Slack-Signature');
  const timestamp = request.headers.get('X-Slack-Request-Timestamp');
  const body = await request.text();

  if (!signature || !timestamp) {
    return new Response('Missing signature', { status: 401 });
  }

  // Check timestamp (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 60 * 5) {
    return new Response('Request too old', { status: 401 });
  }

  // Verify signature
  const isValid = await verifySlackSignature(
    env.SLACK_SIGNING_SECRET,
    signature,
    timestamp,
    body
  );

  if (!isValid) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(body) as SlackEvent;

  // Handle URL verification challenge
  if (event.type === 'url_verification' && event.challenge) {
    return new Response(event.challenge, {
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Handle events
  if (event.type === 'event_callback' && event.event) {
    ctx.waitUntil(processEvent(event.event, env));
  }

  // Always respond 200 quickly
  return new Response('OK', { status: 200 });
}

async function processEvent(event: SlackEventPayload, env: Env): Promise<void> {
  // Only handle message events
  if (event.type !== 'message' && event.type !== 'app_mention') {
    return;
  }

  const userId = event.user;
  const channelId = event.channel;
  const text = event.text?.trim();
  const threadTs = event.thread_ts || event.ts;

  if (!userId || !channelId || !text) return;

  // Ignore bot messages
  if (text.includes('<@') && !text.includes(env.SLACK_BOT_TOKEN?.slice(0, 10) || '')) {
    // Check if the bot was mentioned
    // This is a simplified check - in production you'd check the bot user ID
  }

  // Handle commands
  if (text.startsWith('/clodds')) {
    const command = text.replace('/clodds', '').trim();
    await handleCommand(command, channelId, userId, threadTs, env);
    return;
  }

  // Check for reset keywords
  if (text.toLowerCase() === 'reset' || text.toLowerCase() === 'new') {
    const sessionKey = generateSessionKey('slack', channelId, userId);
    await clearSession(env, sessionKey);
    await postMessage(channelId, 'Conversation reset. What would you like to know?', env, threadTs);
    return;
  }

  try {
    // Get user and session
    const user = await getOrCreateUser(env.DB, 'slack', userId);
    const sessionKey = generateSessionKey('slack', channelId, userId);
    const session = await getSession(env, sessionKey);
    const history = session?.history || [];

    // Process with agent
    const response = await handleMessage(text, history, user, env);

    // Save to session
    await addToSession(env, sessionKey, {
      userId: user.id,
      platform: 'slack',
      chatId: channelId,
      role: 'user',
      content: text,
    });

    await addToSession(env, sessionKey, {
      userId: user.id,
      platform: 'slack',
      chatId: channelId,
      role: 'assistant',
      content: response.text,
    });

    // Send response in thread
    await postMessage(channelId, response.text, env, threadTs);
  } catch (error) {
    console.error('Error processing Slack message:', error);
    await postMessage(
      channelId,
      'Sorry, I encountered an error processing your request.',
      env,
      threadTs
    );
  }
}

async function handleCommand(
  command: string,
  channelId: string,
  userId: string,
  threadTs: string,
  env: Env
): Promise<void> {
  const sessionKey = generateSessionKey('slack', channelId, userId);
  const parts = command.split(' ');
  const cmd = parts[0]?.toLowerCase();

  switch (cmd) {
    case 'help':
    case '':
      await postMessage(
        channelId,
        `*Clodds - Prediction Market Assistant*

*Commands:*
\`/clodds help\` - Show this message
\`reset\` or \`new\` - Clear conversation history

*Just mention me or DM me to:*
- Search markets across Polymarket, Kalshi, Manifold
- Compare prices across platforms
- Find arbitrage opportunities
- Set price alerts
- Calculate optimal bet sizing

*Example:*
"@clodds search for Bitcoin markets"`,
        env,
        threadTs
      );
      break;

    case 'reset':
      await clearSession(env, sessionKey);
      await postMessage(channelId, 'Conversation reset.', env, threadTs);
      break;

    default:
      // Treat as a question
      const user = await getOrCreateUser(env.DB, 'slack', userId);
      const session = await getSession(env, sessionKey);
      const history = session?.history || [];
      const response = await handleMessage(command, history, user, env);
      await postMessage(channelId, response.text, env, threadTs);
  }
}

async function postMessage(
  channel: string,
  text: string,
  env: Env,
  threadTs?: string
): Promise<void> {
  if (!env.SLACK_BOT_TOKEN) return;

  // Truncate if too long (Slack has various limits)
  const truncated = text.length > 3000 ? text.slice(0, 3000) + '...' : text;

  const body: Record<string, unknown> = {
    channel,
    text: truncated,
    mrkdwn: true,
  };

  if (threadTs) {
    body.thread_ts = threadTs;
  }

  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('Failed to send Slack message:', error);
  }
}
