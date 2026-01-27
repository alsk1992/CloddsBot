/**
 * Session Module - Session-to-session communication
 *
 * Features:
 * - Session state management
 * - Inter-session messaging
 * - Session persistence
 * - Session federation
 * - Collaborative sessions
 */

import { EventEmitter } from 'events';
import { randomBytes, createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface Session {
  id: string;
  name?: string;
  owner: string;
  participants: SessionParticipant[];
  state: SessionState;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface SessionParticipant {
  id: string;
  name: string;
  role: 'owner' | 'collaborator' | 'viewer';
  joinedAt: Date;
  lastSeen: Date;
  status: 'online' | 'away' | 'offline';
}

export type SessionState = 'active' | 'paused' | 'closed' | 'archived';

export interface SessionMessage {
  id: string;
  sessionId: string;
  senderId: string;
  type: 'text' | 'command' | 'event' | 'sync';
  content: unknown;
  timestamp: Date;
}

export interface SessionInvite {
  id: string;
  sessionId: string;
  inviterId: string;
  inviteeId?: string;
  inviteeEmail?: string;
  role: SessionParticipant['role'];
  expiresAt: Date;
  accepted: boolean;
}

export interface SessionConfig {
  maxParticipants?: number;
  allowAnonymous?: boolean;
  persistMessages?: boolean;
  syncInterval?: number;
  storageDir?: string;
}

// =============================================================================
// SESSION MANAGER
// =============================================================================

export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private invites: Map<string, SessionInvite> = new Map();
  private messages: Map<string, SessionMessage[]> = new Map();
  private config: SessionConfig;
  private storageDir: string;
  private localParticipantId: string;

  constructor(config: SessionConfig = {}) {
    super();
    this.config = {
      maxParticipants: config.maxParticipants ?? 10,
      allowAnonymous: config.allowAnonymous ?? false,
      persistMessages: config.persistMessages ?? true,
      syncInterval: config.syncInterval ?? 5000,
      ...config,
    };

    this.storageDir = config.storageDir || join(homedir(), '.clodds', 'sessions');
    this.localParticipantId = this.generateId();
    this.ensureStorageDir();
    this.loadSessions();
  }

  private ensureStorageDir(): void {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private generateId(): string {
    return randomBytes(16).toString('hex');
  }

  private loadSessions(): void {
    const indexPath = join(this.storageDir, 'sessions.json');
    if (existsSync(indexPath)) {
      try {
        const data = JSON.parse(readFileSync(indexPath, 'utf-8'));
        for (const session of data.sessions || []) {
          session.createdAt = new Date(session.createdAt);
          session.updatedAt = new Date(session.updatedAt);
          if (session.expiresAt) {
            session.expiresAt = new Date(session.expiresAt);
          }
          for (const p of session.participants) {
            p.joinedAt = new Date(p.joinedAt);
            p.lastSeen = new Date(p.lastSeen);
          }
          this.sessions.set(session.id, session);
        }
      } catch (error) {
        logger.error({ error }, 'Failed to load sessions');
      }
    }
  }

  private saveSessions(): void {
    const indexPath = join(this.storageDir, 'sessions.json');
    writeFileSync(indexPath, JSON.stringify({
      version: 1,
      sessions: Array.from(this.sessions.values()),
      updatedAt: new Date().toISOString(),
    }, null, 2));
  }

  /** Create a new session */
  create(options: {
    name?: string;
    metadata?: Record<string, unknown>;
    expiresIn?: number; // ms
  } = {}): Session {
    const id = this.generateId();
    const now = new Date();

    const session: Session = {
      id,
      name: options.name,
      owner: this.localParticipantId,
      participants: [{
        id: this.localParticipantId,
        name: 'Local',
        role: 'owner',
        joinedAt: now,
        lastSeen: now,
        status: 'online',
      }],
      state: 'active',
      metadata: options.metadata || {},
      createdAt: now,
      updatedAt: now,
      expiresAt: options.expiresIn ? new Date(now.getTime() + options.expiresIn) : undefined,
    };

    this.sessions.set(id, session);
    this.messages.set(id, []);
    this.saveSessions();
    this.emit('session:create', session);

    logger.info({ sessionId: id, name: options.name }, 'Session created');
    return session;
  }

  /** Join an existing session */
  join(sessionId: string, participant: {
    id?: string;
    name: string;
  }): SessionParticipant | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.state !== 'active') {
      throw new Error('Session is not active');
    }

    if (session.participants.length >= (this.config.maxParticipants || 10)) {
      throw new Error('Session is full');
    }

    const now = new Date();
    const newParticipant: SessionParticipant = {
      id: participant.id || this.generateId(),
      name: participant.name,
      role: 'collaborator',
      joinedAt: now,
      lastSeen: now,
      status: 'online',
    };

    session.participants.push(newParticipant);
    session.updatedAt = now;
    this.saveSessions();
    this.emit('session:join', { sessionId, participant: newParticipant });

    return newParticipant;
  }

  /** Leave a session */
  leave(sessionId: string, participantId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const index = session.participants.findIndex(p => p.id === participantId);
    if (index !== -1) {
      const participant = session.participants[index];
      session.participants.splice(index, 1);
      session.updatedAt = new Date();
      this.saveSessions();
      this.emit('session:leave', { sessionId, participant });

      // If owner leaves and there are other participants, transfer ownership
      if (participant.role === 'owner' && session.participants.length > 0) {
        session.participants[0].role = 'owner';
        session.owner = session.participants[0].id;
      }

      // If no participants left, close session
      if (session.participants.length === 0) {
        this.close(sessionId);
      }
    }
  }

  /** Send a message to a session */
  sendMessage(sessionId: string, content: unknown, type: SessionMessage['type'] = 'text'): SessionMessage {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const message: SessionMessage = {
      id: this.generateId(),
      sessionId,
      senderId: this.localParticipantId,
      type,
      content,
      timestamp: new Date(),
    };

    if (!this.messages.has(sessionId)) {
      this.messages.set(sessionId, []);
    }

    this.messages.get(sessionId)!.push(message);
    session.updatedAt = new Date();
    this.emit('message', message);

    // Persist message if configured
    if (this.config.persistMessages) {
      this.saveMessages(sessionId);
    }

    return message;
  }

  /** Get messages for a session */
  getMessages(sessionId: string, options?: {
    since?: Date;
    limit?: number;
    types?: SessionMessage['type'][];
  }): SessionMessage[] {
    let messages = this.messages.get(sessionId) || [];

    if (options?.since) {
      messages = messages.filter(m => m.timestamp > options.since!);
    }

    if (options?.types) {
      messages = messages.filter(m => options.types!.includes(m.type));
    }

    if (options?.limit) {
      messages = messages.slice(-options.limit);
    }

    return messages;
  }

  private saveMessages(sessionId: string): void {
    const messagePath = join(this.storageDir, `${sessionId}-messages.json`);
    const messages = this.messages.get(sessionId) || [];
    writeFileSync(messagePath, JSON.stringify(messages, null, 2));
  }

  /** Create an invite to a session */
  createInvite(sessionId: string, options: {
    inviteeId?: string;
    inviteeEmail?: string;
    role?: SessionParticipant['role'];
    expiresIn?: number;
  } = {}): SessionInvite {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const invite: SessionInvite = {
      id: this.generateId(),
      sessionId,
      inviterId: this.localParticipantId,
      inviteeId: options.inviteeId,
      inviteeEmail: options.inviteeEmail,
      role: options.role || 'collaborator',
      expiresAt: new Date(Date.now() + (options.expiresIn || 24 * 60 * 60 * 1000)),
      accepted: false,
    };

    this.invites.set(invite.id, invite);
    this.emit('invite:create', invite);

    return invite;
  }

  /** Accept an invite */
  acceptInvite(inviteId: string, participant: { name: string }): SessionParticipant | null {
    const invite = this.invites.get(inviteId);
    if (!invite) {
      throw new Error('Invite not found');
    }

    if (invite.accepted) {
      throw new Error('Invite already accepted');
    }

    if (new Date() > invite.expiresAt) {
      throw new Error('Invite has expired');
    }

    invite.accepted = true;
    const joined = this.join(invite.sessionId, participant);

    if (joined) {
      joined.role = invite.role;
    }

    return joined;
  }

  /** Get a session by ID */
  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** List all sessions */
  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  /** List active sessions */
  listActive(): Session[] {
    return this.list().filter(s => s.state === 'active');
  }

  /** Update session metadata */
  updateMetadata(sessionId: string, metadata: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.metadata = { ...session.metadata, ...metadata };
      session.updatedAt = new Date();
      this.saveSessions();
      this.emit('session:update', session);
    }
  }

  /** Pause a session */
  pause(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state === 'active') {
      session.state = 'paused';
      session.updatedAt = new Date();
      this.saveSessions();
      this.emit('session:pause', session);
    }
  }

  /** Resume a paused session */
  resume(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state === 'paused') {
      session.state = 'active';
      session.updatedAt = new Date();
      this.saveSessions();
      this.emit('session:resume', session);
    }
  }

  /** Close a session */
  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = 'closed';
      session.updatedAt = new Date();
      this.saveSessions();
      this.emit('session:close', session);
      logger.info({ sessionId }, 'Session closed');
    }
  }

  /** Archive a session */
  archive(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = 'archived';
      session.updatedAt = new Date();
      this.saveSessions();
      this.emit('session:archive', session);
    }
  }

  /** Delete a session permanently */
  delete(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.messages.delete(sessionId);
      this.saveSessions();
      this.emit('session:delete', { sessionId });
    }
  }

  /** Update participant status */
  updateParticipantStatus(sessionId: string, participantId: string, status: SessionParticipant['status']): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const participant = session.participants.find(p => p.id === participantId);
      if (participant) {
        participant.status = status;
        participant.lastSeen = new Date();
        this.emit('participant:status', { sessionId, participant });
      }
    }
  }

  /** Get local participant ID */
  getLocalParticipantId(): string {
    return this.localParticipantId;
  }

  /** Generate a shareable session link */
  getShareLink(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const hash = createHash('sha256').update(sessionId + session.createdAt.toISOString()).digest('hex').slice(0, 16);
    return `clodds://session/${sessionId}?key=${hash}`;
  }
}

// =============================================================================
// SESSION SYNC
// =============================================================================

export class SessionSync {
  private manager: SessionManager;
  private syncInterval: NodeJS.Timeout | null = null;
  private peers: Map<string, { url: string; lastSync: Date }> = new Map();

  constructor(manager: SessionManager) {
    this.manager = manager;
  }

  /** Start syncing with peers */
  start(interval = 5000): void {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(() => {
      this.syncAll();
    }, interval);
  }

  /** Stop syncing */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /** Add a peer to sync with */
  addPeer(peerId: string, url: string): void {
    this.peers.set(peerId, { url, lastSync: new Date(0) });
  }

  /** Remove a peer */
  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  /** Sync with all peers */
  private async syncAll(): Promise<void> {
    for (const [peerId, peer] of this.peers) {
      try {
        await this.syncWithPeer(peerId, peer.url);
        peer.lastSync = new Date();
      } catch (error) {
        logger.warn({ peerId, error }, 'Failed to sync with peer');
      }
    }
  }

  /** Sync with a specific peer */
  private async syncWithPeer(_peerId: string, url: string): Promise<void> {
    // Get sessions to sync
    const sessions = this.manager.listActive();
    const sessionIds = sessions.map(s => s.id);

    // Fetch remote session states
    try {
      const response = await fetch(`${url}/api/sessions/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds }),
      });

      if (response.ok) {
        const _data = await response.json();
        // Merge remote state with local state
        // This is a simplified sync - real implementation would handle conflicts
      }
    } catch {
      // Peer unreachable
    }
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createSessionManager(config?: SessionConfig): SessionManager {
  return new SessionManager(config);
}

export function createSessionSync(manager: SessionManager): SessionSync {
  return new SessionSync(manager);
}

// =============================================================================
// DEFAULT INSTANCES
// =============================================================================

export const sessions = new SessionManager();
