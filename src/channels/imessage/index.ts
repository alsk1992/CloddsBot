/**
 * iMessage Channel - macOS Messages.app integration
 *
 * Features:
 * - Send/receive iMessages via AppleScript
 * - Group chat support
 * - Read receipts awareness
 *
 * Requires: macOS with Messages.app signed in
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../utils/logger';
import type { ChannelAdapter, ChannelCallbacks } from '../index';
import type { IncomingMessage, OutgoingMessage, MessageAttachment } from '../../types';
import type { PairingService } from '../../pairing/index';
import { resolveAttachment, guessAttachmentType } from '../../utils/attachments';

const execAsync = promisify(exec);

export interface iMessageConfig {
  enabled: boolean;
  /** DM policy */
  dmPolicy?: 'pairing' | 'open';
  /** Allowed phone numbers/emails */
  allowFrom?: string[];
  /** Allowed group chat IDs */
  groupAllowlist?: string[];
  /** Poll interval in ms (default: 2000) */
  pollInterval?: number;
  /** Per-group policies */
  groups?: Record<string, { requireMention?: boolean }>;
}

/** Message from Messages.app database */
interface MessageRow {
  rowid: number;
  guid: string;
  text: string;
  handle_id: string;
  is_from_me: number;
  date: number;
  chat_id: string;
  display_name: string | null;
}

export async function createiMessageChannel(
  config: iMessageConfig,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<ChannelAdapter> {
  // Check if running on macOS
  if (process.platform !== 'darwin') {
    throw new Error('iMessage channel is only available on macOS');
  }

  logger.info('Creating iMessage channel');

  const dmPolicy = config.dmPolicy || 'pairing';
  const allowFrom = new Set(config.allowFrom || []);
  const groupAllowlist = new Set(config.groupAllowlist || []);
  const pollInterval = config.pollInterval || 2000;

  let running = false;
  let pollTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastMessageId = 0;

  // Path to Messages database
  const dbPath = path.join(
    os.homedir(),
    'Library/Messages/chat.db'
  );

  /** Check if user is allowed */
  function isAllowed(sender: string, isGroup: boolean): boolean {
    if (isGroup) {
      if (groupAllowlist.size > 0) {
        return groupAllowlist.has(sender);
      }
      return true;
    }

    if (dmPolicy === 'open') {
      if (allowFrom.size === 0) return true;
      return allowFrom.has(sender) || allowFrom.has('*');
    }

    if (pairing) {
      return pairing.isPaired('imessage', sender);
    }

    return false;
  }

  /** Query Messages database for new messages */
  async function pollMessages(): Promise<void> {
    if (!running) return;

    try {
      // Query using sqlite3
      const query = `
        SELECT
          m.ROWID as rowid,
          m.guid,
          m.text,
          h.id as handle_id,
          m.is_from_me,
          m.date,
          c.chat_identifier as chat_id,
          c.display_name
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.ROWID > ${lastMessageId}
          AND m.is_from_me = 0
          AND (m.text IS NOT NULL OR EXISTS (
            SELECT 1 FROM message_attachment_join maj WHERE maj.message_id = m.ROWID
          ))
        ORDER BY m.ROWID ASC
        LIMIT 100
      `;

      const { stdout } = await execAsync(
        `sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
        { maxBuffer: 10 * 1024 * 1024 }
      );

      if (!stdout.trim()) {
        return;
      }

      const messages: MessageRow[] = JSON.parse(stdout);

      for (const msg of messages) {
        lastMessageId = Math.max(lastMessageId, msg.rowid);

        const sender = msg.handle_id;
        const isGroup = msg.chat_id.includes('chat');

        // Check if allowed
        if (!isAllowed(sender, isGroup)) {
          if (dmPolicy === 'pairing' && pairing && !isGroup) {
            const code = await pairing.createPairingRequest(
              'imessage',
              sender,
              sender
            );
            if (code) {
              await sendMessage({
                chatId: sender,
                text: `Hi! I need to verify you first.\n\nYour pairing code is: ${code}\n\nAsk an admin to approve it.`,
                platform: 'imessage',
              });
            }
          }
          continue;
        }

        const attachments = await getAttachmentsForMessage(msg.rowid);

        if (!msg.text && attachments.length === 0) {
          continue;
        }

        if (isGroup) {
          const requireMention = config.groups?.[msg.chat_id]?.requireMention ?? false;
          if (requireMention) {
            // iMessage chat.db doesn't expose mention metadata reliably.
            continue;
          }
        }

        // Create incoming message
        const message: IncomingMessage = {
          id: msg.guid,
          platform: 'imessage',
          userId: sender,
          chatId: isGroup ? msg.chat_id : sender,
          chatType: isGroup ? 'group' : 'dm',
          text: msg.text || '',
          attachments: attachments.length > 0 ? attachments : undefined,
          timestamp: new Date(msg.date / 1000000 + 978307200000), // Apple epoch
        };

        await callbacks.onMessage(message);
      }
    } catch (error) {
      // Database might be locked
      if (!(error instanceof Error && error.message.includes('database is locked'))) {
        logger.error({ error }, 'iMessage poll error');
      }
    }

    // Schedule next poll
    if (running) {
      pollTimeout = setTimeout(pollMessages, pollInterval);
    }
  }

  /** Get initial last message ID */
  async function getLastMessageId(): Promise<number> {
    try {
      const { stdout } = await execAsync(
        `sqlite3 "${dbPath}" "SELECT MAX(ROWID) FROM message"`
      );
      return parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  /** Send message via AppleScript */
  async function sendMessage(message: OutgoingMessage): Promise<string | null> {
    const chatId = message.chatId;

    // Determine if phone number or email
    const isPhone = /^\+?[0-9\s-]+$/.test(chatId);
    const service = isPhone ? 'SMS' : 'iMessage';

    const sendText = async (): Promise<void> => {
      if (!message.text) return;
      const escapedText = message.text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');

      const script = `
        tell application "Messages"
          set targetService to 1st account whose service type = ${service}
          set targetBuddy to participant "${chatId}" of targetService
          send "${escapedText}" to targetBuddy
        end tell
      `;

      await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
      logger.debug({ chatId }, 'iMessage text sent');
    };

    const sendFile = async (filePath: string): Promise<void> => {
      const script = `
        tell application "Messages"
          set targetService to 1st account whose service type = ${service}
          set targetBuddy to participant "${chatId}" of targetService
          send (POSIX file "${filePath}") to targetBuddy
        end tell
      `;
      await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
    };

    try {
      const attachments = message.attachments || [];
      if (message.text) {
        await sendText();
      }

      for (const attachment of attachments) {
        if (attachment.url && attachment.url.startsWith('/')) {
          await sendFile(attachment.url);
          continue;
        }

        const resolved = await resolveAttachment(attachment);
        if (!resolved) continue;

        const tempPath = path.join(
          os.tmpdir(),
          `clodds-imessage-${Date.now()}-${resolved.filename}`
        );
        await fsPromises.writeFile(tempPath, resolved.buffer);
        await sendFile(tempPath);
        await fsPromises.unlink(tempPath).catch((err) => {
          logger.debug({ err, tempPath }, 'Failed to cleanup temp iMessage file');
        });
      }
    } catch (error) {
      // Try alternative method for group chats
      if (chatId.includes('chat')) {
        const attachments = message.attachments || [];
        if (message.text) {
          const escapedText = message.text
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
          const groupScript = `
            tell application "Messages"
              set targetChat to chat id "${chatId}"
              send "${escapedText}" to targetChat
            end tell
          `;
          await execAsync(`osascript -e '${groupScript.replace(/'/g, "'\"'\"'")}'`);
        }

        for (const attachment of attachments) {
          const resolved = await resolveAttachment(attachment);
          if (!resolved) continue;
          const tempPath = path.join(
            os.tmpdir(),
            `clodds-imessage-${Date.now()}-${resolved.filename}`
          );
          await fsPromises.writeFile(tempPath, resolved.buffer);
          const groupFileScript = `
            tell application "Messages"
              set targetChat to chat id "${chatId}"
              send (POSIX file "${tempPath}") to targetChat
            end tell
          `;
          await execAsync(`osascript -e '${groupFileScript.replace(/'/g, "'\"'\"'")}'`);
          await fsPromises.unlink(tempPath).catch((err) => {
          logger.debug({ err, tempPath }, 'Failed to cleanup temp iMessage file');
        });
        }
        logger.debug({ chatId }, 'iMessage sent to group');
      } else {
        throw error;
      }
    }
    return null;
  }

  async function getAttachmentsForMessage(messageId: number): Promise<MessageAttachment[]> {
    try {
      const query = `
        SELECT
          a.filename as filename,
          a.mime_type as mime_type,
          a.total_bytes as total_bytes
        FROM message_attachment_join maj
        JOIN attachment a ON a.ROWID = maj.attachment_id
        WHERE maj.message_id = ${messageId}
      `;
      const { stdout } = await execAsync(
        `sqlite3 -json "${dbPath}" "${query.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
      if (!stdout.trim()) return [];
      const rows = JSON.parse(stdout) as Array<{ filename?: string; mime_type?: string; total_bytes?: number }>;

      return rows.map((row) => ({
        type: guessAttachmentType(row.mime_type, row.filename),
        url: row.filename,
        filename: row.filename ? path.basename(row.filename) : undefined,
        mimeType: row.mime_type,
        size: row.total_bytes,
      }));
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch iMessage attachments');
      return [];
    }
  }

  return {
    platform: 'imessage',

    async start(): Promise<void> {
      // Check database access
      if (!fs.existsSync(dbPath)) {
        throw new Error('Messages database not found. Is Messages.app set up?');
      }

      running = true;
      lastMessageId = await getLastMessageId();

      // Start polling
      pollMessages();

      logger.info('iMessage channel started');
    },

    async stop(): Promise<void> {
      running = false;
      if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
      }
      logger.info('iMessage channel stopped');
    },

    async sendMessage(message: OutgoingMessage): Promise<string | null> {
      return sendMessage(message);
    },

    async editMessage(message: OutgoingMessage & { messageId: string }): Promise<void> {
      logger.warn(
        { chatId: message.chatId, messageId: message.messageId },
        'iMessage does not support message editing via AppleScript'
      );
    },

    async deleteMessage(message: OutgoingMessage & { messageId: string }): Promise<void> {
      logger.warn(
        { chatId: message.chatId, messageId: message.messageId },
        'iMessage does not support message deletion via AppleScript'
      );
    },
  };
}
