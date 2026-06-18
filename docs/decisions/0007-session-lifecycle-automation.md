# ADR-0007: Session lifecycle automation (start ritual, /end-session, state, exit safety net)

- **Status:** Accepted
- **Date:** 2026-06-19
- **Session:** S-011
- **Traces to:** C2 (single builder owns the SDLC — disciplined session hygiene), D3, E4 (process rigor); supports the "nothing untracked" principle
- **Rests on assumptions:** none

## Context

We adopted a session-close practice (always save progress + next step before ending). The
builder asked to make it enforced and stateful: an end-session skill, a Ctrl+C safety dialog,
a start-of-session question ("is this a development session?"), and a registry of active
sessions.

Hard harness constraints (verified via the keybindings + update-config skills):
- **Ctrl+C cannot be rebound** — it's a hardcoded interrupt/exit. A custom two-option dialog
  on Ctrl+C is not possible.
- **Hooks** can't run interactive prompts, but a `SessionStart` hook can **inject context/
  instructions** to the model, and `SessionEnd` runs a command on exit.

## Decision

Build a session-lifecycle system from the achievable primitives:

| Piece | Mechanism |
|-------|-----------|
| **Start ritual** | `SessionStart` hook → `session-state.mjs start`: registers the session in `.claude/state/sessions.json` and injects an instruction telling the model to ask "Is this a development session?" (via AskUserQuestion). Answer recorded with `session-state.mjs set-dev <yes\|no>`. |
| **Active-session registry** | `.claude/state/sessions.json` (gitignored): `{current, sessions:{id:{cwd,source,startedAt,status,isDevSession,endedAt,closedVia}}}`. `session-state.mjs list` inspects it. |
| **Clean close** | **`/end-session`** skill: writes the session log (+ Next action), updates the trail, runs `session-state.mjs end`, commits. |
| **Exit safety net** | `SessionEnd` hook → `session-state.mjs end-hook`: if the session is still `active` (i.e. `/end-session` wasn't run — e.g. forced Ctrl+C), mark it ended and emit a `systemMessage` warning that progress may be unsaved. |

Config in project `.claude/settings.json` (committed, travels with the repo). Logic in
`.claude/hooks/session-state.mjs` (Node, tested in isolation).

## Rationale

- **Ctrl+C dialog isn't possible**, so we approximate the *intent* ("don't lose progress on
  exit"): the SessionEnd hook turns a silent forced-exit into a visible warning + recorded
  unclean close, and the built-in double-Ctrl+C already guards accidental single presses.
- A `SessionStart` hook is the only way to *automatically* trigger the dev-session question
  every session in this pwd, as requested.
- State is machine-specific runtime → gitignored, not committed.

## Consequences

- New hooks fire only after the config is loaded — **next session start** (or after `/hooks`).
  Existing running sessions won't ask retroactively.
- The dev-session question will appear at the start of every session in this project.
- `session-state.mjs` uses `node` from PATH (provided by the profile-initialized hook shell).
- Skill roster gains `/end-session`. Roster: emil-design-eng, review-animations,
  web-interface-guidelines, tdd, domain-modeling, quality-gates, end-session.
