/**
 * Logging Module - Clawdbot-style structured logging
 *
 * Features:
 * - Structured JSON logging
 * - Log levels (debug, info, warn, error)
 * - File rotation
 * - Context/child loggers
 * - Pretty console output
 */

import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, unlinkSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';

// =============================================================================
// TYPES
// =============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  msg: string;
  time: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  name?: string;
  file?: string | boolean;
  json?: boolean;
  pretty?: boolean;
  maxFileSize?: number;
  maxFiles?: number;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  debug(data: Record<string, unknown>, msg: string): void;
  info(msg: string, data?: Record<string, unknown>): void;
  info(data: Record<string, unknown>, msg: string): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  warn(data: Record<string, unknown>, msg: string): void;
  error(msg: string, data?: Record<string, unknown>): void;
  error(data: Record<string, unknown>, msg: string): void;
  child(bindings: Record<string, unknown>): Logger;
  setLevel(level: LogLevel): void;
  flush(): void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m', // Gray
  info: '\x1b[36m',  // Cyan
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_FILES = 5;

// =============================================================================
// HELPERS
// =============================================================================

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatPretty(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level];
  const levelStr = entry.level.toUpperCase().padEnd(5);
  const time = entry.time.split('T')[1].split('.')[0]; // HH:MM:SS

  // Extract data fields
  const { level, msg, time: _, ...data } = entry;
  const dataStr = Object.keys(data).length > 0
    ? ` ${DIM}${JSON.stringify(data)}${RESET}`
    : '';

  return `${DIM}${time}${RESET} ${color}${levelStr}${RESET} ${msg}${dataStr}`;
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function rotateLogFile(filePath: string, maxFiles: number): void {
  // Delete oldest
  const oldest = `${filePath}.${maxFiles}`;
  if (existsSync(oldest)) {
    try { unlinkSync(oldest); } catch {}
  }

  // Rotate existing
  for (let i = maxFiles - 1; i >= 1; i--) {
    const src = i === 1 ? filePath : `${filePath}.${i}`;
    const dst = `${filePath}.${i + 1}`;
    if (existsSync(src)) {
      try { renameSync(src, dst); } catch {}
    }
  }
}

function shouldRotate(filePath: string, maxSize: number): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const stats = statSync(filePath);
    return stats.size >= maxSize;
  } catch {
    return false;
  }
}

// =============================================================================
// LOGGER IMPLEMENTATION
// =============================================================================

export function createLogger(options: LoggerOptions = {}): Logger {
  let currentLevel = options.level || 'info';
  const name = options.name;
  const useJson = options.json ?? false;
  const usePretty = options.pretty ?? !useJson;
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  // Resolve file path
  let filePath: string | null = null;
  if (options.file) {
    if (typeof options.file === 'string') {
      filePath = options.file;
    } else {
      const logsDir = join(homedir(), '.clodds', 'logs');
      if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
      }
      filePath = join(logsDir, 'clodds.log');
    }
  }

  // Base bindings
  let bindings: Record<string, unknown> = {};
  if (name) bindings.name = name;

  function shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
  }

  function writeLog(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      msg,
      time: formatTimestamp(),
      ...bindings,
      ...data,
    };

    // Console output
    if (usePretty) {
      const formatted = formatPretty(entry);
      if (level === 'error') {
        console.error(formatted);
      } else if (level === 'warn') {
        console.warn(formatted);
      } else {
        console.log(formatted);
      }
    } else if (useJson) {
      const formatted = formatJson(entry);
      console.log(formatted);
    }

    // File output
    if (filePath) {
      try {
        if (shouldRotate(filePath, maxFileSize)) {
          rotateLogFile(filePath, maxFiles);
        }
        appendFileSync(filePath, formatJson(entry) + '\n');
      } catch {}
    }
  }

  function log(level: LogLevel, msgOrData: string | Record<string, unknown>, dataOrMsg?: Record<string, unknown> | string): void {
    let msg: string;
    let data: Record<string, unknown> | undefined;

    if (typeof msgOrData === 'string') {
      msg = msgOrData;
      data = dataOrMsg as Record<string, unknown> | undefined;
    } else {
      msg = dataOrMsg as string;
      data = msgOrData;
    }

    writeLog(level, msg, data);
  }

  const logger: Logger = {
    debug(msgOrData: string | Record<string, unknown>, dataOrMsg?: Record<string, unknown> | string) {
      log('debug', msgOrData, dataOrMsg);
    },

    info(msgOrData: string | Record<string, unknown>, dataOrMsg?: Record<string, unknown> | string) {
      log('info', msgOrData, dataOrMsg);
    },

    warn(msgOrData: string | Record<string, unknown>, dataOrMsg?: Record<string, unknown> | string) {
      log('warn', msgOrData, dataOrMsg);
    },

    error(msgOrData: string | Record<string, unknown>, dataOrMsg?: Record<string, unknown> | string) {
      log('error', msgOrData, dataOrMsg);
    },

    child(childBindings) {
      const childLogger = createLogger({
        level: currentLevel,
        file: filePath || undefined,
        json: useJson,
        pretty: usePretty,
        maxFileSize,
        maxFiles,
      });

      // Merge bindings
      const merged = { ...bindings, ...childBindings };
      (childLogger as { bindings?: Record<string, unknown> }).bindings = merged;

      return childLogger;
    },

    setLevel(level) {
      currentLevel = level;
    },

    flush() {
      // No-op for sync logging
    },
  };

  return logger;
}

// =============================================================================
// LOG READER
// =============================================================================

export interface LogQuery {
  level?: LogLevel;
  since?: Date;
  until?: Date;
  search?: string;
  limit?: number;
}

export function readLogs(filePath: string, query: LogQuery = {}): LogEntry[] {
  if (!existsSync(filePath)) return [];

  const { readFileSync } = require('fs');
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  let entries: LogEntry[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      entries.push(entry);
    } catch {}
  }

  // Apply filters
  if (query.level) {
    const minPriority = LEVEL_PRIORITY[query.level];
    entries = entries.filter(e => LEVEL_PRIORITY[e.level] >= minPriority);
  }

  if (query.since) {
    const since = query.since.getTime();
    entries = entries.filter(e => new Date(e.time).getTime() >= since);
  }

  if (query.until) {
    const until = query.until.getTime();
    entries = entries.filter(e => new Date(e.time).getTime() <= until);
  }

  if (query.search) {
    const search = query.search.toLowerCase();
    entries = entries.filter(e =>
      e.msg.toLowerCase().includes(search) ||
      JSON.stringify(e).toLowerCase().includes(search)
    );
  }

  if (query.limit) {
    entries = entries.slice(-query.limit);
  }

  return entries;
}

// =============================================================================
// DEFAULT LOGGER
// =============================================================================

export const defaultLogger = createLogger({
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  file: process.env.LOG_FILE !== 'false',
  pretty: process.env.LOG_JSON !== 'true',
});

export default defaultLogger;
