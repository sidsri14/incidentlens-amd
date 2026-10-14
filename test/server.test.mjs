import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createIncidentLensServer } from '../src/server.mjs';
import { AmdRocmClient } from '../src/amd_rocm_client.mjs';

test('IncidentLens server exposes /health, /api/presets, and /api/analyze', async (context) => {
  const amdClient = new AmdRocmClient({ apiKey: null }); // Use simulation in unit tests
  const server = createIncidentLensServer({ amdClient });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Check Health
  const healthRes = await fetch(`${baseUrl}/health`);
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.status, 'ok');
  assert.equal(health.service, 'incidentlens-amd');

  // 2. Check Presets
  const presetsRes = await fetch(`${baseUrl}/api/presets`);
  assert.equal(presetsRes.status, 200);
  const presets = await presetsRes.json();
  assert.ok(Array.isArray(presets.presets));
  assert.equal(presets.presets.length, 3);
  assert.equal(presets.presets[0].id, 'premature-disconnect');

  // 3. Check Analyze with presetId
  const analyzeRes = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetId: 'premature-disconnect' }),
  });
  assert.equal(analyzeRes.status, 200);
  const data = await analyzeRes.json();
  assert.equal(data.success, true);
  assert.ok(data.anomalies.length > 0);
  assert.equal(data.anomalies[0].type, 'PREMATURE_DISCONNECT');
  assert.ok(data.analysis.content.length > 0);
  assert.equal(data.citationVerification.valid, true);
  assert.ok(data.rocmPerformance.totalLatencyMs >= 0);
});

test('IncidentLens server rejects malformed or non-JSON payloads', async (context) => {
  const server = createIncidentLensServer({ amdClient: new AmdRocmClient({ apiKey: null }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const nonJson = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    body: 'not a json',
  });
  assert.equal(nonJson.status, 415);

  const missingEvents = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(missingEvents.status, 400);
});
