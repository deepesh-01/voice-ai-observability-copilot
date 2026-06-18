# Session S-009 — 2026-06-19 — Ingestion pipeline live (empty)

## Goal

After the scoped reinstall, verify the live HighLevel connection and the Voice AI ingestion
path end-to-end.

## Done

- Live status probe: `{connected:true, voiceAiScopeOk:true}` — Voice AI scope active.
- `GET /api/calls?locationId=B7TzvBb6H6QvDNdEEhlt` → **200** `{"callLogs":[],"totalRecords":0,
  "traceId":"…"}`. Auth + `voice-ai-dashboard.readonly` + endpoint all confirmed working.
- Milestone: **auth → scope → ingestion is functional against the live API** (not mocked).

## Findings

- List Call Logs response shape (live): `{ callLogs: CallLog[], totalRecords: number, traceId }`
  — note `totalRecords` (not `meta.total`); will align the `api.ts` type when we see a row.
- Sandbox has **0 Voice AI calls** → can't yet capture the per-call / transcript shape (A-003).

## Decisions / assumptions

- A-007, A-011 → ✅ validated (scoped reinstall works).
- A-003 → list shape 🟢; transcript shape still 🟡 (needs one real call).

## Next action

- **Builder:** create a **Voice AI agent** in the sandbox sub-account + generate **one test
  call** so a real transcript exists. Then capture `Get Call Log` shape → finalize A-003.
- **Fallback (if real calls are hard in sandbox):** build the pipeline against a fixture
  shaped to the real list response + a representative transcript, clearly flagged in
  functional-vs-mocked. Then move to the KPI schema (A-004).
