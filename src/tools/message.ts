/**
 * Message Tool - Clawdbot-style rich messaging actions
 *
 * Features:
 * - Reactions (emoji)
 * - Threads (reply in thread)
 * - Polls
 * - Pins
 * - Edit/Delete messages
 */

import { logger } from '../utils/logger';

/** Base action */
interface BaseAction {
  platform: string;
  chatId: string;
  messageId: string;
}

/** Add reaction */
export interface ReactionAction extends BaseAction {
  type: 'reaction';
  emoji: string;
  /** Remove instead of add */
  remove?: boolean;
}

/** Reply in thread */
export interface ThreadAction extends BaseAction {
  type: 'thread';
  text: string;
}

/** Create poll */
export interface PollAction {
  type: 'poll';
  platform: string;
  chatId: string;
  question: string;
  options: string[];
  /** Allow multiple selections */
  multiSelect?: boolean;
  /** Anonymous voting */
  anonymous?: boolean;
}

/** Pin message */
export interface PinAction extends BaseAction {
  type: 'pin';
  /** Unpin instead of pin */
  unpin?: boolean;
}

/** Edit message */
export interface EditAction extends BaseAction {
  type: 'edit';
  newText: string;
}

/** Delete message */
export interface DeleteAction extends BaseAction {
  type: 'delete';
}

export type MessageAction =
  | ReactionAction
  | ThreadAction
  | PollAction
  | PinAction
  | EditAction
  | DeleteAction;

/** Action result */
export interface ActionResult {
  success: boolean;
  error?: string;
  /** New message ID if applicable */
  messageId?: string;
}

/** Platform-specific handlers */
export type PlatformHandler = (action: MessageAction) => Promise<ActionResult>;

export interface MessageTool {
  /** Execute a message action */
  execute(action: MessageAction): Promise<ActionResult>;

  /** Register a platform handler */
  registerPlatform(platform: string, handler: PlatformHandler): void;

  /** Add reaction to a message */
  react(
    platform: string,
    chatId: string,
    messageId: string,
    emoji: string
  ): Promise<ActionResult>;

  /** Reply in thread */
  replyInThread(
    platform: string,
    chatId: string,
    messageId: string,
    text: string
  ): Promise<ActionResult>;

  /** Create a poll */
  createPoll(
    platform: string,
    chatId: string,
    question: string,
    options: string[],
    multiSelect?: boolean
  ): Promise<ActionResult>;

  /** Pin a message */
  pin(
    platform: string,
    chatId: string,
    messageId: string
  ): Promise<ActionResult>;

  /** Unpin a message */
  unpin(
    platform: string,
    chatId: string,
    messageId: string
  ): Promise<ActionResult>;

  /** Edit a message */
  edit(
    platform: string,
    chatId: string,
    messageId: string,
    newText: string
  ): Promise<ActionResult>;

  /** Delete a message */
  delete(
    platform: string,
    chatId: string,
    messageId: string
  ): Promise<ActionResult>;
}

export function createMessageTool(): MessageTool {
  const handlers = new Map<string, PlatformHandler>();

  const tool: MessageTool = {
    async execute(action): Promise<ActionResult> {
      const handler = handlers.get(action.platform);

      if (!handler) {
        logger.warn({ platform: action.platform }, 'No handler for platform');
        return {
          success: false,
          error: `Platform not supported: ${action.platform}`,
        };
      }

      logger.info(
        { platform: action.platform, type: action.type },
        'Executing message action'
      );

      try {
        return await handler(action);
      } catch (error) {
        logger.error({ error, action }, 'Message action failed');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Action failed',
        };
      }
    },

    registerPlatform(platform, handler) {
      handlers.set(platform, handler);
      logger.debug({ platform }, 'Registered message handler');
    },

    async react(platform, chatId, messageId, emoji) {
      return this.execute({
        type: 'reaction',
        platform,
        chatId,
        messageId,
        emoji,
      });
    },

    async replyInThread(platform, chatId, messageId, text) {
      return this.execute({
        type: 'thread',
        platform,
        chatId,
        messageId,
        text,
      });
    },

    async createPoll(platform, chatId, question, options, multiSelect) {
      return this.execute({
        type: 'poll',
        platform,
        chatId,
        question,
        options,
        multiSelect,
      });
    },

    async pin(platform, chatId, messageId) {
      return this.execute({
        type: 'pin',
        platform,
        chatId,
        messageId,
      });
    },

    async unpin(platform, chatId, messageId) {
      return this.execute({
        type: 'pin',
        platform,
        chatId,
        messageId,
        unpin: true,
      });
    },

    async edit(platform, chatId, messageId, newText) {
      return this.execute({
        type: 'edit',
        platform,
        chatId,
        messageId,
        newText,
      });
    },

    async delete(platform, chatId, messageId) {
      return this.execute({
        type: 'delete',
        platform,
        chatId,
        messageId,
      });
    },
  };

  return tool;
}

/**
 * Default Telegram handler
 */
export function createTelegramMessageHandler(
  bot: { api: any }
): PlatformHandler {
  return async (action) => {
    const chatId = action.chatId;
    const messageId = 'messageId' in action ? parseInt(action.messageId, 10) : 0;

    switch (action.type) {
      case 'reaction':
        await bot.api.setMessageReaction(chatId, messageId, [
          { type: 'emoji', emoji: action.emoji },
        ]);
        return { success: true };

      case 'thread':
        const result = await bot.api.sendMessage(chatId, action.text, {
          reply_to_message_id: messageId,
        });
        return { success: true, messageId: result.message_id.toString() };

      case 'poll':
        const poll = await bot.api.sendPoll(chatId, action.question, action.options, {
          allows_multiple_answers: action.multiSelect,
          is_anonymous: action.anonymous ?? true,
        });
        return { success: true, messageId: poll.message_id.toString() };

      case 'pin':
        if (action.unpin) {
          await bot.api.unpinChatMessage(chatId, messageId);
        } else {
          await bot.api.pinChatMessage(chatId, messageId);
        }
        return { success: true };

      case 'edit':
        await bot.api.editMessageText(chatId, messageId, action.newText);
        return { success: true };

      case 'delete':
        await bot.api.deleteMessage(chatId, messageId);
        return { success: true };

      default:
        return { success: false, error: 'Unknown action type' };
    }
  };
}

/**
 * Default Discord handler
 */
export function createDiscordMessageHandler(
  client: { channels: any }
): PlatformHandler {
  return async (action) => {
    const channel = await client.channels.fetch(action.chatId);
    if (!channel?.isTextBased()) {
      return { success: false, error: 'Invalid channel' };
    }

    const messageId = 'messageId' in action ? action.messageId : '';

    switch (action.type) {
      case 'reaction':
        const msg = await channel.messages.fetch(messageId);
        if (action.remove) {
          await msg.reactions.cache.get(action.emoji)?.remove();
        } else {
          await msg.react(action.emoji);
        }
        return { success: true };

      case 'thread':
        const threadMsg = await channel.messages.fetch(messageId);
        const thread =
          threadMsg.thread || (await threadMsg.startThread({ name: 'Reply' }));
        const reply = await thread.send(action.text);
        return { success: true, messageId: reply.id };

      case 'pin':
        const pinMsg = await channel.messages.fetch(messageId);
        if (action.unpin) {
          await pinMsg.unpin();
        } else {
          await pinMsg.pin();
        }
        return { success: true };

      case 'edit':
        const editMsg = await channel.messages.fetch(messageId);
        await editMsg.edit(action.newText);
        return { success: true };

      case 'delete':
        const delMsg = await channel.messages.fetch(messageId);
        await delMsg.delete();
        return { success: true };

      default:
        return { success: false, error: 'Unsupported action for Discord' };
    }
  };
}
