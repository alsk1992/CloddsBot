/**
 * Microsoft Teams Channel - Bot Framework integration
 *
 * Features:
 * - Bot Framework messaging
 * - Adaptive Cards support
 * - Team/channel/DM routing
 * - Mentions and reactions
 */

import { logger } from '../../utils/logger';
import type { ChannelAdapter, ChannelCallbacks } from '../index';
import type { IncomingMessage, OutgoingMessage } from '../../types';
import type { PairingService } from '../../pairing/index';

export interface TeamsConfig {
  enabled: boolean;
  /** Microsoft App ID */
  appId: string;
  /** Microsoft App Password */
  appPassword: string;
  /** DM policy */
  dmPolicy?: 'pairing' | 'open';
  /** Allowed user IDs */
  allowFrom?: string[];
  /** Allowed teams/channels */
  teamAllowlist?: string[];
}

/** Teams activity types */
interface TeamsActivity {
  type: string;
  id: string;
  timestamp: string;
  channelId: string;
  from: {
    id: string;
    name: string;
    aadObjectId?: string;
  };
  conversation: {
    id: string;
    conversationType: 'personal' | 'groupChat' | 'channel';
    tenantId?: string;
    isGroup?: boolean;
  };
  recipient: {
    id: string;
    name: string;
  };
  text?: string;
  textFormat?: string;
  attachments?: Array<{
    contentType: string;
    content: unknown;
  }>;
  entities?: Array<{
    type: string;
    mentioned?: { id: string; name: string };
    text?: string;
  }>;
  channelData?: {
    team?: { id: string; name: string };
    channel?: { id: string; name: string };
  };
  serviceUrl: string;
}

/** Outgoing activity */
interface OutgoingActivity {
  type: 'message';
  text?: string;
  attachments?: Array<{
    contentType: string;
    content: unknown;
  }>;
}

export async function createTeamsChannel(
  config: TeamsConfig,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<ChannelAdapter> {
  logger.info('Creating Microsoft Teams channel');

  const dmPolicy = config.dmPolicy || 'pairing';
  const allowFrom = new Set(config.allowFrom || []);
  const teamAllowlist = new Set(config.teamAllowlist || []);

  // Store service URLs for sending messages
  const serviceUrls = new Map<string, string>();

  /** Get access token for Bot Framework */
  async function getAccessToken(): Promise<string> {
    const response = await fetch(
      'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.appId,
          client_secret: config.appPassword,
          scope: 'https://api.botframework.com/.default',
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
  }

  /** Check if user is allowed */
  function isAllowed(activity: TeamsActivity): boolean {
    // Team/channel messages
    if (activity.conversation.conversationType === 'channel') {
      if (teamAllowlist.size > 0) {
        const teamId = activity.channelData?.team?.id;
        return teamId ? teamAllowlist.has(teamId) : false;
      }
      return true;
    }

    // DM/group chat
    if (dmPolicy === 'open') {
      if (allowFrom.size === 0) return true;
      return allowFrom.has(activity.from.id) || allowFrom.has('*');
    }

    // Pairing mode
    if (pairing) {
      return pairing.isPaired('teams', activity.from.id);
    }

    return false;
  }

  /** Extract text from activity (remove bot mention) */
  function extractText(activity: TeamsActivity): string {
    let text = activity.text || '';

    // Remove bot mentions
    if (activity.entities) {
      for (const entity of activity.entities) {
        if (entity.type === 'mention' && entity.mentioned?.id === activity.recipient.id) {
          text = text.replace(entity.text || '', '').trim();
        }
      }
    }

    return text;
  }

  /** Handle incoming activity */
  async function handleActivity(activity: TeamsActivity): Promise<OutgoingActivity | null> {
    // Store service URL for this conversation
    serviceUrls.set(activity.conversation.id, activity.serviceUrl);

    // Only handle message activities
    if (activity.type !== 'message') {
      return null;
    }

    // Check allowlist
    if (!isAllowed(activity)) {
      if (dmPolicy === 'pairing' && pairing) {
        const code = await pairing.createPairingRequest(
          'teams',
          activity.from.id,
          activity.from.name
        );
        if (code) {
          return {
            type: 'message',
            text: `Hi! I need to verify you first.\n\nYour pairing code is: **${code}**\n\nAsk an admin to approve it.`,
          };
        }
      }
      return {
        type: 'message',
        text: "Sorry, you're not authorized to use this bot.",
      };
    }

    const text = extractText(activity);
    if (!text) {
      return null;
    }

    // Create incoming message
    const message: IncomingMessage = {
      id: activity.id,
      platform: 'teams',
      userId: activity.from.id,
      chatId: activity.conversation.id,
      chatType: activity.conversation.conversationType === 'personal' ? 'dm' : 'group',
      text,
      timestamp: new Date(activity.timestamp),
    };

    // Process through callback
    await callbacks.onMessage(message);

    // Response will be sent via sendMessage
    return null;
  }

  /** Send message to Teams */
  async function sendMessage(message: OutgoingMessage): Promise<void> {
    const serviceUrl = serviceUrls.get(message.chatId);
    if (!serviceUrl) {
      logger.warn({ chatId: message.chatId }, 'No service URL for conversation');
      return;
    }

    const token = await getAccessToken();

    const activity: OutgoingActivity = {
      type: 'message',
      text: message.text,
    };

    const response = await fetch(
      `${serviceUrl}v3/conversations/${encodeURIComponent(message.chatId)}/activities`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(activity),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send Teams message: ${response.status} ${error}`);
    }

    logger.debug({ chatId: message.chatId }, 'Teams message sent');
  }

  return {
    platform: 'teams',

    async start(): Promise<void> {
      logger.info('Microsoft Teams channel started (webhook mode)');
      // Teams uses webhooks - the webhook handler should call handleActivity
    },

    async stop(): Promise<void> {
      logger.info('Microsoft Teams channel stopped');
    },

    async sendMessage(message: OutgoingMessage): Promise<void> {
      await sendMessage(message);
    },

    // Expose activity handler for webhook integration
    handleEvent: handleActivity as (event: unknown) => Promise<unknown>,
  };
}

/**
 * Create Adaptive Card for rich messages
 */
export function createAdaptiveCard(options: {
  title?: string;
  body: string;
  actions?: Array<{
    type: 'openUrl' | 'submit';
    title: string;
    url?: string;
    data?: unknown;
  }>;
}): unknown {
  const card: Record<string, unknown> = {
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      ...(options.title
        ? [
            {
              type: 'TextBlock',
              text: options.title,
              weight: 'bolder',
              size: 'large',
            },
          ]
        : []),
      {
        type: 'TextBlock',
        text: options.body,
        wrap: true,
      },
    ],
  };

  if (options.actions && options.actions.length > 0) {
    card.actions = options.actions.map((action) => {
      if (action.type === 'openUrl') {
        return {
          type: 'Action.OpenUrl',
          title: action.title,
          url: action.url,
        };
      }
      return {
        type: 'Action.Submit',
        title: action.title,
        data: action.data,
      };
    });
  }

  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: card,
  };
}
