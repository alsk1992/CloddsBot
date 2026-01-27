/**
 * Auto-Reply System - Clawdbot-style automatic responses
 *
 * Features:
 * - Rule-based auto-responses
 * - Pattern matching (regex, keywords, exact)
 * - Cooldowns per user/channel
 * - Time-based rules (only active during certain hours)
 * - Priority-based rule matching
 * - Response templates with variables
 */

import { EventEmitter } from 'eventemitter3';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger';
import type { IncomingMessage } from '../types';

// =============================================================================
// CONSTANTS
// =============================================================================

const RULES_FILE = join(homedir(), '.clodds', 'auto-reply-rules.json');

// =============================================================================
// TYPES
// =============================================================================

/** Match type for rules */
export type MatchType = 'exact' | 'contains' | 'startsWith' | 'endsWith' | 'regex' | 'keywords';

/** Rule condition */
export interface RuleCondition {
  /** Match type */
  type: MatchType;
  /** Pattern to match (string or regex string) - not required for keywords type */
  pattern?: string;
  /** Case insensitive matching */
  ignoreCase?: boolean;
  /** Keywords (for type: 'keywords') */
  keywords?: string[];
  /** Minimum keywords to match (for type: 'keywords') */
  minKeywords?: number;
}

/** Time window for rule */
export interface TimeWindow {
  /** Start hour (0-23) */
  startHour: number;
  /** End hour (0-23) */
  endHour: number;
  /** Days of week (0=Sunday, 6=Saturday) */
  days?: number[];
  /** Timezone (default: local) */
  timezone?: string;
}

/** Response action */
export interface RuleResponse {
  /** Response type */
  type: 'text' | 'template' | 'forward' | 'react' | 'webhook';
  /** Response content */
  content: string;
  /** Delay before responding (ms) */
  delay?: number;
  /** Webhook URL (for type: 'webhook') */
  webhookUrl?: string;
  /** Forward to channel (for type: 'forward') */
  forwardTo?: string;
}

/** Auto-reply rule */
export interface AutoReplyRule {
  /** Unique rule ID */
  id: string;
  /** Rule name */
  name: string;
  /** Rule description */
  description?: string;
  /** Whether rule is enabled */
  enabled: boolean;
  /** Priority (higher = checked first) */
  priority: number;
  /** Conditions to match (all must match) */
  conditions: RuleCondition[];
  /** Response to send */
  response: RuleResponse;
  /** Only apply to specific channels */
  channels?: string[];
  /** Only apply to specific users */
  users?: string[];
  /** Exclude specific users */
  excludeUsers?: string[];
  /** Time window when rule is active */
  timeWindow?: TimeWindow;
  /** Cooldown between responses (ms) */
  cooldownMs?: number;
  /** Per-user cooldown */
  perUserCooldown?: boolean;
  /** Stop processing more rules after match */
  stopOnMatch?: boolean;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/** Match result */
export interface MatchResult {
  rule: AutoReplyRule;
  matches: string[];
  variables: Record<string, string>;
}

/** Auto-reply service events */
export interface AutoReplyServiceEvents {
  'rule:matched': (ruleId: string, message: IncomingMessage, response: string) => void;
  'rule:cooldown': (ruleId: string, message: IncomingMessage) => void;
  'rule:error': (ruleId: string, error: Error) => void;
}

/** Auto-reply service */
export interface AutoReplyService {
  /** Add a rule */
  addRule(rule: AutoReplyRule): void;
  /** Remove a rule */
  removeRule(ruleId: string): boolean;
  /** Update a rule */
  updateRule(ruleId: string, updates: Partial<AutoReplyRule>): boolean;
  /** Get a rule */
  getRule(ruleId: string): AutoReplyRule | null;
  /** List all rules */
  listRules(): AutoReplyRule[];
  /** Enable a rule */
  enableRule(ruleId: string): boolean;
  /** Disable a rule */
  disableRule(ruleId: string): boolean;
  /** Process a message and get response */
  process(message: IncomingMessage): Promise<MatchResult | null>;
  /** Check if message matches a rule (without triggering) */
  check(message: IncomingMessage): MatchResult | null;
  /** Get response text with variables replaced */
  formatResponse(result: MatchResult, message: IncomingMessage): string;
  /** Save rules to file */
  save(): void;
  /** Load rules from file */
  load(): void;
  /** Clear all cooldowns */
  clearCooldowns(): void;
  /** Subscribe to events */
  on<K extends keyof AutoReplyServiceEvents>(event: K, fn: AutoReplyServiceEvents[K]): void;
  off<K extends keyof AutoReplyServiceEvents>(event: K, fn: AutoReplyServiceEvents[K]): void;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Check if current time is within time window */
function isWithinTimeWindow(window: TimeWindow): boolean {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  // Check day of week
  if (window.days && !window.days.includes(day)) {
    return false;
  }

  // Check hour range
  if (window.startHour <= window.endHour) {
    // Normal range (e.g., 9-17)
    return hour >= window.startHour && hour < window.endHour;
  } else {
    // Overnight range (e.g., 22-6)
    return hour >= window.startHour || hour < window.endHour;
  }
}

/** Match message against condition */
function matchCondition(text: string, condition: RuleCondition): { matched: boolean; captures: string[] } {
  const testText = condition.ignoreCase ? text.toLowerCase() : text;
  const pattern = condition.pattern
    ? (condition.ignoreCase ? condition.pattern.toLowerCase() : condition.pattern)
    : '';

  switch (condition.type) {
    case 'exact':
      return { matched: testText === pattern, captures: [] };

    case 'contains':
      return { matched: testText.includes(pattern), captures: [] };

    case 'startsWith':
      return { matched: testText.startsWith(pattern), captures: [] };

    case 'endsWith':
      return { matched: testText.endsWith(pattern), captures: [] };

    case 'regex': {
      if (!condition.pattern) return { matched: false, captures: [] };
      try {
        const flags = condition.ignoreCase ? 'i' : '';
        const regex = new RegExp(condition.pattern, flags);
        const match = text.match(regex);
        return {
          matched: !!match,
          captures: match ? match.slice(1) : [],
        };
      } catch {
        return { matched: false, captures: [] };
      }
    }

    case 'keywords': {
      const keywords = condition.keywords || [];
      const minKeywords = condition.minKeywords || 1;
      const matched = keywords.filter(kw => {
        const kwLower = condition.ignoreCase ? kw.toLowerCase() : kw;
        return testText.includes(kwLower);
      });
      return {
        matched: matched.length >= minKeywords,
        captures: matched,
      };
    }

    default:
      return { matched: false, captures: [] };
  }
}

/** Replace template variables */
function replaceVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => variables[key] || `{${key}}`);
}

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

export function createAutoReplyService(): AutoReplyService {
  const emitter = new EventEmitter();
  const rules = new Map<string, AutoReplyRule>();
  const cooldowns = new Map<string, number>(); // ruleId:userId -> timestamp

  /** Get cooldown key */
  function getCooldownKey(ruleId: string, userId: string, perUser: boolean): string {
    return perUser ? `${ruleId}:${userId}` : ruleId;
  }

  /** Check if rule is on cooldown */
  function isOnCooldown(rule: AutoReplyRule, userId: string): boolean {
    if (!rule.cooldownMs) return false;

    const key = getCooldownKey(rule.id, userId, rule.perUserCooldown || false);
    const lastTriggered = cooldowns.get(key);

    if (lastTriggered && Date.now() - lastTriggered < rule.cooldownMs) {
      return true;
    }
    return false;
  }

  /** Set cooldown for rule */
  function setCooldown(rule: AutoReplyRule, userId: string): void {
    if (!rule.cooldownMs) return;

    const key = getCooldownKey(rule.id, userId, rule.perUserCooldown || false);
    cooldowns.set(key, Date.now());
  }

  const service: AutoReplyService = {
    addRule(rule) {
      rules.set(rule.id, rule);
      logger.debug({ ruleId: rule.id, name: rule.name }, 'Auto-reply rule added');
    },

    removeRule(ruleId) {
      const existed = rules.delete(ruleId);
      if (existed) {
        logger.debug({ ruleId }, 'Auto-reply rule removed');
      }
      return existed;
    },

    updateRule(ruleId, updates) {
      const rule = rules.get(ruleId);
      if (!rule) return false;

      Object.assign(rule, updates);
      logger.debug({ ruleId }, 'Auto-reply rule updated');
      return true;
    },

    getRule(ruleId) {
      return rules.get(ruleId) || null;
    },

    listRules() {
      return Array.from(rules.values()).sort((a, b) => b.priority - a.priority);
    },

    enableRule(ruleId) {
      const rule = rules.get(ruleId);
      if (!rule) return false;
      rule.enabled = true;
      return true;
    },

    disableRule(ruleId) {
      const rule = rules.get(ruleId);
      if (!rule) return false;
      rule.enabled = false;
      return true;
    },

    async process(message) {
      const result = this.check(message);
      if (!result) return null;

      // Check cooldown
      if (isOnCooldown(result.rule, message.userId)) {
        emitter.emit('rule:cooldown', result.rule.id, message);
        return null;
      }

      // Set cooldown
      setCooldown(result.rule, message.userId);

      // Format response
      const responseText = this.formatResponse(result, message);
      emitter.emit('rule:matched', result.rule.id, message, responseText);

      // Handle delay
      if (result.rule.response.delay) {
        await new Promise(r => setTimeout(r, result.rule.response.delay));
      }

      return result;
    },

    check(message) {
      const sortedRules = Array.from(rules.values())
        .filter(r => r.enabled)
        .sort((a, b) => b.priority - a.priority);

      for (const rule of sortedRules) {
        // Check channel filter
        if (rule.channels && !rule.channels.includes(message.platform)) {
          continue;
        }

        // Check user filter
        if (rule.users && !rule.users.includes(message.userId)) {
          continue;
        }

        // Check user exclusion
        if (rule.excludeUsers && rule.excludeUsers.includes(message.userId)) {
          continue;
        }

        // Check time window
        if (rule.timeWindow && !isWithinTimeWindow(rule.timeWindow)) {
          continue;
        }

        // Match all conditions
        const matches: string[] = [];
        const variables: Record<string, string> = {};
        let allMatched = true;

        for (let i = 0; i < rule.conditions.length; i++) {
          const condition = rule.conditions[i];
          const result = matchCondition(message.text, condition);

          if (!result.matched) {
            allMatched = false;
            break;
          }

          matches.push(...result.captures);
          result.captures.forEach((cap, j) => {
            variables[`match${i}_${j}`] = cap;
            variables[`$${i + 1}`] = cap; // Numbered backreference
          });
        }

        if (allMatched) {
          return { rule, matches, variables };
        }
      }

      return null;
    },

    formatResponse(result, message) {
      const { rule, matches, variables } = result;

      // Built-in variables
      const allVars: Record<string, string> = {
        ...variables,
        user: message.userId,
        username: message.userId,
        channel: message.platform,
        text: message.text,
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString(),
        matches: matches.join(', '),
      };

      // Add numbered matches
      matches.forEach((m, i) => {
        allVars[`match${i}`] = m;
      });

      return replaceVariables(rule.response.content, allVars);
    },

    save() {
      const data = Array.from(rules.values());
      writeFileSync(RULES_FILE, JSON.stringify(data, null, 2));
      logger.debug({ count: data.length }, 'Auto-reply rules saved');
    },

    load() {
      try {
        if (existsSync(RULES_FILE)) {
          const data = JSON.parse(readFileSync(RULES_FILE, 'utf-8')) as AutoReplyRule[];
          rules.clear();
          for (const rule of data) {
            rules.set(rule.id, rule);
          }
          logger.debug({ count: data.length }, 'Auto-reply rules loaded');
        }
      } catch (e) {
        logger.error({ error: e }, 'Failed to load auto-reply rules');
      }
    },

    clearCooldowns() {
      cooldowns.clear();
    },

    on(event, fn) {
      emitter.on(event, fn);
    },

    off(event, fn) {
      emitter.off(event, fn);
    },
  };

  // Load rules on init
  service.load();

  return service;
}

// =============================================================================
// RULE BUILDERS
// =============================================================================

/** Helper to create rules */
export const ruleBuilder = {
  /** Create a simple keyword response rule */
  keyword(id: string, name: string, keywords: string[], response: string, options?: Partial<AutoReplyRule>): AutoReplyRule {
    return {
      id,
      name,
      enabled: true,
      priority: 0,
      conditions: [{
        type: 'keywords',
        keywords,
        ignoreCase: true,
        minKeywords: 1,
      }],
      response: { type: 'text', content: response },
      ...options,
    };
  },

  /** Create a regex capture rule */
  regex(id: string, name: string, pattern: string, response: string, options?: Partial<AutoReplyRule>): AutoReplyRule {
    return {
      id,
      name,
      enabled: true,
      priority: 0,
      conditions: [{
        type: 'regex',
        pattern,
        ignoreCase: true,
      }],
      response: { type: 'text', content: response },
      ...options,
    };
  },

  /** Create an exact match rule */
  exact(id: string, name: string, text: string, response: string, options?: Partial<AutoReplyRule>): AutoReplyRule {
    return {
      id,
      name,
      enabled: true,
      priority: 10, // Higher priority for exact matches
      conditions: [{
        type: 'exact',
        pattern: text,
        ignoreCase: true,
      }],
      response: { type: 'text', content: response },
      stopOnMatch: true,
      ...options,
    };
  },

  /** Create a greeting rule (time-aware) */
  greeting(id: string, keywords: string[], morningResponse: string, afternoonResponse: string, eveningResponse: string): AutoReplyRule {
    const hour = new Date().getHours();
    let response: string;
    if (hour < 12) response = morningResponse;
    else if (hour < 17) response = afternoonResponse;
    else response = eveningResponse;

    return {
      id,
      name: 'Greeting',
      enabled: true,
      priority: 5,
      conditions: [{
        type: 'keywords',
        keywords,
        ignoreCase: true,
      }],
      response: { type: 'text', content: response },
      cooldownMs: 60000, // 1 minute cooldown
      perUserCooldown: true,
    };
  },

  /** Create an away message rule */
  awayMessage(id: string, response: string, startHour: number, endHour: number, days?: number[]): AutoReplyRule {
    return {
      id,
      name: 'Away Message',
      enabled: true,
      priority: 100, // High priority
      conditions: [{
        type: 'regex',
        pattern: '.*', // Match everything
      }],
      response: { type: 'text', content: response },
      timeWindow: { startHour, endHour, days },
      cooldownMs: 300000, // 5 minute cooldown per user
      perUserCooldown: true,
    };
  },
};

// =============================================================================
// EXAMPLE RULES
// =============================================================================

export const exampleRules: AutoReplyRule[] = [
  ruleBuilder.keyword(
    'faq-hours',
    'Business Hours FAQ',
    ['hours', 'open', 'close', 'when'],
    'Our hours are Monday-Friday 9am-5pm EST. Is there something specific I can help you with?',
    { cooldownMs: 30000 }
  ),

  ruleBuilder.regex(
    'price-query',
    'Price Query',
    'how much (?:is|does|for) (.+?)\\??$',
    'I\'d be happy to help with pricing for {$1}. Let me check that for you...',
  ),

  ruleBuilder.exact(
    'hello',
    'Hello Response',
    'hello',
    'Hello {username}! How can I help you today?',
  ),

  ruleBuilder.keyword(
    'thanks',
    'Thanks Response',
    ['thank', 'thanks', 'thx', 'ty'],
    'You\'re welcome! Let me know if you need anything else.',
    { cooldownMs: 60000, perUserCooldown: true }
  ),
];
