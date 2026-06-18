# Voice AI Observability Copilot

An **Agent Observability Copilot** for HighLevel Voice AI agents — it ingests call
transcripts, scores them against per-agent KPIs, flags failures and "Use Actions", and
surfaces AI-generated prompt/script recommendations in a dashboard embedded inside HighLevel.

Built as a HighLevel "Team of One" assignment (Q2'26). **Node.js + Express** backend,
**Vue 3 + Vite** frontend, **Anthropic Claude** for analysis, embedded via a **HighLevel
Marketplace App** (Custom Page iframe).

> 📁 **All design, decisions, and tracking live in [`docs/`](./docs/).** Start at
> [`docs/README.md`](./docs/README.md) for the architecture, decision log (ADRs), session
> history, requirement traceability, and the functional-vs-mocked ledger.

## Repo layout

| Path | What |
|------|------|
| `server/` | Express backend: GHL OAuth, Voice AI transcript ingestion, (later) KPI scoring + recommendations |
| `web/` | Vue 3 dashboard (embedded in HighLevel) |
| `docs/` | Requirements, ADRs, session logs, assumptions — the source of truth |
| `.env.example` | Config template (real `.env` is gitignored) |

## Quick start (local)

```bash
# 1. Configure
cp .env.example .env   # fill CLIENT_ID / CLIENT_SECRET from the Marketplace app

# 2. Backend
cd server && npm install && npm run dev      # http://localhost:8095

# 3. Frontend (separate terminal)
cd web && npm install && npm run dev          # http://localhost:5173 (proxies /api → backend)
```

Full sandbox install + cloudflared (permanent URL) steps:
**[`docs/setup-highlevel.md`](./docs/setup-highlevel.md)**.

## Status

Setup milestone: OAuth + embeddable dashboard shell scaffolded. KPI scoring,
recommendations, and the full dashboard are next — see the status table in
[`docs/README.md`](./docs/README.md).
