# Functional vs Mocked — Living Ledger

> Required deliverable **D3.1**: "Notes on what is functional (real-time transcript
> ingestion) vs what is mocked." This is a living table — update it as components move from
> mocked → real. Honesty here is graded (E2, E4).

**Legend:** 🟢 Functional (real) · 🟡 Partial / behind a flag · 🔴 Mocked · ⬜ Not built yet

| Component | Traces to | State | Notes |
|-----------|-----------|-------|-------|
| HighLevel OAuth (install/callback/refresh) | R1.2 | 🟢 | **Real install completed** — sandbox sub-account `B7TzvBb6H6QvDNdEEhlt` connected; token stored + refresh wired. |
| HighLevel sandbox & marketplace app install | R1.1, R1.2 | 🟢 | App **Live**; installed on a sandbox sub-account. Adding Voice AI scopes via a new version + reinstall (A-007/A-011). |
| Transcript ingestion (API) | R2.1, D1.1 | 🟢 | **Live** — `GET /voice-ai/dashboard/call-logs` returns 200 with valid auth+scope. List shape confirmed: `{callLogs:[], totalRecords, traceId}`. Sandbox has 0 calls yet → need a real Voice AI call to capture the transcript/per-call shape (A-003). Webhook vs poll TBD. |
| Observability parameters / KPI config | R2.2 | ⬜ | KPI model proposed in A-004. |
| KPI scoring & deviation detection (LLM) | R2.3 | ⬜ | Claude-based; structured output. |
| Unified dashboard | R2.4, E1 | 🟡 | Vue 3 shell built + embeddable; health/installs wired. Full agent/call/issue views pending. |
| Recommendations engine | R2.5 | ⬜ | Claude-based synthesis over call history. |
| "Use Actions" segment flagging | R2.6 | ⬜ | Per A-005: timestamped deep-links. |

## Rule

When a component ships, change its state and write one line of *what is real vs simulated*
(e.g. "real ingestion via webhook; KPI thresholds seeded from a default profile, not yet
learned"). No silent mocking — a faked path must say so here.
