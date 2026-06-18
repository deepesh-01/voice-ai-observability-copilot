# ADR-0006: Additional skills — UI guidelines, TDD, domain modeling, quality gates

- **Status:** Accepted
- **Date:** 2026-06-19
- **Session:** S-010
- **Traces to:** E1 (UI/UX), E3 (architecture/clarity), E4 (non-slop), R2.2 (KPI/observability modeling)
- **Rests on assumptions:** none

## Context

Reviewed "the 10 Claude Code skills" (welcomedeveloper.com) against our actual stack
(Node/Express + **Vue 3**/TS, LLM analysis, GHL marketplace app) and the `emil-design-eng`
benchmark (ADR-0005). Most of the 10 don't fit; a few do. Builder selected
web-interface-guidelines, spartan-ai-toolkit, and mattpocock TS skills.

## Decision

Vendor (project-level `.claude/skills/`):

| Skill | Source | Why |
|-------|--------|-----|
| `web-interface-guidelines` | vercel-labs/web-interface-guidelines (MIT) | Framework-agnostic UI checklist (a11y, focus, hit targets, loading/optimistic states). Serves E1; complements emil (craft/feel) with a systematic checklist. Wrapped its `command.md` rules into a SKILL.md; long-form kept as `GUIDELINES.md`. |
| `tdd` | mattpocock/skills (MIT) | Test-first for the scoring engine / parsers (E4). |
| `domain-modeling` | mattpocock/skills (MIT) | Pin down KPI / "Use Action" / deviation vocabulary as a domain model (R2.2, E3). |
| `quality-gates` | **authored in-house** | typecheck→lint→test→review sequence + honesty gate, tailored to this repo (E4). |

**Rejected from the article:** `vercel-react-best-practices` (React, we use Vue),
`planetscale` (we use MongoDB), `TerraShark` (no IaC), `frontend-design` (competes with the
emil benchmark), `code-simplifier`/`doc-coauthoring` (built-ins + our docs system cover these),
`superpowers` (overlaps our ADR/session process; also `/plugin`-only).

**spartan-ai-toolkit — NOT vendored.** Inspection showed a 489-file **Codex** toolkit
(Kotlin/Micronaut, Terraform, fundraising/investor, startup pipeline), not the tidy
"quality-gates" skill the article implied. Importing it would violate the restraint bar
(ADR-0005) and add overwhelming off-stack noise. Instead we **authored `quality-gates`** to
deliver the actual E4 value the builder wanted, scoped to our stack. (Spartan's
`testing-strategies` / `js-security-audit` can be cherry-picked later if desired.)

## Rationale

Add only high-fit, low-overlap skills; prefer a small in-house skill over a large external
toolkit when the relevant slice is tiny. Restraint is itself the design value (ADR-0005).

## Consequences

- Skill roster: `emil-design-eng`, `review-animations`, `web-interface-guidelines`, `tdd`,
  `domain-modeling`, `quality-gates`.
- Vendored copies carry upstream MIT LICENSE / attribution; re-pull to update.
- `quality-gates` references ESLint as "not yet configured" — wiring it is a follow-up.
