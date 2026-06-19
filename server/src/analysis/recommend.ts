import { runStructured, CLAUDE_MODEL } from '../llm/agent.js';
import { getAgentPrompt } from '../ghl/api.js';
import { analysisRepo, UNASSIGNED_AGENT, type AnalysisRepository } from '../store/analysisRepository.js';
import { KPI_BY_KEY, KPI_KEYS } from './kpis.js';
import type {
  AgentRecommendations,
  CallAnalysis,
  KpiAverageSnapshot,
  KpiKey,
  Recommendation,
  RecommendationKind,
  Severity,
} from './types.js';

const KINDS: RecommendationKind[] = ['prompt', 'script', 'configuration', 'process'];
const PRIORITIES: Severity[] = ['low', 'medium', 'high'];
const KPI_OR_GENERAL = [...KPI_KEYS, 'general'];

/** The agent goal used when the configured prompt couldn't be fetched. */
const NO_GOAL =
  'No agent prompt available — judge against general call-quality best practices.';

/** Inputs to a synthesis run, gathered from storage by `recommendForAgent`. */
export interface RecommendInput {
  agentId: string | null;
  /** The agent's configured goal/prompt — fixes are framed as edits to THIS. */
  agentGoal: string;
  /** Per-KPI averages over the agent's calls (any order; rendered weakest-first). */
  kpiAverages: KpiAverageSnapshot[];
  /** Recent scored calls — the evidence (deviations, summaries) to generalize from. */
  analyses: CallAnalysis[];
}

/** The shape the LLM is constrained to return (pre-assembly). */
interface RawRecommendations {
  recommendations: {
    title: string;
    kind: string;
    priority: string;
    kpi: string;
    problem: string;
    fix: string;
    rationale: string;
    evidenceCallIds: string[];
  }[];
  summary: string;
}

/** JSON-schema for structured output. Value constraints are enforced in assembleRecommendations. */
export const RECOMMEND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recommendations', 'summary'],
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'priority', 'kpi', 'problem', 'fix', 'rationale', 'evidenceCallIds'],
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          priority: { type: 'string', enum: PRIORITIES },
          kpi: { type: 'string', enum: KPI_OR_GENERAL },
          problem: { type: 'string' },
          fix: { type: 'string' },
          rationale: { type: 'string' },
          evidenceCallIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    summary: { type: 'string' },
  },
} as const;

export function buildRecommendSystemPrompt(): string {
  const kpiLines = KPI_KEYS.map((k) => `- ${k} (${KPI_BY_KEY[k].label}): ${KPI_BY_KEY[k].description}`).join('\n');
  return [
    'You are a Voice AI optimization coach for a calling product.',
    "You are given ONE agent's configured goal/prompt, its KPI averages across many",
    'calls, and the concrete deviations observed on recent calls. Your job is to turn',
    'those recurring failures into a SHORT list of concrete, actionable fixes the',
    'operator can apply to improve the agent — R2.5.',
    '',
    'KPIs in play:',
    kpiLines,
    '',
    'Rules:',
    '- Prioritize by impact: target the weakest KPIs and the most frequent deviations first.',
    '- Each recommendation must be ACTIONABLE. For `kind:"prompt"` or `"script"`, the `fix`',
    '  should be a copy-pasteable instruction or line to add/change in the agent prompt —',
    '  not vague advice like "be clearer".',
    '- Ground every recommendation in the evidence. Put the call ids that demonstrate the',
    '  problem in `evidenceCallIds` (use ids that appear in the data below).',
    '- Do NOT invent problems. If a KPI is already strong, do not recommend changes to it.',
    '- Prefer 2–5 high-leverage recommendations over an exhaustive list.',
    '- `summary`: 1–2 sentences on the agent\'s overall performance and the single biggest win.',
  ].join('\n');
}

/**
 * Render the gathered evidence into the synthesis prompt. Pure + total so it can be
 * unit-tested and kept bounded (caps the per-KPI deviation examples it lists).
 */
export function buildEvidenceDigest(input: RecommendInput): string {
  const averages = [...input.kpiAverages].sort((a, b) => a.avgScore - b.avgScore);

  // Group deviations across calls by KPI to surface RECURRING patterns, not one-offs.
  const byKpi = new Map<string, { count: number; examples: string[] }>();
  for (const a of input.analyses) {
    for (const d of a.deviations) {
      const bucket = byKpi.get(d.kpi) ?? { count: 0, examples: [] };
      bucket.count += 1;
      if (bucket.examples.length < 4) {
        bucket.examples.push(`[${a.callId}] (${d.severity}) ${d.description}`);
      }
      byKpi.set(d.kpi, bucket);
    }
  }
  const recurring = [...byKpi.entries()].sort((a, b) => b[1].count - a[1].count);

  const lines: string[] = [];
  lines.push("AGENT'S CONFIGURED GOAL / PROMPT:");
  lines.push(input.agentGoal.trim());
  lines.push('');
  lines.push(`KPI AVERAGES (over ${input.analyses.length} calls, weakest first):`);
  if (averages.length === 0) {
    lines.push('- (no KPI averages available)');
  } else {
    for (const k of averages) lines.push(`- ${k.key}: ${k.avgScore}/100 (${k.calls} calls)`);
  }
  lines.push('');
  lines.push('RECURRING DEVIATIONS (grouped by KPI, most frequent first):');
  if (recurring.length === 0) {
    lines.push('- (no deviations recorded)');
  } else {
    for (const [kpi, info] of recurring) {
      lines.push(`- ${kpi} — ${info.count} occurrence(s):`);
      for (const ex of info.examples) lines.push(`    ${ex}`);
    }
  }
  lines.push('');
  lines.push('PER-CALL SUMMARIES (for citing evidence by call id):');
  for (const a of input.analyses) {
    lines.push(`- [${a.callId}] overall ${a.overallScore}/100 — ${a.summary}`);
  }
  return lines.join('\n');
}

/** Turn a (possibly imperfect) LLM result into a validated AgentRecommendations. Pure + total. */
export function assembleRecommendations(
  agentId: string | null,
  raw: RawRecommendations,
  kpiAverages: KpiAverageSnapshot[],
  callsAnalyzed: number,
  validCallIds: Set<string>,
): AgentRecommendations {
  const recommendations: Recommendation[] = (raw.recommendations ?? []).map((r) => ({
    title: r.title ?? '',
    kind: KINDS.includes(r.kind as RecommendationKind) ? (r.kind as RecommendationKind) : 'prompt',
    priority: PRIORITIES.includes(r.priority as Severity) ? (r.priority as Severity) : 'medium',
    kpi: r.kpi in KPI_BY_KEY ? (r.kpi as KpiKey) : 'general',
    problem: r.problem ?? '',
    fix: r.fix ?? '',
    rationale: r.rationale ?? '',
    // Keep only ids we actually have — never surface a hallucinated call reference.
    evidenceCallIds: [...new Set((r.evidenceCallIds ?? []).filter((id) => validCallIds.has(id)))],
  }));

  return {
    agentId,
    callsAnalyzed,
    kpiAverages: [...kpiAverages].sort((a, b) => a.avgScore - b.avgScore),
    recommendations,
    summary: raw.summary ?? '',
  };
}

/** Run the cross-call synthesis given already-gathered evidence (Claude Agent SDK, Opus). */
export async function synthesizeRecommendations(input: RecommendInput): Promise<AgentRecommendations> {
  const validCallIds = new Set(input.analyses.map((a) => a.callId));
  const raw = await runStructured<RawRecommendations>({
    system: buildRecommendSystemPrompt(),
    prompt: buildEvidenceDigest(input),
    schema: RECOMMEND_SCHEMA as unknown as Record<string, unknown>,
    // Per ADR-0002 routing: deeper cross-call synthesis runs on Opus (the default).
    model: CLAUDE_MODEL,
  });
  return assembleRecommendations(
    input.agentId,
    raw,
    input.kpiAverages,
    input.analyses.length,
    validCallIds,
  );
}

export interface RecommendForAgentOptions {
  locationId: string;
  agentId?: string;
  /** How many recent calls to feed the synthesis (default 50). */
  limit?: number;
  /** Bypass the cache and re-synthesize (the dashboard's "Refresh" action). */
  force?: boolean;
  repo?: AnalysisRepository;
}

/**
 * End-to-end (R2.5): synthesize concrete fixes for an agent from its stored calls.
 *
 * Cached in Postgres keyed by agent + the scored-call count it was built from: the
 * slow/paid Opus synthesis only runs on a cache miss (new calls since, or `force`).
 * Returns an empty report (no LLM call) when the agent has no scored calls yet.
 */
export async function recommendForAgent(opts: RecommendForAgentOptions): Promise<AgentRecommendations> {
  const repo = opts.repo ?? analysisRepo;
  // The unassigned-bucket sentinel is not a real agent id — report it as null and
  // never try to fetch a configured prompt for it.
  const isRealAgent = opts.agentId != null && opts.agentId !== UNASSIGNED_AGENT;
  const agentId = isRealAgent ? opts.agentId! : null;
  const agentKey = opts.agentId ?? ''; // '' = location-wide cache key

  const callCount = await repo.countCalls({ locationId: opts.locationId, agentId: opts.agentId });
  if (callCount === 0) {
    return { agentId, callsAnalyzed: 0, kpiAverages: [], recommendations: [], summary: 'No scored calls yet for this agent.' };
  }

  // Cache hit: same call count → the synthesis is still current.
  if (!opts.force) {
    const cached = await repo.getRecommendations({ locationId: opts.locationId, agentKey });
    if (cached && cached.basedOnCalls === callCount) return cached.report;
  }

  const [analyses, averagesRaw] = await Promise.all([
    repo.recentAnalyses({ locationId: opts.locationId, agentId: opts.agentId, limit: opts.limit }),
    repo.kpiAverages({ locationId: opts.locationId, agentId: opts.agentId }),
  ]);

  const kpiAverages: KpiAverageSnapshot[] = averagesRaw
    .filter((a) => a.kpiKey in KPI_BY_KEY)
    .map((a) => ({ key: a.kpiKey as KpiKey, avgScore: a.avgScore, calls: a.calls }));

  const agentGoal = (isRealAgent ? await getAgentPrompt(opts.agentId!, opts.locationId) : undefined) ?? NO_GOAL;

  const report = await synthesizeRecommendations({ agentId, agentGoal, kpiAverages, analyses });
  await repo.saveRecommendations({ locationId: opts.locationId, agentKey, basedOnCalls: callCount, report });
  return report;
}
