# Deploy: host the prod origin on an always-on machine via a Cloudflare Tunnel

How `https://voai.deepesh-engg.in` is served publicly. The app runs on an **always-on machine**
(a Mac, in our case) and is exposed to the internet through a **Cloudflare Tunnel (`cloudflared`)** —
an **outbound-only** connection to Cloudflare's edge, so there are **no open inbound ports / no
port-forwarding**, TLS is terminated at the edge, and the marketplace iframe + OAuth redirect +
webhook all share one stable HTTPS origin.

> **Status:** deployed and live. App + tunnel are supervised by **pm2** (auto-restart on crash;
> relaunch on boot once `pm2 startup` is enabled). Data lives in local Postgres on the host.

## Architecture

```
  HighLevel / browser ──HTTPS──▶ Cloudflare edge ──tunnel (outbound)──▶ host:8095
                                  (TLS, DDoS)        cloudflared           Node app
                                                                          ├─ SPA + API + OAuth
                                                                          └─ Postgres (local)
```

- **App** — single Node process on `:8095` (serves the SPA + API + OAuth), under **pm2**.
- **Postgres** — local on the host, holding the persisted calls + OAuth tokens.
- **Tunnel** — a dedicated `cloudflared` tunnel; only `voai.deepesh-engg.in`'s DNS points to it.
  (If the same host runs other tunnels/sites, leave those untouched — use a separate tunnel.)

Below is the runbook to stand this up on a fresh host (or move it to a new one). Placeholders:
`<host>` = the target machine, `<user>` = its OS user, `<tunnel-id>` = the id `cloudflared` prints.

## Phase 0 — get two files onto the host

The app needs its `.env` (secrets + `DATABASE_URL`) and a DB dump. Transfer them over any private
channel (we used Tailscale Taildrop; `scp` over a VPN works too):

```bash
# from the source machine — produce a dump with a pg_dump matching the source server version
pg_dump --no-owner --no-privileges voiceai_observability > voiceai_observability.sql
# then copy voiceai_observability.sql and the repo .env to <host> by your chosen method
```

## Phase 1 — install the stack (on the host)

```bash
# Homebrew first if absent: https://brew.sh
brew install node postgresql@<NN> cloudflared      # match <NN> to the dump's PG major version
brew services start postgresql@<NN>
```

## Phase 2 — restore the database

```bash
createdb voiceai_observability
# the role in DATABASE_URL must exist; create it once if needed:
#   psql -d postgres -c "CREATE ROLE <db-user> LOGIN SUPERUSER;"
psql -h localhost -U <db-user> -d voiceai_observability < voiceai_observability.sql
psql -h localhost -U <db-user> -d voiceai_observability -c "SELECT count(*) FROM raw_call;"
```

> Cross-version note: a dump from a newer Postgres can fail on an older server on one line
> (`SET transaction_timeout = 0;` from PG17). Either install the matching major version, or strip
> that single line before restore: `sed '/SET transaction_timeout = 0;/d' dump.sql > restore.sql`.

## Phase 3 — run the app (under pm2)

```bash
git clone https://github.com/deepesh-01/voice-ai-observability-copilot ~/voai
cd ~/voai
cp /path/to/.env .env                  # the transferred env (secrets + DATABASE_URL)
( cd server && npm install )
( cd web && npm install && npm run build )

npm install -g pm2
cd ~/voai/server && pm2 start npm --name voai -- run start
pm2 save
pm2 startup            # prints a `sudo …` command — run it to enable launch-on-boot

curl -s localhost:8095/health
```

## Phase 4 — dedicated tunnel + DNS

```bash
cloudflared tunnel login               # browser → authorize the Cloudflare account
cloudflared tunnel create voai         # creates the tunnel + ~/.cloudflared/<tunnel-id>.json

# ~/.cloudflared/config.yml :
#   tunnel: <tunnel-id>
#   credentials-file: ~/.cloudflared/<tunnel-id>.json
#   ingress:
#     - hostname: voai.deepesh-engg.in
#       service: http://localhost:8095
#     - service: http_status:404

cloudflared tunnel route dns voai voai.deepesh-engg.in   # points the public hostname at this tunnel

# run the tunnel always-on. Either supervise it with pm2 (no sudo):
pm2 start cloudflared --name voai-tunnel -- tunnel run voai && pm2 save
# …or install it as a launchd service:  cloudflared service install
```

`route dns` is the public cutover — Cloudflare DNS propagates in seconds.

## Phase 5 — verify

```bash
curl -s https://voai.deepesh-engg.in/health      # 200, served via the tunnel
```

## Rollback

It's DNS-only: re-point `cloudflared tunnel route dns <other-tunnel> voai.deepesh-engg.in` and the
hostname flips back. The app + DB on the old host stay untouched until you stop them.

## Notes

- **Alternative DB:** a managed cloud Postgres (Neon/Supabase free tier) in `DATABASE_URL` means no
  laptop holds state — heavier setup, but fully host-independent.
- **API token:** the copied `.env` already has `API_AUTH_TOKEN`, so the dashboard authenticates
  with no extra step.
- **Index.html caching:** the server reads `index.html` once at boot to inject the API token, so
  after a `web` rebuild, `pm2 restart voai` to pick up the new bundle.
