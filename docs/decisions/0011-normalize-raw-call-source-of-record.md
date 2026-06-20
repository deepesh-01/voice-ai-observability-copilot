# ADR-0011: Normalize raw_call into its own source-of-record table

- **Status:** Accepted
- **Date:** 2026-06-20
- **Session:** S-015
- **Traces to:** R2.1 (ingest + retain transcripts), E2 (close the loop), E3 (clear architecture)
- **Refines:** ADR-0008 (Postgres persistence) — the storage decision stands; this changes the table layout. **Supersedes the `call_analysis`/`call_lead` layout described in ADR-0008's "Schema (as built)" appendix.**

## Context

ADR-0008 stored the verbatim GHL call payload (`raw_call` JSONB) **in the same `call_analysis`
row** as the derived KPI analysis. Two problems:

1. **Durability.** A call was only persisted once scoring succeeded — `analysisRepo.save()`
   wrote the raw payload and the analysis together. If the LLM scoring step threw (timeout,
   rate limit, bad output), we kept **nothing**: the captured call was lost and the only
   recovery was re-fetching from GHL via the poll backfill.
2. **Mixed concerns / aggregate boundaries.** "The call as it happened" (immutable, provider
   data) and "our interpretation of it" (derived, re-computable) are different aggregates with
   different lifecycles, sharing one table. `call_lead` also FK'd to `call_analysis`, implying a
   lead can't exist without a score — which isn't true (lead extraction is an independent step).

## Decision

**`raw_call` is the source-of-record, written on ingest arrival; everything derived FKs to it.**

```
raw_call (call_id PK)                ← captured first, before any analysis
  ├─ call_analysis (call_id FK→raw_call)   ← derived KPI scoring
  │    └─ call_kpi (call_id FK→call_analysis)
  └─ call_lead     (call_id FK→raw_call)   ← derived lead/booking (independent of scoring)
```

- `raw_call`: `payload` JSONB (verbatim) + lifted call metadata (`location_id`, `agent_id`,
  `contact_id`, `duration_sec`, `call_at`, `received_at`).
- `call_analysis`: now only the derived layer (`overall_score`, `summary`, `analysis` JSONB,
  `scored_at`) + denormalized `location_id`/`agent_id` for WHERE clauses. The raw payload and
  call timing are **joined from `raw_call`** when a read needs them (`get`/`list`/`recentAnalyses`).
- **Ingest order changed**: `ingestRawCall` now `saveRaw()` **first** (durable capture), then
  scores → `save()` analysis, then extracts → `saveLead()`. A scoring/extraction failure leaves
  the raw call persisted and reprocessable; the `skipped-empty` path still records the raw call.
- New `RawCallRepository` (same swappable-interface pattern as ADR-0008). `StoredCall` (the read
  shape) is unchanged, so the `/api/*` responses and the dashboard are untouched.

## Rationale

- **No data loss on the failure-prone step.** Capturing raw before the LLM call is the standard
  ingest/transform split — the expensive, flaky transform can't take the source down with it.
- **Honest aggregate boundaries (E3).** Provider truth vs our derivation are separate rows with
  separate FKs; `call_lead` no longer pretends to depend on a score.
- **Cheap.** Reads that need call metadata add one indexed PK join; the hot analytics query
  (`call_kpi` GROUP BY) is unchanged. The public API contract didn't move.

## Consequences

- New table `raw_call` + `store/rawCallRepository.ts`. `call_analysis` loses `raw_call`,
  `duration_sec`, `call_at` columns; `get/list/recentAnalyses` JOIN `raw_call`.
- **Migration** `scripts/migrate-split-raw.mts` (transactional, idempotent) backfills `raw_call`
  from the legacy columns, re-points the `call_lead` FK, and drops the moved columns. **Run on
  the dev DB: 5 real calls migrated**; FKs verified pointing at `raw_call`; the layered re-ingest
  of the 123s call passed end-to-end (raw → score 88 → lead *Dibesh/booked/pending_review*).
- This is the first real schema *migration* — exactly the "no migration framework" gap ADR-0008
  flagged. A hand-written transactional script was enough at this size; if these multiply, adopt
  a migration runner (e.g. node-pg-migrate) rather than accreting scripts.
- Tests: `analysisRepository`/`leadRepository` integration specs now seed a `raw_call` parent
  first (FK); suite 54 → 55.
