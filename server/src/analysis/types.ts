/**
 * Shared contracts for the observability engine: transcript → KPI scores →
 * deviations + reviewable segments. Kept dependency-free so both the parser and
 * the LLM scorer build on the same shapes.
 */

/** Normalized speaker. HighLevel uses `bot`/`human`; we map to these. */
export type Speaker = 'agent' | 'caller';

/** One continuous utterance by a single speaker (consecutive raw lines merged). */
export interface Turn {
  /** 0-based position in the conversation. */
  index: number;
  speaker: Speaker;
  text: string;
}

/**
 * The observability parameters (R2.2 / A-004). Transcript-derivable only — timing
 * KPIs (dead-air/latency) are intentionally absent because the transcript carries
 * no timestamps (see A-003). Data-driven so the set is cheap to change.
 */
export type KpiKey =
  | 'script_adherence'
  | 'goal_completion'
  | 'info_capture'
  | 'objection_handling'
  | 'sentiment'
  | 'accuracy';

export interface KpiDefinition {
  key: KpiKey;
  label: string;
  /** One-line statement of what this measures. */
  description: string;
  /** Anchors for the 0–100 scale, used by the LLM scorer's rubric. */
  rubric: string;
  /** Relative importance when computing the overall score. */
  weight: number;
}

/** A single KPI's score for one call. */
export interface KpiScore {
  key: KpiKey;
  /** 0–100. */
  score: number;
  rationale: string;
  /** Turn indices that justify the score (drives "jump to evidence" in the UI). */
  evidence: number[];
}

export type Severity = 'low' | 'medium' | 'high';

/** A specific failure / deviation from the agent's goal or script. */
export interface Deviation {
  severity: Severity;
  /** KPI this maps to, or 'general' when it spans several. */
  kpi: KpiKey | 'general';
  description: string;
  /** Turn index where it occurred, when localizable. */
  turnIndex?: number;
}

/**
 * A reviewable conversation segment — the "Use Actions" feature (R2.6 / A-005):
 * a span of turns worth a human's attention, with why.
 */
export interface UseAction {
  label: string;
  reason: string;
  startTurn: number;
  endTurn: number;
}

/** What kind of change a recommendation asks the operator to make. */
export type RecommendationKind = 'prompt' | 'script' | 'configuration' | 'process';

/**
 * One actionable fix for an agent, synthesized across its call history (R2.5).
 * The unit the dashboard surfaces next to the failing KPI (UX-003): problem +
 * concrete fix + the calls that evidence it.
 */
export interface Recommendation {
  /** Short title of the issue this addresses. */
  title: string;
  kind: RecommendationKind;
  /** How much this matters — reuses the deviation severity scale. */
  priority: Severity;
  /** The KPI this most improves, or 'general' when it spans several. */
  kpi: KpiKey | 'general';
  /** What's going wrong, grounded in the call history. */
  problem: string;
  /** The concrete change to make — a copy-pasteable prompt/script edit where possible. */
  fix: string;
  /** Why this should help / the expected impact. */
  rationale: string;
  /** Call ids that evidence the problem (drives "jump to the calls"). */
  evidenceCallIds: string[];
}

/** Per-KPI average over an agent's calls — the aggregate the synthesis reasons over. */
export interface KpiAverageSnapshot {
  key: KpiKey;
  avgScore: number;
  calls: number;
}

/**
 * The recommendations report for one agent — the output of the cross-call synthesis
 * (R2.5) and the input to the dashboard's "recommendations for this agent" view (D2).
 */
export interface AgentRecommendations {
  agentId: string | null;
  /** How many scored calls fed the synthesis. */
  callsAnalyzed: number;
  /** The KPI averages the synthesis was given (weakest first). */
  kpiAverages: KpiAverageSnapshot[];
  recommendations: Recommendation[];
  /** Overall narrative for the agent's performance. */
  summary: string;
}

/** The full analysis of one call — the scorer's output and the dashboard's input. */
export interface CallAnalysis {
  callId: string;
  agentId?: string;
  /** Weighted 0–100 across KPIs. */
  overallScore: number;
  kpiScores: KpiScore[];
  deviations: Deviation[];
  useActions: UseAction[];
  /** Short, human-readable verdict for the call. */
  summary: string;
}
