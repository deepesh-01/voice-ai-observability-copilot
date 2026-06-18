# Session S-007 — 2026-06-19 — Live connection-status UI + UX changelog

## Goal

Make the dashboard show the **live** HighLevel connection state (not just "a token exists
locally"), after observing that an uninstall left the dashboard still showing "connected".

## Done

- **Backend:** `checkConnection(installKey)` in `ghl/api.ts` probes `GET /voice-ai/agents`
  with the stored token and classifies the result:
  - 200 → `connected:true, voiceAiScopeOk:true`
  - 401 "…scope…" → `connected:true, voiceAiScopeOk:false` (token live, scope missing)
  - 401/403 otherwise → `connected:false` (rejected/uninstalled)
  - refresh failure → `connected:false`
  Exposed at `GET /api/installs/:key/status`.
- **Frontend (`App.vue`):** header **↻ Refresh** button + per-account **"Check HighLevel
  status"** button with a color-coded badge/detail (green/amber/red).
- **Verified live:** probe of the current install returns
  `{connected:true, voiceAiScopeOk:false, detail:"Token valid, but missing Voice AI scope…"}`
  — confirming the access token is still valid post-uninstall; the gap is the Voice AI scope.
- Created **`docs/ux-changelog.md`** (Design-owned list of UI/UX changes); logged this as
  **UX-001** and seeded planned items UX-002…005. Linked from `docs/README.md`.

## Decisions / notes

- No ADR (small feature). Observation: HighLevel did **not** immediately revoke the access
  token on app uninstall — only the scope is missing. Refresh-token revocation would surface
  on the next refresh.
- Follow-up (not now): handle the GHL **uninstall webhook** to auto-purge stale tokens.

## Follow-up fix (same session)

- **UX-006:** the Connect button only showed when zero installs existed → no reinstall path
  once a stale/amber/red token was on file (spotted by builder from the live dashboard). Added
  a persistent "+ Connect / re-authorize account" action plus an inline "Re-authorize →" link
  on any degraded status. Rebuilt + redeployed.

## Next action

- Builder: publish the new app version with `voice-ai-dashboard.readonly` (+agents/goals),
  reinstall → status flips to green → pull a real `Get Call Log` (A-003) → KPI schema (A-004).
