import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt, assembleAnalysis } from './score.js';
import { KPI_KEYS } from './kpis.js';
import type { Turn } from './types.js';

const turns: Turn[] = [
  { index: 0, speaker: 'agent', text: 'Hi, BrightSmile Dental.' },
  { index: 1, speaker: 'caller', text: 'I need an appointment.' },
];

describe('buildSystemPrompt', () => {
  it('lists every KPI key so the model scores all of them', () => {
    const sys = buildSystemPrompt();
    for (const k of KPI_KEYS) expect(sys).toContain(k);
  });
});

describe('buildUserPrompt', () => {
  it('includes the agent goal and the indexed transcript', () => {
    const prompt = buildUserPrompt({ callId: 'c1', agentGoal: 'Book appointments', turns });
    expect(prompt).toContain('Book appointments');
    expect(prompt).toContain('[0] Agent: Hi, BrightSmile Dental.');
    expect(prompt).toContain('[1] Caller: I need an appointment.');
  });
});

describe('assembleAnalysis', () => {
  const raw = {
    kpiScores: [
      { key: 'goal_completion', score: 90, rationale: 'booked', evidence: [1] },
      { key: 'sentiment', score: 80, rationale: 'happy', evidence: [] },
      { key: 'not_a_kpi', score: 50, rationale: 'x', evidence: [] }, // dropped
      { key: 'goal_completion', score: 10, rationale: 'dup', evidence: [] }, // dedup
    ],
    deviations: [
      { severity: 'high', kpi: 'goal_completion', description: 'd', turnIndex: 1 },
      { severity: 'bogus', kpi: 'nope', description: 'e', turnIndex: 99 }, // normalized
    ],
    useActions: [
      { label: 'a', reason: 'r', startTurn: 0, endTurn: 1 },
      { label: 'bad', reason: 'r', startTurn: 1, endTurn: 0 }, // dropped (end<start)
    ],
    summary: 'ok',
  };

  it('drops unknown KPIs and dedupes by key (first wins)', () => {
    const a = assembleAnalysis('c1', 'a1', raw, turns.length);
    const keys = a.kpiScores.map((s) => s.key);
    expect(keys).toEqual(['goal_completion', 'sentiment']);
    expect(a.kpiScores.find((s) => s.key === 'goal_completion')!.score).toBe(90);
  });

  it('clamps scores to 0..100 and filters out-of-range evidence turns', () => {
    const a = assembleAnalysis('c1', undefined, {
      ...raw,
      kpiScores: [{ key: 'sentiment', score: 150, rationale: '', evidence: [0, 99] }],
    }, turns.length);
    expect(a.kpiScores[0]!.score).toBe(100);
    expect(a.kpiScores[0]!.evidence).toEqual([0]);
  });

  it('computes the weighted overall from the kept KPIs', () => {
    const a = assembleAnalysis('c1', 'a1', raw, turns.length);
    // goal_completion 90 (w3) + sentiment 80 (w1) = (270+80)/4 = 87.5 → 88
    expect(a.overallScore).toBe(88);
  });

  it('normalizes bad severity/kpi and drops an out-of-range turnIndex', () => {
    const a = assembleAnalysis('c1', 'a1', raw, turns.length);
    const bad = a.deviations[1]!;
    expect(bad.severity).toBe('low');
    expect(bad.kpi).toBe('general');
    expect(bad.turnIndex).toBeUndefined();
  });

  it('drops use-actions whose span is inverted', () => {
    const a = assembleAnalysis('c1', 'a1', raw, turns.length);
    expect(a.useActions).toHaveLength(1);
    expect(a.useActions[0]!.label).toBe('a');
  });
});
