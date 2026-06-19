import type { Speaker, Turn } from './types.js';

/**
 * Parse a HighLevel Voice AI transcript string into ordered turns.
 *
 * The API returns the transcript as a single newline-delimited string where each
 * line is `bot:<text>` or `human:<text>` (confirmed live, S-012 / A-003). There are
 * NO timestamps, and a speaker can produce consecutive lines — so we group by
 * speaker rather than assume strict agent/caller alternation.
 *
 * Rules:
 * - `bot` → `agent`, `human` → `caller` (prefix match is case-insensitive).
 * - Split on the FIRST colon only, so colons inside the utterance survive.
 * - Consecutive lines from the same speaker merge into one turn (joined by a space).
 * - A line with no known prefix is treated as a continuation of the current turn
 *   (dropped if there's no turn yet).
 * - Blank lines are ignored.
 */
const SPEAKER_BY_PREFIX: Record<string, Speaker> = { bot: 'agent', human: 'caller' };

export function parseTranscript(raw: string | null | undefined): Turn[] {
  if (!raw || typeof raw !== 'string') return [];

  const turns: Turn[] = [];

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const colon = line.indexOf(':');
    const prefix = colon === -1 ? '' : line.slice(0, colon).trim().toLowerCase();
    const speaker = SPEAKER_BY_PREFIX[prefix];

    if (!speaker) {
      // Continuation of the previous turn (or an orphan with nowhere to attach).
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

/** Render parsed turns back to a readable script (used as LLM scorer input). */
export function transcriptToText(turns: Turn[]): string {
  const label: Record<Speaker, string> = { agent: 'Agent', caller: 'Caller' };
  return turns.map((t) => `${label[t.speaker]}: ${t.text}`).join('\n');
}
