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
  /** True once this fix has been written to the live agent (persisted on the server). */
  applied?: boolean;
  appliedAt?: string;
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

// ─── Lead + observability signals (mirrors server/src/analysis/types.ts) ──────

export type BookingStatus = 'booked' | 'not_booked' | 'reschedule' | 'cancelled' | 'unknown';

/** Provenance of a lead's FACT fields: 'ghl' = native extractedData (ground-truth), 'llm' = inferred. */
export type LeadSource = 'ghl' | 'llm';

/**
 * Per-call lead facts + the two observability signals (R2.3 missed opportunity,
 * R2.6 human action needed). `source` flags whether the facts came from the agent's
 * native `extractedData` (GHL-confirmed) or were inferred by the LLM; `native` holds the
 * raw extractedData blob when present.
 *
 * The server's CallLead also carries `extraction` (the verbatim LLM LeadExtraction);
 * it is intentionally NOT surfaced client-side — provenance is shown via `source` + the
 * `native` blob, so the raw LLM extraction would be redundant in the UI.
 */
export interface CallLead {
  callId: string;
  locationId: string;
  agentId?: string;
  contactId?: string;
  callerName?: string;
  phone?: string;
  email?: string;
  problem?: string;
  treatment?: string;
  bookingStatus: BookingStatus;
  bookedAt?: string;
  confirmed: boolean;
  missedOpportunity: boolean;
  missedOpportunityReason?: string;
  humanActionNeeded: boolean;
  humanActionReason?: string;
  source: LeadSource;
  native?: Record<string, unknown> | null;
  createdAt?: string;
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

/**
 * Auth header for the read API. The backend injects `window.__API_TOKEN__` into the
 * served SPA at runtime (it's never in git); we echo it as a bearer token so the
 * token-guarded `/api/*` accepts the request. Absent in local dev (API open).
 */
function apiHeaders(): HeadersInit {
  const token = window.__API_TOKEN__;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(url: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...options,
    headers: { ...apiHeaders(), ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    // Surface the server's JSON `error` message when present (e.g. 409 conflicts).
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed?.error) detail = parsed.error;
    } catch {
      /* not JSON — use the raw text */
    }
    throw new Error(detail || `API ${res.status} from ${url}`);
  }
  return res.json();
}

/** POST `body` as JSON to a token-guarded API route. */
function apiPost(url: string, body: unknown): Promise<unknown> {
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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

export interface AgentInfo {
  id: string;
  name: string;
}

export async function fetchAgents(locationId: string): Promise<AgentInfo[]> {
  const data = await apiFetch(`/api/agents?locationId=${encodeURIComponent(locationId)}`);
  const obj = assertObject(data, 'AgentsResponse');
  return assertArray(obj.agents, 'agents').map((item, i) => {
    const a = assertObject(item, `agents[${i}]`);
    const id = assertString(a.id, `agents[${i}].id`);
    return { id, name: typeof a.name === 'string' && a.name ? a.name : id };
  });
}

export async function fetchRecommendations(params: {
  locationId: string;
  agentId?: string;
  limit?: number;
  /** Force a fresh Opus synthesis (bypass the server-side cache). */
  refresh?: boolean;
}): Promise<AgentRecommendations> {
  const qs = new URLSearchParams({ locationId: params.locationId });
  if (params.agentId) qs.set('agentId', params.agentId);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.refresh) qs.set('refresh', '1');
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

/** The Opus-generated revised prompt for one recommendation, plus its before-state. */
export interface RecommendationPreview {
  agentId: string;
  index: number;
  recommendation: Recommendation;
  /** The agent's live prompt the revision was built on (the apply baseline). */
  currentPrompt: string;
  /** The complete revised prompt to write if the operator confirms. */
  revisedPrompt: string;
  /** One-sentence description of what changed. */
  changeSummary: string;
}

/**
 * Step 1 of Apply: ask the server to generate the revised agent prompt for one
 * recommendation. No write happens — the result is shown for confirmation.
 */
export async function previewRecommendation(params: {
  locationId: string;
  agentId: string;
  index: number;
}): Promise<RecommendationPreview> {
  const data = await apiPost(
    `/api/agents/${encodeURIComponent(params.agentId)}/recommendations/${params.index}/preview`,
    { locationId: params.locationId },
  );
  const obj = assertObject(data, 'RecommendationPreview');
  return {
    agentId: assertString(obj.agentId ?? params.agentId, 'agentId'),
    index: typeof obj.index === 'number' ? obj.index : params.index,
    recommendation: obj.recommendation as Recommendation,
    currentPrompt: assertString(obj.currentPrompt, 'currentPrompt'),
    revisedPrompt: assertString(obj.revisedPrompt, 'revisedPrompt'),
    changeSummary: typeof obj.changeSummary === 'string' ? obj.changeSummary : '',
  };
}

export interface ApplyResult {
  ok: boolean;
  actionsPreserved: boolean;
  beforeActions: number;
  afterActions: number;
  updatedPrompt: string;
}

/**
 * Step 2 of Apply: write the previewed prompt to the live agent. `baselinePrompt`
 * lets the server reject the write (409) if the agent's prompt changed since preview.
 * Updates are serialized server-side (one agent write at a time).
 */
export async function applyRecommendation(params: {
  locationId: string;
  agentId: string;
  revisedPrompt: string;
  baselinePrompt: string;
  /** Index of the recommendation in the report — so the server can persist its applied flag. */
  index: number;
}): Promise<ApplyResult> {
  const data = await apiPost(`/api/agents/${encodeURIComponent(params.agentId)}/apply`, {
    locationId: params.locationId,
    revisedPrompt: params.revisedPrompt,
    baselinePrompt: params.baselinePrompt,
    index: params.index,
  });
  const obj = assertObject(data, 'ApplyResult');
  return {
    ok: obj.ok === true,
    actionsPreserved: obj.actionsPreserved !== false,
    beforeActions: Number(obj.beforeActions ?? 0),
    afterActions: Number(obj.afterActions ?? 0),
    updatedPrompt: typeof obj.updatedPrompt === 'string' ? obj.updatedPrompt : '',
  };
}

// ─── Leads + observability signals ───────────────────────────────────────────

const BOOKING_STATUSES: BookingStatus[] = [
  'booked',
  'not_booked',
  'reschedule',
  'cancelled',
  'unknown',
];

function validateLead(data: unknown): CallLead {
  const o = assertObject(data, 'CallLead');
  const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const bookingStatus = BOOKING_STATUSES.includes(o.bookingStatus as BookingStatus)
    ? (o.bookingStatus as BookingStatus)
    : 'unknown';
  return {
    callId: assertString(o.callId, 'callId'),
    locationId: typeof o.locationId === 'string' ? o.locationId : '',
    agentId: optStr(o.agentId),
    contactId: optStr(o.contactId),
    callerName: optStr(o.callerName),
    phone: optStr(o.phone),
    email: optStr(o.email),
    problem: optStr(o.problem),
    treatment: optStr(o.treatment),
    bookingStatus,
    bookedAt: optStr(o.bookedAt),
    confirmed: o.confirmed === true,
    missedOpportunity: o.missedOpportunity === true,
    missedOpportunityReason: optStr(o.missedOpportunityReason),
    humanActionNeeded: o.humanActionNeeded === true,
    humanActionReason: optStr(o.humanActionReason),
    source: o.source === 'ghl' ? 'ghl' : 'llm',
    native:
      o.native && typeof o.native === 'object' && !Array.isArray(o.native)
        ? (o.native as Record<string, unknown>)
        : null,
  };
}

/** One call's lead facts + signals. Returns null when no lead was stored for the call. */
export async function fetchLead(callId: string): Promise<CallLead | null> {
  const res = await fetch(`/api/leads/${encodeURIComponent(callId)}`, { headers: apiHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`API ${res.status} from /api/leads/${callId}: ${await res.text().catch(() => '')}`);
  }
  return validateLead(await res.json());
}

/** Leads for a location, optionally scoped to an agent and/or filtered by signal. */
export async function fetchLeads(params: {
  locationId: string;
  agentId?: string;
  missedOpportunity?: boolean;
  humanActionNeeded?: boolean;
  limit?: number;
}): Promise<CallLead[]> {
  const qs = new URLSearchParams({ locationId: params.locationId });
  if (params.agentId) qs.set('agentId', params.agentId);
  if (params.missedOpportunity) qs.set('missedOpportunity', '1');
  if (params.humanActionNeeded) qs.set('humanActionNeeded', '1');
  if (params.limit) qs.set('limit', String(params.limit));
  const data = await apiFetch(`/api/leads?${qs}`);
  const obj = assertObject(data, 'LeadsResponse');
  return assertArray(obj.leads, 'leads').map(validateLead);
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

/** Short, readable form of an opaque agent id — used as secondary/traceability text. */
export function shortId(agentId: string): string {
  return agentId.length > 10 ? `${agentId.slice(0, 8)}…` : agentId;
}

/** Fallback label when no resolved name is available (renders the unassigned sentinel readably). */
export function agentLabel(agentId: string): string {
  return agentId === UNASSIGNED_AGENT ? 'Unassigned' : shortId(agentId);
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

// ─── Lead presentation helpers ────────────────────────────────────────────────

const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  booked: 'Booked',
  not_booked: 'Not booked',
  reschedule: 'Reschedule',
  cancelled: 'Cancelled',
  unknown: 'Unknown',
};

export function bookingStatusLabel(status: BookingStatus): string {
  return BOOKING_STATUS_LABELS[status] ?? status;
}

/** CSS modifier suffix for a booking status pill (drives color). */
export function bookingStatusClass(status: BookingStatus): string {
  if (status === 'booked') return 'booked';
  if (status === 'cancelled' || status === 'not_booked') return 'negative';
  return 'neutral';
}

/** Human label for fact provenance — what the user sees on the source badge. */
export function sourceLabel(source: LeadSource): string {
  return source === 'ghl' ? 'GHL-confirmed' : 'Inferred';
}

/** Count the two observability signals across a set of leads (drives agent/overview tallies). */
export function countSignals(leads: CallLead[]): { missed: number; human: number } {
  let missed = 0;
  let human = 0;
  for (const l of leads) {
    if (l.missedOpportunity) missed += 1;
    if (l.humanActionNeeded) human += 1;
  }
  return { missed, human };
}
