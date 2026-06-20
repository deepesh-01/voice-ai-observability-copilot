# ADR-0008: Persistence on Postgres + JSONB; poll + webhook ingestion

- **Status:** Accepted
- **Date:** 2026-06-19
- **Session:** S-012
- **Traces to:** R2.1 (ingest transcripts), R2.3 (store derived KPI scores), R2.4 (dashboard reads), E2 (loop closes raw→recommendation)
- **Rests on assumptions:** A-003 (transcript shape, resolved)
- **Supersedes:** the storage choice in **ADR-0002** (MongoDB → Postgres+JSONB).

## Context

The scoring engine now turns a real transcript into a `CallAnalysis`. We need to persist
those so the dashboard isn't re-scoring on every view, and an ingestion path that gets new
calls scored without a human running a script. ADR-0002 had picked MongoDB; revisiting it now
that the read side is concrete.

## Decision

**Storage: Postgres + JSONB**, behind a swappable `AnalysisRepository` interface.

- `call_analysis` — JSONB columns (`analysis`, `raw_call`) keep full fidelity (the raw GHL
  call log has fields we don't map and an evolving shape); common query dimensions
  (`location_id`, `agent_id`, `overall_score`, `duration_sec`, `call_at`) are lifted into
  typed, indexed columns.
- `call_kpi` — a flat `(call_id, agent_id, kpi_key, score)` row set so per-agent/per-KPI
  aggregations are plain SQL `GROUP BY`.

**Query layer: raw parameterized SQL via `pg`, no ORM (deliberate).** All access goes through
the `node-postgres` driver with `$1/$2` parameterized SQL, hidden behind the
`AnalysisRepository` interface. We know the trade-off and chose this on purpose:

| | Raw SQL (`pg`) — chosen | ORM (Prisma/Drizzle/TypeORM) — rejected |
|---|---|---|
| Aggregations (`GROUP BY`, `AVG`, `ON CONFLICT`, JSONB) | First-class, legible — these *are* the workload | Awkward; usually drops to a raw-query escape hatch anyway |
| Schema size | 4 stable tables — ORM's modelling payoff barely applies | Pays its complexity tax before earning it |
| Result typing | ❌ rows are `any`, hand-mapped to types; drift caught by integration tests, not the compiler | ✅ generated/typed results |
| Migrations | ❌ none — additive `CREATE TABLE IF NOT EXISTS` only; first `ALTER` on a populated table is hand-written | ✅ migration framework |
| Injection safety | Rests on discipline (everything parameterized today; nothing *enforces* it) | Safe by construction |
| Deps / audit weight | Zero beyond `pg`; whole data layer readable in one pass (serves E3/E4) | Generated client, version coupling, toolchain |

The swap point we actually wanted (storage decoupled from ingest/scoring) is the
**`AnalysisRepository` interface**, not an ORM — so we get that benefit without the tax. The
one gap worth a future look is **untyped rows**; if it bites, the upgrade is a typed query
builder (**Kysely**) — compile-time result types without hiding the SQL — *not* a full ORM,
which would be over-engineering at this schema size.

**Ingestion: poll now, webhook ready.**

- **Poll** (`ingest/pollIngest.ts`, `scripts/ingest.mts`): list a location's call logs →
  `ingestCall` any not yet stored (idempotent via `repo.has`). Works against the live sandbox
  today.
- **Webhook** (`POST /webhooks/ghl/voice-ai`): push-half for near-real-time scoring once GHL's
  "Transcript Generated" trigger is wired (payload shape still A-006).
- `ingestCall`: getCallLog → parse transcript → fetch agent prompt as the goal → `scoreCall` →
  `repo.save`.

## Rationale

- Both DBs fit; the deciding factor is the **read side**. The dashboard's core queries are
  analytics — average KPI per agent, trends over time, leaderboards — which are exactly SQL's
  strength (`GROUP BY`, window functions). JSONB still gives document flexibility for the
  ingest side, so we don't lose Mongo's main advantage.
- Postgres was already installed and running locally (postgresql@17), so it's **runnable now**
  with zero new infra — important for a 5-day build and for the grader.
- The `AnalysisRepository` interface keeps the store a one-file swap, so this isn't a one-way
  door.

## Consequences

- New dep `pg`; `DATABASE_URL` in `.env` (local trust auth). Schema auto-created on boot
  (`initSchema`, idempotent) and by `scripts/ingest.mts`.
- Repository has a **real integration test** against local Postgres (skipped when
  `DATABASE_URL` is unset) — first DB-backed tests in the suite.
- ~~The file-based `tokenStore` stays as-is for now (OAuth tokens)~~ **Done (S-015):** the
  OAuth `tokenStore` was moved onto Postgres (`oauth_tokens`), so auth is now durable +
  multi-tenant on the same store. The legacy `tokens.json` is kept only as a one-shot migration
  source (`scripts/migrate-tokens.mts`).
- Ingestion is currently **manual/poll**; the webhook endpoint exists but GHL-side trigger
  wiring (A-006) is still pending.

## Schema (as built)

> ⚠️ **Superseded by [ADR-0011](./0011-normalize-raw-call-source-of-record.md):** the raw
> payload + call metadata were split out of `call_analysis` into a `raw_call` source-of-record
> table, with `call_analysis`/`call_lead` FK-ing to it. The `call_analysis` block below shows
> the *original* shape (raw_call/duration_sec/call_at inline); see ADR-0011 for the current one.

Auto-created by `initSchema()` (`server/src/db/pool.ts`), idempotent on boot. Five tables —
four for analysis, one for auth:

```
call_analysis            -- one scored call (R2.1/R2.3); JSONB fidelity + lifted query columns
  call_id        TEXT  PK
  location_id    TEXT  NOT NULL          → idx_call_analysis_location
  agent_id       TEXT                    → idx_call_analysis_agent
  overall_score  INTEGER NOT NULL
  summary        TEXT  NOT NULL DEFAULT ''
  duration_sec   INTEGER
  analysis       JSONB NOT NULL          -- full CallAnalysis (KPI scores, deviations, use-actions)
  raw_call       JSONB NOT NULL          -- verbatim GHL call log
  call_at        TIMESTAMPTZ             → idx_call_analysis_call_at (DESC)
  scored_at      TIMESTAMPTZ NOT NULL DEFAULT now()

call_kpi                 -- flat per-KPI rows so per-agent averages are plain GROUP BY (R2.4)
  call_id        TEXT  NOT NULL  REFERENCES call_analysis(call_id) ON DELETE CASCADE
  location_id    TEXT  NOT NULL
  agent_id       TEXT                    → idx_call_kpi_agent_key (agent_id, kpi_key)
  kpi_key        TEXT  NOT NULL
  score          INTEGER NOT NULL
  PRIMARY KEY (call_id, kpi_key)

agent_recommendations    -- cached cross-call synthesis (R2.5); reused while based_on_calls matches
  location_id    TEXT  NOT NULL
  agent_id       TEXT  NOT NULL          -- real id | '__unassigned__' | '' (location-wide)
  based_on_calls INTEGER NOT NULL        -- cache key: scored-call count at generation time
  report         JSONB NOT NULL
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  PRIMARY KEY (location_id, agent_id)

oauth_tokens             -- HighLevel install tokens (R1.2, S-015); one row per install
  install_key    TEXT  PK               -- locationId ?? companyId
  access_token   TEXT  NOT NULL
  refresh_token  TEXT  NOT NULL
  expires_at     BIGINT NOT NULL         -- epoch ms (matches InstallTokens.expiresAt)
  user_type      TEXT  NOT NULL          -- 'Location' | 'Company'
  location_id    TEXT
  company_id     TEXT
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
```

Writes use `INSERT … ON CONFLICT DO UPDATE` (idempotent upserts); `call_analysis` + its
`call_kpi` rows are written in one `BEGIN/COMMIT` transaction in `AnalysisRepository.save()`.
