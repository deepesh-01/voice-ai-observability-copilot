# Voice AI Observability Copilot — Documentation & Decision Log

> **HighLevel — Fullstack Builder ("Team of One") Assignment, Q2'26**
> Owner: Deepesh Rathod · Started: 2026-06-18 · Due: 2026-06-23 (5 days)

This `docs/` folder is the **single source of truth** for the product. Per the brief
("Team of One" ownership across Product, Design, Engineering & QA), every decision —
product, design, technical, or scope — is recorded here and traced back to a requirement.

**Operating principle:** *Nothing is untracked.* We are allowed to take product calls,
make assumptions, and guess — but every one of those is written down, dated, justified,
and (where possible) data-backed and linked to the requirement it serves.

---

## What we're building

An **Agent Observability Copilot** that automates the **Monitor** and **Analyze** phases
for HighLevel Voice AI agents — a "Validation Flywheel" that turns raw call transcripts
into KPI scoring, failure detection, and actionable prompt/script recommendations, surfaced
in a dashboard embedded inside the HighLevel interface.

See [`requirements.md`](./requirements.md) for the full, ID'd requirement breakdown.

---

## How this documentation is organized

| Path | Purpose |
|------|---------|
| [`requirements.md`](./requirements.md) | Verbatim requirements from the brief, broken into traceable IDs (`R1.1`, `D2`, `E3`, …). The root all decisions trace back to. |
| [`decisions/`](./decisions/) | **Architecture Decision Records (ADRs).** One file per significant decision: context, options compared, choice, rationale, requirement traced. |
| [`sessions/`](./sessions/) | **Session logs.** One file per working session: what was done, what was decided, what's next. The chronological narrative. |
| [`assumptions-and-product-calls.md`](./assumptions-and-product-calls.md) | Register of every assumption, product call, and guess — each with status (assumed / validated / invalidated). |
| [`comparisons/`](./comparisons/) | Data-backed comparisons (tech, libraries, models, approaches) too large for inline ADR tables. |
| [`functional-vs-mocked.md`](./functional-vs-mocked.md) | Living ledger of what is **real** vs **mocked** — a required deliverable (D3.1). |
| [`ux-changelog.md`](./ux-changelog.md) | Living list of UI/UX changes & fixes (Design discipline), each traced to E1. |
| [`team-of-one.md`](./team-of-one.md) | How a single builder owns Product, Design, Engineering & QA — required deliverable (D3). |
| [`../server/README.md`](../server/README.md) · [`../web/README.md`](../web/README.md) | **Subsystem architecture deep-dives.** Backend incl. the [**webhook sequence diagram**](../server/README.md#webhook-call-sequence) + [Postgres schema](../server/src/db/SCHEMA.md); frontend incl. the view-state machine + typed API client. |

---

## The tracking method (how to use this)

Every time we make a non-trivial choice, we follow this loop:

1. **Trace** — which requirement does this serve? (`R*`, `D*`, `E*` from `requirements.md`)
2. **Compare** — what are the options? Tabulate them. Prefer data (benchmarks, cost,
   latency, lines-of-code, docs) over opinion.
3. **Decide** — record an ADR in [`decisions/`](./decisions/) with the chosen option and *why*.
4. **Log** — note it in the current [`sessions/`](./sessions/) entry.
5. **Register** — if the decision rests on an assumption or product call, add it to
   [`assumptions-and-product-calls.md`](./assumptions-and-product-calls.md).

> If a choice was made and it isn't reflected in an ADR, a session log, or the assumptions
> register, **it didn't happen correctly.** Fix the trail, not just the code.

> **Session-close rule:** no session ends without saving its progress and the next step —
> finish the session log (incl. a concrete **Next action**), update the indexes/status, and
> commit. See [`sessions/README.md`](./sessions/) → "Session-close practice".

### ID conventions

- `R*` / `D*` / `E*` — requirement / deliverable / evaluation-criterion IDs (`requirements.md`)
- `ADR-NNNN` — architecture decision record (`decisions/NNNN-*.md`)
- `A-NNN` — assumption / product call (`assumptions-and-product-calls.md`)
- `S-NNN` — session (`sessions/session-NNN.md`)

---

## Decision index

The authoritative, always-current list of decisions lives in
[`decisions/README.md`](./decisions/README.md). Session-by-session narrative lives in
[`sessions/README.md`](./sessions/README.md).

---

## Status at a glance

| Dimension | State |
|-----------|-------|
| Requirements captured | ✅ See `requirements.md` |
| Tracking system stood up | ✅ This folder (ADR-0001) |
| Tech stack chosen | ✅ ADR-0002 |
| Specialized agents stood up | ✅ ADR-0003 — 6 agents in `.claude/agents/` |
| Hosting & app scaffold | ✅ ADR-0004 — OAuth + dashboard shell run; permanent URL via cloudflared. **Prod origin moved to an always-on home machine (S-017): app + a dedicated cloudflared tunnel under pm2, DB migrated; runbook `deploy-home-mbp.md`.** |
| Embedded in HighLevel | 🟢 **Verified live (S-017):** Marketplace **Custom Page** + agency **Custom Menu Link** (left sidebar), both iframe-embedded in sub-account `B7Tz…` with real data (R1.2/E1; closes A-001). |
| GitHub repo (D1) | ✅ **Public:** https://github.com/deepesh-01/voice-ai-observability-copilot |
| Storage | ✅ Postgres + JSONB; **`raw_call` source-of-record** with `call_analysis`/`call_lead` FK (ADR-0008/0011, supersedes ADR-0002 Mongo). OAuth tokens in Postgres (S-015). |
| Architecture designed | ✅ Backend pipeline (capture raw → score → extract lead → persist → API) laid down |
| Implementation | 🟢 Full loop live on real calls: capture → KPI score → **lead facts + observability signals** → persist → webhook → recommendations (R2.5, cached) → dashboard drill-down (R2.4/R2.6/E1). **Lead/signals now surfaced across all three views (S-016, task #12): CallView "Lead & Outcome" panel w/ provenance + native drawer, AgentView badges/filters, Overview counts.** Read-API now **token-guarded** (`API_AUTH_TOKEN` bearer, injected into the SPA; verified live 401/200). |
| Real-vs-mocked | ✅ Ingestion/scoring/persistence/recommendations/dashboard + lead/signal extraction **+ surfacing** 🟢 live on **16 real calls**; see `functional-vs-mocked.md` |
| Tests | ✅ 59 server (incl. Postgres integration) · 15 web unit · 19 Playwright E2E |
| Demo recorded | ⏳ Pending (D2 — last open deliverable) |

_Last updated: 2026-06-21 (Session S-017)._
