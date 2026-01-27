/**
 * Commands Service - Clawdbot-style slash commands
 *
 * Native commands that work across all channels:
 * /new, /reset - Start fresh session
 * /status - Check agent status and context usage
 * /model - Show/change model
 * /help - Show help
 */

import { SessionManager } from '../sessions/index';
import { Session, IncomingMessage } from '../types';
import { logger } from '../utils/logger';

export interface CommandResult {
  handled: boolean;
  response?: string;
  action?: 'reset_session' | 'show_status' | 'show_help' | 'change_model';
}

export interface CommandsService {
  /** Check if message is a command and handle it */
  handleCommand(message: IncomingMessage, session: Session): Promise<CommandResult>;

  /** Get list of available commands */
  getCommands(): CommandInfo[];
}

export interface CommandInfo {
  name: string;
  description: string;
  usage: string;
}

const NATIVE_COMMANDS: CommandInfo[] = [
  { name: '/new', description: 'Start a fresh conversation', usage: '/new' },
  { name: '/reset', description: 'Reset conversation history', usage: '/reset' },
  { name: '/status', description: 'Show agent status and context usage', usage: '/status' },
  { name: '/model', description: 'Show or change model', usage: '/model [sonnet|opus|haiku]' },
  { name: '/help', description: 'Show available commands', usage: '/help' },
  { name: '/context', description: 'Show context info', usage: '/context' },
];

/** Available models with shortcuts */
const MODEL_ALIASES: Record<string, string> = {
  'sonnet': 'claude-sonnet-4-20250514',
  'opus': 'claude-opus-4-20250514',
  'haiku': 'claude-haiku-3-20240307',
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-haiku-3': 'claude-haiku-3-20240307',
};

export function createCommandsService(sessionManager: SessionManager): CommandsService {
  return {
    async handleCommand(message, session): Promise<CommandResult> {
      const text = message.text.trim();

      // Check if it starts with /
      if (!text.startsWith('/')) {
        return { handled: false };
      }

      const [cmd, ...args] = text.split(/\s+/);
      const command = cmd.toLowerCase();

      switch (command) {
        case '/new':
        case '/reset': {
          // Clear conversation history
          sessionManager.clearHistory(session);

          logger.info({ sessionKey: session.key }, 'Session reset via command');

          return {
            handled: true,
            action: 'reset_session',
            response: `🔄 *Session Reset*\n\nConversation history cleared. Starting fresh!\n\nHow can I help you with prediction markets?`,
          };
        }

        case '/status': {
          const history = sessionManager.getHistory(session);
          const messageCount = history.length;

          // Estimate tokens (rough: ~4 chars per token)
          const totalChars = history.reduce((sum, m) => sum + m.content.length, 0);
          const estimatedTokens = Math.round(totalChars / 4);

          const uptime = Math.round((Date.now() - session.createdAt.getTime()) / 1000 / 60);

          return {
            handled: true,
            action: 'show_status',
            response:
              `📊 *Session Status*\n\n` +
              `*Session ID:* \`${session.id.slice(0, 8)}...\`\n` +
              `*Channel:* ${session.channel}\n` +
              `*Messages:* ${messageCount}\n` +
              `*Est. Tokens:* ~${estimatedTokens.toLocaleString()}\n` +
              `*Uptime:* ${uptime} minutes\n` +
              `*Created:* ${session.createdAt.toISOString().slice(0, 16).replace('T', ' ')}\n\n` +
              `Use \`/new\` to reset the conversation.`,
          };
        }

        case '/model': {
          const defaultModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
          const currentModel = session.context.modelOverride || defaultModel;

          // If no argument, show current model
          if (args.length === 0) {
            const modelList = Object.keys(MODEL_ALIASES)
              .filter(k => !k.includes('-'))
              .map(k => `\`${k}\``)
              .join(', ');

            return {
              handled: true,
              action: 'change_model',
              response:
                `🤖 *Current Model*\n\n` +
                `\`${currentModel}\`\n` +
                (session.context.modelOverride ? `(session override)\n` : `(default)\n`) +
                `\n*Available:* ${modelList}\n` +
                `\n*Usage:* \`/model sonnet\` or \`/model opus\``,
            };
          }

          // Try to switch model
          const requestedModel = args[0].toLowerCase();
          const resolvedModel = MODEL_ALIASES[requestedModel] || requestedModel;

          // Validate it looks like a Claude model
          if (!resolvedModel.startsWith('claude-')) {
            return {
              handled: true,
              response:
                `❌ Unknown model: \`${requestedModel}\`\n\n` +
                `*Available:* sonnet, opus, haiku`,
            };
          }

          // Set model override in session
          session.context.modelOverride = resolvedModel;
          sessionManager.updateSession(session);

          logger.info({ sessionKey: session.key, model: resolvedModel }, 'Model changed via command');

          return {
            handled: true,
            action: 'change_model',
            response:
              `✅ *Model Changed*\n\n` +
              `Now using: \`${resolvedModel}\`\n\n` +
              `Use \`/model\` to see current model or switch again.`,
          };
        }

        case '/context': {
          const history = sessionManager.getHistory(session);

          // Show last few messages
          const recent = history.slice(-5);
          const contextPreview = recent
            .map((m, i) => `${i + 1}. [${m.role}] ${m.content.slice(0, 50)}${m.content.length > 50 ? '...' : ''}`)
            .join('\n');

          return {
            handled: true,
            response:
              `📝 *Context Info*\n\n` +
              `*Total messages:* ${history.length}\n` +
              `*Max kept:* 20\n\n` +
              `*Recent messages:*\n${contextPreview || '(empty)'}`,
          };
        }

        case '/help': {
          const commandList = NATIVE_COMMANDS.map(c => `\`${c.name}\` - ${c.description}`).join('\n');

          return {
            handled: true,
            action: 'show_help',
            response:
              `🎲 *Clodds Commands*\n\n` +
              `*Native Commands:*\n${commandList}\n\n` +
              `*Tips:*\n` +
              `• Just chat naturally for most things\n` +
              `• Ask about any prediction market\n` +
              `• Set alerts, track portfolios, find edge\n\n` +
              `*Platforms:* Polymarket, Kalshi, Manifold, Metaculus, Drift`,
          };
        }

        default:
          // Unknown command - don't handle, let agent process it
          return { handled: false };
      }
    },

    getCommands() {
      return NATIVE_COMMANDS;
    },
  };
}
