import { Router } from 'express';
import { listInstalls } from '../store/tokenStore.js';
import {
  listCallLogs,
  getCallLog,
  checkConnection,
  listAgents,
  getAgentPrompt,
  updateAgentPrompt,
  PromptConflictError,
} from '../ghl/api.js';
import { analysisRepo } from '../store/analysisRepository.js';
import { leadRepo } from '../store/leadRepository.js';
import { recommendForAgent } from '../analysis/recommend.js';
import { revisePromptForRecommendation } from '../analysis/applyRecommendation.js';
import { createMutex } from '../util/mutex.js';
import type { BookingStatus } from '../analysis/types.js';

export const apiRouter = Router();

/**
 * Serializes live agent writes: every PATCH goes through this mutex so two "Apply"
 * requests can never update an agent in parallel (the brief's one-at-a-time rule).
 * Process-local — fine for the single-instance deployment; a multi-instance setup
 * would move this to a DB advisory lock.
 */
const agentWriteLock = createMutex();

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const bool = (v: unknown): boolean | undefined => (v === '1' || v === 'true' ? true : undefined);

const BOOKING_STATUSES: BookingStatus[] = ['booked', 'not_booked', 'reschedule', 'cancelled', 'unknown'];

/** Which sub-accounts/agencies have installed the app (drives the dashboard's account picker). */
apiRouter.get('/installs', async (_req, res) => {
  res.json({ installs: await listInstalls() });
});

/** Live HighLevel connection status for one install — probes the API, not just local state. */
apiRouter.get('/installs/:key/status', async (req, res) => {
  res.json({ key: req.params.key, ...(await checkConnection(req.params.key)) });
});

/** Voice AI agents for a location as {id, name} — lets the dashboard show names, not raw ids. */
apiRouter.get('/agents', async (req, res) => {
  const locationId = str(req.query.locationId);
  if (!locationId) {
    res.status(400).json({ error: 'locationId query param is required.' });
    return;
  }
  try {
    res.json({ agents: await listAgents(locationId) });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'upstream error' });
  }
});

/** List Voice AI call logs for a location. */
apiRouter.get('/calls', async (req, res) => {
  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : '';
  if (!locationId) {
    res.status(400).json({ error: 'locationId query param is required.' });
    return;
  }
  try {
    const data = await listCallLogs({
      locationId,
      agentId: typeof req.query.agentId === 'string' ? req.query.agentId : undefined,
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'upstream error' });
  }
});

/** A single call log + transcript. */
apiRouter.get('/calls/:callId', async (req, res) => {
  try {
    res.json(await getCallLog(req.params.callId));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'upstream error' });
  }
});

/** Persisted, scored analyses for a location (dashboard list view). */
apiRouter.get('/analyses', async (req, res) => {
  const locationId = str(req.query.locationId);
  if (!locationId) {
    res.status(400).json({ error: 'locationId query param is required.' });
    return;
  }
  try {
    const items = await analysisRepo.list({
      locationId,
      agentId: str(req.query.agentId),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ analyses: items });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'storage error' });
  }
});

/** One persisted analysis (full CallAnalysis + raw call). */
apiRouter.get('/analyses/:callId', async (req, res) => {
  try {
    const stored = await analysisRepo.get(req.params.callId);
    if (!stored) {
      res.status(404).json({ error: 'No analysis stored for that call. Ingest it first.' });
      return;
    }
    res.json(stored);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'storage error' });
  }
});

/** Average score per (agent, KPI) — drives the dashboard's agent/KPI trends. */
apiRouter.get('/kpis/averages', async (req, res) => {
  const locationId = str(req.query.locationId);
  if (!locationId) {
    res.status(400).json({ error: 'locationId query param is required.' });
    return;
  }
  try {
    res.json({ averages: await analysisRepo.kpiAverages({ locationId, agentId: str(req.query.agentId) }) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'storage error' });
  }
});

/**
 * AI-generated recommendations for an agent, synthesized across its call history (R2.5).
 * Computed on demand: gathers stored analyses + KPI averages, then runs the Opus synthesis.
 */
apiRouter.get('/recommendations', async (req, res) => {
  const locationId = str(req.query.locationId);
  if (!locationId) {
    res.status(400).json({ error: 'locationId query param is required.' });
    return;
  }
  try {
    const report = await recommendForAgent({
      locationId,
      agentId: str(req.query.agentId),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      force: req.query.refresh === '1' || req.query.refresh === 'true',
    });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'recommendation error' });
  }
});

/**
 * Preview applying ONE recommendation to the agent's prompt (R2.5 / A-012, step 1).
 * Fetches the (cached) recommendation by index, reads the agent's live prompt, and
 * runs the Opus merge to produce the complete revised prompt — NO write happens here.
 * The dashboard shows the before/after for the operator to confirm.
 */
apiRouter.post('/agents/:agentId/recommendations/:index/preview', async (req, res) => {
  const agentId = req.params.agentId;
  const locationId = str(req.body?.locationId) ?? str(req.query.locationId);
  const index = Number(req.params.index);
  if (!locationId) {
    res.status(400).json({ error: 'locationId is required.' });
    return;
  }
  if (!Number.isInteger(index) || index < 0) {
    res.status(400).json({ error: 'index must be a non-negative integer.' });
    return;
  }
  try {
    const report = await recommendForAgent({ locationId, agentId });
    const rec = report.recommendations[index];
    if (!rec) {
      res.status(404).json({ error: `No recommendation at index ${index} for this agent.` });
      return;
    }
    const currentPrompt = (await getAgentPrompt(agentId, locationId)) ?? '';
    if (!currentPrompt.trim()) {
      res.status(409).json({ error: 'This agent has no editable prompt to update.' });
      return;
    }
    const revised = await revisePromptForRecommendation({ currentPrompt, recommendation: rec });
    res.json({ agentId, index, recommendation: rec, currentPrompt, ...revised });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'preview error' });
  }
});

/**
 * Apply a previewed prompt to the agent (R2.5 / A-012, step 2) — the actual write.
 * Serialized via `agentWriteLock` (one agent update at a time). `baselinePrompt` is
 * the prompt the preview was built on; if the live prompt has since changed we 409
 * rather than clobber the newer edit. Aborts (500) if the PATCH would drop actions.
 */
apiRouter.post('/agents/:agentId/apply', async (req, res) => {
  const agentId = req.params.agentId;
  const locationId = str(req.body?.locationId);
  const revisedPrompt = typeof req.body?.revisedPrompt === 'string' ? req.body.revisedPrompt : '';
  // Required (fail closed): without the baseline we can't guard against a stale
  // overwrite, so we refuse rather than do a blind unconditional write.
  const baselinePrompt =
    typeof req.body?.baselinePrompt === 'string' ? req.body.baselinePrompt : undefined;
  if (!locationId) {
    res.status(400).json({ error: 'locationId is required.' });
    return;
  }
  if (!revisedPrompt.trim()) {
    res.status(400).json({ error: 'revisedPrompt is required.' });
    return;
  }
  if (baselinePrompt === undefined) {
    res.status(400).json({ error: 'baselinePrompt is required (the prompt the change was previewed against).' });
    return;
  }
  try {
    const result = await agentWriteLock.run(() =>
      updateAgentPrompt(agentId, locationId, revisedPrompt, baselinePrompt),
    );
    if (!result.actionsPreserved) {
      // The PATCH already executed (it merges, per S-012) but the action count moved —
      // surface it honestly; a pre-write backup was logged server-side for recovery.
      res.status(502).json({
        error: `The prompt was written, but the agent's configured actions changed (${result.beforeActions} → ${result.afterActions}) and may need restoring from the server logs.`,
        ...result,
      });
      return;
    }
    if (!result.ok) {
      res.status(502).json({
        error: 'HighLevel accepted the update but the prompt did not change on read-back. Please try again.',
        ...result,
      });
      return;
    }
    res.json({ agentId, ...result });
  } catch (err) {
    if (err instanceof PromptConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: err instanceof Error ? err.message : 'agent update error' });
  }
});

// ── Leads + observability signals (read-only; no booking workflow) ───────────

/**
 * Per-call leads for a location, filterable by agent, booking status, and the two
 * observability signals — `missedOpportunity=1` (R2.3) and `humanActionNeeded=1` (R2.6).
 */
apiRouter.get('/leads', async (req, res) => {
  const locationId = str(req.query.locationId);
  if (!locationId) {
    res.status(400).json({ error: 'locationId query param is required.' });
    return;
  }
  const bookingStatus = str(req.query.bookingStatus) as BookingStatus | undefined;
  if (bookingStatus && !BOOKING_STATUSES.includes(bookingStatus)) {
    res.status(400).json({ error: `bookingStatus must be one of ${BOOKING_STATUSES.join(', ')}.` });
    return;
  }
  try {
    const leads = await leadRepo.listLeads({
      locationId,
      agentId: str(req.query.agentId),
      bookingStatus,
      missedOpportunity: bool(req.query.missedOpportunity),
      humanActionNeeded: bool(req.query.humanActionNeeded),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ leads });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'storage error' });
  }
});

/** One lead (the extracted lead facts + signals for a single call). */
apiRouter.get('/leads/:callId', async (req, res) => {
  try {
    const lead = await leadRepo.getLead(req.params.callId);
    if (!lead) {
      res.status(404).json({ error: 'No lead stored for that call.' });
      return;
    }
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'storage error' });
  }
});
