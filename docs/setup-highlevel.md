# Setup — HighLevel Sandbox, Marketplace App & Permanent URL

> Deliverable **D1.1**: documented steps to install and run the suite inside a HighLevel
> sandbox. Verified against HighLevel developer docs (sources in `sessions/session-003.md`).

## A. Create the sandbox & app (HighLevel side)

1. **Developer account** — sign up at `marketplace.gohighlevel.com` (verify phone + email).
2. **Sandbox** — Dev portal → **Testing → + Create App Test Account** (name + password).
   Standalone account with Pro features, active 6 months. This is the R1.1 sandbox.
   - In the sandbox, create a **Voice AI agent** and generate a few test calls so there are
     real transcripts to ingest.
3. **Create app** — My Apps → **Create App**: type **Private**, target **Sub-account**,
   install **Agency & Sub-account**.
4. **Scopes** (Advanced Settings) — add Conversation AI / Voice AI **read** scopes (+ the
   exact Voice AI call-log scope; confirm name in the dropdown — assumption A-007). Keep them
   minimal. These must match `SCOPES` in `.env`.
5. **Redirect URL** — add `https://<your-domain>/oauth/callback` (HTTPS, must match exactly).
6. **Credentials** — Manage → Secrets → add Client Key pair. Copy **Client ID + Client
   Secret** (secret shown once) into `.env` — never into git or chat.
7. **Custom Page** — add a Custom Page (or Custom Menu Link → *Embedded Page (iFrame)*)
   pointing at `https://<your-domain>/`. Our server omits `X-Frame-Options` and sets a
   `frame-ancestors` CSP for `*.gohighlevel.com` / `*.leadconnectorhq.com` so it embeds.

## B. Run locally

```bash
cp .env.example .env          # fill CLIENT_ID / CLIENT_SECRET / PUBLIC_BASE_URL
cd server && npm install && npm run dev    # :8095
cd ../web && npm install && npm run dev     # :5173 (dev proxy → backend)
```

For production-style serving, `cd web && npm run build` — the backend then serves
`web/dist` on the same origin as the API (one URL for the iframe + OAuth).

## C. Permanent public URL (cloudflared)

We reuse the existing `main` named tunnel on `deepesh-engg.in` and add one hostname →
the backend port (`8095`). See ADR-0004.

1. Add an ingress rule to `~/.cloudflared/config.yml`:
   ```yaml
     - hostname: voai.deepesh-engg.in
       service: http://localhost:8095
   ```
   (place it above the `http_status:404` catch-all)
2. Create the DNS route (idempotent):
   ```bash
   cloudflared tunnel route dns main voai.deepesh-engg.in
   ```
3. Restart the `main` tunnel so it picks up the new ingress (briefly blips other hostnames
   on this tunnel — coordinate timing).
4. Set `PUBLIC_BASE_URL=https://voai.deepesh-engg.in` in `.env`, and use
   `https://voai.deepesh-engg.in/oauth/callback` as the app redirect URL (step A.5).

## D. Authorize

Visit `https://voai.deepesh-engg.in/oauth/install` → choose the sandbox sub-account →
land back in the dashboard. Tokens are exchanged and stored; the dashboard then lists the
connected account.

## E. Create a Voice AI agent & capture a real call (A-003)

The sandbox starts empty (`/voice-ai/agents` and `/voice-ai/dashboard/call-logs` both return
0). Until one real call exists, the per-call/transcript JSON shape is unknown. Steps below are
verified against HighLevel support docs (S-012). **Prereqs:** the sub-account uses LC Phone (or
Twilio) as phone provider; Voice AI is enabled for the location (Agency → AI Employee toggle);
the agency wallet has credits or an AI-Employee plan (Voice AI bills per minute).

1. **Create the agent** — AI Agents → Voice AI → Agent List → **+ Create Agent** → *Create from
   Scratch*. Fill **Agent Details** (name, business name, voice, timezone, LLM, greeting). On
   **Agent Goals** pick *Basic Mode* (no data-collection needed for a test). Save/Publish.
2. **Place a call** — easiest first: in the agent editor's *Test Your Agent* panel choose
   **Web Call → Inbound → Start Web Call**, allow the mic, talk for ≥1 exchange, hang up. No
   phone number or telephony cost. (If the web-call record doesn't surface via the API, assign
   a US number under Settings → Phone Numbers and use *Phone Call* test, or dial the number for
   a real inbound/"live" log.)
3. **Capture the shape** — wait ~30–90s for the transcript to generate, then:
   ```bash
   cd server && npx tsx scripts/capture-call-shape.mts
   # if a TEST/web call doesn't appear, retry with a callType filter:
   # npx tsx scripts/capture-call-shape.mts <installKey> test
   ```
   Writes `server/fixtures/real-call-list.json` + `real-call-<id>.json` (raw responses) and
   prints the field shape. Then update **A-003** and `functional-vs-mocked.md` with the real
   shape.

**Gotchas (S-012):** test (web/phone-test) call logs may be UI-only — it's unconfirmed whether
the List API returns them, so a real *inbound* call may be required for an API-visible record;
fresh sandboxes may lack wallet credits; Voice AI outbound is US-only and needs KYC. Fixtures
are real sandbox self-test data and may contain PII — scrub before sharing externally.

## F. Persistence & ingestion (ADR-0008)

Scored calls are persisted to **Postgres** (`AnalysisRepository`). The scoring engine uses the
**Claude Agent SDK** (auth via `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` — no bare key).

1. **Postgres** — any local instance works. Create the DB and set the URL in `.env`:
   ```bash
   createdb voiceai_observability     # or: psql -d postgres -c 'CREATE DATABASE voiceai_observability'
   # .env:
   DATABASE_URL=postgresql://<user>@localhost:5432/voiceai_observability
   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-...   # from `claude setup-token`
   ```
   Tables auto-create on server boot (`initSchema`) and on first ingest — no migration step.
2. **Ingest** (poll the sandbox, score + persist any new calls):
   ```bash
   cd server && npx tsx scripts/ingest.mts
   ```
3. **Read** via the API: `GET /api/analyses?locationId=<id>`, `/api/analyses/:callId`,
   `/api/kpis/averages?locationId=<id>`.
4. **Webhook (near-real-time)** — point GHL's *Transcript Generated* trigger at
   `POST https://voai.deepesh-engg.in/webhooks/ghl/voice-ai`; it scores + persists that call.
   (Payload-shape wiring still pending — A-006.)
