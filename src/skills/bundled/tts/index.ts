/**
 * TTS CLI Skill
 *
 * Commands:
 * /tts <text> - Speak text via the configured TTS provider
 * /tts voices - List available voices
 * /tts config - Show TTS config and availability
 */

// Session-level TTS preferences (applied to synthesis calls)
const ttsPrefs: { voice?: string; stability?: number; speed?: number } = {};

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { createTTSService } = await import('../../../tts/index');

    const tts = createTTSService();
    const engine = tts.provider === 'atlas' ? 'Atlas Cloud' : 'ElevenLabs';
    const apiKeyName = tts.provider === 'atlas' ? 'ATLASCLOUD_API_KEY' : 'ELEVENLABS_API_KEY';

    switch (cmd) {
      case 'voices': {
        if (!tts.isAvailable()) {
          return `**TTS Voices**\n\nTTS not configured. Set ${apiKeyName} environment variable.`;
        }
        const voices = await tts.listVoices();
        if (voices.length === 0) {
          return `**TTS Voices**\n\nNo voices returned from ${engine}. Check your API key.`;
        }
        const lines = voices.map(v => {
          const preview = v.preview_url ? ` [preview](${v.preview_url})` : '';
          return `- **${v.name}** (${v.id})${preview}`;
        });
        return `**Available Voices (${voices.length})**\n\n${lines.join('\n')}`;
      }

      case 'config':
      case 'status': {
        const available = tts.isAvailable();
        const voiceDisplay = ttsPrefs.voice || (
          tts.provider === 'atlas' ? 'provider default' : 'Bella (EXAVITQu4vr4xnSDxMaL)'
        );
        const stabilityDisplay = ttsPrefs.stability ?? 0.5;
        return `**TTS Config**\n\n` +
          `Engine: ${engine}\n` +
          `Available: ${available ? 'Yes' : `No (set ${apiKeyName})`}\n` +
          `Voice: ${voiceDisplay}\n` +
          `Default model: ${tts.provider === 'atlas' ? 'elevenlabs/v3/text-to-speech' : 'eleven_monolingual_v1'}\n` +
          `Stability: ${stabilityDisplay}\n` +
          `Similarity boost: 0.75`;
      }

      case 'set': {
        if (parts.length < 3) return 'Usage: /tts set <voice|speed|stability> <value>';
        const key = parts[1]?.toLowerCase();
        const value = parts[2];

        if (key === 'voice') {
          ttsPrefs.voice = value;
          return `Default voice set to **${value}**. All subsequent /tts calls will use this voice.`;
        }
        if (key === 'stability') {
          const num = parseFloat(value);
          if (isNaN(num) || num < 0 || num > 1) return 'Stability must be between 0 and 1.';
          ttsPrefs.stability = num;
          return `Stability set to **${num}**. Applied to all subsequent synthesis.`;
        }
        if (key === 'speed') {
          const num = parseFloat(value);
          if (isNaN(num) || num < 0.5 || num > 2) return 'Speed must be between 0.5 and 2.';
          ttsPrefs.speed = num;
          return `Speed set to **${num}**. Applied to all subsequent synthesis.`;
        }
        return `Unknown setting: ${key}. Valid: voice, speed, stability`;
      }

      case 'help':
        return helpText(engine);

      default: {
        // Everything else is text to speak
        const text = args.trim();
        if (!text) return 'Usage: /tts <text>';

        if (!tts.isAvailable()) {
          return `TTS not configured. Set ${apiKeyName} environment variable.`;
        }

        // Parse optional --voice flag (overrides session default)
        const voiceMatch = text.match(/--voice\s+(\S+)/);
        const voiceId = voiceMatch?.[1] || ttsPrefs.voice;
        const cleanText = text.replace(/--voice\s+\S+/, '').trim();

        const buffer = await tts.synthesize(cleanText, {
          voice: voiceId,
          stability: ttsPrefs.stability,
        });
        return `**TTS Synthesized**\n\n` +
          `Text: "${cleanText.slice(0, 100)}${cleanText.length > 100 ? '...' : ''}"\n` +
          `Audio size: ${(buffer.length / 1024).toFixed(1)} KB\n` +
          `Voice: ${voiceId || (tts.provider === 'atlas' ? 'provider default' : 'default (Bella)')}`;
      }
    }
  } catch (error) {
    return `TTS error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(engine: string): string {
  return `**TTS Commands**

  /tts <text>                        - Speak text via ${engine}
  /tts <text> --voice <id>           - Speak with specific voice
  /tts voices                        - List available voices
  /tts config                        - Show TTS config
  /tts set voice <id>                - Set default voice
  /tts set speed <0.5-2.0>           - Set speech speed`;
}

export default {
  name: 'tts',
  description: 'Text-to-speech synthesis with ElevenLabs or Atlas Cloud',
  commands: ['/tts', '/speak'],
  handle: execute,
};
