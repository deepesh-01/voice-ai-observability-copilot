import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';

/**
 * Claude access via the Claude Agent SDK (NOT a bare Messages-API key).
 * Auth comes from CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`), which the
 * SDK reads from the environment — config.ts loads it from .env into process.env.
 */
export const CLAUDE_MODEL = 'claude-opus-4-8';

/**
 * Run a single structured-output generation: a custom system prompt + one user
 * prompt, constrained to `schema`, returning the parsed object. No tools, one turn
 * — this is an LLM judge call, not an agent loop.
 */
export async function runStructured<T>(opts: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  model?: string;
}): Promise<T> {
  if (!config.claudeOAuthToken) {
    throw new Error(
      'No Claude credentials — set CLAUDE_CODE_OAUTH_TOKEN in .env (run `claude setup-token`).',
    );
  }

  const run = query({
    prompt: opts.prompt,
    options: {
      model: opts.model ?? CLAUDE_MODEL,
      systemPrompt: opts.system,
      outputFormat: { type: 'json_schema', schema: opts.schema },
      // No tools (pure LLM judge), but allow a few turns — structured-output
      // validation/retries consume turns, so maxTurns:1 fails with error_max_turns.
      maxTurns: 6,
      allowedTools: [],
    },
  });

  for await (const message of run) {
    if (message.type !== 'result') continue;
    if (message.subtype !== 'success') {
      throw new Error(`Claude run did not succeed: ${message.subtype}`);
    }
    if (message.structured_output != null) {
      return message.structured_output as T;
    }
    // Fallback: parse the text result if structured_output wasn't populated.
    return JSON.parse(message.result) as T;
  }
  throw new Error('Claude run produced no result message.');
}
