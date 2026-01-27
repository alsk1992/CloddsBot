/**
 * Discord Channel Adapter
 * Connects Clodds to Discord via discord.js
 * Supports DM pairing (Clawdbot-style), allowlists, and guild channels
 */

import { Client, Events, GatewayIntentBits, Message, TextChannel, DMChannel } from 'discord.js';
import { Config, IncomingMessage, OutgoingMessage } from '../../types';
import { logger } from '../../utils/logger';
import type { PairingService } from '../../pairing/index';

export interface DiscordChannel {
  platform: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(msg: OutgoingMessage): Promise<void>;
}

export interface ChannelCallbacks {
  onMessage: (message: IncomingMessage) => Promise<void>;
}

export async function createDiscordChannel(
  config: NonNullable<Config['channels']['discord']>,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<DiscordChannel> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Static allowlist from config
  const staticAllowlist = new Set<string>(config.allowFrom || []);

  // Track bot user ID to avoid responding to self
  let botUserId: string | null = null;

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
      // Guild message - check if bot is mentioned or it's a reply to bot
      const isMentioned = message.mentions.has(client.user!);
      const isReplyToBot = message.reference?.messageId &&
        (await message.channel.messages.fetch(message.reference.messageId))?.author.id === botUserId;

      // Only respond when mentioned or replying to bot in guilds
      if (!isMentioned && !isReplyToBot) {
        return;
      }
    }

    // Remove mention from message text
    let text = message.content;
    if (client.user) {
      text = text.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    }

    if (!text) {
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
      await client.login(config.token);
      logger.info('Discord: Connected');
    },

    async stop(): Promise<void> {
      await client.destroy();
      logger.info('Discord: Disconnected');
    },

    async sendMessage(msg: OutgoingMessage): Promise<void> {
      try {
        const channel = await client.channels.fetch(msg.chatId);
        if (!channel) {
          logger.error(`Discord: Channel ${msg.chatId} not found`);
          return;
        }

        if (channel instanceof TextChannel || channel instanceof DMChannel) {
          await channel.send(msg.text);
        } else {
          logger.error(`Discord: Channel ${msg.chatId} is not a text channel`);
        }
      } catch (error) {
        logger.error('Discord: Error sending message', error);
      }
    },
  };
}
