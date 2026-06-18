# ADR-0004: Hosting via cloudflared, single-origin app, and repo scaffold

- **Status:** Accepted
- **Date:** 2026-06-18
- **Session:** S-004
- **Traces to:** R1.1 (sandbox), R1.2 (embed in customer account), R2.1 (transcript ingestion), D1 (Node+Vue repo), D1.1 (install steps), E4 (non-slop)
- **Rests on assumptions:** A-001, A-003, A-007

## Context

The marketplace app needs a **permanent HTTPS URL** for two things: the OAuth redirect URI
(must be stable + registered) and the Custom Page iframe source (R1.2). Ephemeral tunnels
(e.g. quick-tunnel random URLs) would break on every restart, forcing constant portal edits.
The builder already runs a Cloudflare **named tunnel** (`main`) on `deepesh-engg.in` serving
several apps.

## Options considered

| Concern | Option | Decision | Why |
|---------|--------|----------|-----|
| Public URL | Ephemeral `cloudflared` quick tunnel | ❌ | Random URL each run → redirect URI breaks |
| | New dedicated named tunnel | ❌ | Extra tunnel/cert to manage; unnecessary |
| | **Add a hostname to the existing `main` tunnel** | ✅ | Permanent URL, zero new infra; reuses authenticated cert |
| Origin model | Separate hosts for API and SPA | ❌ | Two iframe/CORS surfaces; more config |
| | **Single origin: Express serves `web/dist` + API + OAuth** | ✅ | One URL for iframe + OAuth + API; simplest embed |
| Backend | Express + TypeScript via `tsx` | ✅ | Matches ADR-0002; TS for E4; `tsx` = no build step in dev |
| Frontend | Vue 3 + Vite + TS, `vue-tsc` typecheck | ✅ | Matches ADR-0002 |
| Token storage | JSON file (`tokens.json`, gitignored) | ✅ (interim) | Enough for setup; → MongoDB before multi-tenant (ADR-0002) |

## Decision

- Serve the app at **`https://copilot.deepesh-engg.in`** by adding one ingress rule
  (`→ http://localhost:8095`) to the existing `main` cloudflared tunnel + a DNS route.
- **Single-origin** app: Express (`:8095`) serves the built Vue dashboard, the `/api/*`
  routes, and the `/oauth/*` flow. Iframe-friendly headers (no `X-Frame-Options`; scoped
  `frame-ancestors` CSP for HighLevel hosts).
- Repo: `server/` (Express+TS) and `web/` (Vue3+Vite+TS); secrets in `.env` (gitignored),
  template in `.env.example`.

## Rationale

A stable URL is a hard requirement for OAuth + the iframe; reusing the `main` tunnel gives
that for free. Single-origin removes CORS/iframe complexity and means one redirect URI and
one Custom Page URL — fewer places to misconfigure (E4). Verified working: server boots,
`/health` + `/api/installs` respond, CSP is set, Vue app builds and is served by Express.

## Consequences

- Adding our hostname requires **restarting the `main` tunnel**, which briefly interrupts the
  builder's other hostnames on that tunnel → must be coordinated, not done silently.
- `copilot.deepesh-engg.in` is the canonical URL for: OAuth redirect (portal step A.5),
  Custom Page (A.7), and `PUBLIC_BASE_URL`.
- File-based token store is interim; `data/` and `tokens.json` are gitignored. Migrating to
  MongoDB is a follow-up.
- Exact OAuth scope strings (esp. Voice AI) still need portal confirmation → A-007.
