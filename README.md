# IncidentLens AMD

[![CI](https://github.com/sidsri14/incidentlens-amd/actions/workflows/ci.yml/badge.svg)](https://github.com/sidsri14/incidentlens-amd/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![AMD ROCm](https://img.shields.io/badge/AMD-ROCm%20TokenFactory-ED1C24.svg)](https://developer.amd.com.cn)

> **AMD Developer Hackathon: ACT III Submission**  
> **Team**: `team-9992` (Siddharth Srivastava)  
> **Infrastructure**: AMD TokenFactory chat-completions adapter (default model: `DeepSeek-V4-Flash`)
> **Repository**: [https://github.com/sidsri14/incidentlens-amd](https://github.com/sidsri14/incidentlens-amd)

---

## Overview

**IncidentLens AMD** is an evidence-bound incident triage and telemetry diagnostics prototype for LLM gateways. It addresses a concrete failure mode in AI-assisted operations: a model can produce plausible incident explanations or remediation steps that are not connected to the supplied trace events.

IncidentLens enforces a strict dual-boundary architecture:
1. **Deterministic Telemetry Parser**: Ingests raw gateway logs, parses Server-Sent Events (SSE) lifecycle transitions, and algorithmically identifies structural anomalies:
   - **Premature SSE Disconnection**: Detects a captured stream ending before a `[DONE]` sentinel. The trace does not claim whether upstream generation continued.
   - **Retry Storms & 429 Cascades**: Flags rapid retries executed without exponential jitter.
   - **Cache Inconsistency on Partial Streams**: Identifies attempted cache writes on truncated streams.
   - **Latency SLA Outliers**: Tracks Time-To-First-Token (TTFT) and inter-chunk latency spikes.
2. **Evidence Matrix**: Indexes trace points into stable event IDs (`[EVT-001]`, `[EVT-002]`, etc.) and sends the bounded evidence bundle to AMD TokenFactory when an API key is configured.
3. **Automated Citation Verification Gate**: Evaluates the model's response; every non-heading claim unit must cite at least one known event ID. Outputs containing an uncited claim or an unknown event ID are rejected **fail-closed**. This verifies citation coverage and ID validity, not whether every cited inference is logically correct.

![IncidentLens AMD UI Screenshot](incidentlens-ui.png)

**Public evaluation demo:** [incidentlens-amd.vercel.app](https://incidentlens-amd.vercel.app/)

The hosted demo intentionally runs in deterministic evaluation mode. Configure
`AMD_API_KEY` locally to exercise the authenticated TokenFactory path without
exposing the event credential to a public browser.

---

## Architecture

```
[ Gateway Traces / SSE Logs ]
              │
              ▼
    1. Deterministic Trace Parser
       ├─ Metric Extraction (TTFT, Chunk Latency, Token Counts)
       └─ Anomaly Flagging (Premature Disconnects, Retry Storms, Cache Hazards)
              │
              ▼
    2. Evidence Matrix Indexer
       └─ Assigns Stable Event IDs ([EVT-001], [EVT-002]...)
              │
              ▼
    3. AMD ROCm TokenFactory Inference (DeepSeek-V4-Flash)
       └─ Generates Evidence-Bound Diagnosis & Remediation Checklist
              │
              ▼
    4. Citation Verification Gate
       ├─ Checks Every Claim for Valid Event ID Brackets
       ├─ Rejects Unknown IDs & Uncited Claim Units Fail-Closed
       └─ Computes Citation Density & Integrity Score
              │
              ▼
[ IncidentLens Dark-Mode Operator HUD ]
```

---

## Key Features

- **AMD ROCm Inference Integration**: Connects to AMD TokenFactory (`https://developer.amd.com.cn/radeon/api/v1`) when `AMD_API_KEY` is configured.
- **Fail-Closed Citation Gate**: Rejects missing or unknown event citations before displaying a model report; it does not claim to prove the report's reasoning.
- **Zero-Key Local Simulation Mode**: Evaluators and judges can run `npm start` immediately without cloud credentials to test full scenarios.
- **Interactive Operator HUD**: Dark-mode dashboard displaying the event timeline, measured request latency, model/provider mode, and citation-gate verdict.
- **Automated Test Suite**: Native Node tests cover parsing, citation validation, HTTP behavior, and the serverless deployment handler with zero external runtime dependencies.

## Inference Modes

- **AMD TokenFactory mode**: set `AMD_API_KEY` to send the evidence bundle to the configured AMD endpoint. The API response reports `simulated: false`.
- **Deterministic evaluation mode**: when no key is present, the app produces a fixed fixture response and reports `simulated: true`. This lets reviewers exercise the parser and citation gate without receiving or exposing the event credential.

Set `INCIDENTLENS_FORCE_SIMULATION=true` to guarantee that local evaluation never reads an ambient AMD credential.

The public deployment and hackathon video intentionally exercise deterministic evaluation mode. The repository includes the authenticated TokenFactory adapter, but no AMD credential is shipped to the browser or repository.

---

## Quickstart

### Prerequisites
- Node.js v20.x, v22.x, or v24.x

### Installation & Run

```bash
git clone https://github.com/sidsri14/incidentlens-amd.git
cd incidentlens-amd

# Run automated test suite (19/19 passing tests)
npm test

# Start the IncidentLens Operator HUD
npm start
```

Visit `http://127.0.0.1:8788` in your browser.

---

## Automated Test Coverage

```
✔ AmdRocmClient honors an explicit no-key override even when the environment has a key
✔ AmdRocmClient falls back to deterministic simulated completion when no API key provided
✔ AmdRocmClient rejects non-string prompts
✔ AmdRocmClient parses custom model overrides and trims base URL
✔ CitationValidator approves well-cited response referencing valid events
✔ CitationValidator rejects response with zero citations
✔ CitationValidator rejects response with unknown event IDs
✔ CitationValidator rejects an uncited claim after a cited claim
✔ CitationValidator rejects invalid argument types
✔ IncidentLens server exposes /health, /api/presets, and /api/analyze
✔ IncidentLens server rejects malformed or non-JSON payloads
✔ TraceParser detects PREMATURE_DISCONNECT before an explicit completion marker
✔ TraceParser detects CACHE_POISONING_RISK when cache write occurs on uncompleted stream
✔ TraceParser detects RETRY_STORM when rapid retries occur without backoff
✔ TraceParser detects RATE_LIMIT_CASCADE on upstream 429 errors
✔ TraceParser flags LATENCY_OUTLIER on inter-chunk gaps exceeding 3000ms
✔ TraceParser rejects empty or invalid input
✔ Vercel analyze handler runs the deterministic no-key evaluation path
✔ Vercel health handler labels its inference mode truthfully
ℹ tests 19
ℹ pass 19
ℹ fail 0
```

---

## License

MIT License. Copyright (c) 2026 Siddharth Srivastava.
