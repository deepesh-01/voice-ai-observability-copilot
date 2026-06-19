import { runStructured } from '../llm/agent.js';
import { KPI_CATALOG, KPI_KEYS, KPI_BY_KEY, weightedOverall } from './kpis.js';
import { transcriptToText } from './transcript.js';
import type {
  CallAnalysis,
  Deviation,
  KpiKey,
  KpiScore,
  Severity,
  Turn,
  UseAction,
} from './types.js';

export interface ScoreInput {
  callId: string;
  agentId?: string;
  /** The agent's configured goal/script — KPIs are scored relative to THIS. */
  agentGoal: string;
  turns: Turn[];
}

/** The shape the LLM is constrained to return (pre-assembly). */
interface RawScoring {
  kpiScores: { key: string; score: number; rationale: string; evidence: number[] }[];
  deviations: { severity: string; kpi: string; description: string; turnIndex: number }[];
  useActions: { label: string; reason: string; startTurn: number; endTurn: number }[];
  summary: string;
}

const SEVERITIES: Severity[] = ['low', 'medium', 'high'];

/** JSON-schema for structured output. Constraints the schema can't express (0–100 bound,
 * valid turn indices) are enforced in assembleAnalysis. */
export const SCORING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kpiScores', 'deviations', 'useActions', 'summary'],
  properties: {
    kpiScores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'score', 'rationale', 'evidence'],
        properties: {
          key: { type: 'string', enum: KPI_KEYS },
          score: { type: 'integer' },
          rationale: { type: 'string' },
          evidence: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    deviations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'kpi', 'description', 'turnIndex'],
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          kpi: { type: 'string', enum: [...KPI_KEYS, 'general'] },
          description: { type: 'string' },
          // -1 when the deviation isn't tied to a specific turn.
          turnIndex: { type: 'integer' },
        },
      },
    },
    useActions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'reason', 'startTurn', 'endTurn'],
        properties: {
          label: { type: 'string' },
          reason: { type: 'string' },
          startTurn: { type: 'integer' },
          endTurn: { type: 'integer' },
        },
      },
    },
    summary: { type: 'string' },
  },
} as const;

export function buildSystemPrompt(): string {
  const kpiLines = KPI_CATALOG.map(
    (k) => `- ${k.key} (${k.label}): ${k.description}\n    Scale: ${k.rubric}`,
  ).join('\n');
  return [
    'You are a meticulous QA analyst for a Voice AI calling product.',
    'You score a single call transcript against fixed KPIs, judged RELATIVE to the',
    "agent's own configured goal/script — not a generic ideal.",
    '',
    'Score every KPI below from 0 to 100 using its scale. Cite the turn indices that',
    'justify each score in `evidence`. Be specific and fair: do not invent problems,',
    'and do not give credit for steps that did not happen.',
    '',
    'KPIs:',
    kpiLines,
    '',
    'Also surface:',
    '- deviations: concrete failures or drifts from the goal/script. Set `turnIndex` to',
    '  the turn where it occurred, or -1 if it spans the whole call. `kpi` is the KPI it',
    "  maps to, or 'general'.",
    '- useActions: spans of turns a human reviewer should look at (the most coachable or',
    '  risky moments), each with a short label and reason.',
    '- summary: 1–2 sentences on how the call went.',
    '',
    'Score every KPI exactly once.',
  ].join('\n');
}

export function buildUserPrompt(input: ScoreInput): string {
  return [
    "AGENT'S CONFIGURED GOAL / SCRIPT:",
    input.agentGoal.trim(),
    '',
    'TRANSCRIPT (turn index in brackets):',
    input.turns.map((t) => `[${t.index}] ${t.speaker === 'agent' ? 'Agent' : 'Caller'}: ${t.text}`).join('\n'),
  ].join('\n');
}

/** Turn a (possibly imperfect) LLM result into a validated CallAnalysis. Pure + total. */
export function assembleAnalysis(
  callId: string,
  agentId: string | undefined,
  raw: RawScoring,
  turnCount: number,
): CallAnalysis {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const validTurn = (i: number) => Number.isInteger(i) && i >= 0 && i < turnCount;

  // Keep only known KPIs, dedupe by key (first wins), clamp scores.
  const seen = new Set<KpiKey>();
  const kpiScores: KpiScore[] = [];
  for (const s of raw.kpiScores ?? []) {
    if (!(s.key in KPI_BY_KEY) || seen.has(s.key as KpiKey)) continue;
    seen.add(s.key as KpiKey);
    kpiScores.push({
      key: s.key as KpiKey,
      score: clamp(s.score),
      rationale: s.rationale ?? '',
      evidence: (s.evidence ?? []).filter(validTurn),
    });
  }

  const deviations: Deviation[] = (raw.deviations ?? []).map((d) => ({
    severity: SEVERITIES.includes(d.severity as Severity) ? (d.severity as Severity) : 'low',
    kpi: d.kpi in KPI_BY_KEY ? (d.kpi as KpiKey) : 'general',
    description: d.description ?? '',
    ...(validTurn(d.turnIndex) ? { turnIndex: d.turnIndex } : {}),
  }));

  const useActions: UseAction[] = (raw.useActions ?? [])
    .map((u) => ({
      label: u.label ?? '',
      reason: u.reason ?? '',
      startTurn: validTurn(u.startTurn) ? u.startTurn : 0,
      endTurn: validTurn(u.endTurn) ? u.endTurn : Math.max(0, turnCount - 1),
    }))
    .filter((u) => u.endTurn >= u.startTurn);

  return {
    callId,
    agentId,
    overallScore: weightedOverall(kpiScores),
    kpiScores,
    deviations,
    useActions,
    summary: raw.summary ?? '',
  };
}

/** Score one call: transcript + agent goal → CallAnalysis (Claude Agent SDK). */
export async function scoreCall(input: ScoreInput): Promise<CallAnalysis> {
  const raw = await runStructured<RawScoring>({
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(input),
    schema: SCORING_SCHEMA as unknown as Record<string, unknown>,
  });
  return assembleAnalysis(input.callId, input.agentId, raw, input.turns.length);
}
