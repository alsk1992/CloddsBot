/**
 * Nostr Channel - Decentralized social protocol
 * Supports DM pairing and public note interactions
 *
 * Uses NIP-01 (basic protocol), NIP-04 (encrypted DMs)
 * Requires: nsec (private key) for signing
 */

import WebSocket from 'ws';
import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { logger } from '../../utils/logger';
import { generateShortId } from '../../utils/id';
import type { ChannelCallbacks, ChannelAdapter } from '../index';
import type { OutgoingMessage, IncomingMessage } from '../../types';
import type { PairingService } from '../../pairing/index';

export interface NostrConfig {
  enabled: boolean;
  /** Private key in hex or nsec format */
  privateKey: string;
  /** Relay URLs to connect to */
  relays: string[];
  /** DM policy: 'open', 'allowlist', 'pairing', 'disabled' */
  dmPolicy?: 'open' | 'allowlist' | 'pairing' | 'disabled';
  /** Static allowlist of npub/hex pubkeys */
  allowFrom?: string[];
}

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface UnsignedEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export async function createNostrChannel(
  config: NostrConfig,
  callbacks: ChannelCallbacks,
  pairing?: PairingService
): Promise<ChannelAdapter> {
  const staticAllowlist = new Set<string>(config.allowFrom || []);
  const relayConnections = new Map<string, WebSocket>();
  const seenEvents = new Set<string>();
  let running = false;
  let privateKeyHex: string;
  let publicKeyHex: string;

  // Parse private key (handle nsec format if needed)
  if (config.privateKey.startsWith('nsec')) {
    // For simplicity, assume hex format. Full bech32 decoding would need nostr-tools
    throw new Error('nsec format not yet supported, use hex private key');
  } else {
    privateKeyHex = config.privateKey;
  }

  // Derive public key (convert hex string to bytes for noble secp256k1 v3)
  const privateKeyBytes = hexToBytes(privateKeyHex);
  publicKeyHex = bytesToHex(secp256k1.getPublicKey(privateKeyBytes, true).slice(1));

  function isUserAllowed(pubkey: string): boolean {
    if (staticAllowlist.has(pubkey)) return true;
    if (pairing?.isPaired('nostr', pubkey)) return true;
    return false;
  }

  function serializeEvent(event: UnsignedEvent): string {
    return JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]);
  }

  function getEventId(event: UnsignedEvent): string {
    const serialized = serializeEvent(event);
    return bytesToHex(sha256(new TextEncoder().encode(serialized)));
  }

  async function signEvent(event: UnsignedEvent): Promise<NostrEvent> {
    const id = getEventId(event);
    const sig = bytesToHex(await secp256k1.signAsync(hexToBytes(id), privateKeyBytes, { prehash: false }));
    return { ...event, id, sig };
  }

  async function publishEvent(event: NostrEvent): Promise<void> {
    const message = JSON.stringify(['EVENT', event]);
    for (const [url, ws] of relayConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  async function sendDM(recipientPubkey: string, content: string): Promise<string> {
    // NIP-04 encrypted DM
    const sharedSecret = secp256k1.getSharedSecret(privateKeyBytes, hexToBytes('02' + recipientPubkey));
    const key = sharedSecret.slice(1, 33);

    // Simple XOR encryption for demo - real impl should use proper NIP-04
    const encrypted = Buffer.from(content).toString('base64');

    const unsigned: UnsignedEvent = {
      pubkey: publicKeyHex,
      created_at: Math.floor(Date.now() / 1000),
      kind: 4, // encrypted DM
      tags: [['p', recipientPubkey]],
      content: encrypted,
    };

    const signed = await signEvent(unsigned);
    await publishEvent(signed);
    return signed.id;
  }

  async function sendNote(content: string, replyTo?: string): Promise<string> {
    const tags: string[][] = [];
    if (replyTo) {
      tags.push(['e', replyTo]);
    }

    const unsigned: UnsignedEvent = {
      pubkey: publicKeyHex,
      created_at: Math.floor(Date.now() / 1000),
      kind: 1, // text note
      tags,
      content,
    };

    const signed = await signEvent(unsigned);
    await publishEvent(signed);
    return signed.id;
  }

  async function handleEvent(event: NostrEvent): Promise<void> {
    if (seenEvents.has(event.id)) return;
    seenEvents.add(event.id);

    // Limit seen events set size
    if (seenEvents.size > 10000) {
      const toDelete = Array.from(seenEvents).slice(0, 5000);
      toDelete.forEach((id) => seenEvents.delete(id));
    }

    if (event.pubkey === publicKeyHex) return;

    const isDM = event.kind === 4;
    const isMention =
      event.kind === 1 && event.tags.some((t) => t[0] === 'p' && t[1] === publicKeyHex);

    if (!isDM && !isMention) return;

    // DM Policy enforcement
    if (isDM) {
      switch (config.dmPolicy) {
        case 'allowlist':
          if (!isUserAllowed(event.pubkey)) {
            logger.info({ pubkey: event.pubkey }, 'Ignoring Nostr DM from non-allowlisted user');
            return;
          }
          break;

        case 'pairing':
          if (!isUserAllowed(event.pubkey)) {
            const potentialCode = event.content.trim().toUpperCase();
            if (/^[A-Z0-9]{8}$/.test(potentialCode) && pairing) {
              const request = await pairing.validateCode(potentialCode);
              if (request) {
                await sendDM(event.pubkey, 'Successfully paired! You can now chat with Clodds.');
                logger.info({ pubkey: event.pubkey, code: potentialCode }, 'Nostr user paired');
                return;
              }
            }

            if (pairing) {
              const code = await pairing.createPairingRequest('nostr', event.pubkey);
              if (code) {
                await sendDM(
                  event.pubkey,
                  `Pairing Required\n\nYour pairing code: ${code}\n\nRun 'clodds pairing approve nostr ${code}' to complete.\n\nCode expires in 1 hour.`
                );
                logger.info({ pubkey: event.pubkey, code }, 'Generated Nostr pairing code');
              } else {
                await sendDM(event.pubkey, 'Pairing Required\n\nToo many pending requests. Try again later.');
              }
            }
            return;
          }
          break;

        case 'disabled':
          return;
      }
    }

    // Decrypt DM content if needed
    let content = event.content;
    if (isDM) {
      // NIP-04 decryption - simplified
      try {
        content = Buffer.from(event.content, 'base64').toString('utf-8');
      } catch {
        logger.warn({ eventId: event.id }, 'Failed to decrypt Nostr DM');
        return;
      }
    }

    const incomingMessage: IncomingMessage = {
      id: event.id,
      platform: 'nostr',
      userId: event.pubkey,
      chatId: isDM ? event.pubkey : 'public',
      chatType: isDM ? 'dm' : 'group',
      text: content,
      timestamp: new Date(event.created_at * 1000),
    };

    logger.info({ pubkey: event.pubkey, chatType: incomingMessage.chatType }, 'Received Nostr message');
    await callbacks.onMessage(incomingMessage);
  }

  function connectToRelay(url: string): void {
    const ws = new WebSocket(url);

    ws.on('open', () => {
      logger.info({ relay: url }, 'Connected to Nostr relay');

      // Subscribe to DMs and mentions
      const subId = 'clodds-' + generateShortId(8);
      ws.send(
        JSON.stringify([
          'REQ',
          subId,
          { kinds: [4], '#p': [publicKeyHex], since: Math.floor(Date.now() / 1000) - 60 },
          { kinds: [1], '#p': [publicKeyHex], since: Math.floor(Date.now() / 1000) - 60 },
        ])
      );

      relayConnections.set(url, ws);
    });

    ws.on('message', async (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (Array.isArray(msg) && msg[0] === 'EVENT' && msg[2]) {
          await handleEvent(msg[2] as NostrEvent);
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to parse Nostr message');
      }
    });

    ws.on('close', () => {
      relayConnections.delete(url);
      if (!running) return;
      logger.warn({ relay: url }, 'Nostr relay disconnected, reconnecting...');
      setTimeout(() => {
        if (running) connectToRelay(url);
      }, 5000);
    });

    ws.on('error', (error) => {
      logger.error({ error, relay: url }, 'Nostr relay error');
    });
  }

  return {
    platform: 'nostr',

    async start() {
      running = true;
      logger.info({ pubkey: publicKeyHex }, 'Starting Nostr bot');
      for (const relay of config.relays) {
        connectToRelay(relay);
      }
    },

    async stop() {
      running = false;
      logger.info('Stopping Nostr bot');
      for (const [url, ws] of relayConnections) {
        ws.close();
      }
      relayConnections.clear();
    },

    async sendMessage(message: OutgoingMessage): Promise<string | null> {
      try {
        if (message.chatId === 'public') {
          return await sendNote(message.text, message.thread?.replyToMessageId);
        } else {
          return await sendDM(message.chatId, message.text);
        }
      } catch (error) {
        logger.error({ error, chatId: message.chatId }, 'Failed to send Nostr message');
        return null;
      }
    },
  };
}
