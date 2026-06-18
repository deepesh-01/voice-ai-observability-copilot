# Session S-008 — 2026-06-19 — Adopt UI/UX craft benchmark (Emil Kowalski skills)

## Goal

Set an explicit, external UI/UX quality bar for the dashboard (E1), per the builder's call to
use Emil Kowalski's design-engineering skills as the benchmark.

## Done

- Cloned `github.com/emilkowalski/skills` and vendored both skills into `.claude/skills/`:
  - `emil-design-eng/SKILL.md` (UI polish, component design, animation/interaction philosophy)
  - `review-animations/SKILL.md` + `STANDARDS.md` (adversarial motion review;
    `disable-model-invocation: true` → invoked explicitly)
- Wired the benchmark into the `ux-designer` and `dashboard-engineer` agents (a "Craft bar"
  section in each): design/build to `emil-design-eng`, run `review-animations` on motion.
- Recorded **ADR-0005**; updated decisions index, docs README, ux-changelog note.

## Decisions

- **ADR-0005** — Emil Kowalski's skills are our binding UI/UX benchmark (E1). Project-level so
  it's versioned with the repo. (Traces to E1, R2.4, R2.6, D3.)

## Notes

- Upstream repo has no LICENSE file (as of 2026-06-19); source emilkowal.ski/skill.
  Attribution kept in ADR-0005 + skill frontmatter; re-pull to update.

## Next action

- Apply the bar when building the real dashboard (UX-002…005). Meanwhile, unblock data:
  publish app version with `voice-ai-dashboard.readonly`, reinstall, pull a real transcript
  (A-003) → KPI schema (A-004).
