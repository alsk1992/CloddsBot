/**
 * Webhook Security - Signature validation for incoming webhooks
 *
 * Supports:
 * - HMAC-SHA256 signatures (Slack, Discord, GitHub, etc.)
 * - HMAC-SHA1 signatures (legacy)
 * - Timestamp validation (prevent replay attacks)
 */

import * as crypto from 'crypto';
import { logger } from './logger';

export interface WebhookVerificationOptions {
  /** Secret key for HMAC */
  secret: string;
  /** Algorithm (default: sha256) */
  algorithm?: 'sha256' | 'sha1' | 'sha512';
  /** Header name containing signature */
  signatureHeader?: string;
  /** Header name containing timestamp */
  timestampHeader?: string;
  /** Max age in seconds for timestamp validation (default: 300 = 5 minutes) */
  maxAgeSeconds?: number;
  /** Signature prefix (e.g., 'v0=' for Slack) */
  signaturePrefix?: string;
  /** Custom signature format function */
  formatSignature?: (timestamp: string, body: string) => string;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
}

/** Platform-specific verification presets */
export const WebhookPresets = {
  /** Slack webhook verification */
  slack: (secret: string): WebhookVerificationOptions => ({
    secret,
    algorithm: 'sha256',
    signatureHeader: 'x-slack-signature',
    timestampHeader: 'x-slack-request-timestamp',
    signaturePrefix: 'v0=',
    formatSignature: (timestamp, body) => `v0:${timestamp}:${body}`,
  }),

  /** Discord webhook verification */
  discord: (publicKey: string): WebhookVerificationOptions => ({
    secret: publicKey,
    algorithm: 'sha256',
    signatureHeader: 'x-signature-ed25519',
    timestampHeader: 'x-signature-timestamp',
  }),

  /** GitHub webhook verification */
  github: (secret: string): WebhookVerificationOptions => ({
    secret,
    algorithm: 'sha256',
    signatureHeader: 'x-hub-signature-256',
    signaturePrefix: 'sha256=',
  }),

  /** Telegram webhook (uses secret_token query param) */
  telegram: (secretToken: string): WebhookVerificationOptions => ({
    secret: secretToken,
    signatureHeader: 'x-telegram-bot-api-secret-token',
  }),

  /** Generic HMAC-SHA256 */
  generic: (secret: string): WebhookVerificationOptions => ({
    secret,
    algorithm: 'sha256',
    signatureHeader: 'x-signature',
  }),
};

/**
 * Verify a webhook signature
 */
export function verifyWebhookSignature(
  body: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  options: WebhookVerificationOptions
): VerificationResult {
  const {
    secret,
    algorithm = 'sha256',
    signatureHeader = 'x-signature',
    timestampHeader,
    maxAgeSeconds = 300,
    signaturePrefix = '',
    formatSignature,
  } = options;

  // Get signature from headers (case-insensitive)
  const getHeader = (name: string): string | undefined => {
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName) {
        return Array.isArray(value) ? value[0] : value;
      }
    }
    return undefined;
  };

  const providedSignature = getHeader(signatureHeader);
  if (!providedSignature) {
    return { valid: false, error: `Missing signature header: ${signatureHeader}` };
  }

  // Get timestamp if required
  let timestamp: string | undefined;
  if (timestampHeader) {
    timestamp = getHeader(timestampHeader);
    if (!timestamp) {
      return { valid: false, error: `Missing timestamp header: ${timestampHeader}` };
    }

    // Validate timestamp age
    const timestampNum = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    const age = Math.abs(now - timestampNum);

    if (age > maxAgeSeconds) {
      return {
        valid: false,
        error: `Timestamp too old: ${age}s (max: ${maxAgeSeconds}s)`,
      };
    }
  }

  // Build the string to sign
  const bodyStr = Buffer.isBuffer(body) ? body.toString('utf8') : body;
  const signatureBase = formatSignature
    ? formatSignature(timestamp || '', bodyStr)
    : bodyStr;

  // Calculate expected signature
  const hmac = crypto.createHmac(algorithm, secret);
  hmac.update(signatureBase);
  const expectedSignature = signaturePrefix + hmac.digest('hex');

  // Compare signatures (timing-safe)
  const providedSig = providedSignature.startsWith(signaturePrefix)
    ? providedSignature
    : signaturePrefix + providedSignature;

  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(providedSig)
    );

    if (!isValid) {
      logger.debug({ signatureHeader }, 'Webhook signature mismatch');
      return { valid: false, error: 'Invalid signature' };
    }

    return { valid: true };
  } catch {
    // Length mismatch in timingSafeEqual
    return { valid: false, error: 'Invalid signature format' };
  }
}

/**
 * Create Express middleware for webhook verification
 */
export function createWebhookMiddleware(options: WebhookVerificationOptions) {
  return (
    req: { body: string | Buffer; headers: Record<string, string | string[] | undefined> },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ): void => {
    // Need raw body for signature verification
    const body =
      typeof req.body === 'string' || Buffer.isBuffer(req.body)
        ? req.body
        : JSON.stringify(req.body);

    const result = verifyWebhookSignature(body, req.headers, options);

    if (!result.valid) {
      logger.warn({ error: result.error }, 'Webhook verification failed');
      res.status(401).json({ error: 'Unauthorized', message: result.error });
      return;
    }

    next();
  };
}

/**
 * Generate a webhook signature (for testing or sending webhooks)
 */
export function generateWebhookSignature(
  body: string,
  options: WebhookVerificationOptions,
  timestamp?: string
): { signature: string; timestamp?: string } {
  const {
    secret,
    algorithm = 'sha256',
    signaturePrefix = '',
    formatSignature,
  } = options;

  const ts = timestamp || Math.floor(Date.now() / 1000).toString();
  const signatureBase = formatSignature ? formatSignature(ts, body) : body;

  const hmac = crypto.createHmac(algorithm, secret);
  hmac.update(signatureBase);
  const signature = signaturePrefix + hmac.digest('hex');

  return { signature, timestamp: ts };
}
