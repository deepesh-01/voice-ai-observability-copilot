# Voice AI Observability Copilot

An **Agent Observability Copilot** for HighLevel Voice AI agents. It ingests call
transcripts, scores each call against per-agent KPIs, flags deviations / failures /
**"Use Actions"**, and synthesizes AI-generated prompt & script recommendations — all
surfaced in a dashboard **embedded inside HighLevel**. It automates the **Monitor** and
**Analyze** phases the brief calls a *"Validation Flywheel."*

Built as a HighLevel "Team of One" assignment (Q2'26) by Deepesh Rathod.
**Node.js + Express** backend · **Vue 3 + Vite** frontend · **Postgres** · **Anthropic
Claude (Opus)** for analysis · embedded via a **HighLevel Marketplace App** (Custom Page iframe).

> 📁 **All design, decisions, and tracking live in [`docs/`](./docs/).** Start at
> [`docs/README.md`](./docs/README.md) for requirement traceability, the ADR log, session
> history, and the functional-vs-mocked ledger.

---

## Architecture

> **Subsystem deep-dives:** [`server/README.md`](./server/README.md) — backend (HTTP surfaces,
> the ingest→score→persist pipeline, the webhook sequence diagram, the Postgres data model) ·
> [`web/README.md`](./web/README.md) — frontend (view-state machine, typed API client, craft layer).

The system closes one loop — **raw call → KPI scores → recommendations** — end to end on
real HighLevel data:

```
 HighLevel Voice AI
        │
        │  call ends
        ▼
 ┌──────────────────┐   Ed25519-verified webhook (VoiceAiCallEnd)   ┌──────────────────┐
 │  Ingestion       │ ◀── primary path: acks 202 in ~30ms, scores  │  GHL Voice AI /  │
 │  (server/ingest) │     async. Poll script = backfill safety net │  Conversations   │
 └────────┬─────────┘                                              │  API (OAuth)     │
          │  transcript + agent goal                                └──────────────────┘
          ▼
 ┌──────────────────────────── Analysis pipeline (server/analysis) ────────────────────┐
 │  transcript.ts  →  kpis.ts        →  score.ts (Claude Opus, structured output)       │
 │  parse bot/human   6 config KPIs     KPI scores + deviations + "Use Action" segments │
 └────────┬─────────────────────────────────────────────────────────────────────────────┘
          │  CallAnalysis (schema-validated)
          ▼
 ┌──────────────────┐     ┌────────────────────────────────────────────────────────────┐
 │  Persistence     │     │  recommend.ts  →  cross-call synthesis (Claude Opus)        │
 │  Postgres + JSONB│ ──▶ │  agent's stored analyses + KPI averages → prioritized,     │
 │  (AnalysisRepo)  │     │  copy-pasteable prompt/script fixes. Cached per agent.      │
 └────────┬─────────┘     └────────────────────────────────────────────────────────────┘
          │  REST: /api/analyses · /api/kpis/averages · /api/recommendations · /api/agents
          ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │  Vue 3 dashboard (web/)  —  embedded in HighLevel as a Custom Page iframe             │
 │  cross-agent overview → agent detail (KPI profile + recommendations) → call detail    │
 │  (KPI scorecards · evidence chips → scroll-to-turn · transcript w/ "Use Action" spans)│
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

**Key design choices** (full rationale in [`docs/decisions/`](./docs/decisions/)):

- **Schema-validated LLM output** (ADR-0002) — scoring & recommendation calls go through the
  Claude Agent SDK with structured output, so the UI can trust the data shape. No free-text parsing.
- **Postgres + JSONB** (ADR-0008) — full analysis fidelity in JSONB plus lifted, indexed
  columns; a flat `call_kpi` table makes per-agent KPI averages plain SQL. OAuth install
  tokens also live in Postgres (`oauth_tokens`) — durable and multi-tenant.
- **Webhook-first ingestion** — `VoiceAiCallEnd` is verified (Ed25519), acked fast, and scored
  async; a poll script backfills. So "real-time" is genuinely on call-completion.
- **Swappable storage interface** (`AnalysisRepository`) — ingest/scoring code doesn't know
  it's Postgres.
- **CSS-transform KPI bars, no charting lib** (ADR-0009) — lighter, and animates on the GPU.

**Six KPIs** (config-driven, ADR/`analysis/kpis.ts`): goal completion · script adherence ·
info capture · accuracy · objection handling · sentiment — weighted into an overall score.

---

## Team of One — owning Product, Design, Engineering & QA

A single builder owns the whole SDLC; each discipline has an explicit home in the repo so
nothing is dropped (full write-up: [`docs/team-of-one.md`](./docs/team-of-one.md)).

| Discipline | Owns | Lives in |
|------------|------|----------|
| **Product** | Scope under the 5-day window, KPI/"Use Action" definitions, product calls | [`requirements.md`](./docs/requirements.md), [`assumptions-and-product-calls.md`](./docs/assumptions-and-product-calls.md) |
| **Design** | Customer-centric dashboard UX, native HighLevel feel (E1) | [`ux-changelog.md`](./docs/ux-changelog.md), UX ADRs |
| **Engineering** | Ingest → score → recommend → dashboard + the marketplace integration | [`decisions/`](./docs/decisions/) (9 ADRs) + the code |
| **QA** | Correctness, honesty about real-vs-mocked, non-slop review (E4) | [`functional-vs-mocked.md`](./docs/functional-vs-mocked.md), tests, session reviews |

The mechanism that lets one person wear four hats: a **Trace → Compare → Decide → Log →
Register** loop — every product call becomes an assumption, every engineering choice an ADR,
every QA reality a ledger row, stitched into a timeline by per-session logs in
[`docs/sessions/`](./docs/sessions/).

---

## What's functional vs mocked

Honesty here is graded (D3.1, E2). Full living ledger:
[`docs/functional-vs-mocked.md`](./docs/functional-vs-mocked.md).

- 🟢 **Real & live:** HighLevel OAuth + install (sandbox sub-account), transcript ingestion
  (webhook + poll), transcript parsing, KPI config, **LLM KPI scoring + deviation/"Use Action"
  detection**, **cross-call recommendations** (cached), Postgres persistence, the read API, and
  the full dashboard drill-down — all verified end-to-end on **real BrightSmile Dental calls**.
- 🟡 **Partial:** "Use Action" spans are detected and highlighted, but not yet tied to GHL's
  `extractedData` / `executedCallActions` (assumption A-005, open).
- 🔴 **Mocked:** none silently — any simulated path is declared in the ledger.

---

## Repo layout

| Path | What |
|------|------|
| `server/` | Express backend: GHL OAuth (tokens in Postgres), ingestion, analysis pipeline, recommendations, REST API — **architecture: [`server/README.md`](./server/README.md)** |
| `server/analysis/` | The observability brain: `transcript` → `kpis` → `score` → `recommend` |
| `web/` | Vue 3 dashboard, embedded in HighLevel — **architecture: [`web/README.md`](./web/README.md)** |
| `docs/` | Requirements, ADRs, session logs, assumptions — the source of truth |
| `.env.example` | Config template (real `.env` is gitignored) |

---

## Quick start (local)

```bash
# 1. Configure — fill CLIENT_ID / CLIENT_SECRET (Marketplace app), DATABASE_URL (Postgres),
#    CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`).
cp .env.example .env

# 2. Backend  (creates tables on boot)
cd server && npm install && npm run dev      # http://localhost:8095

# 3. Frontend (separate terminal)
cd web && npm install && npm run dev          # http://localhost:5173 (proxies /api → backend)
```

Run the analysis loop without the UI:

```bash
cd server
npx tsx scripts/ingest.mts        # poll + score the sandbox's Voice AI calls → Postgres
npx tsx scripts/recommend.mts     # synthesize recommendations for an agent's call history
```

**Tests:** `cd server && npm test` (43 incl. Postgres integration) · `cd web && npm test`
(10 unit) · `cd web && npm run test:e2e` (12 Playwright E2E).

Full **sandbox install + marketplace app + cloudflared (permanent URL)** steps —
required deliverable **D1.1** — are in
**[`docs/setup-highlevel.md`](./docs/setup-highlevel.md)**.

---

## Status

The observability loop is **closed and live on real data**: raw HighLevel calls → KPI scores →
flagged "Use Actions" → AI recommendations, in an embedded dashboard. Current state and the
remaining polish (demo recording, read-API auth) are tracked in
[`docs/README.md`](./docs/README.md) → *Status at a glance*.
