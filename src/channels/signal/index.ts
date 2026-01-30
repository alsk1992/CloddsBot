/**
 * Signal Channel - signal-cli integration
 *
 * Features:
 * - Signal messaging via signal-cli
 * - Group support
 * - Attachments
 * - Reactions
 *
 * Requires: signal-cli installed and linked to a phone number
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../../utils/logger';
import type { ChannelAdapter, ChannelCallbacks } from '../index';
import type { IncomingMessage, OutgoingMessage, MessageAttachment } from '../../types';
import type { PairingService } from '../../pairing/index';
import { resolveAttachment, guessAttachmentType } from '../../utils/attachments';

export interface SignalConfig {
  enabled: boolean;
  /** Phone number linked to signal-cli */
  phoneNumber: string;
  /** Path to signal-cli executable */
  signalCliPath?: string;
  /** Config directory for signal-cli */
  configDir?: string;
  /** DM policy */
  dmPolicy?: 'pairing' | 'open';
  /** Allowed phone numbers */
  allowFrom?: string[];
  /** Allowed group IDs */
  groupAllowlist?: string[];
  /** Per-group policies */
  groups?: Record<string, { requireMention?: boolean }>;
}

/** Signal-cli JSON RPC message */
interface SignalMessage {
  envelope?: {
    source?: string;
    sourceNumber?: string;
    sourceName?: string;
    timestamp?: number;
    dataMessage?: {
      message?: string;
      groupInfo?: {
        groupId: string;
        type: string;
      };
      attachments?: Array<{
        contentType: string;
        filename: string;
        id: string;
      }>;
      reaction?: {
        emoji: string;
        targetAuthor: string;
        targetTimestamp: number;
      };
    };
    syncMessage?: {
      sentMessage?: {
        destination?: string;
        message?: string;
      };
    };
  };
}

export async function createSignalChannel(
  config: SignalConfig,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<ChannelAdapter> {
  logger.info({ phoneNumber: config.phoneNumber }, 'Creating Signal channel');

  const signalCli = config.signalCliPath || 'signal-cli';
  const dmPolicy = config.dmPolicy || 'pairing';
  const allowFrom = new Set(config.allowFrom || []);
  const groupAllowlist = new Set(config.groupAllowlist || []);

  let cliProcess: ChildProcess | null = null;
  let running = false;

  /** Check if sender is allowed */
  function isAllowed(sender: string, groupId?: string): boolean {
    // Group messages
    if (groupId) {
      if (groupAllowlist.size > 0) {
        return groupAllowlist.has(groupId);
      }
      return true;
    }

    // DM policy
    if (dmPolicy === 'open') {
      if (allowFrom.size === 0) return true;
      return allowFrom.has(sender) || allowFrom.has('*');
    }

    // Pairing mode
    if (pairing) {
      return pairing.isPaired('signal', sender);
    }

    return false;
  }

  /** Handle incoming message */
  async function downloadSignalAttachment(
    attachmentId: string,
    filename?: string
  ): Promise<MessageAttachment | null> {
    const tempName = filename || `signal-${attachmentId}`;
    const tempPath = path.join(os.tmpdir(), tempName);
    const args = ['-u', config.phoneNumber, 'attachment', '-i', attachmentId, '-o', tempPath];

    if (config.configDir) {
      args.unshift('--config', config.configDir);
    }

    return new Promise((resolve) => {
      const proc = spawn(signalCli, args);
      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      proc.on('close', async (code) => {
        if (code !== 0) {
          logger.warn({ attachmentId, stderr }, 'signal-cli attachment fetch failed');
          resolve(null);
          return;
        }
        try {
          const buffer = await fs.readFile(tempPath);
          await fs.unlink(tempPath).catch((err) => {
            logger.debug({ err, tempPath }, 'Failed to cleanup temp attachment file');
          });
          resolve({
            type: guessAttachmentType(undefined, filename),
            data: buffer.toString('base64'),
            filename,
          });
        } catch (error) {
          logger.warn({ error, attachmentId }, 'Failed to read Signal attachment');
          resolve(null);
        }
      });
      proc.on('error', () => resolve(null));
    });
  }

  async function handleMessage(msg: SignalMessage): Promise<void> {
    if (!msg.envelope?.dataMessage) return;

    const sender = msg.envelope.sourceNumber || msg.envelope.source;
    if (!sender) return;

    // Ignore our own messages (from sync)
    if (sender === config.phoneNumber) return;

    const groupId = msg.envelope.dataMessage.groupInfo?.groupId;
    const text = msg.envelope.dataMessage.message || '';
    const attachments: MessageAttachment[] = [];

    if (msg.envelope.dataMessage.attachments && msg.envelope.dataMessage.attachments.length > 0) {
      for (const attachment of msg.envelope.dataMessage.attachments) {
        if (attachment.id) {
          const downloaded = await downloadSignalAttachment(attachment.id, attachment.filename);
          if (downloaded) {
            attachments.push({
              ...downloaded,
              mimeType: attachment.contentType,
            });
            continue;
          }
        }
        attachments.push({
          type: guessAttachmentType(attachment.contentType, attachment.filename),
          mimeType: attachment.contentType,
          filename: attachment.filename,
          url: attachment.id ? `signal-attachment:${attachment.id}` : undefined,
        });
      }
    }

    // Check if allowed
    if (!isAllowed(sender, groupId)) {
      if (dmPolicy === 'pairing' && pairing && !groupId) {
        const code = await pairing.createPairingRequest(
          'signal',
          sender,
          msg.envelope.sourceName || sender
        );
        if (code) {
          await sendMessage({
            chatId: sender,
            text: `Hi! I need to verify you first.\n\nYour pairing code is: *${code}*\n\nAsk an admin to approve it.`,
            platform: 'signal',
          });
        }
      }
      return;
    }

    if (groupId) {
      const requireMention = config.groups?.[groupId]?.requireMention ?? false;
      if (requireMention) {
        // Signal JSON RPC doesn't include mentions. Skip when required.
        return;
      }
    }

    // Create incoming message
    if (!text && attachments.length === 0) {
      return;
    }

    const message: IncomingMessage = {
      id: msg.envelope.timestamp?.toString() || Date.now().toString(),
      platform: 'signal',
      userId: sender,
      chatId: groupId || sender,
      chatType: groupId ? 'group' : 'dm',
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: msg.envelope.timestamp
        ? new Date(msg.envelope.timestamp)
        : new Date(),
    };

    await callbacks.onMessage(message);
  }

  /** Send message via signal-cli */
  async function sendMessage(message: OutgoingMessage): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const baseArgs = ['-u', config.phoneNumber, 'send'];
      const optionArgs: string[] = [];
      const targetArgs: string[] = [];

      if (message.text) {
        optionArgs.push('-m', message.text);
      }

      if (message.chatId.startsWith('group.')) {
        optionArgs.push('-g', message.chatId);
      } else {
        targetArgs.push(message.chatId);
      }

      if (config.configDir) {
        baseArgs.unshift('--config', config.configDir);
      }

      const tempFiles: string[] = [];
      const attachments = message.attachments || [];

      const sendWithAttachments = async (): Promise<void> => {
        const finalArgs = [...baseArgs, ...optionArgs];

        if (attachments.length > 0) {
          finalArgs.push('-a');
          const filePaths: string[] = [];

          for (const attachment of attachments) {
            const resolved = await resolveAttachment(attachment);
            if (!resolved) continue;

            const tempPath = path.join(
              os.tmpdir(),
              `clodds-signal-${Date.now()}-${resolved.filename}`
            );
            await fs.writeFile(tempPath, resolved.buffer);
            filePaths.push(tempPath);
            tempFiles.push(tempPath);
          }

          if (filePaths.length > 0) {
            finalArgs.push(...filePaths);
          } else {
            // Remove the -a flag if nothing to attach
            finalArgs.splice(finalArgs.indexOf('-a'), 1);
          }
        }

        finalArgs.push(...targetArgs);

        const proc = spawn(signalCli, finalArgs);

        let stderr = '';
        proc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', async (code) => {
          for (const filePath of tempFiles) {
            try {
              await fs.unlink(filePath);
            } catch {
              // ignore cleanup errors
            }
          }

          if (code === 0) {
            logger.debug({ chatId: message.chatId }, 'Signal message sent');
            resolve(null);
          } else {
            reject(new Error(`signal-cli exited with code ${code}: ${stderr}`));
          }
        });

        proc.on('error', reject);
      };

      sendWithAttachments().catch(reject);
    });
  }

  /** Start JSON RPC receive daemon */
  function startReceiveDaemon(): void {
    const args = ['-u', config.phoneNumber, 'jsonRpc'];

    if (config.configDir) {
      args.unshift('--config', config.configDir);
    }

    cliProcess = spawn(signalCli, args);

    const rl = readline.createInterface({
      input: cliProcess.stdout!,
      crlfDelay: Infinity,
    });

    rl.on('line', async (line) => {
      try {
        const msg = JSON.parse(line) as SignalMessage;
        await handleMessage(msg);
      } catch (error) {
        // Ignore JSON parse errors for non-message lines
        if (line.trim() && !line.includes('INFO')) {
          logger.debug({ error, line }, 'Failed to parse signal-cli output');
        }
      }
    });

    cliProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      if (text.includes('ERROR')) {
        logger.error({ text }, 'signal-cli error');
      }
    });

    cliProcess.on('exit', (code) => {
      logger.info({ code }, 'signal-cli daemon exited');
      if (running) {
        // Restart after delay
        setTimeout(startReceiveDaemon, 5000);
      }
    });

    cliProcess.on('error', (err) => {
      logger.error({ err }, 'signal-cli spawn error');
    });
  }

  return {
    platform: 'signal',

    async start(): Promise<void> {
      running = true;
      startReceiveDaemon();
      logger.info('Signal channel started');
    },

    async stop(): Promise<void> {
      running = false;
      if (cliProcess) {
        cliProcess.kill();
        cliProcess = null;
      }
      logger.info('Signal channel stopped');
    },

    async sendMessage(message: OutgoingMessage): Promise<string | null> {
      return sendMessage(message);
    },

    async editMessage(message: OutgoingMessage & { messageId: string }): Promise<void> {
      logger.warn(
        { chatId: message.chatId, messageId: message.messageId },
        'Signal does not support message editing via signal-cli'
      );
    },

    async deleteMessage(message: OutgoingMessage & { messageId: string }): Promise<void> {
      logger.warn(
        { chatId: message.chatId, messageId: message.messageId },
        'Signal does not support message deletion via signal-cli'
      );
    },
  };
}
