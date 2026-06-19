import { Router } from 'express';
import { ingestCall } from '../ingest/ingestCall.js';
import { listInstalls } from '../store/tokenStore.js';

export const webhookRouter = Router();

/**
 * Push-half of ingestion (R2.1): GHL's "Transcript Generated" workflow trigger posts
 * here when a call finishes, so we score it in near-real-time instead of polling.
 *
 * The exact GHL payload shape is unconfirmed (A-006), so we extract the call id and
 * location id defensively from the common field names. Returns 200 fast and ingests
 * inline (calls are low-frequency); move to a queue if volume grows.
 */
webhookRouter.post('/ghl/voice-ai', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = body[k];
      if (typeof v === 'string' && v) return v;
    }
    return undefined;
  };

  const callId = pick('callId', 'callLogId', 'id', 'call_id');
  const locationId =
    pick('locationId', 'location_id') ?? (await listInstalls())[0]; // single-tenant fallback

  if (!callId || !locationId) {
    res.status(400).json({ error: 'Could not determine callId/locationId from webhook payload.', received: Object.keys(body) });
    return;
  }

  try {
    const result = await ingestCall(callId, locationId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'ingest failed' });
  }
});
