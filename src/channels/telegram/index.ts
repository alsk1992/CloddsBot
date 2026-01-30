/**
 * Telegram Channel - grammY integration
 * Supports DM pairing (Clawdbot-style), allowlists, and group chats
 */

import { Bot, Context, InputFile, GrammyError } from 'grammy';
import { logger } from '../../utils/logger';
import type { ChannelCallbacks, ChannelAdapter } from '../index';
import type {
  Config,
  OutgoingMessage,
  IncomingMessage,
  MessageAttachment,
  ReactionMessage,
  PollMessage,
} from '../../types';
import type { PairingService } from '../../pairing/index';
import type { CommandRegistry } from '../../commands/registry';
import { RateLimiter } from '../../security';
import { sleep } from '../../infra/retry';

export async function createTelegramChannel(
  config: NonNullable<Config['channels']['telegram']>,
  callbacks: ChannelCallbacks,
  pairing?: PairingService,
  commands?: CommandRegistry
): Promise<ChannelAdapter> {
  const bot = new Bot(config.botToken);
  const rateLimitConfig = config.rateLimit;
  const rateLimiter = rateLimitConfig ? new RateLimiter(rateLimitConfig) : null;

  // Static allowlist from config (always paired)
  const staticAllowlist = new Set<string>(config.allowFrom || []);

  function getRateLimitKey(chatId?: number): string {
    if (!rateLimiter) return 'global';
    if (rateLimitConfig?.perUser) {
      return `chat:${chatId ?? 'unknown'}`;
    }
    return 'global';
  }

  async function enforceRateLimit(chatId: number | undefined, reason: string): Promise<void> {
    if (!rateLimiter) return;
    while (true) {
      const result = rateLimiter.check(getRateLimitKey(chatId));
      if (result.allowed) return;
      const waitMs = Math.max(250, result.resetIn);
      logger.warn({ reason, waitMs }, 'Telegram rate limit hit; waiting');
      await sleep(waitMs);
    }
  }

  function getRetryAfterSeconds(error: unknown): number | null {
    if (!(error instanceof GrammyError)) return null;
    if (error.error_code !== 429) return null;
    const retryAfter = error.parameters?.retry_after;
    if (typeof retryAfter !== 'number') return null;
    return retryAfter;
  }

  async function callTelegramApi<T>(
    chatId: number | undefined,
    reason: string,
    fn: () => Promise<T>
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      await enforceRateLimit(chatId, reason);
      try {
        return await fn();
      } catch (error) {
        const retryAfter = getRetryAfterSeconds(error);
        if (retryAfter !== null && attempt < 3) {
          const waitMs = Math.max(1000, retryAfter * 1000);
          logger.warn({ reason, waitMs }, 'Telegram 429; retrying');
          await sleep(waitMs);
          attempt += 1;
          continue;
        }
        throw error;
      }
    }
  }

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
        await callTelegramApi(ctx.chat?.id, 'reply(pairing-success)', () =>
          ctx.reply(
            '✅ *Successfully paired!*\n\n' +
              'You can now chat with Clodds. Try asking about prediction markets!',
            { parse_mode: 'Markdown' }
          )
        );
        logger.info({ userId, code }, 'User paired via Telegram deep link');
        return;
      }
    }

    // Welcome message
    await callTelegramApi(ctx.chat?.id, 'reply(welcome)', () =>
      ctx.reply(
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
      )
    );
  });

  // Helper to extract attachments from message
  async function extractAttachments(ctx: Context): Promise<MessageAttachment[]> {
    const msg = ctx.message;
    if (!msg) return [];

    const attachments: MessageAttachment[] = [];
    const chatId = msg.chat?.id;

    // Photo
    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      try {
        const file = await callTelegramApi(chatId, 'getFile(photo)', () => ctx.api.getFile(largest.file_id));
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
    const document = msg.document;
    if (document) {
      try {
        const file = await callTelegramApi(chatId, 'getFile(document)', () => ctx.api.getFile(document.file_id));
        attachments.push({
          type: 'document',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          filename: document.file_name,
          mimeType: document.mime_type,
          size: document.file_size,
          caption: msg.caption,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get document file');
      }
    }

    // Voice
    const voice = msg.voice;
    if (voice) {
      try {
        const file = await callTelegramApi(chatId, 'getFile(voice)', () => ctx.api.getFile(voice.file_id));
        attachments.push({
          type: 'voice',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          mimeType: voice.mime_type,
          duration: voice.duration,
          size: voice.file_size,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get voice file');
      }
    }

    // Video
    const video = msg.video;
    if (video) {
      try {
        const file = await callTelegramApi(chatId, 'getFile(video)', () => ctx.api.getFile(video.file_id));
        attachments.push({
          type: 'video',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          width: video.width,
          height: video.height,
          duration: video.duration,
          mimeType: video.mime_type,
          size: video.file_size,
          caption: msg.caption,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get video file');
      }
    }

    // Audio
    const audio = msg.audio;
    if (audio) {
      try {
        const file = await callTelegramApi(chatId, 'getFile(audio)', () => ctx.api.getFile(audio.file_id));
        attachments.push({
          type: 'audio',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          filename: audio.file_name,
          mimeType: audio.mime_type,
          duration: audio.duration,
          size: audio.file_size,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get audio file');
      }
    }

    // Sticker
    const sticker = msg.sticker;
    if (sticker) {
      try {
        const file = await callTelegramApi(chatId, 'getFile(sticker)', () => ctx.api.getFile(sticker.file_id));
        attachments.push({
          type: 'sticker',
          url: `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`,
          width: sticker.width,
          height: sticker.height,
        });
      } catch (e) {
        logger.error({ error: e }, 'Failed to get sticker file');
      }
    }

    return attachments;
  }

  let botUserId: number | null = null;
  let botUsername: string | null = null;
  const adminStatusCache = new Map<number, { isAdmin: boolean; checkedAt: number }>();
  const adminWarningCache = new Map<number, number>();
  const ADMIN_CACHE_TTL_MS = 5 * 60 * 1000;
  const ADMIN_WARNING_TTL_MS = 60 * 60 * 1000;

  async function isBotAdmin(chatId: number): Promise<boolean> {
    if (!botUserId) return false;
    const cached = adminStatusCache.get(chatId);
    const now = Date.now();
    if (cached && now - cached.checkedAt < ADMIN_CACHE_TTL_MS) {
      return cached.isAdmin;
    }
    try {
      const member = await callTelegramApi(chatId, 'getChatMember(bot)', () =>
        bot.api.getChatMember(chatId, botUserId!)
      );
      const status = member.status;
      const isAdmin = status === 'administrator' || status === 'creator';
      adminStatusCache.set(chatId, { isAdmin, checkedAt: now });
      return isAdmin;
    } catch (error) {
      logger.warn({ error, chatId }, 'Failed to fetch bot chat member status');
      return false;
    }
  }

  async function warnIfNotAdmin(chatId: number): Promise<void> {
    const now = Date.now();
    const lastWarn = adminWarningCache.get(chatId);
    if (lastWarn && now - lastWarn < ADMIN_WARNING_TTL_MS) return;
    adminWarningCache.set(chatId, now);
    await callTelegramApi(chatId, 'reply(admin-required)', () =>
      bot.api.sendMessage(
        chatId,
        '⚠️ I need to be an admin in this group to operate properly. Please promote me to admin.',
        { parse_mode: 'Markdown' }
      )
    );
  }

  // Handle incoming messages (text and media)
  bot.on('message', async (ctx: Context) => {
    const msg = ctx.message;
    if (!msg) return;

    // Get text (may be from caption for media messages)
    const text = msg.text || msg.caption || '';

    // Skip empty messages and commands handled elsewhere
    if (!text && !msg.photo && !msg.document && !msg.voice && !msg.video && !msg.audio) return;
    if (text.startsWith('/start')) return;

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
                await callTelegramApi(ctx.chat?.id, 'reply(pairing-direct)', () =>
                  ctx.reply(
                    '✅ *Successfully paired!*\n\n' +
                      'You can now chat with Clodds. Ask me anything about prediction markets!',
                    { parse_mode: 'Markdown' }
                  )
                );
                logger.info({ userId, code: potentialCode }, 'User paired via direct code');
                return;
              }
            }

            // Generate pairing code for unpaired user
            if (pairing) {
              const code = await pairing.createPairingRequest('telegram', userId, username);
              if (code) {
                await callTelegramApi(ctx.chat?.id, 'reply(pairing-required)', () =>
                  ctx.reply(
                    `🔐 *Pairing Required*\n\n` +
                      `Your pairing code: \`${code}\`\n\n` +
                      `To complete pairing, either:\n` +
                      `1. Run \`clodds pairing approve telegram ${code}\` on your computer\n` +
                      `2. Or ask the bot owner to approve your code\n\n` +
                      `Code expires in 1 hour.`,
                    { parse_mode: 'Markdown' }
                  )
                );
                logger.info({ userId, code }, 'Generated pairing code for user');
              } else {
                await callTelegramApi(ctx.chat?.id, 'reply(pairing-throttled)', () =>
                  ctx.reply(
                    `🔐 *Pairing Required*\n\n` +
                      `Too many pending requests. Please try again later.`,
                    { parse_mode: 'Markdown' }
                  )
                );
              }
            } else {
              await callTelegramApi(ctx.chat?.id, 'reply(access-required)', () =>
                ctx.reply(
                  `🔐 *Access Required*\n\n` +
                    `Please contact the bot owner to get access.`,
                  { parse_mode: 'Markdown' }
                )
              );
            }
            return;
          }
          break;

        case 'disabled':
          await callTelegramApi(ctx.chat?.id, 'reply(dm-disabled)', () => ctx.reply('DMs are currently disabled.'));
          return;

        case 'open':
        default:
          // Allow everyone
          break;
      }
    }

    if (isGroup) {
      const chatId = msg.chat.id;
      const admin = await isBotAdmin(chatId);
      if (!admin) {
        await warnIfNotAdmin(chatId);
        return;
      }
      const requireMention = config.groups?.[msg.chat.id.toString()]?.requireMention ?? false;
      if (requireMention) {
        const replyToBot = msg.reply_to_message?.from?.id && botUserId
          ? msg.reply_to_message.from.id === botUserId
          : false;
        const entities = msg.entities || msg.caption_entities || [];
        const sourceText = msg.text || msg.caption || '';
        const mention = entities.some((entity) => {
          if (entity.type === 'mention' && botUsername && sourceText) {
            const value = sourceText.slice(entity.offset, entity.offset + entity.length);
            return value === `@${botUsername}`;
          }
          if (entity.type === 'text_mention' && botUserId) {
            return entity.user?.id === botUserId;
          }
          return false;
        });
        if (!replyToBot && !mention) {
          return;
        }
      }
    }

    // Extract attachments from message
    const attachments = await extractAttachments(ctx);

    let cleanedText = text;
    if (botUsername) {
      cleanedText = cleanedText.replace(new RegExp(`@${botUsername}`, 'g'), '').trim();
    }

    const incomingMessage: IncomingMessage = {
      id: msg.message_id.toString(),
      platform: 'telegram',
      userId,
      chatId: msg.chat.id.toString(),
      chatType: isGroup ? 'group' : 'dm',
      text: cleanedText,
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
      await callTelegramApi(ctx.from?.id, 'answerInlineQuery(help)', () =>
        ctx.answerInlineQuery(
          [
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
          ],
          { cache_time: 60 }
        )
      );
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
      callbacks.onMessage(inlineMessage).catch((err) => {
        logger.debug({ err, query }, 'Error handling inline query callback');
      });

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

      await callTelegramApi(ctx.from?.id, 'answerInlineQuery', () =>
        ctx.answerInlineQuery(results, {
          cache_time: 30,
          is_personal: true,
        })
      );
    } catch (error) {
      logger.error({ error, query }, 'Inline query error');
      await callTelegramApi(ctx.from?.id, 'answerInlineQuery(error)', () => ctx.answerInlineQuery([], { cache_time: 5 }));
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

      try {
        const me = await callTelegramApi(undefined, 'getMe', () => bot.api.getMe());
        botUserId = me.id;
        botUsername = me.username || null;
      } catch (error) {
        logger.warn({ error }, 'Failed to fetch Telegram bot info');
      }

      if (commands) {
        const telegramCommands = commands
          .list()
          .filter((c) => c.register)
          .map((c) => ({
            command: c.name.replace(/^\//, ''),
            description: c.description.slice(0, 256),
          }));

        if (telegramCommands.length > 0) {
          try {
            await callTelegramApi(undefined, 'setMyCommands', () => bot.api.setMyCommands(telegramCommands));
            logger.info({ count: telegramCommands.length }, 'Registered Telegram commands');
          } catch (error) {
            logger.warn({ error }, 'Failed to register Telegram commands');
          }
        }
      }

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

    async sendMessage(message: OutgoingMessage): Promise<string | null> {
      const chatId = parseInt(message.chatId, 10);

      // Build reply markup for buttons
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options: any = {
        parse_mode: message.parseMode === 'HTML'
          ? 'HTML'
          : message.parseMode === 'MarkdownV2'
            ? 'MarkdownV2'
            : 'Markdown',
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

      const attachments = message.attachments || [];
      if (attachments.length > 0) {
        let usedCaption = false;
        for (const attachment of attachments) {
          const caption = !usedCaption && message.text ? message.text : attachment.caption;
          const input =
            attachment.data
              ? new InputFile(Buffer.from(attachment.data, 'base64'), attachment.filename)
              : attachment.url;
          if (!input) {
            logger.warn({ attachment }, 'Telegram attachment missing data/url');
            continue;
          }

          try {
            switch (attachment.type) {
              case 'image':
                await callTelegramApi(chatId, 'sendPhoto', () =>
                  bot.api.sendPhoto(chatId, input, caption ? { caption, ...options } : options)
                );
                break;
              case 'video':
                await callTelegramApi(chatId, 'sendVideo', () =>
                  bot.api.sendVideo(chatId, input, caption ? { caption, ...options } : options)
                );
                break;
              case 'audio':
                await callTelegramApi(chatId, 'sendAudio', () =>
                  bot.api.sendAudio(chatId, input, caption ? { caption, ...options } : options)
                );
                break;
              case 'voice':
                await callTelegramApi(chatId, 'sendVoice', () =>
                  bot.api.sendVoice(chatId, input, caption ? { caption, ...options } : options)
                );
                break;
              case 'document':
                await callTelegramApi(chatId, 'sendDocument', () =>
                  bot.api.sendDocument(chatId, input, caption ? { caption, ...options } : options)
                );
                break;
              case 'sticker':
                await callTelegramApi(chatId, 'sendSticker', () => bot.api.sendSticker(chatId, input));
                break;
              default:
                await callTelegramApi(chatId, 'sendDocument', () =>
                  bot.api.sendDocument(chatId, input, caption ? { caption, ...options } : options)
                );
                break;
            }
            if (caption === message.text) usedCaption = true;
          } catch (error) {
            logger.warn({ error }, 'Failed to send Telegram attachment');
          }
        }

        if (!usedCaption && message.text) {
          await callTelegramApi(chatId, 'sendMessage', () => bot.api.sendMessage(chatId, message.text, options));
        }
        return null;
      }

      const sent = await callTelegramApi(chatId, 'sendMessage', () => bot.api.sendMessage(chatId, message.text, options));
      return sent.message_id?.toString() || null;
    },

    async editMessage(message: OutgoingMessage & { messageId: string }) {
      const chatId = parseInt(message.chatId, 10);
      const messageId = parseInt(message.messageId, 10);
      await callTelegramApi(chatId, 'editMessageText', () =>
        bot.api.editMessageText(chatId, messageId, message.text, {
          parse_mode: message.parseMode === 'HTML'
            ? 'HTML'
            : message.parseMode === 'MarkdownV2'
              ? 'MarkdownV2'
              : 'Markdown',
        })
      );
    },

    /**
     * Draft streaming - send partial message and update in place
     * @returns Object with methods to update and finalize the draft
     */
    createDraftStream(chatId: string) {
      const numericChatId = parseInt(chatId, 10);
      let messageId: number | null = null;
      let currentText = '';
      let lastUpdateTime = 0;
      const MIN_UPDATE_INTERVAL = 500; // Don't update more than twice per second
      let pendingUpdate: string | null = null;
      let updateTimeout: NodeJS.Timeout | null = null;

      const flushPendingUpdate = async () => {
        if (pendingUpdate === null || messageId === null) return;

        const textToSend = pendingUpdate;
        pendingUpdate = null;

        try {
          await callTelegramApi(numericChatId, 'editMessageText(draft)', () =>
            bot.api.editMessageText(numericChatId, messageId!, textToSend + ' ▌', {
              parse_mode: 'Markdown',
            })
          );
          lastUpdateTime = Date.now();
        } catch (err) {
          // Telegram may reject edits if content hasn't changed
          logger.debug({ error: err }, 'Draft stream edit skipped');
        }
      };

      return {
        /** Send initial draft message */
        async start(initialText: string = '⏳ Thinking...') {
          currentText = initialText;
          const sent = await callTelegramApi(numericChatId, 'sendMessage(draft-start)', () =>
            bot.api.sendMessage(numericChatId, initialText + ' ▌', { parse_mode: 'Markdown' })
          );
          messageId = sent.message_id;
          lastUpdateTime = Date.now();
          return messageId?.toString() || null;
        },

        /** Update the draft with new text */
        async update(newText: string) {
          if (messageId === null) {
            await this.start(newText);
            return;
          }

          currentText = newText;
          pendingUpdate = newText;

          const timeSinceLastUpdate = Date.now() - lastUpdateTime;
          if (timeSinceLastUpdate >= MIN_UPDATE_INTERVAL) {
            // Can update immediately
            await flushPendingUpdate();
          } else {
            // Schedule update
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = setTimeout(async () => {
              await flushPendingUpdate();
            }, MIN_UPDATE_INTERVAL - timeSinceLastUpdate);
          }
        },

        /** Append text to the current draft */
        async append(additionalText: string) {
          await this.update(currentText + additionalText);
        },

        /** Finalize the draft (remove typing indicator) */
        async finish(finalText?: string) {
          if (updateTimeout) {
            clearTimeout(updateTimeout);
            updateTimeout = null;
          }

          const textToSend = finalText || currentText;

          if (messageId === null) {
            // Never started, just send the message
            const sent = await callTelegramApi(numericChatId, 'sendMessage(draft-finish)', () =>
              bot.api.sendMessage(numericChatId, textToSend, { parse_mode: 'Markdown' })
            );
            return sent.message_id?.toString() || null;
          }

          try {
            await callTelegramApi(numericChatId, 'editMessageText(draft-finish)', () =>
              bot.api.editMessageText(numericChatId, messageId!, textToSend, {
                parse_mode: 'Markdown',
              })
            );
          } catch (err) {
            logger.warn({ error: err }, 'Failed to finalize draft message');
          }

          return messageId.toString();
        },

        /** Cancel and delete the draft */
        async cancel() {
          if (updateTimeout) {
            clearTimeout(updateTimeout);
            updateTimeout = null;
          }

          if (messageId !== null) {
            try {
              await callTelegramApi(numericChatId, 'deleteMessage(draft-cancel)', () =>
                bot.api.deleteMessage(numericChatId, messageId!)
              );
            } catch (err) {
              logger.debug({ error: err }, 'Failed to delete draft message');
            }
          }
        },

        /** Get current message ID */
        getMessageId() {
          return messageId?.toString() || null;
        },

        /** Get current text */
        getText() {
          return currentText;
        },
      };
    },

    async deleteMessage(message: OutgoingMessage & { messageId: string }) {
      const chatId = parseInt(message.chatId, 10);
      const messageId = parseInt(message.messageId, 10);
      await callTelegramApi(chatId, 'deleteMessage', () => bot.api.deleteMessage(chatId, messageId));
    },

    async reactMessage(message: ReactionMessage): Promise<void> {
      const chatId = parseInt(message.chatId, 10);
      const messageId = parseInt(message.messageId, 10);
      if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) {
        logger.warn({ chatId: message.chatId, messageId: message.messageId }, 'Invalid Telegram reaction target');
        return;
      }
      // Cast emoji to the strict Telegram type (grammyJS uses a union of valid emojis)
      const reaction = message.remove ? [] : [{ type: 'emoji' as const, emoji: message.emoji as '👍' }];
      await callTelegramApi(chatId, 'setMessageReaction', () =>
        bot.api.setMessageReaction(chatId, messageId, reaction)
      );
    },

    async sendPoll(message: PollMessage): Promise<string | null> {
      const chatId = parseInt(message.chatId, 10);
      if (!Number.isFinite(chatId)) {
        logger.warn({ chatId: message.chatId }, 'Invalid Telegram poll target');
        return null;
      }
      const sent = await callTelegramApi(chatId, 'sendPoll', () =>
        bot.api.sendPoll(chatId, message.question, message.options, {
          allows_multiple_answers: message.multiSelect,
        })
      );
      return sent.message_id?.toString() || null;
    },
  };
}
