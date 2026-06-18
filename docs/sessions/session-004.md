# Session S-004 — 2026-06-18 — Git init + app scaffold + hosting

## Goal

Initialize the repo (protecting secrets), scaffold a runnable Node+Vue app with working
HighLevel OAuth and an embeddable dashboard shell, and define the permanent-URL hosting.

## Done

- **Git:** `git init` (branch `main`), `.gitignore` excluding `.env`, `tokens.json`, `data/`,
  build output, and the source PDFs. Verified `.env` is ignored *before* committing.
  `.env.example` added. Foundation commit landed (docs + agents), then the scaffold commit.
- **Backend (`server/`, Express + TS via `tsx`):**
  - `config.ts` — env loading/validation + verified GHL endpoints (authorize, token,
    apiBase, `Version: 2021-07-28`).
  - `ghl/oauth.ts` — authorize URL, code→token exchange, refresh, valid-token accessor.
  - `ghl/api.ts` — Voice AI client: `GET /voice-ai/dashboard/call-logs` + single call log.
  - `store/tokenStore.ts` — interim file-based token persistence.
  - routes `/oauth/{install,callback}`, `/api/{installs,calls,calls/:id}`, `/health`.
  - iframe-friendly headers (no `X-Frame-Options`; `frame-ancestors` CSP for HighLevel).
- **Frontend (`web/`, Vue 3 + Vite + TS):** dashboard shell that checks backend health and
  lists connected installs / prompts to connect.
- **Docs:** root `README.md`, `docs/setup-highlevel.md` (D1.1 install guide incl. cloudflared).
- **Verified:** server typechecks + boots; `/health` and `/api/installs` respond; CSP header
  present; `web` builds; Express serves the built dashboard on one origin.

## Live verification (cloudflared)

- Chosen subdomain: **`ghl.deepesh-engg.in`** → `localhost:8095` (added to `main` tunnel).
- DNS CNAME created; `main` tunnel restarted via `launchctl kickstart -k`.
- Confirmed working: `https://ghl.deepesh-engg.in/health` → 200; `/oauth/install` → 302 to
  `marketplace.gohighlevel.com/oauth/chooselocation` with correct `redirect_uri` + `client_id`;
  existing hostname `takejob.deepesh-engg.in` → 200 (no collateral breakage).
- `.env` set: `PUBLIC_BASE_URL=https://ghl.deepesh-engg.in`, `PORT=8095`.

## Decisions

- **ADR-0004** — Reuse the existing `main` cloudflared tunnel (add `ghl.deepesh-engg.in`
  → `:8095`); single-origin app (Express serves SPA + API + OAuth); file-based token store
  (interim). (Traces to R1.1, R1.2, R2.1, D1, D1.1, E4.)

## Assumptions touched

- **A-007 (new):** exact OAuth scope strings (esp. the Voice AI call-log scope) must be
  confirmed against the portal dropdown; `SCOPES` is env-driven with a safe default. 🟡
- A-001/A-003 remain research-validated; hands-on confirmation pending sandbox authorize.

## Open questions / next action

- **Needs builder/coordination:** add the ingress rule + DNS route, then **restart the `main`
  tunnel** (blips other hostnames) — not done silently. Then register
  `https://copilot.deepesh-engg.in/oauth/callback` as the app redirect + Custom Page URL.
- **Then:** run `/oauth/install`, authorize the sandbox, and inspect a real
  `Get Call Log` payload to lock A-003 → write the ingestion/normalization ADR.
- After setup verified end-to-end: proceed to the KPI schema (A-004).
