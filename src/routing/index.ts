/**
 * Routing Service - Clawdbot-style multi-agent routing with bindings
 *
 * Features:
 * - Multiple specialized agents (main, trading, research, etc.)
 * - Pattern-based routing (regex, keywords, commands)
 * - Channel-specific agent bindings
 * - Fallback to default agent
 */

import { logger } from '../utils/logger';
import type { IncomingMessage, Session } from '../types';

/** Tool policy for an agent */
export interface ToolPolicy {
  /** Tools that are always allowed */
  allow?: string[];
  /** Tools that are always denied */
  deny?: string[];
  /** Tool groups that are allowed (e.g., 'fs', 'web', 'runtime') */
  allowGroups?: string[];
  /** Tool groups that are denied */
  denyGroups?: string[];
  /** Whether to require confirmation for dangerous tools */
  confirmDangerous?: boolean;
}

/** Tool groups for easy policy configuration */
export const TOOL_GROUPS: Record<string, string[]> = {
  fs: ['read', 'write', 'edit', 'glob', 'find'],
  web: ['web-search', 'web-fetch', 'browser'],
  runtime: ['exec', 'bash', 'shell'],
  comms: ['message', 'email', 'sms'],
  media: ['image', 'transcription', 'canvas'],
  data: ['sql', 'git', 'docker'],
  sessions: ['sessions', 'checkpoint', 'restore'],
};

/** Agent workspace configuration */
export interface AgentWorkspace {
  /** Root directory for this agent's workspace */
  rootDir?: string;
  /** Whether to isolate file operations to workspace */
  isolate?: boolean;
  /** State directory for agent-specific data */
  stateDir?: string;
  /** Session storage path */
  sessionsDir?: string;
  /** Memory storage path */
  memoryDir?: string;
}

/** Agent definition */
export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** System prompt override for this agent */
  systemPrompt?: string;
  /** Model override for this agent */
  model?: string;
  /** Whether this agent is enabled */
  enabled: boolean;
  /** Tool access policy for this agent */
  toolPolicy?: ToolPolicy;
  /** Workspace configuration for this agent */
  workspace?: AgentWorkspace;
}

/** Binding types */
export type BindingType = 'command' | 'keyword' | 'regex' | 'channel' | 'default';

/** A routing binding */
export interface Binding {
  id: string;
  type: BindingType;
  pattern: string;
  agentId: string;
  /** Priority (higher = checked first) */
  priority: number;
  /** Channel filter (optional) */
  channel?: string;
  /** Whether this binding is enabled */
  enabled: boolean;
}

/** Route result */
export interface RouteResult {
  agentId: string;
  agent: AgentDefinition;
  binding?: Binding;
  reason: string;
}

/** Routing configuration */
export interface RoutingConfig {
  /** Available agents */
  agents: AgentDefinition[];
  /** Routing bindings */
  bindings: Binding[];
  /** Default agent ID */
  defaultAgentId: string;
}

export interface RoutingService {
  /** Route a message to an agent */
  route(message: IncomingMessage, session: Session): RouteResult;

  /** Get all available agents */
  getAgents(): AgentDefinition[];

  /** Get agent by ID */
  getAgent(agentId: string): AgentDefinition | null;

  /** Get all bindings */
  getBindings(): Binding[];

  /** Add a new agent */
  addAgent(agent: AgentDefinition): void;

  /** Update an agent */
  updateAgent(agentId: string, updates: Partial<AgentDefinition>): boolean;

  /** Remove an agent */
  removeAgent(agentId: string): boolean;

  /** Add a new binding */
  addBinding(binding: Binding): void;

  /** Update a binding */
  updateBinding(bindingId: string, updates: Partial<Binding>): boolean;

  /** Remove a binding */
  removeBinding(bindingId: string): boolean;

  /** Get default agent */
  getDefaultAgent(): AgentDefinition;

  /** Check if a tool is allowed for an agent */
  isToolAllowed(agentId: string, toolName: string): boolean;

  /** Get workspace path for an agent */
  getWorkspacePath(agentId: string): string | null;

  /** Get all tools allowed for an agent */
  getAllowedTools(agentId: string): string[] | null;
}

/** Default agents */
const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    id: 'main',
    name: 'Main Agent',
    description: 'General purpose prediction market assistant',
    enabled: true,
  },
  {
    id: 'trading',
    name: 'Trading Agent',
    description: 'Specialized in trade execution and portfolio management',
    systemPrompt: `You are a trading specialist for prediction markets.
Focus on:
- Trade execution (buy/sell)
- Portfolio analysis
- Position management
- Risk assessment
Be concise and action-oriented.`,
    enabled: true,
  },
  {
    id: 'research',
    name: 'Research Agent',
    description: 'Specialized in market research and analysis',
    systemPrompt: `You are a research specialist for prediction markets.
Focus on:
- Market analysis and trends
- Event research
- Probability estimation
- Information synthesis
Be thorough and data-driven.`,
    enabled: true,
  },
  {
    id: 'alerts',
    name: 'Alerts Agent',
    description: 'Specialized in price alerts and notifications',
    systemPrompt: `You are an alerts specialist for prediction markets.
Focus on:
- Setting up price alerts
- Monitoring conditions
- Notification management
Be precise about thresholds and conditions.`,
    enabled: true,
  },
];

/** Default bindings */
const DEFAULT_BINDINGS: Binding[] = [
  // Command bindings
  {
    id: 'cmd-buy',
    type: 'command',
    pattern: '/buy',
    agentId: 'trading',
    priority: 100,
    enabled: true,
  },
  {
    id: 'cmd-sell',
    type: 'command',
    pattern: '/sell',
    agentId: 'trading',
    priority: 100,
    enabled: true,
  },
  {
    id: 'cmd-portfolio',
    type: 'command',
    pattern: '/portfolio',
    agentId: 'trading',
    priority: 100,
    enabled: true,
  },
  {
    id: 'cmd-alert',
    type: 'command',
    pattern: '/alert',
    agentId: 'alerts',
    priority: 100,
    enabled: true,
  },
  {
    id: 'cmd-research',
    type: 'command',
    pattern: '/research',
    agentId: 'research',
    priority: 100,
    enabled: true,
  },
  // Keyword bindings
  {
    id: 'kw-buy',
    type: 'keyword',
    pattern: 'buy|purchase|long',
    agentId: 'trading',
    priority: 50,
    enabled: true,
  },
  {
    id: 'kw-sell',
    type: 'keyword',
    pattern: 'sell|exit|close',
    agentId: 'trading',
    priority: 50,
    enabled: true,
  },
  {
    id: 'kw-analyze',
    type: 'keyword',
    pattern: 'analyze|research|what do you think',
    agentId: 'research',
    priority: 40,
    enabled: true,
  },
  // Default fallback
  {
    id: 'default',
    type: 'default',
    pattern: '*',
    agentId: 'main',
    priority: 0,
    enabled: true,
  },
];

export function createRoutingService(config?: Partial<RoutingConfig>): RoutingService {
  // Initialize with defaults + config overrides
  const agents = new Map<string, AgentDefinition>();
  const bindings = new Map<string, Binding>();

  // Load default agents
  for (const agent of DEFAULT_AGENTS) {
    agents.set(agent.id, agent);
  }

  // Override with config agents
  if (config?.agents) {
    for (const agent of config.agents) {
      agents.set(agent.id, agent);
    }
  }

  // Load default bindings
  for (const binding of DEFAULT_BINDINGS) {
    bindings.set(binding.id, binding);
  }

  // Override with config bindings
  if (config?.bindings) {
    for (const binding of config.bindings) {
      bindings.set(binding.id, binding);
    }
  }

  const defaultAgentId = config?.defaultAgentId || 'main';

  /**
   * Check if a binding matches a message
   */
  function matchesBinding(binding: Binding, message: IncomingMessage): boolean {
    if (!binding.enabled) return false;

    // Check channel filter
    if (binding.channel && binding.channel !== message.platform) {
      return false;
    }

    const text = message.text.trim();

    switch (binding.type) {
      case 'command':
        // Command must start with the pattern
        return text.toLowerCase().startsWith(binding.pattern.toLowerCase());

      case 'keyword':
        // Any keyword in the pattern must be present
        const keywords = binding.pattern.split('|').map((k) => k.trim().toLowerCase());
        const textLower = text.toLowerCase();
        return keywords.some((keyword) => textLower.includes(keyword));

      case 'regex':
        if (binding.pattern.length > 200) {
          logger.warn({ pattern: binding.pattern }, 'Regex pattern too long');
          return false;
        }
        try {
          const regex = new RegExp(binding.pattern, 'i');
          return regex.test(text.slice(0, 10000));
        } catch {
          logger.warn({ pattern: binding.pattern }, 'Invalid regex pattern');
          return false;
        }

      case 'channel':
        // Match specific channel
        return message.platform === binding.pattern;

      case 'default':
        // Always matches
        return true;

      default:
        return false;
    }
  }

  const service: RoutingService = {
    route(message, session) {
      // Get enabled bindings sorted by priority (highest first)
      const sortedBindings = Array.from(bindings.values())
        .filter((b) => b.enabled)
        .sort((a, b) => b.priority - a.priority);

      // Find first matching binding
      for (const binding of sortedBindings) {
        if (matchesBinding(binding, message)) {
          const agent = agents.get(binding.agentId);
          if (agent && agent.enabled) {
            logger.debug(
              { messageId: message.id, agentId: agent.id, bindingId: binding.id },
              'Message routed'
            );
            return {
              agentId: agent.id,
              agent,
              binding,
              reason: `Matched ${binding.type} binding: ${binding.pattern}`,
            };
          }
        }
      }

      // Fallback to default agent
      const defaultAgent = agents.get(defaultAgentId) || DEFAULT_AGENTS[0];
      return {
        agentId: defaultAgent.id,
        agent: defaultAgent,
        reason: 'Default agent (no binding matched)',
      };
    },

    getAgents() {
      return Array.from(agents.values());
    },

    getAgent(agentId) {
      return agents.get(agentId) || null;
    },

    getBindings() {
      return Array.from(bindings.values());
    },

    addAgent(agent) {
      agents.set(agent.id, agent);
      logger.info({ agentId: agent.id }, 'Agent added');
    },

    updateAgent(agentId, updates) {
      const existing = agents.get(agentId);
      if (!existing) return false;

      agents.set(agentId, { ...existing, ...updates });
      logger.info({ agentId }, 'Agent updated');
      return true;
    },

    removeAgent(agentId) {
      if (agentId === defaultAgentId) {
        logger.warn({ agentId }, 'Cannot remove default agent');
        return false;
      }

      const existed = agents.delete(agentId);
      if (existed) {
        logger.info({ agentId }, 'Agent removed');
      }
      return existed;
    },

    addBinding(binding) {
      bindings.set(binding.id, binding);
      logger.info({ bindingId: binding.id }, 'Binding added');
    },

    updateBinding(bindingId, updates) {
      const existing = bindings.get(bindingId);
      if (!existing) return false;

      bindings.set(bindingId, { ...existing, ...updates });
      logger.info({ bindingId }, 'Binding updated');
      return true;
    },

    removeBinding(bindingId) {
      const existed = bindings.delete(bindingId);
      if (existed) {
        logger.info({ bindingId }, 'Binding removed');
      }
      return existed;
    },

    getDefaultAgent() {
      return agents.get(defaultAgentId) || DEFAULT_AGENTS[0];
    },

    isToolAllowed(agentId, toolName) {
      const agent = agents.get(agentId);
      if (!agent) return true; // Default to allow if agent not found

      const policy = agent.toolPolicy;
      if (!policy) return true; // No policy = all tools allowed

      // Check explicit deny first
      if (policy.deny?.includes(toolName)) return false;

      // Check deny groups
      if (policy.denyGroups) {
        for (const groupName of policy.denyGroups) {
          const group = TOOL_GROUPS[groupName];
          if (group?.includes(toolName)) return false;
        }
      }

      // Check explicit allow
      if (policy.allow?.includes(toolName)) return true;

      // Check allow groups
      if (policy.allowGroups) {
        for (const groupName of policy.allowGroups) {
          const group = TOOL_GROUPS[groupName];
          if (group?.includes(toolName)) return true;
        }
        // If allowGroups is specified, only those are allowed
        return false;
      }

      // Default to allow
      return true;
    },

    getWorkspacePath(agentId) {
      const agent = agents.get(agentId);
      return agent?.workspace?.rootDir || null;
    },

    getAllowedTools(agentId) {
      const agent = agents.get(agentId);
      if (!agent?.toolPolicy) return null; // All tools allowed

      const policy = agent.toolPolicy;
      const allowed: string[] = [];

      // Start with explicit allows
      if (policy.allow) {
        allowed.push(...policy.allow);
      }

      // Add tools from allowed groups
      if (policy.allowGroups) {
        for (const groupName of policy.allowGroups) {
          const group = TOOL_GROUPS[groupName];
          if (group) allowed.push(...group);
        }
      }

      // Remove denied tools
      const denied = new Set<string>();
      if (policy.deny) {
        policy.deny.forEach(t => denied.add(t));
      }
      if (policy.denyGroups) {
        for (const groupName of policy.denyGroups) {
          const group = TOOL_GROUPS[groupName];
          if (group) group.forEach(t => denied.add(t));
        }
      }

      return allowed.filter(t => !denied.has(t));
    },
  };

  return service;
}
