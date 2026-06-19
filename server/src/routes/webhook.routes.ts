import { Router } from 'express';
import type { Request } from 'express';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { ingestCall, ingestRawCall, type RawCallLog } from '../ingest/ingestCall.js';
import { listInstalls } from '../store/tokenStore.js';
import { verifyGhlSignature } from '../webhooks/verifyGhl.js';

export const webhookRouter = Router();

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = resolve(here, '../../fixtures/webhook-sample.json');

/** Calls currently being scored — dedupes GHL's rapid retries of the same delivery. */
const inFlight = new Set<string>();

/** Snapshot the exact webhook (headers + body) so we can confirm shape/signature. */
async function snapshot(req: Request): Promise<void> {
  try {
    await mkdir(dirname(SAMPLE_PATH), { recursive: true });
    await writeFile(SAMPLE_PATH, JSON.stringify({ headers: req.headers, body: req.body }, null, 2));
  } catch {
    /* best-effort */
  }
}

/**
 * Primary ingestion path (R2.1): HighLevel's marketplace `VoiceAiCallEnd` webhook fires
 * when a Voice AI call ends, carrying the full transcript inline — we verify the
 * Ed25519 signature, then score + persist in near-real-time. Polling
 * (scripts/ingest.mts) is the fallback/backfill.
 */
webhookRouter.post('/ghl/voice-ai', async (req, res) => {
  await snapshot(req);

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const signature = req.get('x-ghl-signature');
  const verified = verifyGhlSignature(rawBody, signature);
  if (config.requireWebhookSignature && !verified) {
    res.status(401).json({ error: 'Invalid or missing webhook signature.' });
    return;
  }

  const body = (req.body ?? {}) as RawCallLog & { type?: string; locationId?: string };
  console.log(`[webhook] type=${body.type ?? '?'} verified=${verified} call=${body.id ?? body.callId ?? '?'}`);

  const callId = body.id ?? body.callId;
  const locationId =
    (typeof body.locationId === 'string' && body.locationId) || (await listInstalls())[0];
  if (!callId || !locationId) {
    res.status(400).json({ error: 'Could not determine callId/locationId.', received: Object.keys(body) });
    return;
  }

  // Ack fast: scoring takes ~20s but GHL times out slow handlers and retries, so we
  // 202 immediately and ingest asynchronously. The poll path (scripts/ingest.mts) is
  // the backfill safety net for any async ingest that fails after the ack.
  res.status(202).json({ ok: true, accepted: callId, verified });

  if (inFlight.has(callId)) return; // a concurrent retry is already handling this call
  inFlight.add(callId);
  void (async () => {
    try {
      // VoiceAiCallEnd carries the transcript inline → score directly; a thin payload
      // (no transcript) falls back to fetching the call log by id.
      const result =
        typeof body.transcript === 'string' && body.transcript
          ? await ingestRawCall(body, locationId)
          : await ingestCall(callId, locationId);
      console.log(
        `[webhook] ingest ${callId}: ${result.status}` +
          (result.overallScore != null ? ` (score ${result.overallScore})` : ''),
      );
    } catch (err) {
      console.error(`[webhook] ingest ${callId} failed:`, err instanceof Error ? err.message : err);
    } finally {
      inFlight.delete(callId);
    }
  })();
});
