/**
 * Evidence matrix builder that indexes trace telemetry into verifiable event citations.
 */

export class EvidenceMatrix {
  /**
   * Build an evidence table mapping event IDs to factual observations.
   * @param {Object} parsed Parsed trace output from TraceParser
   * @returns {Object} Indexed evidence matrix and prompt bundle
   */
  build(parsed) {
    if (!parsed || !Array.isArray(parsed.timeline)) {
      throw new TypeError('parsed must contain a timeline array');
    }

    const eventMap = new Map();
    const evidenceItems = [];

    // Index all events by their ID
    for (const ev of parsed.timeline) {
      eventMap.set(ev.id, ev);
      let summary = `${ev.type}`;
      if (ev.type === 'HTTP_STATUS_RECEIVED') summary += ` (Status ${ev.statusCode})`;
      else if (ev.type === 'SSE_CHUNK_RECEIVED') summary += ` (Chunk #${ev.chunkIndex || 1}, ${ev.tokenCount || 0} tokens, ${ev.latencyMs || 0}ms)`;
      else if (ev.type === 'STREAM_TERMINATED') summary += ` (Reason: ${ev.reason || 'unknown'})`;
      else if (ev.type === 'CACHE_OPERATION') summary += ` (Action: ${ev.action})`;
      else if (ev.type === 'RETRY_ATTEMPTED') summary += ` (Attempt #${ev.attempt || 1})`;

      evidenceItems.push({
        id: ev.id,
        timestamp: ev.timestamp,
        type: ev.type,
        summary,
        raw: ev,
      });
    }

    // Format prompt text for LLM inference
    const evidenceLines = evidenceItems.map((e) => `[${e.id}] (${e.timestamp}ms) ${e.summary}`);
    const anomalyLines = (parsed.anomalies || []).map(
      (a) => `- [${a.eventId}] ${a.severity}: ${a.detail}`,
    );

    const promptText = `
You are IncidentLens AMD, an expert LLM gateway site-reliability diagnosis engine.
Analyze the following gateway trace bundle and detected deterministic anomalies.

EVIDENCE LOG:
${evidenceLines.join('\n')}

DETECTED ANOMALIES:
${anomalyLines.length > 0 ? anomalyLines.join('\n') : 'No deterministic anomalies flagged.'}

METRICS SUMMARY:
- Total Events: ${parsed.metrics.totalEvents}
- Total Duration: ${parsed.metrics.durationMs}ms
- Streaming: ${parsed.metrics.isStreaming} (Done marker received: ${parsed.metrics.hasDoneMarker})
- Total Tokens: ${parsed.metrics.totalTokens}
- TTFT: ${parsed.metrics.timeToFirstTokenMs}ms | Max Chunk Latency: ${parsed.metrics.maxChunkLatencyMs}ms

CRITICAL INSTRUCTIONS:
1. Provide a concise Root Cause Diagnosis.
2. Provide a 3-step concrete Remediation Plan.
3. MANDATORY CITATION RULE: Every sentence in your Root Cause Diagnosis and every Remediation step MUST explicitly cite at least one event ID in brackets (e.g., [EVT-001] or [EVT-003]).
4. Only cite event IDs that exist in the EVIDENCE LOG above. Do NOT invent IDs.
`.trim();

    return {
      eventMap,
      evidenceItems,
      promptText,
      validEventIds: new Set(eventMap.keys()),
    };
  }
}
