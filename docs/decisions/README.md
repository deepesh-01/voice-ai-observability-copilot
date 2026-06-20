# Architecture Decision Records (ADRs)

This is the authoritative index of every significant decision made on this project.
Each ADR is immutable once **Accepted** — to change a decision, write a new ADR that
**supersedes** the old one (and update the "Status" / "Superseded by" fields).

Format: lightweight [MADR](https://adr.github.io/madr/). Use [`ADR-template.md`](./ADR-template.md).

## Index

| ID | Title | Status | Traces to | Date |
|----|-------|--------|-----------|------|
| [ADR-0001](./0001-documentation-tracking-system.md) | Documentation & decision-tracking system | Accepted | D3, C2, E3 | 2026-06-18 |
| [ADR-0002](./0002-tech-stack.md) | Core tech stack (backend, frontend, LLM, storage) | Accepted (storage superseded by ADR-0008) | D1, R1.2, C3 | 2026-06-18 |
| [ADR-0003](./0003-specialized-agent-roster.md) | Specialized Claude agent roster | Accepted | C2, D3, E3, E4 | 2026-06-18 |
| [ADR-0004](./0004-hosting-tunnel-and-app-scaffold.md) | Hosting (cloudflared), single-origin app, repo scaffold | Accepted | R1.1, R1.2, R2.1, D1, D1.1 | 2026-06-18 |
| [ADR-0005](./0005-uiux-craft-benchmark.md) | UI/UX craft benchmark (Emil Kowalski skills) | Accepted | E1, R2.4, R2.6, D3 | 2026-06-19 |
| [ADR-0006](./0006-additional-skills.md) | Additional skills (UI guidelines, TDD, domain modeling, quality gates) | Accepted | E1, E3, E4, R2.2 | 2026-06-19 |
| [ADR-0007](./0007-session-lifecycle-automation.md) | Session lifecycle automation (start ritual, /end-session, state, exit safety net) | Accepted | C2, D3, E4 | 2026-06-19 |
| [ADR-0008](./0008-persistence-postgres-and-ingestion.md) | Persistence on Postgres + JSONB; poll + webhook ingestion | Accepted (supersedes ADR-0002 storage) | R2.1, R2.3, R2.4, E2 | 2026-06-19 |
| [ADR-0009](./0009-dashboard-css-bars-no-charting-lib.md) | Dashboard KPI viz via CSS bars, no charting library | Accepted (closes ADR-0002 charting sub-decision) | R2.4, E1, E4 | 2026-06-19 |
| [ADR-0010](./0010-lead-and-booking-data-model.md) | Lead & booking data model + LLM extraction + booking-approval policy | Accepted (approval workflow superseded by ADR-0012) | R2.6, R2.2, R2.3, E2 | 2026-06-20 |
| [ADR-0011](./0011-normalize-raw-call-source-of-record.md) | Normalize raw_call into its own source-of-record table | Accepted (refines ADR-0008 schema) | R2.1, E2, E3 | 2026-06-20 |
| [ADR-0012](./0012-lead-signals-not-approval-workflow.md) | Lead data as observability signals, not a booking-approval workflow | Accepted (supersedes ADR-0010 approval workflow) | R2.3, R2.6, E2 | 2026-06-20 |
| [ADR-0013](./0013-hybrid-lead-facts-native-over-llm.md) | Hybrid lead facts — native extractedData over LLM inference | Accepted | R2.1, R2.2, E2, E3 | 2026-06-20 |

## Statuses

- **Proposed** — written, not yet committed to.
- **Accepted** — committed; code should follow it.
- **Superseded** — replaced by a later ADR (linked).
- **Deprecated** — no longer relevant, not replaced.

## When to write an ADR

Write one whenever a choice is hard to reverse, affects architecture, picks between real
alternatives, or rests on an assumption. Cheap, obvious, easily-reversible choices don't
need one — but if you compared options, capture the comparison.
