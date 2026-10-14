/**
 * Deterministic telemetry parser for LLM gateway trace events.
 * Identifies structural anomalies before calling inference models.
 */

export const ANOMALY_TYPES = {
  PREMATURE_DISCONNECT: 'PREMATURE_DISCONNECT',
  RETRY_STORM: 'RETRY_STORM',
  CACHE_POISONING_RISK: 'CACHE_POISONING_RISK',
  RATE_LIMIT_CASCADE: 'RATE_LIMIT_CASCADE',
  LATENCY_OUTLIER: 'LATENCY_OUTLIER',
};

export class TraceParser {
  /**
   * Parse an array of trace events into structured telemetry and identified anomalies.
   * @param {Array<Object>} events Raw trace events
   * @returns {Object} Parsed telemetry and identified anomalies
   */
  parse(events) {
    if (!Array.isArray(events) || events.length === 0) {
      throw new TypeError('events must be a non-empty array of trace objects');
    }

    const anomalies = [];
    const timeline = [];
    let hasDoneMarker = false;
    let streamTerminated = null;
    let isStreaming = false;
    let requestStarted = null;
    let firstTokenTime = null;
    let chunkCount = 0;
    let totalTokens = 0;
    const chunkLatencies = [];
    const retries = [];
    const rateLimits = [];
    const cacheWrites = [];

    // Sort events deterministically by timestamp
    const sorted = [...events].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i];
      const eventId = ev.id || `EVT-${String(i + 1).padStart(3, '0')}`;
      const entry = { ...ev, id: eventId };
      timeline.push(entry);

      switch (ev.type) {
        case 'HTTP_REQUEST_STARTED':
          requestStarted = ev;
          isStreaming = Boolean(ev.streaming);
          break;

        case 'HTTP_STATUS_RECEIVED':
          if (ev.statusCode === 429) {
            rateLimits.push(entry);
          }
          break;

        case 'SSE_CHUNK_RECEIVED':
          chunkCount++;
          if (typeof ev.tokenCount === 'number') totalTokens += ev.tokenCount;
          if (ev.isDoneMarker) hasDoneMarker = true;

          if (chunkCount === 1 && requestStarted && ev.timestamp) {
            firstTokenTime = ev.timestamp - requestStarted.timestamp;
          }
          if (typeof ev.latencyMs === 'number') {
            chunkLatencies.push(ev.latencyMs);
            if (ev.latencyMs > 3000) {
              anomalies.push({
                type: ANOMALY_TYPES.LATENCY_OUTLIER,
                eventId,
                severity: 'MEDIUM',
                detail: `Inter-chunk latency spike of ${ev.latencyMs}ms exceeds 3000ms SLA threshold`,
                timestamp: ev.timestamp,
              });
            }
          }
          break;

        case 'STREAM_TERMINATED':
          streamTerminated = entry;
          break;

        case 'RETRY_ATTEMPTED':
          retries.push(entry);
          break;

        case 'CACHE_OPERATION':
          if (ev.action === 'write_attempted' || ev.action === 'write_completed') {
            cacheWrites.push(entry);
          }
          break;
      }
    }

    // Anomaly Check 1: Premature Disconnection (Ghost Spend)
    if (isStreaming && streamTerminated && !hasDoneMarker) {
      anomalies.push({
        type: ANOMALY_TYPES.PREMATURE_DISCONNECT,
        eventId: streamTerminated.id,
        severity: 'HIGH',
        detail: `Stream terminated (${streamTerminated.reason || 'unknown'}) before emitting [DONE] marker; upstream model incurred ${totalTokens} tokens of unreceived output`,
        timestamp: streamTerminated.timestamp,
      });
    }

    // Anomaly Check 2: Cache Poisoning on Incomplete Stream
    if (isStreaming && !hasDoneMarker && cacheWrites.length > 0) {
      for (const cw of cacheWrites) {
        anomalies.push({
          type: ANOMALY_TYPES.CACHE_POISONING_RISK,
          eventId: cw.id,
          severity: 'CRITICAL',
          detail: `Cache write attempted for incomplete stream payload without verified [DONE] sentinel`,
          timestamp: cw.timestamp,
        });
      }
    }

    // Anomaly Check 3: Retry Storm
    if (retries.length >= 2) {
      const windowMs = (retries[retries.length - 1].timestamp || 0) - (retries[0].timestamp || 0);
      if (windowMs < 2000) {
        anomalies.push({
          type: ANOMALY_TYPES.RETRY_STORM,
          eventId: retries[0].id,
          severity: 'HIGH',
          detail: `${retries.length} rapid retries executed within ${windowMs}ms window without exponential jitter`,
          timestamp: retries[0].timestamp,
        });
      }
    }

    // Anomaly Check 4: Rate Limit Cascade (429)
    if (rateLimits.length >= 2) {
      anomalies.push({
        type: ANOMALY_TYPES.RATE_LIMIT_CASCADE,
        eventId: rateLimits[0].id,
        severity: 'HIGH',
        detail: `Received ${rateLimits.length} upstream HTTP 429 Rate Limit responses; gateway backoff circuit breached`,
        timestamp: rateLimits[0].timestamp,
      });
    }

    // Calculate aggregated metrics
    const durationMs = timeline.length > 1
      ? (timeline[timeline.length - 1].timestamp || 0) - (timeline[0].timestamp || 0)
      : 0;

    const avgChunkLatency = chunkLatencies.length > 0
      ? Math.round(chunkLatencies.reduce((a, b) => a + b, 0) / chunkLatencies.length)
      : 0;
    const maxChunkLatency = chunkLatencies.length > 0 ? Math.max(...chunkLatencies) : 0;

    let overallSeverity = 'NORMAL';
    if (anomalies.some((a) => a.severity === 'CRITICAL')) overallSeverity = 'CRITICAL';
    else if (anomalies.some((a) => a.severity === 'HIGH')) overallSeverity = 'HIGH';
    else if (anomalies.some((a) => a.severity === 'MEDIUM')) overallSeverity = 'MEDIUM';

    return {
      timeline,
      anomalies,
      metrics: {
        totalEvents: timeline.length,
        durationMs,
        isStreaming,
        hasDoneMarker,
        chunkCount,
        totalTokens,
        timeToFirstTokenMs: firstTokenTime,
        avgChunkLatencyMs: avgChunkLatency,
        maxChunkLatencyMs: maxChunkLatency,
        anomalyCount: anomalies.length,
        overallSeverity,
      },
    };
  }
}
