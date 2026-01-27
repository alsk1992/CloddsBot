/**
 * Context Management - Clawdbot-style context window management
 *
 * Features:
 * - Context pruning/compaction when exceeding limits
 * - CLAUDE.md and project context loading
 * - Session transcript indexing
 * - Context window guards (token tracking)
 * - Dynamic system prompt building
 * - Conversation summarization for long contexts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import type { MemoryService } from './index';

// =============================================================================
// TYPES
// =============================================================================

export interface ContextConfig {
  /** Maximum tokens for context window (default: 128000 for Claude) */
  maxTokens?: number;
  /** Reserve tokens for response (default: 4096) */
  reserveTokens?: number;
  /** Warning threshold percentage (default: 0.8) */
  warningThreshold?: number;
  /** Auto-compact threshold percentage (default: 0.9) */
  compactThreshold?: number;
  /** Minimum messages to keep after compaction (default: 10) */
  minMessagesAfterCompact?: number;
  /** Project root for CLAUDE.md discovery */
  projectRoot?: string;
  /** Custom CLAUDE.md paths to check */
  claudeMdPaths?: string[];
  /** Enable transcript indexing */
  indexTranscripts?: boolean;
  /** Summarization provider function */
  summarizer?: (text: string, maxTokens: number) => Promise<string>;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: Date;
  tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ContextState {
  messages: Message[];
  totalTokens: number;
  compactionCount: number;
  lastCompaction?: Date;
  systemPrompt?: string;
  projectContext?: string;
  userContext?: string;
}

export interface ContextGuardResult {
  allowed: boolean;
  currentTokens: number;
  maxTokens: number;
  percentUsed: number;
  warning?: string;
  shouldCompact: boolean;
}

export interface CompactionResult {
  success: boolean;
  removedMessages: number;
  tokensBefore: number;
  tokensAfter: number;
  summary?: string;
}

export interface ProjectContext {
  claudeMd?: string;
  claudeMdPath?: string;
  gitIgnore?: string;
  packageJson?: Record<string, unknown>;
  readme?: string;
  codebaseStructure?: string[];
}

export interface TranscriptEntry {
  sessionId: string;
  timestamp: Date;
  role: 'user' | 'assistant';
  content: string;
  tokens: number;
  embedding?: number[];
}

export interface SystemPromptConfig {
  /** Base personality/instructions */
  basePrompt?: string;
  /** Include user facts from memory */
  includeUserFacts?: boolean;
  /** Include user preferences from memory */
  includePreferences?: boolean;
  /** Include project context */
  includeProjectContext?: boolean;
  /** Include recent conversation summaries */
  includeRecentSummaries?: boolean;
  /** Custom sections to inject */
  customSections?: Array<{ title: string; content: string }>;
  /** Maximum tokens for system prompt */
  maxSystemTokens?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_MAX_TOKENS = 128000;
const DEFAULT_RESERVE_TOKENS = 4096;
const DEFAULT_WARNING_THRESHOLD = 0.8;
const DEFAULT_COMPACT_THRESHOLD = 0.9;
const DEFAULT_MIN_MESSAGES = 10;

// Approximate token counting (4 chars per token is a common estimate)
const CHARS_PER_TOKEN = 4;

// =============================================================================
// TOKEN ESTIMATION
// =============================================================================

/**
 * Estimate token count for text (approximate)
 * Uses 4 chars per token as a rough estimate
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // More accurate would use tiktoken, but this is a reasonable estimate
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a message
 */
export function estimateMessageTokens(message: Message): number {
  if (message.tokens) return message.tokens;
  // Role adds ~4 tokens overhead
  return estimateTokens(message.content) + 4;
}

/**
 * Estimate total tokens for messages array
 */
export function estimateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// =============================================================================
// CLAUDE.MD DISCOVERY
// =============================================================================

/**
 * Discover and load CLAUDE.md files
 * Searches:
 * - ~/.claude/CLAUDE.md (global)
 * - Project root CLAUDE.md
 * - .claude/CLAUDE.md in project
 * - Custom paths
 */
export function discoverClaudeMd(projectRoot?: string, customPaths?: string[]): ProjectContext {
  const context: ProjectContext = {};
  const searchPaths: string[] = [];

  // Global CLAUDE.md
  const globalClaudeMd = join(homedir(), '.claude', 'CLAUDE.md');
  searchPaths.push(globalClaudeMd);

  // Project-level CLAUDE.md
  if (projectRoot) {
    searchPaths.push(
      join(projectRoot, 'CLAUDE.md'),
      join(projectRoot, '.claude', 'CLAUDE.md'),
      join(projectRoot, 'docs', 'CLAUDE.md')
    );
  }

  // Custom paths
  if (customPaths) {
    searchPaths.push(...customPaths);
  }

  // Find first existing CLAUDE.md
  for (const searchPath of searchPaths) {
    if (existsSync(searchPath)) {
      try {
        context.claudeMd = readFileSync(searchPath, 'utf-8');
        context.claudeMdPath = searchPath;
        logger.debug({ path: searchPath }, 'Loaded CLAUDE.md');
        break;
      } catch (err) {
        logger.warn({ path: searchPath, error: err }, 'Failed to read CLAUDE.md');
      }
    }
  }

  // Load other project context if project root provided
  if (projectRoot) {
    // Package.json
    const pkgPath = join(projectRoot, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        context.packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      } catch {}
    }

    // README
    for (const readme of ['README.md', 'readme.md', 'Readme.md']) {
      const readmePath = join(projectRoot, readme);
      if (existsSync(readmePath)) {
        try {
          context.readme = readFileSync(readmePath, 'utf-8');
          break;
        } catch {}
      }
    }

    // .gitignore
    const gitignorePath = join(projectRoot, '.gitignore');
    if (existsSync(gitignorePath)) {
      try {
        context.gitIgnore = readFileSync(gitignorePath, 'utf-8');
      } catch {}
    }

    // Codebase structure (top-level files/dirs)
    try {
      context.codebaseStructure = readdirSync(projectRoot)
        .filter(f => !f.startsWith('.') || f === '.env.example')
        .slice(0, 50);
    } catch {}
  }

  return context;
}

// =============================================================================
// CONTEXT MANAGER
// =============================================================================

export interface ContextManager {
  /** Get current context state */
  getState(): ContextState;

  /** Add a message to context */
  addMessage(message: Message): ContextGuardResult;

  /** Check if context can fit more tokens */
  checkGuard(additionalTokens?: number): ContextGuardResult;

  /** Compact context when too large */
  compact(): Promise<CompactionResult>;

  /** Build system prompt dynamically */
  buildSystemPrompt(config?: SystemPromptConfig): string;

  /** Load project context (CLAUDE.md, etc.) */
  loadProjectContext(projectRoot: string): ProjectContext;

  /** Get messages for API call */
  getMessagesForApi(): Message[];

  /** Clear context */
  clear(): void;

  /** Index a transcript entry for later retrieval */
  indexTranscript(entry: TranscriptEntry): void;

  /** Search indexed transcripts */
  searchTranscripts(query: string, topK?: number): TranscriptEntry[];

  /** Get context usage statistics */
  getStats(): {
    totalTokens: number;
    percentUsed: number;
    messageCount: number;
    compactionCount: number;
  };
}

/**
 * Create a context manager instance
 */
export function createContextManager(
  config: ContextConfig = {},
  memoryService?: MemoryService
): ContextManager {
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const reserveTokens = config.reserveTokens ?? DEFAULT_RESERVE_TOKENS;
  const warningThreshold = config.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
  const compactThreshold = config.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD;
  const minMessagesAfterCompact = config.minMessagesAfterCompact ?? DEFAULT_MIN_MESSAGES;
  const summarizer = config.summarizer;

  // State
  const state: ContextState = {
    messages: [],
    totalTokens: 0,
    compactionCount: 0,
  };

  // Transcript index (simple in-memory for now)
  const transcriptIndex: TranscriptEntry[] = [];

  // Project context cache
  let projectContext: ProjectContext | null = null;

  /**
   * Calculate context guard result
   */
  function calculateGuard(additionalTokens = 0): ContextGuardResult {
    const effectiveMax = maxTokens - reserveTokens;
    const currentTokens = state.totalTokens + additionalTokens;
    const percentUsed = currentTokens / effectiveMax;

    let warning: string | undefined;
    if (percentUsed >= compactThreshold) {
      warning = `Context at ${Math.round(percentUsed * 100)}% capacity. Auto-compaction triggered.`;
    } else if (percentUsed >= warningThreshold) {
      warning = `Context at ${Math.round(percentUsed * 100)}% capacity. Consider compacting.`;
    }

    return {
      allowed: currentTokens <= effectiveMax,
      currentTokens,
      maxTokens: effectiveMax,
      percentUsed,
      warning,
      shouldCompact: percentUsed >= compactThreshold,
    };
  }

  /**
   * Summarize a batch of messages
   */
  async function summarizeMessages(messages: Message[]): Promise<string> {
    if (!summarizer) {
      // Fallback: simple extraction of key points
      const content = messages
        .map(m => `${m.role}: ${m.content.slice(0, 200)}...`)
        .join('\n');
      return `[Summarized ${messages.length} messages]:\n${content.slice(0, 1000)}`;
    }

    const fullText = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    return summarizer(fullText, 500);
  }

  const manager: ContextManager = {
    getState() {
      return { ...state };
    },

    addMessage(message) {
      const tokens = estimateMessageTokens(message);
      message.tokens = tokens;

      // Check guard first
      const guard = calculateGuard(tokens);

      if (guard.shouldCompact) {
        // Don't block, but log warning
        logger.warn({ tokens: guard.currentTokens, max: guard.maxTokens }, 'Context needs compaction');
      }

      // Add message regardless (compaction is async)
      state.messages.push(message);
      state.totalTokens += tokens;

      return calculateGuard();
    },

    checkGuard(additionalTokens = 0) {
      return calculateGuard(additionalTokens);
    },

    async compact() {
      const tokensBefore = state.totalTokens;
      const messageCountBefore = state.messages.length;

      if (state.messages.length <= minMessagesAfterCompact) {
        return {
          success: false,
          removedMessages: 0,
          tokensBefore,
          tokensAfter: tokensBefore,
        };
      }

      // Keep last N messages, summarize the rest
      const messagesToKeep = state.messages.slice(-minMessagesAfterCompact);
      const messagesToSummarize = state.messages.slice(0, -minMessagesAfterCompact);

      let summary: string | undefined;
      if (messagesToSummarize.length > 0) {
        try {
          summary = await summarizeMessages(messagesToSummarize);
        } catch (err) {
          logger.error({ error: err }, 'Failed to summarize messages');
          summary = `[Compacted ${messagesToSummarize.length} messages]`;
        }

        // Insert summary as a system message at the beginning
        const summaryMessage: Message = {
          role: 'system',
          content: `Previous conversation summary:\n${summary}`,
          timestamp: new Date(),
          tokens: estimateTokens(summary),
        };

        state.messages = [summaryMessage, ...messagesToKeep];
      } else {
        state.messages = messagesToKeep;
      }

      // Recalculate total tokens
      state.totalTokens = estimateTotalTokens(state.messages);
      state.compactionCount++;
      state.lastCompaction = new Date();

      const result: CompactionResult = {
        success: true,
        removedMessages: messageCountBefore - state.messages.length,
        tokensBefore,
        tokensAfter: state.totalTokens,
        summary,
      };

      logger.info({
        removedMessages: result.removedMessages,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
      }, 'Context compacted');

      return result;
    },

    buildSystemPrompt(promptConfig: SystemPromptConfig = {}) {
      const parts: string[] = [];

      // Base prompt
      if (promptConfig.basePrompt) {
        parts.push(promptConfig.basePrompt);
      }

      // Project context (CLAUDE.md)
      if (promptConfig.includeProjectContext && projectContext?.claudeMd) {
        parts.push('\n# Project Instructions (from CLAUDE.md)');
        parts.push(projectContext.claudeMd);
      }

      // User facts from memory
      if (promptConfig.includeUserFacts && memoryService) {
        // Would need userId/channel context here
        // For now, skip - should be injected by caller
      }

      // User preferences
      if (promptConfig.includePreferences && memoryService) {
        // Similar - need user context
      }

      // Recent summaries from memory
      if (promptConfig.includeRecentSummaries && memoryService) {
        // Similar - need user context
      }

      // Custom sections
      if (promptConfig.customSections) {
        for (const section of promptConfig.customSections) {
          parts.push(`\n# ${section.title}`);
          parts.push(section.content);
        }
      }

      let prompt = parts.join('\n\n');

      // Truncate if exceeds max
      const maxSystemTokens = promptConfig.maxSystemTokens ?? 8000;
      const currentTokens = estimateTokens(prompt);
      if (currentTokens > maxSystemTokens) {
        // Truncate with ellipsis
        const targetChars = maxSystemTokens * CHARS_PER_TOKEN;
        prompt = prompt.slice(0, targetChars) + '\n\n[... truncated for brevity]';
      }

      state.systemPrompt = prompt;
      return prompt;
    },

    loadProjectContext(projectRoot: string) {
      projectContext = discoverClaudeMd(projectRoot, config.claudeMdPaths);
      state.projectContext = projectContext.claudeMd;
      return projectContext;
    },

    getMessagesForApi() {
      const messages: Message[] = [];

      // Add system prompt if set
      if (state.systemPrompt) {
        messages.push({
          role: 'system',
          content: state.systemPrompt,
          tokens: estimateTokens(state.systemPrompt),
        });
      }

      // Add conversation messages
      messages.push(...state.messages);

      return messages;
    },

    clear() {
      state.messages = [];
      state.totalTokens = 0;
      state.systemPrompt = undefined;
      state.userContext = undefined;
      logger.debug('Context cleared');
    },

    indexTranscript(entry) {
      transcriptIndex.push(entry);

      // Keep index bounded
      if (transcriptIndex.length > 10000) {
        transcriptIndex.shift();
      }
    },

    searchTranscripts(query, topK = 10) {
      // Simple keyword search for now
      // Could be enhanced with embeddings
      const queryLower = query.toLowerCase();
      const results = transcriptIndex
        .filter(e => e.content.toLowerCase().includes(queryLower))
        .slice(-topK);

      return results;
    },

    getStats() {
      const effectiveMax = maxTokens - reserveTokens;
      return {
        totalTokens: state.totalTokens,
        percentUsed: state.totalTokens / effectiveMax,
        messageCount: state.messages.length,
        compactionCount: state.compactionCount,
      };
    },
  };

  return manager;
}

// =============================================================================
// CONVERSATION PRUNING STRATEGIES
// =============================================================================

export type PruningStrategy =
  | 'oldest-first'      // Remove oldest messages first
  | 'keep-system'       // Keep system messages, prune user/assistant
  | 'summarize'         // Summarize old messages
  | 'importance'        // Keep important messages (needs scoring)
  | 'sliding-window';   // Keep last N messages

export interface PruningConfig {
  strategy: PruningStrategy;
  /** For sliding-window: number of messages to keep */
  windowSize?: number;
  /** For importance: minimum importance score to keep */
  minImportance?: number;
  /** Always keep system messages */
  keepSystem?: boolean;
}

/**
 * Prune messages according to strategy
 */
export function pruneMessages(
  messages: Message[],
  targetTokens: number,
  config: PruningConfig
): Message[] {
  let result = [...messages];
  let currentTokens = estimateTotalTokens(result);

  switch (config.strategy) {
    case 'oldest-first': {
      while (currentTokens > targetTokens && result.length > 1) {
        // Find oldest non-system message to remove
        const idx = result.findIndex(m =>
          config.keepSystem ? m.role !== 'system' : true
        );
        if (idx === -1) break;

        currentTokens -= estimateMessageTokens(result[idx]);
        result.splice(idx, 1);
      }
      break;
    }

    case 'sliding-window': {
      const windowSize = config.windowSize ?? 20;
      const systemMessages = config.keepSystem
        ? result.filter(m => m.role === 'system')
        : [];
      const nonSystem = result.filter(m => m.role !== 'system');

      result = [
        ...systemMessages,
        ...nonSystem.slice(-windowSize),
      ];
      break;
    }

    case 'keep-system': {
      const systemMessages = result.filter(m => m.role === 'system');
      const nonSystem = result.filter(m => m.role !== 'system');

      currentTokens = estimateTotalTokens(systemMessages);
      const keptNonSystem: Message[] = [];

      // Keep as many recent non-system as fit
      for (let i = nonSystem.length - 1; i >= 0; i--) {
        const msgTokens = estimateMessageTokens(nonSystem[i]);
        if (currentTokens + msgTokens <= targetTokens) {
          keptNonSystem.unshift(nonSystem[i]);
          currentTokens += msgTokens;
        }
      }

      result = [...systemMessages, ...keptNonSystem];
      break;
    }

    case 'summarize':
    case 'importance':
      // These require async operations or additional context
      // Fall back to sliding-window
      return pruneMessages(messages, targetTokens, {
        ...config,
        strategy: 'sliding-window',
      });
  }

  return result;
}

// =============================================================================
// EXPORTS
// =============================================================================

export const context = {
  createManager: createContextManager,
  discoverClaudeMd,
  estimateTokens,
  estimateMessageTokens,
  estimateTotalTokens,
  pruneMessages,
};
