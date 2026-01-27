/**
 * Slack Channel - Bolt integration
 * Supports DM pairing (Clawdbot-style), allowlists, and channel messages
 *
 * Uses @slack/bolt for Slack API with Socket Mode
 * Requires: Bot Token (xoxb-) and App Token (xapp-)
 */

import { App, LogLevel } from '@slack/bolt';
import { logger } from '../../utils/logger';
import type { ChannelCallbacks, ChannelAdapter } from '../index';
import type { Config, OutgoingMessage, IncomingMessage } from '../../types';
import type { PairingService } from '../../pairing/index';

export interface SlackConfig {
  enabled: boolean;
  /** Bot token (xoxb-...) */
  botToken: string;
  /** App token for Socket Mode (xapp-...) */
  appToken: string;
  /** DM policy: 'open', 'allowlist', 'pairing', 'disabled' */
  dmPolicy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
  /** Static allowlist of Slack user IDs */
  allowFrom?: string[];
}

export async function createSlackChannel(
  config: SlackConfig,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<ChannelAdapter> {
  // Static allowlist from config (always paired)
  const staticAllowlist = new Set<string>(config.allowFrom || []);

  /**
   * Check if a user is allowed to DM
   */
  function isUserAllowed(userId: string): boolean {
    // Static allowlist always allowed
    if (staticAllowlist.has(userId)) return true;

    // Check pairing service
    if (pairing?.isPaired('slack', userId)) return true;

    return false;
  }

  // Initialize Bolt app with Socket Mode
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  // Handle all messages
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.message(async ({ message, say, client }: any) => {
    // Type guard for standard messages
    if (!('text' in message) || !message.text) return;
    if (!('user' in message) || !message.user) return;

    const userId = message.user;
    const text = message.text;
    const channelId = message.channel;
    const messageTs = message.ts;

    // Determine if this is a DM
    // Slack channel types: C = public channel, D = DM, G = private channel/group DM
    const isDM = channelId.startsWith('D');

    // DM Policy enforcement (only for DMs)
    if (isDM) {
      switch (config.dmPolicy) {
        case 'allowlist':
          if (!isUserAllowed(userId)) {
            logger.info({ userId }, 'Ignoring Slack message from non-allowlisted user');
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
                await say({
                  text: ':white_check_mark: *Successfully paired!*\n\nYou can now chat with Clodds. Ask me anything about prediction markets!',
                  mrkdwn: true,
                });
                logger.info({ userId, code: potentialCode }, 'Slack user paired via direct code');
                return;
              }
            }

            // Generate pairing code for unpaired user
            if (pairing) {
              const code = await pairing.createPairingRequest('slack', userId);
              if (code) {
                await say({
                  text:
                    `:lock: *Pairing Required*\n\n` +
                    `Your pairing code: \`${code}\`\n\n` +
                    `To complete pairing, either:\n` +
                    `1. Run \`clodds pairing approve slack ${code}\` on your computer\n` +
                    `2. Or ask the bot owner to approve your code\n\n` +
                    `Code expires in 1 hour.`,
                  mrkdwn: true,
                });
                logger.info({ userId, code }, 'Generated Slack pairing code for user');
              } else {
                await say({
                  text:
                    `:lock: *Pairing Required*\n\n` +
                    `Too many pending requests. Please try again later.`,
                  mrkdwn: true,
                });
              }
            } else {
              await say({
                text:
                  `:lock: *Access Required*\n\n` +
                  `Please contact the bot owner to get access.`,
                mrkdwn: true,
              });
            }
            return;
          }
          break;

        case 'disabled':
          await say({ text: 'DMs are currently disabled.' });
          return;

        case 'open':
        default:
          // Allow everyone
          break;
      }
    }

    const incomingMessage: IncomingMessage = {
      id: messageTs,
      platform: 'slack',
      userId,
      chatId: channelId,
      chatType: isDM ? 'dm' : 'group',
      text,
      timestamp: new Date(parseFloat(messageTs) * 1000),
    };

    logger.info(
      { userId, chatType: incomingMessage.chatType, channel: channelId },
      'Received Slack message'
    );

    await callbacks.onMessage(incomingMessage);
  });

  // Handle app_mention events (for channel messages where bot is @mentioned)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.event('app_mention', async ({ event, say }: any) => {
    const userId = event.user;
    const text = event.text;
    const channelId = event.channel;
    const messageTs = event.ts;

    // Remove the @mention from the text
    const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();

    const incomingMessage: IncomingMessage = {
      id: messageTs,
      platform: 'slack',
      userId,
      chatId: channelId,
      chatType: 'group',
      text: cleanText || text,
      timestamp: new Date(parseFloat(messageTs) * 1000),
    };

    logger.info(
      { userId, channel: channelId },
      'Received Slack mention'
    );

    await callbacks.onMessage(incomingMessage);
  });

  // Handle slash commands (optional)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.command('/clodds', async ({ command, ack, respond }: any) => {
    await ack();

    const incomingMessage: IncomingMessage = {
      id: command.trigger_id,
      platform: 'slack',
      userId: command.user_id,
      chatId: command.channel_id,
      chatType: command.channel_name === 'directmessage' ? 'dm' : 'group',
      text: command.text || '/help',
      timestamp: new Date(),
    };

    logger.info(
      { userId: command.user_id, text: command.text },
      'Received Slack slash command'
    );

    await callbacks.onMessage(incomingMessage);
  });

  // Error handling
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.error(async (error: any) => {
    logger.error({ error }, 'Slack app error');
  });

  return {
    platform: 'slack',

    async start() {
      logger.info('Starting Slack bot (Socket Mode)');
      await app.start();
      logger.info('Slack bot started');
    },

    async stop() {
      logger.info('Stopping Slack bot');
      await app.stop();
    },

    async sendMessage(message: OutgoingMessage) {
      try {
        await app.client.chat.postMessage({
          channel: message.chatId,
          text: message.text,
          mrkdwn: true,
        });
      } catch (error) {
        logger.error({ error, channel: message.chatId }, 'Failed to send Slack message');
      }
    },
  };
}
