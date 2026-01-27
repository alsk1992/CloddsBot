/**
 * Channel Manager - Handles messaging platform integrations
 */

import { WebSocketServer } from 'ws';
import { createTelegramChannel } from './telegram/index';
import { createDiscordChannel } from './discord/index';
import { createWebChatChannel, WebChatChannel } from './webchat/index';
import { createWhatsAppChannel, WhatsAppConfig } from './whatsapp/index';
import { createSlackChannel, SlackConfig } from './slack/index';
import { createGoogleChatChannel, GoogleChatConfig } from './googlechat/index';
import { createTeamsChannel, TeamsConfig } from './teams/index';
import { createMatrixChannel, MatrixConfig } from './matrix/index';
import { createSignalChannel, SignalConfig } from './signal/index';
import { createiMessageChannel, iMessageConfig } from './imessage/index';
import { logger } from '../utils/logger';
import type { Config, IncomingMessage, OutgoingMessage } from '../types';
import type { PairingService } from '../pairing/index';

export interface ChannelAdapter {
  platform: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(message: OutgoingMessage): Promise<void>;
  /** Optional event handler for webhook-based channels */
  handleEvent?: (event: unknown) => Promise<unknown>;
}

export interface ChannelManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutgoingMessage): Promise<void>;
  attachWebSocket(wss: WebSocketServer): void;
  getAdapters(): Record<string, ChannelAdapter>;
}

export interface ChannelCallbacks {
  onMessage: (message: IncomingMessage) => Promise<void>;
  pairing?: PairingService;
}

export async function createChannelManager(
  config: Config['channels'],
  callbacks: ChannelCallbacks
): Promise<ChannelManager> {
  const channels = new Map<string, ChannelAdapter>();
  let webchat: WebChatChannel | null = null;

  // Initialize Telegram if enabled
  if (config.telegram?.enabled && config.telegram.botToken) {
    logger.info('Initializing Telegram channel');
    const telegram = await createTelegramChannel(config.telegram, callbacks, callbacks.pairing);
    channels.set('telegram', telegram as unknown as ChannelAdapter);
  }

  // Initialize Discord if enabled
  if (config.discord?.enabled && config.discord.token) {
    logger.info('Initializing Discord channel');
    const discord = await createDiscordChannel(config.discord, callbacks, callbacks.pairing);
    channels.set('discord', discord);
  }

  // Initialize WebChat if enabled (starts when WebSocket attached)
  if (config.webchat?.enabled) {
    logger.info('Initializing WebChat channel');
    webchat = createWebChatChannel(config.webchat, callbacks);
  }

  // Initialize WhatsApp if enabled
  if ((config as any).whatsapp?.enabled) {
    logger.info('Initializing WhatsApp channel');
    const whatsapp = await createWhatsAppChannel(
      (config as any).whatsapp as WhatsAppConfig,
      callbacks,
      callbacks.pairing
    );
    channels.set('whatsapp', whatsapp);
  }

  // Initialize Slack if enabled
  if ((config as any).slack?.enabled && (config as any).slack?.botToken) {
    logger.info('Initializing Slack channel');
    const slack = await createSlackChannel(
      (config as any).slack as SlackConfig,
      callbacks,
      callbacks.pairing
    );
    channels.set('slack', slack);
  }

  // Initialize Google Chat if enabled
  if ((config as any).googlechat?.enabled) {
    logger.info('Initializing Google Chat channel');
    const googlechat = await createGoogleChatChannel(
      (config as any).googlechat as GoogleChatConfig,
      callbacks,
      callbacks.pairing
    );
    channels.set('googlechat', googlechat);
  }

  // Initialize Microsoft Teams if enabled
  if ((config as any).teams?.enabled && (config as any).teams?.appId) {
    logger.info('Initializing Microsoft Teams channel');
    const teams = await createTeamsChannel(
      (config as any).teams as TeamsConfig,
      callbacks,
      callbacks.pairing
    );
    channels.set('teams', teams);
  }

  // Initialize Matrix if enabled
  if ((config as any).matrix?.enabled && (config as any).matrix?.accessToken) {
    logger.info('Initializing Matrix channel');
    const matrix = await createMatrixChannel(
      (config as any).matrix as MatrixConfig,
      callbacks,
      callbacks.pairing
    );
    channels.set('matrix', matrix);
  }

  // Initialize Signal if enabled
  if ((config as any).signal?.enabled && (config as any).signal?.phoneNumber) {
    logger.info('Initializing Signal channel');
    const signal = await createSignalChannel(
      (config as any).signal as SignalConfig,
      callbacks,
      callbacks.pairing
    );
    channels.set('signal', signal);
  }

  // Initialize iMessage if enabled (macOS only)
  if ((config as any).imessage?.enabled && process.platform === 'darwin') {
    logger.info('Initializing iMessage channel');
    const imessage = await createiMessageChannel(
      (config as any).imessage as iMessageConfig,
      callbacks,
      callbacks.pairing
    );
    channels.set('imessage', imessage);
  }

  return {
    async start() {
      for (const [name, channel] of channels) {
        logger.info({ channel: name }, 'Starting channel');
        await channel.start();
      }
    },

    async stop() {
      for (const [name, channel] of channels) {
        logger.info({ channel: name }, 'Stopping channel');
        await channel.stop();
      }
      if (webchat) {
        webchat.stop();
      }
    },

    async send(message: OutgoingMessage) {
      // Handle webchat separately
      if (message.platform === 'webchat') {
        if (webchat) {
          await webchat.sendMessage(message);
        } else {
          logger.warn('WebChat not enabled');
        }
        return;
      }

      const channel = channels.get(message.platform);
      if (channel) {
        await channel.sendMessage(message);
      } else {
        logger.warn({ platform: message.platform }, 'Unknown channel');
      }
    },

    attachWebSocket(wss: WebSocketServer) {
      if (webchat) {
        webchat.start(wss);
        logger.info('WebChat attached to WebSocket server');
      }
    },

    getAdapters(): Record<string, ChannelAdapter> {
      return Object.fromEntries(channels);
    },
  };
}
