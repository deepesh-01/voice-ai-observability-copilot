# UI/UX Changes & Fixes — Living List

> Owned by the Design discipline ([`team-of-one.md`](./team-of-one.md)). Every dashboard/UX
> change or fix is logged here with the requirement it serves (E1 = Product Thinking + UI/UX)
> and its status. This is the design counterpart to the ADR/decision log.

**Status:** ✅ Done · 🔄 In progress · 📋 Planned · 💡 Idea

| # | Change | Why / trigger | Traces to | Status | Session |
|---|--------|---------------|-----------|--------|---------|
| UX-001 | **Live "Check HighLevel status" button per connected account + header "↻ Refresh"** | Dashboard previously showed "connected" from the *local token on file*, which drifts from HighLevel's real state (e.g. after an uninstall). Now a button probes the GHL API and reports one of: connected+scoped (green), connected-but-missing-Voice-AI-scope (amber), or rejected/uninstalled (red). | E1, R1.2 | ✅ | S-007 |
| UX-006 | **Persistent "Connect / re-authorize account" action + inline "Re-authorize →" on degraded status** | The Connect button only rendered when *zero* installs existed, so once a stale/amber/red token was on file there was no UI path to reinstall. Now a connect/re-authorize action is always available, and degraded statuses link straight to `/oauth/install`. | E1, R1.2 | ✅ | S-007 |

## Planned / ideas (not yet built)

| # | Change | Why | Traces to | Status |
|---|--------|-----|-----------|--------|
| UX-002 | Cross-agent overview → agent → call → flagged-segment drill-down | The core dashboard (after KPI schema lands) | R2.4, R2.6, E1 | 📋 |
| UX-003 | Recommendation + "Use Action" surfaced *next to* the failing KPI and transcript moment | "Issue + fix + evidence together" principle | R2.5, R2.6, E1 | 📋 |
| UX-004 | Empty / loading / error / "no issues found" states for every view | Intuitiveness (sells E1) | E1 | 📋 |
| UX-005 | Match HighLevel visual language inside the iframe (spacing, palette) | Native feel | E1 | 📋 |

## How to add an entry

Append a `UX-NNN` row to the appropriate table with the change, the trigger/why, the
requirement ID(s) it serves, and status. When built, move it to the top table, set ✅, and
note the session. Frontend-architecture choices (charting lib, state mgmt) still get an ADR.
