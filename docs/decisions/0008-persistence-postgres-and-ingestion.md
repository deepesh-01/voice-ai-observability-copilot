# ADR-0008: Persistence on Postgres + JSONB; poll + webhook ingestion

- **Status:** Accepted
- **Date:** 2026-06-19
- **Session:** S-012
- **Traces to:** R2.1 (ingest transcripts), R2.3 (store derived KPI scores), R2.4 (dashboard reads), E2 (loop closes raw→recommendation)
- **Rests on assumptions:** A-003 (transcript shape, resolved)
- **Supersedes:** the storage choice in **ADR-0002** (MongoDB → Postgres+JSONB).

## Context

The scoring engine now turns a real transcript into a `CallAnalysis`. We need to persist
those so the dashboard isn't re-scoring on every view, and an ingestion path that gets new
calls scored without a human running a script. ADR-0002 had picked MongoDB; revisiting it now
that the read side is concrete.

## Decision

**Storage: Postgres + JSONB**, behind a swappable `AnalysisRepository` interface.

- `call_analysis` — JSONB columns (`analysis`, `raw_call`) keep full fidelity (the raw GHL
  call log has fields we don't map and an evolving shape); common query dimensions
  (`location_id`, `agent_id`, `overall_score`, `duration_sec`, `call_at`) are lifted into
  typed, indexed columns.
- `call_kpi` — a flat `(call_id, agent_id, kpi_key, score)` row set so per-agent/per-KPI
  aggregations are plain SQL `GROUP BY`.

**Ingestion: poll now, webhook ready.**

- **Poll** (`ingest/pollIngest.ts`, `scripts/ingest.mts`): list a location's call logs →
  `ingestCall` any not yet stored (idempotent via `repo.has`). Works against the live sandbox
  today.
- **Webhook** (`POST /webhooks/ghl/voice-ai`): push-half for near-real-time scoring once GHL's
  "Transcript Generated" trigger is wired (payload shape still A-006).
- `ingestCall`: getCallLog → parse transcript → fetch agent prompt as the goal → `scoreCall` →
  `repo.save`.

## Rationale

- Both DBs fit; the deciding factor is the **read side**. The dashboard's core queries are
  analytics — average KPI per agent, trends over time, leaderboards — which are exactly SQL's
  strength (`GROUP BY`, window functions). JSONB still gives document flexibility for the
  ingest side, so we don't lose Mongo's main advantage.
- Postgres was already installed and running locally (postgresql@17), so it's **runnable now**
  with zero new infra — important for a 5-day build and for the grader.
- The `AnalysisRepository` interface keeps the store a one-file swap, so this isn't a one-way
  door.

## Consequences

- New dep `pg`; `DATABASE_URL` in `.env` (local trust auth). Schema auto-created on boot
  (`initSchema`, idempotent) and by `scripts/ingest.mts`.
- Repository has a **real integration test** against local Postgres (skipped when
  `DATABASE_URL` is unset) — first DB-backed tests in the suite.
- The file-based `tokenStore` stays as-is for now (OAuth tokens); only analysis storage moves
  to Postgres. Unifying them is optional later work.
- Ingestion is currently **manual/poll**; the webhook endpoint exists but GHL-side trigger
  wiring (A-006) is still pending.
