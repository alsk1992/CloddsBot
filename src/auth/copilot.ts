/**
 * GitHub Copilot Proxy Authentication
 * Handles authentication for Copilot API access
 *
 * Supports:
 * - Device code flow for GitHub OAuth
 * - Copilot token exchange
 * - Token refresh
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface CopilotConfig {
  /** GitHub OAuth client ID (for Copilot) */
  clientId?: string;
  /** Token storage path */
  tokenStorePath?: string;
}

export interface CopilotTokens {
  githubToken: string;
  copilotToken?: string;
  copilotExpiresAt?: number;
}

const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98'; // GitHub Copilot VS Code client ID
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const COPILOT_CHAT_TOKEN_URL = 'https://api.githubcopilot.com/v2/token';

export class CopilotAuthClient {
  private config: CopilotConfig;
  private tokens: CopilotTokens | null = null;
  private tokenStorePath: string;

  constructor(config: CopilotConfig = {}) {
    this.config = config;
    this.tokenStorePath = config.tokenStorePath ||
      path.join(process.env.HOME || '', '.clodds', 'tokens', 'copilot.json');
    this.loadTokens();
  }

  private loadTokens(): void {
    try {
      if (fs.existsSync(this.tokenStorePath)) {
        const data = fs.readFileSync(this.tokenStorePath, 'utf-8');
        this.tokens = JSON.parse(data);
        logger.debug('Loaded Copilot tokens from storage');
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load Copilot tokens');
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
      logger.debug('Saved Copilot tokens to storage');
    } catch (error) {
      logger.error({ error }, 'Failed to save Copilot tokens');
    }
  }

  /**
   * Start device code flow for GitHub authentication
   */
  async startDeviceCodeFlow(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
  }> {
    const clientId = this.config.clientId || COPILOT_CLIENT_ID;

    const response = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: 'read:user',
      }),
    });

    if (!response.ok) {
      throw new Error(`Device code request failed: ${response.status}`);
    }

    const data = await response.json() as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  }

  /**
   * Poll for device code completion
   */
  async pollDeviceCode(deviceCode: string, interval: number): Promise<string> {
    const clientId = this.config.clientId || COPILOT_CLIENT_ID;
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000;

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, interval * 1000));

      const response = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      const data = await response.json() as {
        error?: string;
        access_token?: string;
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
          githubToken: data.access_token,
        };
        this.saveTokens();
        logger.info('GitHub token obtained successfully');
        return data.access_token;
      }
    }

    throw new Error('Device code polling timed out');
  }

  /**
   * Exchange GitHub token for Copilot token
   */
  async getCopilotToken(): Promise<string> {
    if (!this.tokens?.githubToken) {
      throw new Error('Not authenticated with GitHub');
    }

    // Check if existing Copilot token is still valid
    if (this.tokens.copilotToken && this.tokens.copilotExpiresAt) {
      if (Date.now() < this.tokens.copilotExpiresAt - 60000) {
        return this.tokens.copilotToken;
      }
    }

    // Get new Copilot token
    const response = await fetch(COPILOT_TOKEN_URL, {
      method: 'GET',
      headers: {
        Authorization: `token ${this.tokens.githubToken}`,
        Accept: 'application/json',
        'Editor-Version': 'Clodds/1.0.0',
        'Editor-Plugin-Version': 'clodds/1.0.0',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        this.tokens = null;
        this.saveTokens();
        throw new Error('GitHub token invalid or expired');
      }
      throw new Error(`Copilot token request failed: ${response.status}`);
    }

    const data = await response.json() as {
      token: string;
      expires_at: number;
    };

    this.tokens.copilotToken = data.token;
    this.tokens.copilotExpiresAt = data.expires_at * 1000;
    this.saveTokens();

    logger.debug('Copilot token obtained');
    return data.token;
  }

  /**
   * Get Copilot Chat token (for chat completions)
   */
  async getCopilotChatToken(): Promise<string> {
    if (!this.tokens?.githubToken) {
      throw new Error('Not authenticated with GitHub');
    }

    const response = await fetch(COPILOT_CHAT_TOKEN_URL, {
      method: 'GET',
      headers: {
        Authorization: `token ${this.tokens.githubToken}`,
        Accept: 'application/json',
        'Editor-Version': 'Clodds/1.0.0',
        'Editor-Plugin-Version': 'clodds/1.0.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Copilot Chat token request failed: ${response.status}`);
    }

    const data = await response.json() as { token: string };
    return data.token;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.tokens?.githubToken !== undefined;
  }

  /**
   * Get headers for Copilot API requests
   */
  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getCopilotToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Editor-Version': 'Clodds/1.0.0',
      'Editor-Plugin-Version': 'clodds/1.0.0',
      'Copilot-Integration-Id': 'clodds',
      'OpenAI-Intent': 'conversation-agent',
    };
  }

  /**
   * Revoke tokens
   */
  async revokeTokens(): Promise<void> {
    this.tokens = null;
    try {
      fs.unlinkSync(this.tokenStorePath);
    } catch {
      // Ignore
    }
    logger.info('Copilot tokens revoked');
  }
}

/**
 * Interactive Copilot authentication for CLI
 */
export async function interactiveCopilotAuth(config?: CopilotConfig): Promise<CopilotTokens> {
  const client = new CopilotAuthClient(config);

  console.log('\n=== GitHub Copilot Authentication ===');

  const deviceCode = await client.startDeviceCodeFlow();

  console.log(`\nOpen this URL in your browser:\n  ${deviceCode.verificationUri}`);
  console.log(`\nEnter this code: ${deviceCode.userCode}`);
  console.log('\nWaiting for authorization...');

  const githubToken = await client.pollDeviceCode(deviceCode.deviceCode, deviceCode.interval);

  console.log('\nGitHub authentication successful!');
  console.log('Fetching Copilot token...');

  await client.getCopilotToken();

  console.log('Copilot authentication complete!');

  return {
    githubToken,
    copilotToken: client['tokens']?.copilotToken,
    copilotExpiresAt: client['tokens']?.copilotExpiresAt,
  };
}

/**
 * Copilot completion API wrapper
 */
export class CopilotCompletionClient {
  private auth: CopilotAuthClient;

  constructor(auth: CopilotAuthClient) {
    this.auth = auth;
  }

  async complete(prompt: string, options: {
    maxTokens?: number;
    temperature?: number;
    stop?: string[];
    suffix?: string;
  } = {}): Promise<string> {
    const headers = await this.auth.getHeaders();

    const response = await fetch('https://copilot-proxy.githubusercontent.com/v1/engines/copilot-codex/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        max_tokens: options.maxTokens || 500,
        temperature: options.temperature || 0,
        stop: options.stop,
        suffix: options.suffix,
        n: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`Copilot completion failed: ${response.status}`);
    }

    const data = await response.json() as {
      choices: Array<{ text: string }>;
    };

    return data.choices[0]?.text || '';
  }

  async chat(messages: Array<{ role: string; content: string }>, options: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
  } = {}): Promise<string> {
    const headers = await this.auth.getHeaders();

    const response = await fetch('https://api.githubcopilot.com/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.model || 'gpt-4o',
        messages,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.5,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Copilot chat failed: ${response.status}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0]?.message?.content || '';
  }
}
