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
     - hostname: ghl.deepesh-engg.in
       service: http://localhost:8095
   ```
   (place it above the `http_status:404` catch-all)
2. Create the DNS route (idempotent):
   ```bash
   cloudflared tunnel route dns main ghl.deepesh-engg.in
   ```
3. Restart the `main` tunnel so it picks up the new ingress (briefly blips other hostnames
   on this tunnel — coordinate timing).
4. Set `PUBLIC_BASE_URL=https://ghl.deepesh-engg.in` in `.env`, and use
   `https://ghl.deepesh-engg.in/oauth/callback` as the app redirect URL (step A.5).

## D. Authorize

Visit `https://ghl.deepesh-engg.in/oauth/install` → choose the sandbox sub-account →
land back in the dashboard. Tokens are exchanged and stored; the dashboard then lists the
connected account.
