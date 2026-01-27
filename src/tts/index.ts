/**
 * TTS (Text-to-Speech) - Clawdbot-style voice synthesis
 *
 * Features:
 * - ElevenLabs integration
 * - Voice selection
 * - Streaming audio
 * - Voice Wake support
 */

import { logger } from '../utils/logger';

export interface Voice {
  id: string;
  name: string;
  preview_url?: string;
}

export interface TTSOptions {
  voice?: string;
  model?: string;
  stability?: number;
  similarity_boost?: number;
}

export interface TTSService {
  synthesize(text: string, options?: TTSOptions): Promise<Buffer>;
  streamSynthesize(text: string, options?: TTSOptions): AsyncGenerator<Buffer>;
  listVoices(): Promise<Voice[]>;
  isAvailable(): boolean;
}

/** Create TTS service (requires ELEVENLABS_API_KEY) */
export function createTTSService(): TTSService {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  return {
    async synthesize(text, options = {}) {
      if (!apiKey) {
        throw new Error('TTS not configured. Set ELEVENLABS_API_KEY.');
      }

      const voiceId = options.voice || 'EXAVITQu4vr4xnSDxMaL'; // Default: Bella
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: options.model || 'eleven_monolingual_v1',
          voice_settings: {
            stability: options.stability ?? 0.5,
            similarity_boost: options.similarity_boost ?? 0.75,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    },

    async *streamSynthesize(text, options = {}) {
      // For now, just return the full buffer
      const buffer = await this.synthesize(text, options);
      yield buffer;
    },

    async listVoices() {
      if (!apiKey) return [];

      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey },
      });

      if (!response.ok) return [];

      const data = await response.json() as { voices: Voice[] };
      return data.voices || [];
    },

    isAvailable() {
      return !!apiKey;
    },
  };
}
