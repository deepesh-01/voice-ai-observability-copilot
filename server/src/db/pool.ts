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
 * Create tables/indexes if absent. Idempotent — safe to run on every boot. We keep
 * full fidelity in JSONB (analysis, raw_call) and lift the common query dimensions
 * into typed columns. `call_kpi` is a flat per-KPI row set so the dashboard's
 * aggregations (avg per agent/KPI over time) are plain SQL — the reason for Postgres.
 */
export async function initSchema(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS call_analysis (
      call_id       TEXT PRIMARY KEY,
      location_id   TEXT NOT NULL,
      agent_id      TEXT,
      overall_score INTEGER NOT NULL,
      summary       TEXT NOT NULL DEFAULT '',
      duration_sec  INTEGER,
      analysis      JSONB NOT NULL,
      raw_call      JSONB NOT NULL,
      call_at       TIMESTAMPTZ,
      scored_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_call_analysis_location ON call_analysis (location_id);
    CREATE INDEX IF NOT EXISTS idx_call_analysis_agent    ON call_analysis (agent_id);
    CREATE INDEX IF NOT EXISTS idx_call_analysis_call_at  ON call_analysis (call_at DESC);

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
  `;
  await getPool().query(sql);
}
