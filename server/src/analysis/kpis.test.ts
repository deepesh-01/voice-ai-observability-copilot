import { describe, it, expect } from 'vitest';
import { KPI_CATALOG, KPI_KEYS, weightedOverall } from './kpis.js';
import type { KpiScore } from './types.js';

describe('KPI catalog', () => {
  it('has unique keys and positive weights', () => {
    expect(new Set(KPI_KEYS).size).toBe(KPI_KEYS.length);
    for (const k of KPI_CATALOG) expect(k.weight).toBeGreaterThan(0);
  });
});

describe('weightedOverall', () => {
  it('returns 0 for no scores', () => {
    expect(weightedOverall([])).toBe(0);
  });

  it('weights goal_completion (3) above sentiment (1)', () => {
    const scores: KpiScore[] = [
      { key: 'goal_completion', score: 100, rationale: '', evidence: [] },
      { key: 'sentiment', score: 0, rationale: '', evidence: [] },
    ];
    // (100*3 + 0*1) / (3+1) = 75
    expect(weightedOverall(scores)).toBe(75);
  });

  it('ignores unknown keys', () => {
    const scores: KpiScore[] = [
      { key: 'goal_completion', score: 80, rationale: '', evidence: [] },
      { key: 'made_up', score: 0, rationale: '', evidence: [] } as unknown as KpiScore,
    ];
    expect(weightedOverall(scores)).toBe(80);
  });

  it('rounds to the nearest integer', () => {
    const scores: KpiScore[] = [
      { key: 'goal_completion', score: 100, rationale: '', evidence: [] }, // w3
      { key: 'script_adherence', score: 100, rationale: '', evidence: [] }, // w2
      { key: 'sentiment', score: 50, rationale: '', evidence: [] }, // w1
    ];
    // (300 + 200 + 50) / 6 = 91.67 → 92
    expect(weightedOverall(scores)).toBe(92);
  });
});
