/**
 * AMD ROCm TokenFactory client for LLM inference.
 * Supports DeepSeek-V4-Flash, Qwen3.8-27B, and simulated offline mode.
 */

export class AmdRocmClient {
  constructor(options = {}) {
    this.apiKey = Object.prototype.hasOwnProperty.call(options, 'apiKey')
      ? options.apiKey
      : process.env.AMD_API_KEY;
    this.baseUrl = (options.baseUrl || process.env.AMD_BASE_URL || 'https://developer.amd.com.cn/radeon/api/v1').replace(/\/+$/, '');
    this.model = options.model || process.env.AMD_MODEL || 'DeepSeek-V4-Flash';
    this.timeoutMs = options.timeoutMs || 30_000;
  }

  /**
   * Send a chat completion request to AMD TokenFactory.
   * @param {string} prompt Prompt content
   * @param {Object} [overrideOptions] Optional model/temperature overrides
   * @returns {Promise<Object>} Model response and performance telemetry
   */
  async complete(prompt, overrideOptions = {}) {
    if (!prompt || typeof prompt !== 'string') {
      throw new TypeError('prompt must be a non-empty string');
    }

    const selectedModel = overrideOptions.model || this.model;

    // If no API key configured, use deterministic simulated AMD model output
    if (!this.apiKey) {
      return this._simulateCompletion(prompt, selectedModel);
    }

    const startTime = Date.now();
    const endpoint = `${this.baseUrl}/chat/completions`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: 'You are IncidentLens AMD, an expert site-reliability engineer analyzing LLM gateway telemetry. You always cite event IDs.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: overrideOptions.temperature ?? 0.2,
          max_tokens: overrideOptions.maxTokens ?? 1024,
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`AMD TokenFactory API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      return {
        content,
        model: data.model || selectedModel,
        provider: data.metadata?.used_provider || 'amd-rocm',
        latencyMs,
        usage: data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        rawMetadata: data.metadata || null,
        simulated: false,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  _simulateCompletion(prompt, model) {
    const isDisconnect = prompt.includes('PREMATURE_DISCONNECT') || prompt.includes('STREAM_TERMINATED');
    const isRetry = prompt.includes('RETRY_STORM') || prompt.includes('RETRY_ATTEMPTED');
    const isCache = prompt.includes('CACHE_POISONING_RISK') || prompt.includes('write_attempted');

    let diagnosis = '';
    let remediation = '';

    if (isDisconnect) {
      diagnosis = 'The stream suffered a premature client abortion before the [DONE] marker was emitted [EVT-004]. Upstream inference continued generating unconsumed output [EVT-003], leading to ghost compute costs.';
      remediation = '1. Implement upstream cancellation signaling when the client socket disconnects [EVT-004].\n2. Introduce gateway timeout guards to abort orphaned upstream streams [EVT-002].\n3. Suppress downstream billable tokens on dropped connections [EVT-003].';
    } else if (isRetry) {
      diagnosis = 'Multiple rapid retries triggered a downstream cascade [EVT-002] [EVT-003], causing consecutive HTTP 429 rate limits [EVT-004].';
      remediation = '1. Add exponential backoff with full jitter to gateway retry logic [EVT-002].\n2. Enforce a circuit breaker when rate limits are detected [EVT-004].\n3. Deduplicate identical client request payloads [EVT-003].';
    } else if (isCache) {
      diagnosis = 'An invalid cache write was scheduled on a partial stream payload [EVT-003] that lacked completion validation [EVT-002].';
      remediation = '1. Enforce validation of the [DONE] sentinel before commiting to the cache store [EVT-003].\n2. Discard partial stream buffers upon error [EVT-002].\n3. Invalidate corrupted cache entries immediately [EVT-003].';
    } else {
      diagnosis = 'Normal request execution observed [EVT-001] with expected latency profile [EVT-002].';
      remediation = '1. Continue monitoring baseline latency SLAs [EVT-001].\n2. Track token distribution across model endpoints [EVT-002].\n3. Maintain standard gateway health metrics [EVT-001].';
    }

    return {
      content: `### Root Cause Diagnosis\n${diagnosis}\n\n### Concrete Remediation Plan\n${remediation}`,
      model: `${model} (Simulated)`,
      provider: 'amd-rocm-simulation',
      latencyMs: 145,
      usage: {
        prompt_tokens: 180,
        completion_tokens: 125,
        total_tokens: 305,
      },
      rawMetadata: { simulated: true },
      simulated: true,
    };
  }
}
