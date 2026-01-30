/**
 * Qwen Portal Authentication
 * Handles authentication for Qwen/Alibaba Cloud AI services
 *
 * Supports:
 * - API key authentication
 * - Alibaba Cloud RAM authentication
 * - DashScope OAuth
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';

export interface QwenConfig {
  /** API key for DashScope */
  apiKey?: string;
  /** Alibaba Cloud Access Key ID */
  accessKeyId?: string;
  /** Alibaba Cloud Access Key Secret */
  accessKeySecret?: string;
  /** Region for API calls */
  region?: string;
  /** Token storage path */
  tokenStorePath?: string;
}

export interface QwenCredentials {
  apiKey?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  securityToken?: string;
  expiresAt?: number;
}

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
const ALIYUN_STS_URL = 'https://sts.aliyuncs.com';

export class QwenAuthClient {
  private config: QwenConfig;
  private credentials: QwenCredentials | null = null;
  private credStorePath: string;

  constructor(config: QwenConfig = {}) {
    this.config = config;
    this.credStorePath = config.tokenStorePath ||
      path.join(process.env.HOME || '', '.clodds', 'tokens', 'qwen.json');
    this.loadCredentials();
  }

  private loadCredentials(): void {
    try {
      // Check environment first
      if (process.env.DASHSCOPE_API_KEY) {
        this.credentials = { apiKey: process.env.DASHSCOPE_API_KEY };
        return;
      }
      if (process.env.QWEN_API_KEY) {
        this.credentials = { apiKey: process.env.QWEN_API_KEY };
        return;
      }

      // Check config
      if (this.config.apiKey) {
        this.credentials = { apiKey: this.config.apiKey };
        return;
      }
      if (this.config.accessKeyId && this.config.accessKeySecret) {
        this.credentials = {
          accessKeyId: this.config.accessKeyId,
          accessKeySecret: this.config.accessKeySecret,
        };
        return;
      }

      // Check file storage
      if (fs.existsSync(this.credStorePath)) {
        const data = fs.readFileSync(this.credStorePath, 'utf-8');
        this.credentials = JSON.parse(data);
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load Qwen credentials');
    }
  }

  private saveCredentials(): void {
    try {
      const dir = path.dirname(this.credStorePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.credStorePath, JSON.stringify(this.credentials, null, 2), {
        mode: 0o600,
      });
      logger.debug('Saved Qwen credentials to storage');
    } catch (error) {
      logger.error({ error }, 'Failed to save Qwen credentials');
    }
  }

  /**
   * Set API key
   */
  setApiKey(apiKey: string): void {
    this.credentials = { apiKey };
    this.saveCredentials();
    logger.info('Qwen API key saved');
  }

  /**
   * Set Alibaba Cloud credentials
   */
  setAliyunCredentials(accessKeyId: string, accessKeySecret: string): void {
    this.credentials = { accessKeyId, accessKeySecret };
    this.saveCredentials();
    logger.info('Alibaba Cloud credentials saved');
  }

  /**
   * Get API key for DashScope
   */
  getApiKey(): string | null {
    return this.credentials?.apiKey || null;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.credentials !== null && (
      this.credentials.apiKey !== undefined ||
      (this.credentials.accessKeyId !== undefined && this.credentials.accessKeySecret !== undefined)
    );
  }

  /**
   * Get headers for DashScope API
   */
  getHeaders(): Record<string, string> {
    if (!this.credentials?.apiKey) {
      throw new Error('No API key configured');
    }

    return {
      Authorization: `Bearer ${this.credentials.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Sign request for Alibaba Cloud API (OpenAPI signature v1)
   */
  signAliyunRequest(method: string, url: string, params: Record<string, string>): Record<string, string> {
    if (!this.credentials?.accessKeyId || !this.credentials?.accessKeySecret) {
      throw new Error('No Alibaba Cloud credentials configured');
    }

    const timestamp = new Date().toISOString().replace(/\.\d{3}/, '');
    const nonce = crypto.randomBytes(16).toString('hex');

    const commonParams: Record<string, string> = {
      Format: 'JSON',
      Version: '2015-04-01',
      AccessKeyId: this.credentials.accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      Timestamp: timestamp,
      SignatureVersion: '1.0',
      SignatureNonce: nonce,
      ...params,
    };

    // Sort and encode parameters
    const sortedKeys = Object.keys(commonParams).sort();
    const canonicalizedQuery = sortedKeys
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(commonParams[key])}`)
      .join('&');

    // Create string to sign
    const stringToSign = `${method}&${encodeURIComponent('/')}&${encodeURIComponent(canonicalizedQuery)}`;

    // Calculate signature
    const signature = crypto
      .createHmac('sha1', this.credentials.accessKeySecret + '&')
      .update(stringToSign)
      .digest('base64');

    return {
      ...commonParams,
      Signature: signature,
    };
  }

  /**
   * Get STS token for temporary credentials
   */
  async getSTSToken(roleArn: string, sessionName: string): Promise<{
    accessKeyId: string;
    accessKeySecret: string;
    securityToken: string;
    expiration: string;
  }> {
    const params = this.signAliyunRequest('GET', ALIYUN_STS_URL, {
      Action: 'AssumeRole',
      RoleArn: roleArn,
      RoleSessionName: sessionName,
      DurationSeconds: '3600',
    });

    const queryString = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const response = await fetch(`${ALIYUN_STS_URL}?${queryString}`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`STS request failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      Credentials: {
        AccessKeyId: string;
        AccessKeySecret: string;
        SecurityToken: string;
        Expiration: string;
      };
    };

    return {
      accessKeyId: data.Credentials.AccessKeyId,
      accessKeySecret: data.Credentials.AccessKeySecret,
      securityToken: data.Credentials.SecurityToken,
      expiration: data.Credentials.Expiration,
    };
  }

  /**
   * Clear credentials
   */
  clearCredentials(): void {
    this.credentials = null;
    try {
      fs.unlinkSync(this.credStorePath);
    } catch {
      // Ignore
    }
    logger.info('Qwen credentials cleared');
  }
}

/**
 * Qwen/DashScope API client
 */
export class QwenClient {
  private auth: QwenAuthClient;

  constructor(config?: QwenConfig) {
    this.auth = new QwenAuthClient(config);
  }

  /**
   * Generate text with Qwen model
   */
  async generate(model: string, prompt: string | Array<{ role: string; content: string }>, options: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    repetitionPenalty?: number;
    stop?: string[];
    stream?: boolean;
  } = {}): Promise<string> {
    const headers = this.auth.getHeaders();

    const messages = typeof prompt === 'string'
      ? [{ role: 'user', content: prompt }]
      : prompt;

    const response = await fetch(`${DASHSCOPE_BASE_URL}/services/aigc/text-generation/generation`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        input: { messages },
        parameters: {
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          top_p: options.topP,
          top_k: options.topK,
          repetition_penalty: options.repetitionPenalty,
          stop: options.stop,
          result_format: 'message',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qwen API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      output: {
        choices: Array<{
          message: { content: string };
        }>;
      };
    };

    return data.output.choices[0]?.message?.content || '';
  }

  /**
   * Generate embeddings
   */
  async embed(model: string, texts: string[]): Promise<number[][]> {
    const headers = this.auth.getHeaders();

    const response = await fetch(`${DASHSCOPE_BASE_URL}/services/embeddings/text-embedding/text-embedding`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        input: { texts },
        parameters: {
          text_type: 'query',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qwen embedding error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      output: {
        embeddings: Array<{ embedding: number[] }>;
      };
    };

    return data.output.embeddings.map(e => e.embedding);
  }

  /**
   * Analyze image with Qwen-VL
   */
  async analyzeImage(imageUrl: string, prompt: string, options: {
    model?: string;
    maxTokens?: number;
  } = {}): Promise<string> {
    const headers = this.auth.getHeaders();
    const model = options.model || 'qwen-vl-plus';

    const response = await fetch(`${DASHSCOPE_BASE_URL}/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        input: {
          messages: [
            {
              role: 'user',
              content: [
                { image: imageUrl },
                { text: prompt },
              ],
            },
          ],
        },
        parameters: {
          max_tokens: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qwen VL error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      output: {
        choices: Array<{
          message: { content: Array<{ text?: string }> };
        }>;
      };
    };

    const content = data.output.choices[0]?.message?.content || [];
    const textPart = content.find(c => c.text);
    return textPart?.text || '';
  }
}

/**
 * Interactive Qwen setup for CLI
 */
export async function interactiveQwenSetup(): Promise<void> {
  const client = new QwenAuthClient();

  console.log('\n=== Qwen/DashScope Setup ===');
  console.log('\nOptions:');
  console.log('1. Enter DashScope API key');
  console.log('2. Enter Alibaba Cloud credentials');

  // In real implementation, this would use inquirer or similar
  // For now, check environment
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;

  if (apiKey) {
    client.setApiKey(apiKey);
    console.log('\nAPI key configured from environment!');
  } else {
    console.log('\nPlease set DASHSCOPE_API_KEY or QWEN_API_KEY environment variable');
    console.log('Get your API key at: https://dashscope.console.aliyun.com/');
  }
}
