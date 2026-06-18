import { Router } from 'express';
import { buildAuthorizeUrl, exchangeCodeForTokens } from '../ghl/oauth.js';

export const oauthRouter = Router();

/** Kick off the OAuth flow — open this in a browser (or set it as the app's redirect target). */
oauthRouter.get('/install', (_req, res) => {
  res.redirect(buildAuthorizeUrl());
});

/** OAuth redirect URI registered in the Marketplace app. Exchanges the code for tokens. */
oauthRouter.get('/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  if (!code) {
    res.status(400).send('Missing ?code in OAuth callback.');
    return;
  }
  try {
    const tokens = await exchangeCodeForTokens(code);
    const where = tokens.locationId ?? tokens.companyId ?? 'unknown';
    console.log(`[oauth] install OK — userType=${tokens.userType} key=${where}`);
    // Land back in the embedded dashboard after a successful install.
    res.redirect(`/?installed=${encodeURIComponent(where)}`);
  } catch (err) {
    // axios errors carry the upstream response body — surface it for debugging (scope/redirect issues).
    const axiosBody =
      typeof err === 'object' && err && 'response' in err
        ? JSON.stringify((err as { response?: { data?: unknown } }).response?.data)
        : undefined;
    const detail = err instanceof Error ? err.message : 'unknown error';
    console.error(`[oauth] token exchange FAILED: ${detail}${axiosBody ? ` | ${axiosBody}` : ''}`);
    res.status(502).send(`OAuth token exchange failed: ${detail}${axiosBody ? ` — ${axiosBody}` : ''}`);
  }
});
