# ADR-0001: Documentation & decision-tracking system

- **Status:** Accepted
- **Date:** 2026-06-18
- **Session:** S-001
- **Traces to:** D3 (architecture README + Team-of-One ownership), C2 (single builder owns SDLC), E3 (technical integrity), E4 (non-slop, reviewed)
- **Rests on assumptions:** none

## Context

The brief asks for a "Team of One" who owns Product, Design, Engineering & QA end-to-end,
and is graded partly on **Technical Integrity** (clarity of architecture and reasoning).
With one person and a 5-day window, the failure mode is undocumented, irreproducible
decision-making — exactly what loses points on E3/E4 and what makes the build hard to
explain in the demo and README.

The user's directive: *"Every session, every decision, every comparison, every tech
decision … all our decisions need to be data-backed based on requirement. … nothing
should be untracked."*

## Options considered

| Option | Pros | Cons | Evidence |
|--------|------|------|----------|
| **A. Markdown ADRs + session logs + requirement traceability in `docs/`** | Versioned with code; zero infra; reviewable in PRs; renders on GitHub; standard (MADR/ADR) | Requires discipline to keep updated | ADRs are an industry-standard, well-documented practice; lowest setup cost for a solo dev |
| B. External tool (Notion / Linear / Confluence) | Rich UI, easy linking | Not versioned with code; reviewer must leave the repo; another account to manage | Adds friction to D1 (single GitHub deliverable) |
| C. Inline code comments + commit messages only | No extra files | Not navigable; can't capture rejected alternatives or product calls; poor for README/demo narrative | Fails "every comparison tracked" |
| D. Heavyweight RFC process | Very thorough | Overkill for 5 days / one person; slows shipping | Time is the binding constraint (C1) |

## Decision

Adopt **Option A**: a `docs/` folder containing requirement traceability, MADR-style ADRs,
per-session logs, an assumptions/product-call register, a functional-vs-mocked ledger, and
a Team-of-One ownership doc. IDs (`R*`, `D*`, `E*`, `ADR-NNNN`, `A-NNN`, `S-NNN`) link
everything together.

## Rationale

- Versioned alongside code → satisfies the single-repo deliverable (D1) and is reviewable
  inline (E4).
- ADRs explicitly capture *rejected alternatives and evidence*, which is what makes the
  reasoning "data-backed" per the directive and demonstrable for E3.
- The session log + assumptions register make the solo SDLC auditable, directly serving
  the Team-of-One narrative (D3).
- Lowest time cost of the viable options — respects C1 (5 days).

We trade away the nicer UI of Notion/Linear for traceability and reviewability in-repo.

## Consequences

- Every future significant choice must produce an ADR and a session-log line, or it's
  considered incomplete.
- The README/demo can be assembled directly from these docs (no separate write-up scramble).
- Keeping docs in sync with code is now part of "done." A stale `docs/README.md` status
  table is a bug.
