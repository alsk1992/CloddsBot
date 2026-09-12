/**
 * TTS (Text-to-Speech) - Clawdbot-style voice synthesis
 *
 * Features:
 * - ElevenLabs and Atlas Cloud integrations
 * - Voice selection
 * - Streaming audio
 * - Voice Wake support
 */

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

export type TTSProvider = 'elevenlabs' | 'atlas';

export interface TTSServiceOptions {
  provider?: TTSProvider;
  apiKey?: string;
  atlasBaseUrl?: string;
  atlasPollIntervalMs?: number;
  atlasMaxPollAttempts?: number;
}

export interface TTSService {
  provider: TTSProvider;
  synthesize(text: string, options?: TTSOptions): Promise<Buffer>;
  streamSynthesize(text: string, options?: TTSOptions): AsyncGenerator<Buffer>;
  listVoices(): Promise<Voice[]>;
  isAvailable(): boolean;
}

interface AtlasPredictionData {
  id?: string;
  outputs?: string[] | null;
  status?: string;
  error?: string;
}

interface AtlasPredictionResponse {
  code?: number;
  message?: string;
  data?: AtlasPredictionData;
}

const ATLAS_MODEL = 'elevenlabs/v3/text-to-speech';
const DEFAULT_ATLAS_BASE_URL = 'https://api.atlascloud.ai/api/v1';

function atlasHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function readAtlasResponse(response: Response, operation: string): Promise<AtlasPredictionResponse> {
  if (!response.ok) {
    throw new Error(`Atlas Cloud ${operation} failed: ${response.status}`);
  }

  const payload = await response.json() as AtlasPredictionResponse;
  if (payload.code !== undefined && payload.code !== 200) {
    throw new Error(`Atlas Cloud ${operation} failed: ${payload.message || payload.code}`);
  }
  return payload;
}

function getCompletedOutput(data: AtlasPredictionData | undefined): string | undefined {
  if (data?.status !== 'completed') return undefined;
  return data.outputs?.[0];
}

function validateHttpsUrl(value: string, label: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS.`);
  }
  return url;
}

async function downloadAtlasOutput(output: string): Promise<Buffer> {
  const response = await fetch(validateHttpsUrl(output, 'Atlas Cloud output URL'));
  if (!response.ok) {
    throw new Error(`Atlas Cloud audio download failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeWithAtlas(
  apiKey: string,
  baseUrl: string,
  text: string,
  options: TTSOptions,
  pollIntervalMs: number,
  maxPollAttempts: number,
): Promise<Buffer> {
  if (text.length < 1 || text.length > 5000) {
    throw new Error('Atlas Cloud TTS text must contain between 1 and 5,000 characters.');
  }

  const body: Record<string, string | number> = {
    model: ATLAS_MODEL,
    text,
    stability: options.stability ?? 0.5,
    apply_text_normalization: 'auto',
  };
  if (options.voice) body.voice = options.voice;

  // Generation is submitted exactly once. Only the read-only status call is polled.
  const submitResponse = await fetch(`${baseUrl}/model/generateAudio`, {
    method: 'POST',
    headers: atlasHeaders(apiKey),
    body: JSON.stringify(body),
  });
  let prediction = await readAtlasResponse(submitResponse, 'generation');

  for (let attempt = 0; attempt <= maxPollAttempts; attempt += 1) {
    const output = getCompletedOutput(prediction.data);
    if (output) return downloadAtlasOutput(output);

    const status = prediction.data?.status;
    if (status === 'completed') {
      throw new Error('Atlas Cloud generation completed without an audio output.');
    }
    if (status === 'failed' || status === 'timeout') {
      throw new Error(`Atlas Cloud generation ${status}: ${prediction.data?.error || 'unknown error'}`);
    }
    if (!prediction.data?.id) {
      throw new Error('Atlas Cloud generation response did not include a request ID.');
    }
    if (attempt === maxPollAttempts) {
      throw new Error('Atlas Cloud generation did not complete before the polling limit.');
    }

    if (pollIntervalMs > 0) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    const pollResponse = await fetch(
      `${baseUrl}/model/prediction/${encodeURIComponent(prediction.data.id)}`,
      { headers: atlasHeaders(apiKey) },
    );
    prediction = await readAtlasResponse(pollResponse, 'status check');
  }

  throw new Error('Atlas Cloud generation did not complete.');
}

async function listAtlasVoices(apiKey: string, baseUrl: string): Promise<Voice[]> {
  const modelsResponse = await fetch(`${baseUrl}/models`, { headers: atlasHeaders(apiKey) });
  if (!modelsResponse.ok) return [];

  const catalog = await modelsResponse.json() as {
    data?: Array<{ model?: string; schema?: string }>;
  };
  const schemaValue = catalog.data?.find(item => item.model === ATLAS_MODEL)?.schema;
  if (!schemaValue) return [];

  const schemaUrl = validateHttpsUrl(schemaValue, 'Atlas Cloud model schema URL');
  if (schemaUrl.hostname !== 'static.atlascloud.ai') {
    throw new Error('Atlas Cloud model schema URL used an unexpected host.');
  }

  const schemaResponse = await fetch(schemaUrl);
  if (!schemaResponse.ok) return [];
  const schema = await schemaResponse.json() as {
    components?: {
      schemas?: {
        Input?: {
          properties?: {
            voice?: {
              'x-enum-options'?: Record<string, { name?: string; example?: string }>;
            };
          };
        };
      };
    };
  };
  const voices = schema.components?.schemas?.Input?.properties?.voice?.['x-enum-options'];
  if (!voices) return [];

  return Object.entries(voices).map(([id, voice]) => ({
    id,
    name: voice.name || id,
    preview_url: voice.example,
  }));
}

/** Create a TTS service. ElevenLabs remains the default provider. */
export function createTTSService(options: TTSServiceOptions = {}): TTSService {
  const requestedProvider = options.provider || process.env.CLODDS_TTS_PROVIDER || 'elevenlabs';
  if (requestedProvider !== 'elevenlabs' && requestedProvider !== 'atlas') {
    throw new Error(`Unsupported TTS provider: ${requestedProvider}`);
  }

  const provider: TTSProvider = requestedProvider;
  const apiKey = options.apiKey || (
    provider === 'atlas' ? process.env.ATLASCLOUD_API_KEY : process.env.ELEVENLABS_API_KEY
  );
  const atlasBaseUrl = (options.atlasBaseUrl || DEFAULT_ATLAS_BASE_URL).replace(/\/+$/, '');
  const atlasPollIntervalMs = Math.max(0, options.atlasPollIntervalMs ?? 1000);
  const atlasMaxPollAttempts = Math.max(1, options.atlasMaxPollAttempts ?? 120);

  return {
    provider,

    async synthesize(text, synthOptions = {}) {
      if (!apiKey) {
        const variable = provider === 'atlas' ? 'ATLASCLOUD_API_KEY' : 'ELEVENLABS_API_KEY';
        throw new Error(`TTS not configured. Set ${variable}.`);
      }

      if (provider === 'atlas') {
        return synthesizeWithAtlas(
          apiKey,
          atlasBaseUrl,
          text,
          synthOptions,
          atlasPollIntervalMs,
          atlasMaxPollAttempts,
        );
      }

      const voiceId = synthOptions.voice || 'EXAVITQu4vr4xnSDxMaL'; // Default: Bella
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: synthOptions.model || 'eleven_monolingual_v1',
          voice_settings: {
            stability: synthOptions.stability ?? 0.5,
            similarity_boost: synthOptions.similarity_boost ?? 0.75,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.status}`);
      }

      return Buffer.from(await response.arrayBuffer());
    },

    async *streamSynthesize(text, synthOptions = {}) {
      const buffer = await this.synthesize(text, synthOptions);
      yield buffer;
    },

    async listVoices() {
      if (!apiKey) return [];
      if (provider === 'atlas') return listAtlasVoices(apiKey, atlasBaseUrl);

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
