import { runStructured } from '../llm/agent.js';
import { transcriptToText } from './transcript.js';
import { mapExtractedData } from './nativeFacts.js';
import type { BookingStatus, CallLead, ContactInfo, LeadExtraction, Turn } from './types.js';

/**
 * Pull structured lead + booking facts from a transcript. This is a cheaper,
 * narrower job than KPI scoring (fact extraction, not judgement), so it runs on
 * Haiku rather than the Opus scorer — half the loop, a fraction of the cost.
 */
const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

const BOOKING_STATUSES: BookingStatus[] = [
  'booked',
  'not_booked',
  'reschedule',
  'cancelled',
  'unknown',
];

export interface ExtractLeadInput {
  callId: string;
  turns: Turn[];
  /** GHL's own call summary, if present — extra context for the extractor. */
  ghlSummary?: string;
}

/** The (possibly imperfect) shape the LLM is constrained to. Cleaned up in assembleExtraction. */
interface RawExtraction {
  callerName: string;
  phone: string;
  email: string;
  problem: string;
  treatment: string;
  bookingStatus: string;
  bookedAt: string;
  confirmed: boolean;
  missedOpportunity: boolean;
  missedOpportunityReason: string;
  humanActionNeeded: boolean;
  humanActionReason: string;
}

/** JSON-schema for structured output. All fields required; "unknown"/"" stand in for absent. */
export const LEAD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'callerName',
    'phone',
    'email',
    'problem',
    'treatment',
    'bookingStatus',
    'bookedAt',
    'confirmed',
    'missedOpportunity',
    'missedOpportunityReason',
    'humanActionNeeded',
    'humanActionReason',
  ],
  properties: {
    callerName: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string' },
    problem: { type: 'string' },
    treatment: { type: 'string' },
    bookingStatus: { type: 'string', enum: BOOKING_STATUSES },
    // ISO 8601 if a specific date/time was agreed, else "".
    bookedAt: { type: 'string' },
    confirmed: { type: 'boolean' },
    missedOpportunity: { type: 'boolean' },
    missedOpportunityReason: { type: 'string' },
    humanActionNeeded: { type: 'boolean' },
    humanActionReason: { type: 'string' },
  },
} as const;

export function buildLeadSystemPrompt(): string {
  return [
    'You extract structured lead facts and two observability signals from a Voice AI call',
    'transcript for a business (e.g. a clinic). Report ONLY what the transcript supports —',
    'never invent a name, number, or appointment. Use "" for any text field not stated, and',
    '"unknown" for bookingStatus when it is unclear.',
    '',
    'Lead facts:',
    '- callerName / phone / email: the caller\'s, if stated aloud.',
    '- problem: one short phrase for why they called.',
    '- treatment: the specific service/treatment discussed, if any.',
    '- bookingStatus: booked | not_booked | reschedule | cancelled | unknown.',
    '- bookedAt: the agreed appointment date/time as ISO 8601 (e.g. 2026-06-25T15:00:00) if',
    '  one was set; else "". Resolve relative dates only if the transcript makes them concrete.',
    '- confirmed: true only if the agent explicitly read the booking back / confirmed it.',
    '',
    'Observability signals (the actionable output):',
    '- missedOpportunity: true if the caller showed intent the agent FAILED to convert —',
    '  e.g. asked about a service but was never offered a booking, or contact info was not',
    '  captured. missedOpportunityReason: one sentence on what was missed (else "").',
    '- humanActionNeeded: true if a human must act after this call — an unconfirmed booking,',
    '  an unresolved question, a promised callback, or an escalation. humanActionReason: one',
    '  sentence on what the human should do (else "").',
  ].join('\n');
}

export function buildLeadUserPrompt(input: ExtractLeadInput): string {
  const parts = [`CALL ${input.callId}`];
  if (input.ghlSummary?.trim()) parts.push('', 'PROVIDER SUMMARY:', input.ghlSummary.trim());
  parts.push('', 'TRANSCRIPT:', transcriptToText(input.turns));
  return parts.join('\n');
}

/** Empty string → undefined; trims. Keeps the persisted shape clean. */
function clean(s: string | undefined): string | undefined {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : undefined;
}

/** Turn a raw LLM extraction into a validated LeadExtraction. Pure + total. */
export function assembleExtraction(raw: Partial<RawExtraction>): LeadExtraction {
  const bookingStatus = BOOKING_STATUSES.includes(raw.bookingStatus as BookingStatus)
    ? (raw.bookingStatus as BookingStatus)
    : 'unknown';
  return {
    callerName: clean(raw.callerName),
    phone: clean(raw.phone),
    email: clean(raw.email),
    problem: clean(raw.problem),
    treatment: clean(raw.treatment),
    bookingStatus,
    bookedAt: clean(raw.bookedAt),
    confirmed: raw.confirmed === true,
    missedOpportunity: raw.missedOpportunity === true,
    missedOpportunityReason: clean(raw.missedOpportunityReason),
    humanActionNeeded: raw.humanActionNeeded === true,
    humanActionReason: clean(raw.humanActionReason),
  };
}

/**
 * Assemble a persistable CallLead from three layers, in precedence order for FACTS:
 *   native GHL extractedData  >  the contact record (identity)  >  the LLM extraction.
 * The two observability SIGNALS (missed-opportunity / human-action) are always the LLM's
 * judgment. `source` records where the facts came from. Pure + total.
 */
export function assembleLead(opts: {
  callId: string;
  locationId: string;
  agentId?: string;
  contactId?: string;
  extraction: LeadExtraction;
  contact?: ContactInfo;
  /** Raw GHL `extractedData` for this call (the agent's native data-extraction output). */
  extractedData?: unknown;
}): CallLead {
  const { extraction, contact } = opts;
  const native = mapExtractedData(opts.extractedData);
  const nativeRaw =
    opts.extractedData && typeof opts.extractedData === 'object'
      ? (opts.extractedData as Record<string, unknown>)
      : null;

  return {
    callId: opts.callId,
    locationId: opts.locationId,
    agentId: opts.agentId,
    contactId: opts.contactId,
    // Facts: native ground-truth first, then the contact record, then LLM inference.
    callerName: native.callerName ?? clean(contact?.name) ?? extraction.callerName,
    phone: native.phone ?? clean(contact?.phone) ?? extraction.phone,
    email: native.email ?? clean(contact?.email) ?? extraction.email,
    problem: native.problem ?? extraction.problem,
    treatment: native.treatment ?? extraction.treatment,
    bookingStatus: native.bookingStatus ?? extraction.bookingStatus,
    bookedAt: native.bookedAt ?? extraction.bookedAt,
    confirmed: extraction.confirmed,
    // Signals: always the LLM's judgment (GHL doesn't emit "what the agent failed to do").
    missedOpportunity: extraction.missedOpportunity,
    missedOpportunityReason: extraction.missedOpportunityReason,
    humanActionNeeded: extraction.humanActionNeeded,
    humanActionReason: extraction.humanActionReason,
    source: native.hasAny ? 'ghl' : 'llm',
    native: nativeRaw,
    extraction,
  };
}

/** Extract lead facts from one call (Claude Agent SDK, Haiku). */
export async function extractLead(input: ExtractLeadInput): Promise<LeadExtraction> {
  const raw = await runStructured<RawExtraction>({
    system: buildLeadSystemPrompt(),
    prompt: buildLeadUserPrompt(input),
    schema: LEAD_SCHEMA as unknown as Record<string, unknown>,
    model: EXTRACT_MODEL,
  });
  return assembleExtraction(raw);
}
