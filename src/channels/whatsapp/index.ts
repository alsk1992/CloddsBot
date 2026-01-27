/**
 * WhatsApp Channel - Baileys integration
 * Supports DM pairing (Clawdbot-style), allowlists, and group chats
 *
 * Uses @whiskeysockets/baileys for WhatsApp Web API
 * Requires QR code scan for initial setup
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  isJidGroup,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';
import type { ChannelCallbacks, ChannelAdapter } from '../index';
import type { Config, OutgoingMessage, IncomingMessage } from '../../types';
import type { PairingService } from '../../pairing/index';

export interface WhatsAppConfig {
  enabled: boolean;
  /** Directory to store auth state */
  authDir?: string;
  /** DM policy: 'open', 'allowlist', 'pairing', 'disabled' */
  dmPolicy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
  /** Static allowlist of phone numbers (with country code, no +) */
  allowFrom?: string[];
  /** Whether to require @ mention in groups */
  requireMentionInGroups?: boolean;
}

export async function createWhatsAppChannel(
  config: WhatsAppConfig,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<ChannelAdapter> {
  const authDir = config.authDir || path.join(process.cwd(), '.whatsapp-auth');

  // Ensure auth directory exists
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // Static allowlist from config (always paired)
  const staticAllowlist = new Set<string>(config.allowFrom || []);

  let sock: WASocket | null = null;
  let isConnected = false;

  /**
   * Normalize phone number to JID format
   */
  function normalizeJid(jid: string): string {
    // Remove @ and everything after
    const baseJid = jid.split('@')[0];
    // Remove any non-numeric characters except +
    return baseJid.replace(/[^\d]/g, '');
  }

  /**
   * Check if a user is allowed to DM
   */
  function isUserAllowed(userId: string): boolean {
    const normalized = normalizeJid(userId);

    // Static allowlist always allowed
    if (staticAllowlist.has(normalized)) return true;

    // Check pairing service
    if (pairing?.isPaired('whatsapp', normalized)) return true;

    return false;
  }

  /**
   * Connect to WhatsApp
   */
  async function connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true, // Show QR code in terminal for pairing
      logger: logger as any, // Use our logger
    });

    // Handle connection updates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('Scan QR code with WhatsApp to connect');
      }

      if (connection === 'close') {
        isConnected = false;
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;

        logger.warn(
          { shouldReconnect, error: lastDisconnect?.error },
          'WhatsApp connection closed'
        );

        if (shouldReconnect) {
          // Reconnect after delay
          setTimeout(() => connect(), 5000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        logger.info('WhatsApp connected');
      }
    });

    // Save credentials on update
    sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Skip if no message content
        if (!msg.message) continue;

        // Skip status updates
        if (msg.key.remoteJid === 'status@broadcast') continue;

        // Skip messages from self
        if (msg.key.fromMe) continue;

        const jid = msg.key.remoteJid || '';
        const isGroup = isJidGroup(jid);
        const userId = isGroup
          ? msg.key.participant || ''
          : jid;

        // Extract text content
        const textContent =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';

        if (!textContent) continue;

        // DM Policy enforcement (only for DMs, not groups)
        if (!isGroup) {
          const normalizedUserId = normalizeJid(userId);

          switch (config.dmPolicy) {
            case 'allowlist':
              if (!isUserAllowed(userId)) {
                logger.info({ userId: normalizedUserId }, 'Ignoring message from non-allowlisted user');
                continue;
              }
              break;

            case 'pairing':
              if (!isUserAllowed(userId)) {
                // Check if message is a pairing code (8 uppercase alphanumeric)
                const potentialCode = textContent.trim().toUpperCase();
                if (/^[A-Z0-9]{8}$/.test(potentialCode) && pairing) {
                  const request = await pairing.validateCode(potentialCode);
                  if (request) {
                    await sock?.sendMessage(jid, {
                      text: '✅ *Successfully paired!*\n\nYou can now chat with Clodds. Ask me anything about prediction markets!',
                    });
                    logger.info({ userId: normalizedUserId, code: potentialCode }, 'User paired via direct code');
                    continue;
                  }
                }

                // Generate pairing code for unpaired user
                if (pairing) {
                  const code = await pairing.createPairingRequest('whatsapp', normalizedUserId);
                  if (code) {
                    await sock?.sendMessage(jid, {
                      text:
                        `🔐 *Pairing Required*\n\n` +
                        `Your pairing code: \`${code}\`\n\n` +
                        `To complete pairing, either:\n` +
                        `1. Run \`clodds pairing approve whatsapp ${code}\` on your computer\n` +
                        `2. Or ask the bot owner to approve your code\n\n` +
                        `Code expires in 1 hour.`,
                    });
                    logger.info({ userId: normalizedUserId, code }, 'Generated pairing code for user');
                  } else {
                    await sock?.sendMessage(jid, {
                      text:
                        `🔐 *Pairing Required*\n\n` +
                        `Too many pending requests. Please try again later.`,
                    });
                  }
                } else {
                  await sock?.sendMessage(jid, {
                    text:
                      `🔐 *Access Required*\n\n` +
                      `Please contact the bot owner to get access.`,
                  });
                }
                continue;
              }
              break;

            case 'disabled':
              await sock?.sendMessage(jid, {
                text: 'DMs are currently disabled.',
              });
              continue;

            case 'open':
            default:
              // Allow everyone
              break;
          }
        }

        // Check for mention in groups if required
        if (isGroup && config.requireMentionInGroups) {
          const mentionedJids = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
          const botJid = sock?.user?.id;
          if (botJid && !mentionedJids.includes(botJid)) {
            // Bot not mentioned, ignore
            continue;
          }
        }

        const incomingMessage: IncomingMessage = {
          id: msg.key.id || Date.now().toString(),
          platform: 'whatsapp',
          userId: normalizeJid(userId),
          chatId: normalizeJid(jid),
          chatType: isGroup ? 'group' : 'dm',
          text: textContent,
          timestamp: new Date(
            (msg.messageTimestamp as number) * 1000 || Date.now()
          ),
        };

        logger.info(
          { userId: incomingMessage.userId, chatType: incomingMessage.chatType },
          'Received WhatsApp message'
        );

        await callbacks.onMessage(incomingMessage);
      }
    });
  }

  return {
    platform: 'whatsapp',

    async start() {
      logger.info('Starting WhatsApp channel');
      await connect();
    },

    async stop() {
      logger.info('Stopping WhatsApp channel');
      if (sock) {
        sock.end(undefined);
        sock = null;
      }
      isConnected = false;
    },

    async sendMessage(message: OutgoingMessage) {
      if (!sock || !isConnected) {
        logger.warn('WhatsApp not connected, cannot send message');
        return;
      }

      // Convert chat ID to JID format
      const jid = message.chatId.includes('@')
        ? message.chatId
        : `${message.chatId}@s.whatsapp.net`;

      await sock.sendMessage(jid, {
        text: message.text,
      });
    },
  };
}
