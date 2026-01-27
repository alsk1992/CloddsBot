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
import { logger } from '../../utils/logger';
import type { ChannelAdapter, ChannelCallbacks } from '../index';
import type { IncomingMessage, OutgoingMessage } from '../../types';
import type { PairingService } from '../../pairing/index';

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
  async function handleMessage(msg: SignalMessage): Promise<void> {
    if (!msg.envelope?.dataMessage?.message) return;

    const sender = msg.envelope.sourceNumber || msg.envelope.source;
    if (!sender) return;

    // Ignore our own messages (from sync)
    if (sender === config.phoneNumber) return;

    const groupId = msg.envelope.dataMessage.groupInfo?.groupId;
    const text = msg.envelope.dataMessage.message;

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

    // Create incoming message
    const message: IncomingMessage = {
      id: msg.envelope.timestamp?.toString() || Date.now().toString(),
      platform: 'signal',
      userId: sender,
      chatId: groupId || sender,
      chatType: groupId ? 'group' : 'dm',
      text,
      timestamp: msg.envelope.timestamp
        ? new Date(msg.envelope.timestamp)
        : new Date(),
    };

    await callbacks.onMessage(message);
  }

  /** Send message via signal-cli */
  async function sendMessage(message: OutgoingMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-u',
        config.phoneNumber,
        'send',
        '-m',
        message.text,
      ];

      // Determine if group or direct message
      if (message.chatId.startsWith('group.')) {
        args.push('-g', message.chatId);
      } else {
        args.push(message.chatId);
      }

      if (config.configDir) {
        args.unshift('--config', config.configDir);
      }

      const proc = spawn(signalCli, args);

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          logger.debug({ chatId: message.chatId }, 'Signal message sent');
          resolve();
        } else {
          reject(new Error(`signal-cli exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', reject);
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

    async sendMessage(message: OutgoingMessage): Promise<void> {
      await sendMessage(message);
    },
  };
}
