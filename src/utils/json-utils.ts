/**
 * Safe JSON Parsing Utilities
 *
 * Provides type-safe JSON parsing with Zod validation and error handling.
 */

import { z, ZodSchema, ZodError } from 'zod';
import { logger } from './logger';

// =============================================================================
// TYPES
// =============================================================================

export interface SafeParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  raw?: unknown;
}

// =============================================================================
// SAFE JSON PARSING
// =============================================================================

/**
 * Parse JSON string safely with optional Zod schema validation
 *
 * @param jsonString - The JSON string to parse
 * @param schema - Optional Zod schema for validation
 * @param options - Parsing options
 * @returns ParseResult with either data or error
 */
export function safeJsonParse<T>(
  jsonString: string,
  schema?: ZodSchema<T>,
  options: {
    logErrors?: boolean;
    context?: string;
  } = {}
): SafeParseResult<T> {
  const { logErrors = true, context = 'JSON parse' } = options;

  // Step 1: Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    if (logErrors) {
      logger.warn({ error: message, context, preview: jsonString.slice(0, 100) }, 'JSON parse failed');
    }
    return { success: false, error: `JSON parse error: ${message}` };
  }

  // Step 2: Validate with schema if provided
  if (schema) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const zodError = result.error as ZodError;
      const issues = zodError.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      if (logErrors) {
        logger.warn({ context, issues }, 'JSON schema validation failed');
      }
      return { success: false, error: `Validation error: ${issues}`, raw: parsed };
    }
    return { success: true, data: result.data };
  }

  // No schema - return raw parsed data
  return { success: true, data: parsed as T, raw: parsed };
}

/**
 * Parse JSON with schema, throwing on error
 *
 * @param jsonString - The JSON string to parse
 * @param schema - Zod schema for validation
 * @param context - Context for error messages
 * @returns Validated data
 * @throws Error if parsing or validation fails
 */
export function parseJsonOrThrow<T>(
  jsonString: string,
  schema: ZodSchema<T>,
  context = 'JSON'
): T {
  const result = safeJsonParse(jsonString, schema, { context });
  if (!result.success) {
    throw new Error(`${context}: ${result.error}`);
  }
  return result.data!;
}

/**
 * Parse JSON with default value on error
 *
 * @param jsonString - The JSON string to parse
 * @param defaultValue - Value to return on error
 * @param schema - Optional Zod schema for validation
 * @returns Parsed data or default value
 */
export function parseJsonWithDefault<T>(
  jsonString: string,
  defaultValue: T,
  schema?: ZodSchema<T>
): T {
  const result = safeJsonParse(jsonString, schema, { logErrors: false });
  return result.success ? result.data! : defaultValue;
}

// =============================================================================
// COMMON SCHEMAS
// =============================================================================

/** Schema for session storage data */
export const SessionStorageSchema = z.object({
  sessions: z.array(z.object({
    id: z.string(),
    channelId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    expiresAt: z.string().optional(),
    participants: z.array(z.object({
      id: z.string(),
      name: z.string().optional(),
      role: z.string().optional(),
      joinedAt: z.string(),
      lastSeen: z.string(),
    })),
    metadata: z.record(z.unknown()).optional(),
  })).optional().default([]),
});

/** Schema for Google token storage */
export const GoogleTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_at: z.number().optional(),
  token_type: z.string().optional(),
});

/** Schema for MCP tool response */
export const McpToolResponseSchema = z.object({
  content: z.array(z.object({
    type: z.string(),
    text: z.string().optional(),
  })).optional(),
  isError: z.boolean().optional(),
});

/** Schema for generic API response */
export const ApiResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if value is a valid JSON string
 */
export function isJsonString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if value is a plain object
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
