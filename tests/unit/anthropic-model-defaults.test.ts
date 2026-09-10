import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnthropicProvider } from '../../src/providers/index';

const RETIRED_MODELS = [
  'claude-3-haiku-20240307',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
  'claude-sonnet-4-20250514',
];

test('runtime model defaults do not use retired Anthropic IDs', () => {
  const runtimeFiles = [
    'src/cli/commands/index.ts',
    'src/cli/commands/onboard.ts',
    'src/doctor/index.ts',
    'src/extensions/open-prose/index.ts',
    'src/extensions/task-runner/index.ts',
    'src/memory/summarizer.ts',
    'src/media/index.ts',
    'src/skills/bundled/usage/index.ts',
    'src/tools/image.ts',
    'src/usage/index.ts',
  ];

  for (const relativePath of runtimeFiles) {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
    for (const retiredModel of RETIRED_MODELS) {
      assert.equal(
        source.includes(retiredModel),
        false,
        `${relativePath} still references retired model ${retiredModel}`,
      );
    }
  }
});

test('Anthropic provider uses active defaults for completion and health checks', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({
      content: [{ text: 'ok' }],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.complete([{ role: 'user', content: 'hello' }]);
    await provider.isAvailable();

    assert.equal(requests[0].body.model, 'claude-sonnet-4-6');
    assert.equal(requests[1].body.model, 'claude-haiku-4-5-20251001');
    assert.deepEqual(await provider.listModels(), [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
