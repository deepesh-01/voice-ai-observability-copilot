# ADR-0003: Specialized Claude agent roster

- **Status:** Accepted
- **Date:** 2026-06-18
- **Session:** S-002
- **Traces to:** C2 (single builder owns SDLC across Product/Design/Eng/QA), D3 (Team-of-One ownership), E3 (technical integrity), E4 (non-slop review), C1 (5-day speed)
- **Rests on assumptions:** none

## Context

We operate as a "Team of One" but can deploy AI tooling so a single builder covers Product,
Design, Engineering & QA (C2, D3). To do this without context-thrash, we want **specialized
Claude subagents**, each with a focused system prompt, the right tools, and a model tier
matched to the work — and each wired into our tracking system so their decisions stay
traceable. Defined as project-level agents in `.claude/agents/`.

## Options considered

| Option | Pros | Cons |
|--------|------|------|
| **A. 6 specialized agents mapped to disciplines + product surfaces** | Clear ownership; focused prompts trace to requirements; engineering's 3 real surfaces (integration / analysis / dashboard) get dedicated context | More files to maintain |
| B. 4 agents (one per discipline) | Maps 1:1 to Team-of-One | "Engineering" is too broad — integration, the analysis brain, and the Vue app need different tools/context/model |
| C. 1 general agent, prompted per task | Simplest | Loses specialization; reviewer can't be adversarial vs builder; defeats the point |
| D. Many fine-grained agents (10+) | Maximal specialization | Overhead/overlap not worth it in a 5-day solo build (C1) |

## Decision

Adopt **Option A** — six project-level agents:

| Agent | Discipline | Model | Primary requirements |
|-------|-----------|-------|----------------------|
| `product-strategist` | Product | opus | R*, scope, A-register, E1/E2 |
| `ux-designer` | Design | opus | R2.4, R2.6, E1 |
| `ghl-integration-engineer` | Engineering — integration | sonnet | R1.1, R1.2, R2.1, D1.1 |
| `observability-engineer` | Engineering — analysis brain | opus | R2.2, R2.3, R2.5, R2.6, E3 |
| `dashboard-engineer` | Engineering — frontend | sonnet | R2.4, R2.5, R2.6, E1 |
| `qa-reviewer` | QA | opus | E4, E2, D3.1 |

## Rationale

- Maps to the four disciplines D3 demands, but splits Engineering into the product's three
  genuinely distinct surfaces — each needs different tools (Bash/WebFetch), context, and
  model tier. This is why B is insufficient and A wins.
- **Model routing:** judgment/clarity-heavy roles (product, design, the analysis brain, the
  adversarial reviewer) run on **opus**; mechanical build roles run on **sonnet** — controls
  cost/latency while protecting the graded surfaces (E3, E4). Mirrors the LLM routing in ADR-0002.
- **Tool scoping:** the reviewer is deliberately read/run-only (no Write) so QA stays
  adversarial and doesn't silently rewrite what it reviews.
- Every agent prompt mandates the tracking loop (trace to IDs → ADR/assumption → session log),
  so adding agents *strengthens* "nothing untracked" rather than diluting it.

## Consequences

- Engineering agents must build to the schemas `observability-engineer` defines; `ux-designer`
  feeds `dashboard-engineer`; `qa-reviewer` runs after each engineering agent.
- Roster is cheap to revise — add/remove a file in `.claude/agents/` and supersede this ADR.
- The main orchestrator (the builder) routes work to these agents and keeps the trail current.
