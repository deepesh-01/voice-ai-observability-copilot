/**
 * Typed API client for the Voice AI Observability backend.
 * Mirrors server/src/analysis/types.ts and server/src/store/analysisRepository.ts.
 * All fetch paths are relative — they proxy through Vite (dev) or the same origin (prod).
 */

// ─── Core domain types (mirrors server/src/analysis/types.ts) ─────────────────

export type Speaker = 'agent' | 'caller';

export interface Turn {
  index: number;
  speaker: Speaker;
  text: string;
}

export type KpiKey =
  | 'script_adherence'
  | 'goal_completion'
  | 'info_capture'
  | 'objection_handling'
  | 'sentiment'
  | 'accuracy';

export const KPI_LABELS: Record<KpiKey, string> = {
  script_adherence: 'Script Adherence',
  goal_completion: 'Goal Completion',
  info_capture: 'Info Capture',
  objection_handling: 'Objection Handling',
  sentiment: 'Sentiment',
  accuracy: 'Accuracy',
};

export interface KpiScore {
  key: KpiKey;
  score: number;
  rationale: string;
  evidence: number[];
}

export type Severity = 'low' | 'medium' | 'high';

export interface Deviation {
  severity: Severity;
  kpi: KpiKey | 'general';
  description: string;
  turnIndex?: number;
}

export interface UseAction {
  label: string;
  reason: string;
  startTurn: number;
  endTurn: number;
}

export type RecommendationKind = 'prompt' | 'script' | 'configuration' | 'process';

export interface Recommendation {
  title: string;
  kind: RecommendationKind;
  priority: Severity;
  kpi: KpiKey | 'general';
  problem: string;
  fix: string;
  rationale: string;
  evidenceCallIds: string[];
}

export interface CallAnalysis {
  callId: string;
  agentId?: string;
  overallScore: number;
  kpiScores: KpiScore[];
  deviations: Deviation[];
  useActions: UseAction[];
  summary: string;
}

// ─── Repository shapes (mirrors server/src/store/analysisRepository.ts) ───────

export interface CallSummary {
  callId: string;
  agentId?: string;
  overallScore: number;
  summary: string;
  durationSec?: number;
  callAt?: string;
}

export interface StoredCall {
  analysis: CallAnalysis;
  locationId: string;
  durationSec?: number;
  callAt?: string;
  rawCall: unknown;
}

export interface KpiAverage {
  agentId: string | null;
  kpiKey: string;
  avgScore: number;
  calls: number;
}

// ─── Recommendations report ────────────────────────────────────────────────────

export interface KpiAverageSnapshot {
  key: string;
  avgScore: number;
  calls: number;
}

export interface AgentRecommendations {
  agentId: string | null;
  callsAnalyzed: number;
  kpiAverages: KpiAverageSnapshot[];
  recommendations: Recommendation[];
  summary: string;
}

// ─── Derived: Agent aggregate for the overview ────────────────────────────────

export interface AgentSummary {
  agentId: string;
  callCount: number;
  avgScore: number;
  /** KPI averages for this agent — sorted weakest first */
  kpiAverages: KpiAverage[];
}

// ─── API response envelopes ───────────────────────────────────────────────────

interface InstallsResponse {
  installs: string[];
}

interface AnalysesResponse {
  analyses: CallSummary[];
}

interface KpiAveragesResponse {
  averages: KpiAverage[];
}

// ─── Schema validation (fail loud in dev) ────────────────────────────────────

function assertString(val: unknown, field: string): string {
  if (typeof val !== 'string') throw new Error(`Schema mismatch: ${field} is not a string`);
  return val;
}

function assertArray(val: unknown, field: string): unknown[] {
  if (!Array.isArray(val)) throw new Error(`Schema mismatch: ${field} is not an array`);
  return val;
}

function assertObject(val: unknown, field: string): Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val))
    throw new Error(`Schema mismatch: ${field} is not an object`);
  return val as Record<string, unknown>;
}

function validateInstallsResponse(data: unknown): InstallsResponse {
  const obj = assertObject(data, 'InstallsResponse');
  return { installs: assertArray(obj.installs, 'installs') as string[] };
}

function validateAnalysesResponse(data: unknown): AnalysesResponse {
  const obj = assertObject(data, 'AnalysesResponse');
  const analyses = assertArray(obj.analyses, 'analyses');
  return {
    analyses: analyses.map((item, i) => {
      const a = assertObject(item, `analyses[${i}]`);
      return {
        callId: assertString(a.callId, `analyses[${i}].callId`),
        agentId: typeof a.agentId === 'string' ? a.agentId : undefined,
        overallScore: Number(a.overallScore),
        summary: assertString(a.summary, `analyses[${i}].summary`),
        durationSec: typeof a.durationSec === 'number' ? a.durationSec : undefined,
        callAt: typeof a.callAt === 'string' ? a.callAt : undefined,
      };
    }),
  };
}

function validateKpiAveragesResponse(data: unknown): KpiAveragesResponse {
  const obj = assertObject(data, 'KpiAveragesResponse');
  const averages = assertArray(obj.averages, 'averages');
  return {
    averages: averages.map((item, i) => {
      const a = assertObject(item, `averages[${i}]`);
      return {
        agentId: typeof a.agentId === 'string' ? a.agentId : null,
        kpiKey: assertString(a.kpiKey, `averages[${i}].kpiKey`),
        avgScore: Number(a.avgScore),
        calls: Number(a.calls),
      };
    }),
  };
}

function validateStoredCall(data: unknown): StoredCall {
  const obj = assertObject(data, 'StoredCall');
  const analysis = assertObject(obj.analysis, 'analysis');
  return {
    analysis: {
      callId: assertString(analysis.callId, 'analysis.callId'),
      agentId: typeof analysis.agentId === 'string' ? analysis.agentId : undefined,
      overallScore: Number(analysis.overallScore),
      summary: assertString(analysis.summary, 'analysis.summary'),
      kpiScores: Array.isArray(analysis.kpiScores) ? (analysis.kpiScores as KpiScore[]) : [],
      deviations: Array.isArray(analysis.deviations) ? (analysis.deviations as Deviation[]) : [],
      useActions: Array.isArray(analysis.useActions) ? (analysis.useActions as UseAction[]) : [],
    },
    locationId: assertString(obj.locationId, 'locationId'),
    durationSec: typeof obj.durationSec === 'number' ? obj.durationSec : undefined,
    callAt: typeof obj.callAt === 'string' ? obj.callAt : undefined,
    rawCall: obj.rawCall,
  };
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function apiFetch(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API ${res.status} from ${url}: ${await res.text().catch(() => '')}`);
  }
  return res.json();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchInstalls(): Promise<string[]> {
  const data = await apiFetch('/api/installs');
  return validateInstallsResponse(data).installs;
}

export async function fetchInstallStatus(key: string): Promise<{
  key: string;
  connected?: boolean;
  voiceAiScopeOk?: boolean;
  detail?: string;
}> {
  const data = await apiFetch(`/api/installs/${encodeURIComponent(key)}/status`);
  const obj = assertObject(data, 'InstallStatus');
  return {
    key: assertString(obj.key ?? key, 'key'),
    connected: typeof obj.connected === 'boolean' ? obj.connected : undefined,
    voiceAiScopeOk: typeof obj.voiceAiScopeOk === 'boolean' ? obj.voiceAiScopeOk : undefined,
    detail: typeof obj.detail === 'string' ? obj.detail : undefined,
  };
}

export async function fetchAnalyses(params: {
  locationId: string;
  agentId?: string;
  limit?: number;
}): Promise<CallSummary[]> {
  const qs = new URLSearchParams({ locationId: params.locationId });
  if (params.agentId) qs.set('agentId', params.agentId);
  if (params.limit) qs.set('limit', String(params.limit));
  const data = await apiFetch(`/api/analyses?${qs}`);
  return validateAnalysesResponse(data).analyses;
}

export async function fetchCall(callId: string): Promise<StoredCall> {
  const data = await apiFetch(`/api/analyses/${encodeURIComponent(callId)}`);
  return validateStoredCall(data);
}

export async function fetchKpiAverages(params: {
  locationId: string;
  agentId?: string;
}): Promise<KpiAverage[]> {
  const qs = new URLSearchParams({ locationId: params.locationId });
  if (params.agentId) qs.set('agentId', params.agentId);
  const data = await apiFetch(`/api/kpis/averages?${qs}`);
  return validateKpiAveragesResponse(data).averages;
}

export async function fetchRecommendations(params: {
  locationId: string;
  agentId?: string;
  limit?: number;
}): Promise<AgentRecommendations> {
  const qs = new URLSearchParams({ locationId: params.locationId });
  if (params.agentId) qs.set('agentId', params.agentId);
  if (params.limit) qs.set('limit', String(params.limit));
  const data = await apiFetch(`/api/recommendations?${qs}`);
  const obj = assertObject(data, 'AgentRecommendations');
  return {
    agentId: typeof obj.agentId === 'string' ? obj.agentId : null,
    callsAnalyzed: Number(obj.callsAnalyzed ?? 0),
    kpiAverages: Array.isArray(obj.kpiAverages) ? (obj.kpiAverages as KpiAverageSnapshot[]) : [],
    recommendations: Array.isArray(obj.recommendations)
      ? (obj.recommendations as Recommendation[])
      : [],
    summary: typeof obj.summary === 'string' ? obj.summary : '',
  };
}

// ─── Transcript parsing (mirrors server/src/analysis/transcript.ts exactly) ──

const SPEAKER_BY_PREFIX: Record<string, Speaker> = { bot: 'agent', human: 'caller' };

/**
 * Parse a HighLevel Voice AI transcript string into ordered turns.
 * Exact logic mirrors server/src/analysis/transcript.ts so evidence/turn indices align.
 */
export function parseTranscript(raw: unknown): Turn[] {
  if (!raw || typeof raw !== 'string') return [];

  const turns: Turn[] = [];

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const colon = line.indexOf(':');
    const prefix = colon === -1 ? '' : line.slice(0, colon).trim().toLowerCase();
    const speaker = SPEAKER_BY_PREFIX[prefix];

    if (!speaker) {
      const current = turns[turns.length - 1];
      if (current) current.text = `${current.text} ${line}`.trim();
      continue;
    }

    const text = line.slice(colon + 1).trim();
    const current = turns[turns.length - 1];
    if (current && current.speaker === speaker) {
      current.text = `${current.text} ${text}`.trim();
    } else {
      turns.push({ index: turns.length, speaker, text });
    }
  }

  return turns;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Reserved agentId for the "no agent attributed" bucket. MUST match the backend's
 * UNASSIGNED_AGENT (server/src/store/analysisRepository.ts) so drilling into it
 * resolves to SQL `agent_id IS NULL` instead of matching zero rows.
 */
export const UNASSIGNED_AGENT = '__unassigned__';

/** Human label for an agent id (renders the unassigned sentinel readably). */
export function agentLabel(agentId: string): string {
  return agentId === UNASSIGNED_AGENT ? 'Unassigned (no agent ID)' : agentId;
}

/** Derive an ordered agent list from calls + KPI averages. */
export function deriveAgents(calls: CallSummary[], kpiAverages: KpiAverage[]): AgentSummary[] {
  const agentMap = new Map<string, { totalScore: number; count: number }>();

  for (const call of calls) {
    const id = call.agentId ?? UNASSIGNED_AGENT;
    const existing = agentMap.get(id);
    if (existing) {
      existing.totalScore += call.overallScore;
      existing.count += 1;
    } else {
      agentMap.set(id, { totalScore: call.overallScore, count: 1 });
    }
  }

  return Array.from(agentMap.entries())
    .map(([agentId, { totalScore, count }]) => ({
      agentId,
      callCount: count,
      avgScore: Math.round(totalScore / count),
      kpiAverages: kpiAverages
        .filter((k) => k.agentId === agentId || (agentId === UNASSIGNED_AGENT && k.agentId === null))
        .sort((a, b) => a.avgScore - b.avgScore), // weakest first
    }))
    .sort((a, b) => b.callCount - a.callCount);
}

export function scoreColor(score: number): string {
  if (score >= 80) return 'var(--ok)';
  if (score >= 60) return 'var(--warn)';
  return '#dc2626';
}

export function scoreClass(score: number): string {
  if (score >= 80) return 'score-ok';
  if (score >= 60) return 'score-warn';
  return 'score-bad';
}

export function formatDuration(sec: number | undefined): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function kpiLabel(key: string): string {
  return KPI_LABELS[key as KpiKey] ?? key.replace(/_/g, ' ');
}
