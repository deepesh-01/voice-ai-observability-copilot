---
name: quality-gates
description: Run this repo's quality gates before any code change is considered "done" — typecheck → lint → test → review, in sequence. Use after editing server/ or web/, before committing, or when asked to verify non-slop quality (E4).
---

# Quality Gates

Our QA discipline (E4 — "only non-slop code") in executable form. A change is **not done**
until every applicable gate passes. Run them in order; stop and fix on the first failure.
Tailored to this repo (`server/` = Express+TS, `web/` = Vue 3+Vite+TS) — authored in-house
rather than vendoring a large external toolkit (see ADR-0006).

## The gate sequence

1. **Typecheck** (must pass)
   - Backend: `cd server && npm run typecheck`
   - Frontend: `cd web && npm run build` (runs `vue-tsc -b` first)
2. **Lint** (when configured)
   - ESLint is **not yet set up** (state as of S-010). When added, run `npm run lint` in the
     changed package. Until then, manually scan for: unused vars, `any`, unhandled promise
     rejections, secrets in source, dead code.
3. **Test** (when present)
   - Run the package's test script. The LLM-output parsing, KPI scoring, and schema
     validation **must** have tests once built (pair with the `tdd` skill).
4. **Review** (always)
   - Run the built-in `/code-review` on the diff, or hand the diff to the `qa-reviewer`
     agent. Treat findings as blocking unless explicitly waived.

## Honesty gate (project-specific)

- Any mocked / stubbed / hardcoded path MUST be declared in `docs/functional-vs-mocked.md`.
  Silent mocking is a defect — fail the change.
- LLM output reaching the UI must be schema-validated. Un-shaped data is a blocker.

## Definition of done

Typecheck ✅ · Lint ✅ (or N/A + noted) · Tests ✅ (or N/A + noted) · Review ✅ ·
functional-vs-mocked honest ✅ · traces to a requirement ID ✅.
