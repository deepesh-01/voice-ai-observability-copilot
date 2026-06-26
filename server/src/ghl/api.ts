import axios from 'axios';
import { GHL } from '../config.js';
import { getValidAccessToken } from './oauth.js';
import type { ContactInfo } from '../analysis/types.js';

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

/**
 * Fetch one agent's configured prompt/goal — what we score a call's adherence against.
 * The Voice AI agent endpoints use the newer `v3` API version (S-012).
 */
export async function getAgentPrompt(agentId: string, locationId: string): Promise<string | undefined> {
  const token = await getValidAccessToken(locationId);
  const { data } = await axios.get<{ agents?: { id?: string; _id?: string; agentPrompt?: string }[] }>(
    `${GHL.apiBase}/voice-ai/agents`,
    { headers: { Authorization: `Bearer ${token}`, Version: 'v3' }, params: { locationId } },
  );
  const agent = (data.agents ?? []).find((a) => (a.id ?? a._id) === agentId);
  return agent?.agentPrompt;
}

/** Raised when the live agent prompt no longer matches the baseline a preview was built on. */
export class PromptConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptConflictError';
  }
}

export interface AgentPromptUpdateResult {
  /** The re-fetched prompt equals what we sent (the write took — read-back verified). */
  ok: boolean;
  /** Configured `actions` (DATA_EXTRACTION fields) count before/after the PATCH. */
  beforeActions: number;
  afterActions: number;
  /**
   * The action COUNT is unchanged after a prompt-only PATCH (a count check, not a
   * deep-equality one — a same-count replacement would still read as preserved).
   * A drop here means the PATCH replaced rather than merged.
   */
  actionsPreserved: boolean;
  /** The agent's prompt as re-fetched after the write. */
  updatedPrompt: string;
}

interface GhlAgentRecord {
  id?: string;
  _id?: string;
  agentPrompt?: string;
  actions?: unknown[];
}

/**
 * PATCH one Voice AI agent's prompt — the write behind the dashboard's "Apply"
 * action. Mirrors the proven flow in scripts/configure-agent.mts:
 *   1. snapshot the current agent (prompt + actions count),
 *   2. PATCH ONLY `agentPrompt` (partial merge — confirmed live S-012; never send
 *      `actions`, which a full-object PATCH could replace),
 *   3. re-fetch and verify the prompt took and the actions survived.
 * Requires the `voice-ai-agents.write` scope on the install's token (a read-only
 * token returns 401/403). Voice AI endpoints use `Version: v3`.
 *
 * When `expectedCurrentPrompt` is given, the live prompt must still match it or we
 * throw {@link PromptConflictError} WITHOUT writing — optimistic concurrency so a
 * stale preview (the prompt changed since) can't silently overwrite a newer edit.
 */
export async function updateAgentPrompt(
  agentId: string,
  locationId: string,
  newPrompt: string,
  expectedCurrentPrompt?: string,
): Promise<AgentPromptUpdateResult> {
  const token = await getValidAccessToken(locationId);
  const headers = { Authorization: `Bearer ${token}`, Version: 'v3' };

  // 1. Snapshot current state so we can detect a destructive replace + stale writes.
  const before = await axios.get<{ agents?: GhlAgentRecord[] }>(
    `${GHL.apiBase}/voice-ai/agents`,
    { headers, params: { locationId } },
  );
  const current = (before.data.agents ?? []).find((a) => (a.id ?? a._id) === agentId);
  if (!current) throw new Error(`Agent ${agentId} not found in location ${locationId}.`);

  if (
    expectedCurrentPrompt !== undefined &&
    (current.agentPrompt ?? '').trim() !== expectedCurrentPrompt.trim()
  ) {
    throw new PromptConflictError(
      "The agent's prompt changed since this fix was previewed. Re-preview before applying.",
    );
  }
  const beforeActions = (current.actions ?? []).length;

  // 2. PATCH only the prompt — never send `actions`.
  await axios.patch(
    `${GHL.apiBase}/voice-ai/agents/${agentId}`,
    { agentPrompt: newPrompt },
    { headers, params: { locationId } },
  );

  // 3. Re-fetch and verify the write took and the actions survived.
  const after = await axios.get<{ agents?: GhlAgentRecord[] }>(
    `${GHL.apiBase}/voice-ai/agents`,
    { headers, params: { locationId } },
  );
  const updated = (after.data.agents ?? []).find((a) => (a.id ?? a._id) === agentId);
  const afterActions = (updated?.actions ?? []).length;
  const updatedPrompt = updated?.agentPrompt ?? '';
  const actionsPreserved = afterActions === beforeActions;

  // Recovery artifact (parity with scripts/configure-agent.mts): if the PATCH dropped
  // actions, log the pre-write agent so it can be restored — there's no fixture to write
  // to from a request handler, so the server log is the backup.
  if (!actionsPreserved) {
    console.error(
      `[updateAgentPrompt] actions changed ${beforeActions}→${afterActions} for agent ${agentId}; ` +
        `pre-write backup:\n${JSON.stringify(current)}`,
    );
  }

  return {
    ok: updatedPrompt.trim() === newPrompt.trim(),
    beforeActions,
    afterActions,
    actionsPreserved,
    updatedPrompt,
  };
}

export interface AgentInfo {
  id: string;
  /** Human-readable name (`agentName` in GHL); falls back to the id if unnamed. */
  name: string;
}

/** List an account's Voice AI agents as {id, name} — drives name resolution in the dashboard. */
export async function listAgents(locationId: string): Promise<AgentInfo[]> {
  const token = await getValidAccessToken(locationId);
  const { data } = await axios.get<{ agents?: { id?: string; _id?: string; agentName?: string; name?: string }[] }>(
    `${GHL.apiBase}/voice-ai/agents`,
    { headers: { Authorization: `Bearer ${token}`, Version: 'v3' }, params: { locationId } },
  );
  return (data.agents ?? [])
    .map((a) => {
      const id = a.id ?? a._id ?? '';
      return { id, name: a.agentName ?? a.name ?? id };
    })
    .filter((a) => a.id);
}

/** Best-effort extraction of a call id from a List Call Logs item (field name varies). */
export function callIdOf(call: Record<string, unknown>): string | undefined {
  return (call.callId ?? call.id ?? call._id ?? call.callLogId) as string | undefined;
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

/**
 * Fetch a contact's identity (name/phone/email) — the authoritative source for lead
 * contact info, since the call log only carries `contactId`. Best-effort: returns
 * undefined on any error so lead extraction can fall back to the transcript.
 * Contacts API uses the standard data API version (2021-07-28).
 */
export async function getContact(
  contactId: string,
  installKey?: string,
): Promise<ContactInfo | undefined> {
  try {
    const token = await getValidAccessToken(installKey);
    const { data } = await axios.get<{ contact?: GhlContact }>(
      `${GHL.apiBase}/contacts/${contactId}`,
      { headers: { Authorization: `Bearer ${token}`, Version: GHL.apiVersion } },
    );
    const c = data.contact;
    if (!c) return undefined;
    const name = c.contactName ?? [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
    return {
      name: name || undefined,
      phone: c.phone || undefined,
      email: c.email || undefined,
    };
  } catch {
    return undefined;
  }
}

interface GhlContact {
  contactName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
}
