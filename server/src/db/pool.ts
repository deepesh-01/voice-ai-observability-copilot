import pg from 'pg';
import { config } from '../config.js';

/**
 * Shared Postgres pool. Created lazily so commands that don't touch the DB (OAuth,
 * raw call capture) work even when DATABASE_URL is unset.
 */
let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set — persistence is unavailable.');
  }
  pool ??= new pg.Pool({ connectionString: config.databaseUrl });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * Create tables/indexes if absent. Idempotent — safe to run on every boot. Fresh DBs
 * get the current (normalized) shape directly; an existing DB on the old single-table
 * shape is migrated by scripts/migrate-split-raw.mts (CREATE IF NOT EXISTS won't ALTER).
 *
 * Layering: `raw_call` is the source-of-record, captured on ingest arrival (so a call is
 * never lost if scoring later fails). `call_analysis` (derived KPI scoring) and `call_lead`
 * (derived lead/booking data) both hang off it by FK. `call_kpi` is a flat per-KPI row set
 * so per-agent/KPI aggregations are plain SQL `GROUP BY` — the reason for Postgres.
 */
export async function initSchema(): Promise<void> {
  const sql = `
    -- Source-of-record: the verbatim GHL call object + lifted call metadata. Written the
    -- moment a call is ingested (webhook/poll), before any analysis. Everything else FKs here.
    CREATE TABLE IF NOT EXISTS raw_call (
      call_id      TEXT PRIMARY KEY,
      location_id  TEXT NOT NULL,
      agent_id     TEXT,
      contact_id   TEXT,
      duration_sec INTEGER,
      call_at      TIMESTAMPTZ,
      payload      JSONB NOT NULL,
      received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_raw_call_location ON raw_call (location_id);
    CREATE INDEX IF NOT EXISTS idx_raw_call_agent    ON raw_call (agent_id);
    CREATE INDEX IF NOT EXISTS idx_raw_call_call_at  ON raw_call (call_at DESC);

    -- Derived KPI analysis for a call. location_id/agent_id are denormalized (cheap, used in
    -- every WHERE); the heavy raw payload + call timing live on raw_call, joined when needed.
    CREATE TABLE IF NOT EXISTS call_analysis (
      call_id       TEXT PRIMARY KEY REFERENCES raw_call (call_id) ON DELETE CASCADE,
      location_id   TEXT NOT NULL,
      agent_id      TEXT,
      overall_score INTEGER NOT NULL,
      summary       TEXT NOT NULL DEFAULT '',
      analysis      JSONB NOT NULL,
      scored_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_call_analysis_location ON call_analysis (location_id);
    CREATE INDEX IF NOT EXISTS idx_call_analysis_agent    ON call_analysis (agent_id);

    CREATE TABLE IF NOT EXISTS call_kpi (
      call_id   TEXT NOT NULL REFERENCES call_analysis (call_id) ON DELETE CASCADE,
      location_id TEXT NOT NULL,
      agent_id  TEXT,
      kpi_key   TEXT NOT NULL,
      score     INTEGER NOT NULL,
      PRIMARY KEY (call_id, kpi_key)
    );
    CREATE INDEX IF NOT EXISTS idx_call_kpi_agent_key ON call_kpi (agent_id, kpi_key);

    -- Cached cross-call recommendation synthesis (R2.5). Reused while based_on_calls
    -- still matches the agent's scored-call count, so the slow/paid Opus synthesis
    -- only re-runs when new calls arrive or on explicit refresh.
    -- agent_id: a real id, '__unassigned__' (null-agent bucket), or '' (location-wide).
    CREATE TABLE IF NOT EXISTS agent_recommendations (
      location_id    TEXT NOT NULL,
      agent_id       TEXT NOT NULL,
      based_on_calls INTEGER NOT NULL,
      report         JSONB NOT NULL,
      generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (location_id, agent_id)
    );

    -- HighLevel OAuth install tokens (R1.2). One row per install, keyed by the
    -- sub-account/agency id (locationId ?? companyId). Moved off the gitignored
    -- tokens.json file so auth is durable + multi-tenant (ADR-0008). expires_at is
    -- epoch milliseconds (BIGINT) to match InstallTokens.expiresAt.
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      install_key   TEXT PRIMARY KEY,
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at    BIGINT NOT NULL,
      user_type     TEXT NOT NULL,
      location_id   TEXT,
      company_id    TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Per-call lead facts + two observability signals (missed opportunity R2.3,
    -- human-action-needed R2.6) — the queryable business layer that makes Postgres earn
    -- its place. Identity (name/phone/email) is resolved from the GHL contact when
    -- available, else the transcript. NO approval/workflow state: we flag for the operator,
    -- HighLevel's CRM owns the bookings. FK to raw_call (not call_analysis): a lead is
    -- extracted independently of scoring, so it survives a scoring failure but never
    -- outlives the call.
    CREATE TABLE IF NOT EXISTS call_lead (
      call_id                   TEXT PRIMARY KEY REFERENCES raw_call (call_id) ON DELETE CASCADE,
      location_id               TEXT NOT NULL,
      agent_id                  TEXT,
      contact_id                TEXT,
      caller_name               TEXT,
      phone                     TEXT,
      email                     TEXT,
      problem                   TEXT,
      treatment                 TEXT,
      booking_status            TEXT NOT NULL DEFAULT 'unknown',
      booked_at                 TIMESTAMPTZ,
      confirmed                 BOOLEAN NOT NULL DEFAULT false,
      missed_opportunity        BOOLEAN NOT NULL DEFAULT false,
      missed_opportunity_reason TEXT,
      human_action_needed       BOOLEAN NOT NULL DEFAULT false,
      human_action_reason       TEXT,
      source                    TEXT NOT NULL DEFAULT 'llm',
      native                    JSONB,
      extraction                JSONB NOT NULL,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_call_lead_location  ON call_lead (location_id);
    CREATE INDEX IF NOT EXISTS idx_call_lead_agent     ON call_lead (agent_id);
    CREATE INDEX IF NOT EXISTS idx_call_lead_phone     ON call_lead (phone);
    CREATE INDEX IF NOT EXISTS idx_call_lead_booking   ON call_lead (booking_status);
    -- Partial indexes: the dashboard queries "what needs attention" — only the true rows.
    CREATE INDEX IF NOT EXISTS idx_call_lead_missed ON call_lead (location_id) WHERE missed_opportunity;
    CREATE INDEX IF NOT EXISTS idx_call_lead_action ON call_lead (location_id) WHERE human_action_needed;
  `;
  await getPool().query(sql);
}
