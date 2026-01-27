/**
 * Webhooks - External HTTP triggers for the agent
 *
 * Features:
 * - Register webhook endpoints
 * - Secret-based authentication
 * - Rate limiting
 * - Payload validation
 */

import * as crypto from 'crypto';
import { logger } from '../utils/logger';

/** Webhook definition */
export interface Webhook {
  id: string;
  /** URL path (e.g., /webhook/alerts) */
  path: string;
  /** Secret for HMAC validation */
  secret: string;
  /** Handler function */
  handler: (payload: unknown) => Promise<void>;
  /** Description */
  description?: string;
  /** Rate limit (requests per minute) */
  rateLimit?: number;
  /** Whether webhook is enabled */
  enabled: boolean;
  /** Last triggered timestamp */
  lastTriggered?: Date;
  /** Total trigger count */
  triggerCount: number;
}

/** Rate limit tracking */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface WebhookManager {
  /** Register a new webhook */
  register(
    id: string,
    path: string,
    handler: (payload: unknown) => Promise<void>,
    options?: {
      secret?: string;
      description?: string;
      rateLimit?: number;
      enabled?: boolean;
    }
  ): string;

  /** Unregister a webhook */
  unregister(id: string): boolean;

  /** Enable/disable a webhook */
  setEnabled(id: string, enabled: boolean): void;

  /** Get all webhooks */
  list(): Webhook[];

  /** Get a specific webhook */
  get(id: string): Webhook | undefined;

  /** Handle incoming webhook request */
  handle(
    path: string,
    payload: unknown,
    signature?: string
  ): Promise<{ success: boolean; error?: string }>;

  /** Verify webhook signature */
  verify(webhookId: string, payload: string, signature: string): boolean;

  /** Regenerate secret for a webhook */
  regenerateSecret(id: string): string | null;
}

/** Generate a secure random secret */
function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Generate HMAC signature */
function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function createWebhookManager(): WebhookManager {
  const webhooks = new Map<string, Webhook>();
  const pathIndex = new Map<string, string>(); // path -> webhook id
  const rateLimits = new Map<string, RateLimitEntry>();

  /** Check rate limit */
  function checkRateLimit(webhook: Webhook): boolean {
    if (!webhook.rateLimit) return true;

    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window

    const entry = rateLimits.get(webhook.id);
    if (!entry || now - entry.windowStart > windowMs) {
      // New window
      rateLimits.set(webhook.id, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= webhook.rateLimit) {
      return false;
    }

    entry.count++;
    return true;
  }

  const manager: WebhookManager = {
    register(id, path, handler, options = {}) {
      // Ensure path starts with /
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;

      // Check if path already registered
      if (pathIndex.has(normalizedPath) && pathIndex.get(normalizedPath) !== id) {
        throw new Error(`Path already registered: ${normalizedPath}`);
      }

      const secret = options.secret || generateSecret();

      const webhook: Webhook = {
        id,
        path: normalizedPath,
        secret,
        handler,
        description: options.description,
        rateLimit: options.rateLimit,
        enabled: options.enabled !== false,
        triggerCount: 0,
      };

      webhooks.set(id, webhook);
      pathIndex.set(normalizedPath, id);

      logger.info({ id, path: normalizedPath }, 'Webhook registered');

      return secret;
    },

    unregister(id) {
      const webhook = webhooks.get(id);
      if (!webhook) return false;

      pathIndex.delete(webhook.path);
      webhooks.delete(id);
      rateLimits.delete(id);

      logger.info({ id }, 'Webhook unregistered');
      return true;
    },

    setEnabled(id, enabled) {
      const webhook = webhooks.get(id);
      if (webhook) {
        webhook.enabled = enabled;
        logger.info({ id, enabled }, 'Webhook toggled');
      }
    },

    list() {
      return Array.from(webhooks.values());
    },

    get(id) {
      return webhooks.get(id);
    },

    async handle(path, payload, signature) {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      const webhookId = pathIndex.get(normalizedPath);

      if (!webhookId) {
        return { success: false, error: 'Webhook not found' };
      }

      const webhook = webhooks.get(webhookId);
      if (!webhook) {
        return { success: false, error: 'Webhook not found' };
      }

      if (!webhook.enabled) {
        return { success: false, error: 'Webhook disabled' };
      }

      // Verify signature if provided
      if (signature) {
        const payloadStr =
          typeof payload === 'string' ? payload : JSON.stringify(payload);
        if (!this.verify(webhookId, payloadStr, signature)) {
          logger.warn({ webhookId, path }, 'Invalid webhook signature');
          return { success: false, error: 'Invalid signature' };
        }
      }

      // Check rate limit
      if (!checkRateLimit(webhook)) {
        logger.warn({ webhookId, path }, 'Webhook rate limited');
        return { success: false, error: 'Rate limit exceeded' };
      }

      // Execute handler
      try {
        await webhook.handler(payload);
        webhook.lastTriggered = new Date();
        webhook.triggerCount++;

        logger.info(
          { webhookId, path, triggerCount: webhook.triggerCount },
          'Webhook triggered'
        );

        return { success: true };
      } catch (error) {
        logger.error({ error, webhookId, path }, 'Webhook handler failed');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Handler failed',
        };
      }
    },

    verify(webhookId, payload, signature) {
      const webhook = webhooks.get(webhookId);
      if (!webhook) return false;

      const expectedSignature = sign(payload, webhook.secret);

      // Constant-time comparison to prevent timing attacks
      try {
        return crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature)
        );
      } catch {
        return false;
      }
    },

    regenerateSecret(id) {
      const webhook = webhooks.get(id);
      if (!webhook) return null;

      const newSecret = generateSecret();
      webhook.secret = newSecret;

      logger.info({ id }, 'Webhook secret regenerated');
      return newSecret;
    },
  };

  return manager;
}

/**
 * Create Express/Fastify-compatible middleware for webhooks
 */
export function createWebhookMiddleware(manager: WebhookManager) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (req: any, res: any) => {
    const path = req.path || req.url;
    const payload = req.body;
    const signature =
      req.headers['x-webhook-signature'] || req.headers['x-hub-signature-256'];

    const result = await manager.handle(path, payload, signature);

    if (result.success) {
      res.status(200).json({ ok: true });
    } else {
      const statusCode =
        result.error === 'Rate limit exceeded'
          ? 429
          : result.error === 'Webhook not found'
            ? 404
            : result.error === 'Invalid signature'
              ? 401
              : 500;

      res.status(statusCode).json({ ok: false, error: result.error });
    }
  };
}
