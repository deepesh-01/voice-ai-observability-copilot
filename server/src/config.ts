import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load the repo-root .env (one level up from server/).
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

/**
 * HighLevel OAuth + API endpoints. Verified against the HighLevel developer docs
 * (see docs/sessions/session-003.md / session-004.md for sources). Centralised here so
 * there are no magic strings scattered across the codebase.
 */
export const GHL = {
  /**
   * Where we send the user to authorize + choose a location/sub-account. Matches where the
   * app is administered (marketplace.gohighlevel.com). For real installs, prefer the
   * portal's per-version "Install link" — a DRAFT version isn't resolvable via a hand-built
   * chooselocation URL (→ noAppVersionIdFound). Overridable via AUTHORIZE_URL.
   */
  authorizeUrl:
    process.env.AUTHORIZE_URL ?? 'https://marketplace.gohighlevel.com/oauth/chooselocation',
  /** Token exchange + refresh. */
  tokenUrl: 'https://services.leadconnectorhq.com/oauth/token',
  /** Base for all data APIs. */
  apiBase: 'https://services.leadconnectorhq.com',
  /** Required on data API calls. */
  apiVersion: '2021-07-28',
} as const;

export const config = {
  port: Number(process.env.PORT ?? 8095),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? 'http://localhost:8095').replace(/\/$/, ''),
  clientId: required('CLIENT_ID'),
  clientSecret: required('CLIENT_SECRET'),
  /**
   * Space-separated OAuth scopes. These MUST be a subset of the scopes enabled on the app
   * in the Marketplace portal, or chooselocation rejects the request. Confirm the exact
   * Voice AI scope name in the portal dropdown (tracked as assumption A-007).
   */
  scopes: (
    process.env.SCOPES ??
    'voice-ai-dashboard.readonly voice-ai-agents.readonly voice-ai-agent-goals.readonly ' +
      'conversations.readonly conversations/message.readonly conversation-ai.readonly'
  ).trim(),
  /**
   * Claude access for the scoring pipeline goes through the Claude Agent SDK, which
   * authenticates with this OAuth token (from `claude setup-token`) — not a bare API key.
   */
  claudeOAuthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '',
  /** Postgres connection (ADR-0002 rev). Empty → persistence is unavailable. */
  databaseUrl: process.env.DATABASE_URL ?? '',
  /**
   * Reject webhooks whose Ed25519 signature doesn't verify. Default false during
   * bring-up (so setup/testing isn't blocked); flip to true once a real
   * VoiceAiCallEnd delivery confirms the public key. (WEBHOOK_REQUIRE_SIGNATURE=true)
   */
  requireWebhookSignature: process.env.WEBHOOK_REQUIRE_SIGNATURE === 'true',
} as const;

/** The OAuth redirect URI registered in the Marketplace app must match this exactly. */
export const redirectUri = `${config.publicBaseUrl}/oauth/callback`;
