/**
 * Telegram Channel - grammY integration
 * Supports DM pairing (Clawdbot-style), allowlists, and group chats
 */

import { Bot, Context } from 'grammy';
import { logger } from '../../utils/logger';
import type { ChannelCallbacks, ChannelAdapter } from '../index';
import type { Config, OutgoingMessage, IncomingMessage, MessageAttachment } from '../../types';
import type { PairingService } from '../../pairing/index';

export async function createTelegramChannel(
  config: NonNullable<Config['channels']['telegram']>,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<ChannelAdapter> {
  const bot = new Bot(config.botToken);

  // Static allowlist from config (always paired)
  const staticAllowlist = new Set<string>(config.allowFrom || []);

  /**
   * Check if a user is allowed to DM
   */
  function isUserAllowed(userId: string): boolean {
    // Static allowlist always allowed
    if (staticAllowlist.has(userId)) return true;

    // Check pairing service
    if (pairing?.isPaired('telegram', userId)) return true;

    return false;
  }

  // Handle /start command
  bot.command('start', async (ctx) => {
    const userId = ctx.from?.id?.toString() || '';
    const username = ctx.from?.username;
    const args = ctx.match;

    // Check if this is a pairing attempt (8-char code in deep link)
    if (args && args.length === 8 && pairing) {
      const code = args.toUpperCase();
      const request = await pairing.validateCode(code);
      if (request) {
        await ctx.reply(
          '✅ *Successfully paired!*\n\n' +
            'You can now chat with Clodds. Try asking about prediction markets!',
          { parse_mode: 'Markdown' }
        );
        logger.info({ userId, code }, 'User paired via Telegram deep link');
        return;
      }
    }

    // Welcome message
    await ctx.reply(
      `🎲 *Welcome to Clodds!*\n\n` +
        `Claude + Odds — your AI assistant for prediction markets.\n\n` +
        `*What I can do:*\n` +
        `• Search markets across platforms\n` +
        `• Track your portfolio & P&L\n` +
        `• Set price alerts\n` +
        `• Find edge vs external models\n` +
        `• Monitor market-moving news\n\n` +
        `*Commands:*\n` +
        `\`/new\` - Start fresh conversation\n` +
        `\`/status\` - Check session status\n` +
        `\`/help\` - Show all commands\n\n` +
        `Just send me a message to get started!`,
      { parse_mode: 'Markdown' }
    );
  });

  // Helper to extract attachments from message
  async function extractAttachments(ctx: Context): Promise<MessageAttachment[]> {
    const msg = ctx.message;
    if (!msg) return [];

    const attachments: MessageAttachment[] = [];

    // Photo
    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      try {
        const file = await ctx.api.getFile(largest.file_id);
        attachments.push({
          type: 'image',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          width: largest.width,
          height: largest.height,
          caption: msg.caption,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get photo file');
      }
    }

    // Document
    if (msg.document) {
      try {
        const file = await ctx.api.getFile(msg.document.file_id);
        attachments.push({
          type: 'document',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          filename: msg.document.file_name,
          mimeType: msg.document.mime_type,
          size: msg.document.file_size,
          caption: msg.caption,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get document file');
      }
    }

    // Voice
    if (msg.voice) {
      try {
        const file = await ctx.api.getFile(msg.voice.file_id);
        attachments.push({
          type: 'voice',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          mimeType: msg.voice.mime_type,
          duration: msg.voice.duration,
          size: msg.voice.file_size,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get voice file');
      }
    }

    // Video
    if (msg.video) {
      try {
        const file = await ctx.api.getFile(msg.video.file_id);
        attachments.push({
          type: 'video',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          width: msg.video.width,
          height: msg.video.height,
          duration: msg.video.duration,
          mimeType: msg.video.mime_type,
          size: msg.video.file_size,
          caption: msg.caption,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get video file');
      }
    }

    // Audio
    if (msg.audio) {
      try {
        const file = await ctx.api.getFile(msg.audio.file_id);
        attachments.push({
          type: 'audio',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          filename: msg.audio.file_name,
          mimeType: msg.audio.mime_type,
          duration: msg.audio.duration,
          size: msg.audio.file_size,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get audio file');
      }
    }

    // Sticker
    if (msg.sticker) {
      try {
        const file = await ctx.api.getFile(msg.sticker.file_id);
        attachments.push({
          type: 'sticker',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          width: msg.sticker.width,
          height: msg.sticker.height,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get sticker file');
      }
    }

    return attachments;
  }

  // Handle incoming messages (text and media)
  bot.on('message', async (ctx: Context) => {
    const msg = ctx.message;
    if (!msg) return;

    // Get text (may be from caption for media messages)
    const text = msg.text || msg.caption || '';

    // Skip empty messages and commands handled elsewhere
    if (!text && !msg.photo && !msg.document && !msg.voice && !msg.video && !msg.audio) return;
    if (text.startsWith('/start') || text.startsWith('/help')) return;

    const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    const userId = msg.from?.id?.toString() || '';
    const username = msg.from?.username;

    // DM Policy enforcement (only for DMs, not groups)
    if (!isGroup) {
      switch (config.dmPolicy) {
        case 'allowlist':
          if (!isUserAllowed(userId)) {
            logger.info({ userId }, 'Ignoring message from non-allowlisted user');
            return;
          }
          break;

        case 'pairing':
          if (!isUserAllowed(userId)) {
            // Check if message is a pairing code (8 uppercase alphanumeric)
            const potentialCode = text.trim().toUpperCase();
            if (/^[A-Z0-9]{8}$/.test(potentialCode) && pairing) {
              const request = await pairing.validateCode(potentialCode);
              if (request) {
                await ctx.reply(
                  '✅ *Successfully paired!*\n\n' +
                    'You can now chat with Clodds. Ask me anything about prediction markets!',
                  { parse_mode: 'Markdown' }
                );
                logger.info({ userId, code: potentialCode }, 'User paired via direct code');
                return;
              }
            }

            // Generate pairing code for unpaired user
            if (pairing) {
              const code = await pairing.createPairingRequest('telegram', userId, username);
              if (code) {
                await ctx.reply(
                  `🔐 *Pairing Required*\n\n` +
                    `Your pairing code: \`${code}\`\n\n` +
                    `To complete pairing, either:\n` +
                    `1. Run \`clodds pairing approve telegram ${code}\` on your computer\n` +
                    `2. Or ask the bot owner to approve your code\n\n` +
                    `Code expires in 1 hour.`,
                  { parse_mode: 'Markdown' }
                );
                logger.info({ userId, code }, 'Generated pairing code for user');
              } else {
                await ctx.reply(
                  `🔐 *Pairing Required*\n\n` +
                    `Too many pending requests. Please try again later.`,
                  { parse_mode: 'Markdown' }
                );
              }
            } else {
              await ctx.reply(
                `🔐 *Access Required*\n\n` +
                  `Please contact the bot owner to get access.`,
                { parse_mode: 'Markdown' }
              );
            }
            return;
          }
          break;

        case 'disabled':
          await ctx.reply('DMs are currently disabled.');
          return;

        case 'open':
        default:
          // Allow everyone
          break;
      }
    }

    // Extract attachments from message
    const attachments = await extractAttachments(ctx);

    const incomingMessage: IncomingMessage = {
      id: msg.message_id.toString(),
      platform: 'telegram',
      userId,
      chatId: msg.chat.id.toString(),
      chatType: isGroup ? 'group' : 'dm',
      text,
      replyToMessageId: msg.reply_to_message?.message_id?.toString(),
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: new Date(msg.date * 1000),
    };

    logger.info(
      { userId, chatType: incomingMessage.chatType },
      'Received message'
    );

    await callbacks.onMessage(incomingMessage);
  });

  // Handle callback queries (inline buttons)
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from?.id?.toString() || '';
    logger.info({ userId, data }, 'Callback query received');

    await ctx.answerCallbackQuery();

    // Handle different callback types
    if (data.startsWith('alert_delete:')) {
      const alertId = data.split(':')[1];
      const incomingMessage: IncomingMessage = {
        id: ctx.callbackQuery.id,
        platform: 'telegram',
        userId,
        chatId: ctx.chat?.id?.toString() || '',
        chatType: ctx.chat?.type === 'private' ? 'dm' : 'group',
        text: `/alert delete ${alertId}`,
        timestamp: new Date(),
      };
      await callbacks.onMessage(incomingMessage);
    } else if (data.startsWith('market:')) {
      const marketId = data.split(':')[1];
      const incomingMessage: IncomingMessage = {
        id: ctx.callbackQuery.id,
        platform: 'telegram',
        userId,
        chatId: ctx.chat?.id?.toString() || '',
        chatType: ctx.chat?.type === 'private' ? 'dm' : 'group',
        text: `/price ${marketId}`,
        timestamp: new Date(),
      };
      await callbacks.onMessage(incomingMessage);
    }
  });

  // Handle inline queries (for @botname market_search)
  bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    const userId = ctx.from?.id?.toString() || '';

    logger.debug({ userId, query }, 'Inline query received');

    if (!query || query.length < 2) {
      // Show help when empty query
      await ctx.answerInlineQuery([
        {
          type: 'article',
          id: 'help',
          title: 'Search Prediction Markets',
          description: 'Type a query to search markets (e.g., "Trump 2028", "Bitcoin 100k")',
          input_message_content: {
            message_text: '🎲 *Clodds - Prediction Markets*\n\nUse inline mode to search:\n`@botname Trump 2028`',
            parse_mode: 'Markdown',
          },
        },
      ], { cache_time: 60 });
      return;
    }

    // Create a synthetic message for inline processing
    // The gateway/agent can handle this specially
    const inlineMessage: IncomingMessage = {
      id: `inline_${ctx.inlineQuery.id}`,
      platform: 'telegram',
      userId,
      chatId: userId, // Use userId as chatId for inline
      chatType: 'dm',
      text: `/search ${query}`,
      timestamp: new Date(),
    };

    // For inline queries, we need to respond differently
    // This sends to callbacks but we'll also provide default results
    try {
      // Send to callback for potential custom handling
      callbacks.onMessage(inlineMessage).catch(() => {});

      // Provide default results (search across platforms)
      const results = [
        {
          type: 'article' as const,
          id: `polymarket_${query}`,
          title: `🔮 Search Polymarket: "${query}"`,
          description: 'Search Polymarket for this query',
          input_message_content: {
            message_text: `🔮 Searching Polymarket for: *${query}*\n\nUse \`/search ${query}\` in chat for full results.`,
            parse_mode: 'Markdown' as const,
          },
        },
        {
          type: 'article' as const,
          id: `kalshi_${query}`,
          title: `📊 Search Kalshi: "${query}"`,
          description: 'Search Kalshi for this query',
          input_message_content: {
            message_text: `📊 Searching Kalshi for: *${query}*\n\nUse \`/search ${query}\` in chat for full results.`,
            parse_mode: 'Markdown' as const,
          },
        },
        {
          type: 'article' as const,
          id: `all_${query}`,
          title: `🎲 Search All Platforms: "${query}"`,
          description: 'Search all prediction markets',
          input_message_content: {
            message_text: `🎲 Searching all platforms for: *${query}*\n\nUse \`/search ${query}\` in DM for full results.`,
            parse_mode: 'Markdown' as const,
          },
        },
      ];

      await ctx.answerInlineQuery(results, {
        cache_time: 30,
        is_personal: true,
      });
    } catch (error) {
      logger.error({ error, query }, 'Inline query error');
      await ctx.answerInlineQuery([], { cache_time: 5 });
    }
  });

  // Error handling
  bot.catch((err) => {
    logger.error({ err }, 'Telegram bot error');
  });

  return {
    platform: 'telegram',

    async start() {
      logger.info('Starting Telegram bot (polling)');
      bot.start({
        onStart: (botInfo) => {
          logger.info({ username: botInfo.username }, 'Telegram bot started');
        },
      });
    },

    async stop() {
      logger.info('Stopping Telegram bot');
      await bot.stop();
    },

    async sendMessage(message: OutgoingMessage) {
      const chatId = parseInt(message.chatId, 10);

      // Build reply markup for buttons
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options: any = {
        parse_mode: message.parseMode === 'HTML' ? 'HTML' : 'Markdown',
      };

      if (message.buttons && message.buttons.length > 0) {
        options.reply_markup = {
          inline_keyboard: message.buttons.map((row) =>
            row.map((btn) => {
              if (btn.url) {
                return { text: btn.text, url: btn.url };
              }
              return { text: btn.text, callback_data: btn.callbackData || 'noop' };
            })
          ),
        };
      }

      await bot.api.sendMessage(chatId, message.text, options);
    },
  };
}
