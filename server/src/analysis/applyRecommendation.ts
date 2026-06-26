import { runStructured, CLAUDE_MODEL } from '../llm/agent.js';
import type { Recommendation } from './types.js';

/**
 * Turning a recommendation into an agent-prompt edit (the "Apply" action).
 *
 * A recommendation's `fix` is an EDIT INSTRUCTION ("add a line that…", "tighten the
 * booking step to…"), not a drop-in replacement prompt. To apply it we hand the
 * agent's CURRENT full prompt plus the recommendation to Opus and ask for the
 * COMPLETE revised prompt with the fix integrated — preserving everything else.
 * The result is shown to the operator for confirmation before it's ever written.
 */

export interface RevisedPrompt {
  /** The complete, ready-to-write agent prompt with the recommendation integrated. */
  revisedPrompt: string;
  /** One sentence describing what changed (drives the diff header in the UI). */
  changeSummary: string;
}

export const REVISE_PROMPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['revisedPrompt', 'changeSummary'],
  properties: {
    revisedPrompt: { type: 'string' },
    changeSummary: { type: 'string' },
  },
} as const;

export function buildReviseSystemPrompt(): string {
  return [
    'You are a careful prompt editor for a Voice AI calling agent. You are given the',
    "agent's CURRENT full system prompt and ONE improvement recommendation (its problem,",
    'the suggested fix, and the rationale). Return the COMPLETE revised prompt with the',
    'recommendation integrated.',
    '',
    'Rules:',
    '- Output the ENTIRE prompt, not a diff, summary, or fragment. It must be ready to save as-is.',
    '- Make the MINIMAL edit that fully addresses the fix. Do not rewrite or restyle unrelated parts.',
    '- Preserve all existing content, structure, headings, facts, and guardrails unless the',
    '  recommendation specifically changes them. Never drop factual content (hours, pricing,',
    '  services, insurance) or safety guardrails that are unrelated to the fix.',
    '- Integrate the change in the most natural place (extend the relevant section), rather',
    '  than blindly appending a note at the end.',
    "- The fix may be phrased as advice; translate it into concrete prompt language in the agent's",
    '  own voice and formatting. Do not address the agent in the second person about "the fix".',
    '- `changeSummary`: ONE sentence stating what you changed, for the operator to review.',
  ].join('\n');
}

export function buildReviseUserPrompt(currentPrompt: string, rec: Recommendation): string {
  return [
    'CURRENT AGENT PROMPT:',
    '"""',
    currentPrompt.trim(),
    '"""',
    '',
    'RECOMMENDATION TO APPLY:',
    `- Title: ${rec.title}`,
    `- Kind: ${rec.kind}`,
    `- Targets KPI: ${rec.kpi}`,
    `- Problem: ${rec.problem}`,
    `- Suggested fix: ${rec.fix}`,
    `- Rationale: ${rec.rationale}`,
    '',
    'Return the complete revised prompt and a one-sentence change summary.',
  ].join('\n');
}

/** Generate the revised full prompt for one recommendation (Opus; no side effects). */
export async function revisePromptForRecommendation(opts: {
  currentPrompt: string;
  recommendation: Recommendation;
}): Promise<RevisedPrompt> {
  const raw = await runStructured<RevisedPrompt>({
    system: buildReviseSystemPrompt(),
    prompt: buildReviseUserPrompt(opts.currentPrompt, opts.recommendation),
    schema: REVISE_PROMPT_SCHEMA as unknown as Record<string, unknown>,
    // Editing a production prompt safely is a reasoning task — use Opus (the default).
    model: CLAUDE_MODEL,
  });
  return {
    revisedPrompt: (raw.revisedPrompt ?? '').trim(),
    changeSummary: raw.changeSummary ?? '',
  };
}
