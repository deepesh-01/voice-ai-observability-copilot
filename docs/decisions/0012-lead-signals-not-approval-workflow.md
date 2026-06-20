# ADR-0012: Lead data as observability signals, not a booking-approval workflow

- **Status:** Accepted
- **Date:** 2026-06-20
- **Session:** S-015
- **Traces to:** R2.3 (missed opportunities), R2.6 ("Use Actions" / human intervention), E2, E3
- **Supersedes:** the **booking-approval workflow** portion of [ADR-0010](./0010-lead-and-booking-data-model.md) (the `booking_policy` table, `approval_status`/`approved_by`/`approved_at`, the resolve/approve/reject logic and endpoints). The lead **extraction** from ADR-0010 stands.

## Context

ADR-0010 added a per-call lead model *and* a booking-approval workflow (per-agent policy →
`auto_approved`/`pending_review`, plus approve/reject endpoints with audit columns). On review,
the workflow was **scope drift**: the brief is an agent-performance **observability** tool, not
a booking-management system. The approval workflow (a) re-implemented what HighLevel's CRM
already owns and (b) was ungraded against E1–E4 on a 5-day clock.

The lead *extraction*, by contrast, is on-mission **if framed as observability signal** rather
than ops: "caller wanted X, agent never booked them" is a **missed opportunity (R2.3)**;
"booking taken but not confirmed" is a **human-action / Use Action (R2.6)**.

## Decision

**Drop the approval workflow; reframe the lead's actionable output as two observability signals.**

- Removed: `booking_policy` table, `BookingMode`/`ApprovalStatus` types, `deriveApprovalStatus`,
  `resolvePolicy`/`setPolicy`/`listPolicies`/`getPolicy`/`setApproval`, the
  `POST /api/leads/:callId/{approve,reject}` and `GET|PUT /api/booking-policy` endpoints, and the
  `approval_status`/`approved_by`/`approved_at`/`follow_up_required` columns.
- Added to `call_lead` + `LeadExtraction`: **`missed_opportunity`** (bool) + reason, and
  **`human_action_needed`** (bool) + reason — both LLM-extracted (the model has the transcript
  context to judge intent and unresolved state). Partial indexes on each (the dashboard queries
  "what needs attention", i.e. only the `true` rows).
- `/api/leads` now filters by `missedOpportunity=1` / `humanActionNeeded=1` instead of approval
  status. Read-only — we **flag**, the operator acts in HighLevel.

## Rationale

- **Back on-mission (E2/E3).** The two signals plug straight into the brief's required outputs —
  missed opportunities (R2.3) and Use-Actions (R2.6) — at call granularity, complementing the
  KPI scorer's turn-level deviations/useActions.
- **No overlap with HighLevel.** We don't run bookings; GHL's CRM does. We surface the
  observability insight a human acts on.
- **Less code, same value.** Net deletion of a table, a policy resolver, four endpoints, and the
  audit columns — the lead extraction we keep is the part that was actually pulling its weight.

## Consequences

- Migration `scripts/migrate-lead-signals.mts` (transactional) drops the workflow artifacts and
  adds the signal columns; **run on the dev DB**.
- **Verified live:** the good 123s booking call → both signals false; the broken 12s "I don't
  know" call → `missed_opportunity=true` ("agent did not attempt to clarify or assist") and
  `human_action_needed=true` ("follow up with confused caller"). Exactly the R2.3/R2.6 framing.
- Tests updated (approval/policy specs removed; signal-filter specs added); suite 55 → 52.
- Dashboard work (task) surfaces the two signals next to the KPIs — **no approve/reject UI**.
- A-005 is now served by KPI useActions/deviations **plus** these call-level signals; the
  approval-workflow framing in ADR-0010/A-005 is retired.
