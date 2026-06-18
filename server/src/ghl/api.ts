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

/** Fetch a single call log (includes the transcript when available). */
export async function getCallLog(callId: string, installKey?: string): Promise<unknown> {
  const token = await getValidAccessToken(installKey);
  const { data } = await axios.get(`${GHL.apiBase}/voice-ai/dashboard/call-logs/${callId}`, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL.apiVersion },
  });
  return data;
}
