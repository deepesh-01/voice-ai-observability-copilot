# ADR-0013: Hybrid lead facts — native extractedData over LLM inference

- **Status:** Accepted
- **Date:** 2026-06-20
- **Session:** S-015
- **Traces to:** R2.1 (use the agent's real outputs), R2.2 (observe against the agent's configured extraction), E2, E3
- **Builds on:** ADR-0010 (lead model), ADR-0012 (lead signals)

## Context

We reconfigured the BrightSmile agent with 9 native `DATA_EXTRACTION` actions, and confirmed
on real calls that the call payload now carries a **populated, per-call `extractedData`** —
ground-truth structured fields the agent itself captured (clean E.164 phone, `bookingInterest`,
`Treatment Interest`, `DateTimeOfBooking`, …). Previously we **LLM-derived every lead fact** from
the transcript, which drifts: ASR mangles names across calls ("Dipesh Rathur" / "Dibesh Rathore"),
phones come out unformatted ("798-721-5728"), and booking status is inferred rather than stated.

But native data has a hard limit (confirmed by research): it records only what the agent
**successfully captured** — never what it **missed**. It cannot emit "the agent failed to book a
ready caller" or "no email was collected." Those gap/judgment signals are the observability value.

## Decision

**Hybrid: native facts, LLM signals — with provenance.**

- **Facts** (identity, problem, treatment, booking status, booked-at) resolve in precedence:
  **native `extractedData` → the GHL contact record → the LLM extraction.** Native wins.
- **Signals** (`missed_opportunity`, `human_action_needed`) are **always the LLM's judgment**.
  GHL can't produce them.
- **Provenance**: `call_lead.source` is `'ghl'` when native facts were present, else `'llm'`;
  the raw `extractedData` blob is stored in `call_lead.native` for the dashboard's
  ground-truth display and honest "real vs inferred" labelling.
- **Mapping** (`analysis/nativeFacts.ts`, pure + tested): `extractedData` keys are the
  *operator-chosen action names* ("Treatment Interest", "bookingInterest"), so we match by
  normalized **keyword** rather than exact key — robust across agents. `bookingInterest`
  enum → `BookingStatus`; loose GHL datetimes → ISO. The match for `bookingInterest` requires
  both "booking" and "interest" so it can't swallow "Treatment Interest" or "DateTimeOfBooking".

## Rationale

- **Ground-truth where it exists, judgment where it's needed.** Native facts are cleaner and
  authoritative; the LLM stays responsible for the gap detection that *is* the product.
- **Honest (E2/E4).** The `source` flag + stored `native` blob mean the dashboard never passes an
  inferred fact off as confirmed.
- **Resilient.** LLM extraction remains the fallback, so unconfigured agents / null native fields
  still produce a complete lead (e.g. native `email: null` → contact → LLM).

## Consequences

- New `analysis/nativeFacts.ts`; `assembleLead` takes `extractedData` and applies precedence.
  `call_lead` gains `source` + `native`; `scripts/migrate-lead-source.mts` adds them.
- `scripts/backfill.mts --releads` re-derives leads for every scored call from the stored raw
  payloads — used to upgrade the existing 16 calls to hybrid without re-calling GHL.
- Tests: `nativeFacts.test.ts` (maps the real captured shape) + assembleLead native-precedence;
  suite 52 → 59.
- A future refinement: when an `APPOINTMENT_BOOKING`/`CALL_TRANSFER` action is configured,
  `executedCallActions` becomes a second native fact source (currently `[]`).
