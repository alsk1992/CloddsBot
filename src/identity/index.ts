/**
 * Identity Links - Clawdbot-style cross-channel user mapping
 *
 * Features:
 * - Link same person across channels (Telegram, Discord, etc.)
 * - Unified memory retrieval across all linked identities
 * - Manual linking via pairing codes
 * - Automatic detection hints (same display name, etc.)
 */

import { Database } from '../db/index';
import { logger } from '../utils/logger';

/** An identity link between two channel accounts */
export interface IdentityLink {
  id: string;
  /** Primary identity (the "main" one) */
  primaryChannel: string;
  primaryUserId: string;
  /** Linked identity */
  linkedChannel: string;
  linkedUserId: string;
  /** How the link was created */
  linkMethod: 'manual' | 'pairing' | 'auto';
  /** Optional display name at time of linking */
  displayName?: string;
  createdAt: Date;
}

/** Database row type */
interface IdentityLinkRow {
  id: string;
  primaryChannel: string;
  primaryUserId: string;
  linkedChannel: string;
  linkedUserId: string;
  linkMethod: string;
  displayName: string | null;
  createdAt: string;
}

export interface IdentityService {
  /** Link two identities together */
  link(
    primaryChannel: string,
    primaryUserId: string,
    linkedChannel: string,
    linkedUserId: string,
    method?: 'manual' | 'pairing' | 'auto',
    displayName?: string
  ): void;

  /** Unlink an identity */
  unlink(channel: string, userId: string): boolean;

  /** Get all linked identities for a user */
  getLinkedIdentities(channel: string, userId: string): Array<{
    channel: string;
    userId: string;
  }>;

  /** Get the primary identity for a user (or self if not linked) */
  getPrimaryIdentity(channel: string, userId: string): {
    channel: string;
    userId: string;
  };

  /** Check if two identities are linked */
  areLinked(
    channel1: string,
    userId1: string,
    channel2: string,
    userId2: string
  ): boolean;

  /** Get all identity groups (for admin view) */
  getAllGroups(): Array<{
    primary: { channel: string; userId: string };
    linked: Array<{ channel: string; userId: string }>;
  }>;
}

/** Generate a unique ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function createIdentityService(db: Database): IdentityService {
  // Initialize database table
  db.run(`
    CREATE TABLE IF NOT EXISTS identity_links (
      id TEXT PRIMARY KEY,
      primaryChannel TEXT NOT NULL,
      primaryUserId TEXT NOT NULL,
      linkedChannel TEXT NOT NULL,
      linkedUserId TEXT NOT NULL,
      linkMethod TEXT NOT NULL DEFAULT 'manual',
      displayName TEXT,
      createdAt TEXT NOT NULL,
      UNIQUE(linkedChannel, linkedUserId)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_identity_primary
    ON identity_links(primaryChannel, primaryUserId)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_identity_linked
    ON identity_links(linkedChannel, linkedUserId)
  `);

  const service: IdentityService = {
    link(primaryChannel, primaryUserId, linkedChannel, linkedUserId, method = 'manual', displayName) {
      // Don't link to self
      if (primaryChannel === linkedChannel && primaryUserId === linkedUserId) {
        return;
      }

      // Check if linked identity already belongs to another group
      const existing = db.query<IdentityLinkRow>(
        'SELECT * FROM identity_links WHERE linkedChannel = ? AND linkedUserId = ?',
        [linkedChannel, linkedUserId]
      );

      if (existing.length > 0) {
        // Update to new primary
        db.run(
          'UPDATE identity_links SET primaryChannel = ?, primaryUserId = ?, linkMethod = ?, displayName = ? WHERE linkedChannel = ? AND linkedUserId = ?',
          [primaryChannel, primaryUserId, method, displayName || null, linkedChannel, linkedUserId]
        );
      } else {
        // Create new link
        db.run(
          `INSERT INTO identity_links (id, primaryChannel, primaryUserId, linkedChannel, linkedUserId, linkMethod, displayName, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            generateId(),
            primaryChannel,
            primaryUserId,
            linkedChannel,
            linkedUserId,
            method,
            displayName || null,
            new Date().toISOString(),
          ]
        );
      }

      logger.info(
        { primaryChannel, primaryUserId, linkedChannel, linkedUserId, method },
        'Identity linked'
      );
    },

    unlink(channel, userId) {
      // Check if this is a linked identity
      const existing = db.query<IdentityLinkRow>(
        'SELECT * FROM identity_links WHERE linkedChannel = ? AND linkedUserId = ?',
        [channel, userId]
      );

      if (existing.length === 0) return false;

      db.run(
        'DELETE FROM identity_links WHERE linkedChannel = ? AND linkedUserId = ?',
        [channel, userId]
      );

      logger.info({ channel, userId }, 'Identity unlinked');
      return true;
    },

    getLinkedIdentities(channel, userId) {
      // First, find the primary identity for this user
      const primary = this.getPrimaryIdentity(channel, userId);

      // Get all identities linked to this primary
      const links = db.query<IdentityLinkRow>(
        'SELECT * FROM identity_links WHERE primaryChannel = ? AND primaryUserId = ?',
        [primary.channel, primary.userId]
      );

      // Build result including primary and all linked
      const result: Array<{ channel: string; userId: string }> = [
        { channel: primary.channel, userId: primary.userId },
      ];

      for (const link of links) {
        result.push({
          channel: link.linkedChannel,
          userId: link.linkedUserId,
        });
      }

      return result;
    },

    getPrimaryIdentity(channel, userId) {
      // Check if this user is a linked identity
      const link = db.query<IdentityLinkRow>(
        'SELECT * FROM identity_links WHERE linkedChannel = ? AND linkedUserId = ?',
        [channel, userId]
      );

      if (link.length > 0) {
        return {
          channel: link[0].primaryChannel,
          userId: link[0].primaryUserId,
        };
      }

      // This user IS the primary (or not linked at all)
      return { channel, userId };
    },

    areLinked(channel1, userId1, channel2, userId2) {
      // Get primary for both
      const primary1 = this.getPrimaryIdentity(channel1, userId1);
      const primary2 = this.getPrimaryIdentity(channel2, userId2);

      // They're linked if they share the same primary
      return (
        primary1.channel === primary2.channel &&
        primary1.userId === primary2.userId
      );
    },

    getAllGroups() {
      // Get all unique primaries
      const primaries = db.query<{ primaryChannel: string; primaryUserId: string }>(
        'SELECT DISTINCT primaryChannel, primaryUserId FROM identity_links'
      );

      const groups: Array<{
        primary: { channel: string; userId: string };
        linked: Array<{ channel: string; userId: string }>;
      }> = [];

      for (const primary of primaries) {
        const links = db.query<IdentityLinkRow>(
          'SELECT * FROM identity_links WHERE primaryChannel = ? AND primaryUserId = ?',
          [primary.primaryChannel, primary.primaryUserId]
        );

        groups.push({
          primary: {
            channel: primary.primaryChannel,
            userId: primary.primaryUserId,
          },
          linked: links.map((l) => ({
            channel: l.linkedChannel,
            userId: l.linkedUserId,
          })),
        });
      }

      return groups;
    },
  };

  return service;
}
