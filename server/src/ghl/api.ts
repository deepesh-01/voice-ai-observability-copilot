import axios from 'axios';
import { GHL } from '../config.js';
import { getValidAccessToken } from './oauth.js';

/**
 * Thin client over the HighLevel Voice AI public API.
 * Endpoint verified: GET /voice-ai/dashboard/call-logs (List Call Logs).
 * The exact response schema is confirmed hands-on against a sandbox call (assumption A-003);
 * until then `web/` and the scoring engine work off a fixture shaped to this client's output.
 */

export interface CallLogSummary {
  callId: string;
  agentId?: string;
  contactId?: string;
  direction?: string;
  startedAt?: string;
  durationSec?: number;
  [key: string]: unknown; // tolerate fields we haven't mapped yet
}

interface ListCallLogsResponse {
  callLogs?: CallLogSummary[];
  meta?: { total?: number; nextPage?: number };
  [key: string]: unknown;
}

export interface ListCallLogsParams {
  locationId: string;
  agentId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
}

export async function listCallLogs(
  params: ListCallLogsParams,
  installKey?: string,
): Promise<ListCallLogsResponse> {
  const token = await getValidAccessToken(installKey);
  const { data } = await axios.get<ListCallLogsResponse>(
    `${GHL.apiBase}/voice-ai/dashboard/call-logs`,
    {
      headers: { Authorization: `Bearer ${token}`, Version: GHL.apiVersion },
      params: {
        locationId: params.locationId,
        agentId: params.agentId,
        startDate: params.startDate,
        endDate: params.endDate,
        page: params.page,
      },
    },
  );
  return data;
}

export interface ConnectionStatus {
  /** Token is live (HighLevel still accepts it). */
  connected: boolean;
  /** Token also carries the Voice AI scope we need. */
  voiceAiScopeOk: boolean;
  /** Human-readable explanation for the dashboard. */
  detail: string;
}

function describeAxiosError(err: unknown): { status?: number; message: string } {
  if (typeof err === 'object' && err && 'response' in err) {
    const resp = (err as { response?: { status?: number; data?: { message?: string } } }).response;
    return { status: resp?.status, message: resp?.data?.message ?? 'request failed' };
  }
  return { message: err instanceof Error ? err.message : 'unknown error' };
}

/**
 * Probe HighLevel with the stored token to report the LIVE connection state — distinct from
 * "we have a token on file". Distinguishes: live + scoped, live but missing the Voice AI
 * scope, and revoked/uninstalled (token rejected).
 */
export async function checkConnection(installKey?: string): Promise<ConnectionStatus> {
  let token: string;
  try {
    token = await getValidAccessToken(installKey);
  } catch (err) {
    return {
      connected: false,
      voiceAiScopeOk: false,
      detail: `Not authorized — token refresh failed (likely uninstalled/revoked). Reinstall the app. (${
        err instanceof Error ? err.message : 'error'
      })`,
    };
  }

  try {
    await axios.get(`${GHL.apiBase}/voice-ai/agents`, {
      headers: { Authorization: `Bearer ${token}`, Version: GHL.apiVersion },
      params: { locationId: installKey },
    });
    return { connected: true, voiceAiScopeOk: true, detail: 'Connected — Voice AI access OK.' };
  } catch (err) {
    const { status, message } = describeAxiosError(err);
    if (status === 401 && /scope/i.test(message)) {
      return {
        connected: true,
        voiceAiScopeOk: false,
        detail: 'Token valid, but missing Voice AI scope — publish a new version with voice-ai-dashboard.readonly and reinstall.',
      };
    }
    if (status === 401 || status === 403) {
      return {
        connected: false,
        voiceAiScopeOk: false,
        detail: 'Token rejected by HighLevel (likely uninstalled/revoked). Reinstall the app.',
      };
    }
    return { connected: false, voiceAiScopeOk: false, detail: `HighLevel error ${status ?? '?'}: ${message}` };
  }
}

/**
 * Fetch a single call log (includes the transcript when available).
 * The endpoint requires `locationId` as a query param — confirmed live (S-012): omitting it
 * returns 400 "LocationId is missing in query". `installKey` is that locationId.
 */
export async function getCallLog(
  callId: string,
  installKey?: string,
  locationId?: string,
): Promise<unknown> {
  const token = await getValidAccessToken(installKey);
  const { data } = await axios.get(`${GHL.apiBase}/voice-ai/dashboard/call-logs/${callId}`, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL.apiVersion },
    params: { locationId: locationId ?? installKey },
  });
  return data;
}
