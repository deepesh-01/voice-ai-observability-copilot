import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { config } from './config.js';
import { oauthRouter } from './routes/oauth.routes.js';
import { apiRouter } from './routes/api.routes.js';
import { webhookRouter } from './routes/webhook.routes.js';
import { apiAuth } from './middleware/apiAuth.js';
import { analysisRepo } from './store/analysisRepository.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();

// Keep the raw request bytes around so webhook signatures can be verified
// (signature is computed over the exact body, not the re-serialized JSON).
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

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
app.use('/api', apiAuth, apiRouter); // read API is token-guarded (when API_AUTH_TOKEN set)
app.use('/webhooks', webhookRouter);

// Serve the built Vue dashboard (web/dist) when present; otherwise a setup placeholder.
const webDist = resolve(here, '../../web/dist');
if (existsSync(webDist)) {
  // The SPA's index.html gets the API token injected at serve time (kept out of git);
  // the dashboard reads window.__API_TOKEN__ and sends it on every /api call.
  const indexHtml = readFileSync(resolve(webDist, 'index.html'), 'utf8');
  const injectedHtml = config.apiAuthToken
    ? indexHtml.replace(
        '</head>',
        `<script>window.__API_TOKEN__=${JSON.stringify(config.apiAuthToken)}</script></head>`,
      )
    : indexHtml;
  app.use(express.static(webDist, { index: false }));
  app.get('*', (_req, res) => res.type('html').send(injectedHtml));
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
  if (config.apiAuthToken) {
    console.log('[server] /api guarded by API_AUTH_TOKEN (bearer)');
  } else {
    console.warn('[server] API_AUTH_TOKEN unset — /api is OPEN (set it in production)');
  }
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
