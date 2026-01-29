/**
 * Cryptographic utilities for signature verification
 * Compatible with Cloudflare Workers (Web Crypto API)
 */

// Kalshi API Key Authentication
// Based on https://trading-api.readme.io/reference/api-key-authentication
export async function buildKalshiHeaders(
  apiKeyId: string,
  privateKeyPem: string,
  method: string,
  url: string
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = new URL(url).pathname;

  // Message to sign: timestamp + method + path
  const message = timestamp + method.toUpperCase() + path;

  // Import the private key
  const privateKey = await importKalshiPrivateKey(privateKeyPem);

  // Sign the message
  const encoder = new TextEncoder();
  const messageBuffer = encoder.encode(message);

  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    messageBuffer
  );

  const signatureBase64 = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-SIGNATURE': signatureBase64,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
  };
}

async function importKalshiPrivateKey(pem: string): Promise<CryptoKey> {
  // Normalize the PEM format
  let normalizedPem = pem.trim();

  // Handle different key formats
  if (!normalizedPem.includes('-----BEGIN')) {
    // Raw base64, assume PKCS#8
    normalizedPem = `-----BEGIN PRIVATE KEY-----\n${normalizedPem}\n-----END PRIVATE KEY-----`;
  }

  // Extract the base64 content
  const pemContents = normalizedPem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  // Try PKCS#8 format first, then PKCS#1
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      binaryDer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch {
    // Try converting PKCS#1 to PKCS#8
    throw new Error(
      'Failed to import private key. Ensure it is in PKCS#8 format.'
    );
  }
}

// Discord signature verification
export async function verifyDiscordSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const message = encoder.encode(timestamp + body);

    const signatureBytes = hexToUint8Array(signature);
    const publicKeyBytes = hexToUint8Array(publicKey);

    const key = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    return await crypto.subtle.verify('Ed25519', key, signatureBytes, message);
  } catch {
    return false;
  }
}

// Slack signature verification
export async function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const baseString = `v0:${timestamp}:${body}`;

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signingSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(baseString)
    );

    const expectedSignature =
      'v0=' +
      Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    return signature === expectedSignature;
  } catch {
    return false;
  }
}

// Telegram webhook verification (secret token)
export function verifyTelegramSecret(
  providedSecret: string | null,
  expectedSecret: string
): boolean {
  if (!providedSecret || !expectedSecret) return false;
  return providedSecret === expectedSecret;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Generate random session ID
export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
