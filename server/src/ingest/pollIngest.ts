import { listCallLogs, callIdOf } from '../ghl/api.js';
import { ingestCall } from './ingestCall.js';

export interface PollResult {
  scanned: number;
  ingested: number;
  skipped: number;
  errors: { callId: string; error: string }[];
}

/**
 * Poll-based ingestion: list a location's Voice AI calls and ingest any not yet
 * stored. This is the pull half of R2.1 — the webhook route (POST /webhooks/ghl/
 * voice-ai) is the push half for near-real-time ingestion once GHL's "Transcript
 * Generated" trigger is wired (A-006).
 */
export async function pollAndIngest(locationId: string): Promise<PollResult> {
  const list = (await listCallLogs({ locationId }, locationId)) as { callLogs?: Record<string, unknown>[] };
  const calls = list.callLogs ?? [];
  const result: PollResult = { scanned: calls.length, ingested: 0, skipped: 0, errors: [] };

  for (const call of calls) {
    const callId = callIdOf(call);
    if (!callId) continue;
    try {
      const res = await ingestCall(callId, locationId);
      if (res.status === 'ingested') result.ingested += 1;
      else result.skipped += 1;
    } catch (err) {
      result.errors.push({ callId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
