# Session S-015 — 2026-06-20 — Auth→Postgres, README (D3), lead/booking observability layer, raw_call normalization, native-data agent + hybrid ingestion

## Goal

A long, defining session spanning hardening and a major new capability arc: move OAuth off the
file store, refresh the README for D3, build a per-call **lead/booking observability layer**,
normalize `raw_call` into a durable source-of-record, reframe that layer from a booking
*workflow* into observability *signals*, reconfigure the live agent into a realistic clinic
front-desk with **native data extraction**, capture a real varied dataset, and wire **hybrid
ingestion** (native ground-truth facts + LLM signals).

## Done

### Auth → Postgres (hardening)
- OAuth install tokens moved from the gitignored `tokens.json` to Postgres `oauth_tokens`
  (`tokenStore.ts` rewritten, same 3-fn surface). `scripts/migrate-tokens.mts` migrated the live
  sandbox install. 5-test integration suite. Verified live: read-back + `getValidAccessToken`
  refresh from the DB.

### README / D3
- README rewritten: architecture diagram (ingest→score→persist→recommend→dashboard), key
  decisions, **Team-of-One** ownership table, functional-vs-mocked summary. ADR-0008 annotated
  with a deliberate **no-ORM** rationale + the as-built schema.

### Lead/booking layer → observability signals
- **ADR-0010**: `call_lead` + LLM lead extraction (Haiku) + `getContact`. **ADR-0012**: dropped
  the booking-**approval workflow** (scope drift — overlaps GHL's CRM) and reframed to two
  observability signals: `missed_opportunity` (R2.3) + `human_action_needed` (R2.6), each with a
  reason. Migrations `migrate-lead-signals.mts`.

### raw_call normalization (ADR-0011)
- `raw_call` is now the **source-of-record**, written on ingest arrival *before* scoring;
  `call_analysis` + `call_lead` FK to it. `RawCallRepository`; `save()` slimmed; reads JOIN
  raw_call. `scripts/migrate-split-raw.mts` migrated existing data (5 calls). Durability: a
  scoring failure no longer loses the call.

### Live agent reconfigured (realistic clinic + native extraction)
- Agent prompt rewritten into a real **general dental clinic** front-desk: hours, in/out-of-scope
  services (no extractions/implants/bridges/cosmetic), **pricing** ballparks + **100/80/50
  insurance** tiers, triage, referrals; email made optional (one of phone/email). Pushed via
  `configure-agent.mts` with a **back-up + PATCH + verify** safety check (confirmed GHL PATCH
  *merges* — the 9 actions survived).
- User configured **9 `DATA_EXTRACTION` actions** (name, email, phone, chief complaint, treatment
  interest, datetime, bookingInterest, IsHumanHandover). Confirmed `extractedData` populates
  **per-call** (not just the mutable contact record).

### Real dataset captured + reconciled
- **16 real calls** across varied scenarios. `scripts/backfill.mts` reconciles GHL vs
  raw/analysis/lead and repairs gaps from the durable raw store. Verified: **nothing slipped,
  all scored**, 4 legacy leads backfilled. Per-call webhook snapshots now saved as
  `webhook-<id>.json`.

### Hybrid ingestion (ADR-0013)
- Facts (identity/booking/treatment) resolve **native `extractedData` → contact record → LLM**;
  **signals always LLM** (GHL records successes, not gaps). `source` provenance flag + raw
  `native` blob. `analysis/nativeFacts.ts` keyword mapper (tested on the real shape).
  `backfill.mts --releads` re-derived all 16: **11 `ghl`** (clean `+E.164` phones, native
  booking/treatment) + **5 `llm`** (older pre-config calls, correct fallback).

- **Tests 43 → 59.** Typecheck clean throughout.

## Decisions

- **ADR-0010** — Lead & booking data model + LLM extraction (R2.6/R2.2/R2.3/E2). *(approval
  workflow later superseded.)*
- **ADR-0011** — Normalize `raw_call` into its own source-of-record table (R2.1/E2/E3).
- **ADR-0012** — Lead data as observability signals, not a booking-approval workflow
  (supersedes ADR-0010 workflow; R2.3/R2.6/E2).
- **ADR-0013** — Hybrid lead facts: native `extractedData` over LLM inference (R2.1/R2.2/E2/E3).
- ADR-0008 annotated (no-ORM rationale; schema superseded by 0011).

## Assumptions touched

- **A-005 RESOLVED/advanced**: "Use Actions" = KPI useActions/deviations **+** the two call-level
  signals. Research confirmed the brief's "Use Actions" ≠ GHL's native Actions feature, so our
  interpretation stands. Booking-approval framing retired.
- Research findings (GHL-integration agent): GHL has **no text/sim mode** for Voice AI (real-agent
  flywheel needs telephony — deferred); **MCP** is an outbound server, not an in-call tool (not
  relevant); native Actions/`extractedData` are configurable + populate per-call.

## Next action

**Build the dashboard surfacing (task #12):** show each call's two observability signals
(`missed_opportunity`, `human_action_needed` with reasons) and the lead facts next to the KPIs,
with **`source` provenance** ("GHL-confirmed" vs "inferred") and the `native` blob for the
confirmed fields. Wire to `GET /api/leads`. Then the **synthetic webhook-payload generator +
replay harness (#20)** — generate full GHL-shaped payloads (transcript + `extractedData`) modeled
on the captured real shape, POST to `/webhooks/ghl/voice-ai`, labeled `synthetic`. **D2 demo
still unrecorded** and **`/api/*` auth still open** — both remain pending hardening/deliverable items.
