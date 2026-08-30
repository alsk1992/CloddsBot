/**
 * Polymarket CLOB authentication helpers (L2 API key auth).
 */

import { createHmac } from 'crypto';

export interface PolymarketApiKeyAuth {
  address: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

export function buildPolymarketHmacSignature(
  secret: string,
  timestamp: string,
  method: string,
  pathWithQuery: string,
  body?: string
): string {
  const key = Buffer.from(secret, 'base64');
  const payload = `${timestamp}${method.toUpperCase()}${pathWithQuery}${body ?? ''}`;
  // Must be URL-safe base64 (+ -> -, / -> _) — verified against Polymarket's own
  // clob-client(-v2) signing/hmac.ts, which has always done this conversion; a plain
  // base64 digest mismatches whenever it contains '+' or '/' (most of the time).
  return createHmac('sha256', key)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function buildPolymarketHeadersForUrl(
  auth: PolymarketApiKeyAuth,
  method: string,
  url: string,
  body?: unknown,
  timestampSeconds?: number
): Record<string, string> {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  const timestamp = (timestampSeconds ?? Math.floor(Date.now() / 1000)).toString();
  const bodyString = typeof body === 'string'
    ? body
    : body
      ? JSON.stringify(body)
      : '';
  const signature = buildPolymarketHmacSignature(
    auth.apiSecret,
    timestamp,
    method,
    path,
    bodyString
  );

  // Header names are underscored, not hyphenated — confirmed against docs.polymarket.com's
  // CLOB authentication reference and both clob-client and clob-client-v2's headers/index.ts,
  // which pass these keys straight to axios with no name transformation.
  return {
    'POLY_ADDRESS': auth.address,
    'POLY_API_KEY': auth.apiKey,
    'POLY_PASSPHRASE': auth.apiPassphrase,
    'POLY_TIMESTAMP': timestamp,
    'POLY_SIGNATURE': signature,
  };
}
