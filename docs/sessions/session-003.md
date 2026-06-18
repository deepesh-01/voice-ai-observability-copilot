# Session S-003 — 2026-06-18 — Sandbox & integration path research

## Goal

Produce an accurate, step-by-step path to a HighLevel sandbox + marketplace app (the gate
blocking A-001/A-003), grounded in HighLevel's current developer docs rather than memory.

## Done

- Researched HighLevel developer docs and confirmed the integration path:
  - **Developer account:** sign up at `marketplace.gohighlevel.com`.
  - **Sandbox:** Testing → **+ Create App Test Account** → standalone account with Pro/
    enterprise features, active **6 months**.
  - **App:** My Apps → Create App → **Private**, target **Sub-account**, install Agency +
    Sub-account. OAuth scopes via Advanced Settings; redirect URL must be HTTPS; Client
    ID/Secret generated under Manage → Secrets (secret shown once).
  - **Embed surface (R1.2):** **Custom Page (iframe)** or Custom Menu Link → Embedded Page;
    our host must NOT send `X-Frame-Options: DENY/SAMEORIGIN`.
  - **Transcripts (R2.1):** a **Voice AI Public API** exists — `List Call Logs` +
    `Get Call Log` return transcripts; needs Conversation AI / Voice AI read scopes.
- Delivered the 9-step walkthrough to the builder.

## Decisions

- No new ADR yet. Findings strengthen ADR-0002's integration choice (Custom Page iframe +
  OAuth marketplace app) and confirm the Voice AI Public API as the ingestion source. A
  formal ingestion ADR (webhook vs poll, normalization schema) will follow once we see a
  real payload (resolves the ADR-0002 open sub-decision).

## Assumptions touched

- **A-001** — updated to "research-validated"; sandbox + Custom Page iframe path confirmed,
  pending hands-on login.
- **A-003** — updated to "research-validated"; Voice AI Public API (`List/Get Call Log`)
  confirmed as transcript source, pending hands-on payload inspection.

## Open questions / next action

- **Needs builder:** create the sandbox (steps 1–2) and put Client ID/Secret in `.env`
  (never in chat).
- **Sandbox may have no transcripts yet:** likely need to create a Voice AI agent + generate
  test calls to have real data to ingest.
- **Next action (unblocked, can run now):** lock the KPI / observability-parameter schema
  (A-004) as the next ADR, and scaffold the repo against a mocked transcript fixture shaped
  to the Voice AI `Get Call Log` response, so swapping mock → real is a one-line change.

## Sources

- https://marketplace.gohighlevel.com/docs/oauth/SandboxAccount/
- https://marketplace.gohighlevel.com/docs/oauth/CreateMarketplaceApp/index.html
- https://marketplace.gohighlevel.com/docs/marketplace-modules/CustomPages/
- https://help.gohighlevel.com/support/solutions/articles/155000006379-voice-ai-public-apis
- https://marketplace.gohighlevel.com/docs/ghl/voice-ai/get-call-logs/index.html
- https://marketplace.gohighlevel.com/docs/ghl/voice-ai/get-call-log/index.html
