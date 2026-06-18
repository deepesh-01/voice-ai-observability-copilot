---
name: end-session
description: Close out the current working session — save progress and the next step before ending. Run when the user says the session is ending, says "that's it" / "we're done for now", or before starting a new session. Writes the session log, updates the tracking trail, marks session state ended, and commits.
---

# End Session

Executes this project's session-close practice (docs/sessions/README.md → "Session-close
practice"). A session must never end with its progress only in chat.

## Steps

1. **Pick the next session number** — look at `docs/sessions/` for the highest `session-NNN.md`
   and use NNN+1.
2. **Write `docs/sessions/session-NNN.md`** using the template in `docs/sessions/README.md`:
   - **Goal** — what this session set out to do.
   - **Done** — concrete outputs (files, code, ADRs, decisions).
   - **Decisions** — ADR ids + one line each (with requirement traces).
   - **Assumptions touched** — A-NNN created / validated / invalidated.
   - **Next action** — the single next step, written so the next session can start cold.
     *(mandatory — this is the handoff.)*
3. **Update the trail** as applicable:
   - `docs/sessions/README.md` index (add the row).
   - `docs/decisions/README.md` (if any ADRs were added).
   - `docs/assumptions-and-product-calls.md`, `docs/functional-vs-mocked.md`,
     `docs/ux-changelog.md`.
   - `docs/README.md` status table + "Last updated".
4. **Mark session state ended:** run `node .claude/hooks/session-state.mjs end`.
5. **Commit** everything (a real checkpoint, clean working tree). Use the repo's commit
   trailer convention.
6. **Confirm to the user:** show the session number, a one-line summary, and the **Next
   action** so the handoff is explicit.

## Notes

- If a dev-session flag was set at start (`session-state.mjs set-dev`), it stays in the
  registry; `end` just flips status to `ended`.
- This skill is the clean counterpart to the `SessionEnd` hook, which only fires (with a
  warning) when a session ends *without* this skill being run.
