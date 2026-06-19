# Session S-012 — 2026-06-19 — Backend foundation: real data → score → persist → webhook

## Goal

Get off the empty sandbox and stand up the actual product backend: capture a real Voice AI
transcript, build the observability engine (parse → KPI score → deviations → "Use Actions"),
persist it, and make ingestion continuous via a webhook. Resolve A-003 (transcript shape) and
A-006 (real-time ingestion) along the way.

## Done

### Integration: real data + agent provisioning (2.1)
- **A-003 resolved** — captured the live `GET /voice-ai/dashboard/call-logs/:id` shape:
  `transcript` is a `bot:/human:` newline string (no timestamps; consecutive same-speaker
  lines possible). Fixed `getCallLog` to pass `locationId` (400 without it). Tool:
  `server/scripts/capture-call-shape.mts`; real fixtures in `server/fixtures/`.
- **Agent provisioning via API** — created/configured the BrightSmile Dental booking agent
  with `PATCH /voice-ai/agents/:id` (`Version: v3`), `scripts/configure-agent.mts`. Required
  adding `voice-ai-agents.write` + `voice-ai-agent-goals.write` to the app + reinstalling;
  scopes otherwise kept minimal.
- **Dummy calls** — placed web-call tests → **5 real transcripts** captured (incl. a 123s
  booking call). Confirmed web calls DO appear in the List API.

### Backend pipeline: scoring, persistence, ingestion (2.2)
- **Observability engine (test-first)** — `analysis/transcript.ts` (parser, merges
  consecutive turns), `analysis/kpis.ts` (6 config-driven KPIs — goal_completion,
  script_adherence, info_capture, accuracy, objection_handling, sentiment; weighted overall;
  dead-air dropped as not transcript-derivable), `analysis/score.ts` (transcript+goal →
  `CallAnalysis`).
- **Scoring via Claude Agent SDK** — `llm/agent.ts` uses `@anthropic-ai/claude-agent-sdk`
  (`query`, structured `outputFormat`), authed by `CLAUDE_CODE_OAUTH_TOKEN` (**no bare API
  key**, per builder constraint). Removed `@anthropic-ai/sdk`. Proven on the real booking call
  (89/100, accurate findings).
- **Persistence → Postgres + JSONB** — `AnalysisRepository` (swappable) + `db/pool.ts`;
  `call_analysis` (JSONB fidelity + indexed dims) and `call_kpi` (flat rows for `GROUP BY`).
  Real DB integration tests.
- **Ingestion** — poll (`scripts/ingest.mts`, backfill) **+ webhook (primary)**: marketplace
  `VoiceAiCallEnd` → `POST /webhooks/ghl/voice-ai`. Ed25519 signature verification
  (`webhooks/verifyGhl.ts`), ack-202-fast + async ingest + `inFlight`/idempotent dedupe.
  `ingestRawCall` scores directly from the inline-transcript payload.
- **Read API** — `/api/analyses`, `/api/analyses/:callId`, `/api/kpis/averages`.
- **Verified live end-to-end** — a real **web call** fired the webhook, signature
  `verified=true`, scored + persisted in seconds; **5 real calls** in Postgres. **29 tests**
  green (incl. Postgres integration + signature), typecheck clean. Test runner (vitest) added.

## Decisions

- **ADR-0008** — Persistence on Postgres + JSONB; poll + webhook ingestion. **Supersedes the
  storage choice in ADR-0002** (Mongo → Postgres: the dashboard's reads are KPI aggregations,
  which SQL does better; Postgres already running locally). (Traces to R2.1, R2.3, R2.4, E2.)
- Scoring goes through the **Claude Agent SDK** (OAuth), not the Messages API with a bare key
  (builder constraint). Signature enforcement on by default (`WEBHOOK_REQUIRE_SIGNATURE=true`)
  now that a real delivery verified.

## Assumptions touched

- **A-003** — ✅ RESOLVED. Transcript shape captured live (string, no timestamps).
- **A-006** — ✅ CONFIRMED LIVE. `VoiceAiCallEnd` webhook fires on call end (incl. web/test
  calls), Ed25519-signed; near-real-time ingestion proven.
- **A-007** — Voice AI write scopes added (`voice-ai-agents.write`, `voice-ai-agent-goals.write`).

## Open questions / next action

- **Next action:** build the **recommendations engine (R2.5)** — synthesize cross-call
  patterns (e.g. `info_capture` averaging 47/100: agent keeps dropping email + full name) into
  concrete prompt/script fixes for the agent. It hangs off the existing `CallAnalysis` +
  `call_kpi` aggregates; consider model routing per ADR-0002 (cheaper model for per-call,
  Opus/Agent-SDK for synthesis). After that: dashboard (R2.4/E1) to surface analyses +
  "Use Actions" (R2.6), then hardening (token store → Postgres, API auth, route-level tests).
