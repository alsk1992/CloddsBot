/**
 * OAuth Authentication Module
 * Handles OAuth 2.0 flows for Anthropic, OpenAI, and other providers
 *
 * Supports:
 * - Authorization Code + PKCE flow (browser)
 * - Device Code flow (CLI)
 * - Token refresh and storage
 */

import * as crypto from 'crypto';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface OAuthConfig {
  provider: 'anthropic' | 'openai' | 'google' | 'github' | 'azure';
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  redirectUri?: string;
  tokenStorePath?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

interface OAuthProviderConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  deviceCodeEndpoint?: string;
  revokeEndpoint?: string;
  userInfoEndpoint?: string;
}

const PROVIDER_CONFIGS: Record<string, OAuthProviderConfig> = {
  anthropic: {
    authorizationEndpoint: 'https://console.anthropic.com/oauth/authorize',
    tokenEndpoint: 'https://api.anthropic.com/oauth/token',
    deviceCodeEndpoint: 'https://api.anthropic.com/oauth/device/code',
    revokeEndpoint: 'https://api.anthropic.com/oauth/revoke',
  },
  openai: {
    authorizationEndpoint: 'https://auth.openai.com/authorize',
    tokenEndpoint: 'https://auth.openai.com/oauth/token',
    deviceCodeEndpoint: 'https://auth.openai.com/device/code',
    revokeEndpoint: 'https://auth.openai.com/oauth/revoke',
    userInfoEndpoint: 'https://api.openai.com/v1/me',
  },
  google: {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    deviceCodeEndpoint: 'https://oauth2.googleapis.com/device/code',
    revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
    userInfoEndpoint: 'https://www.googleapis.com/oauth2/v3/userinfo',
  },
  github: {
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    deviceCodeEndpoint: 'https://github.com/login/device/code',
    userInfoEndpoint: 'https://api.github.com/user',
  },
  azure: {
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    deviceCodeEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode',
    revokeEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/logout',
  },
};

export class OAuthClient {
  private config: OAuthConfig;
  private providerConfig: OAuthProviderConfig;
  private tokens: OAuthTokens | null = null;
  private tokenStorePath: string;

  constructor(config: OAuthConfig) {
    this.config = config;
    this.providerConfig = PROVIDER_CONFIGS[config.provider];
    if (!this.providerConfig) {
      throw new Error(`Unknown OAuth provider: ${config.provider}`);
    }

    this.tokenStorePath = config.tokenStorePath ||
      path.join(process.env.HOME || '', '.clodds', 'tokens', `${config.provider}.json`);

    this.loadTokens();
  }

  private loadTokens(): void {
    try {
      if (fs.existsSync(this.tokenStorePath)) {
        const data = fs.readFileSync(this.tokenStorePath, 'utf-8');
        this.tokens = JSON.parse(data);
        logger.debug({ provider: this.config.provider }, 'Loaded OAuth tokens from storage');
      }
    } catch (error) {
      logger.warn({ error, provider: this.config.provider }, 'Failed to load OAuth tokens');
    }
  }

  private saveTokens(): void {
    try {
      const dir = path.dirname(this.tokenStorePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.tokenStorePath, JSON.stringify(this.tokens, null, 2), {
        mode: 0o600, // Owner read/write only
      });
      logger.debug({ provider: this.config.provider }, 'Saved OAuth tokens to storage');
    } catch (error) {
      logger.error({ error, provider: this.config.provider }, 'Failed to save OAuth tokens');
    }
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  private generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Start Authorization Code + PKCE flow
   * Returns URL for user to authorize
   */
  async startAuthorizationFlow(port: number = 8765): Promise<{
    authUrl: string;
    codeVerifier: string;
    state: string;
  }> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const state = this.generateState();
    const redirectUri = this.config.redirectUri || `http://localhost:${port}/callback`;

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `${this.providerConfig.authorizationEndpoint}?${params}`;

    return { authUrl, codeVerifier, state };
  }

  /**
   * Complete Authorization Code flow by exchanging code for tokens
   */
  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    const response = await fetch(this.providerConfig.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
      scope?: string;
    };

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type,
      scope: data.scope,
    };

    this.saveTokens();
    logger.info({ provider: this.config.provider }, 'OAuth tokens obtained successfully');

    return this.tokens;
  }

  /**
   * Start Device Code flow (for CLI authentication)
   */
  async startDeviceCodeFlow(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    expiresIn: number;
    interval: number;
  }> {
    if (!this.providerConfig.deviceCodeEndpoint) {
      throw new Error(`Device code flow not supported for ${this.config.provider}`);
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      scope: this.config.scopes.join(' '),
    });

    const response = await fetch(this.providerConfig.deviceCodeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Device code request failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete?: string;
      expires_in: number;
      interval: number;
    };

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      verificationUriComplete: data.verification_uri_complete,
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  }

  /**
   * Poll for device code completion
   */
  async pollDeviceCode(deviceCode: string, interval: number): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: this.config.clientId,
      device_code: deviceCode,
    });

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    const startTime = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minute timeout

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, interval * 1000));

      const response = await fetch(this.providerConfig.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });

      const data = await response.json() as {
        error?: string;
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        token_type?: string;
        scope?: string;
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
          tokenType: data.token_type || 'Bearer',
          scope: data.scope,
        };

        this.saveTokens();
        logger.info({ provider: this.config.provider }, 'OAuth tokens obtained via device code');
        return this.tokens;
      }
    }

    throw new Error('Device code polling timed out');
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<OAuthTokens> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      refresh_token: this.tokens.refreshToken,
    });

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    const response = await fetch(this.providerConfig.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
      scope?: string;
    };

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.tokens.refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type,
      scope: data.scope,
    };

    this.saveTokens();
    logger.debug({ provider: this.config.provider }, 'OAuth tokens refreshed');

    return this.tokens;
  }

  /**
   * Get current access token, refreshing if expired
   */
  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      throw new Error('Not authenticated');
    }

    // Check if token is expired or about to expire (within 5 minutes)
    if (this.tokens.expiresAt && this.tokens.expiresAt - Date.now() < 5 * 60 * 1000) {
      if (this.tokens.refreshToken) {
        await this.refreshAccessToken();
      } else {
        throw new Error('Token expired and no refresh token available');
      }
    }

    return this.tokens.accessToken;
  }

  /**
   * Revoke tokens
   */
  async revokeTokens(): Promise<void> {
    if (!this.tokens || !this.providerConfig.revokeEndpoint) {
      return;
    }

    try {
      await fetch(this.providerConfig.revokeEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: this.tokens.accessToken,
          client_id: this.config.clientId,
        }).toString(),
      });
    } catch (error) {
      logger.warn({ error, provider: this.config.provider }, 'Failed to revoke token');
    }

    this.tokens = null;
    try {
      fs.unlinkSync(this.tokenStorePath);
    } catch {
      // Ignore
    }

    logger.info({ provider: this.config.provider }, 'OAuth tokens revoked');
  }

  /**
   * Check if currently authenticated
   */
  isAuthenticated(): boolean {
    return this.tokens !== null;
  }

  /**
   * Get user info (if supported by provider)
   */
  async getUserInfo(): Promise<Record<string, unknown> | null> {
    if (!this.providerConfig.userInfoEndpoint || !this.tokens) {
      return null;
    }

    const response = await fetch(this.providerConfig.userInfoEndpoint, {
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}

/**
 * Interactive OAuth flow for CLI
 */
export async function interactiveOAuth(config: OAuthConfig): Promise<OAuthTokens> {
  const client = new OAuthClient(config);

  // Try device code flow first (better for CLI)
  if (PROVIDER_CONFIGS[config.provider].deviceCodeEndpoint) {
    logger.info('Starting device code flow...');

    const deviceCode = await client.startDeviceCodeFlow();

    console.log('\n=== OAuth Authentication ===');
    console.log(`Open this URL in your browser:\n  ${deviceCode.verificationUri}`);
    console.log(`\nEnter this code: ${deviceCode.userCode}`);
    console.log('\nWaiting for authorization...');

    return client.pollDeviceCode(deviceCode.deviceCode, deviceCode.interval);
  }

  // Fall back to authorization code flow with local server
  const port = 8765;
  const { authUrl, codeVerifier, state } = await client.startAuthorizationFlow(port);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Authentication Failed</h1><p>${error}</p>`);
        server.close();
        reject(new Error(error));
        return;
      }

      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Failed</h1><p>State mismatch</p>');
        server.close();
        reject(new Error('State mismatch'));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Failed</h1><p>No code received</p>');
        server.close();
        reject(new Error('No code received'));
        return;
      }

      try {
        const tokens = await client.exchangeCode(code, codeVerifier, `http://localhost:${port}/callback`);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Successful!</h1><p>You can close this window.</p>');
        server.close();
        resolve(tokens);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>Authentication Failed</h1><p>${err}</p>`);
        server.close();
        reject(err);
      }
    });

    server.listen(port, () => {
      console.log('\n=== OAuth Authentication ===');
      console.log(`Open this URL in your browser:\n  ${authUrl}`);
      console.log('\nWaiting for authorization...');
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Create provider-specific OAuth client
 */
export function createAnthropicOAuth(clientId: string, clientSecret?: string): OAuthClient {
  return new OAuthClient({
    provider: 'anthropic',
    clientId,
    clientSecret,
    scopes: ['api:read', 'api:write'],
  });
}

export function createOpenAIOAuth(clientId: string, clientSecret?: string): OAuthClient {
  return new OAuthClient({
    provider: 'openai',
    clientId,
    clientSecret,
    scopes: ['openid', 'profile', 'email', 'model.read', 'model.request'],
  });
}

export function createGoogleOAuth(clientId: string, clientSecret?: string): OAuthClient {
  return new OAuthClient({
    provider: 'google',
    clientId,
    clientSecret,
    scopes: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/generative-language',
    ],
  });
}
