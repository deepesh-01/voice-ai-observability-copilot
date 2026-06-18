# ADR-0005: UI/UX craft benchmark — Emil Kowalski's design-engineering skills

- **Status:** Accepted
- **Date:** 2026-06-19
- **Session:** S-008
- **Traces to:** E1 (Product Thinking + UI/UX), R2.4 / R2.6 (dashboard, "Use Actions"), D3 (Design ownership)
- **Rests on assumptions:** none

## Context

E1 ("customer-centric, intuitive, seamlessly integrated") is a primary grading axis, and as a
Team of One the Design discipline needs an explicit, external quality bar rather than ad-hoc
taste. The builder selected **Emil Kowalski's design-engineering skills**
(github.com/emilkowalski/skills — Sonner/Vaul author; animations.dev) as that benchmark.

## Decision

Vendor both skills into the repo at **project** level (`.claude/skills/`) and make them the
binding UI/UX standard:

| Skill | Role |
|-------|------|
| `emil-design-eng` | Philosophy + concrete rules for UI polish, component design, spacing/typography, interaction & animation decisions, and "invisible details". The definition of "good" for E1. |
| `review-animations` (+ `STANDARDS.md`) | Adversarial review of motion/transition code against a high craft bar. `disable-model-invocation: true` → invoked explicitly before motion work is "done". |

Wired into the `ux-designer` and `dashboard-engineer` agents as the bar they design/build to.

## Rationale

- Gives Design an objective, reputable standard → defensible E1 quality instead of "looked
  fine to me".
- Project-level (not user-level) so the standard is versioned with the code and travels with
  the repo for reviewers.
- Two complementary skills: one generative (how to build it well), one evaluative (prove the
  motion clears the bar) — mirrors our build-then-adversarially-verify pattern.

## Consequences

- UI work isn't "done" until it would pass `emil-design-eng`; motion work runs through
  `review-animations` first.
- Vendored copy (upstream has no LICENSE file as of 2026-06-19; source: emilkowal.ski/skill).
  Attribution kept here and in the skill frontmatter; re-pull upstream to update.
- Adds craft cost to each UI change — accepted, because E1 is graded.
