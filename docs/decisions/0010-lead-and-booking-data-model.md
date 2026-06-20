# ADR-0010: Lead & booking data model + LLM extraction + booking-approval policy

- **Status:** Accepted
- **Date:** 2026-06-20
- **Session:** S-015
- **Traces to:** R2.6 ("Use Actions" / human intervention), R2.2 (observability parameters incl. booking goals), R2.3 (missed-opportunity detection), E2 (close the loop to a commercial action)
- **Rests on / advances:** A-005 (Use Actions), A-004 (KPI model)
- **Builds on:** ADR-0008 (Postgres + JSONB, swappable repository)

## Context

Until now the system stored each call and *our analysis of it* (KPI scores, deviations,
use-actions), but **nothing structured about the lead or the booking** — who called, what they
wanted, and whether we booked them. That's the commercially actionable layer, and structuring
exactly this kind of data is the reason ADR-0008 chose Postgres over a blob store. The product
direction: from every call, capture at minimum a way to contact the lead later (name + phone),
plus the booking outcome and whether it needs a human's sign-off.

A wrinkle from A-003: in the sandbox, GHL's own `extractedData` / `executedCallActions` come
back **empty** because the agent isn't configured with structured actions/goals. So we cannot
rely on GHL to hand us the booking outcome — we **derive it from the transcript ourselves**.

## Decision

**Two new tables (`call_lead`, `booking_policy`) + an LLM extraction step in ingest + a
booking-approval workflow.**

1. **`call_lead`** — one row per call (FK → `call_analysis`, cascade delete). Lead identity
   (`caller_name`, `phone`, `email`), intent (`problem`, `treatment`), booking outcome
   (`booking_status`, `booked_at`, `confirmed`, `follow_up_required`), and approval state
   (`approval_status`, `approved_by`, `approved_at`). Full LLM output kept in an `extraction`
   JSONB for fidelity. Indexed on `phone`, `agent_id`, `booking_status`, `approval_status`,
   `booked_at` — so "every implant lead who didn't book", "unconfirmed bookings this week",
   "leads to call back" are plain SQL.

2. **LLM extraction on Haiku, not Opus.** Lead extraction is fact-pulling, not the nuanced
   judgement KPI scoring needs, so it runs on `claude-haiku-4-5` — cheaper and faster than the
   Opus scorer. It runs alongside scoring in `ingestRawCall`, **non-blocking**: a failure logs
   and is swallowed, never losing the already-committed scored call. Pure `assembleExtraction`
   / `assembleLead` functions validate and merge the output (unit-tested, no LLM in tests).

3. **Identity: contact record wins.** `phone`/`name`/`email` come from the GHL **Contact**
   (`getContact`, authoritative) when available, falling back to what the transcript surfaced —
   because the call log only carries `contactId`, not the number.

4. **Booking-approval policy — per-agent with a location default.** `booking_policy` keyed by
   `(location_id, agent_id)`, where `agent_id=''` is the location-wide default. Resolution at
   ingest: **agent row → location default → `manual_review`** (conservative fallback). The
   resolved mode sets `approval_status` for booked calls: `auto_approve → auto_approved`,
   `manual_review → pending_review`. A **full approve/reject workflow** mutates it afterward
   (`POST /api/leads/:callId/{approve,reject}`, with `approved_by`/`approved_at` audit columns).

5. `confirmed` (agent confirmed the booking *on the call*) is kept **distinct** from
   `approval_status` (operator's policy-driven sign-off) — they answer different questions.

## Rationale

- **Closes the loop to action (E2).** A scored call is observability; a captured lead with a
  pending booking is something the business *does something with*. `pending_review` bookings are
  exactly the R2.6 "Use Action: human intervention needed" signal, now backed by real data.
- **Realizes the reason for Postgres (ADR-0008).** These are queryable columns, not a blob —
  the structuring that justified a relational store over Mongo/files.
- **Cost-aware (A-002).** A second LLM call per ingest could double cost; routing extraction to
  Haiku keeps it cheap, consistent with ADR-0002's "right model for the job" routing.
- **Honest about the sandbox.** We derive booking outcome via LLM because GHL's structured
  fields are empty; if/when agent actions are configured, `executedCallActions` can be preferred
  over the LLM guess without schema change (the `extraction` JSONB already isolates provenance).

## Consequences

- New module `analysis/extractLead.ts` + repository `store/leadRepository.ts` (same swappable
  interface pattern as `AnalysisRepository`). New endpoints under `/api/leads` and
  `/api/booking-policy`.
- **Verified live:** extraction on the real 123s booking call returned name *Dibesh*, phone,
  *tooth pain*, `booked` @ a concrete time, `confirmed=true`; policy resolution flipped approval
  correctly. Pure logic covered by unit tests; repository + policy resolution by Postgres
  integration tests (suite 43 → 54).
- A-005 advances from "transcript deep-links" to "transcript deep-links **+ booking approvals**"
  as the concrete Use-Action surface.
- The approval endpoints are **unauthenticated** like the rest of `/api/*` — `approved_by` is
  taken from the request, not a verified identity. Real auth is the pending hardening pass.
