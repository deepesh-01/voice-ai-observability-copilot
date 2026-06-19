import { describe, it, expect } from 'vitest';
import {
  buildRecommendSystemPrompt,
  buildEvidenceDigest,
  assembleRecommendations,
} from './recommend.js';
import { KPI_KEYS } from './kpis.js';
import type { CallAnalysis, KpiAverageSnapshot } from './types.js';

const analyses: CallAnalysis[] = [
  {
    callId: 'call-1',
    agentId: 'a1',
    overallScore: 60,
    summary: 'Booked but missed email.',
    kpiScores: [],
    deviations: [
      { severity: 'high', kpi: 'info_capture', description: 'Did not ask for email.', turnIndex: 4 },
    ],
    useActions: [],
  },
  {
    callId: 'call-2',
    agentId: 'a1',
    overallScore: 55,
    summary: 'Lost the caller on price.',
    kpiScores: [],
    deviations: [
      { severity: 'medium', kpi: 'info_capture', description: 'Skipped full name.', turnIndex: 2 },
      { severity: 'low', kpi: 'objection_handling', description: 'Ignored price hesitation.' },
    ],
    useActions: [],
  },
];

const kpiAverages: KpiAverageSnapshot[] = [
  { key: 'goal_completion', avgScore: 85, calls: 2 },
  { key: 'info_capture', avgScore: 47, calls: 2 },
];

describe('buildRecommendSystemPrompt', () => {
  it('frames the synthesis around every KPI and actionable fixes', () => {
    const sys = buildRecommendSystemPrompt();
    for (const k of KPI_KEYS) expect(sys).toContain(k);
    expect(sys.toLowerCase()).toContain('actionable');
  });
});

describe('buildEvidenceDigest', () => {
  const digest = buildEvidenceDigest({ agentId: 'a1', agentGoal: 'Book dental appointments', kpiAverages, analyses });

  it('includes the agent goal and lists KPI averages weakest-first', () => {
    expect(digest).toContain('Book dental appointments');
    // info_capture (47) must appear before goal_completion (85)
    expect(digest.indexOf('info_capture: 47')).toBeLessThan(digest.indexOf('goal_completion: 85'));
  });

  it('groups deviations by KPI with occurrence counts, most frequent first', () => {
    expect(digest).toContain('info_capture — 2 occurrence(s)');
    expect(digest).toContain('objection_handling — 1 occurrence(s)');
    expect(digest.indexOf('info_capture — 2')).toBeLessThan(digest.indexOf('objection_handling — 1'));
  });

  it('lists per-call summaries with their ids so the model can cite evidence', () => {
    expect(digest).toContain('[call-1] overall 60/100 — Booked but missed email.');
    expect(digest).toContain('[call-2]');
  });
});

describe('assembleRecommendations', () => {
  const valid = new Set(['call-1', 'call-2']);
  const raw = {
    recommendations: [
      {
        title: 'Always capture email',
        kind: 'prompt',
        priority: 'high',
        kpi: 'info_capture',
        problem: 'Agent forgets email.',
        fix: 'Add: "Before booking, ask for and confirm the caller\'s email."',
        rationale: 'Lifts info_capture.',
        evidenceCallIds: ['call-1', 'call-2', 'ghost-call', 'call-1'],
      },
      {
        title: 'bad enums',
        kind: 'telepathy',
        priority: 'urgent',
        kpi: 'not_a_kpi',
        problem: 'p',
        fix: 'f',
        rationale: 'r',
        evidenceCallIds: [],
      },
    ],
    summary: 'Strong on booking, weak on data capture.',
  };

  it('passes through a valid recommendation and dedupes/filters evidence to known calls', () => {
    const rec = assembleRecommendations('a1', raw, kpiAverages, 2, valid);
    const first = rec.recommendations[0]!;
    expect(first.kpi).toBe('info_capture');
    expect(first.kind).toBe('prompt');
    // 'ghost-call' dropped (unknown), 'call-1' deduped
    expect(first.evidenceCallIds).toEqual(['call-1', 'call-2']);
  });

  it('normalizes invalid enums to safe defaults', () => {
    const rec = assembleRecommendations('a1', raw, kpiAverages, 2, valid);
    const second = rec.recommendations[1]!;
    expect(second.kind).toBe('prompt');
    expect(second.priority).toBe('medium');
    expect(second.kpi).toBe('general');
  });

  it('reports calls analyzed and sorts the KPI snapshot weakest-first', () => {
    const rec = assembleRecommendations('a1', raw, kpiAverages, 2, valid);
    expect(rec.callsAnalyzed).toBe(2);
    expect(rec.kpiAverages[0]!.key).toBe('info_capture');
  });
});
