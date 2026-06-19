import { getCallLog, getAgentPrompt } from '../ghl/api.js';
import { parseTranscript } from '../analysis/transcript.js';
import { scoreCall } from '../analysis/score.js';
import { analysisRepo, type StoredCall } from '../store/analysisRepository.js';

/** Raw GHL call object — from getCallLog (`id`) or the VoiceAiCallEnd webhook (also `id`). */
export interface RawCallLog {
  id?: string;
  callId?: string;
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

const NO_GOAL = 'No agent prompt available — score against general call-quality best practices.';

/**
 * Core ingest: a raw call object that ALREADY carries its transcript (the webhook
 * payload does) → parse → score against the agent's goal → persist. Idempotent.
 */
export async function ingestRawCall(
  raw: RawCallLog,
  locationId: string,
  opts: { force?: boolean } = {},
): Promise<IngestResult> {
  const callId = raw.id ?? raw.callId;
  if (!callId) throw new Error('Raw call has no id.');
  if (!opts.force && (await analysisRepo.has(callId))) {
    return { callId, status: 'skipped-exists' };
  }

  const turns = parseTranscript(raw.transcript);
  if (turns.length === 0) {
    return { callId, status: 'skipped-empty' };
  }

  const goal =
    (raw.agentId ? await getAgentPrompt(raw.agentId, locationId) : undefined) ?? NO_GOAL;

  const analysis = await scoreCall({ callId, agentId: raw.agentId, agentGoal: goal, turns });
  await analysisRepo.save({
    analysis,
    locationId,
    durationSec: typeof raw.duration === 'number' ? raw.duration : undefined,
    callAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    rawCall: raw,
  });
  return { callId, status: 'ingested', overallScore: analysis.overallScore };
}

/**
 * Ingest by id: fetch the call log (poll/backfill path, or a thin webhook payload)
 * then score. Skips the fetch if already stored.
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
  if (!raw.id) raw.id = callId;
  // has() already checked above — force the core to skip the duplicate lookup.
  return ingestRawCall(raw, locationId, { force: true });
}
