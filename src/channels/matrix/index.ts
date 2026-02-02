/**
 * Matrix Channel - Matrix protocol integration
 *
 * Features:
 * - Matrix homeserver connection
 * - Room/DM support
 * - End-to-end encryption (optional)
 * - Rich message formatting
 */

import { logger } from '../../utils/logger';
import { generateShortId } from '../../utils/id';
import type { ChannelAdapter, ChannelCallbacks } from '../index';
import type { IncomingMessage, OutgoingMessage, MessageAttachment } from '../../types';
import type { PairingService } from '../../pairing/index';
import { resolveAttachment } from '../../utils/attachments';

export interface MatrixConfig {
  enabled: boolean;
  /** Homeserver URL (e.g., https://matrix.org) */
  homeserverUrl: string;
  /** Access token */
  accessToken: string;
  /** User ID (e.g., @bot:matrix.org) */
  userId: string;
  /** DM policy */
  dmPolicy?: 'pairing' | 'open';
  /** Allowed user IDs */
  allowFrom?: string[];
  /** Allowed room IDs */
  roomAllowlist?: string[];
  /** Device ID for E2EE */
  deviceId?: string;
  /** Per-room group policies */
  groups?: Record<string, { requireMention?: boolean }>;
}

/** Matrix event types */
interface MatrixEvent {
  type: string;
  event_id: string;
  room_id: string;
  sender: string;
  origin_server_ts: number;
  content: {
    msgtype?: string;
    body?: string;
    formatted_body?: string;
    format?: string;
    url?: string;
    info?: {
      mimetype?: string;
      size?: number;
      width?: number;
      height?: number;
      duration?: number;
    };
    'm.relates_to'?: {
      rel_type: string;
      event_id: string;
    };
  };
}

/** Sync response */
interface SyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<
      string,
      {
        timeline?: {
          events?: MatrixEvent[];
        };
      }
    >;
    invite?: Record<string, unknown>;
  };
}

export async function createMatrixChannel(
  config: MatrixConfig,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<ChannelAdapter> {
  logger.info({ homeserver: config.homeserverUrl }, 'Creating Matrix channel');

  const dmPolicy = config.dmPolicy || 'pairing';
  const allowFrom = new Set(config.allowFrom || []);
  const roomAllowlist = new Set(config.roomAllowlist || []);

  let syncToken: string | null = null;
  let running = false;
  let syncTimeout: ReturnType<typeof setTimeout> | null = null;

  // Track room types (DM vs group)
  const roomTypes = new Map<string, 'dm' | 'group'>();

  /** Make Matrix API request */
  async function matrixApi<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${config.homeserverUrl}/_matrix/client/v3${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Matrix API error: ${response.status} ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /** Check if user is allowed */
  function isAllowed(sender: string, roomId: string): boolean {
    // Check room allowlist
    if (roomAllowlist.size > 0 && !roomAllowlist.has(roomId)) {
      return false;
    }

    // DM policy
    if (dmPolicy === 'open') {
      if (allowFrom.size === 0) return true;
      return allowFrom.has(sender) || allowFrom.has('*');
    }

    // Pairing mode
    if (pairing) {
      return pairing.isPaired('matrix', sender);
    }

    return false;
  }

  /** Determine room type (DM vs group) */
  async function getRoomType(roomId: string): Promise<'dm' | 'group'> {
    if (roomTypes.has(roomId)) {
      return roomTypes.get(roomId)!;
    }

    try {
      // Get room members
      const members = await matrixApi<{ joined: Record<string, unknown> }>(
        'GET',
        `/rooms/${encodeURIComponent(roomId)}/joined_members`
      );

      // DM if only 2 members
      const memberCount = Object.keys(members.joined).length;
      const type = memberCount <= 2 ? 'dm' : 'group';
      roomTypes.set(roomId, type);
      return type;
    } catch {
      return 'group';
    }
  }

  /** Handle incoming event */
  async function handleEvent(event: MatrixEvent): Promise<void> {
    // Only handle room messages
    if (event.type !== 'm.room.message') return;

    // Ignore own messages
    if (event.sender === config.userId) return;

    const msgType = event.content.msgtype;
    const text = event.content.body || '';
    const attachments: MessageAttachment[] = [];

    if (msgType && msgType !== 'm.text') {
      attachments.push({
        type: msgType === 'm.image'
          ? 'image'
          : msgType === 'm.video'
            ? 'video'
            : msgType === 'm.audio'
              ? 'audio'
              : 'document',
        url: event.content.url,
        mimeType: event.content.info?.mimetype,
        size: event.content.info?.size,
        width: event.content.info?.width,
        height: event.content.info?.height,
        duration: event.content.info?.duration,
        caption: text || undefined,
      });
    }

    if (!text && attachments.length === 0) return;

    // Check if allowed
    if (!isAllowed(event.sender, event.room_id)) {
      if (dmPolicy === 'pairing' && pairing) {
        const code = await pairing.createPairingRequest(
          'matrix',
          event.sender,
          event.sender.split(':')[0].slice(1) // Extract localpart
        );
        if (code) {
          await sendMessage({
            chatId: event.room_id,
            text: `Hi! I need to verify you first.\n\nYour pairing code is: **${code}**\n\nAsk an admin to approve it.`,
            platform: 'matrix',
          });
        }
      }
      return;
    }

    // Determine room type
    const chatType = await getRoomType(event.room_id);

    if (chatType === 'group') {
      const requireMention =
        (config as any).groups?.[event.room_id]?.requireMention ?? false;
      if (requireMention && !text.includes(config.userId)) {
        return;
      }
    }

    // Create incoming message
    const message: IncomingMessage = {
      id: event.event_id,
      platform: 'matrix',
      userId: event.sender,
      chatId: event.room_id,
      chatType,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: new Date(event.origin_server_ts),
    };

    await callbacks.onMessage(message);
  }

  /** Auto-join invited rooms */
  async function handleInvites(
    invites: Record<string, unknown>
  ): Promise<void> {
    for (const roomId of Object.keys(invites)) {
      try {
        await matrixApi('POST', `/rooms/${encodeURIComponent(roomId)}/join`, {});
        logger.info({ roomId }, 'Auto-joined Matrix room');
      } catch (error) {
        logger.error({ error, roomId }, 'Failed to join Matrix room');
      }
    }
  }

  /** Sync loop */
  async function sync(): Promise<void> {
    if (!running) return;

    try {
      const params = new URLSearchParams({
        timeout: '30000',
        ...(syncToken ? { since: syncToken } : {}),
      });

      const response = await matrixApi<SyncResponse>(
        'GET',
        `/sync?${params}`
      );

      syncToken = response.next_batch;

      // Handle invites
      if (response.rooms?.invite) {
        await handleInvites(response.rooms.invite);
      }

      // Handle messages
      if (response.rooms?.join) {
        for (const [roomId, room] of Object.entries(response.rooms.join)) {
          const events = room.timeline?.events || [];
          for (const event of events) {
            // Skip events we've already processed (before our sync token)
            if (syncToken && !event.event_id) continue;
            await handleEvent(event);
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Matrix sync error');
    }

    // Schedule next sync
    if (running) {
      syncTimeout = setTimeout(sync, 100);
    }
  }

  async function uploadMedia(attachment: MessageAttachment): Promise<string | null> {
    if (attachment.url?.startsWith('mxc://')) {
      return attachment.url;
    }

    const resolved = await resolveAttachment(attachment);
    if (!resolved) return null;

    const response = await fetch(
      `${config.homeserverUrl}/_matrix/media/v3/upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': resolved.mimeType || 'application/octet-stream',
          'Content-Length': resolved.buffer.length.toString(),
        },
        body: new Uint8Array(resolved.buffer),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Matrix media upload failed: ${response.status} ${error}`);
    }

    const data = await response.json() as { content_uri?: string };
    return data.content_uri || null;
  }

  /** Send message to Matrix room */
  async function sendMessage(message: OutgoingMessage): Promise<string | null> {
    const attachments = message.attachments || [];
    if (attachments.length > 0 && message.text) {
      // Send text first to preserve context
      await sendMessage({ ...message, attachments: undefined });
    }

    for (const attachment of attachments) {
      const mxcUrl = await uploadMedia(attachment);
      if (!mxcUrl) continue;

      const msgtype =
        attachment.type === 'image'
          ? 'm.image'
          : attachment.type === 'video'
            ? 'm.video'
            : attachment.type === 'audio' || attachment.type === 'voice'
              ? 'm.audio'
              : 'm.file';

      const content: Record<string, unknown> = {
        msgtype,
        body: attachment.filename || attachment.caption || 'attachment',
        url: mxcUrl,
        info: {
          mimetype: attachment.mimeType,
          size: attachment.size,
          width: attachment.width,
          height: attachment.height,
          duration: attachment.duration,
        },
      };

      await matrixApi(
        'PUT',
        `/rooms/${encodeURIComponent(message.chatId)}/send/m.room.message/${Date.now().toString(36)}`,
        content
      );
    }

    if (attachments.length > 0) {
      return null;
    }

    const txnId = generateShortId(12);
    const content = buildMatrixTextContent(message.text);

    const response = await matrixApi<{ event_id?: string }>(
      'PUT',
      `/rooms/${encodeURIComponent(message.chatId)}/send/m.room.message/${txnId}`,
      content
    );

    logger.debug({ roomId: message.chatId }, 'Matrix message sent');
    return response.event_id ?? null;
  }

  return {
    platform: 'matrix',

    async start(): Promise<void> {
      running = true;

      // Get initial sync token
      const response = await matrixApi<SyncResponse>('GET', '/sync?timeout=0');
      syncToken = response.next_batch;

      // Start sync loop
      sync();

      logger.info('Matrix channel started');
    },

    async stop(): Promise<void> {
      running = false;
      if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
      }
      logger.info('Matrix channel stopped');
    },

    async sendMessage(message: OutgoingMessage): Promise<string | null> {
      return sendMessage(message);
    },

    async editMessage(message: OutgoingMessage & { messageId: string }): Promise<void> {
      const txnId = generateShortId(12);
      const content = buildMatrixEditContent(message.text, message.messageId);

      await matrixApi(
        'PUT',
        `/rooms/${encodeURIComponent(message.chatId)}/send/m.room.message/${txnId}`,
        content
      );
    },

    async deleteMessage(message: OutgoingMessage & { messageId: string }): Promise<void> {
      const txnId = generateShortId(12);
      await matrixApi(
        'PUT',
        `/rooms/${encodeURIComponent(message.chatId)}/redact/${encodeURIComponent(message.messageId)}/${txnId}`,
        {}
      );
    },
  };
}

/**
 * Simple markdown to HTML conversion for Matrix
 */
function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

export function buildMatrixTextContent(text: string): Record<string, unknown> {
  const hasMarkdown = /[*_`#\[\]]/.test(text);
  const content: Record<string, unknown> = {
    msgtype: 'm.text',
    body: text,
  };

  if (hasMarkdown) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = markdownToHtml(text);
  }

  return content;
}

export function buildMatrixEditContent(
  text: string,
  messageId: string
): Record<string, unknown> {
  const newContent = buildMatrixTextContent(text);
  const fallbackText = text ? `* ${text}` : '* (edited)';

  return {
    msgtype: 'm.text',
    body: fallbackText,
    'm.relates_to': {
      rel_type: 'm.replace',
      event_id: messageId,
    },
    'm.new_content': newContent,
  };
}
