# Session S-005 — 2026-06-18 — Rename public host (drop brand reference)

## Goal

The Marketplace portal would not save a redirect URI under `ghl.deepesh-engg.in` — HighLevel
rejects URLs containing brand references. Rename the public host to a brand-free subdomain.

## Done

- Renamed public host **`ghl.deepesh-engg.in` → `voai.deepesh-engg.in`** (Voice AI
  Observability):
  - Updated the `main` cloudflared ingress rule + added the `voai` DNS CNAME; restarted tunnel.
  - Restarted backend with `PUBLIC_BASE_URL=https://voai.deepesh-engg.in`.
  - Propagated the hostname through `.env`, `.env.example`, `docs/setup-highlevel.md`,
    ADR-0004, and S-004.
- **Verified:** `https://voai.deepesh-engg.in/health` → 200; `/oauth/install` redirect_uri is
  now `https://voai.deepesh-engg.in/oauth/callback` (no brand reference); old `ghl.` host →
  404 (no ingress); `scout.deepesh-engg.in` → 401 (its normal auth gate, i.e. up — no
  collateral breakage).

## Decisions

- No new ADR; this amends **ADR-0004** (consequences updated). Captured as **A-008**.

## Assumptions touched

- **A-008 (new, 🟢 validated):** HighLevel rejects redirect URIs / app URLs containing brand
  references → public host must be brand-free.

## Open questions / next action

- Orphan `ghl.deepesh-engg.in` CNAME remains in Cloudflare DNS (harmless; delete later).
- **Builder:** in the portal, set redirect URL `https://voai.deepesh-engg.in/oauth/callback`
  and Custom Page `https://voai.deepesh-engg.in/`; confirm Voice AI scope (A-007).
- **Then:** authorize the sandbox and capture a real `Get Call Log` payload (A-003) → KPI
  schema (A-004).
