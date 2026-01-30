/**
 * Telegram Webhook Handler
 * Direct webhook integration (no grammY)
 */

import type { Env } from '../config';
import type { TelegramUpdate, TelegramMessage } from '../types';
import { handleMessage } from '../agent';
import { getOrCreateUser } from '../storage/d1';
import {
  generateSessionKey,
  getSession,
  addToSession,
  clearSession,
} from '../durable/session';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return new Response('Telegram not configured', { status: 503 });
  }

  try {
    const update = (await request.json()) as TelegramUpdate;

    // Handle message updates
    if (update.message) {
      ctx.waitUntil(processMessage(update.message, env));
    }

    // Always respond 200 OK quickly
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return new Response('OK', { status: 200 }); // Don't retry on errors
  }
}

async function processMessage(message: TelegramMessage, env: Env): Promise<void> {
  const chatId = message.chat.id;
  const userId = message.from?.id?.toString();
  const text = message.text?.trim();

  if (!userId || !text) return;

  // Handle commands
  if (text.startsWith('/')) {
    await handleCommand(text, chatId, userId, env);
    return;
  }

  try {
    // Get or create user
    const user = await getOrCreateUser(
      env.DB,
      'telegram',
      userId,
      message.from?.username
    );

    // Get session
    const sessionKey = generateSessionKey('telegram', chatId.toString(), userId);
    const session = await getSession(env, sessionKey);
    const history = session?.history || [];

    // Send typing indicator
    await sendChatAction(chatId, 'typing', env);

    // Process with agent
    const response = await handleMessage(text, history, user, env);

    // Save to session
    await addToSession(env, sessionKey, {
      userId: user.id,
      platform: 'telegram',
      chatId: chatId.toString(),
      role: 'user',
      content: text,
    });

    await addToSession(env, sessionKey, {
      userId: user.id,
      platform: 'telegram',
      chatId: chatId.toString(),
      role: 'assistant',
      content: response.text,
    });

    // Send response
    await sendMessage(chatId, response.text, env);
  } catch (error) {
    console.error('Error processing message:', error);
    await sendMessage(
      chatId,
      'Sorry, I encountered an error processing your request. Please try again.',
      env
    );
  }
}

async function handleCommand(
  command: string,
  chatId: number,
  userId: string,
  env: Env
): Promise<void> {
  const cmd = command.split(' ')[0].toLowerCase();
  const sessionKey = generateSessionKey('telegram', chatId.toString(), userId);

  switch (cmd) {
    case '/start':
      await sendMessage(
        chatId,
        `Welcome to Clodds! Claude + Odds - your AI assistant for prediction markets.

*What I can do:*
- Search markets across platforms
- Compare prices across Polymarket, Kalshi, Manifold
- Set price alerts
- Find arbitrage opportunities
- Calculate optimal bet sizing

*Commands:*
/new - Start fresh conversation
/help - Show all commands

Just send me a message to get started!`,
        env,
        'Markdown'
      );
      break;

    case '/new':
    case '/reset':
      await clearSession(env, sessionKey);
      await sendMessage(chatId, 'Conversation reset. What would you like to know?', env);
      break;

    case '/help':
      await sendMessage(
        chatId,
        `*Clodds Commands*

/start - Welcome message
/new - Start fresh conversation
/help - This message

*Example queries:*
- "Search for Trump markets"
- "Compare Bitcoin prices across platforms"
- "Find arbitrage opportunities"
- "Set alert for market X when price goes above 50c"
- "Calculate Kelly bet for 45c market if I think it's 55%"`,
        env,
        'Markdown'
      );
      break;

    default:
      // Unknown command, treat as message
      break;
  }
}

async function sendMessage(
  chatId: number,
  text: string,
  env: Env,
  parseMode?: 'Markdown' | 'HTML'
): Promise<void> {
  const url = `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  // Truncate if too long (Telegram limit is 4096)
  const truncated = text.length > 4000 ? text.slice(0, 4000) + '...' : text;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: truncated,
  };

  if (parseMode) {
    body.parse_mode = parseMode;
  }

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
  }
}

async function sendChatAction(
  chatId: number,
  action: string,
  env: Env
): Promise<void> {
  const url = `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendChatAction`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action,
      }),
    });
  } catch {
    // Ignore typing indicator failures
  }
}

// Utility to set up webhook
export async function setWebhook(
  env: Env,
  webhookUrl: string
): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;

  const url = `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/setWebhook`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query'],
    }),
  });

  return res.ok;
}
