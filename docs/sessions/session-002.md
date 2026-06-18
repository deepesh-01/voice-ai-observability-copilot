# Session S-002 — 2026-06-18 — Specialized Claude agent roster

## Goal

Stand up specialized Claude subagents matched to the disciplines and product surfaces we
identified in S-001, so the "Team of One" can execute with focused, traceable ownership.

## Done

- Created 6 project-level agents in `.claude/agents/`:
  - `product-strategist.md` (Product, opus)
  - `ux-designer.md` (Design, opus)
  - `ghl-integration-engineer.md` (Eng — integration, sonnet)
  - `observability-engineer.md` (Eng — analysis brain, opus)
  - `dashboard-engineer.md` (Eng — frontend, sonnet)
  - `qa-reviewer.md` (QA, opus, read/run-only)
- Each agent prompt: reads `docs/requirements.md`, traces to requirement IDs, and is bound to
  the tracking loop (ADR + assumptions + session log).

## Decisions

- **ADR-0003** — Adopt a 6-agent roster (disciplines + Engineering's 3 surfaces), with model
  routing (opus for judgment/review, sonnet for mechanical build) and the reviewer scoped
  read/run-only. (Traces to C2, D3, E3, E4, C1.)

## Assumptions touched

- None created. Agents are wired to *resolve* existing assumptions (A-001/A-003/A-004/
  A-005/A-006) as they execute.

## Open questions / next action

- **Next action:** put the agents to work — first real task is for `ghl-integration-engineer`
  to resolve A-001/A-003 (sandbox access + transcript API shape), and for
  `observability-engineer` + `product-strategist` to lock the KPI schema (A-004) as the next ADR.
- Roster is provisional; revise the `.claude/agents/` files and supersede ADR-0003 if the
  split proves wrong in practice.
