/**
 * Session Durable Object
 * Manages conversation state per user/chat combination
 */

import type { ConversationMessage, SessionState } from '../types';

const MAX_HISTORY_LENGTH = 20;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SessionDO implements DurableObject {
  private state: DurableObjectState;
  private session: SessionState | null = null;
  private initialized = false;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    const stored = await this.state.storage.get<SessionState>('session');
    if (stored) {
      // Check if session has expired
      if (Date.now() - stored.lastActivity > SESSION_TTL_MS) {
        // Session expired, reset history
        this.session = {
          ...stored,
          history: [],
          messageCount: 0,
          lastActivity: Date.now(),
        };
      } else {
        this.session = stored;
      }
    }

    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.initialize();

    const url = new URL(request.url);
    const action = url.pathname.slice(1);

    switch (action) {
      case 'get':
        return this.handleGet();

      case 'message':
        return this.handleMessage(request);

      case 'clear':
        return this.handleClear();

      case 'delete':
        return this.handleDelete();

      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  private handleGet(): Response {
    return Response.json({
      session: this.session,
    });
  }

  private async handleMessage(request: Request): Promise<Response> {
    const body = await request.json<{
      userId: string;
      platform: string;
      chatId: string;
      role: 'user' | 'assistant';
      content: string;
    }>();

    if (!this.session) {
      // Create new session
      this.session = {
        userId: body.userId,
        platform: body.platform,
        chatId: body.chatId,
        history: [],
        lastActivity: Date.now(),
        messageCount: 0,
      };
    }

    // Add message to history
    const message: ConversationMessage = {
      role: body.role,
      content: body.content,
      timestamp: Date.now(),
    };

    this.session.history.push(message);

    // Trim to max length
    if (this.session.history.length > MAX_HISTORY_LENGTH) {
      this.session.history = this.session.history.slice(-MAX_HISTORY_LENGTH);
    }

    this.session.lastActivity = Date.now();
    this.session.messageCount++;

    // Persist
    await this.state.storage.put('session', this.session);

    return Response.json({
      success: true,
      session: this.session,
    });
  }

  private async handleClear(): Promise<Response> {
    if (this.session) {
      this.session.history = [];
      this.session.messageCount = 0;
      this.session.lastActivity = Date.now();
      await this.state.storage.put('session', this.session);
    }

    return Response.json({ success: true });
  }

  private async handleDelete(): Promise<Response> {
    this.session = null;
    await this.state.storage.delete('session');

    return Response.json({ success: true });
  }

  // Alarm handler for session cleanup
  async alarm(): Promise<void> {
    if (!this.session) return;

    if (Date.now() - this.session.lastActivity > SESSION_TTL_MS) {
      this.session.history = [];
      await this.state.storage.put('session', this.session);
    }
  }
}

// Helper to generate session key (matches Clodds format)
export function generateSessionKey(
  platform: string,
  chatId: string,
  userId: string,
  accountId?: string
): string {
  const platformSegment = accountId ? `${platform}:${accountId}` : platform;
  return `agent:main:${platformSegment}:dm:${chatId}:${userId}`;
}

// Get session DO stub
export function getSessionStub(
  env: { SESSION: DurableObjectNamespace },
  sessionKey: string
): DurableObjectStub {
  const id = env.SESSION.idFromName(sessionKey);
  return env.SESSION.get(id);
}

// Helper functions for interacting with session DO

export async function getSession(
  env: { SESSION: DurableObjectNamespace },
  sessionKey: string
): Promise<SessionState | null> {
  const stub = getSessionStub(env, sessionKey);
  const response = await stub.fetch('http://session/get');
  const data = await response.json<{ session: SessionState | null }>();
  return data.session;
}

export async function addToSession(
  env: { SESSION: DurableObjectNamespace },
  sessionKey: string,
  params: {
    userId: string;
    platform: string;
    chatId: string;
    role: 'user' | 'assistant';
    content: string;
  }
): Promise<SessionState> {
  const stub = getSessionStub(env, sessionKey);
  const response = await stub.fetch('http://session/message', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  const data = await response.json<{ session: SessionState }>();
  return data.session;
}

export async function clearSession(
  env: { SESSION: DurableObjectNamespace },
  sessionKey: string
): Promise<void> {
  const stub = getSessionStub(env, sessionKey);
  await stub.fetch('http://session/clear', { method: 'POST' });
}
