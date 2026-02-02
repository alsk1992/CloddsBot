/**
 * Storage Service - File storage for agents
 *
 * Key-value storage with optional TTL, backed by local filesystem or S3
 */

import { mkdir, readFile, writeFile, unlink, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger';
import type {
  ComputeRequest,
  StorageRequest,
  StorageResponse,
} from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface StorageService {
  /** Execute storage operation */
  execute(request: ComputeRequest): Promise<StorageResponse>;
  /** Put data */
  put(key: string, content: string | Buffer, options?: PutOptions): Promise<StorageResponse>;
  /** Get data */
  get(key: string): Promise<StorageResponse>;
  /** Delete data */
  delete(key: string): Promise<StorageResponse>;
  /** List keys */
  list(prefix?: string): Promise<StorageResponse>;
  /** Get storage stats */
  getStats(wallet: string): Promise<StorageStats>;
}

export interface StorageServiceConfig {
  /** Storage backend: 'local' | 's3' (default: 'local') */
  backend?: 'local' | 's3';
  /** Local storage directory */
  localDir?: string;
  /** S3 bucket name */
  s3Bucket?: string;
  /** S3 region */
  s3Region?: string;
  /** Max file size in bytes (default: 10MB) */
  maxFileSize?: number;
  /** Max storage per wallet in bytes (default: 100MB) */
  maxStoragePerWallet?: number;
  /** Public URL prefix for files */
  publicUrlPrefix?: string;
}

export interface PutOptions {
  contentType?: string;
  ttl?: number;
  public?: boolean;
}

export interface StorageStats {
  wallet: string;
  usedBytes: number;
  fileCount: number;
  quota: number;
}

interface StorageMetadata {
  key: string;
  wallet: string;
  size: number;
  contentType: string;
  createdAt: number;
  expiresAt?: number;
  public: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<StorageServiceConfig> = {
  backend: 'local',
  localDir: '/tmp/clodds-storage',
  s3Bucket: '',
  s3Region: 'us-east-1',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxStoragePerWallet: 100 * 1024 * 1024, // 100MB
  publicUrlPrefix: '',
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createStorageService(config: StorageServiceConfig = {}): StorageService {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // In-memory metadata index
  const metadata = new Map<string, StorageMetadata>();
  const walletUsage = new Map<string, number>();

  function getFilePath(wallet: string, key: string): string {
    // Hash the key to create a safe filename
    const hash = createHash('sha256').update(`${wallet}:${key}`).digest('hex');
    const walletHash = createHash('sha256').update(wallet).digest('hex').slice(0, 16);
    return join(cfg.localDir, walletHash, hash);
  }

  function getMetadataPath(wallet: string, key: string): string {
    return getFilePath(wallet, key) + '.meta';
  }

  async function ensureDir(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
  }

  async function execute(request: ComputeRequest): Promise<StorageResponse> {
    const payload = request.payload as StorageRequest;
    const { operation, key } = payload;
    const wallet = request.wallet;

    logger.info({
      requestId: request.id,
      operation,
      key,
      wallet,
    }, 'Executing storage operation');

    switch (operation) {
      case 'put':
        return put(key, payload.content || '', {
          contentType: payload.contentType,
          ttl: payload.ttl,
        }, wallet);
      case 'get':
        return get(key, wallet);
      case 'delete':
        return deleteKey(key, wallet);
      case 'list':
        return list(key, wallet);
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  async function put(
    key: string,
    content: string | Buffer,
    options: PutOptions = {},
    wallet?: string
  ): Promise<StorageResponse> {
    if (!wallet) {
      throw new Error('Wallet required for storage operations');
    }

    const contentBuffer = typeof content === 'string' ? Buffer.from(content) : content;
    const size = contentBuffer.length;

    // Check file size
    if (size > cfg.maxFileSize) {
      return {
        success: false,
        key,
        size,
      };
    }

    // Check wallet quota
    const currentUsage = walletUsage.get(wallet) || 0;
    if (currentUsage + size > cfg.maxStoragePerWallet) {
      return {
        success: false,
        key,
        size,
      };
    }

    const filePath = getFilePath(wallet, key);
    const metaPath = getMetadataPath(wallet, key);

    try {
      await ensureDir(filePath);

      // Write content
      await writeFile(filePath, contentBuffer);

      // Create metadata
      const meta: StorageMetadata = {
        key,
        wallet,
        size,
        contentType: options.contentType || 'application/octet-stream',
        createdAt: Date.now(),
        expiresAt: options.ttl ? Date.now() + options.ttl * 1000 : undefined,
        public: options.public || false,
      };

      // Write metadata
      await writeFile(metaPath, JSON.stringify(meta));

      // Update in-memory index
      const metaKey = `${wallet}:${key}`;
      const oldMeta = metadata.get(metaKey);
      if (oldMeta) {
        walletUsage.set(wallet, (walletUsage.get(wallet) || 0) - oldMeta.size);
      }
      metadata.set(metaKey, meta);
      walletUsage.set(wallet, (walletUsage.get(wallet) || 0) + size);

      // Generate public URL if applicable
      let url: string | undefined;
      if (meta.public && cfg.publicUrlPrefix) {
        url = `${cfg.publicUrlPrefix}/${wallet}/${key}`;
      }

      logger.info({
        key,
        wallet,
        size,
        public: meta.public,
      }, 'File stored');

      return {
        success: true,
        key,
        size,
        url,
      };
    } catch (error) {
      logger.error({ error, key, wallet }, 'Storage put failed');
      return {
        success: false,
        key,
      };
    }
  }

  async function get(key: string, wallet?: string): Promise<StorageResponse> {
    if (!wallet) {
      throw new Error('Wallet required for storage operations');
    }

    const filePath = getFilePath(wallet, key);
    const metaPath = getMetadataPath(wallet, key);

    try {
      // Read metadata first
      const metaContent = await readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaContent) as StorageMetadata;

      // Check expiration
      if (meta.expiresAt && Date.now() > meta.expiresAt) {
        // File expired, delete it
        await deleteKey(key, wallet);
        return {
          success: false,
          key,
        };
      }

      // Read content
      const content = await readFile(filePath, 'utf-8');

      return {
        success: true,
        key,
        content,
        size: meta.size,
      };
    } catch (error) {
      return {
        success: false,
        key,
      };
    }
  }

  async function deleteKey(key: string, wallet?: string): Promise<StorageResponse> {
    if (!wallet) {
      throw new Error('Wallet required for storage operations');
    }

    const filePath = getFilePath(wallet, key);
    const metaPath = getMetadataPath(wallet, key);
    const metaKey = `${wallet}:${key}`;

    try {
      // Get metadata for usage tracking
      const meta = metadata.get(metaKey);
      if (meta) {
        walletUsage.set(wallet, (walletUsage.get(wallet) || 0) - meta.size);
        metadata.delete(metaKey);
      }

      // Delete files
      await unlink(filePath).catch(() => {});
      await unlink(metaPath).catch(() => {});

      logger.info({ key, wallet }, 'File deleted');

      return {
        success: true,
        key,
      };
    } catch (error) {
      return {
        success: false,
        key,
      };
    }
  }

  async function list(prefix?: string, wallet?: string): Promise<StorageResponse> {
    if (!wallet) {
      throw new Error('Wallet required for storage operations');
    }

    const keys: string[] = [];

    // Scan metadata for this wallet
    for (const [metaKey, meta] of metadata.entries()) {
      if (meta.wallet !== wallet) continue;

      // Check expiration
      if (meta.expiresAt && Date.now() > meta.expiresAt) {
        // Clean up expired file
        await deleteKey(meta.key, wallet);
        continue;
      }

      // Check prefix filter
      if (prefix && !meta.key.startsWith(prefix)) continue;

      keys.push(meta.key);
    }

    return {
      success: true,
      key: prefix || '',
      keys,
    };
  }

  async function getStats(wallet: string): Promise<StorageStats> {
    let usedBytes = 0;
    let fileCount = 0;

    for (const [_, meta] of metadata.entries()) {
      if (meta.wallet !== wallet) continue;

      // Skip expired
      if (meta.expiresAt && Date.now() > meta.expiresAt) continue;

      usedBytes += meta.size;
      fileCount++;
    }

    return {
      wallet,
      usedBytes,
      fileCount,
      quota: cfg.maxStoragePerWallet,
    };
  }

  // Cleanup expired files periodically
  async function cleanupExpired(): Promise<void> {
    const now = Date.now();
    const toDelete: Array<{ key: string; wallet: string }> = [];

    for (const [_, meta] of metadata.entries()) {
      if (meta.expiresAt && now > meta.expiresAt) {
        toDelete.push({ key: meta.key, wallet: meta.wallet });
      }
    }

    for (const { key, wallet } of toDelete) {
      await deleteKey(key, wallet);
    }

    if (toDelete.length > 0) {
      logger.info({ count: toDelete.length }, 'Cleaned up expired files');
    }
  }

  // Run cleanup every 5 minutes
  setInterval(cleanupExpired, 5 * 60 * 1000);

  return {
    execute,
    put: (key, content, options) => put(key, content, options, undefined),
    get: (key) => get(key, undefined),
    delete: (key) => deleteKey(key, undefined),
    list: (prefix) => list(prefix, undefined),
    getStats,
  };
}
