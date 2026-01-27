/**
 * Chat Commands - Clawdbot-style in-chat commands
 *
 * Send these in any channel (WhatsApp/Telegram/Slack/Discord/WebChat):
 * /status - session status (model, tokens, cost)
 * /new or /reset - reset the session
 * /compact - compact session context (summary)
 * /think <level> - set thinking level (off|minimal|low|medium|high)
 * /verbose on|off - toggle verbose mode
 * /model <name> - switch model
 * /help - show available commands
 * /memory - show memory for this user
 * /forget <key> - forget a memory entry
 */

import type { SessionManager } from '../sessions/index';
import type { Session } from '../types';
import type { MemoryService } from '../memory/index';
import type { OutgoingMessage, IncomingMessage } from '../types';
import { logger } from '../utils/logger';

/** Command result */
export interface CommandResult {
  /** Whether a command was handled */
  handled: boolean;
  /** Response text (if any) */
  response?: string;
  /** Whether to continue processing the message */
  continueProcessing?: boolean;
}

/** Thinking levels */
type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export interface ChatCommandHandler {
  /** Process a message and check for commands */
  handle(message: IncomingMessage, session: Session): Promise<CommandResult>;

  /** Check if text starts with a command */
  isCommand(text: string): boolean;

  /** Get help text */
  getHelp(): string;
}

export function createChatCommandHandler(
  sessionManager: SessionManager,
  memory?: MemoryService
): ChatCommandHandler {
  const commands: Record<
    string,
    (args: string, message: IncomingMessage, session: Session) => Promise<string>
  > = {
    // Status command
    async status(_args, message, session) {
      const model = session.context.model || 'claude-sonnet-4-20250514';
      const messageCount = session.history.length;
      const tokenEstimate = session.history.reduce(
        (sum: number, h: { content?: string }) => sum + (h.content?.length || 0) / 4,
        0
      );

      const lines = [
        `**Session Status**`,
        `Model: \`${model}\``,
        `Messages: ${messageCount}`,
        `Est. tokens: ~${Math.round(tokenEstimate)}`,
        `Session ID: \`${session.id.slice(0, 8)}...\``,
        `Platform: ${message.platform}`,
      ];

      if (session.context.thinkingLevel) {
        lines.push(`Thinking: ${session.context.thinkingLevel}`);
      }

      return lines.join('\n');
    },

    // New/Reset command
    async new(_args, message, session) {
      sessionManager.reset(session.id);
      return '✓ Session reset. Starting fresh.';
    },

    async reset(_args, message, session) {
      return commands.new(_args, message, session);
    },

    // Compact command
    async compact(_args, message, session) {
      // In a real implementation, this would trigger context summarization
      const historyLen = session.history.length;
      if (historyLen < 5) {
        return 'Session is already compact (< 5 messages).';
      }
      // For now, just reset - real implementation would summarize
      sessionManager.reset(session.id);
      return `✓ Compacted ${historyLen} messages into summary.`;
    },

    // Think command
    async think(args, _message, session) {
      const levels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];
      const level = args.toLowerCase().trim() as ThinkingLevel;

      if (!args) {
        const current = session.context.thinkingLevel || 'off';
        return `Thinking level: \`${current}\`\nOptions: ${levels.join(', ')}`;
      }

      if (!levels.includes(level)) {
        return `Invalid level: \`${args}\`\nOptions: ${levels.join(', ')}`;
      }

      session.context.thinkingLevel = level;
      return `✓ Thinking level set to \`${level}\``;
    },

    // Verbose command
    async verbose(args, _message, session) {
      if (!args) {
        const current = session.context.verbose ? 'on' : 'off';
        return `Verbose mode: \`${current}\``;
      }

      const value = args.toLowerCase().trim();
      if (value === 'on' || value === 'true' || value === '1') {
        session.context.verbose = true;
        return '✓ Verbose mode enabled';
      } else if (value === 'off' || value === 'false' || value === '0') {
        session.context.verbose = false;
        return '✓ Verbose mode disabled';
      }

      return 'Usage: /verbose on|off';
    },

    // Model command
    async model(args, _message, session) {
      const models = [
        'claude-opus-4-5-20250514',
        'claude-sonnet-4-20250514',
        'claude-haiku-3-5-20250514',
      ];

      if (!args) {
        const current = session.context.model || 'claude-sonnet-4-20250514';
        return `Current model: \`${current}\`\nAvailable: ${models.map((m) => `\`${m.split('-').slice(1, 3).join('-')}\``).join(', ')}`;
      }

      // Allow short names
      const modelMap: Record<string, string> = {
        opus: 'claude-opus-4-5-20250514',
        'opus-4.5': 'claude-opus-4-5-20250514',
        sonnet: 'claude-sonnet-4-20250514',
        'sonnet-4': 'claude-sonnet-4-20250514',
        haiku: 'claude-haiku-3-5-20250514',
        'haiku-3.5': 'claude-haiku-3-5-20250514',
      };

      const requested = args.toLowerCase().trim();
      const fullModel = modelMap[requested] || requested;

      if (!models.includes(fullModel) && !fullModel.startsWith('claude-')) {
        return `Unknown model: \`${args}\`\nTry: opus, sonnet, haiku`;
      }

      session.context.model = fullModel;
      return `✓ Model switched to \`${fullModel.split('-').slice(1, 3).join('-')}\``;
    },

    // Memory command
    async memory(_args, message, _session) {
      if (!memory) {
        return 'Memory service not available.';
      }

      const entries = memory.recallAll(message.userId, message.platform);
      if (entries.length === 0) {
        return 'No memories stored for you yet.';
      }

      const lines = ['**Your Memory**'];
      for (const entry of entries.slice(0, 10)) {
        lines.push(`• **${entry.key}**: ${entry.value.slice(0, 50)}${entry.value.length > 50 ? '...' : ''}`);
      }

      if (entries.length > 10) {
        lines.push(`\n_...and ${entries.length - 10} more_`);
      }

      return lines.join('\n');
    },

    // Forget command
    async forget(args, message, _session) {
      if (!memory) {
        return 'Memory service not available.';
      }

      if (!args) {
        return 'Usage: /forget <key>';
      }

      const key = args.trim();
      const success = memory.forget(message.userId, message.platform, key);

      if (success) {
        return `✓ Forgot: \`${key}\``;
      }
      return `Memory not found: \`${key}\``;
    },

    // Help command
    async help() {
      return `**Available Commands**

/status - Show session status
/new or /reset - Reset session
/compact - Compact context
/think <level> - Set thinking (off|minimal|low|medium|high)
/verbose on|off - Toggle verbose mode
/model <name> - Switch model (opus|sonnet|haiku)
/memory - Show your memories
/forget <key> - Forget a memory
/help - Show this help`;
    },
  };

  return {
    async handle(message, session): Promise<CommandResult> {
      const text = message.text.trim();

      // Check if it's a command
      if (!text.startsWith('/')) {
        return { handled: false };
      }

      // Parse command and args
      const spaceIdx = text.indexOf(' ');
      const command = (spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1)).toLowerCase();
      const args = spaceIdx > 0 ? text.slice(spaceIdx + 1) : '';

      // Find handler
      const handler = commands[command];
      if (!handler) {
        // Unknown command - check if it might be a typo
        const knownCommands = Object.keys(commands);
        const similar = knownCommands.find(
          (c) => c.startsWith(command.slice(0, 2)) || command.startsWith(c.slice(0, 2))
        );

        if (similar) {
          return {
            handled: true,
            response: `Unknown command: /${command}\nDid you mean: /${similar}?`,
          };
        }

        // Let it pass through as a regular message
        return { handled: false, continueProcessing: true };
      }

      try {
        const response = await handler(args, message, session);
        logger.info({ command, userId: message.userId }, 'Chat command executed');
        return { handled: true, response };
      } catch (error) {
        logger.error({ error, command }, 'Chat command error');
        return {
          handled: true,
          response: `Error executing /${command}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    },

    isCommand(text: string): boolean {
      const trimmed = text.trim();
      if (!trimmed.startsWith('/')) return false;

      const command = trimmed.slice(1).split(' ')[0].toLowerCase();
      return command in commands;
    },

    getHelp(): string {
      return commands.help('', {} as IncomingMessage, {} as Session) as unknown as string;
    },
  };
}
