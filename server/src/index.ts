import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { oauthRouter } from './routes/oauth.routes.js';
import { apiRouter } from './routes/api.routes.js';
import { webhookRouter } from './routes/webhook.routes.js';
import { analysisRepo } from './store/analysisRepository.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

/**
 * Allow embedding inside the HighLevel UI (Custom Page iframe — R1.2).
 * We must NOT send X-Frame-Options: DENY/SAMEORIGIN. Express doesn't set it by default,
 * so we only add a permissive frame-ancestors CSP scoped to HighLevel's hosts.
 */
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com",
  );
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'voice-ai-observability', publicBaseUrl: config.publicBaseUrl });
});

app.use('/oauth', oauthRouter);
app.use('/api', apiRouter);
app.use('/webhooks', webhookRouter);

// Serve the built Vue dashboard (web/dist) when present; otherwise a setup placeholder.
const webDist = resolve(here, '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(resolve(webDist, 'index.html')));
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .send(
        '<h1>Voice AI Observability Copilot</h1>' +
          '<p>Backend is running. Build the dashboard with <code>cd web && npm run build</code>, ' +
          'or start the app via <code>/oauth/install</code> to authorize HighLevel.</p>',
      );
  });
}

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  console.log(`[server] public base URL: ${config.publicBaseUrl}`);
  console.log(`[server] OAuth redirect URI: ${config.publicBaseUrl}/oauth/callback`);
  // Best-effort: ensure persistence tables exist when a DB is configured.
  if (config.databaseUrl) {
    analysisRepo
      .init()
      .then(() => console.log('[server] persistence ready (Postgres)'))
      .catch((err) => console.warn('[server] persistence init failed:', err.message));
  } else {
    console.warn('[server] DATABASE_URL unset — persistence disabled');
  }
});
