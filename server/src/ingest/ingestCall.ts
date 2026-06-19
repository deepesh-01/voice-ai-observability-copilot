import { getCallLog, getAgentPrompt } from '../ghl/api.js';
import { parseTranscript } from '../analysis/transcript.js';
import { scoreCall } from '../analysis/score.js';
import { analysisRepo, type StoredCall } from '../store/analysisRepository.js';

/** Raw GHL call-log fields we read (the rest is kept verbatim). */
interface RawCallLog {
  id?: string;
  agentId?: string;
  duration?: number;
  createdAt?: string;
  transcript?: string;
  [key: string]: unknown;
}

export interface IngestResult {
  callId: string;
  status: 'ingested' | 'skipped-exists' | 'skipped-empty';
  overallScore?: number;
}

/**
 * Ingest one call: fetch its log + transcript → parse → score against the agent's
 * goal → persist. Idempotent: skips calls already stored unless `force`.
 */
export async function ingestCall(
  callId: string,
  locationId: string,
  opts: { force?: boolean } = {},
): Promise<IngestResult> {
  if (!opts.force && (await analysisRepo.has(callId))) {
    return { callId, status: 'skipped-exists' };
  }

  const raw = (await getCallLog(callId, locationId)) as RawCallLog;
  const turns = parseTranscript(raw.transcript);
  if (turns.length === 0) {
    return { callId, status: 'skipped-empty' };
  }

  const goal =
    (raw.agentId ? await getAgentPrompt(raw.agentId, locationId) : undefined) ??
    'No agent prompt available — score against general call-quality best practices.';

  const analysis = await scoreCall({
    callId,
    agentId: raw.agentId,
    agentGoal: goal,
    turns,
  });

  const stored: StoredCall = {
    analysis,
    locationId,
    durationSec: typeof raw.duration === 'number' ? raw.duration : undefined,
    callAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    rawCall: raw,
  };
  await analysisRepo.save(stored);
  return { callId, status: 'ingested', overallScore: analysis.overallScore };
}
