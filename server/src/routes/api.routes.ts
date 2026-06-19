import { Router } from 'express';
import { listInstalls } from '../store/tokenStore.js';
import { listCallLogs, getCallLog, checkConnection, listAgents } from '../ghl/api.js';
import { analysisRepo } from '../store/analysisRepository.js';
import { recommendForAgent } from '../analysis/recommend.js';

export const apiRouter = Router();

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

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
