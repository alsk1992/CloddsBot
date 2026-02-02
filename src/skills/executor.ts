/**
 * Skill Executor - Wire up bundled skill handlers for command execution
 *
 * This module loads bundled skill handlers and provides a unified interface
 * for executing skill commands.
 */

import { logger } from '../utils/logger';

// Import bundled skill handlers
import binanceFuturesSkill from './bundled/binance-futures';
import bybitFuturesSkill from './bundled/bybit-futures';
import mexcFuturesSkill from './bundled/mexc-futures';
import hyperliquidSkill from './bundled/hyperliquid';
import opinionSkill from './bundled/opinion';
import hardenSkill from './bundled/harden';
import tweetIdeasSkill from './bundled/tweet-ideas';
import ticksSkill from './bundled/ticks';
import featuresSkill from './bundled/features';

// =============================================================================
// TYPES
// =============================================================================

export interface SkillHandler {
  name: string;
  description: string;
  commands: string[] | Array<{ name: string; description: string; usage: string }>;
  /** Handler function (can be named 'handle' or 'handler') */
  handle?: (args: string) => Promise<string>;
  handler?: (args: string) => Promise<string>;
}

/** Normalized skill handler with guaranteed handle function */
interface NormalizedSkillHandler {
  name: string;
  description: string;
  commands: string[];
  handle: (args: string) => Promise<string>;
}

/** Normalize skill handler to consistent interface */
function normalizeSkill(skill: SkillHandler): NormalizedSkillHandler {
  // Normalize commands array (some skills have {name,description,usage} format)
  const commands: string[] = skill.commands.map((cmd) =>
    typeof cmd === 'string' ? cmd : cmd.name
  );

  // Use handle or handler method
  const handleFn = skill.handle || skill.handler;
  if (!handleFn) {
    throw new Error(`Skill ${skill.name} has no handle or handler method`);
  }

  return {
    name: skill.name,
    description: skill.description,
    commands,
    handle: handleFn,
  };
}

// =============================================================================
// SKILL REGISTRY
// =============================================================================

/** Map of command prefix to skill handler */
const commandToSkill = new Map<string, NormalizedSkillHandler>();

/** All registered skill handlers */
const registeredSkills: NormalizedSkillHandler[] = [];

/**
 * Register a skill handler
 */
function registerSkill(skill: SkillHandler): void {
  try {
    const normalized = normalizeSkill(skill);
    registeredSkills.push(normalized);
    for (const cmd of normalized.commands) {
      const normalizedCmd = cmd.toLowerCase().startsWith('/') ? cmd.toLowerCase() : `/${cmd.toLowerCase()}`;
      commandToSkill.set(normalizedCmd, normalized);
      logger.debug({ skill: normalized.name, command: normalizedCmd }, 'Registered skill command');
    }
  } catch (error) {
    logger.error({ skill: skill.name, error }, 'Failed to register skill');
  }
}

// Register bundled skills
registerSkill(binanceFuturesSkill as unknown as SkillHandler);
registerSkill(bybitFuturesSkill as unknown as SkillHandler);
registerSkill(mexcFuturesSkill as unknown as SkillHandler);
registerSkill(hyperliquidSkill as unknown as SkillHandler);
registerSkill(opinionSkill as unknown as SkillHandler);
registerSkill(hardenSkill as unknown as SkillHandler);
registerSkill(tweetIdeasSkill as unknown as SkillHandler);
registerSkill(ticksSkill as unknown as SkillHandler);
registerSkill(featuresSkill as unknown as SkillHandler);

logger.info({ count: registeredSkills.length }, 'Bundled skill handlers registered');

// =============================================================================
// EXECUTOR
// =============================================================================

export interface SkillExecutionResult {
  handled: boolean;
  response?: string;
  error?: string;
  skill?: string;
}

/**
 * Execute a skill command
 *
 * @param message - The full message text (e.g., "/bf balance")
 * @returns Result of execution
 */
export async function executeSkillCommand(message: string): Promise<SkillExecutionResult> {
  const trimmed = message.trim();

  // Check if it's a command
  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }

  // Parse command and arguments
  const spaceIndex = trimmed.indexOf(' ');
  const command = spaceIndex === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIndex).toLowerCase();
  const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1);

  // Find matching skill handler
  const skill = commandToSkill.get(command);
  if (!skill) {
    return { handled: false };
  }

  try {
    logger.info({ skill: skill.name, command, args }, 'Executing skill command');
    const response = await skill.handle(args);
    return {
      handled: true,
      response,
      skill: skill.name,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ skill: skill.name, command, error: errorMessage }, 'Skill command failed');
    return {
      handled: true,
      error: errorMessage,
      skill: skill.name,
    };
  }
}

/**
 * Get all registered skill handlers
 */
export function getRegisteredSkills(): NormalizedSkillHandler[] {
  return [...registeredSkills];
}

/**
 * Get skill handler by command
 */
export function getSkillByCommand(command: string): NormalizedSkillHandler | undefined {
  const normalized = command.toLowerCase().startsWith('/') ? command.toLowerCase() : `/${command.toLowerCase()}`;
  return commandToSkill.get(normalized);
}

/**
 * Check if a command is handled by a skill
 */
export function isSkillCommand(command: string): boolean {
  const normalized = command.toLowerCase().startsWith('/') ? command.toLowerCase() : `/${command.toLowerCase()}`;
  return commandToSkill.has(normalized);
}

/**
 * Get all registered skill commands
 */
export function getSkillCommands(): Array<{ command: string; skill: string; description: string }> {
  const commands: Array<{ command: string; skill: string; description: string }> = [];
  for (const skill of registeredSkills) {
    for (const cmd of skill.commands) {
      commands.push({
        command: cmd,
        skill: skill.name,
        description: skill.description,
      });
    }
  }
  return commands;
}
