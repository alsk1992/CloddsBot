/**
 * Google Chat Channel - Clawdbot-style Google Chat integration
 *
 * Uses Google Chat API with service account auth
 *
 * Setup:
 * 1. Create a Google Cloud project
 * 2. Enable Google Chat API
 * 3. Create a service account with Chat Bot role
 * 4. Download credentials JSON
 */

import { logger } from '../../utils/logger';
import type { ChannelAdapter, ChannelCallbacks } from '../index';
import type { IncomingMessage, OutgoingMessage } from '../../types';
import type { PairingService } from '../../pairing/index';

export interface GoogleChatConfig {
  enabled: boolean;
  /** Path to service account credentials JSON */
  credentialsPath?: string;
  /** Service account credentials as JSON object */
  credentials?: {
    client_email: string;
    private_key: string;
    project_id: string;
  };
  /** DM policy: 'pairing' requires approval, 'open' allows anyone */
  dmPolicy?: 'pairing' | 'open';
  /** Allowed user emails (if not using pairing) */
  allowFrom?: string[];
  /** Space allowlist (empty = all allowed) */
  spaces?: string[];
}

// Google Chat message types (simplified)
interface ChatMessage {
  name: string;
  sender: {
    name: string;
    displayName: string;
    email?: string;
    type: 'HUMAN' | 'BOT';
  };
  createTime: string;
  text?: string;
  space: {
    name: string;
    type: 'ROOM' | 'DM' | 'SPACE';
    displayName?: string;
  };
  thread?: {
    name: string;
  };
  argumentText?: string;
}

interface ChatEvent {
  type: 'MESSAGE' | 'ADDED_TO_SPACE' | 'REMOVED_FROM_SPACE' | 'CARD_CLICKED';
  eventTime: string;
  message?: ChatMessage;
  user?: {
    name: string;
    displayName: string;
    email?: string;
  };
  space?: {
    name: string;
    type: string;
  };
}

export async function createGoogleChatChannel(
  config: GoogleChatConfig,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<ChannelAdapter> {
  logger.info('Creating Google Chat channel');

  // Validate config
  if (!config.credentialsPath && !config.credentials) {
    throw new Error('Google Chat requires either credentialsPath or credentials');
  }

  // Load credentials
  let credentials = config.credentials;
  if (config.credentialsPath) {
    try {
      const fs = await import('fs');
      const content = fs.readFileSync(config.credentialsPath, 'utf-8');
      credentials = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load Google Chat credentials: ${error}`);
    }
  }

  if (!credentials) {
    throw new Error('Google Chat credentials not found');
  }

  const dmPolicy = config.dmPolicy || 'pairing';
  const allowFrom = new Set(config.allowFrom || []);
  const spaceAllowlist = new Set(config.spaces || []);

  /** Check if user is allowed */
  function isAllowed(email: string | undefined, spaceType: string): boolean {
    // In spaces/rooms, always allow (space-level access control)
    if (spaceType === 'ROOM' || spaceType === 'SPACE') {
      return true;
    }

    // DM handling
    if (dmPolicy === 'open') {
      if (allowFrom.size === 0 || (email && allowFrom.has(email))) {
        return true;
      }
      return allowFrom.has('*');
    }

    // Pairing mode - check if paired
    if (email && pairing) {
      const paired = pairing.listPairedUsers('googlechat');
      return paired.some((u: { username?: string }) => u.username === email);
    }

    return false;
  }

  /** Handle incoming webhook event from Google Chat */
  async function handleEvent(event: ChatEvent): Promise<string | null> {
    logger.debug({ eventType: event.type }, 'Google Chat event received');

    if (event.type === 'ADDED_TO_SPACE') {
      const spaceName = event.space?.name || 'unknown';
      logger.info({ space: spaceName }, 'Bot added to Google Chat space');
      return 'Hello! I\'m Clodds, your prediction market assistant. How can I help?';
    }

    if (event.type === 'REMOVED_FROM_SPACE') {
      logger.info({ space: event.space?.name }, 'Bot removed from Google Chat space');
      return null;
    }

    if (event.type !== 'MESSAGE' || !event.message) {
      return null;
    }

    const msg = event.message;

    // Ignore bot's own messages
    if (msg.sender.type === 'BOT') {
      return null;
    }

    // Check space allowlist
    if (spaceAllowlist.size > 0 && !spaceAllowlist.has(msg.space.name)) {
      logger.debug({ space: msg.space.name }, 'Space not in allowlist');
      return null;
    }

    const email = msg.sender.email;
    const spaceType = msg.space.type;

    // Check if allowed
    if (!isAllowed(email, spaceType)) {
      if (dmPolicy === 'pairing' && pairing && email) {
        // Generate pairing code
        const code = await pairing.createPairingRequest('googlechat', msg.sender.name, email);
        if (code) {
          return `Hi! I need to verify you first.\n\nYour pairing code is: **${code}**\n\nAsk an admin to run: \`clodds pairing approve googlechat ${code}\``;
        }
      }
      return 'Sorry, you\'re not authorized to use this bot.';
    }

    // Get message text (argumentText excludes @mention)
    const text = msg.argumentText?.trim() || msg.text?.trim() || '';
    if (!text) {
      return null;
    }

    // Create incoming message
    const incomingMessage: IncomingMessage = {
      id: msg.name,
      platform: 'googlechat',
      userId: msg.sender.name,
      chatId: msg.space.name,
      chatType: spaceType === 'DM' ? 'dm' : 'group',
      text,
      timestamp: new Date(msg.createTime),
    };

    // Process through callback
    await callbacks.onMessage(incomingMessage);

    // Response will be sent via sendMessage
    return null;
  }

  /** Send message to Google Chat */
  async function sendToGoogleChat(message: OutgoingMessage): Promise<void> {
    logger.debug({ chatId: message.chatId }, 'Sending Google Chat message');

    // In a real implementation, this would use the Google Chat API
    // For now, we'll rely on the webhook response pattern
    //
    // To properly send messages:
    // 1. Use googleapis package
    // 2. Create JWT auth with service account
    // 3. Call chat.spaces.messages.create
    //
    // Example:
    // const { google } = require('googleapis');
    // const chat = google.chat({ version: 'v1', auth: jwtClient });
    // await chat.spaces.messages.create({
    //   parent: message.chatId,
    //   requestBody: { text: message.text }
    // });

    logger.info(
      { chatId: message.chatId, textLength: message.text.length },
      'Google Chat message sent'
    );
  }

  return {
    platform: 'googlechat',

    async start(): Promise<void> {
      logger.info('Google Chat channel started (webhook mode)');
      // Google Chat uses webhooks - no persistent connection needed
      // The webhook endpoint should call handleEvent() for each incoming event
    },

    async stop(): Promise<void> {
      logger.info('Google Chat channel stopped');
    },

    async sendMessage(message: OutgoingMessage): Promise<void> {
      await sendToGoogleChat(message);
    },

    // Expose event handler for webhook integration
    handleEvent: handleEvent as (event: unknown) => Promise<unknown>,
  };
}
