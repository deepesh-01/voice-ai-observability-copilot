import axios from 'axios';
import { GHL, config, redirectUri } from '../config.js';
import { saveTokens, getTokens, type InstallTokens } from '../store/tokenStore.js';

/** Build the URL we redirect the installer to (chooselocation handles sub-account selection). */
export function buildAuthorizeUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirectUri,
    client_id: config.clientId,
    scope: config.scopes,
  });
  return `${GHL.authorizeUrl}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  userType: string;
  locationId?: string;
  companyId?: string;
}

function toInstallTokens(data: TokenResponse): InstallTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    userType: data.userType,
    locationId: data.locationId,
    companyId: data.companyId,
  };
}

/** Exchange the authorization code from the OAuth callback for tokens, and persist them. */
export async function exchangeCodeForTokens(code: string): Promise<InstallTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    user_type: 'Location',
    redirect_uri: redirectUri,
  });

  const { data } = await axios.post<TokenResponse>(GHL.tokenUrl, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const tokens = toInstallTokens(data);
  await saveTokens(tokens);
  return tokens;
}

async function refreshTokens(tokens: InstallTokens): Promise<InstallTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    user_type: tokens.userType || 'Location',
    redirect_uri: redirectUri,
  });

  const { data } = await axios.post<TokenResponse>(GHL.tokenUrl, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const refreshed = toInstallTokens(data);
  await saveTokens(refreshed);
  return refreshed;
}

/**
 * Return a valid access token for an install, refreshing if it expires within 60s.
 * @param key locationId/companyId; omit to use the sole install (setup convenience).
 */
export async function getValidAccessToken(key?: string): Promise<string> {
  const tokens = await getTokens(key);
  if (!tokens) {
    throw new Error('No HighLevel install found. Authorize the app via /oauth/install first.');
  }
  if (tokens.expiresAt - Date.now() > 60_000) {
    return tokens.accessToken;
  }
  const refreshed = await refreshTokens(tokens);
  return refreshed.accessToken;
}
