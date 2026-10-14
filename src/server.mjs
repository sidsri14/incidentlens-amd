import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TraceParser } from './trace_parser.mjs';
import { EvidenceMatrix } from './evidence_matrix.mjs';
import { AmdRocmClient } from './amd_rocm_client.mjs';
import { CitationValidator } from './citation_validator.mjs';

const DEFAULT_PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_BODY_BYTES = 64 * 1024;

export const PRESET_SCENARIOS = {
  'premature-disconnect': {
    id: 'premature-disconnect',
    title: 'SSE Premature Disconnection & Ghost Token Spend',
    description: 'Client aborts HTTP stream midway; gateway fails to cancel upstream ROCm inference, incurring ghost token charges.',
    events: [
      { id: 'EVT-001', timestamp: 0, type: 'HTTP_REQUEST_STARTED', method: 'POST', route: '/v1/chat/completions', model: 'DeepSeek-V4-Flash', streaming: true },
      { id: 'EVT-002', timestamp: 120, type: 'HTTP_STATUS_RECEIVED', statusCode: 200 },
      { id: 'EVT-003', timestamp: 240, type: 'SSE_CHUNK_RECEIVED', chunkIndex: 1, tokenCount: 8, latencyMs: 120, isDoneMarker: false },
      { id: 'EVT-004', timestamp: 380, type: 'SSE_CHUNK_RECEIVED', chunkIndex: 2, tokenCount: 16, latencyMs: 140, isDoneMarker: false },
      { id: 'EVT-005', timestamp: 490, type: 'STREAM_TERMINATED', reason: 'client_abort', error: 'ECONNRESET' },
    ],
  },
  'retry-storm': {
    id: 'retry-storm',
    title: 'Retry Storm & HTTP 429 Rate Limit Cascade',
    description: 'Consecutive rapid retries without exponential backoff or jitter breach upstream rate limits, triggering a failure cascade.',
    events: [
      { id: 'EVT-001', timestamp: 0, type: 'HTTP_REQUEST_STARTED', method: 'POST', route: '/v1/chat/completions', model: 'DeepSeek-V4-Flash', streaming: false },
      { id: 'EVT-002', timestamp: 85, type: 'HTTP_STATUS_RECEIVED', statusCode: 429 },
      { id: 'EVT-003', timestamp: 120, type: 'RETRY_ATTEMPTED', attempt: 1, backoffMs: 35 },
      { id: 'EVT-004', timestamp: 190, type: 'HTTP_STATUS_RECEIVED', statusCode: 429 },
      { id: 'EVT-005', timestamp: 230, type: 'RETRY_ATTEMPTED', attempt: 2, backoffMs: 40 },
      { id: 'EVT-006', timestamp: 310, type: 'HTTP_STATUS_RECEIVED', statusCode: 429 },
    ],
  },
  'cache-poisoning': {
    id: 'cache-poisoning',
    title: 'Cache Inconsistency on Truncated Stream Payload',
    description: 'Gateway cache layer schedules a write operation on a truncated stream payload without verifying the [DONE] completion sentinel.',
    events: [
      { id: 'EVT-001', timestamp: 0, type: 'HTTP_REQUEST_STARTED', method: 'POST', route: '/v1/chat/completions', model: 'DeepSeek-V4-Flash', streaming: true },
      { id: 'EVT-002', timestamp: 95, type: 'HTTP_STATUS_RECEIVED', statusCode: 200 },
      { id: 'EVT-003', timestamp: 210, type: 'SSE_CHUNK_RECEIVED', chunkIndex: 1, tokenCount: 12, latencyMs: 115, isDoneMarker: false },
      { id: 'EVT-004', timestamp: 340, type: 'STREAM_TERMINATED', reason: 'socket_timeout' },
      { id: 'EVT-005', timestamp: 360, type: 'CACHE_OPERATION', action: 'write_attempted', targetKey: 'prompt-hash-789a' },
    ],
  },
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json');
    error.statusCode = 415;
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body exceeds maximum size limit');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Malformed JSON payload');
    error.statusCode = 400;
    throw error;
  }
}

function setSecurityHeaders(response) {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self' https://developer.amd.com.cn; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

export function createIncidentLensServer(options = {}) {
  const publicDir = options.publicDir || DEFAULT_PUBLIC_DIR;
  const amdClient = options.amdClient || new AmdRocmClient();
  const traceParser = options.traceParser || new TraceParser();
  const evidenceMatrix = options.evidenceMatrix || new EvidenceMatrix();
  const citationValidator = options.citationValidator || new CitationValidator();

  return http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    const url = new URL(request.url || '/', 'http://127.0.0.1');

    try {
      // 1. Health Endpoint
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          status: 'ok',
          service: 'incidentlens-amd',
          amdConfigured: Boolean(amdClient.apiKey),
          amdModel: amdClient.model,
          amdBaseUrl: amdClient.baseUrl,
        });
        return;
      }

      // 2. Presets Endpoint
      if (request.method === 'GET' && url.pathname === '/api/presets') {
        sendJson(response, 200, { presets: Object.values(PRESET_SCENARIOS) });
        return;
      }

      // 3. Incident Analysis Pipeline
      if (request.method === 'POST' && url.pathname === '/api/analyze') {
        const body = await readJson(request);
        let events = body.events;

        if (!events && body.presetId && PRESET_SCENARIOS[body.presetId]) {
          events = PRESET_SCENARIOS[body.presetId].events;
        }

        if (!Array.isArray(events) || events.length === 0) {
          sendJson(response, 400, {
            error: 'INVALID_REQUEST',
            message: 'Must provide an events array or a valid presetId',
          });
          return;
        }

        const parseStart = Date.now();
        const parsed = traceParser.parse(events);
        const matrix = evidenceMatrix.build(parsed);
        const parseDurationMs = Date.now() - parseStart;

        // Perform AMD ROCm model inference
        const modelResult = await amdClient.complete(matrix.promptText, {
          model: body.model,
        });

        // Validate citations
        const citationVerdict = citationValidator.validate(modelResult.content, matrix.validEventIds);

        sendJson(response, 200, {
          success: true,
          telemetry: parsed.metrics,
          timeline: parsed.timeline,
          anomalies: parsed.anomalies,
          evidence: matrix.evidenceItems,
          analysis: {
            content: modelResult.content,
            model: modelResult.model,
            provider: modelResult.provider,
            simulated: modelResult.simulated,
          },
          citationVerification: citationVerdict,
          rocmPerformance: {
            inferenceLatencyMs: modelResult.latencyMs,
            deterministicParseMs: parseDurationMs,
            totalLatencyMs: modelResult.latencyMs + parseDurationMs,
            usage: modelResult.usage,
          },
        });
        return;
      }

      // 4. Static File Serving
      const staticFiles = new Map([
        ['/', ['index.html', 'text/html; charset=utf-8']],
        ['/index.html', ['index.html', 'text/html; charset=utf-8']],
        ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
        ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
      ]);

      const entry = staticFiles.get(url.pathname);
      if (request.method === 'GET' && entry) {
        const [relPath, contentType] = entry;
        const filePath = path.join(publicDir, relPath);
        try {
          const info = await stat(filePath);
          response.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': info.size,
          });
          createReadStream(filePath).pipe(response);
          return;
        } catch {
          // File not found on disk, drop through to 404
        }
      }

      sendJson(response, 404, { error: 'NOT_FOUND', message: 'Resource not found' });
    } catch (error) {
      const status = error.statusCode || 500;
      sendJson(response, status, {
        error: status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
        message: error.message || 'An unexpected error occurred',
      });
    }
  });
}
