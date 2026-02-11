/**
 * Discord Channel Adapter
 * Connects Clodds to Discord via discord.js
 * Supports DM pairing (Clawdbot-style), allowlists, and guild channels
 */

import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  TextChannel,
  DMChannel,
  REST,
  Routes,
  ApplicationCommandOptionType,
  Interaction,
  EmbedBuilder,
} from 'discord.js';
import { Config, IncomingMessage, OutgoingMessage, MessageAttachment, ReactionMessage } from '../../types';
import { logger } from '../../utils/logger';
import type { PairingService } from '../../pairing/index';
import { guessAttachmentType, resolveAttachment } from '../../utils/attachments';
import type { CommandRegistry } from '../../commands/registry';
import { RateLimiter } from '../../security';
import { sleep } from '../../infra/retry';

export interface DiscordChannel {
  platform: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(msg: OutgoingMessage): Promise<string | null>;
  editMessage?: (msg: OutgoingMessage & { messageId: string }) => Promise<void>;
  deleteMessage?: (msg: OutgoingMessage & { messageId: string }) => Promise<void>;
  reactMessage?: (msg: ReactionMessage) => Promise<void>;
}

export interface ChannelCallbacks {
  onMessage: (message: IncomingMessage) => Promise<void>;
}

export async function createDiscordChannel(
  config: NonNullable<Config['channels']['discord']>,
  callbacks: ChannelCallbacks,
  pairing?: PairingService,
  commands?: CommandRegistry
): Promise<DiscordChannel> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const rateLimitConfig = config.rateLimit;
  const rateLimiter = rateLimitConfig ? new RateLimiter(rateLimitConfig) : null;

  async function enforceRateLimit(key: string, reason: string): Promise<void> {
    if (!rateLimiter) return;
    const MAX_RATE_LIMIT_WAITS = 20;
    for (let attempt = 0; attempt < MAX_RATE_LIMIT_WAITS; attempt++) {
      const result = rateLimiter.check(key);
      if (result.allowed) return;
      const waitMs = Math.max(250, result.resetIn);
      logger.warn({ reason, waitMs, attempt: attempt + 1, maxAttempts: MAX_RATE_LIMIT_WAITS }, 'Discord rate limit hit; waiting');
      await sleep(waitMs);
    }
    throw new Error(`Discord rate limit exceeded after ${MAX_RATE_LIMIT_WAITS} attempts for ${reason}`);
  }

  async function callDiscordApi<T>(key: string, reason: string, fn: () => Promise<T>): Promise<T> {
    await enforceRateLimit(key, reason);
    return await fn();
  }

  // Static allowlist from config
  const staticAllowlist = new Set<string>(config.allowFrom || []);

  // Track bot user ID to avoid responding to self
  let botUserId: string | null = null;

  function buildEmbedsFromText(text: string): EmbedBuilder[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const maxLength = 4096;
    const maxEmbeds = 10;
    const chunks: string[] = [];
    let remaining = trimmed;
    while (remaining.length > 0 && chunks.length < maxEmbeds) {
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }

    if (remaining.length > 0 && chunks.length > 0) {
      const last = chunks[chunks.length - 1];
      const suffix = '\n\n… (truncated)';
      const shortened = last.slice(0, Math.max(0, maxLength - suffix.length)) + suffix;
      chunks[chunks.length - 1] = shortened;
    }

    return chunks.map((chunk, index) =>
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setDescription(chunk)
        .setFooter(index === 0 ? { text: 'Clodds' } : null)
    );
  }

  /**
   * Check if a user is allowed to DM
   */
  function isUserAllowed(userId: string): boolean {
    if (staticAllowlist.has(userId)) return true;
    if (pairing?.isPaired('discord', userId)) return true;
    return false;
  }

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Discord: Logged in as ${readyClient.user.tag}`);
    botUserId = readyClient.user.id;
  });

  async function registerSlashCommands(): Promise<void> {
    if (!commands) return;
    if (!config.appId) {
      logger.warn('Discord: appId not configured; skipping slash command registration');
      return;
    }
    const rest = new REST({ version: '10' }).setToken(config.token);
    const payload = commands
      .list()
      .filter((cmd) => cmd.register)
      .map((cmd) => ({
        name: cmd.name.replace(/^\//, ''),
        description: cmd.description.slice(0, 100),
        options: [
          {
            name: 'args',
            description: 'Command arguments',
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      }));
    try {
      await rest.put(Routes.applicationCommands(config.appId), { body: payload });
      logger.info({ count: payload.length }, 'Discord: Registered slash commands');
    } catch (error) {
      logger.warn({ error }, 'Discord: Failed to register slash commands');
    }
  }

  client.on(Events.ClientReady, async () => {
    await registerSlashCommands();
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const username = interaction.user.username;
    const channelId = interaction.channelId;
    const isDM = interaction.channel?.isDMBased() ?? false;

    // DM Policy enforcement (only for DMs)
    if (isDM) {
      const dmPolicy = config.dmPolicy || 'pairing';
      if (dmPolicy === 'disabled') {
        await interaction.reply({ content: 'DMs are currently disabled.', ephemeral: true });
        return;
      }
      if (dmPolicy === 'allowlist' && !isUserAllowed(userId)) {
        await interaction.reply({ content: 'Access restricted. Contact the admin.', ephemeral: true });
        return;
      }
      if (dmPolicy === 'pairing' && !isUserAllowed(userId)) {
        const code = pairing ? await pairing.createPairingRequest('discord', userId, username) : null;
        if (code) {
          await interaction.reply({
            content:
              `🔐 **Pairing Required**\n\n` +
              `Your pairing code: \`${code}\`\n\n` +
              `To complete pairing, either:\n` +
              `1. Run \`clodds pairing approve discord ${code}\` on your computer\n` +
              `2. Or ask the bot owner to approve your code\n\n` +
              `Code expires in 1 hour.`,
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content:
              `🔐 **Access Required**\n\n` +
              `Please contact the bot owner to get access.`,
            ephemeral: true,
          });
        }
        return;
      }
    }

    const args = interaction.options.getString('args') || '';
    const text = `/${interaction.commandName}${args ? ` ${args}` : ''}`.trim();

    const incomingMessage: IncomingMessage = {
      id: interaction.id,
      platform: 'discord',
      userId,
      chatId: channelId,
      chatType: isDM ? 'dm' : 'group',
      text,
      timestamp: new Date(),
    };

    await callDiscordApi(`interaction:${userId}`, 'interaction.reply', () =>
      interaction.reply({ content: '✅ Command received. Processing…', ephemeral: true })
    );
    try {
      await callbacks.onMessage(incomingMessage);
    } catch (error) {
      logger.error('Discord: Error handling slash command', error);
    }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore bot messages
    if (message.author.bot || message.author.id === botUserId) {
      return;
    }

    const isDM = !message.guild;
    const userId = message.author.id;
    const username = message.author.username;

    // DM Policy enforcement (only for DMs)
    if (isDM) {
      const dmPolicy = config.dmPolicy || 'pairing';

      switch (dmPolicy) {
        case 'allowlist':
          if (!isUserAllowed(userId)) {
            logger.info({ userId }, 'Discord: Ignoring DM from non-allowlisted user');
            return;
          }
          break;

        case 'pairing':
          if (!isUserAllowed(userId)) {
            // Check if message is a pairing code (8 uppercase alphanumeric)
            const potentialCode = message.content.trim().toUpperCase();
            if (/^[A-Z0-9]{8}$/.test(potentialCode) && pairing) {
              const request = await pairing.validateCode(potentialCode);
              if (request) {
                await message.reply(
                  '✅ **Successfully paired!**\n\n' +
                    'You can now chat with Clodds. Ask me anything about prediction markets!'
                );
                logger.info({ userId, code: potentialCode }, 'Discord: User paired via direct code');
                return;
              }
            }

            // Generate pairing code for unpaired user
            if (pairing) {
              const code = await pairing.createPairingRequest('discord', userId, username);
              if (code) {
                await message.reply(
                  `🔐 **Pairing Required**\n\n` +
                    `Your pairing code: \`${code}\`\n\n` +
                    `To complete pairing, either:\n` +
                    `1. Run \`clodds pairing approve discord ${code}\` on your computer\n` +
                    `2. Or ask the bot owner to approve your code\n\n` +
                    `Code expires in 1 hour.`
                );
                logger.info({ userId, code }, 'Discord: Generated pairing code for user');
              } else {
                await message.reply(
                  `🔐 **Pairing Required**\n\n` +
                    `Too many pending requests. Please try again later.`
                );
              }
            } else {
              await message.reply(
                `🔐 **Access Required**\n\n` +
                  `Please contact the bot owner to get access.`
              );
            }
            return;
          }
          break;

        case 'disabled':
          await message.reply('DMs are currently disabled.');
          return;

        case 'open':
        default:
          // Allow everyone
          break;
      }
    } else {
      const requireMention =
        config.groups?.[message.channel.id]?.requireMention ?? true;
      if (requireMention) {
        const isMentioned = message.mentions.has(client.user!);
        const isReplyToBot = message.reference?.messageId &&
          (await message.channel.messages.fetch(message.reference.messageId))?.author.id === botUserId;

        // Only respond when mentioned or replying to bot in guilds
        if (!isMentioned && !isReplyToBot) {
          return;
        }
      }
    }

    // Remove mention from message text
    let text = message.content;
    if (client.user) {
      text = text.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    }

    const attachments: MessageAttachment[] = [];
    for (const attachment of message.attachments.values()) {
      attachments.push({
        type: guessAttachmentType(attachment.contentType || undefined, attachment.name || undefined),
        url: attachment.url,
        filename: attachment.name || undefined,
        mimeType: attachment.contentType || undefined,
        size: attachment.size || undefined,
        width: (attachment as any).width || undefined,
        height: (attachment as any).height || undefined,
      });
    }
    if ((message as any).stickers) {
      for (const sticker of (message as any).stickers.values?.() || []) {
        const url = typeof sticker.url === 'function' ? sticker.url() : sticker.url;
        attachments.push({
          type: 'sticker',
          url,
          filename: sticker.name,
        });
      }
    }

    if (!text && attachments.length === 0) {
      return;
    }

    const incomingMessage: IncomingMessage = {
      id: message.id,
      platform: 'discord',
      userId,
      chatId: message.channel.id,
      chatType: isDM ? 'dm' : 'group',
      text,
      replyToMessageId: message.reference?.messageId,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: message.createdAt,
    };

    try {
      await callbacks.onMessage(incomingMessage);
    } catch (error) {
      logger.error('Discord: Error handling message', error);
    }
  });

  return {
    platform: 'discord',

    async start(): Promise<void> {
      await callDiscordApi('discord:login', 'login', () => client.login(config.token));
      logger.info('Discord: Connected');
    },

    async stop(): Promise<void> {
      await client.destroy();
      logger.info('Discord: Disconnected');
    },

    async sendMessage(msg: OutgoingMessage): Promise<string | null> {
      try {
        const channel = await callDiscordApi(`channel:${msg.chatId}`, 'channels.fetch', () =>
          client.channels.fetch(msg.chatId)
        );
        if (!channel) {
          logger.error(`Discord: Channel ${msg.chatId} not found`);
          return null;
        }

        if (channel instanceof TextChannel || channel instanceof DMChannel) {
          const files: Array<{ attachment: Buffer | string; name?: string }> = [];
          if (msg.attachments && msg.attachments.length > 0) {
            for (const attachment of msg.attachments) {
              try {
                const resolved = await resolveAttachment(attachment);
                if (resolved) {
                  files.push({ attachment: resolved.buffer, name: resolved.filename });
                } else if (attachment.url) {
                  files.push({ attachment: attachment.url });
                }
              } catch (error) {
                logger.warn({ error, attachment }, 'Discord: Failed to resolve attachment');
              }
            }
          }

          const embeds = msg.text ? buildEmbedsFromText(msg.text) : [];
          const payload: {
            content?: string;
            files?: Array<{ attachment: Buffer | string; name?: string }>;
            embeds?: EmbedBuilder[];
          } = {};

          if (embeds.length > 0) {
            payload.embeds = embeds;
          } else if (msg.text) {
            payload.content = msg.text;
          }

          if (files.length > 0) {
            payload.files = files;
          }
          const sent = await callDiscordApi<Message>(
            `channel:${msg.chatId}`,
            'channel.send',
            () => channel.send(payload) as Promise<Message>
          );
          return sent.id;
        } else {
          logger.error(`Discord: Channel ${msg.chatId} is not a text channel`);
          return null;
        }
      } catch (error) {
        logger.error('Discord: Error sending message', error);
        return null;
      }
    },

    async editMessage(msg: OutgoingMessage & { messageId: string }): Promise<void> {
      try {
        const channel = await callDiscordApi(`channel:${msg.chatId}`, 'channels.fetch', () =>
          client.channels.fetch(msg.chatId)
        );
        if (!channel || !(channel instanceof TextChannel || channel instanceof DMChannel)) {
          logger.error(`Discord: Channel ${msg.chatId} not found`);
          return;
        }
        const message = await callDiscordApi<Message>(
          `channel:${msg.chatId}`,
          'messages.fetch',
          () => channel.messages.fetch(msg.messageId) as Promise<Message>
        );
        const embeds = msg.text ? buildEmbedsFromText(msg.text) : [];
        if (embeds.length > 0) {
          await callDiscordApi(`channel:${msg.chatId}`, 'message.edit', () =>
            message.edit({ content: null, embeds })
          );
        } else {
          await callDiscordApi(`channel:${msg.chatId}`, 'message.edit', () =>
            message.edit(msg.text)
          );
        }
      } catch (error) {
        logger.error('Discord: Error editing message', error);
      }
    },

    async deleteMessage(msg: OutgoingMessage & { messageId: string }): Promise<void> {
      try {
        const channel = await callDiscordApi(`channel:${msg.chatId}`, 'channels.fetch', () =>
          client.channels.fetch(msg.chatId)
        );
        if (!channel || !(channel instanceof TextChannel || channel instanceof DMChannel)) {
          logger.error(`Discord: Channel ${msg.chatId} not found`);
          return;
        }
        const message = await callDiscordApi<Message>(
          `channel:${msg.chatId}`,
          'messages.fetch',
          () => channel.messages.fetch(msg.messageId) as Promise<Message>
        );
        await callDiscordApi(`channel:${msg.chatId}`, 'message.delete', () => message.delete());
      } catch (error) {
        logger.error('Discord: Error deleting message', error);
      }
    },

    async reactMessage(msg: ReactionMessage): Promise<void> {
      try {
        const channel = await callDiscordApi(`channel:${msg.chatId}`, 'channels.fetch', () =>
          client.channels.fetch(msg.chatId)
        );
        if (!channel || !(channel instanceof TextChannel || channel instanceof DMChannel)) {
          logger.error(`Discord: Channel ${msg.chatId} not found`);
          return;
        }
        const message = await callDiscordApi<Message>(
          `channel:${msg.chatId}`,
          'messages.fetch',
          () => channel.messages.fetch(msg.messageId) as Promise<Message>
        );
        if (msg.remove) {
          await callDiscordApi(`channel:${msg.chatId}`, 'message.reaction.remove', async () => {
            const reaction = message.reactions.cache.get(msg.emoji);
            if (reaction) {
              await reaction.remove();
            }
          });
        } else {
          await callDiscordApi(`channel:${msg.chatId}`, 'message.react', () => message.react(msg.emoji));
        }
      } catch (error) {
        logger.error('Discord: Error reacting to message', error);
      }
    },
  };
}
