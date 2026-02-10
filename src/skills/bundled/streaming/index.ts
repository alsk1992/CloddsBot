/**
 * Streaming CLI Skill
 *
 * Commands:
 * /stream config - Show streaming config
 * /stream set <key> <value> - Set config
 * /stream test - Test streaming output
 * /stream active - List active streams
 * /stream chunk <platform> <text> - Chunk text for platform
 * /stream interrupt <platform> <chatId> - Interrupt a stream
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'config';

  try {
    const { createStreamingService, chunkForPlatform } = await import('../../../streaming/index');

    const service = createStreamingService();

    switch (cmd) {
      case 'config': {
        const config = service.getConfig();
        return `**Streaming Config**\n\n` +
          `Enabled: ${config.enabled}\n` +
          `Min chunk size: ${config.minChunkSize} chars\n` +
          `Flush interval: ${config.flushIntervalMs}ms\n` +
          `Typing indicator: ${config.typingIndicator}`;
      }

      case 'set': {
        if (parts.length < 3) return 'Usage: /stream set <key> <value>\n\nKeys: enabled, minChunkSize, flushIntervalMs, typingIndicator';
        const key = parts[1];
        const value = parts[2];

        // Recreate service with updated config
        const currentConfig = service.getConfig();
        const updates: Record<string, unknown> = {};

        if (key === 'enabled') updates.enabled = value === 'true';
        else if (key === 'minChunkSize') updates.minChunkSize = parseInt(value, 10);
        else if (key === 'flushIntervalMs') updates.flushIntervalMs = parseInt(value, 10);
        else if (key === 'typingIndicator') updates.typingIndicator = value === 'true';
        else return `Unknown config key: ${key}. Valid keys: enabled, minChunkSize, flushIntervalMs, typingIndicator`;

        const updated = createStreamingService({ ...currentConfig, ...updates });
        const newConfig = updated.getConfig();

        return `**Config Updated**\n\n` +
          `Enabled: ${newConfig.enabled}\n` +
          `Min chunk size: ${newConfig.minChunkSize} chars\n` +
          `Flush interval: ${newConfig.flushIntervalMs}ms\n` +
          `Typing indicator: ${newConfig.typingIndicator}`;
      }

      case 'test': {
        const testText = parts.slice(1).join(' ') || 'This is a streaming test message. It demonstrates how the streaming service chunks and delivers content in real-time across different platforms.';
        const telegramChunks = chunkForPlatform(testText, 'telegram');
        const discordChunks = chunkForPlatform(testText, 'discord');

        return `**Streaming Test**\n\n` +
          `Input: ${testText.length} chars\n\n` +
          `Telegram (4096 limit): ${telegramChunks.length} chunk(s)\n` +
          `Discord (2000 limit): ${discordChunks.length} chunk(s)\n\n` +
          `Preview (first chunk):\n${telegramChunks[0] || '(empty)'}`;
      }

      case 'active': {
        const active = service.listActive();
        if (active.length === 0) {
          return '**Active Streams**\n\nNo active streams.';
        }
        const lines = active.map(ctx =>
          `- ${ctx.platform}:${ctx.chatId} | Buffer: ${ctx.buffer.length} chars | Interrupted: ${ctx.interrupted || false}`
        );
        return `**Active Streams (${active.length})**\n\n${lines.join('\n')}`;
      }

      case 'chunk': {
        const platform = parts[1] || 'telegram';
        const text = parts.slice(2).join(' ');
        if (!text) return 'Usage: /stream chunk <platform> <text>\n\nPlatforms: telegram, discord, webchat';
        const chunks = chunkForPlatform(text, platform);
        const output = chunks.map((c, i) => `**Chunk ${i + 1}** (${c.length} chars):\n${c}`).join('\n\n');
        return `**Chunked for ${platform}** (${chunks.length} chunks)\n\n${output}`;
      }

      case 'interrupt': {
        const platform = parts[1];
        const chatId = parts[2];
        if (!platform || !chatId) return 'Usage: /stream interrupt <platform> <chatId>';
        await service.interruptByChat(platform, chatId, 'Manual interrupt via /stream command');
        return `Stream interrupted for ${platform}:${chatId}.`;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Streaming Commands**

  /stream config                     - Show config
  /stream set <key> <value>          - Set config
  /stream test [text]                - Test streaming output
  /stream active                     - List active streams
  /stream chunk <platform> <text>    - Chunk text for platform
  /stream interrupt <platform> <id>  - Interrupt a stream`;
}

export default {
  name: 'streaming',
  description: 'Response streaming configuration and real-time output',
  commands: ['/stream', '/streaming'],
  handle: execute,
};
