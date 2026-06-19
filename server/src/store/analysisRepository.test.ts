import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from '../config.js';
import { PostgresAnalysisRepository, UNASSIGNED_AGENT } from './analysisRepository.js';
import { getPool, closePool } from '../db/pool.js';
import type { CallAnalysis } from '../analysis/types.js';

// Integration test — runs only when a Postgres DATABASE_URL is configured.
const run = config.databaseUrl ? describe : describe.skip;

const LOC = '__test_loc__';
const repo = new PostgresAnalysisRepository();

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

run('PostgresAnalysisRepository (integration)', () => {
  beforeAll(async () => {
    await repo.init();
    await getPool().query('DELETE FROM call_analysis WHERE location_id = $1', [LOC]);
  });
  afterAll(async () => {
    await getPool().query('DELETE FROM call_analysis WHERE location_id = $1', [LOC]);
    await closePool();
  });

  it('saves, reports existence, and reads back', async () => {
    await repo.save({
      analysis: analysis('t1', 'agentA', 90, 80),
      locationId: LOC,
      durationSec: 42,
      callAt: '2026-06-19T10:00:00.000Z',
      rawCall: { id: 't1', transcript: 'bot:hi\nhuman:hello' },
    });
    expect(await repo.has('t1')).toBe(true);
    const stored = await repo.get('t1');
    expect(stored?.analysis.overallScore).toBe(85);
    expect(stored?.durationSec).toBe(42);
    expect((stored?.rawCall as { id: string }).id).toBe('t1');
  });

  it('upserts on the same call id (no duplicate)', async () => {
    await repo.save({ analysis: analysis('t1', 'agentA', 50, 50), locationId: LOC, rawCall: {} });
    const list = await repo.list({ locationId: LOC });
    expect(list.filter((c) => c.callId === 't1')).toHaveLength(1);
    expect((await repo.get('t1'))?.analysis.overallScore).toBe(50);
  });

  it('averages KPI scores per agent', async () => {
    await repo.save({ analysis: analysis('t2', 'agentA', 100, 100), locationId: LOC, rawCall: {} });
    // agentA goal_completion: (50 from t1 + 100 from t2) / 2 = 75
    const avgs = await repo.kpiAverages({ locationId: LOC, agentId: 'agentA' });
    const goal = avgs.find((a) => a.kpiKey === 'goal_completion');
    expect(goal?.avgScore).toBe(75);
    expect(goal?.calls).toBe(2);
  });

  it('filters the unassigned (NULL agent) bucket via the UNASSIGNED_AGENT sentinel', async () => {
    // A call with no agentId persists agent_id = NULL.
    const noAgent: CallAnalysis = { ...analysis('t3', 'x', 40, 40), agentId: undefined };
    await repo.save({ analysis: noAgent, locationId: LOC, rawCall: {} });

    // The sentinel resolves to `agent_id IS NULL` — only the unassigned call, not agentA's.
    const list = await repo.list({ locationId: LOC, agentId: UNASSIGNED_AGENT });
    expect(list.map((c) => c.callId)).toEqual(['t3']);

    const avgs = await repo.kpiAverages({ locationId: LOC, agentId: UNASSIGNED_AGENT });
    expect(avgs.every((a) => a.agentId === null)).toBe(true);
    expect(avgs.find((a) => a.kpiKey === 'goal_completion')?.avgScore).toBe(40);

    const recent = await repo.recentAnalyses({ locationId: LOC, agentId: UNASSIGNED_AGENT });
    expect(recent.map((a) => a.callId)).toEqual(['t3']);
  });
});
