import { AmdRocmClient } from './amd_rocm_client.mjs';
import { CitationValidator } from './citation_validator.mjs';
import { EvidenceMatrix } from './evidence_matrix.mjs';
import { PRESET_SCENARIOS } from './server.mjs';
import { TraceParser } from './trace_parser.mjs';

const MAX_BODY_BYTES = 64 * 1024;

function setSecurityHeaders(response) {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function parseBody(request) {
  const contentType = request.headers?.['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json');
    error.statusCode = 415;
    throw error;
  }

  const raw = typeof request.body === 'string'
    ? request.body
    : JSON.stringify(request.body ?? {});
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    const error = new Error('Request body exceeds maximum size limit');
    error.statusCode = 413;
    throw error;
  }

  try {
    return typeof request.body === 'string' ? JSON.parse(request.body) : (request.body ?? {});
  } catch {
    const error = new Error('Malformed JSON payload');
    error.statusCode = 400;
    throw error;
  }
}

export function createVercelHandler(route, options = {}) {
  const amdClient = options.amdClient || new AmdRocmClient();
  const traceParser = options.traceParser || new TraceParser();
  const evidenceMatrix = options.evidenceMatrix || new EvidenceMatrix();
  const citationValidator = options.citationValidator || new CitationValidator();

  return async function handler(request, response) {
    setSecurityHeaders(response);

    try {
      if (route === 'health' && request.method === 'GET') {
        sendJson(response, 200, {
          status: 'ok',
          service: 'incidentlens-amd',
          inferenceMode: amdClient.apiKey ? 'amd-tokenfactory' : 'deterministic-simulation',
          amdConfigured: Boolean(amdClient.apiKey),
          amdModel: amdClient.model,
        });
        return;
      }

      if (route === 'presets' && request.method === 'GET') {
        sendJson(response, 200, { presets: Object.values(PRESET_SCENARIOS) });
        return;
      }

      if (route === 'analyze' && request.method === 'POST') {
        const body = parseBody(request);
        const events = body.events || PRESET_SCENARIOS[body.presetId]?.events;
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
        const deterministicParseMs = Date.now() - parseStart;
        const modelResult = await amdClient.complete(matrix.promptText, { model: body.model });
        const citationVerification = citationValidator.validate(
          modelResult.content,
          matrix.validEventIds,
        );

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
          citationVerification,
          rocmPerformance: {
            inferenceLatencyMs: modelResult.latencyMs,
            deterministicParseMs,
            totalLatencyMs: modelResult.latencyMs + deterministicParseMs,
            usage: modelResult.usage,
          },
        });
        return;
      }

      sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      sendJson(response, statusCode, {
        error: statusCode === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
        message: error.message || 'An unexpected error occurred',
      });
    }
  };
}
