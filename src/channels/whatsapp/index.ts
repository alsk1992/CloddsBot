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
  downloadMediaMessage,
  getContentType,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';
import type { ChannelCallbacks, ChannelAdapter } from '../index';
import type {
  Config,
  OutgoingMessage,
  IncomingMessage,
  MessageAttachment,
  ReactionMessage,
  PollMessage,
} from '../../types';
import type { PairingService } from '../../pairing/index';
import { resolveAttachment, guessAttachmentType } from '../../utils/attachments';

export interface WhatsAppConfig {
  enabled: boolean;
  /** Directory to store auth state */
  authDir?: string;
  /** Default account ID when multiple accounts are configured */
  defaultAccountId?: string;
  /** Multiple account definitions (auth per account) */
  accounts?: Record<string, {
    authDir?: string;
    enabled?: boolean;
    name?: string;
    dmPolicy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
    allowFrom?: string[];
    requireMentionInGroups?: boolean;
    groups?: Record<string, { requireMention?: boolean }>;
  }>;
  /** DM policy: 'open', 'allowlist', 'pairing', 'disabled' */
  dmPolicy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
  /** Static allowlist of phone numbers (with country code, no +) */
  allowFrom?: string[];
  /** Whether to require @ mention in groups */
  requireMentionInGroups?: boolean;
  /** Per-group policies */
  groups?: Record<string, { requireMention?: boolean }>;
}

export function resolveWhatsAppAuthDir(
  config: WhatsAppConfig,
  options?: { accountId?: string; authDirOverride?: string }
): { accountId: string; authDir: string } {
  const overrideDir = options?.authDirOverride?.trim();
  if (overrideDir) {
    return { accountId: options?.accountId?.trim() || 'default', authDir: overrideDir };
  }

  const accounts = config.accounts ?? {};
  const accountIds = Object.keys(accounts);
  const preferred = options?.accountId?.trim() || config.defaultAccountId?.trim();
  if (preferred && accounts[preferred] && accounts[preferred]?.enabled !== false) {
    return {
      accountId: preferred,
      authDir: accounts[preferred].authDir || config.authDir || path.join(process.cwd(), '.whatsapp-auth'),
    };
  }

  for (const accountId of accountIds) {
    const account = accounts[accountId];
    if (account?.enabled === false) continue;
    return { accountId, authDir: account?.authDir || config.authDir || path.join(process.cwd(), '.whatsapp-auth') };
  }

  return {
    accountId: preferred || 'default',
    authDir: config.authDir || path.join(process.cwd(), '.whatsapp-auth'),
  };
}

export function resolveWhatsAppAccounts(config: WhatsAppConfig): Array<{ accountId: string; authDir: string }> {
  const accounts = config.accounts ?? {};
  const accountIds = Object.keys(accounts);
  if (accountIds.length === 0) {
    const resolved = resolveWhatsAppAuthDir(config);
    return [{ accountId: resolved.accountId, authDir: resolved.authDir }];
  }
  return accountIds
    .filter((accountId) => accounts[accountId]?.enabled !== false)
    .map((accountId) => ({
      accountId,
      authDir: accounts[accountId]?.authDir || config.authDir || path.join(process.cwd(), '.whatsapp-auth'),
    }));
}

export async function loginWhatsAppWithQr(
  authDir: string,
  timeoutMs: number = 2 * 60 * 1000
): Promise<{ connected: boolean; jid?: string }> {
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: logger as any,
  });

  const result = await new Promise<{ connected: boolean; jid?: string }>((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.end(undefined);
      resolve({ connected: false });
    }, timeoutMs);

    sock.ev.on('creds.update', saveCreds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock.ev.on('connection.update', (update: any) => {
      const { connection } = update;
      if (connection === 'open' && !settled) {
        settled = true;
        clearTimeout(timer);
        const jid = sock.user?.id;
        sock.end(undefined);
        resolve({ connected: true, jid });
      }
      if (connection === 'close' && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ connected: false });
      }
    });
  });

  return result;
}

export function buildWhatsAppJid(chatId: string): string {
  return chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
}

export function normalizeWhatsAppUserId(jid: string): string {
  const baseJid = jid.split('@')[0];
  return baseJid.replace(/[^\d]/g, '');
}

export function normalizeWhatsAppGroupJid(jid: string): string {
  const trimmed = jid.trim();
  const lower = trimmed.toLowerCase();
  return lower.startsWith('whatsapp:') ? lower.slice('whatsapp:'.length) : lower;
}

export function buildWhatsAppMessageKey(
  jid: string,
  messageId: string,
  options?: { fromMe?: boolean; participant?: string }
): proto.IMessageKey {
  const key: proto.IMessageKey = {
    remoteJid: jid,
    id: messageId,
    fromMe: options?.fromMe ?? true,
  };
  if (options?.participant) {
    key.participant = options.participant;
  }
  return key;
}

export const WHATSAPP_POLL_MAX_OPTIONS = 12;

export function buildWhatsAppReaction(
  jid: string,
  messageId: string,
  emoji: string,
  remove?: boolean,
  options?: { fromMe?: boolean; participant?: string }
): proto.Message.IReactionMessage {
  return {
    key: buildWhatsAppMessageKey(jid, messageId, options),
    text: remove ? '' : emoji,
  };
}

export function buildWhatsAppPollPayload(
  question: string,
  options: string[],
  multiSelect?: boolean
): { name: string; values: string[]; selectableCount: number } {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    throw new Error('Poll question is required');
  }
  const values = options
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0)
    .slice(0, WHATSAPP_POLL_MAX_OPTIONS);
  if (values.length < 2) {
    throw new Error('Polls require at least 2 options');
  }
  return {
    name: trimmedQuestion,
    values,
    selectableCount: multiSelect ? values.length : 1,
  };
}

export async function createWhatsAppChannel(
  config: WhatsAppConfig,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<ChannelAdapter> {
  type CachedMessageKey = {
    id: string;
    remoteJid: string;
    fromMe: boolean;
    participant?: string;
    text?: string;
  };

  type WhatsAppAccountState = {
    accountId: string;
    authDir: string;
    sock: WASocket | null;
    isConnected: boolean;
    messageKeyCache: Map<string, CachedMessageKey>;
  };

  const accountStates = new Map<string, WhatsAppAccountState>();
  const resolvedAccounts = resolveWhatsAppAccounts(config);
  const defaultAccountId = resolveWhatsAppAuthDir(config).accountId;
  const MAX_MESSAGE_KEYS = 2000;

  if (resolvedAccounts.length === 0) {
    logger.warn('No enabled WhatsApp accounts configured');
  }

  for (const account of resolvedAccounts) {
    accountStates.set(account.accountId, {
      accountId: account.accountId,
      authDir: account.authDir,
      sock: null,
      isConnected: false,
      messageKeyCache: new Map<string, CachedMessageKey>(),
    });
    if (!fs.existsSync(account.authDir)) {
      fs.mkdirSync(account.authDir, { recursive: true });
    }
  }

  function resolveAccountState(accountId?: string): WhatsAppAccountState | undefined {
    if (accountId && accountStates.has(accountId)) {
      return accountStates.get(accountId);
    }
    if (defaultAccountId && accountStates.has(defaultAccountId)) {
      return accountStates.get(defaultAccountId);
    }
    return accountStates.values().next().value;
  }

  function resolveAccountPolicy(accountId: string): {
    dmPolicy: 'open' | 'allowlist' | 'pairing' | 'disabled';
    allowFrom: string[];
    requireMentionInGroups: boolean;
    groups?: Record<string, { requireMention?: boolean }>;
  } {
    const accountConfig = config.accounts?.[accountId];
    return {
      dmPolicy: accountConfig?.dmPolicy ?? config.dmPolicy ?? 'pairing',
      allowFrom: accountConfig?.allowFrom ?? config.allowFrom ?? [],
      requireMentionInGroups: accountConfig?.requireMentionInGroups ?? config.requireMentionInGroups ?? false,
      groups: accountConfig?.groups ?? config.groups,
    };
  }

  function buildAllowlist(allowFrom: string[]): { allowAll: boolean; allowlist: Set<string> } {
    const normalized = allowFrom
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
    const allowAll = normalized.includes('*');
    const allowlist = new Set(normalized.filter((entry) => entry !== '*').map(normalizeWhatsAppUserId));
    return { allowAll, allowlist };
  }

  function rememberMessageKey(
    state: WhatsAppAccountState,
    key: proto.IMessageKey | null | undefined,
    text?: string,
    fallbackRemoteJid?: string
  ): void {
    const id = key?.id;
    const remoteJid = key?.remoteJid ?? fallbackRemoteJid ?? state.messageKeyCache.get(id ?? '')?.remoteJid;
    if (!id || !remoteJid) return;
    const existing = state.messageKeyCache.get(id);
    state.messageKeyCache.set(id, {
      id,
      remoteJid,
      fromMe: key?.fromMe ?? existing?.fromMe ?? false,
      participant: key?.participant ?? existing?.participant,
      text: text ?? existing?.text,
    });
    if (state.messageKeyCache.size > MAX_MESSAGE_KEYS) {
      const oldest = state.messageKeyCache.keys().next().value as string | undefined;
      if (oldest) state.messageKeyCache.delete(oldest);
    }
  }

  function resolveMessageKey(
    state: WhatsAppAccountState,
    jid: string,
    messageId: string,
    fallback: { fromMe: boolean; participant?: string }
  ): proto.IMessageKey {
    const cached = state.messageKeyCache.get(messageId);
    if (cached?.remoteJid) {
      return {
        remoteJid: cached.remoteJid,
        id: messageId,
        fromMe: cached.fromMe ?? fallback.fromMe,
        participant: cached.participant ?? fallback.participant,
      };
    }
    return buildWhatsAppMessageKey(jid, messageId, fallback);
  }

  function buildReplyContext(
    state: WhatsAppAccountState,
    replyToMessageId: string,
    fallbackJid: string
  ): proto.IContextInfo {
    const cached = state.messageKeyCache.get(replyToMessageId);
    const context: proto.IContextInfo = {
      stanzaId: replyToMessageId,
      remoteJid: cached?.remoteJid ?? fallbackJid,
      participant: cached?.participant ?? undefined,
    };
    if (cached?.text) {
      context.quotedMessage = { conversation: cached.text } as proto.IMessage;
    }
    return context;
  }

  function extractTextFromProtoMessage(message?: proto.IMessage | null): string {
    if (!message) return '';
    return (
      message.conversation ||
      message.extendedTextMessage?.text ||
      message.imageMessage?.caption ||
      message.videoMessage?.caption ||
      message.documentMessage?.caption ||
      ''
    );
  }

  /**
   * Check if a user is allowed to DM
   */
  function isUserAllowed(userId: string, allowAll: boolean, allowlist: Set<string>): boolean {
    const normalized = normalizeWhatsAppUserId(userId);

    if (allowAll) return true;
    if (allowlist.has(normalized)) return true;
    if (pairing?.isPaired('whatsapp', normalized)) return true;

    return false;
  }

  async function extractAttachments(
    state: WhatsAppAccountState,
    msg: proto.IWebMessageInfo
  ): Promise<MessageAttachment[]> {
    if (!msg.message || !state.sock) return [];
    const contentType = getContentType(msg.message);
    if (!contentType) return [];

    const attachments: MessageAttachment[] = [];
    const messageContent = (msg.message as any)[contentType];
    if (!messageContent) return attachments;

    const mimeType = messageContent.mimetype as string | undefined;
    const filename = messageContent.fileName as string | undefined;
    const size = messageContent.fileLength ? Number(messageContent.fileLength) : undefined;
    const duration = messageContent.seconds ? Number(messageContent.seconds) : undefined;
    const caption = messageContent.caption as string | undefined;
    const isVoice = Boolean(messageContent.ptt);
    const isSticker = contentType === 'stickerMessage';

    try {
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: state.sock.updateMediaMessage,
        }
      );
      attachments.push({
        type: isSticker ? 'sticker' : (isVoice ? 'voice' : guessAttachmentType(mimeType, filename)),
        data: buffer.toString('base64'),
        mimeType,
        filename,
        size,
        duration,
        caption,
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to download WhatsApp media');
      attachments.push({
        type: isSticker ? 'sticker' : (isVoice ? 'voice' : guessAttachmentType(mimeType, filename)),
        mimeType,
        filename,
        size,
        duration,
        caption,
      });
    }

    return attachments;
  }

  async function sendAttachment(
    state: WhatsAppAccountState,
    jid: string,
    attachment: MessageAttachment,
    caption?: string,
    contextInfo?: proto.IContextInfo
  ): Promise<boolean> {
    if (!state.sock) return false;
    const resolved = await resolveAttachment(attachment);
    if (!resolved) return false;
    const buffer = resolved.buffer;
    const mimeType = attachment.mimeType || resolved.mimeType || 'application/octet-stream';
    const filename = attachment.filename || resolved.filename || 'file';

    switch (attachment.type) {
      case 'image':
        {
          const sent = await state.sock.sendMessage(jid, { image: buffer, caption, contextInfo });
          rememberMessageKey(state, sent?.key, caption, jid);
        }
        return true;
      case 'video':
        {
          const sent = await state.sock.sendMessage(jid, { video: buffer, caption, contextInfo });
          rememberMessageKey(state, sent?.key, caption, jid);
        }
        return true;
      case 'audio':
      case 'voice':
        {
          const sent = await state.sock.sendMessage(jid, {
            audio: buffer,
            mimetype: mimeType,
            ptt: attachment.type === 'voice',
            contextInfo,
          });
          rememberMessageKey(state, sent?.key, caption, jid);
        }
        return true;
      case 'document':
        {
          const sent = await state.sock.sendMessage(jid, {
            document: buffer,
            fileName: filename,
            mimetype: mimeType,
            caption,
            contextInfo,
          });
          rememberMessageKey(state, sent?.key, caption, jid);
        }
        return true;
      case 'sticker':
        {
          const sent = await state.sock.sendMessage(jid, { sticker: buffer, contextInfo });
          rememberMessageKey(state, sent?.key, caption, jid);
        }
        return true;
      default:
        {
          const sent = await state.sock.sendMessage(jid, {
            document: buffer,
            fileName: filename,
            mimetype: mimeType,
            caption,
            contextInfo,
          });
          rememberMessageKey(state, sent?.key, caption, jid);
        }
        return true;
    }
  }

  /**
   * Connect to WhatsApp (per account)
   */
  async function connectAccount(account: WhatsAppAccountState): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(account.authDir);
    const policy = resolveAccountPolicy(account.accountId);
    const { allowAll, allowlist } = buildAllowlist(policy.allowFrom);

    account.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true, // Show QR code in terminal for pairing
      logger: logger as any, // Use our logger
    });

    const sock = account.sock;

    // Handle connection updates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info({ accountId: account.accountId }, 'Scan QR code with WhatsApp to connect');
      }

      if (connection === 'close') {
        account.isConnected = false;
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;

        logger.warn(
          { shouldReconnect, error: lastDisconnect?.error, accountId: account.accountId },
          'WhatsApp connection closed'
        );

        if (shouldReconnect) {
          // Reconnect after delay
          setTimeout(() => connectAccount(account), 5000);
        }
      } else if (connection === 'open') {
        account.isConnected = true;
        logger.info({ accountId: account.accountId }, 'WhatsApp connected');
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
        const chatId = isGroup ? normalizeWhatsAppGroupJid(jid) : normalizeWhatsAppUserId(jid);

        // Extract text content (include captions)
        const textContent =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          msg.message.documentMessage?.caption ||
          '';

        const attachments = await extractAttachments(account, msg);

        if (!textContent && attachments.length === 0) continue;

        // DM Policy enforcement (only for DMs, not groups)
        if (!isGroup) {
          const normalizedUserId = normalizeWhatsAppUserId(userId);

          switch (policy.dmPolicy) {
            case 'allowlist':
              if (!isUserAllowed(userId, allowAll, allowlist)) {
                logger.info({ userId: normalizedUserId }, 'Ignoring message from non-allowlisted user');
                continue;
              }
              break;

            case 'pairing':
              if (!isUserAllowed(userId, allowAll, allowlist)) {
                // Check if message is a pairing code (8 uppercase alphanumeric)
                const potentialCode = textContent.trim().toUpperCase();
                if (/^[A-Z0-9]{8}$/.test(potentialCode) && pairing) {
                  const request = await pairing.validateCode(potentialCode);
                  if (request) {
                    await account.sock?.sendMessage(jid, {
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
                    await account.sock?.sendMessage(jid, {
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
                    await account.sock?.sendMessage(jid, {
                      text:
                        `🔐 *Pairing Required*\n\n` +
                        `Too many pending requests. Please try again later.`,
                    });
                  }
                } else {
                  await account.sock?.sendMessage(jid, {
                    text:
                      `🔐 *Access Required*\n\n` +
                      `Please contact the bot owner to get access.`,
                  });
                }
                continue;
              }
              break;

            case 'disabled':
              await account.sock?.sendMessage(jid, {
                text: 'DMs are currently disabled.',
              });
              continue;

            case 'open':
            default:
              // Allow everyone
              break;
          }
        }

        if (isGroup) {
          const groupKey = normalizeWhatsAppGroupJid(jid);
          const legacyGroupKey = normalizeWhatsAppUserId(jid);
          const groupConfig =
            policy.groups?.[groupKey] ??
            (legacyGroupKey ? policy.groups?.[legacyGroupKey] : undefined);
          const groupRequireMention = groupConfig?.requireMention ?? policy.requireMentionInGroups ?? false;
          if (groupRequireMention) {
            const contentType = getContentType(msg.message);
            const messageContent = contentType ? (msg.message as any)[contentType] : undefined;
            const contextInfo =
              messageContent?.contextInfo ??
              msg.message.extendedTextMessage?.contextInfo ??
              msg.message.imageMessage?.contextInfo ??
              msg.message.videoMessage?.contextInfo ??
              msg.message.documentMessage?.contextInfo;
          const mentionedJids = contextInfo?.mentionedJid || [];
          const botJid = account.sock?.user?.id;
            if (botJid && !mentionedJids.includes(botJid)) {
              // Bot not mentioned, ignore
              continue;
            }
          }
        }

        const contentType = getContentType(msg.message);
        const messageContent = contentType ? (msg.message as any)[contentType] : undefined;
        const contextInfo =
          messageContent?.contextInfo ??
          msg.message.extendedTextMessage?.contextInfo ??
          msg.message.imageMessage?.contextInfo ??
          msg.message.videoMessage?.contextInfo ??
          msg.message.documentMessage?.contextInfo;
        const replyToMessageId = contextInfo?.stanzaId;

        const incomingMessage: IncomingMessage = {
          id: msg.key.id || Date.now().toString(),
          platform: 'whatsapp',
          accountId: account.accountId,
          userId: normalizeWhatsAppUserId(userId),
          chatId,
          chatType: isGroup ? 'group' : 'dm',
          text: textContent,
          thread: replyToMessageId ? { replyToMessageId } : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
          timestamp: new Date(
            (msg.messageTimestamp as number) * 1000 || Date.now()
          ),
        };

        logger.info(
          { userId: incomingMessage.userId, chatType: incomingMessage.chatType },
          'Received WhatsApp message'
        );

        rememberMessageKey(account, msg.key, textContent, jid);
        await callbacks.onMessage(incomingMessage);
      }
    });

    sock.ev.on('messages.update', (updates) => {
      for (const { key, update } of updates) {
        const protocol = update?.message?.protocolMessage;
        const targetKey = protocol?.key ?? key;
        const remoteJid = targetKey?.remoteJid ?? key.remoteJid;
        if (!targetKey?.id || !remoteJid) continue;
        const editedMessage = protocol?.editedMessage ?? update?.message;
        const text = extractTextFromProtoMessage(editedMessage);
        if (text) {
          rememberMessageKey(account, { ...targetKey, remoteJid }, text, remoteJid);
          logger.debug({ accountId: account.accountId, id: targetKey.id }, 'WhatsApp message updated');
        }
      }
    });

    sock.ev.on('messages.delete', (event) => {
      if ('keys' in event) {
        for (const key of event.keys) {
          if (key?.id) {
            account.messageKeyCache.delete(key.id);
          }
        }
        logger.debug({ accountId: account.accountId, count: event.keys.length }, 'WhatsApp messages deleted');
      } else if ('jid' in event && event.all) {
        const jid = event.jid;
        if (jid) {
          for (const [id, cached] of account.messageKeyCache) {
            if (cached.remoteJid === jid) {
              account.messageKeyCache.delete(id);
            }
          }
          logger.debug({ accountId: account.accountId, jid }, 'WhatsApp chat history cleared');
        }
      }
    });

    sock.ev.on('messages.reaction', (events) => {
      for (const { key, reaction } of events) {
        if (!key?.id) continue;
        if (reaction?.text) {
          logger.debug(
            { accountId: account.accountId, id: key.id, emoji: reaction.text },
            'WhatsApp reaction added'
          );
        } else {
          logger.debug({ accountId: account.accountId, id: key.id }, 'WhatsApp reaction removed');
        }
      }
    });
  }

  async function connectAll(): Promise<void> {
    for (const account of accountStates.values()) {
      await connectAccount(account);
    }
  }

  return {
    platform: 'whatsapp',

    async start() {
      logger.info('Starting WhatsApp channel');
      await connectAll();
    },

    async stop() {
      logger.info('Stopping WhatsApp channel');
      for (const account of accountStates.values()) {
        if (account.sock) {
          account.sock.end(undefined);
          account.sock = null;
        }
        account.isConnected = false;
      }
    },

    async sendMessage(message: OutgoingMessage): Promise<string | null> {
      const account = resolveAccountState(message.accountId);
      if (!account?.sock || !account.isConnected) {
        logger.warn('WhatsApp not connected, cannot send message');
        throw new Error('WhatsApp not connected');
      }

      // Convert chat ID to JID format
      const jid = buildWhatsAppJid(message.chatId);
      const replyContext = message.thread?.replyToMessageId
        ? buildReplyContext(account, message.thread.replyToMessageId, jid)
        : undefined;
      let replyApplied = false;

      const attachments = message.attachments || [];
      const text = message.text || '';

      if (attachments.length > 0) {
        let usedText = false;
        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          const caption = !usedText && text ? text : attachment.caption;
          const contextInfo = !replyApplied ? replyContext : undefined;
          const sent = await sendAttachment(account, jid, attachment, caption, contextInfo);
          if (sent && caption === text) {
            usedText = true;
          }
          if (sent && contextInfo) {
            replyApplied = true;
          }
        }

        if (!usedText && text) {
          const sent = await account.sock.sendMessage(jid, {
            text,
            contextInfo: replyApplied ? undefined : replyContext,
          });
          if (!replyApplied && replyContext) {
            replyApplied = true;
          }
          rememberMessageKey(account, sent?.key, text, jid);
        }
        return null;
      }

      const sent = await account.sock.sendMessage(jid, { text, contextInfo: replyContext });
      rememberMessageKey(account, sent?.key, text, jid);
      return sent?.key?.id ?? null;
    },

    async editMessage(message: OutgoingMessage & { messageId: string }) {
      const account = resolveAccountState(message.accountId);
      if (!account?.sock || !account.isConnected) {
        logger.warn('WhatsApp not connected, cannot edit message');
        return;
      }

      const jid = buildWhatsAppJid(message.chatId);
      const key = resolveMessageKey(account, jid, message.messageId, { fromMe: true });
      await account.sock.sendMessage(jid, { text: message.text, edit: key });
    },

    async deleteMessage(message: OutgoingMessage & { messageId: string }) {
      const account = resolveAccountState(message.accountId);
      if (!account?.sock || !account.isConnected) {
        logger.warn('WhatsApp not connected, cannot delete message');
        return;
      }

      const jid = buildWhatsAppJid(message.chatId);
      const key = resolveMessageKey(account, jid, message.messageId, { fromMe: true });
      await account.sock.sendMessage(jid, { delete: key });
    },

    async reactMessage(message: ReactionMessage): Promise<void> {
      const account = resolveAccountState(message.accountId);
      if (!account?.sock || !account.isConnected) {
        logger.warn('WhatsApp not connected, cannot react');
        return;
      }

      const jid = buildWhatsAppJid(message.chatId);
      const reaction = buildWhatsAppReaction(jid, message.messageId, message.emoji, message.remove, {
        fromMe: message.fromMe ?? false,
        participant: message.participant,
      });
      const cached = account.messageKeyCache.get(message.messageId);
      if (cached?.remoteJid) {
        reaction.key = resolveMessageKey(account, jid, message.messageId, {
          fromMe: message.fromMe ?? false,
          participant: message.participant,
        });
      }
      await account.sock.sendMessage(jid, { react: reaction });
    },

    async sendPoll(message: PollMessage): Promise<string | null> {
      const account = resolveAccountState(message.accountId);
      if (!account?.sock || !account.isConnected) {
        logger.warn('WhatsApp not connected, cannot send poll');
        return null;
      }

      const jid = buildWhatsAppJid(message.chatId);
      const poll = buildWhatsAppPollPayload(message.question, message.options, message.multiSelect);
      const sent = await account.sock.sendMessage(jid, { poll });
      rememberMessageKey(account, sent?.key, message.question, jid);
      return sent?.key?.id ?? null;
    },

    isConnected(message?: OutgoingMessage): boolean {
      if (message?.accountId) {
        const account = resolveAccountState(message.accountId);
        return Boolean(account?.isConnected);
      }
      for (const account of accountStates.values()) {
        if (account.isConnected) return true;
      }
      return false;
    },
  };
}
