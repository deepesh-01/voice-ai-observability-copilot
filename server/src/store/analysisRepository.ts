import { getPool, initSchema } from '../db/pool.js';
import type { AgentRecommendations, CallAnalysis } from '../analysis/types.js';

/**
 * A scored call as read back: the analysis plus the call metadata/raw payload that
 * now live on `raw_call` (assembled via JOIN). This is the read shape; persisting only
 * needs SaveAnalysisInput, since the raw call is saved separately (RawCallRepository).
 */
export interface StoredCall {
  analysis: CallAnalysis;
  locationId: string;
  durationSec?: number;
  /** When the call happened (ISO 8601), from the GHL call log. */
  callAt?: string;
  /** The raw GHL call-log JSON (kept verbatim for fidelity), from raw_call. */
  rawCall: unknown;
}

/** What persisting an analysis needs — the raw call is stored via RawCallRepository. */
export interface SaveAnalysisInput {
  analysis: CallAnalysis;
  locationId: string;
}

/** Lightweight row for list/dashboard views — no heavy JSONB payload. */
export interface CallSummary {
  callId: string;
  agentId?: string;
  overallScore: number;
  summary: string;
  durationSec?: number;
  callAt?: string;
}

export interface KpiAverage {
  agentId: string | null;
  kpiKey: string;
  avgScore: number;
  calls: number;
}

/**
 * Reserved agentId meaning "calls with no agent attributed" (SQL NULL). Lets the
 * dashboard drill into the unassigned bucket — a real string can't carry "IS NULL".
 */
export const UNASSIGNED_AGENT = '__unassigned__';

/**
 * Storage for scored calls. The interface is the swap point (ADR-0002 rev): today
 * Postgres, swappable without touching the ingest/scoring code.
 */
export interface AnalysisRepository {
  init(): Promise<void>;
  has(callId: string): Promise<boolean>;
  save(rec: SaveAnalysisInput): Promise<void>;
  get(callId: string): Promise<StoredCall | null>;
  list(opts: { locationId: string; agentId?: string; limit?: number }): Promise<CallSummary[]>;
  /** Full analyses for the most recent calls — the evidence the recommendation synthesis reads. */
  recentAnalyses(opts: { locationId: string; agentId?: string; limit?: number }): Promise<CallAnalysis[]>;
  /** Avg score per (agent, KPI) — the analytics query Postgres is here for. */
  kpiAverages(opts: { locationId: string; agentId?: string }): Promise<KpiAverage[]>;
  /** Count of scored calls (the cache-invalidation signal for recommendations). */
  countCalls(opts: { locationId: string; agentId?: string }): Promise<number>;
  /** Cached recommendation report for an agent key ('' = location-wide), or null. */
  getRecommendations(opts: { locationId: string; agentKey: string }): Promise<{ report: AgentRecommendations; basedOnCalls: number } | null>;
  /** Upsert the cached recommendation report for an agent key. */
  saveRecommendations(opts: { locationId: string; agentKey: string; basedOnCalls: number; report: AgentRecommendations }): Promise<void>;
}

export class PostgresAnalysisRepository implements AnalysisRepository {
  async init(): Promise<void> {
    await initSchema();
  }

  async has(callId: string): Promise<boolean> {
    const { rows } = await getPool().query('SELECT 1 FROM call_analysis WHERE call_id = $1', [callId]);
    return rows.length > 0;
  }

  async save(rec: SaveAnalysisInput): Promise<void> {
    const a = rec.analysis;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The raw_call row must already exist (saved on ingest arrival) — the FK enforces it.
      await client.query(
        `INSERT INTO call_analysis
           (call_id, location_id, agent_id, overall_score, summary, analysis, scored_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())
         ON CONFLICT (call_id) DO UPDATE SET
           location_id=EXCLUDED.location_id, agent_id=EXCLUDED.agent_id,
           overall_score=EXCLUDED.overall_score, summary=EXCLUDED.summary,
           analysis=EXCLUDED.analysis, scored_at=now()`,
        [a.callId, rec.locationId, a.agentId ?? null, a.overallScore, a.summary, JSON.stringify(a)],
      );
      // Replace the flat KPI rows for this call.
      await client.query('DELETE FROM call_kpi WHERE call_id = $1', [a.callId]);
      for (const s of a.kpiScores) {
        await client.query(
          `INSERT INTO call_kpi (call_id, location_id, agent_id, kpi_key, score)
           VALUES ($1,$2,$3,$4,$5)`,
          [a.callId, rec.locationId, a.agentId ?? null, s.key, s.score],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async get(callId: string): Promise<StoredCall | null> {
    const { rows } = await getPool().query(
      `SELECT ca.location_id, ca.analysis, rc.duration_sec, rc.call_at, rc.payload
         FROM call_analysis ca JOIN raw_call rc USING (call_id)
        WHERE ca.call_id = $1`,
      [callId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      analysis: row.analysis as CallAnalysis,
      locationId: row.location_id,
      durationSec: row.duration_sec ?? undefined,
      callAt: row.call_at ? new Date(row.call_at).toISOString() : undefined,
      rawCall: row.payload,
    };
  }

  async list(opts: { locationId: string; agentId?: string; limit?: number }): Promise<CallSummary[]> {
    const params: unknown[] = [opts.locationId];
    let where = 'ca.location_id = $1';
    if (opts.agentId === UNASSIGNED_AGENT) {
      where += ' AND ca.agent_id IS NULL';
    } else if (opts.agentId) {
      params.push(opts.agentId);
      where += ` AND ca.agent_id = $${params.length}`;
    }
    params.push(Math.min(opts.limit ?? 100, 500));
    // Duration + timing live on raw_call; join for them and order by call time.
    const { rows } = await getPool().query(
      `SELECT ca.call_id, ca.agent_id, ca.overall_score, ca.summary, rc.duration_sec, rc.call_at
         FROM call_analysis ca JOIN raw_call rc USING (call_id)
        WHERE ${where}
        ORDER BY rc.call_at DESC NULLS LAST, ca.scored_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      callId: r.call_id,
      agentId: r.agent_id ?? undefined,
      overallScore: r.overall_score,
      summary: r.summary,
      durationSec: r.duration_sec ?? undefined,
      callAt: r.call_at ? new Date(r.call_at).toISOString() : undefined,
    }));
  }

  async recentAnalyses(opts: { locationId: string; agentId?: string; limit?: number }): Promise<CallAnalysis[]> {
    const params: unknown[] = [opts.locationId];
    let where = 'ca.location_id = $1';
    if (opts.agentId === UNASSIGNED_AGENT) {
      where += ' AND ca.agent_id IS NULL';
    } else if (opts.agentId) {
      params.push(opts.agentId);
      where += ` AND ca.agent_id = $${params.length}`;
    }
    params.push(Math.min(opts.limit ?? 50, 200));
    const { rows } = await getPool().query(
      `SELECT ca.analysis FROM call_analysis ca JOIN raw_call rc USING (call_id)
        WHERE ${where}
        ORDER BY rc.call_at DESC NULLS LAST, ca.scored_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => r.analysis as CallAnalysis);
  }

  async kpiAverages(opts: { locationId: string; agentId?: string }): Promise<KpiAverage[]> {
    const params: unknown[] = [opts.locationId];
    let where = 'location_id = $1';
    if (opts.agentId === UNASSIGNED_AGENT) {
      where += ' AND agent_id IS NULL';
    } else if (opts.agentId) {
      params.push(opts.agentId);
      where += ` AND agent_id = $${params.length}`;
    }
    const { rows } = await getPool().query(
      `SELECT agent_id, kpi_key, ROUND(AVG(score))::int AS avg_score, COUNT(*)::int AS calls
         FROM call_kpi WHERE ${where}
         GROUP BY agent_id, kpi_key
         ORDER BY agent_id, kpi_key`,
      params,
    );
    return rows.map((r) => ({
      agentId: r.agent_id ?? null,
      kpiKey: r.kpi_key,
      avgScore: r.avg_score,
      calls: r.calls,
    }));
  }

  async countCalls(opts: { locationId: string; agentId?: string }): Promise<number> {
    const params: unknown[] = [opts.locationId];
    let where = 'location_id = $1';
    if (opts.agentId === UNASSIGNED_AGENT) {
      where += ' AND agent_id IS NULL';
    } else if (opts.agentId) {
      params.push(opts.agentId);
      where += ` AND agent_id = $${params.length}`;
    }
    const { rows } = await getPool().query(`SELECT COUNT(*)::int AS n FROM call_analysis WHERE ${where}`, params);
    return rows[0]?.n ?? 0;
  }

  async getRecommendations(opts: { locationId: string; agentKey: string }): Promise<{ report: AgentRecommendations; basedOnCalls: number } | null> {
    const { rows } = await getPool().query(
      'SELECT report, based_on_calls FROM agent_recommendations WHERE location_id = $1 AND agent_id = $2',
      [opts.locationId, opts.agentKey],
    );
    const row = rows[0];
    if (!row) return null;
    return { report: row.report as AgentRecommendations, basedOnCalls: row.based_on_calls };
  }

  async saveRecommendations(opts: { locationId: string; agentKey: string; basedOnCalls: number; report: AgentRecommendations }): Promise<void> {
    await getPool().query(
      `INSERT INTO agent_recommendations (location_id, agent_id, based_on_calls, report, generated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (location_id, agent_id) DO UPDATE SET
         based_on_calls = EXCLUDED.based_on_calls, report = EXCLUDED.report, generated_at = now()`,
      [opts.locationId, opts.agentKey, opts.basedOnCalls, JSON.stringify(opts.report)],
    );
  }
}

/** Default repository instance (Postgres). */
export const analysisRepo: AnalysisRepository = new PostgresAnalysisRepository();
