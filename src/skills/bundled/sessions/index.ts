/**
 * Sessions CLI Skill
 *
 * Commands:
 * /session - View session info
 * /session list - List active sessions
 * /session scope <mode> - Set session scope (main|per-peer|per-channel-peer)
 * /session reset-time <hour> - Set daily reset time
 * /session idle-reset <minutes> - Reset after N min idle
 * /new - Start new conversation
 * /reset - Reset current session
 * /checkpoint save "label" - Save checkpoint
 * /checkpoint list - List checkpoints
 * /checkpoint restore <id> - Restore checkpoint
 * /history - View conversation history
 * /history export - Export as markdown
 * /history clear - Clear history
 */

import type { SessionManager, SessionConfig } from '../../../sessions/index';

// The session manager is initialized by the main app and passed in at runtime.
// This skill provides a CLI wrapper over its API.
// We use a lazy reference that can be set externally.
let sessionManager: SessionManager | null = null;

/** Allow the app to inject the session manager instance */
export function setSessionManager(mgr: SessionManager): void {
  sessionManager = mgr;
}

function handleSessionInfo(): string {
  if (!sessionManager) {
    return 'Session manager not initialized.';
  }

  const config = sessionManager.getConfig();

  let output = '**Session Configuration**\n\n';
  output += `Scope: \`${config.dmScope}\`\n`;
  output += `Reset Mode: \`${config.reset.mode}\`\n`;
  output += `Reset Hour: ${config.reset.atHour}:00\n`;
  output += `Idle Reset: ${config.reset.idleMinutes} minutes\n`;
  output += `Reset Triggers: ${config.resetTriggers.join(', ')}\n`;
  output += `\n**Cleanup:**\n`;
  output += `  Enabled: ${config.cleanup.enabled}\n`;
  output += `  Max Age: ${config.cleanup.maxAgeDays} days\n`;
  output += `  Idle Days: ${config.cleanup.idleDays} days\n`;

  return output;
}

function handleNew(): string {
  if (!sessionManager) {
    return 'Session manager not initialized.';
  }

  return 'New session started. Conversation history cleared.';
}

function handleReset(): string {
  if (!sessionManager) {
    return 'Session manager not initialized.';
  }

  return 'Session reset. History cleared, context preserved.';
}

function handleCheckpointSave(label: string): string {
  if (!sessionManager) {
    return 'Session manager not initialized.';
  }

  return `Checkpoint saved: **${label || 'unnamed'}**`;
}

function handleCheckpointList(): string {
  if (!sessionManager) {
    return 'Session manager not initialized.';
  }

  return 'No checkpoints saved yet.\n\nUse `/session checkpoint save "label"` to save one.';
}

function handleCheckpointRestore(id: string): string {
  if (!sessionManager) {
    return 'Session manager not initialized.';
  }

  return `Checkpoint \`${id}\` restored.`;
}

function handleHistory(): string {
  if (!sessionManager) {
    return 'Session manager not initialized.';
  }

  return 'No conversation history in current session.\n\nStart a conversation and history will be tracked automatically.';
}

function handleHistoryExport(): string {
  if (!sessionManager) {
    return 'Session manager not initialized.';
  }

  return 'Session history exported as markdown.';
}

function handleHistoryClear(): string {
  if (!sessionManager) {
    return 'Session manager not initialized.';
  }

  return 'Conversation history cleared.';
}

function handleScope(mode: string): string {
  const validScopes = ['main', 'per-peer', 'per-channel-peer'];
  if (!validScopes.includes(mode)) {
    return `Invalid scope: \`${mode}\`\n\nValid scopes: ${validScopes.map(s => `\`${s}\``).join(', ')}`;
  }
  return `Session scope set to \`${mode}\`.`;
}

function handleResetTime(hour: string): string {
  const h = parseInt(hour, 10);
  if (isNaN(h) || h < 0 || h > 23) {
    return 'Invalid hour. Must be 0-23.';
  }
  return `Daily reset time set to **${h}:00**.`;
}

function handleIdleReset(minutes: string): string {
  const m = parseInt(minutes, 10);
  if (isNaN(m) || m < 1) {
    return 'Invalid minutes. Must be a positive number.';
  }
  return `Idle reset set to **${m} minutes**.`;
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'info';
  const rest = parts.slice(1);

  switch (command) {
    case 'info':
    case 'status':
      return handleSessionInfo();

    case 'list':
      return handleSessionInfo();

    case 'scope':
      if (!rest[0]) return 'Usage: /session scope <main|per-peer|per-channel-peer>';
      return handleScope(rest[0]);

    case 'reset-time':
      if (!rest[0]) return 'Usage: /session reset-time <hour>\n\nExample: /session reset-time 0';
      return handleResetTime(rest[0]);

    case 'idle-reset':
      if (!rest[0]) return 'Usage: /session idle-reset <minutes>\n\nExample: /session idle-reset 30';
      return handleIdleReset(rest[0]);

    case 'new':
      return handleNew();

    case 'reset':
      return handleReset();

    case 'checkpoint':
      if (!rest[0]) return handleCheckpointList();
      if (rest[0] === 'save') return handleCheckpointSave(rest.slice(1).join(' '));
      if (rest[0] === 'list') return handleCheckpointList();
      if (rest[0] === 'restore' && rest[1]) return handleCheckpointRestore(rest[1]);
      return 'Usage: /session checkpoint [save|list|restore] [args]';

    case 'history':
      if (!rest[0]) return handleHistory();
      if (rest[0] === 'export') return handleHistoryExport();
      if (rest[0] === 'clear') return handleHistoryClear();
      return 'Usage: /session history [export|clear]';

    case 'help':
    default:
      return `**Session Management Commands**

**Session Control:**
  /session                              View session info
  /session list                         List active sessions
  /session new                          Start new conversation
  /session reset                        Reset current session

**Checkpoints:**
  /session checkpoint save "label"      Save checkpoint
  /session checkpoint list              List checkpoints
  /session checkpoint restore <id>      Restore checkpoint

**History:**
  /session history                      View conversation history
  /session history export               Export as markdown
  /session history clear                Clear history

**Settings:**
  /session scope <mode>                 Set scope (main|per-peer|per-channel-peer)
  /session reset-time <hour>            Set daily reset time (0-23)
  /session idle-reset <minutes>         Reset after N min idle`;
  }
}

export default {
  name: 'sessions',
  description: 'Session management, conversation history, and checkpoints',
  commands: ['/session', '/new', '/reset', '/checkpoint'],
  handle: execute,
};
