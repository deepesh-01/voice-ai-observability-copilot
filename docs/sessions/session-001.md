# Session S-001 — 2026-06-18 — Project kickoff & tracking system

## Goal

Understand the assignment from the source PDFs and stand up the documentation /
decision-tracking foundation before any code is written, so that "nothing is untracked"
from the very first decision.

## Done

- Read all three source PDFs:
  - `[Hiring] FSB Assignment Q226.pdf` — the actual brief (Voice AI Observability Copilot).
  - `Gmail - Assignment – Next Step with HighLevel.pdf` — 5-day deadline, panelist Dhairya.
  - `Gmail - Remote Opportunity Fullstack Builder AI Role at HighLevel.pdf` — JD / "Team of One" context.
- Extracted requirements into `docs/requirements.md` with stable IDs (`R*`, `D*`, `E*`, `C*`).
- Stood up the `docs/` structure: README (method + index), decisions/, sessions/,
  assumptions register, functional-vs-mocked ledger, team-of-one doc, comparisons/.
- Wrote first two ADRs.

## Decisions

- **ADR-0001** — Adopt in-repo Markdown ADRs + session logs + traceability as the tracking
  system. (Traces to D3, C2, E3, E4.)
- **ADR-0002** — Core stack: Express + Vue 3/Vite/TS + Anthropic Claude (Sonnet 4.6 /
  Opus 4.8 routed) + MongoDB, shipped as a HighLevel Marketplace App. (Traces to D1, R1.2, C3.)

## Assumptions touched

- Created A-001 … A-006 (integration surface, perf, transcript availability, KPI modeling,
  "Use Actions" definition, "real-time" scope). All 🟡 Assumed — to be validated against the
  sandbox and real transcripts.

## Open questions / next action

- **Open:** sandbox access (R1.1) — can we provision a marketplace app? (A-001)
- **Open:** what do real transcripts look like via the API? (A-003)
- **Next action:** log into the HighLevel sandbox, inspect the Voice AI / Conversations
  transcript API, and resolve A-001/A-003. Then design the observability architecture
  (ingestion → KPI scoring → recommendation) as the next ADR.
