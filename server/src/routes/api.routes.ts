import { Router } from 'express';
import { listInstalls } from '../store/tokenStore.js';
import { listCallLogs, getCallLog, checkConnection } from '../ghl/api.js';

export const apiRouter = Router();

/** Which sub-accounts/agencies have installed the app (drives the dashboard's account picker). */
apiRouter.get('/installs', async (_req, res) => {
  res.json({ installs: await listInstalls() });
});

/** Live HighLevel connection status for one install — probes the API, not just local state. */
apiRouter.get('/installs/:key/status', async (req, res) => {
  res.json({ key: req.params.key, ...(await checkConnection(req.params.key)) });
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
