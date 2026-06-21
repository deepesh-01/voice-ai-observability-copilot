import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from '../config.js';

/**
 * Bearer-token guard for the read API (`/api/*`).
 *
 * Threat model (honest): this blocks public / automated access to call data — a
 * `curl https://…/api/leads` with no token gets 401. The token is provisioned per
 * deploy via `API_AUTH_TOKEN` and injected into the served SPA at runtime (see
 * index.ts), so it never lives in git and the dashboard works embedded + standalone.
 * It is NOT per-user identity: anyone who loads the dashboard page can read the token
 * from the HTML. For per-user / per-location authentication, layer HighLevel SSO
 * (decrypt the embedded user context with the app Shared Secret) — tracked follow-up.
 *
 * Enforced only when a token is configured, so local dev and the test suite (no token)
 * are unaffected; production sets the env.
 */
export const apiAuth: RequestHandler = (req, res, next) => {
  const expected = config.apiAuthToken;
  if (!expected) return next(); // not configured → open (dev). Boot logs a warning.

  const header = req.header('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : (req.header('x-api-key') ?? '');

  if (provided && safeEqual(provided, expected)) return next();
  res.status(401).json({ error: 'Unauthorized — missing or invalid API token.' });
};

/** Constant-time compare that won't throw on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
