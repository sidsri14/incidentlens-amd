import assert from 'node:assert/strict';
import test from 'node:test';

import { AmdRocmClient } from '../src/amd_rocm_client.mjs';
import { createVercelHandler } from '../src/vercel_handler.mjs';

function createResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    end(body = '') {
      this.body = body;
    },
  };
}

test('Vercel analyze handler runs the deterministic no-key evaluation path', async () => {
  const handler = createVercelHandler('analyze', {
    amdClient: new AmdRocmClient({ apiKey: null }),
  });
  const response = createResponse();

  await handler({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { presetId: 'premature-disconnect' },
  }, response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.success, true);
  assert.equal(payload.analysis.simulated, true);
  assert.equal(payload.citationVerification.valid, true);
  assert.equal(response.getHeader('x-content-type-options'), 'nosniff');
});

test('Vercel health handler labels its inference mode truthfully', async () => {
  const handler = createVercelHandler('health', {
    amdClient: new AmdRocmClient({ apiKey: null }),
  });
  const response = createResponse();

  await handler({ method: 'GET', headers: {} }, response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.inferenceMode, 'deterministic-simulation');
  assert.equal(payload.amdConfigured, false);
});
