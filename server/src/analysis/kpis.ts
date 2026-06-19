import type { KpiDefinition, KpiKey, KpiScore } from './types.js';

/**
 * The observability-parameter catalog (R2.2 / A-004).
 *
 * Each KPI is scored 0–100 by the LLM scorer against the `rubric` here, anchored
 * to the agent's own goal/script. Defined as data (not hard-coded prompts) so the
 * set and weights can change without touching the scoring pipeline.
 *
 * Deliberately transcript-derivable only — no dead-air/latency KPI, because the
 * transcript has no timestamps (A-003). Timing metrics would need recording data.
 */
export const KPI_CATALOG: readonly KpiDefinition[] = [
  {
    key: 'goal_completion',
    label: 'Goal completion',
    description: "Did the call achieve the agent's primary goal (e.g. booking made)?",
    rubric:
      '100 = the goal was fully achieved and confirmed; 50 = partial progress but not closed; 0 = goal abandoned or failed.',
    weight: 3,
  },
  {
    key: 'script_adherence',
    label: 'Script adherence',
    description: "Did the agent follow its configured flow/script steps in order?",
    rubric:
      '100 = followed every required step; 60 = minor skips/reordering; 0 = ignored the script entirely.',
    weight: 2,
  },
  {
    key: 'info_capture',
    label: 'Info capture',
    description: 'Did the agent collect the information its goal requires?',
    rubric:
      '100 = all required fields captured and confirmed; 50 = some captured; 0 = none captured.',
    weight: 2,
  },
  {
    key: 'accuracy',
    label: 'Accuracy / grounding',
    description: 'Did the agent stay factual and avoid inventing info or unkeepable promises?',
    rubric:
      '100 = fully grounded; 60 = vague but not wrong; 0 = hallucinated facts or made false promises.',
    weight: 2,
  },
  {
    key: 'objection_handling',
    label: 'Objection handling',
    description: 'How well did the agent handle hesitation, friction, or objections?',
    rubric:
      '100 = acknowledged and resolved objections smoothly; 50 = handled awkwardly; 0 = ignored or escalated friction. If no objection arose, score 100.',
    weight: 1.5,
  },
  {
    key: 'sentiment',
    label: 'Caller sentiment',
    description: "The caller's overall experience / sentiment trajectory.",
    rubric:
      '100 = caller clearly satisfied; 50 = neutral; 0 = caller frustrated or upset by the end.',
    weight: 1,
  },
] as const;

export const KPI_BY_KEY: Record<KpiKey, KpiDefinition> = Object.fromEntries(
  KPI_CATALOG.map((k) => [k.key, k]),
) as Record<KpiKey, KpiDefinition>;

export const KPI_KEYS: KpiKey[] = KPI_CATALOG.map((k) => k.key);

/**
 * Weighted average of KPI scores → an overall 0–100. Unknown keys are ignored;
 * an empty/zero-weight input yields 0. Rounded to the nearest integer.
 */
export function weightedOverall(scores: KpiScore[]): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const s of scores) {
    const def = KPI_BY_KEY[s.key];
    if (!def) continue;
    weighted += s.score * def.weight;
    totalWeight += def.weight;
  }
  return totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);
}
