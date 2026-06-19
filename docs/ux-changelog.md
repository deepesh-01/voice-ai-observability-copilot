# UI/UX Changes & Fixes — Living List

> Owned by the Design discipline ([`team-of-one.md`](./team-of-one.md)). Every dashboard/UX
> change or fix is logged here with the requirement it serves (E1 = Product Thinking + UI/UX)
> and its status. This is the design counterpart to the ADR/decision log.
>
> **Craft bar:** our UI/UX benchmark is Emil Kowalski's design-engineering skills
> (`emil-design-eng`, `review-animations`) — see [ADR-0005](./decisions/0005-uiux-craft-benchmark.md).
> Changes should meet that bar.

**Status:** ✅ Done · 🔄 In progress · 📋 Planned · 💡 Idea

| # | Change | Why / trigger | Traces to | Status | Session |
|---|--------|---------------|-----------|--------|---------|
| UX-009 | **Recommendations cached + "↻ Refresh" affordance** | The Opus synthesis re-ran on every agent-view open (~10–30s + cost). Now cached in Postgres keyed by agent + scored-call count (auto-refreshes when new calls arrive); a Refresh button forces re-synthesis. Verified 67s → 0.005s on the cached path. | R2.5, E1, E3 | ✅ | S-013 |
| UX-008 | **Agent names instead of raw IDs** | Opaque `6a35206c…` ids were shown everywhere. Now the real agent name (`agentName` from GHL, via `GET /api/agents`) is primary across overview cards, agent header, call detail, and breadcrumbs; the id is demoted to muted secondary/tooltip for traceability. | E1 | ✅ | S-013 |
| UX-007 | **Emil craft pass** — press feedback (`scale(0.97)`) on every pressable; KPI bars animate via GPU `transform: scaleX()` (not `width`) with grow-on-mount + staggered reveal; agent/recommendation cards enter staggered; shared strong easing tokens (`--ease-out`); hover lifts gated behind `@media (hover: hover)`; full `prefers-reduced-motion` support (incl. scroll). | E1, ADR-0005 | ✅ | S-013 |
| UX-002 | **Cross-agent overview → agent → call → flagged-segment drill-down** | The core dashboard. View-state machine + breadcrumbs; agent cards + KPI strips → agent KPI profile + recommendations + call list → call detail. | R2.4, R2.6, E1 | ✅ | S-013 |
| UX-003 | **Recommendation + "Use Action" surfaced next to the failing KPI and transcript moment** | "Issue + fix + evidence together". KPI evidence chips scroll-highlight the transcript turn; deviations link to their turn; UseAction amber spans sit over the turns they cover. | R2.5, R2.6, E1 | ✅ | S-013 |
| UX-004 | **Empty / loading / error / "no issues found" states for every view** | Intuitiveness (sells E1). Every view has all four; recommendations get a dedicated Opus "synthesizing…" state. | E1 | ✅ | S-013 |
| UX-005 | **Match HighLevel visual language inside the iframe** | Native feel — shared palette/tokens, card system, monospace IDs, CSS bars (no charting lib, ADR-0009). | E1 | ✅ | S-013 |
| UX-001 | **Live "Check HighLevel status" button per connected account + header "↻ Refresh"** | Dashboard previously showed "connected" from the *local token on file*, which drifts from HighLevel's real state (e.g. after an uninstall). Now a button probes the GHL API and reports one of: connected+scoped (green), connected-but-missing-Voice-AI-scope (amber), or rejected/uninstalled (red). | E1, R1.2 | ✅ | S-007 |
| UX-006 | **Persistent "Connect / re-authorize account" action + inline "Re-authorize →" on degraded status** | The Connect button only rendered when *zero* installs existed, so once a stale/amber/red token was on file there was no UI path to reinstall. Now a connect/re-authorize action is always available, and degraded statuses link straight to `/oauth/install`. | E1, R1.2 | ✅ | S-007 |

## Planned / ideas (not yet built)

| # | Change | Why | Traces to | Status |
|---|--------|-----|-----------|--------|
| — | _(none open — dashboard UX shipped in S-013; next polish ideas go here)_ | | | |

## How to add an entry

Append a `UX-NNN` row to the appropriate table with the change, the trigger/why, the
requirement ID(s) it serves, and status. When built, move it to the top table, set ✅, and
note the session. Frontend-architecture choices (charting lib, state mgmt) still get an ADR.
