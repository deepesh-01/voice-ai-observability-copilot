# Session Logs

Chronological narrative of the build. One file per working session: `session-NNN.md`.
Each session records what was done, what was decided (linking ADRs), open questions, and
the next action. This is the audit trail that makes a solo "Team of One" build legible.

## Index

| ID | Date | Focus | Decisions | File |
|----|------|-------|-----------|------|
| S-001 | 2026-06-18 | Project kickoff: read brief, stand up docs + decision-tracking system, fix initial tech stack | ADR-0001, ADR-0002 | [session-001.md](./session-001.md) |
| S-002 | 2026-06-18 | Stand up specialized Claude agent roster (6 agents) | ADR-0003 | [session-002.md](./session-002.md) |
| S-003 | 2026-06-18 | Research sandbox + marketplace app + Voice AI transcript API path | — (updated A-001/A-003) | [session-003.md](./session-003.md) |
| S-004 | 2026-06-18 | Git init + Node/Vue app scaffold (OAuth + dashboard shell) + hosting | ADR-0004 (A-007) | [session-004.md](./session-004.md) |
| S-005 | 2026-06-18 | Rename public host ghl→voai (HighLevel rejects brand in redirect URI) | — (A-008, amends ADR-0004) | [session-005.md](./session-005.md) |
| S-006 | 2026-06-18 | First authorize attempt — diagnosed noAppVersionIdFound (portal Auth config) | — (A-009) | [session-006.md](./session-006.md) |
| S-007 | 2026-06-19 | Live connection-status UI (probe + refresh) + UX changelog (UX-001) | — | [session-007.md](./session-007.md) |
| S-008 | 2026-06-19 | Adopt Emil Kowalski skills as UI/UX craft benchmark | ADR-0005 | [session-008.md](./session-008.md) |
| S-009 | 2026-06-19 | Ingestion pipeline live (200, empty) — connection + Voice AI scope verified | — (A-007/A-011 ✅) | [session-009.md](./session-009.md) |

## Template for a new session

```markdown
# Session S-NNN — <date> — <focus>

## Goal
What this session set out to do.

## Done
- Bullet list of concrete outputs (files, code, ADRs, decisions).

## Decisions
- ADR-XXXX: <one line> (traces to R*/D*/E*)

## Assumptions touched
- A-NNN: created / validated / invalidated

## Open questions / next action
- What's blocked or undecided, and the single next step.
```
