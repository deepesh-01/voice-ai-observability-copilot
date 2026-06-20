import { getCallLog, getAgentPrompt, getContact } from '../ghl/api.js';
import { parseTranscript } from '../analysis/transcript.js';
import { scoreCall } from '../analysis/score.js';
import { extractLead, assembleLead } from '../analysis/extractLead.js';
import { analysisRepo } from '../store/analysisRepository.js';
import { rawCallRepo } from '../store/rawCallRepository.js';
import { leadRepo } from '../store/leadRepository.js';
import type { Turn } from '../analysis/types.js';

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

  // Capture the raw call FIRST — the source-of-record (raw_call), before any scoring.
  // So if scoring/extraction fails below, the call is still persisted and reprocessable.
  await rawCallRepo.saveRaw({
    callId,
    locationId,
    agentId: raw.agentId,
    contactId: typeof raw.contactId === 'string' ? raw.contactId : undefined,
    durationSec: typeof raw.duration === 'number' ? raw.duration : undefined,
    callAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    payload: raw,
  });

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
  await analysisRepo.save({ analysis, locationId });

  // Extract + persist the lead/booking layer. Best-effort and non-blocking: a failure
  // here must not lose the scored call (the analysis is already committed above).
  await ingestLead(callId, raw, turns, locationId).catch((err) =>
    console.warn(`[ingest] lead extraction failed for ${callId}: ${(err as Error).message}`),
  );

  return { callId, status: 'ingested', overallScore: analysis.overallScore };
}

/**
 * Derive the structured lead from a call: LLM extraction + the authoritative contact
 * record → a persisted CallLead carrying the missed-opportunity / human-action signals.
 */
async function ingestLead(
  callId: string,
  raw: RawCallLog,
  turns: Turn[],
  locationId: string,
): Promise<void> {
  const extraction = await extractLead({
    callId,
    turns,
    ghlSummary: typeof raw.summary === 'string' ? raw.summary : undefined,
  });
  const contactId = typeof raw.contactId === 'string' ? raw.contactId : undefined;
  const contact = contactId ? await getContact(contactId, locationId) : undefined;
  const lead = assembleLead({
    callId,
    locationId,
    agentId: raw.agentId,
    contactId,
    extraction,
    contact,
    extractedData: raw.extractedData, // native GHL ground-truth (preferred over LLM facts)
  });
  await leadRepo.saveLead(lead);
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
