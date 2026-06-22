# Database schema — `voiceai_observability` (Postgres)

The source of truth for this schema is [`pool.ts → initSchema()`](./pool.ts), which is **idempotent**
(`CREATE … IF NOT EXISTS`) and runs on every boot. This doc is the human-readable map of those tables.
No ORM — explicit SQL behind swappable repositories ([ADR-0008](../../../docs/decisions/0008-persistence-postgres-and-ingestion.md)).

## Design in one idea

`raw_call` is the **source-of-record**, written the moment a call is ingested (webhook/poll) — *before*
any analysis. Everything derived (`call_analysis`, `call_lead`) hangs off it by foreign key with
`ON DELETE CASCADE`, so a scoring or extraction failure never loses the call (re-ingest replays from
raw), and a deleted call cleans up its derivations. `call_kpi` is a flat per-KPI row set so per-agent
aggregations are plain SQL `GROUP BY` — the reason persistence is Postgres, not a document store.

```
raw_call (call_id PK)
  ├── 1:1 ──▶ call_analysis (call_id PK & FK)  ── 1:N ──▶ call_kpi (call_id, kpi_key PK)
  └── 1:1 ──▶ call_lead     (call_id PK & FK)

agent_recommendations (location_id, agent_id PK)   ◇ no FK — cached cross-call synthesis
oauth_tokens          (install_key PK)             ◇ no FK — one row per HighLevel install
```

Convention: `location_id` (and usually `agent_id`) are **denormalized** onto every derived table —
they appear in nearly every `WHERE`, so carrying them avoids a join on the hot read path. The heavy
verbatim payloads live in `JSONB` columns and are joined/parsed only when a detail view needs them.

---

## `raw_call` — source-of-record

The verbatim GHL call object + lifted metadata. Written on ingest arrival, before analysis.

| Column | Type | Notes |
|--------|------|-------|
| `call_id` | `TEXT` **PK** | GHL call id |
| `location_id` | `TEXT NOT NULL` | sub-account |
| `agent_id` | `TEXT` | Voice AI agent (nullable) |
| `contact_id` | `TEXT` | GHL contact, if linked |
| `duration_sec` | `INTEGER` | call length |
| `call_at` | `TIMESTAMPTZ` | when the call happened |
| `payload` | `JSONB NOT NULL` | the full raw GHL call object (incl. transcript) |
| `received_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | ingest arrival |

Indexes: `location_id`, `agent_id`, `call_at DESC`.

## `call_analysis` — derived KPI scoring (1:1 with a call)

| Column | Type | Notes |
|--------|------|-------|
| `call_id` | `TEXT` **PK**, **FK → raw_call** `ON DELETE CASCADE` | |
| `location_id` | `TEXT NOT NULL` | denormalized |
| `agent_id` | `TEXT` | denormalized |
| `overall_score` | `INTEGER NOT NULL` | 0–100 |
| `summary` | `TEXT NOT NULL DEFAULT ''` | one-line verdict |
| `analysis` | `JSONB NOT NULL` | full `CallAnalysis`: `kpiScores[]`, `deviations[]`, `useActions[]` |
| `scored_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Indexes: `location_id`, `agent_id`.

## `call_kpi` — flat per-KPI scores (1:N per call)

Exists so `GROUP BY agent_id, kpi_key` averages are trivial SQL (drives the KPI profile + weakest-KPI).

| Column | Type | Notes |
|--------|------|-------|
| `call_id` | `TEXT NOT NULL`, **FK → call_analysis** `ON DELETE CASCADE` | |
| `location_id` | `TEXT NOT NULL` | |
| `agent_id` | `TEXT` | |
| `kpi_key` | `TEXT NOT NULL` | e.g. `info_capture`, `goal_completion` |
| `score` | `INTEGER NOT NULL` | 0–100 |
| **PK** | `(call_id, kpi_key)` | one row per KPI per call |

Index: `(agent_id, kpi_key)`.

## `call_lead` — lead facts + observability signals (1:1 with a call)

The queryable business layer. Identity is resolved from the GHL contact when available, else the
transcript. **No approval/workflow state** — we flag for the operator (R2.3 / R2.6); HighLevel's CRM
owns the bookings. FKs to `raw_call` (not `call_analysis`): a lead is extracted independently of
scoring, so it survives a scoring failure but never outlives the call.

| Column | Type | Notes |
|--------|------|-------|
| `call_id` | `TEXT` **PK**, **FK → raw_call** `ON DELETE CASCADE` | |
| `location_id` | `TEXT NOT NULL` | |
| `agent_id` / `contact_id` | `TEXT` | |
| `caller_name` / `phone` / `email` | `TEXT` | identity facts |
| `problem` / `treatment` | `TEXT` | why they called / service of interest |
| `booking_status` | `TEXT NOT NULL DEFAULT 'unknown'` | `booked` · `not_booked` · `reschedule` · `cancelled` · `unknown` |
| `booked_at` | `TIMESTAMPTZ` | appointment time if set |
| `confirmed` | `BOOLEAN NOT NULL DEFAULT false` | agent confirmed back to caller |
| `missed_opportunity` | `BOOLEAN NOT NULL DEFAULT false` | **signal R2.3** |
| `missed_opportunity_reason` | `TEXT` | |
| `human_action_needed` | `BOOLEAN NOT NULL DEFAULT false` | **signal R2.6** |
| `human_action_reason` | `TEXT` | |
| `source` | `TEXT NOT NULL DEFAULT 'llm'` | provenance of the **facts**: `ghl` (native extractedData) or `llm` |
| `native` | `JSONB` | raw GHL `extractedData` blob, when present |
| `extraction` | `JSONB NOT NULL` | verbatim LLM extraction (kept for fidelity) |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Indexes: `location_id`, `agent_id`, `phone`, `booking_status`, plus **partial** indexes
`WHERE missed_opportunity` and `WHERE human_action_needed` — the dashboard asks "what needs
attention", so only the `true` rows are indexed.

## `agent_recommendations` — cached cross-call synthesis (R2.5)

Reused while `based_on_calls` still matches the agent's scored-call count, so the slow/paid Opus
synthesis only re-runs when new calls arrive or on explicit refresh.

| Column | Type | Notes |
|--------|------|-------|
| `location_id` | `TEXT NOT NULL` | |
| `agent_id` | `TEXT NOT NULL` | a real id, `__unassigned__` (null-agent bucket), or `''` (location-wide) |
| `based_on_calls` | `INTEGER NOT NULL` | cache key — invalidates when the count changes |
| `report` | `JSONB NOT NULL` | full `AgentRecommendations` |
| `generated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| **PK** | `(location_id, agent_id)` | |

## `oauth_tokens` — HighLevel install tokens (R1.2)

One row per install, keyed by `locationId ?? companyId`. Moved off the gitignored `tokens.json`
so auth is durable + multi-tenant ([ADR-0008](../../../docs/decisions/0008-persistence-postgres-and-ingestion.md)).

| Column | Type | Notes |
|--------|------|-------|
| `install_key` | `TEXT` **PK** | sub-account / agency id |
| `access_token` / `refresh_token` | `TEXT NOT NULL` | |
| `expires_at` | `BIGINT NOT NULL` | **epoch milliseconds** (matches `InstallTokens.expiresAt`) |
| `user_type` | `TEXT NOT NULL` | `Location` / `Company` |
| `location_id` / `company_id` | `TEXT` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

---

## Creating & migrating

- **Fresh DB:** tables + indexes are created on first boot by `initSchema()`. Nothing else to run.
- **Existing DB:** `CREATE IF NOT EXISTS` never `ALTER`s — shape changes ship as one-shot scripts in
  [`server/scripts/`](../../scripts) (`migrate-split-raw`, `migrate-lead-signals`, `migrate-lead-source`,
  `migrate-tokens`). Run with `tsx`.
- **Move/backup:** `pg_dump --no-owner --no-privileges voiceai_observability`; see the host-migration
  runbook for a worked restore ([`docs/deploy-home-mbp.md`](../../../docs/deploy-home-mbp.md)).
