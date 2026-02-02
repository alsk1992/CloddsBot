/**
 * ACP Module - Agent Control Protocol
 *
 * Features:
 * - Agent lifecycle management
 * - Task delegation
 * - Inter-agent communication
 * - State synchronization
 * - Agent orchestration
 */

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  capabilities: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  lastHeartbeat: Date;
}

export type AgentType = 'assistant' | 'worker' | 'supervisor' | 'specialist' | 'router';

export type AgentStatus = 'idle' | 'busy' | 'paused' | 'error' | 'offline';

export interface Task {
  id: string;
  type: string;
  priority: number;
  payload: unknown;
  assignedTo?: string;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  timeout?: number;
}

export type TaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Message {
  id: string;
  from: string;
  to: string;
  type: MessageType;
  payload: unknown;
  timestamp: Date;
  replyTo?: string;
  correlationId?: string;
}

export type MessageType = 'request' | 'response' | 'event' | 'command' | 'heartbeat';

export interface ACPConfig {
  heartbeatInterval?: number;
  taskTimeout?: number;
  maxRetries?: number;
  loadBalancing?: 'round-robin' | 'least-busy' | 'random' | 'capability';
}

// =============================================================================
// AGENT REGISTRY
// =============================================================================

export class AgentRegistry extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private heartbeatChecker: NodeJS.Timeout | null = null;
  private heartbeatInterval: number;

  constructor(heartbeatInterval = 30000) {
    super();
    this.heartbeatInterval = heartbeatInterval;
    this.startHeartbeatChecker();
  }

  /** Register a new agent */
  register(config: {
    name: string;
    type: AgentType;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
  }): Agent {
    const id = `agent-${randomBytes(8).toString('hex')}`;
    const now = new Date();

    const agent: Agent = {
      id,
      name: config.name,
      type: config.type,
      status: 'idle',
      capabilities: config.capabilities || [],
      metadata: config.metadata || {},
      createdAt: now,
      lastHeartbeat: now,
    };

    this.agents.set(id, agent);
    this.emit('agent:register', agent);
    logger.info({ agentId: id, name: config.name }, 'Agent registered');

    return agent;
  }

  /** Unregister an agent */
  unregister(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      this.emit('agent:unregister', { id: agentId, name: agent.name });
      logger.info({ agentId }, 'Agent unregistered');
    }
  }

  /** Update agent status */
  updateStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      const previousStatus = agent.status;
      agent.status = status;
      agent.lastHeartbeat = new Date();
      this.emit('agent:status', { agent, previousStatus });
    }
  }

  /** Record heartbeat */
  heartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = new Date();
    }
  }

  /** Get agent by ID */
  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /** List all agents */
  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  /** List agents by type */
  listByType(type: AgentType): Agent[] {
    return this.list().filter(a => a.type === type);
  }

  /** List agents by capability */
  listByCapability(capability: string): Agent[] {
    return this.list().filter(a => a.capabilities.includes(capability));
  }

  /** List available agents (idle or not offline) */
  listAvailable(): Agent[] {
    return this.list().filter(a => a.status === 'idle');
  }

  /** Find best agent for a task */
  findBest(requirements: {
    type?: AgentType;
    capabilities?: string[];
    preferIdle?: boolean;
  }): Agent | undefined {
    let candidates = this.list().filter(a => a.status !== 'offline' && a.status !== 'error');

    if (requirements.type) {
      candidates = candidates.filter(a => a.type === requirements.type);
    }

    if (requirements.capabilities) {
      candidates = candidates.filter(a =>
        requirements.capabilities!.every(c => a.capabilities.includes(c))
      );
    }

    if (requirements.preferIdle) {
      const idle = candidates.filter(a => a.status === 'idle');
      if (idle.length > 0) {
        candidates = idle;
      }
    }

    // Return least recently used
    return candidates.sort((a, b) =>
      a.lastHeartbeat.getTime() - b.lastHeartbeat.getTime()
    )[0];
  }

  private startHeartbeatChecker(): void {
    this.heartbeatChecker = setInterval(() => {
      const now = Date.now();
      const timeout = this.heartbeatInterval * 2;

      for (const agent of this.agents.values()) {
        if (now - agent.lastHeartbeat.getTime() > timeout && agent.status !== 'offline') {
          const previousStatus = agent.status;
          agent.status = 'offline';
          this.emit('agent:offline', { agent, previousStatus });
          logger.warn({ agentId: agent.id }, 'Agent went offline (heartbeat timeout)');
        }
      }
    }, this.heartbeatInterval);
  }

  /** Stop the registry */
  stop(): void {
    if (this.heartbeatChecker) {
      clearInterval(this.heartbeatChecker);
      this.heartbeatChecker = null;
    }
  }
}

// =============================================================================
// TASK QUEUE
// =============================================================================

export class TaskQueue extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private pendingQueue: Task[] = [];
  private taskTimeout: number;
  private maxRetries: number;
  private retryCount: Map<string, number> = new Map();

  constructor(config: { timeout?: number; maxRetries?: number } = {}) {
    super();
    this.taskTimeout = config.timeout || 300000; // 5 minutes
    this.maxRetries = config.maxRetries || 3;
  }

  /** Submit a new task */
  submit(config: {
    type: string;
    payload: unknown;
    priority?: number;
    timeout?: number;
  }): Task {
    const id = `task-${randomBytes(8).toString('hex')}`;

    const task: Task = {
      id,
      type: config.type,
      payload: config.payload,
      priority: config.priority || 0,
      status: 'pending',
      createdAt: new Date(),
      timeout: config.timeout || this.taskTimeout,
    };

    this.tasks.set(id, task);
    this.pendingQueue.push(task);
    this.pendingQueue.sort((a, b) => b.priority - a.priority);

    this.emit('task:submit', task);
    logger.debug({ taskId: id, type: config.type }, 'Task submitted');

    return task;
  }

  /** Assign task to an agent */
  assign(taskId: string, agentId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'pending') {
      task.assignedTo = agentId;
      task.status = 'assigned';

      // Remove from pending queue
      const index = this.pendingQueue.findIndex(t => t.id === taskId);
      if (index !== -1) {
        this.pendingQueue.splice(index, 1);
      }

      this.emit('task:assign', { task, agentId });
      return task;
    }
    return undefined;
  }

  /** Start a task */
  start(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'assigned') {
      task.status = 'running';
      task.startedAt = new Date();
      this.emit('task:start', task);

      // Set timeout
      setTimeout(() => {
        if (task.status === 'running') {
          this.fail(taskId, 'Task timeout');
        }
      }, task.timeout || this.taskTimeout);

      return task;
    }
    return undefined;
  }

  /** Complete a task */
  complete(taskId: string, result: unknown): Task | undefined {
    const task = this.tasks.get(taskId);
    if (task && (task.status === 'running' || task.status === 'assigned')) {
      task.status = 'completed';
      task.result = result;
      task.completedAt = new Date();
      this.emit('task:complete', task);
      logger.debug({ taskId, duration: task.completedAt.getTime() - (task.startedAt?.getTime() || 0) }, 'Task completed');
      return task;
    }
    return undefined;
  }

  /** Fail a task */
  fail(taskId: string, error: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (task && (task.status === 'running' || task.status === 'assigned')) {
      const retries = this.retryCount.get(taskId) || 0;

      if (retries < this.maxRetries) {
        // Retry the task
        this.retryCount.set(taskId, retries + 1);
        task.status = 'pending';
        task.assignedTo = undefined;
        this.pendingQueue.push(task);
        this.pendingQueue.sort((a, b) => b.priority - a.priority);
        this.emit('task:retry', { task, attempt: retries + 1 });
        logger.debug({ taskId, attempt: retries + 1 }, 'Task retry');
      } else {
        task.status = 'failed';
        task.error = error;
        task.completedAt = new Date();
        this.emit('task:fail', task);
        logger.warn({ taskId, error }, 'Task failed');
      }

      return task;
    }
    return undefined;
  }

  /** Cancel a task */
  cancel(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (task && task.status !== 'completed' && task.status !== 'failed') {
      task.status = 'cancelled';
      task.completedAt = new Date();

      // Remove from pending queue
      const index = this.pendingQueue.findIndex(t => t.id === taskId);
      if (index !== -1) {
        this.pendingQueue.splice(index, 1);
      }

      this.emit('task:cancel', task);
      return task;
    }
    return undefined;
  }

  /** Get task by ID */
  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /** Get next pending task */
  getNext(): Task | undefined {
    return this.pendingQueue[0];
  }

  /** Get all pending tasks */
  getPending(): Task[] {
    return [...this.pendingQueue];
  }

  /** Get tasks by status */
  getByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.status === status);
  }

  /** Get tasks assigned to an agent */
  getByAgent(agentId: string): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.assignedTo === agentId);
  }

  /** Get queue length */
  queueLength(): number {
    return this.pendingQueue.length;
  }
}

// =============================================================================
// MESSAGE BUS
// =============================================================================

export class MessageBus extends EventEmitter {
  private handlers: Map<string, Set<(message: Message) => void>> = new Map();
  private pendingReplies: Map<string, {
    resolve: (message: Message) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  /** Subscribe to messages for an agent */
  subscribe(agentId: string, handler: (message: Message) => void): () => void {
    if (!this.handlers.has(agentId)) {
      this.handlers.set(agentId, new Set());
    }
    this.handlers.get(agentId)!.add(handler);

    return () => {
      this.handlers.get(agentId)?.delete(handler);
    };
  }

  /** Send a message */
  send(message: Omit<Message, 'id' | 'timestamp'>): Message {
    const fullMessage: Message = {
      id: `msg-${randomBytes(8).toString('hex')}`,
      timestamp: new Date(),
      ...message,
    };

    // Deliver to recipient
    const handlers = this.handlers.get(message.to);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(fullMessage);
        } catch (error) {
          logger.error({ error, messageId: fullMessage.id }, 'Message handler error');
        }
      }
    }

    // Check for pending reply
    if (fullMessage.replyTo && fullMessage.type === 'response') {
      const pending = this.pendingReplies.get(fullMessage.replyTo);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(fullMessage);
        this.pendingReplies.delete(fullMessage.replyTo);
      }
    }

    this.emit('message', fullMessage);
    return fullMessage;
  }

  /** Send a request and wait for a response */
  async request(
    from: string,
    to: string,
    payload: unknown,
    timeout = 30000
  ): Promise<Message> {
    const message = this.send({
      from,
      to,
      type: 'request',
      payload,
      correlationId: randomBytes(8).toString('hex'),
    });

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingReplies.delete(message.id);
        reject(new Error('Request timeout'));
      }, timeout);

      this.pendingReplies.set(message.id, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });
    });
  }

  /** Reply to a message */
  reply(originalMessage: Message, payload: unknown): Message {
    return this.send({
      from: originalMessage.to,
      to: originalMessage.from,
      type: 'response',
      payload,
      replyTo: originalMessage.id,
      correlationId: originalMessage.correlationId,
    });
  }

  /** Broadcast to all agents */
  broadcast(from: string, payload: unknown, type: MessageType = 'event'): void {
    for (const agentId of this.handlers.keys()) {
      if (agentId !== from) {
        this.send({ from, to: agentId, type, payload });
      }
    }
  }
}

// =============================================================================
// ORCHESTRATOR
// =============================================================================

export class Orchestrator extends EventEmitter {
  private registry: AgentRegistry;
  private taskQueue: TaskQueue;
  private messageBus: MessageBus;
  private config: Required<ACPConfig>;
  private scheduler: NodeJS.Timeout | null = null;
  private roundRobinIndex = 0;

  constructor(config: ACPConfig = {}) {
    super();
    this.config = {
      heartbeatInterval: config.heartbeatInterval || 30000,
      taskTimeout: config.taskTimeout || 300000,
      maxRetries: config.maxRetries || 3,
      loadBalancing: config.loadBalancing || 'least-busy',
    };

    this.registry = new AgentRegistry(this.config.heartbeatInterval);
    this.taskQueue = new TaskQueue({
      timeout: this.config.taskTimeout,
      maxRetries: this.config.maxRetries,
    });
    this.messageBus = new MessageBus();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // When a task is submitted, try to assign it
    this.taskQueue.on('task:submit', () => {
      this.scheduleAssignment();
    });

    // When an agent becomes available, try to assign pending tasks
    this.registry.on('agent:status', ({ agent, previousStatus }) => {
      if (agent.status === 'idle' && previousStatus !== 'idle') {
        this.scheduleAssignment();
      }
    });

    // When a task completes, mark agent as idle
    this.taskQueue.on('task:complete', (task: Task) => {
      if (task.assignedTo) {
        this.registry.updateStatus(task.assignedTo, 'idle');
      }
    });

    // When a task fails, mark agent as idle
    this.taskQueue.on('task:fail', (task: Task) => {
      if (task.assignedTo) {
        this.registry.updateStatus(task.assignedTo, 'idle');
      }
    });
  }

  private scheduleAssignment(): void {
    // Debounce assignment attempts
    if (this.scheduler) return;

    this.scheduler = setTimeout(() => {
      this.scheduler = null;
      this.assignPendingTasks();
    }, 100);
  }

  private assignPendingTasks(): void {
    let task: Task | undefined;

    while ((task = this.taskQueue.getNext())) {
      const agent = this.selectAgent(task);
      if (!agent) break;

      this.taskQueue.assign(task.id, agent.id);
      this.registry.updateStatus(agent.id, 'busy');

      // Notify the agent
      this.messageBus.send({
        from: 'orchestrator',
        to: agent.id,
        type: 'command',
        payload: { command: 'execute', task },
      });
    }
  }

  private selectAgent(_task: Task): Agent | undefined {
    const available = this.registry.listAvailable();
    if (available.length === 0) return undefined;

    switch (this.config.loadBalancing) {
      case 'round-robin': {
        const agent = available[this.roundRobinIndex % available.length];
        this.roundRobinIndex++;
        return agent;
      }

      case 'random': {
        const index = Math.floor(Math.random() * available.length);
        return available[index];
      }

      case 'least-busy':
      default: {
        // Already filtered to idle, just pick first
        return available[0];
      }
    }
  }

  /** Register an agent */
  registerAgent(config: {
    name: string;
    type: AgentType;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
  }): Agent {
    return this.registry.register(config);
  }

  /** Submit a task */
  submitTask(config: {
    type: string;
    payload: unknown;
    priority?: number;
    timeout?: number;
  }): Task {
    return this.taskQueue.submit(config);
  }

  /** Get the registry */
  getRegistry(): AgentRegistry {
    return this.registry;
  }

  /** Get the task queue */
  getTaskQueue(): TaskQueue {
    return this.taskQueue;
  }

  /** Get the message bus */
  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  /** Stop the orchestrator */
  stop(): void {
    if (this.scheduler) {
      clearTimeout(this.scheduler);
      this.scheduler = null;
    }
    this.registry.stop();
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createAgentRegistry(heartbeatInterval?: number): AgentRegistry {
  return new AgentRegistry(heartbeatInterval);
}

export function createTaskQueue(config?: { timeout?: number; maxRetries?: number }): TaskQueue {
  return new TaskQueue(config);
}

export function createMessageBus(): MessageBus {
  return new MessageBus();
}

export function createOrchestrator(config?: ACPConfig): Orchestrator {
  return new Orchestrator(config);
}

// =============================================================================
// DEFAULT INSTANCES
// =============================================================================

export const orchestrator = new Orchestrator();

// =============================================================================
// COMMERCE MODULES RE-EXPORTS
// =============================================================================

// Escrow - On-chain payment escrow with deposit/release/refund/dispute
export {
  type EscrowStatus,
  type EscrowChain,
  type EscrowParty,
  type EscrowCondition,
  type EscrowConfig,
  type Escrow,
  type EscrowResult,
  type EscrowService,
  getEscrowService,
  initEscrowService,
  formatEscrowAmount,
  createEscrowId,
} from './escrow';

// Agreement - Cryptographic proof-of-agreement with signatures
export {
  type AgreementStatus,
  type AgreementParty,
  type AgreementTerm,
  type AgreementConfig,
  type Agreement,
  type SignaturePayload,
  type AgreementService,
  createAgreementService,
  getAgreementService,
  createServiceAgreement,
  verifyAgreementChain,
} from './agreement';

// Registry - Agent/service marketplace registry
export {
  type AgentCapability,
  type ServicePricing,
  type ServiceListing,
  type AgentReputation,
  type AgentProfile,
  type ServiceCategory,
  type SearchFilters,
  type RegistryService,
  type RegistryStats,
  type ServiceRating,
  CommonCapabilities,
  createRegistryService,
  getRegistryService,
} from './registry';

// Discovery - Intelligent agent/service matching
export {
  type DiscoveryRequest,
  type DiscoveryMatch,
  type NegotiationRequest,
  type NegotiationResult,
  type DiscoveryService,
  createDiscoveryService,
  getDiscoveryService,
  findService,
  quickHire,
} from './discovery';

// Persistence - Database storage layer
export { initACPPersistence } from './persistence';

// Identity - Handles, takeovers, referrals, profiles, leaderboards
export {
  type Handle,
  type TakeoverBid,
  type Referral,
  type AgentProfile as IdentityProfile,
  type LeaderboardEntry,
  type HandleService,
  type TakeoverService,
  type ReferralService,
  type ProfileService,
  type LeaderboardService,
  type IdentityService,
  validateHandle,
  createHandleService,
  createTakeoverService,
  createReferralService,
  createProfileService,
  createLeaderboardService,
  getIdentityService,
  initIdentityPersistence,
} from './identity';

// Predictions - Brier score tracking for agent forecasts
export {
  type Prediction,
  type PredictionStats,
  type PredictionFeedEntry,
  type MarketCategory,
  type PredictionService,
  createPredictionService,
  getPredictionService,
  initPredictions,
  calculateBrierContribution,
  interpretBrierScore,
} from './predictions';

// =============================================================================
// ACP INITIALIZATION
// =============================================================================

import { Database } from '../db';
import { initACPPersistence } from './persistence';
import { initIdentityPersistence } from './identity';
import { initPredictions } from './predictions';

/**
 * Initialize the ACP (Agent Commerce Protocol) module.
 * Must be called before using ACP features to enable database persistence.
 *
 * @param database - The SQLite database instance
 */
export function initACP(database: Database): void {
  initACPPersistence(database);
  initIdentityPersistence(database);
  initPredictions(database);
  logger.info('ACP module initialized with database persistence');
}
