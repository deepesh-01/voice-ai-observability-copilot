# Session S-010 — 2026-06-19 — Evaluate & add Claude Code skills

## Goal

Evaluate "the 10 Claude Code skills" (welcomedeveloper.com) against our stack + the emil
benchmark, and add only the high-fit ones.

## Done

- Cloned and inspected the candidate repos (not blind-installed).
- Added project skills:
  - **`web-interface-guidelines`** (vercel-labs, MIT) — wrapped `command.md` rules into a
    SKILL.md + `GUIDELINES.md` (long-form) + LICENSE.
  - **`tdd`** and **`domain-modeling`** (mattpocock, MIT) — the two engineering skills that
    map to our work (test the scoring engine; model KPIs/"Use Actions").
  - **`quality-gates`** (authored in-house) — typecheck→lint→test→review + honesty gate.
- Rejected the rest of the 10 with reasons (React/Mongo/Terraform mismatch, overlap with
  emil/built-ins/our docs).

## Decisions

- **ADR-0006** — skill roster decision. Notably: **spartan-ai-toolkit NOT vendored** — it's a
  489-file Codex toolkit (Kotlin/Terraform/fundraising), not a quality-gates skill; authored
  our own lean `quality-gates` instead. (Traces to E1, E3, E4, R2.2.)

## Skill roster now

`emil-design-eng`, `review-animations`, `web-interface-guidelines`, `tdd`, `domain-modeling`,
`quality-gates`.

## Next action

- Use `domain-modeling` when defining the KPI/observability schema (A-004); `tdd` +
  `quality-gates` when building the scoring engine; `web-interface-guidelines` + `emil-design-eng`
  when building the dashboard. Follow-up: wire ESLint so the lint gate is real.
