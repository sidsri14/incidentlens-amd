import assert from 'node:assert/strict';
import test from 'node:test';
import { TraceParser, ANOMALY_TYPES } from '../src/trace_parser.mjs';

test('TraceParser detects PREMATURE_DISCONNECT and ghost spend', () => {
  const parser = new TraceParser();
  const events = [
    { id: 'EVT-001', timestamp: 0, type: 'HTTP_REQUEST_STARTED', streaming: true },
    { id: 'EVT-002', timestamp: 100, type: 'SSE_CHUNK_RECEIVED', chunkIndex: 1, tokenCount: 15, isDoneMarker: false },
    { id: 'EVT-003', timestamp: 200, type: 'STREAM_TERMINATED', reason: 'client_abort' },
  ];

  const result = parser.parse(events);
  assert.equal(result.metrics.hasDoneMarker, false);
  assert.equal(result.metrics.isStreaming, true);
  assert.equal(result.metrics.totalTokens, 15);

  const disconnect = result.anomalies.find((a) => a.type === ANOMALY_TYPES.PREMATURE_DISCONNECT);
  assert.ok(disconnect, 'Should flag premature disconnect anomaly');
  assert.equal(disconnect.severity, 'HIGH');
  assert.equal(disconnect.eventId, 'EVT-003');
});

test('TraceParser detects CACHE_POISONING_RISK when cache write occurs on uncompleted stream', () => {
  const parser = new TraceParser();
  const events = [
    { id: 'EVT-001', timestamp: 0, type: 'HTTP_REQUEST_STARTED', streaming: true },
    { id: 'EVT-002', timestamp: 100, type: 'SSE_CHUNK_RECEIVED', chunkIndex: 1, tokenCount: 10, isDoneMarker: false },
    { id: 'EVT-003', timestamp: 150, type: 'CACHE_OPERATION', action: 'write_attempted' },
  ];

  const result = parser.parse(events);
  const cacheAnomaly = result.anomalies.find((a) => a.type === ANOMALY_TYPES.CACHE_POISONING_RISK);
  assert.ok(cacheAnomaly, 'Should flag cache poisoning anomaly');
  assert.equal(cacheAnomaly.severity, 'CRITICAL');
});

test('TraceParser detects RETRY_STORM when rapid retries occur without backoff', () => {
  const parser = new TraceParser();
  const events = [
    { id: 'EVT-001', timestamp: 0, type: 'HTTP_REQUEST_STARTED' },
    { id: 'EVT-002', timestamp: 50, type: 'RETRY_ATTEMPTED', attempt: 1 },
    { id: 'EVT-003', timestamp: 120, type: 'RETRY_ATTEMPTED', attempt: 2 },
  ];

  const result = parser.parse(events);
  const retryStorm = result.anomalies.find((a) => a.type === ANOMALY_TYPES.RETRY_STORM);
  assert.ok(retryStorm, 'Should flag retry storm anomaly');
});

test('TraceParser detects RATE_LIMIT_CASCADE on upstream 429 errors', () => {
  const parser = new TraceParser();
  const events = [
    { id: 'EVT-001', timestamp: 0, type: 'HTTP_STATUS_RECEIVED', statusCode: 429 },
    { id: 'EVT-002', timestamp: 200, type: 'HTTP_STATUS_RECEIVED', statusCode: 429 },
  ];

  const result = parser.parse(events);
  const rateLimit = result.anomalies.find((a) => a.type === ANOMALY_TYPES.RATE_LIMIT_CASCADE);
  assert.ok(rateLimit, 'Should flag rate limit cascade');
});

test('TraceParser flags LATENCY_OUTLIER on inter-chunk gaps exceeding 3000ms', () => {
  const parser = new TraceParser();
  const events = [
    { id: 'EVT-001', timestamp: 0, type: 'HTTP_REQUEST_STARTED', streaming: true },
    { id: 'EVT-002', timestamp: 100, type: 'SSE_CHUNK_RECEIVED', latencyMs: 3500 },
  ];

  const result = parser.parse(events);
  const latency = result.anomalies.find((a) => a.type === ANOMALY_TYPES.LATENCY_OUTLIER);
  assert.ok(latency, 'Should flag latency outlier');
});

test('TraceParser rejects empty or invalid input', () => {
  const parser = new TraceParser();
  assert.throws(() => parser.parse([]), /must be a non-empty array/);
  assert.throws(() => parser.parse(null), /must be a non-empty array/);
});
