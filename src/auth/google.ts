/**
 * Google Authentication Helpers
 * Handles authentication for Google AI services (Gemini, Vertex AI)
 *
 * Supports:
 * - google-antigravity-auth style OAuth
 * - google-gemini-cli-auth style API key management
 * - Service account authentication
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';

export interface GoogleAuthConfig {
  /** Project ID for Vertex AI */
  projectId?: string;
  /** Region for Vertex AI */
  region?: string;
  /** Path to service account JSON */
  serviceAccountPath?: string;
  /** OAuth client ID for user auth */
  clientId?: string;
  /** OAuth client secret */
  clientSecret?: string;
  /** Token storage path */
  tokenStorePath?: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  idToken?: string;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';

// Default client ID for CLI tools (uses Google Cloud SDK public client as fallback)
// These can be overridden via environment variables for custom OAuth apps
const DEFAULT_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ||
  '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com';
const DEFAULT_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
  'd-FL95Q19q7MQmFpd7hHD0Ty';

export class GoogleAuthClient {
  private config: GoogleAuthConfig;
  private tokens: GoogleTokens | null = null;
  private tokenStorePath: string;
  private serviceAccount: ServiceAccountCredentials | null = null;

  constructor(config: GoogleAuthConfig = {}) {
    this.config = config;
    this.tokenStorePath = config.tokenStorePath ||
      path.join(process.env.HOME || '', '.clodds', 'tokens', 'google.json');

    if (config.serviceAccountPath) {
      this.loadServiceAccount();
    } else {
      this.loadTokens();
    }
  }

  private loadServiceAccount(): void {
    try {
      if (this.config.serviceAccountPath && fs.existsSync(this.config.serviceAccountPath)) {
        const data = fs.readFileSync(this.config.serviceAccountPath, 'utf-8');
        this.serviceAccount = JSON.parse(data);
        logger.debug('Loaded Google service account');
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load service account');
    }
  }

  private loadTokens(): void {
    try {
      if (fs.existsSync(this.tokenStorePath)) {
        const data = fs.readFileSync(this.tokenStorePath, 'utf-8');
        this.tokens = JSON.parse(data);
        logger.debug('Loaded Google tokens from storage');
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load Google tokens');
    }
  }

  private saveTokens(): void {
    try {
      const dir = path.dirname(this.tokenStorePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.tokenStorePath, JSON.stringify(this.tokens, null, 2), {
        mode: 0o600,
      });
      logger.debug('Saved Google tokens to storage');
    } catch (error) {
      logger.error({ error }, 'Failed to save Google tokens');
    }
  }

  /**
   * Start device code flow for user authentication
   */
  async startDeviceCodeFlow(scopes: string[] = [
    'https://www.googleapis.com/auth/generative-language',
    'https://www.googleapis.com/auth/cloud-platform',
  ]): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    expiresIn: number;
    interval: number;
  }> {
    const clientId = this.config.clientId || DEFAULT_CLIENT_ID;

    const response = await fetch(GOOGLE_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: scopes.join(' '),
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Device code request failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      device_code: string;
      user_code: string;
      verification_url: string;
      expires_in: number;
      interval: number;
    };

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUrl: data.verification_url,
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  }

  /**
   * Poll for device code completion
   */
  async pollDeviceCode(deviceCode: string, interval: number): Promise<GoogleTokens> {
    const clientId = this.config.clientId || DEFAULT_CLIENT_ID;
    const clientSecret = this.config.clientSecret || DEFAULT_CLIENT_SECRET;
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000;

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, interval * 1000));

      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }).toString(),
      });

      const data = await response.json() as {
        error?: string;
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        id_token?: string;
      };

      if (data.error === 'authorization_pending') {
        continue;
      }

      if (data.error === 'slow_down') {
        interval += 5;
        continue;
      }

      if (data.error) {
        throw new Error(`Device code polling failed: ${data.error}`);
      }

      if (data.access_token) {
        this.tokens = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
          idToken: data.id_token,
        };
        this.saveTokens();
        logger.info('Google tokens obtained successfully');
        return this.tokens;
      }
    }

    throw new Error('Device code polling timed out');
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(): Promise<GoogleTokens> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const clientId = this.config.clientId || DEFAULT_CLIENT_ID;
    const clientSecret = this.config.clientSecret || DEFAULT_CLIENT_SECRET;

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.tokens.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json() as {
      access_token: string;
      expires_in?: number;
      id_token?: string;
    };

    this.tokens = {
      ...this.tokens,
      accessToken: data.access_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      idToken: data.id_token,
    };
    this.saveTokens();

    logger.debug('Google tokens refreshed');
    return this.tokens;
  }

  /**
   * Get access token for service account
   */
  private async getServiceAccountToken(): Promise<string> {
    if (!this.serviceAccount) {
      throw new Error('No service account configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: this.serviceAccount.client_email,
      sub: this.serviceAccount.client_email,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/generative-language https://www.googleapis.com/auth/cloud-platform',
    };

    const jwt = this.createJWT(claims, this.serviceAccount.private_key);

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Service account token request failed: ${response.status}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };

    this.tokens = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return data.access_token;
  }

  private createJWT(claims: Record<string, unknown>, privateKey: string): string {
    const header = { alg: 'RS256', typ: 'JWT' };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedClaims}`;

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(privateKey, 'base64url');

    return `${signatureInput}.${signature}`;
  }

  /**
   * Get current access token
   */
  async getAccessToken(): Promise<string> {
    // Service account path
    if (this.serviceAccount) {
      if (!this.tokens?.accessToken || (this.tokens.expiresAt && Date.now() > this.tokens.expiresAt - 60000)) {
        return this.getServiceAccountToken();
      }
      return this.tokens.accessToken;
    }

    // User auth path
    if (!this.tokens) {
      throw new Error('Not authenticated');
    }

    if (this.tokens.expiresAt && Date.now() > this.tokens.expiresAt - 60000) {
      if (this.tokens.refreshToken) {
        await this.refreshAccessToken();
      } else {
        throw new Error('Token expired and no refresh token available');
      }
    }

    return this.tokens.accessToken;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.tokens !== null || this.serviceAccount !== null;
  }

  /**
   * Get headers for Gemini API requests
   */
  async getGeminiHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get headers for Vertex AI requests
   */
  async getVertexHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Revoke tokens
   */
  async revokeTokens(): Promise<void> {
    if (this.tokens?.accessToken) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${this.tokens.accessToken}`, {
          method: 'POST',
        });
      } catch {
        // Ignore
      }
    }

    this.tokens = null;
    try {
      fs.unlinkSync(this.tokenStorePath);
    } catch {
      // Ignore
    }
    logger.info('Google tokens revoked');
  }
}

interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

/**
 * Interactive Google authentication for CLI
 */
export async function interactiveGoogleAuth(config?: GoogleAuthConfig): Promise<GoogleTokens> {
  const client = new GoogleAuthClient(config);

  console.log('\n=== Google Authentication ===');

  const deviceCode = await client.startDeviceCodeFlow();

  console.log(`\nOpen this URL in your browser:\n  ${deviceCode.verificationUrl}`);
  console.log(`\nEnter this code: ${deviceCode.userCode}`);
  console.log('\nWaiting for authorization...');

  const tokens = await client.pollDeviceCode(deviceCode.deviceCode, deviceCode.interval);

  console.log('Google authentication complete!');

  return tokens;
}

/**
 * API key management for Gemini
 */
export class GeminiApiKeyManager {
  private apiKey: string | null = null;
  private keyStorePath: string;

  constructor(keyStorePath?: string) {
    this.keyStorePath = keyStorePath ||
      path.join(process.env.HOME || '', '.clodds', 'keys', 'gemini.txt');
    this.loadKey();
  }

  private loadKey(): void {
    try {
      // Check environment first
      if (process.env.GOOGLE_API_KEY) {
        this.apiKey = process.env.GOOGLE_API_KEY;
        return;
      }
      if (process.env.GEMINI_API_KEY) {
        this.apiKey = process.env.GEMINI_API_KEY;
        return;
      }

      // Check file storage
      if (fs.existsSync(this.keyStorePath)) {
        this.apiKey = fs.readFileSync(this.keyStorePath, 'utf-8').trim();
      }
    } catch {
      // Ignore
    }
  }

  setKey(apiKey: string): void {
    this.apiKey = apiKey;

    const dir = path.dirname(this.keyStorePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.keyStorePath, apiKey, { mode: 0o600 });
    logger.info('Gemini API key saved');
  }

  getKey(): string | null {
    return this.apiKey;
  }

  hasKey(): boolean {
    return this.apiKey !== null;
  }

  clearKey(): void {
    this.apiKey = null;
    try {
      fs.unlinkSync(this.keyStorePath);
    } catch {
      // Ignore
    }
  }
}

/**
 * Gemini API client with authentication
 */
export class GeminiClient {
  private auth: GoogleAuthClient | null = null;
  private apiKeyManager: GeminiApiKeyManager;

  constructor(config?: GoogleAuthConfig) {
    this.apiKeyManager = new GeminiApiKeyManager();
    if (config) {
      this.auth = new GoogleAuthClient(config);
    }
  }

  private async getUrl(model: string, action: string): Promise<string> {
    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

    if (this.apiKeyManager.hasKey()) {
      return `${baseUrl}/models/${model}:${action}?key=${this.apiKeyManager.getKey()}`;
    }

    return `${baseUrl}/models/${model}:${action}`;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    if (this.apiKeyManager.hasKey()) {
      return { 'Content-Type': 'application/json' };
    }

    if (this.auth?.isAuthenticated()) {
      return this.auth.getGeminiHeaders();
    }

    throw new Error('No authentication available');
  }

  async generateContent(model: string, prompt: string | Array<{ role: string; parts: Array<{ text: string }> }>, options: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
  } = {}): Promise<string> {
    const url = await this.getUrl(model, 'generateContent');
    const headers = await this.getHeaders();

    const contents = typeof prompt === 'string'
      ? [{ parts: [{ text: prompt }] }]
      : prompt;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: options.maxOutputTokens,
          temperature: options.temperature,
          topP: options.topP,
          topK: options.topK,
          stopSequences: options.stopSequences,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      candidates: Array<{
        content: { parts: Array<{ text: string }> };
      }>;
    };

    return data.candidates[0]?.content?.parts?.[0]?.text || '';
  }
}
