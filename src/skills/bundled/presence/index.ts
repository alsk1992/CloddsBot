/**
 * Presence CLI Skill
 *
 * Commands:
 * /presence - Show status
 * /presence set <status> - Set status (online/away/dnd)
 * /presence devices - List devices
 * /presence typing <platform> <chatId> - Show typing state
 * /presence stop-all - Stop all typing indicators
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'show';

  try {
    const { createPresenceService } = await import('../../../presence/index');
    const presence = createPresenceService();

    switch (cmd) {
      case 'show':
      case '': {
        // Gather status from the presence service
        // Check a few common platforms for typing state
        const platforms = ['telegram', 'discord', 'slack', 'cli'];
        const typingInfo: string[] = [];

        for (const platform of platforms) {
          if (presence.isTyping(platform, 'default')) {
            typingInfo.push(`  - ${platform}: typing`);
          }
        }

        let output = '**Presence Status**\n\n';
        output += `Status: Online\n`;
        output += `Device: CLI\n`;
        output += `Since: ${new Date().toLocaleString()}\n`;

        if (typingInfo.length > 0) {
          output += `\n**Active Typing Indicators**\n${typingInfo.join('\n')}`;
        } else {
          output += `\nNo active typing indicators.`;
        }

        return output;
      }

      case 'set': {
        return 'The presence service manages typing indicators, not user status. Use `/presence start-typing` and `/presence stop-typing` to control typing state.';
      }

      case 'devices': {
        // Report real typing state per registered platform
        const knownPlatforms = ['telegram', 'discord', 'slack', 'cli'];
        let deviceOutput = '**Connected Platforms**\n\n';
        let found = false;
        for (const p of knownPlatforms) {
          const active = presence.isTyping(p, 'default');
          if (active) {
            deviceOutput += `  - ${p}: active (typing)\n`;
            found = true;
          }
        }
        if (!found) {
          deviceOutput += 'No platforms currently active. Start a typing indicator to register activity.';
        }
        return deviceOutput;
      }

      case 'typing': {
        const platform = parts[1];
        const chatId = parts[2] || 'default';
        if (!platform) {
          return 'Usage: /presence typing <platform> [chatId]\n\nCheck if a typing indicator is active for a platform/chat.';
        }
        const isTyping = presence.isTyping(platform, chatId);
        return `Typing indicator for **${platform}** (chat: ${chatId}): ${isTyping ? 'Active' : 'Inactive'}`;
      }

      case 'start-typing': {
        const platform = parts[1];
        const chatId = parts[2] || 'default';
        if (!platform) {
          return 'Usage: /presence start-typing <platform> [chatId]';
        }
        presence.startTyping(platform, chatId);
        return `Started typing indicator for **${platform}** (chat: ${chatId}).`;
      }

      case 'stop-typing': {
        const platform = parts[1];
        const chatId = parts[2] || 'default';
        if (!platform) {
          return 'Usage: /presence stop-typing <platform> [chatId]';
        }
        presence.stopTyping(platform, chatId);
        return `Stopped typing indicator for **${platform}** (chat: ${chatId}).`;
      }

      case 'stop-all': {
        presence.stopAll();
        return 'All typing indicators stopped.';
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Presence Commands**

  /presence                              - Show typing status
  /presence devices                      - Active platforms
  /presence typing <platform> [chatId]   - Check typing indicator state
  /presence start-typing <platform> [id] - Start typing indicator
  /presence stop-typing <platform> [id]  - Stop typing indicator
  /presence stop-all                     - Stop all typing indicators`;
}

export default {
  name: 'presence',
  description: 'Online status, activity tracking, and multi-device sync',
  commands: ['/presence'],
  handle: execute,
};
