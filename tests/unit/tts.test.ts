import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTTSService } from '../../src/tts';

test('ElevenLabs remains the default TTS provider', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestInit: RequestInit | undefined;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof fetch;

  try {
    const service = createTTSService({ apiKey: 'eleven-key' });
    const audio = await service.synthesize('hello');

    assert.equal(service.provider, 'elevenlabs');
    assert.equal(requestUrl, 'https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL');
    assert.equal(requestInit?.method, 'POST');
    assert.equal((requestInit?.headers as Record<string, string>)['xi-api-key'], 'eleven-key');
    assert.deepEqual([...audio], [1, 2, 3]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Atlas Cloud submits once and polls the prediction endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith('/model/generateAudio')) {
      return Response.json({ code: 200, data: { id: 'request/1', status: 'created' } });
    }
    if (url.endsWith('/model/prediction/request%2F1')) {
      return Response.json({
        code: 200,
        data: { id: 'request/1', status: 'completed', outputs: ['https://cdn.example/audio.mp3'] },
      });
    }
    if (url === 'https://cdn.example/audio.mp3') {
      return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const service = createTTSService({
      provider: 'atlas',
      apiKey: 'atlas-key',
      atlasBaseUrl: 'https://api.example/api/v1/',
      atlasPollIntervalMs: 0,
      atlasMaxPollAttempts: 2,
    });
    const audio = await service.synthesize('market alert', {
      voice: 'voice-1',
      stability: 0.7,
      similarity_boost: 0.9,
    });

    assert.equal(service.provider, 'atlas');
    assert.equal(calls.filter(call => call.init?.method === 'POST').length, 1);
    assert.equal(calls[0]?.url, 'https://api.example/api/v1/model/generateAudio');
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      model: 'elevenlabs/v3/text-to-speech',
      text: 'market alert',
      stability: 0.7,
      apply_text_normalization: 'auto',
      voice: 'voice-1',
    });
    assert.equal(calls[1]?.url, 'https://api.example/api/v1/model/prediction/request%2F1');
    assert.deepEqual([...audio], [4, 5, 6]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Atlas Cloud reads voice choices from the live model schema', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/models')) {
      return Response.json({
        data: [{
          model: 'elevenlabs/v3/text-to-speech',
          schema: 'https://static.atlascloud.ai/model/schema/tts.json',
        }],
      });
    }
    if (url === 'https://static.atlascloud.ai/model/schema/tts.json') {
      return Response.json({
        components: {
          schemas: {
            Input: {
              properties: {
                voice: {
                  'x-enum-options': {
                    'voice-1': { name: 'Test Voice', example: 'https://static.atlascloud.ai/voice.mp3' },
                  },
                },
              },
            },
          },
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  try {
    const service = createTTSService({
      provider: 'atlas',
      apiKey: 'atlas-key',
      atlasBaseUrl: 'https://api.example/api/v1',
    });
    assert.deepEqual(await service.listVoices(), [{
      id: 'voice-1',
      name: 'Test Voice',
      preview_url: 'https://static.atlascloud.ai/voice.mp3',
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Atlas Cloud surfaces terminal generation failures without resubmitting', async () => {
  const originalFetch = globalThis.fetch;
  let postCount = 0;

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') postCount += 1;
    return Response.json({
      code: 200,
      data: { id: 'request-1', status: 'failed', error: 'invalid input' },
    });
  }) as typeof fetch;

  try {
    const service = createTTSService({ provider: 'atlas', apiKey: 'atlas-key' });
    await assert.rejects(() => service.synthesize('hello'), /invalid input/);
    assert.equal(postCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Atlas Cloud rejects invalid text before submitting generation', async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return Response.json({ code: 200 });
  }) as typeof fetch;

  try {
    const service = createTTSService({ provider: 'atlas', apiKey: 'atlas-key' });
    await assert.rejects(() => service.synthesize(''), /between 1 and 5,000 characters/);
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
