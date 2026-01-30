/**
 * Security Module - Clawdbot-style security and access control
 *
 * Features:
 * - DM pairing for authentication
 * - User allowlists and blocklists
 * - Sandbox mode for untrusted input
 * - Rate limiting
 * - Input sanitization
 * - Token/secret management
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv, scrypt } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const scryptAsync = promisify(scrypt);

// =============================================================================
// TYPES
// =============================================================================

export interface SecurityConfig {
  /** Enable DM pairing requirement */
  requireDmPairing?: boolean;
  /** Allowed user IDs */
  allowlist?: string[];
  /** Blocked user IDs */
  blocklist?: string[];
  /** Enable sandbox mode */
  sandbox?: boolean;
  /** Rate limit config */
  rateLimit?: RateLimitConfig;
  /** Secret encryption key (from env) */
  encryptionKey?: string;
}

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Per-user limits */
  perUser?: boolean;
}

export interface PairingCode {
  code: string;
  userId: string;
  expiresAt: Date;
  used: boolean;
}

export interface AuthResult {
  allowed: boolean;
  reason?: string;
  userId?: string;
}

export interface SanitizeOptions {
  maxLength?: number;
  allowHtml?: boolean;
  allowUrls?: boolean;
  allowCode?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_EXPIRY = 5 * 60 * 1000; // 5 minutes
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

// =============================================================================
// PAIRING SYSTEM
// =============================================================================

export class PairingManager {
  private codes: Map<string, PairingCode> = new Map();
  private pairedUsers: Set<string> = new Set();
  private storePath: string;

  constructor(storePath?: string) {
    this.storePath = storePath || join(homedir(), '.clodds', 'paired-users.json');
    this.loadPairedUsers();
  }

  private loadPairedUsers(): void {
    try {
      if (existsSync(this.storePath)) {
        const data = JSON.parse(readFileSync(this.storePath, 'utf-8'));
        this.pairedUsers = new Set(data.users || []);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load paired users');
    }
  }

  private savePairedUsers(): void {
    try {
      const dir = join(this.storePath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.storePath, JSON.stringify({
        users: Array.from(this.pairedUsers),
        updated: new Date().toISOString(),
      }, null, 2));
    } catch (error) {
      logger.error({ error }, 'Failed to save paired users');
    }
  }

  /** Generate a pairing code for a user */
  generateCode(userId: string): string {
    // Clean up expired codes
    this.cleanupExpired();

    // Generate random code
    const code = randomBytes(3).toString('hex').toUpperCase().slice(0, PAIRING_CODE_LENGTH);

    this.codes.set(code, {
      code,
      userId,
      expiresAt: new Date(Date.now() + PAIRING_CODE_EXPIRY),
      used: false,
    });

    logger.info({ userId, code }, 'Pairing code generated');
    return code;
  }

  /** Verify a pairing code */
  verifyCode(code: string, userId: string): { valid: boolean; reason?: string } {
    const pairing = this.codes.get(code.toUpperCase());

    if (!pairing) {
      return { valid: false, reason: 'Invalid code' };
    }

    if (pairing.used) {
      return { valid: false, reason: 'Code already used' };
    }

    if (pairing.expiresAt < new Date()) {
      this.codes.delete(code);
      return { valid: false, reason: 'Code expired' };
    }

    if (pairing.userId !== userId) {
      return { valid: false, reason: 'Code does not match user' };
    }

    // Mark as used and pair user
    pairing.used = true;
    this.pairedUsers.add(userId);
    this.savePairedUsers();

    logger.info({ userId }, 'User paired successfully');
    return { valid: true };
  }

  /** Check if a user is paired */
  isPaired(userId: string): boolean {
    return this.pairedUsers.has(userId);
  }

  /** Unpair a user */
  unpair(userId: string): void {
    this.pairedUsers.delete(userId);
    this.savePairedUsers();
    logger.info({ userId }, 'User unpaired');
  }

  /** Get all paired users */
  getPairedUsers(): string[] {
    return Array.from(this.pairedUsers);
  }

  private cleanupExpired(): void {
    const now = new Date();
    for (const [code, pairing] of this.codes) {
      if (pairing.expiresAt < now || pairing.used) {
        this.codes.delete(code);
      }
    }
  }
}

// =============================================================================
// ACCESS CONTROL
// =============================================================================

export class AccessControl {
  private allowlist: Set<string>;
  private blocklist: Set<string>;
  private pairingManager: PairingManager;
  private requirePairing: boolean;

  constructor(config: SecurityConfig = {}) {
    this.allowlist = new Set(config.allowlist || []);
    this.blocklist = new Set(config.blocklist || []);
    this.requirePairing = config.requireDmPairing ?? false;
    this.pairingManager = new PairingManager();
  }

  /** Check if a user is allowed */
  checkAccess(userId: string): AuthResult {
    // Check blocklist first
    if (this.blocklist.has(userId)) {
      return { allowed: false, reason: 'User is blocked', userId };
    }

    // Check allowlist (if non-empty, only allowlisted users allowed)
    if (this.allowlist.size > 0 && !this.allowlist.has(userId)) {
      return { allowed: false, reason: 'User not in allowlist', userId };
    }

    // Check pairing requirement
    if (this.requirePairing && !this.pairingManager.isPaired(userId)) {
      return { allowed: false, reason: 'User not paired', userId };
    }

    return { allowed: true, userId };
  }

  /** Add user to allowlist */
  allow(userId: string): void {
    this.allowlist.add(userId);
    this.blocklist.delete(userId);
    logger.info({ userId }, 'User added to allowlist');
  }

  /** Add user to blocklist */
  block(userId: string): void {
    this.blocklist.add(userId);
    this.allowlist.delete(userId);
    logger.info({ userId }, 'User added to blocklist');
  }

  /** Remove user from all lists */
  reset(userId: string): void {
    this.allowlist.delete(userId);
    this.blocklist.delete(userId);
  }

  /** Get pairing manager */
  getPairingManager(): PairingManager {
    return this.pairingManager;
  }
}

// =============================================================================
// RATE LIMITING
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /** Check if request is allowed */
  check(key: string): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    let entry = this.limits.get(key);

    // Clean up or create new entry
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.config.windowMs };
      this.limits.set(key, entry);
    }

    const remaining = Math.max(0, this.config.maxRequests - entry.count);
    const resetIn = Math.max(0, entry.resetAt - now);

    if (entry.count >= this.config.maxRequests) {
      return { allowed: false, remaining: 0, resetIn };
    }

    entry.count++;
    return { allowed: true, remaining: remaining - 1, resetIn };
  }

  /** Reset rate limit for a key */
  reset(key: string): void {
    this.limits.delete(key);
  }

  /** Cleanup expired entries */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits) {
      if (entry.resetAt <= now) {
        this.limits.delete(key);
      }
    }
  }
}

// =============================================================================
// INPUT SANITIZATION
// =============================================================================

/** Sanitize user input */
export function sanitize(input: string, options: SanitizeOptions = {}): string {
  let result = input;

  // Truncate if needed
  if (options.maxLength && result.length > options.maxLength) {
    result = result.slice(0, options.maxLength);
  }

  // Strip HTML unless allowed
  if (!options.allowHtml) {
    result = result.replace(/<[^>]*>/g, '');
  }

  // Strip URLs unless allowed
  if (!options.allowUrls) {
    result = result.replace(/https?:\/\/[^\s]+/gi, '[URL]');
  }

  // Strip code blocks unless allowed
  if (!options.allowCode) {
    result = result.replace(/```[\s\S]*?```/g, '[CODE]');
    result = result.replace(/`[^`]+`/g, '[CODE]');
  }

  // Remove null bytes and other dangerous chars
  result = result.replace(/\0/g, '');

  // Normalize whitespace
  result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return result.trim();
}

/** Check for potential injection attacks */
export function detectInjection(input: string): { safe: boolean; threats: string[] } {
  const threats: string[] = [];

  // SQL injection patterns
  const sqlPatterns = [
    /'\s*(?:OR|AND)\s*'?\d*'?\s*=\s*'?\d*'?/i,
    /;\s*(?:DROP|DELETE|UPDATE|INSERT)\s/i,
    /UNION\s+(?:ALL\s+)?SELECT/i,
  ];

  for (const pattern of sqlPatterns) {
    if (pattern.test(input)) {
      threats.push('SQL injection');
      break;
    }
  }

  // Command injection patterns
  const cmdPatterns = [
    /[;&|`$]|\$\(/,
    /\|\s*(?:cat|ls|rm|wget|curl)\s/i,
  ];

  for (const pattern of cmdPatterns) {
    if (pattern.test(input)) {
      threats.push('Command injection');
      break;
    }
  }

  // XSS patterns
  const xssPatterns = [
    /<script[\s>]/i,
    /javascript:/i,
    /on\w+\s*=/i,
  ];

  for (const pattern of xssPatterns) {
    if (pattern.test(input)) {
      threats.push('XSS');
      break;
    }
  }

  // Path traversal
  if (/\.\.\/|\.\.\\/.test(input)) {
    threats.push('Path traversal');
  }

  return { safe: threats.length === 0, threats };
}

// =============================================================================
// SECRET MANAGEMENT
// =============================================================================

export class SecretStore {
  private secrets: Map<string, string> = new Map();
  private encryptionKey: Buffer | null = null;
  private storePath: string;

  constructor(encryptionKey?: string, storePath?: string) {
    this.storePath = storePath || join(homedir(), '.clodds', 'secrets.enc');

    if (encryptionKey) {
      this.initEncryption(encryptionKey);
    }

    this.load();
  }

  private async initEncryption(password: string): Promise<void> {
    // Derive key from password
    const salt = 'clodds-secrets-v1';
    this.encryptionKey = (await scryptAsync(password, salt, 32)) as Buffer;
  }

  private encrypt(text: string): string {
    if (!this.encryptionKey) return text;

    const iv = randomBytes(16);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(encrypted: string): string {
    if (!this.encryptionKey) return encrypted;

    const [ivHex, authTagHex, content] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(content, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private load(): void {
    try {
      if (existsSync(this.storePath)) {
        const data = readFileSync(this.storePath, 'utf-8');
        const parsed = JSON.parse(data);

        for (const [key, value] of Object.entries(parsed.secrets || {})) {
          try {
            this.secrets.set(key, this.decrypt(value as string));
          } catch {
            // Skip secrets we can't decrypt
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load secrets');
    }
  }

  private save(): void {
    try {
      const dir = join(this.storePath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const encrypted: Record<string, string> = {};
      for (const [key, value] of this.secrets) {
        encrypted[key] = this.encrypt(value);
      }

      writeFileSync(this.storePath, JSON.stringify({
        secrets: encrypted,
        updated: new Date().toISOString(),
      }, null, 2), { mode: 0o600 });
    } catch (error) {
      logger.error({ error }, 'Failed to save secrets');
    }
  }

  /** Store a secret */
  set(key: string, value: string): void {
    this.secrets.set(key, value);
    this.save();
  }

  /** Get a secret */
  get(key: string): string | undefined {
    return this.secrets.get(key);
  }

  /** Delete a secret */
  delete(key: string): void {
    this.secrets.delete(key);
    this.save();
  }

  /** List all secret keys */
  keys(): string[] {
    return Array.from(this.secrets.keys());
  }
}

// =============================================================================
// SANDBOX
// =============================================================================

export interface SandboxOptions {
  allowNetwork?: boolean;
  allowFileSystem?: boolean;
  allowedModules?: string[];
  timeout?: number;
  memoryLimit?: number;
}

/**
 * Create a sandboxed execution context (LIMITED IMPLEMENTATION)
 *
 * ⚠️  SECURITY WARNING: This sandbox is NOT secure against malicious code!
 * It only provides basic isolation and can be escaped.
 *
 * For production use with untrusted code, use:
 * - `isolated-vm` package (V8 isolates)
 * - `vm2` package (more secure VM)
 * - Docker containers
 *
 * This implementation is suitable for:
 * - Running trusted code with limited scope
 * - Development/testing environments
 * - Code that has already been validated
 */
export function createSandbox(options: SandboxOptions = {}): {
  eval: (code: string) => unknown;
  require: (module: string) => unknown;
} {
  const allowedModules = new Set(options.allowedModules || []);

  // Log warning if used in production
  if (process.env.NODE_ENV === 'production') {
    logger.warn('createSandbox: Using basic sandbox in production - NOT secure against malicious code');
  }

  return {
    eval(code: string): unknown {
      // ⚠️ SECURITY: This is NOT a secure sandbox - new Function can be escaped
      const sandbox = {
        console: {
          log: (...args: unknown[]) => logger.info({ sandbox: true }, String(args)),
          error: (...args: unknown[]) => logger.error({ sandbox: true }, String(args)),
        },
        setTimeout: undefined,
        setInterval: undefined,
        fetch: options.allowNetwork ? fetch : undefined,
        require: undefined,
        process: undefined,
        __dirname: undefined,
        __filename: undefined,
      };

      // Create function with restricted scope
      const fn = new Function(...Object.keys(sandbox), `"use strict"; return (${code})`);
      return fn(...Object.values(sandbox));
    },

    require(module: string): unknown {
      if (!allowedModules.has(module)) {
        throw new Error(`Module '${module}' not allowed in sandbox`);
      }
      return require(module);
    },
  };
}

// =============================================================================
// HASHING UTILITIES
// =============================================================================

/** Hash a string with SHA-256 */
export function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Hash a password with salt */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

/** Verify a password hash */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return key.toString('hex') === hash;
}

/** Generate a secure random token */
export function generateToken(length = 32): string {
  return randomBytes(length).toString('hex');
}

// =============================================================================
// EXPORTS
// =============================================================================

export const pairing = new PairingManager();
export const access = new AccessControl();
