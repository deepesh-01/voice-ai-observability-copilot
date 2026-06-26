import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from '../config.js';
import { PostgresAnalysisRepository, UNASSIGNED_AGENT } from './analysisRepository.js';
import { PostgresRawCallRepository, type StoredRawCall } from './rawCallRepository.js';
import { getPool, closePool } from '../db/pool.js';
import type { CallAnalysis } from '../analysis/types.js';

// Integration test — runs only when a Postgres DATABASE_URL is configured.
const run = config.databaseUrl ? describe : describe.skip;

const LOC = '__test_loc__';
const repo = new PostgresAnalysisRepository();
const rawRepo = new PostgresRawCallRepository();

function analysis(callId: string, agentId: string, goal: number, sentiment: number): CallAnalysis {
  return {
    callId,
    agentId,
    overallScore: Math.round((goal + sentiment) / 2),
    summary: `summary ${callId}`,
    kpiScores: [
      { key: 'goal_completion', score: goal, rationale: '', evidence: [] },
      { key: 'sentiment', score: sentiment, rationale: '', evidence: [] },
    ],
    deviations: [],
    useActions: [],
  };
}

/** Save the source-of-record raw_call row that analysis/lead rows FK to. */
async function saveRaw(callId: string, agentId: string | undefined, over: Partial<StoredRawCall> = {}) {
  await rawRepo.saveRaw({ callId, locationId: LOC, agentId, payload: { id: callId }, ...over });
}

run('PostgresAnalysisRepository (integration)', () => {
  beforeAll(async () => {
    await repo.init();
    // Deleting raw_call cascades to call_analysis / call_kpi / call_lead.
    await getPool().query('DELETE FROM raw_call WHERE location_id = $1', [LOC]);
    await getPool().query('DELETE FROM agent_recommendations WHERE location_id = $1', [LOC]);
  });
  afterAll(async () => {
    await getPool().query('DELETE FROM raw_call WHERE location_id = $1', [LOC]);
    await getPool().query('DELETE FROM agent_recommendations WHERE location_id = $1', [LOC]);
    await closePool();
  });

  it('saves, reports existence, and reads back (raw metadata joined from raw_call)', async () => {
    await saveRaw('t1', 'agentA', {
      durationSec: 42,
      callAt: '2026-06-19T10:00:00.000Z',
      payload: { id: 't1', transcript: 'bot:hi\nhuman:hello' },
    });
    await repo.save({ analysis: analysis('t1', 'agentA', 90, 80), locationId: LOC });

    expect(await repo.has('t1')).toBe(true);
    const stored = await repo.get('t1');
    expect(stored?.analysis.overallScore).toBe(85);
    expect(stored?.durationSec).toBe(42); // from raw_call
    expect(stored?.callAt).toBe('2026-06-19T10:00:00.000Z'); // from raw_call
    expect((stored?.rawCall as { id: string }).id).toBe('t1'); // raw_call.payload
  });

  it('upserts on the same call id (no duplicate)', async () => {
    await repo.save({ analysis: analysis('t1', 'agentA', 50, 50), locationId: LOC });
    const list = await repo.list({ locationId: LOC });
    expect(list.filter((c) => c.callId === 't1')).toHaveLength(1);
    expect((await repo.get('t1'))?.analysis.overallScore).toBe(50);
  });

  it('averages KPI scores per agent', async () => {
    await saveRaw('t2', 'agentA');
    await repo.save({ analysis: analysis('t2', 'agentA', 100, 100), locationId: LOC });
    // agentA goal_completion: (50 from t1 + 100 from t2) / 2 = 75
    const avgs = await repo.kpiAverages({ locationId: LOC, agentId: 'agentA' });
    const goal = avgs.find((a) => a.kpiKey === 'goal_completion');
    expect(goal?.avgScore).toBe(75);
    expect(goal?.calls).toBe(2);
  });

  it('filters the unassigned (NULL agent) bucket via the UNASSIGNED_AGENT sentinel', async () => {
    await saveRaw('t3', undefined);
    const noAgent: CallAnalysis = { ...analysis('t3', 'x', 40, 40), agentId: undefined };
    await repo.save({ analysis: noAgent, locationId: LOC });

    const list = await repo.list({ locationId: LOC, agentId: UNASSIGNED_AGENT });
    expect(list.map((c) => c.callId)).toEqual(['t3']);

    const avgs = await repo.kpiAverages({ locationId: LOC, agentId: UNASSIGNED_AGENT });
    expect(avgs.every((a) => a.agentId === null)).toBe(true);
    expect(avgs.find((a) => a.kpiKey === 'goal_completion')?.avgScore).toBe(40);

    const recent = await repo.recentAnalyses({ locationId: LOC, agentId: UNASSIGNED_AGENT });
    expect(recent.map((a) => a.callId)).toEqual(['t3']);
  });

  it('cascade-deletes analysis when the raw call is deleted', async () => {
    expect(await repo.has('t2')).toBe(true);
    await getPool().query('DELETE FROM raw_call WHERE call_id = $1', ['t2']);
    expect(await repo.has('t2')).toBe(false);
    // restore for KPI-average independence across re-runs in one process
    await saveRaw('t2', 'agentA');
    await repo.save({ analysis: analysis('t2', 'agentA', 100, 100), locationId: LOC });
  });

  it('counts calls and caches/reads back the recommendation report', async () => {
    expect(await repo.countCalls({ locationId: LOC, agentId: 'agentA' })).toBe(2);

    const report = {
      agentId: 'agentA',
      callsAnalyzed: 2,
      kpiAverages: [],
      recommendations: [],
      summary: 'cached summary',
    };
    await repo.saveRecommendations({ locationId: LOC, agentKey: 'agentA', basedOnCalls: 2, report });

    const got = await repo.getRecommendations({ locationId: LOC, agentKey: 'agentA' });
    expect(got?.basedOnCalls).toBe(2);
    expect(got?.report.summary).toBe('cached summary');

    await repo.saveRecommendations({ locationId: LOC, agentKey: 'agentA', basedOnCalls: 3, report });
    expect((await repo.getRecommendations({ locationId: LOC, agentKey: 'agentA' }))?.basedOnCalls).toBe(3);

    expect(await repo.getRecommendations({ locationId: LOC, agentKey: 'nope' })).toBeNull();
  });

  it('persists the applied flag on a recommendation without bumping basedOnCalls', async () => {
    const rec = (title: string) => ({
      title,
      kind: 'prompt' as const,
      priority: 'high' as const,
      kpi: 'info_capture' as const,
      problem: 'p',
      fix: 'f',
      rationale: 'r',
      evidenceCallIds: [],
    });
    const report = {
      agentId: 'agentB',
      callsAnalyzed: 4,
      kpiAverages: [],
      recommendations: [rec('first'), rec('second')],
      summary: 's',
    };
    await repo.saveRecommendations({ locationId: LOC, agentKey: 'agentB', basedOnCalls: 4, report });

    const marked = await repo.markRecommendationApplied({ locationId: LOC, agentKey: 'agentB', index: 1 });
    expect(marked).toBe(true);

    const got = await repo.getRecommendations({ locationId: LOC, agentKey: 'agentB' });
    expect(got?.basedOnCalls).toBe(4); // unchanged → cache stays valid
    expect(got?.report.recommendations[0].applied).toBeFalsy();
    expect(got?.report.recommendations[1].applied).toBe(true);
    expect(typeof got?.report.recommendations[1].appliedAt).toBe('string');

    // Out-of-range index and missing report are no-ops.
    expect(await repo.markRecommendationApplied({ locationId: LOC, agentKey: 'agentB', index: 9 })).toBe(false);
    expect(await repo.markRecommendationApplied({ locationId: LOC, agentKey: 'nope', index: 0 })).toBe(false);
  });
});
