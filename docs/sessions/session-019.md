# Session S-019 — 2026-06-26 — Interview prep (Extension Round: Coding + System Design)

> Non-dev session. No product code changed. Output is a set of interview-prep study artifacts
> at the repo root, built by reading the codebase end-to-end and running mock drills.

## Goal
Prepare for the HighLevel Extension Round (Coding + System Design, 120 min, today 12 PM) — built
directly on this assignment. Read the code thoroughly, produce design rationale + a weaknesses/fixes
ledger, predict extension questions, map Postgres→Mongo, then run interactive mock-interview and
internals drills, and capture everything into reusable cheat sheets.

## Done
- **Read the full backend + frontend** (ingest/webhook/score/recommend/repos/schema/OAuth/LLM seam;
  Vue SPA: App.vue view-state machine, AgentView, agents.ts, api client) and the docs trail.
- **Delivered analysis (chat):** system summary + data model + boundaries; one-paragraph design
  rationale per major decision; weaknesses/cut-corners each paired with a live fix; 7 predicted
  extension questions with answer spines; Postgres→Mongo mapping.
- **Ran a mock interview** (Shivam + Tushar personas): concurrency (burst/fan-out, atomic claim,
  lease, idempotency), multi-tenancy/Mongo, schema evolution — with per-answer senior-signal critique.
- **Ran a Node internals + idempotency drill** (event-loop ordering, setImmediate vs setTimeout,
  the await-gap race, idempotent `/charge`).
- **Created six study artifacts at repo root** (study aids, not product code):
  - `INTERVIEW-CHEATSHEET.md` — system design, concurrency, scale, multi-tenancy, mock reflexes.
  - `NODEJS-CHEATSHEET.md` — event loop, async internals, idempotency, streams, modules (+ drill answers).
  - `VUE-CHEATSHEET.md` — Vue 3 reactivity/Composition API grounded in this frontend.
  - `VUE-QUIZ.md` — 25 self-test Q&As + the honest "I directed AI to build the frontend" positioning.
  - `MONGO-VS-POSTGRES-CHEATSHEET.md` — every operation as Postgres-way → Mongo-way, anchored to this schema.
  - `TRADEOFFS-CHEATSHEET.md` — 30 decisions as Chose · Alternative · Why-for-this-app · When-I'd-flip.
- **Clarified, on request:** the ERD, `agent_recommendations` schema + `report` JSONB shape, `call_kpi`
  as a derived fact table vs the static `KPI_CATALOG` (code, `kpis.ts`), SPA meaning, why no router,
  account-switching behavior (location picker, no per-user auth) in the live embedded version, and why
  the atomic-claim UPDATE depends on the `call_id` unique constraint.

## Decisions
- None (no ADRs; no product/code changes). Prep artifacts only.

## Assumptions touched
- None.

## Notes / honest framing surfaced for the round
- Top exposure areas to **volunteer**: in-process async IIFE (not durable), in-memory dedup Set
  (single-pod), opt-in webhook signature, and the **#1 fix — multi-tenant authz** (API trusts a
  client-supplied `locationId`; fix = HighLevel SSO-derived tenant). These map to the trade-offs sheet.
- Frontend: be honest that the Vue build was AI-directed; lead with architectural ownership.

## Open questions / next action
- **Next action:** Attend the HighLevel Extension Round (today, 2026-06-26, 12 PM). Before it, re-read
  the "three boxes" (System Design / Node / Vue summaries) + the `TRADEOFFS-CHEATSHEET.md`
  "when I'd flip" column. No code work pending. *(If desired post-round: the six root-level cheat
  sheets are personal study aids and could be moved under `docs/` or gitignored if they shouldn't ship
  with the assignment repo.)*
