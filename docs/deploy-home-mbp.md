# Deploy: move the prod origin to the home MacBook Pro

Goal: host `voai.deepesh-engg.in` on the always-on home Mac (`deepeshs-macbook-pro`,
Tailscale `100.114.29.6`) instead of the laptop that travels — so the origin survives
reboots, sleep, and losing internet on the move.

## Architecture

Everything that serves `voai` moves to the MBP and becomes self-sufficient:

- **App** — Node server on `:8095` (serves the SPA + API + OAuth), run under **pm2**
  (auto-restart on crash + on boot).
- **Postgres** — local Postgres on the MBP with the migrated data (16 calls + OAuth token).
- **Tunnel** — a **new, dedicated cloudflared tunnel** named `voai` on the MBP. We re-point
  **only** `voai.deepesh-engg.in`'s DNS to it.

The air's existing tunnel keeps serving the other hostnames (apex, scout, welog, takejob) —
we do **not** move those. Same OS username (`deepeshz2`) on both Macs, so the existing
`DATABASE_URL=postgresql://deepeshz2@localhost:5432/voiceai_observability` works unchanged.

## Phase 0 — move two files to the MBP (no SSH needed, via Tailscale Taildrop)

From the **air** (this machine):

```bash
tailscale file cp /tmp/voiceai_observability.sql \
  /Users/deepeshz2/Documents/highlevel-assignment/.env \
  deepeshs-macbook-pro:
```

On the **MBP**, receive them into the home dir:

```bash
cd ~ && tailscale file get .
# → ~/voiceai_observability.sql  and  ~/.env
```

## Phase 1 — install the stack (on the MBP)

```bash
# Homebrew first if it's not installed: https://brew.sh
brew install node postgresql@17 cloudflared
brew services start postgresql@17
# ensure the v17 client tools are on PATH for this shell:
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
```

## Phase 2 — restore the database (on the MBP)

```bash
createdb voiceai_observability
psql voiceai_observability < ~/voiceai_observability.sql
# sanity check:
psql voiceai_observability -c "SELECT count(*) FROM raw_call;"   # → 16
```

## Phase 3 — run the app (on the MBP)

```bash
git clone https://github.com/deepesh-01/voice-ai-observability-copilot ~/voai
cd ~/voai
cp ~/.env .env                         # the Taildropped env (secrets + DATABASE_URL)
( cd server && npm install )
( cd web && npm install && npm run build )

# auto-restart + start-on-boot:
npm install -g pm2
cd ~/voai/server && pm2 start "npm run start" --name voai
pm2 save
pm2 startup            # run the sudo command it prints, to enable launch-on-boot

# verify locally:
curl -s localhost:8095/health
```

## Phase 4 — dedicated tunnel + DNS cutover (on the MBP)

```bash
cloudflared tunnel login               # browser → authorize the Cloudflare account
cloudflared tunnel create voai         # creates tunnel + ~/.cloudflared/<id>.json

# write ~/.cloudflared/config.yml :
#   tunnel: <voai-tunnel-id-from-create>
#   credentials-file: /Users/deepeshz2/.cloudflared/<voai-tunnel-id>.json
#   ingress:
#     - hostname: voai.deepesh-engg.in
#       service: http://localhost:8095
#     - service: http_status:404

cloudflared tunnel route dns voai voai.deepesh-engg.in   # ⚠️ THE PUBLIC CUTOVER
cloudflared service install            # run the tunnel as a launchd service (on boot)
```

`route dns` repoints `voai.deepesh-engg.in` from the air's tunnel to the MBP's — this is the
moment traffic shifts. Cloudflare DNS propagates in seconds.

## Phase 5 — verify + decommission on the air

```bash
# from anywhere:
curl -s https://voai.deepesh-engg.in/health      # now served by the MBP

# then on the AIR, retire its voai role:
#  1) remove the `voai.deepesh-engg.in` ingress block from ~/.cloudflared/config.yml
#  2) restart its cloudflared (the other hostnames keep working)
#  3) stop the local app:  kill the node process on :8095  (use the specific PID)
#  4) (optional) the local Postgres can stay for dev; prod no longer depends on it
```

## Rollback

DNS-only: `cloudflared tunnel route dns <air-tunnel> voai.deepesh-engg.in` from the air points
the hostname back, and re-start the air's app. The air's app + DB are untouched until you
choose to stop them, so rollback is just a DNS flip.

## Notes

- **Alternative DB:** instead of local Postgres on the MBP you could use a managed cloud
  Postgres (Neon/Supabase free tier) and set `DATABASE_URL` to it — then neither laptop holds
  state. Heavier setup; local-on-MBP matches the "host it at home" intent and is in this runbook.
- **API token:** the `.env` you copied already contains `API_AUTH_TOKEN`, so the embedded +
  standalone dashboard keep working with no change.
- **Re-dump if data changed:** if calls come in on the air before cutover, re-run the v17
  `pg_dump` and re-Taildrop before Phase 2.
