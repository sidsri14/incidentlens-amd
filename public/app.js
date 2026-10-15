let currentPreset = 'premature-disconnect';

const presetButtons = document.querySelectorAll('.preset-btn');
const analyzeBtn = document.querySelector('#analyze-btn');
const timelineTbody = document.querySelector('#timeline-tbody');
const analysisPanel = document.querySelector('#analysis-panel');
const diagnosisBox = document.querySelector('#diagnosis-box');
const eventCountBadge = document.querySelector('#event-count-badge');
const citationBadgeContainer = document.querySelector('#citation-badge-container');

const statSeverity = document.querySelector('#stat-severity');
const statAnomalies = document.querySelector('#stat-anomalies');
const statEvents = document.querySelector('#stat-events');
const statLatency = document.querySelector('#stat-latency');
const statCitation = document.querySelector('#stat-citation');

const rocmModelVal = document.querySelector('#rocm-model-val');
const rocmProviderVal = document.querySelector('#rocm-provider-val');
const rocmTimeVal = document.querySelector('#rocm-time-val');
const rocmTokensVal = document.querySelector('#rocm-tokens-val');
const modelBadge = document.querySelector('#model-badge');

presetButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    presetButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentPreset = btn.dataset.preset;
  });
});

async function runAnalysis() {
  if (!analyzeBtn) return;
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Running analysis and citation checks...';

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId: currentPreset }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Analysis failed');
    }

    const data = await res.json();
    renderResults(data);
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze Incident →';
  }
}

function renderResults(data) {
  // 1. Update Metrics
  const { telemetry, timeline, anomalies, analysis, citationVerification, rocmPerformance } = data;

  if (modelBadge) {
    modelBadge.textContent = analysis.simulated
      ? 'Mode: deterministic evaluation'
      : `Model: ${analysis.model}`;
  }

  if (statSeverity) {
    statSeverity.textContent = telemetry.overallSeverity || 'NORMAL';
    statSeverity.className = `metric-val status-${(telemetry.overallSeverity || 'normal').toLowerCase()}`;
  }
  if (statAnomalies) statAnomalies.textContent = anomalies.length;
  if (statEvents) statEvents.textContent = timeline.length;
  if (statLatency) statLatency.textContent = `${rocmPerformance.inferenceLatencyMs}ms`;

  if (statCitation) {
    if (citationVerification.valid) {
      statCitation.textContent = `Passed (${citationVerification.totalCitations} citations)`;
      statCitation.style.color = '#10b981';
    } else {
      statCitation.textContent = 'REJECTED';
      statCitation.style.color = '#ef4444';
    }
  }

  if (eventCountBadge) eventCountBadge.textContent = `${timeline.length} Events`;

  // 2. Render Timeline Table
  if (timelineTbody) {
    timelineTbody.replaceChildren();

    const anomalyEventIds = new Set(anomalies.map((a) => a.eventId));

    timeline.forEach((ev) => {
      const row = document.createElement('tr');

      const tdId = document.createElement('td');
      const codeId = document.createElement('code');
      codeId.textContent = ev.id;
      tdId.appendChild(codeId);

      const tdTime = document.createElement('td');
      tdTime.textContent = `+${ev.timestamp}ms`;

      const tdType = document.createElement('td');
      tdType.textContent = ev.type;

      const tdDetails = document.createElement('td');
      let detailsText = '';
      if (ev.type === 'HTTP_REQUEST_STARTED') detailsText = `${ev.method} ${ev.route} (Model: ${ev.model}, Stream: ${ev.streaming})`;
      else if (ev.type === 'HTTP_STATUS_RECEIVED') detailsText = `Status Code: ${ev.statusCode}`;
      else if (ev.type === 'SSE_CHUNK_RECEIVED') detailsText = `Chunk #${ev.chunkIndex || 1} (${ev.tokenCount || 0} tokens, ${ev.latencyMs || 0}ms latency)`;
      else if (ev.type === 'STREAM_TERMINATED') detailsText = `Terminated: ${ev.reason || 'unknown'} ${ev.error ? `(${ev.error})` : ''}`;
      else if (ev.type === 'CACHE_OPERATION') detailsText = `Action: ${ev.action} (Target: ${ev.targetKey || 'n/a'})`;
      else if (ev.type === 'RETRY_ATTEMPTED') detailsText = `Retry Attempt #${ev.attempt} (Backoff: ${ev.backoffMs}ms)`;
      tdDetails.textContent = detailsText;

      const tdStatus = document.createElement('td');
      const pill = document.createElement('span');
      const isAnomaly = anomalyEventIds.has(ev.id);
      pill.className = `status-pill ${isAnomaly ? 'pill-anomaly' : 'pill-normal'}`;
      pill.textContent = isAnomaly ? 'ANOMALY FLAGGED' : 'NORMAL';
      tdStatus.appendChild(pill);

      row.append(tdId, tdTime, tdType, tdDetails, tdStatus);
      timelineTbody.appendChild(row);
    });
  }

  // 3. Render Analysis & Citation Verification
  if (analysisPanel) analysisPanel.hidden = false;
  if (diagnosisBox) {
    diagnosisBox.textContent = analysis.content;
  }

  if (citationBadgeContainer) {
    citationBadgeContainer.replaceChildren();
    const badge = document.createElement('span');
    if (citationVerification.valid) {
      badge.className = 'badge badge-team';
      badge.textContent = `✅ Citation Gate Passed: ${citationVerification.uniqueValidCitations.length} unique event IDs verified`;
    } else {
      badge.className = 'badge badge-amd';
      badge.textContent = `❌ Citation Gate Rejected: ${citationVerification.failureReason}`;
    }
    citationBadgeContainer.appendChild(badge);
  }

  // 4. Render ROCm Telemetry
  if (rocmModelVal) rocmModelVal.textContent = analysis.model;
  if (rocmProviderVal) rocmProviderVal.textContent = analysis.provider;
  if (rocmTimeVal) rocmTimeVal.textContent = `${rocmPerformance.inferenceLatencyMs}ms (Parse: ${rocmPerformance.deterministicParseMs}ms)`;
  if (rocmTokensVal) rocmTokensVal.textContent = `${rocmPerformance.usage.total_tokens || 0} tokens`;
}

if (analyzeBtn) {
  analyzeBtn.addEventListener('click', runAnalysis);
}

async function labelInferenceMode() {
  if (!modelBadge) return;
  try {
    const response = await fetch('/health');
    if (!response.ok) return;
    const health = await response.json();
    modelBadge.textContent = health.amdConfigured
      ? `Model: ${health.amdModel}`
      : 'Mode: deterministic evaluation';
  } catch {
    // The main analysis action will still report the exact provider and mode.
  }
}

labelInferenceMode();
