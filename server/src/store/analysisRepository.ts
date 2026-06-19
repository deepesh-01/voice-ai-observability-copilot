import { getPool, initSchema } from '../db/pool.js';
import type { CallAnalysis } from '../analysis/types.js';

/** A scored call plus the metadata we persist alongside the analysis. */
export interface StoredCall {
  analysis: CallAnalysis;
  locationId: string;
  durationSec?: number;
  /** When the call happened (ISO 8601), from the GHL call log. */
  callAt?: string;
  /** The raw GHL call-log JSON (kept verbatim for fidelity). */
  rawCall: unknown;
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
 * Storage for scored calls. The interface is the swap point (ADR-0002 rev): today
 * Postgres, swappable without touching the ingest/scoring code.
 */
export interface AnalysisRepository {
  init(): Promise<void>;
  has(callId: string): Promise<boolean>;
  save(rec: StoredCall): Promise<void>;
  get(callId: string): Promise<StoredCall | null>;
  list(opts: { locationId: string; agentId?: string; limit?: number }): Promise<CallSummary[]>;
  /** Avg score per (agent, KPI) — the analytics query Postgres is here for. */
  kpiAverages(opts: { locationId: string; agentId?: string }): Promise<KpiAverage[]>;
}

export class PostgresAnalysisRepository implements AnalysisRepository {
  async init(): Promise<void> {
    await initSchema();
  }

  async has(callId: string): Promise<boolean> {
    const { rows } = await getPool().query('SELECT 1 FROM call_analysis WHERE call_id = $1', [callId]);
    return rows.length > 0;
  }

  async save(rec: StoredCall): Promise<void> {
    const a = rec.analysis;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO call_analysis
           (call_id, location_id, agent_id, overall_score, summary, duration_sec, analysis, raw_call, call_at, scored_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (call_id) DO UPDATE SET
           location_id=EXCLUDED.location_id, agent_id=EXCLUDED.agent_id,
           overall_score=EXCLUDED.overall_score, summary=EXCLUDED.summary,
           duration_sec=EXCLUDED.duration_sec, analysis=EXCLUDED.analysis,
           raw_call=EXCLUDED.raw_call, call_at=EXCLUDED.call_at, scored_at=now()`,
        [
          a.callId,
          rec.locationId,
          a.agentId ?? null,
          a.overallScore,
          a.summary,
          rec.durationSec ?? null,
          JSON.stringify(a),
          JSON.stringify(rec.rawCall),
          rec.callAt ?? null,
        ],
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
      `SELECT location_id, duration_sec, call_at, analysis, raw_call FROM call_analysis WHERE call_id = $1`,
      [callId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      analysis: row.analysis as CallAnalysis,
      locationId: row.location_id,
      durationSec: row.duration_sec ?? undefined,
      callAt: row.call_at ? new Date(row.call_at).toISOString() : undefined,
      rawCall: row.raw_call,
    };
  }

  async list(opts: { locationId: string; agentId?: string; limit?: number }): Promise<CallSummary[]> {
    const params: unknown[] = [opts.locationId];
    let where = 'location_id = $1';
    if (opts.agentId) {
      params.push(opts.agentId);
      where += ` AND agent_id = $${params.length}`;
    }
    params.push(Math.min(opts.limit ?? 100, 500));
    const { rows } = await getPool().query(
      `SELECT call_id, agent_id, overall_score, summary, duration_sec, call_at
         FROM call_analysis WHERE ${where}
         ORDER BY call_at DESC NULLS LAST, scored_at DESC
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

  async kpiAverages(opts: { locationId: string; agentId?: string }): Promise<KpiAverage[]> {
    const params: unknown[] = [opts.locationId];
    let where = 'location_id = $1';
    if (opts.agentId) {
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
}

/** Default repository instance (Postgres). */
export const analysisRepo: AnalysisRepository = new PostgresAnalysisRepository();
