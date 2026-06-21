# Session S-017 — 2026-06-21 — Embed verified, API auth, R2.1a, public repo, prod moved to home MBP

## Goal

Close the remaining integration + hardening + deliverable gaps surfaced by re-checking the
brief against the PRD: actually **embed the dashboard inside HighLevel** (not just "designed"),
**authenticate the read API**, push a **public GitHub repo (D1)**, pin the real-time requirement
that was implicit (**R2.1a**), and **move the prod origin off the traveling laptop** onto the
always-on home MacBook Pro.

## Done

### Embed verified inside HighLevel (R1.2 / E1 — closes A-001)
- Published the marketplace app **v2.0.1 Live**, added a **Custom Page** (`Voice AI Observability`,
  iframe → `https://voai.deepesh-engg.in/`), reinstalled into sandbox sub-account
  `B7TzvBb6H6QvDNdEEhlt` → dashboard **renders embedded in the HighLevel chrome with real data**.
- Also added an agency **Custom Menu Link** (iframe embed) → the dashboard appears as a
  **left-sidebar item** in the sub-account. Both surfaces verified live.
- **A-001 flipped 🟡 → 🟢**; `functional-vs-mocked` gained a "Dashboard embedded inside HighLevel" row.

### Read-API authentication (E3 / E4)
- `middleware/apiAuth.ts`: constant-time **bearer / x-api-key** guard on `/api/*`, enforced only
  when `API_AUTH_TOKEN` is set. `index.ts` injects the token into the served SPA at runtime
  (`window.__API_TOKEN__`, never in git); `web/api.ts` echoes it on every call. `/health`,
  `/oauth/*`, `/webhooks/*` stay open (own auth). Verified live: 401 without / 200 with / 401 wrong.
- Honest threat model documented (blocks public access; not per-user — GHL SSO is the next upgrade).

### PRD: R2.1a (real-time flywheel)
- Added **R2.1a** to `requirements.md` — continuous/automatic ingestion on call completion
  (`VoiceAiCallEnd` webhook), the brief's "real-time observability layer" / "Validation Flywheel"
  that R2.1 (verbatim) didn't pin. Already built; tagged the ingestion-pipeline ledger row `R2.1, R2.1a`.

### Public GitHub repo (D1)
- Created **https://github.com/deepesh-01/voice-ai-observability-copilot** (now **public**),
  `origin` set, `main` tracking + pushed. Secret-scan clean before push (`.env` gitignored).

### Prod origin moved to the always-on home MacBook Pro
- Drove the whole migration over **Tailscale SSH** (`deepesh@deepeshs-macbook-pro`); files moved via
  **Taildrop** (no SSH for transfer). Architecture: app + dedicated cloudflared tunnel both under
  **pm2**, local Postgres on the MBP, only `voai`'s DNS re-pointed (the air's `main` tunnel + other
  sites untouched).
- **DB migrated** (pg_dump 17 → restore into MBP Postgres **16**, stripping the lone pg17-only
  `SET transaction_timeout`); role `deepeshz2` created so `.env` is unchanged. Counts match
  (raw_call=16, analysis=16, lead=16, kpi=96, oauth_tokens=1).
- New tunnel **`voai-mbp`** (`e599777d-…`), `--overwrite-dns` cutover. Proved the cutover by stopping
  the air's app — `voai` kept serving. Full app verified embedded + standalone from the MBP, `/api`
  auth clean. Runbook: `docs/deploy-home-mbp.md` (executed). Secrets cleaned from staging both sides.

## Decisions

- No new ADRs. Embed/auth/migration are operational + component choices; logged in the ledger +
  the deploy runbook. (ADR-0004 hosting is effectively amended by the MBP move — noted in the runbook.)

## Assumptions touched

- **A-001 RESOLVED 🟢** — Marketplace Custom Page (+ Custom Menu Link) embed verified live; no Custom
  JS fallback needed.

## Next action

**Record the D2 demo (2–5 min)** — the last outstanding deliverable. Open the Copilot from inside the
HighLevel sub-account (sidebar Custom Menu Link), then walk the loop: overview → agent (KPI profile +
recommendations) → call (Lead & Outcome + transcript Use Actions) → highlight a recommendation. The
embedded view proves R1.2/E1; the loop proves E2. (Loom.) Then optional cleanups: run the MBP
**`pm2 startup` sudo** line for reboot-persistence (user deferred), and remove the air's now-dead
`voai` cloudflared ingress block.
