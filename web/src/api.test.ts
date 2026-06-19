import { describe, it, expect } from 'vitest';
import {
  parseTranscript,
  deriveAgents,
  UNASSIGNED_AGENT,
  agentLabel,
  formatDuration,
  type CallSummary,
  type KpiAverage,
} from './api';

/**
 * parseTranscript MUST stay byte-for-byte equivalent to the backend
 * (server/src/analysis/transcript.ts): the call detail view maps the scorer's
 * `evidence`/`turnIndex`/UseAction turn indices onto these parsed turns, so any
 * drift silently points the highlights at the wrong lines. These cases mirror
 * server/src/analysis/transcript.test.ts to pin that contract.
 */
describe('parseTranscript (mirrors backend exactly)', () => {
  it('parses bot/human lines into agent/caller turns', () => {
    expect(parseTranscript('bot:Hello there\nhuman:Hi, I need help\n')).toEqual([
      { index: 0, speaker: 'agent', text: 'Hello there' },
      { index: 1, speaker: 'caller', text: 'Hi, I need help' },
    ]);
  });

  it('merges consecutive same-speaker lines into one turn', () => {
    const raw =
      'bot:Which slot works?\nhuman:Saturday eleven AM.\nhuman:That is what I want.\nbot:Done.\n';
    expect(parseTranscript(raw)).toEqual([
      { index: 0, speaker: 'agent', text: 'Which slot works?' },
      { index: 1, speaker: 'caller', text: 'Saturday eleven AM. That is what I want.' },
      { index: 2, speaker: 'agent', text: 'Done.' },
    ]);
  });

  it('splits on the first colon only and is case-insensitive on the prefix', () => {
    expect(parseTranscript('BOT:Your appointment is at 11:00 AM: confirmed\n')).toEqual([
      { index: 0, speaker: 'agent', text: 'Your appointment is at 11:00 AM: confirmed' },
    ]);
  });

  it('treats an unknown-prefix line as a continuation of the current turn', () => {
    expect(parseTranscript('bot:Line one\nstill the agent talking\nhuman:ok\n')).toEqual([
      { index: 0, speaker: 'agent', text: 'Line one still the agent talking' },
      { index: 1, speaker: 'caller', text: 'ok' },
    ]);
  });

  it('returns [] for empty / whitespace / non-string input', () => {
    expect(parseTranscript('')).toEqual([]);
    expect(parseTranscript('   \n  \n')).toEqual([]);
    expect(parseTranscript(null)).toEqual([]);
    expect(parseTranscript(undefined)).toEqual([]);
    expect(parseTranscript(42)).toEqual([]);
  });
});

describe('deriveAgents', () => {
  const kpiAverages: KpiAverage[] = [
    { agentId: 'a1', kpiKey: 'goal_completion', avgScore: 90, calls: 2 },
    { agentId: 'a1', kpiKey: 'info_capture', avgScore: 40, calls: 2 },
    { agentId: null, kpiKey: 'goal_completion', avgScore: 70, calls: 1 },
  ];
  const calls: CallSummary[] = [
    { callId: 'c1', agentId: 'a1', overallScore: 80, summary: '' },
    { callId: 'c2', agentId: 'a1', overallScore: 60, summary: '' },
    { callId: 'c3', overallScore: 70, summary: '' }, // no agentId → unassigned bucket
  ];

  it('groups by agent, averages overall scores, and sorts KPIs weakest-first', () => {
    const agents = deriveAgents(calls, kpiAverages);
    const a1 = agents.find((a) => a.agentId === 'a1')!;
    expect(a1.callCount).toBe(2);
    expect(a1.avgScore).toBe(70); // (80+60)/2
    expect(a1.kpiAverages.map((k) => k.kpiKey)).toEqual(['info_capture', 'goal_completion']);
  });

  it('buckets agent-less calls under the UNASSIGNED sentinel and maps its null KPIs', () => {
    const agents = deriveAgents(calls, kpiAverages);
    const unassigned = agents.find((a) => a.agentId === UNASSIGNED_AGENT)!;
    expect(unassigned).toBeDefined();
    expect(unassigned.callCount).toBe(1);
    // The null-agent KPI average is attributed to the unassigned bucket.
    expect(unassigned.kpiAverages).toHaveLength(1);
    expect(unassigned.kpiAverages[0].avgScore).toBe(70);
  });

  it('orders agents by call count descending', () => {
    const agents = deriveAgents(calls, kpiAverages);
    expect(agents[0].agentId).toBe('a1'); // 2 calls before the 1-call unassigned bucket
  });
});

describe('agentLabel / shortId', () => {
  it('renders the unassigned sentinel readably and shortens long ids', () => {
    expect(agentLabel(UNASSIGNED_AGENT)).toBe('Unassigned');
    expect(agentLabel('6a35206c88ba8e0f1c707f02')).toBe('6a35206c…');
    // Short ids pass through unchanged.
    expect(agentLabel('abc123')).toBe('abc123');
  });
});

describe('formatDuration', () => {
  it('formats seconds as m:ss and shows a 0s call (not a dash)', () => {
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(undefined)).toBe('—');
  });
});
