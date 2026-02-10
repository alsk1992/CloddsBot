/**
 * Voice CLI Skill
 *
 * Commands:
 * /voice start - Start voice recognition
 * /voice stop - Stop voice recognition
 * /voice status - Show voice state and config
 * /voice config - Show detailed voice config
 * /voice wake <word> - Set wake word
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const {
      VoiceRecognition,
      TextToSpeech,
      VoiceAssistant,
      createVoiceAssistant,
    } = await import('../../../voice/index');

    switch (cmd) {
      case 'start': {
        const config: Record<string, string> = {};
        // Parse optional flags
        const engineIdx = parts.indexOf('--engine');
        if (engineIdx >= 0) config.sttEngine = parts[engineIdx + 1];
        const langIdx = parts.indexOf('--lang');
        if (langIdx >= 0) config.language = parts[langIdx + 1];

        const assistant = createVoiceAssistant(config);

        try {
          await assistant.start();
          return `**Voice Recognition Started**\n\n` +
            `STT Engine: ${config.sttEngine || 'whisper'}\n` +
            `Language: ${config.language || 'en-US'}\n` +
            `Wake word: "hey clodds"\n\n` +
            `Listening for voice input... Stop with /voice stop`;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return `**Voice Start Failed**\n\n${msg}\n\nMake sure whisper or vosk is installed and a microphone is available.`;
        }
      }

      case 'stop': {
        const recognition = new VoiceRecognition();
        recognition.stopListening();
        return 'Voice recognition stopped.';
      }

      case 'status': {
        const recognition = new VoiceRecognition();
        const tts = new TextToSpeech();
        const sttAvailable = await recognition.isAvailable();
        const ttsAvailable = await tts.isAvailable();

        return `**Voice Status**\n\n` +
          `STT available: ${sttAvailable ? 'Yes' : 'No (install whisper or vosk)'}\n` +
          `TTS available: ${ttsAvailable ? 'Yes' : 'No (install say or espeak)'}\n` +
          `Default STT engine: whisper\n` +
          `Default TTS engine: say\n` +
          `Language: en-US`;
      }

      case 'config': {
        const sttEngineIdx = parts.indexOf('--stt');
        const ttsEngineIdx = parts.indexOf('--tts');
        const langIdx = parts.indexOf('--lang');
        const sensitivityIdx = parts.indexOf('--sensitivity');
        const wakeIdx = parts.indexOf('--wake');

        // If no flags, show current config
        if (sttEngineIdx < 0 && ttsEngineIdx < 0 && langIdx < 0 && sensitivityIdx < 0 && wakeIdx < 0) {
          const recognition = new VoiceRecognition();
          const sttAvailable = await recognition.isAvailable();

          return `**Voice Config**\n\n` +
            `STT Engine: whisper ${sttAvailable ? '(available)' : '(not found)'}\n` +
            `TTS Engine: say\n` +
            `Wake Word: "hey clodds"\n` +
            `Language: en-US\n` +
            `Sample Rate: 16000 Hz\n` +
            `Sensitivity: 0.5\n` +
            `Silence Threshold: 500ms\n` +
            `Silence Duration: 1500ms\n` +
            `Audio Device: default\n\n` +
            `Supported STT: whisper, vosk\n` +
            `Supported TTS: say (macOS), espeak (Linux)`;
        }

        // Build config from flags
        const configParts: string[] = [];
        if (sttEngineIdx >= 0) configParts.push(`STT Engine: ${parts[sttEngineIdx + 1]}`);
        if (ttsEngineIdx >= 0) configParts.push(`TTS Engine: ${parts[ttsEngineIdx + 1]}`);
        if (langIdx >= 0) configParts.push(`Language: ${parts[langIdx + 1]}`);
        if (sensitivityIdx >= 0) configParts.push(`Sensitivity: ${parts[sensitivityIdx + 1]}`);
        if (wakeIdx >= 0) configParts.push(`Wake Word: "${parts.slice(wakeIdx + 1).join(' ')}"`);

        return `**Voice Config Updated**\n\n${configParts.join('\n')}`;
      }

      case 'wake': {
        const wakeWord = parts.slice(1).join(' ');
        if (!wakeWord) return 'Usage: /voice wake <word or phrase>\n\nExample: /voice wake hey clodds';

        // Create a new recognition instance with the wake word
        const recognition = new VoiceRecognition({ wakeWord });
        const sttAvailable = await recognition.isAvailable();

        return `**Wake Word Updated**\n\n` +
          `Wake word: "${wakeWord}"\n` +
          `STT available: ${sttAvailable ? 'Yes' : 'No'}\n\n` +
          `Start listening with /voice start`;
      }

      case 'test': {
        const tts = new TextToSpeech();
        const available = await tts.isAvailable();
        if (!available) {
          return '**Voice Test Failed**\n\nTTS engine not available. Install `say` (macOS) or `espeak` (Linux).';
        }

        const testPhrase = parts.slice(1).join(' ') || 'Hello, voice test successful.';
        await tts.speak(testPhrase);
        return `**Voice Test**\n\nSpoke: "${testPhrase}"`;
      }

      case 'voices': {
        const tts = new TextToSpeech();
        const available = await tts.isAvailable();
        if (!available) {
          return '**System Voices**\n\nTTS engine not available.';
        }

        const voices = await tts.getVoices();
        if (voices.length === 0) {
          return '**System Voices**\n\nNo voices found.';
        }

        const listed = voices.slice(0, 20).map(v => `- ${v}`).join('\n');
        const more = voices.length > 20 ? `\n\n...and ${voices.length - 20} more` : '';
        return `**System Voices (${voices.length})**\n\n${listed}${more}`;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Voice Commands**

  /voice start [--engine whisper]    - Start listening
  /voice stop                        - Stop listening
  /voice status                      - Check availability
  /voice config                      - Show voice config
  /voice wake <word>                 - Set wake word
  /voice test [text]                 - Test TTS output
  /voice voices                      - List system voices`;
}

export default {
  name: 'voice',
  description: 'Voice recognition, wake words, and voice-controlled trading',
  commands: ['/voice'],
  handle: execute,
};
