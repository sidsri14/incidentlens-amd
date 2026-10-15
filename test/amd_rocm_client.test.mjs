import assert from 'node:assert/strict';
import test from 'node:test';
import { AmdRocmClient } from '../src/amd_rocm_client.mjs';

test('AmdRocmClient honors an explicit no-key override even when the environment has a key', () => {
  const previous = process.env.AMD_API_KEY;
  process.env.AMD_API_KEY = 'must-not-be-used';
  try {
    const client = new AmdRocmClient({ apiKey: null });
    assert.equal(client.apiKey, null);
  } finally {
    if (previous === undefined) delete process.env.AMD_API_KEY;
    else process.env.AMD_API_KEY = previous;
  }
});

test('AmdRocmClient falls back to deterministic simulated completion when no API key provided', async () => {
  const client = new AmdRocmClient({ apiKey: null });
  const result = await client.complete('Analyze PREMATURE_DISCONNECT in stream [EVT-004]');

  assert.equal(result.simulated, true);
  assert.equal(result.provider, 'amd-rocm-simulation');
  assert.ok(result.content.includes('[EVT-004]'));
  assert.ok(result.usage.total_tokens > 0);
  assert.ok(result.latencyMs >= 0);
});

test('AmdRocmClient rejects non-string prompts', async () => {
  const client = new AmdRocmClient();
  await assert.rejects(async () => client.complete(null), /must be a non-empty string/);
  await assert.rejects(async () => client.complete(''), /must be a non-empty string/);
});

test('AmdRocmClient parses custom model overrides and trims base URL', () => {
  const client = new AmdRocmClient({
    baseUrl: 'https://developer.amd.com.cn/radeon/api/v1///',
    model: 'Qwen3.8-27B',
  });
  assert.equal(client.baseUrl, 'https://developer.amd.com.cn/radeon/api/v1');
  assert.equal(client.model, 'Qwen3.8-27B');
});
